// Engine features added in 7.3.2:
//   - followers check after a scan: baseline, then who unfollowed you / new
//     followers / fans, never compared when the read is incomplete
//   - follow engine: follow back fans, re-follow accounts from History
//     (same pacing and daily limit; History records follows; "unfollowed" mark cleared)
//   - per-account data: switching X accounts swaps scan, whitelist, history...
//     and never while the other account's run is unfinished
//   - grace period: accounts that show up after the first scan are kept for N days
//   - desktop notifications fire for the daily limit, the end of a run and unfollowers
import { boot, log, assert, sleep } from "./harness.mjs";

const H = await boot({ fans: 5 });
const { mock } = H;
let failed = false;
const cmd = async (c, extra) => {
  if (!H.cmdPage || H.cmdPage.isClosed()) H.cmdPage = await H.page(`chrome-extension://${H.extId}/privacy.html`);
  return H.cmdPage.evaluate(([a, b]) => chrome.runtime.sendMessage(Object.assign({ cmd: a }, b || {})), [c, extra]);
};
const waitScan = () => H.waitFor(async () => { const s = await H.scan(); return s && s.status === "done" ? s : null; }, "scan", 90000);
const waitFol = (pred) => H.waitFor(async () => { const f = await H.store("x7.fol"); return f && f.status !== "running" && (!pred || pred(f)) ? f : null; }, "followers check", 120000);
const waitJob = () => H.waitFor(async () => { const j = await H.job(); return j && j.status === "done" ? j : null; }, "run", 120000);

