// Regression tests for bugs fixed in 7.3.2:
//   A. Stopping the followers check while X is still answering keeps it stopped
//      (a late answer used to bring the check back to life).
//   B. The same for the last-active check.
//   C. "Reset settings" resets speed and Keep rules only: anonymous stats,
//      notifications, followers tracking and the language stay as chosen.
//   D. History: re-followed then unfollowed again -> the newest unfollow can be
//      followed again (a later unfollow wins over an earlier follow).
import { boot, log, assert, sleep } from "./harness.mjs";

const H = await boot();
const { mock } = H;
let failed = false;

try {
  await H.page("https://x.com/home");
  await sleep(800);
  await H.setStore({ "x7.settings": { speed: "custom", minDelay: 2, maxDelay: 2, restEvery: 0, restMinutes: 1, dailyLimit: 0, trackFollowers: true } });
  const d = await H.dashboard("overview");
  await d.waitForSelector(".nav");
  const cmd = (c, extra) => d.evaluate(([c, e]) => U.cmd(c, e || {}), [c, extra || null]);

  // a scan; the automatic followers check saves the first snapshot
  await cmd("scan");
  await H.waitFor(async () => { const s = await H.scan(); return s && s.status === "done" ? s : null; }, "scan", 90000);
  await H.waitFor(async () => { const f = await H.store("x7.fol"); return f && f.status !== "running" ? f : null; }, "first followers check", 120000);

  // ---- A: stop the followers check mid-request ------------------------------
  mock.cfg.followersHang = { ms: 5000, status: 503 };
  const r1 = await cmd("folStart");
  assert(r1.ok, "followers check started");
  await H.waitFor(async () => { const f = await H.store("x7.fol"); return f && f.status === "running" ? f : null; }, "check running", 20000);
  await sleep(1500);                                   // the first page request is now in flight
  await cmd("folStop");
  assert((await H.store("x7.fol")).status === "stopped", "check stopped");
  await sleep(8000);                                   // X answers (with an error) after the stop
  const fA = await H.store("x7.fol");
  assert(fA.status === "stopped", "it stays stopped after X's late answer (was: " + fA.status + ")");
  assert(!(await H.store("x7.folPartial")), "no half-read followers left behind");
  mock.cfg.followersHang = null;

  // ---- B: stop the last-active check mid-request -------------------------------
  mock.cfg.actHang = { ms: 5000 };
  const r2 = await cmd("actStart", { scope: "all" });
  assert(r2.ok && r2.total > 0, "last-active check started (" + r2.total + " accounts)");
  await sleep(2500);
  await cmd("actStop");
  const a0 = await H.store("x7.act");
  assert(a0.status === "stopped", "activity check stopped");
  await sleep(7000);
  const a1 = await H.store("x7.act");
  assert(a1.status === "stopped" && a1.index === a0.index, "it stays stopped after X's late answer (was: " + a1.status + ", " + a0.index + " -> " + a1.index + ")");
  mock.cfg.actHang = null;

  // ---- C: Reset settings keeps privacy and other personal choices -----------
  await H.setStore({ "x7.settings": { speed: "fast", minDelay: 4, maxDelay: 10, restEvery: 80, restMinutes: 5, dailyLimit: 1000,
    keepVerified: true, keepNewDays: 7, telemetry: false, trackFollowers: false, notify: false, lang: "auto" } });
  await d.goto(d.url().replace(/#.*$/, "#settings"));
  await d.reload();
  await d.waitForSelector('.page[data-page="settings"].is-on');
  await d.click("#resetSettings");
  await d.waitForSelector("#confirm:not([hidden])");
  await d.click("#cfOk");
  await sleep(600);
  const s = await H.store("x7.settings");
  assert(s.speed === "balanced" && s.keepVerified === false && s.keepNewDays === 0, "speed and Keep rules are back to the defaults");
  assert(s.telemetry === false, "anonymous stats stay off");
  assert(s.trackFollowers === false, "followers tracking stays off");

  // ---- D: History after re-follow and a second unfollow -------------------------
  const scan = await H.scan();
  const u = (await H.store("x7.scanUsers"))[5];
  const t0 = scan.finishedAt + 1000;
  const hist = (await H.store("x7.history")) || [];
  hist.push({ i: u.i, h: u.h, n: u.n, a: "", t: t0, s: "ids" });
  hist.push({ i: u.i, h: u.h, n: u.n, a: "", t: t0 + 1000, s: "refollow", k: "f" });
  hist.push({ i: u.i, h: u.h, n: u.n, a: "", t: t0 + 2000, s: "ids" });
  await H.setStore({ "x7.history": hist, "x7.doneIds": [u.i] });
  await d.goto(d.url().replace(/#.*$/, "#history"));
  await d.reload();
  await d.waitForSelector("#hiList .hi-row");
  const rows = await d.$$eval(`#hiList .hi-row[data-id="${u.i}"]`, (r) => r.map((x) => {
    const cb = x.querySelector(".hicb");
    return { enabled: !!cb && !cb.disabled, again: /tag ok/.test(x.innerHTML) };
  }));
  assert(rows.length === 2, "two unfollow entries for the account");
  assert(rows[0].enabled, "the newest unfollow can be followed again");
  assert(!rows[1].enabled && rows[1].again, "the older one shows Followed again and can't be selected");
} catch (e) {
  failed = true;
  log("FAIL", e.stack || e.message);
} finally {
  await H.close();
  log(failed ? "t14 FAILED" : "t14 passed");
  process.exit(failed ? 1 : 0);
}