try {
  await H.page("https://x.com/home");
  await sleep(1000);
  await H.setStore({ "x7.settings": { speed: "custom", minDelay: 2, maxDelay: 2, restEvery: 0, restMinutes: 1, dailyLimit: 0, notify: true } });

  // Stand-in for Chrome's notifications API (an optional permission the test can't grant).
  await H.sw.evaluate(() => {
    self.__notes = [];
    chrome.notifications = {
      create: async (id, o) => { self.__notes.push({ id, title: o.title, message: o.message }); return id; },
      clear: () => {}, onClicked: { addListener: () => {} }
    };
  });
  const notes = () => H.sw.evaluate(() => self.__notes);

  // ---- 1. scan -> followers check (baseline) ------------------------------
  assert((await cmd("scan")).ok, "scan started");
  let s = await waitScan();
  assert(s.total === 230 && s.nonFollowers === 26, "following scanned (230, 26 non-followers)");
  let f = await waitFol();
  log("  fol:", JSON.stringify({ status: f.status, read: f.read, fans: f.fans, baseline: f.baseline }));
  assert(f.status === "done" && f.baseline, "followers check ran by itself after the scan (baseline)");
  assert(f.read === 209 && f.fans === 5, "209 followers read, 5 of them fans you don't follow back");
  let snap = await H.store("x7.followers");
  assert(snap.ids.length === 209 && snap.fans.length === 5 && snap.fans.every((u) => /^fan_/.test(u.h)), "snapshot saved with the fans' details");
  assert(!(await H.store("x7.fevents")), "no follower events on the first check");
  const fs0 = await H.store("x7.firstSeen");
  assert(Object.keys(fs0).length === 230 && Object.values(fs0).every((t) => t === 0), "first scan marks everyone as followed long ago");
  assert((await H.store("x7.owner")) === "1000", "data belongs to account 1000");
  let logS = await H.store("x7.scanLog");
  assert(logS.length === 1 && logS[0].fg === 230 && logS[0].fl === 209, "scan log has following + exact followers");

  // ---- 2. people leave and arrive; a new follow appears -------------------
  mock.byId.get("2001").fy = false;          // a mutual unfollows you
  mock.byId.get("2002").fy = false;          // another one
  mock.byId.get("9003").fy = false;          // a fan leaves
  mock.users.push({ id: "9100", h: "newfan", n: "New Fan", fy: true, v: false, p: false, d: false, fc: 12, fr: 40, sc: 3, ca: new Date().toUTCString(), b: "hello" });
  mock.byId.set("9100", mock.users[mock.users.length - 1]);
  mock.byHandle.set("newfan", mock.users[mock.users.length - 1]);
  // You followed someone new (not through the extension), who doesn't follow back.
  const nu = { id: "3000", h: "fresh_follow", n: "Fresh Follow", fy: false, v: false, p: false, d: false, fc: 99, fr: 99, sc: 9, ca: new Date().toUTCString(), b: "new" };
  mock.users.unshift(nu); mock.byId.set(nu.id, nu); mock.byHandle.set(nu.h, nu); mock.following.add(nu.id);

  assert((await cmd("scan")).ok, "rescan started");
  s = await waitScan();
  f = await waitFol((x) => x.startedAt > s.startedAt);
  log("  fol2:", f.message);
  assert(f.status === "done" && !f.baseline && f.lost === 3 && f.gained === 1, "3 unfollowed you, 1 new follower");
  const ev = await H.store("x7.fevents");
  const lost = ev.filter((e) => e.k === "lost").map((e) => e.h).sort();
  assert(JSON.stringify(lost) === JSON.stringify(["acct_1", "acct_2", "fan_3"]), "the right people are listed as unfollowing you, with handles");
  assert(ev.find((e) => e.h === "acct_1").fw === true && ev.find((e) => e.h === "fan_3").fw === false, "knows which of them you still follow");
  assert(ev.some((e) => e.k === "gained" && e.h === "newfan"), "new follower recorded");
  assert((await notes()).some((n) => /unfollowed you/.test(n.title)), "notification: people unfollowed you");
  const fs1 = await H.store("x7.firstSeen");
  assert(fs1["3000"] > 0 && fs1["2003"] === 0, "a newly followed account gets a first-seen date");

  // ---- 3. grace period keep rule ------------------------------------------
  let st = await cmd("state");
  const before = st.actionable;
  await H.setStore({ "x7.settings": { speed: "custom", minDelay: 2, maxDelay: 2, restEvery: 0, restMinutes: 1, dailyLimit: 0, notify: true, keepNewDays: 7 } });
  st = await cmd("state");
  assert(st.actionable === before - 1, `grace period keeps the account followed recently (${before} -> ${st.actionable})`);

  // ---- 4. an incomplete followers read is never compared -------------------
  mock.cfg.extraFollowerCount = 400;           // the profile says many more than the list returns
  await H.page("https://x.com/home");          // fresh account info
  await cmd("refreshAccount");
  assert((await cmd("folStart")).ok, "followers check started by hand");
  f = await waitFol((x) => !x.auto);
  log("  fol3:", f.message);
  assert(f.status === "partial", "a read far below the profile's count is marked partial");
  assert((await H.store("x7.fevents")).length === ev.length, "and nothing is compared");
  mock.cfg.extraFollowerCount = 0;
  await cmd("refreshAccount");

  // ---- 5. follow back fans ---------------------------------------------------
  snap = await H.store("x7.followers");
  const targets = snap.fans.slice(0, 2).map((u) => ({ i: u.i, h: u.h, n: u.n, a: u.a }));
  let r = await cmd("run", { source: "followback", targets });
  assert(r.ok && r.total === 2, "follow-back run of 2 started");
  let j = await waitJob();
  assert(j.kind === "follow" && j.done === 2, "2 followed");
  assert(mock.log.create.length === 2 && targets.every((t) => mock.following.has(t.i)), "X saw 2 follows");
  let hist = await H.store("x7.history");
  assert(hist.filter((h) => h.k === "f").length === 2, "History records the follows");
  const fs2 = await H.store("x7.firstSeen");
  assert(targets.every((t) => fs2[t.i] > Date.now() - 600000), "followed accounts are 'followed recently'");
  assert((await notes()).some((n) => n.title === "All done" && /Followed 2 accounts/.test(n.message)), "notification: run finished");
  await cmd("clearJob");

  // ---- 6. unfollow, then re-follow from History -----------------------------
  r = await cmd("run", { source: "ids", ids: ["2009", "2018"] });
  assert(r.ok, "unfollowed 2 to test undo");
  await waitJob();
  await cmd("clearJob");
  let done = await H.store("x7.doneIds");
  assert(done.includes("2009") && done.includes("2018"), "both marked unfollowed");
  hist = await H.store("x7.history");
  const back = hist.filter((h) => !h.k && (h.i === "2009" || h.i === "2018")).map((h) => ({ i: h.i, h: h.h, n: h.n, a: h.a }));
  r = await cmd("run", { source: "refollow", targets: back });
  assert(r.ok && r.total === 2, "re-follow run started");
  j = await waitJob();
  assert(j.done === 2 && mock.following.has("2009") && mock.following.has("2018"), "followed both again");
  done = await H.store("x7.doneIds");
  assert(!done.includes("2009") && !done.includes("2018"), "no longer marked unfollowed");
  r = await cmd("run", { source: "refollow", targets: back });
  assert(!r.ok, "re-following them again is refused: " + r.error);
  await cmd("clearJob");

  // ---- 7. daily limit counts follows, and notifies ---------------------------
  await H.setStore({ "x7.settings": { speed: "custom", minDelay: 2, maxDelay: 2, restEvery: 0, restMinutes: 1, dailyLimit: 8, notify: true } });
  const fans3 = (await H.store("x7.followers")).fans.slice(2, 5).map((u) => ({ i: u.i, h: u.h }));
  r = await cmd("run", { source: "followback", targets: fans3 });
  assert(r.ok, "another follow-back run");
  j = await H.waitFor(async () => { const x = await H.job(); return x.status === "resting" && x.restReason === "daily" ? x : null; }, "daily limit", 60000);
  log("  ledger today:", (await cmd("state")).today);
  assert(j.done === 2, "rests after 2 more: 6 earlier actions + 2 = the limit of 8");
  assert((await notes()).some((n) => n.title === "Daily limit reached"), "notification: daily limit");
  await cmd("stop");
  await cmd("clearJob");

  // ---- 8. per-account data ---------------------------------------------------
  await H.setStore({ "x7.whitelist": ["acct_9"], "x7.settings": { speed: "custom", minDelay: 2, maxDelay: 2, restEvery: 0, restMinutes: 1, dailyLimit: 0 } });
  await H.ctx.addCookies([{ name: "twid", value: "u%3D5555", domain: "x.com", path: "/", secure: true, sameSite: "None" }]);
  await H.page("https://x.com/home");
  r = await cmd("refreshAccount");
  assert(r.ok && r.account.id === "5555", "now signed in as 5555");
  assert((await H.store("x7.owner")) === "5555", "data switched to 5555");
  assert(!(await H.store("x7.whitelist")) && !(await H.store("x7.scan")) && !(await H.store("x7.history")), "5555 starts with no whitelist, scan or history");
  const stash = await H.store("x7.p.1000");
  assert(stash && stash["x7.whitelist"][0] === "acct_9" && stash["x7.scan"].ownerId === "1000", "1000's data is kept aside");
  st = await cmd("state");
  assert(st.profiles["1000"] && st.profiles["5555"], "both accounts are listed");
  assert((await cmd("scan")).ok, "scan as 5555");
  s = await waitScan();
  assert(s.ownerId === "5555", "scan belongs to 5555");
  await waitFol((x) => x.ownerId === "5555");

  // Start a run as 5555, then switch to 1000: the run's account stays loaded.
  await H.setStore({ "x7.settings": { speed: "custom", minDelay: 6, maxDelay: 6, restEvery: 0, restMinutes: 1, dailyLimit: 0 } });
  r = await cmd("run", { source: "ids", ids: ["2003", "2004", "2005", "2006"] });
  assert(r.ok, "run as 5555");
  await H.waitFor(async () => (await H.job()).done >= 1, "first action", 30000);
  await H.ctx.addCookies([{ name: "twid", value: "u%3D1000", domain: "x.com", path: "/", secure: true, sameSite: "None" }]);
  await H.waitFor(async () => (await H.job()).status === "halted", "run halts on the account change", 30000);
  await cmd("refreshAccount");
  assert((await H.store("x7.owner")) === "5555", "no switch while 5555's run is unfinished");
  r = await cmd("scan");
  assert(!r.ok && /isn't finished/.test(r.error), "scanning as 1000 explains why: " + r.error);
  await cmd("stop");
  r = await cmd("refreshAccount");
  assert((await H.store("x7.owner")) === "1000", "after the run is stopped, 1000's data comes back");
  assert((await H.store("x7.whitelist"))[0] === "acct_9" && (await H.store("x7.scan")).ownerId === "1000", "1000's whitelist and scan restored");
  assert((await H.store("x7.p.5555"))["x7.scan"].ownerId === "5555", "5555's data kept aside");
  r = await cmd("profileDelete", { id: "5555" });
  assert(r.ok && !(await H.store("x7.p.5555")) && !(await cmd("state")).profiles["5555"], "an account's saved data can be deleted");
  r = await cmd("profileDelete", { id: "1000" });
  assert(!r.ok, "the account in use can't be deleted that way");

  log("t11 engine: all checks passed");
} catch (e) {
  failed = true;
  console.error(e);
  console.log("SW logs:\n" + H.swLogs.slice(-30).join("\n"));
} finally {
  await H.close();
  process.exit(failed ? 1 : 0);
}
