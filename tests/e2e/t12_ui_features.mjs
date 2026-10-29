// Dashboard + popup for the 7.3.2 features:
//   Followers page (unfollowed you / new followers / don't follow back, follow back),
//   History (unfollowed / followed tabs, "Follow again"), saved groups, More filters,
//   Settings (grace period, followers tracking, notifications, X accounts),
//   the growth chart, the Overview cards and the popup's "unfollowed you" line.
import { boot, log, assert, sleep, OUT } from "./harness.mjs";

const H = await boot({ fans: 5 });
const { mock } = H;
let failed = false;
const waitScan = () => H.waitFor(async () => { const s = await H.scan(); return s && s.status === "done" ? s : null; }, "scan", 90000);
const waitFol = (after) => H.waitFor(async () => { const f = await H.store("x7.fol"); return f && f.status !== "running" && (!after || f.startedAt > after) ? f : null; }, "followers check", 120000);
const waitJob = () => H.waitFor(async () => { const j = await H.job(); return j && j.status === "done" ? j : null; }, "run", 120000);
const rows = (p, sel) => p.$$eval(sel, (r) => r.length);

try {
  await H.page("https://x.com/home");
  await sleep(1000);
  await H.setStore({ "x7.settings": { speed: "custom", minDelay: 2, maxDelay: 2, restEvery: 0, restMinutes: 1, dailyLimit: 0 } });

  const d = await H.dashboard("followers");
  await d.waitForSelector('.page[data-page="followers"].is-on');
  await d.waitForSelector("#foEmpty:not([hidden])");
  assert(/Scan now/.test(await d.textContent("#foEmptyGo")), "Followers page explains itself before any scan");
  await d.screenshot({ path: OUT + "/u1-followers-empty.png" });

  // baseline scan + followers check
  await d.click("#foEmptyGo");
  const s1 = await waitScan();
  await waitFol();
  await d.goto(d.url().replace(/#.*$/, "#followers"));
  await d.waitForSelector("#foBody:not([hidden])");
  assert((await d.textContent("#cFans")) === "5", "5 people you don't follow back");
  assert((await d.textContent("#cLost")) === "0", "nobody unfollowed yet");

  // changes, then a rescan from the Following page
  mock.byId.get("2001").fy = false;
  mock.byId.get("2002").fy = false;
  mock.byId.get("9003").fy = false;
  const nf = { id: "9100", h: "newfan", n: "New Fan", fy: true, v: false, p: false, d: false, fc: 12, fr: 40, sc: 3, ca: new Date().toUTCString(), b: "hello there" };
  mock.users.push(nf); mock.byId.set(nf.id, nf); mock.byHandle.set(nf.h, nf);
  await d.goto(d.url().replace(/#.*$/, "#following"));
  await d.click("#flScan");
  const s2 = await H.waitFor(async () => { const s = await H.scan(); return s && s.status === "done" && s.startedAt > s1.startedAt ? s : null; }, "rescan", 90000);
  await waitFol(s2.startedAt);
  await sleep(800);

  // Overview cards
  await d.goto(d.url().replace(/#.*$/, "#overview"));
  await d.waitForSelector("#lostFeed li");
  assert((await rows(d, "#lostFeed li")) === 3, "Overview lists the 3 who unfollowed");
  assert(/−3/.test(await d.textContent("#kFollowersSub")) && /\+1/.test(await d.textContent("#kFollowersSub")), "Followers card shows −3 · +1 since last check");
  assert((await d.textContent("#navLost")) === "3", "sidebar badge shows 3");
  await d.screenshot({ path: OUT + "/u2-overview.png" });

  // Followers page: unfollowed you
  await d.click('a[data-route="followers"]');
  await d.waitForSelector("#foRows .row");
  assert((await rows(d, "#foRows .row")) === 3, "Unfollowed you: 3 rows");
  const enabled = await d.$$eval("#foRows .rowcb:not([disabled])", (c) => c.length);
  assert(enabled === 2, "only the 2 you still follow can be selected to unfollow");
  await d.screenshot({ path: OUT + "/u3-followers-lost.png" });
  await d.click('#foSeg button[data-f="gained"]');
  await sleep(300);
  assert((await rows(d, "#foRows .row")) === 1 && /newfan/.test(await d.textContent("#foRows")), "New followers: newfan");

  // Fans: follow back 2
  await d.click('#foSeg button[data-f="fans"]');
  await sleep(300);
  assert((await rows(d, "#foRows .row")) === 5, "You don't follow back: 5 (4 old fans + newfan)");
  const cbs = await d.$$("#foRows .rowcb:not([disabled])");
  await cbs[0].check(); await cbs[1].check();
  await d.waitForSelector("#foBulk:not([hidden])");
  assert(/Follow back/.test(await d.textContent("#foBulkRun")), "bulk action reads Follow back");
  await d.screenshot({ path: OUT + "/u4-followers-fans.png" });
  await d.click("#foBulkRun");
  await d.waitForSelector("#confirm:not([hidden])");
  assert(/Follow 2 accounts\?/.test(await d.textContent("#cfTitle")), "confirm: Follow 2 accounts?");
  await d.click("#cfOk");
  let j = await waitJob();
  assert(j.kind === "follow" && j.done === 2 && mock.log.create.length === 2, "followed back 2");
  await d.waitForSelector('.page[data-page="overview"].is-on');
  await sleep(600);
  assert(/followed/.test(await d.textContent("#rpTotal")), "run panel speaks of follows");
  await d.screenshot({ path: OUT + "/u5-overview-follow-run.png" });
  await d.click("#rpClear");
  await d.goto(d.url().replace(/#.*$/, "#followers"));
  await d.click('#foSeg button[data-f="fans"]');
  await sleep(500);
  assert((await rows(d, "#foRows .row")) === 3, "the 2 followed back leave the list");

  // History: unfollow 2, then follow them again from History
  await H.cmdPage?.close?.();
  const ext = await H.page(`chrome-extension://${H.extId}/privacy.html`);
  let r = await ext.evaluate(() => chrome.runtime.sendMessage({ cmd: "run", source: "ids", ids: ["2009", "2018"] }));
  assert(r.ok, "unfollowed 2 to test History");
  await waitJob();
  await ext.evaluate(() => chrome.runtime.sendMessage({ cmd: "clearJob" }));
  await d.goto(d.url().replace(/#.*$/, "#history"));
  await d.waitForSelector("#hiList .hi-row");
  assert((await d.textContent("#hiCountU")) === "2" && (await d.textContent("#hiCountF")) === "2", "History: 2 unfollowed, 2 followed");
  await d.check("#hiAll");
  await d.waitForSelector("#hiBulk:not([hidden])");
  assert(/2 selected/.test(await d.textContent("#hiBulkCount")), "select all picks both");
  await d.screenshot({ path: OUT + "/u6-history.png" });
  await d.click("#hiBulkRun");
  await d.waitForSelector("#confirm:not([hidden])");
  await d.click("#cfOk");
  j = await waitJob();
  assert(j.source === "refollow" && j.done === 2 && mock.following.has("2009"), "followed both again from History");
  await ext.evaluate(() => chrome.runtime.sendMessage({ cmd: "clearJob" }));
  await d.goto(d.url().replace(/#.*$/, "#history"));
  await d.waitForSelector("#hiList .hi-row");
  await sleep(400);
  assert(/Followed again/.test(await d.textContent("#hiList")), "unfollow entries are tagged Followed again");
  assert(await d.$eval("#hiAll", (c) => c.disabled), "nothing left to follow again");
  await d.click('#hiSeg button[data-k="f"]');
  await sleep(300);
  assert((await rows(d, "#hiList .hi-row")) === 4, "Followed tab lists the 4 follows");

  // Groups + More filters on Following
  await d.goto(d.url().replace(/#.*$/, "#following"));
  await d.waitForSelector("#flRows .row");
  await d.click('#flSeg button[data-f="all"]');
  await sleep(300);
  const pick = await d.$$("#flRows .rowcb:not([disabled])");
  for (const cb of pick.slice(0, 4)) await cb.check();
  await d.click("#bulkGroup");
  await d.waitForSelector("#groupAsk:not([hidden])");
  await d.fill("#groupName", "Test group");
  await d.screenshot({ path: OUT + "/u7-save-group.png" });
  await d.click("#groupOk");
  await H.waitFor(async () => ((await H.store("x7.groups")) || []).length === 1, "group saved", 5000);
  const g = (await H.store("x7.groups"))[0];
  assert(g.name === "Test group" && g.ids.length === 4, "group of 4 saved");
  await d.click("#bulkClear");
  await d.selectOption("#flGroup", g.id);
  await sleep(400);
  assert((await rows(d, "#flRows .row")) === 4 && !(await d.$eval("#flGroupBar", (e) => e.hidden)), "Group menu shows just the 4, with the group bar");
  await d.screenshot({ path: OUT + "/u8-group.png" });
  await d.click("#grpDelete");
  await d.waitForSelector("#confirm:not([hidden])");
  await d.click("#cfOk");
  await H.waitFor(async () => ((await H.store("x7.groups")) || []).length === 0, "group deleted", 5000);
  await sleep(400);
  assert((await d.$eval("#flGroup", (e) => e.hidden)), "group menu hides when there are no groups");

  await d.click("#flFiltersBtn");
  await d.waitForSelector("#flFilters:not([hidden])");
  const allRows = await d.textContent("#cAll");
  await d.fill("#fMinFc", "4000");
  await sleep(600);
  const big = await d.$$eval("#flRows .row .fc-cell", (c) => c.map((x) => x.textContent));
  assert(big.length > 0 && big.every((x) => /K$/.test(x) && parseFloat(x) >= 4), `"Followers at least 4000" keeps only big accounts (${big.length})`);
  assert((await d.textContent("#flFiltersN")) === "1", "filter count badge shows 1");
  await d.fill("#fBioIn", "founder");
  await sleep(600);
  const bios = await d.$$eval("#flRows .row .bio", (b) => b.map((x) => x.textContent));
  assert(bios.length > 0 && bios.every((b) => /Founder/i.test(b)), "bio contains filter");
  await d.screenshot({ path: OUT + "/u9-filters.png" });
  await d.selectOption("#fScript", "arabic");
  await sleep(600);
  assert((await rows(d, "#flRows .row")) === 0 && /match/.test(await d.textContent("#flNone")), "writing system filter: no Arabic accounts here");
  await d.click("#fClear");
  await sleep(500);
  assert((await d.textContent("#cAll")) === allRows && (await rows(d, "#flRows .row")) > 30, "Clear filters restores the list");

  // Settings
  await d.goto(d.url().replace(/#.*$/, "#settings"));
  await d.waitForSelector("#acctList .acct");
  assert(/Current/.test(await d.textContent("#acctList")), "X accounts lists the current account");
  await d.fill("#keepNewDays", "5");
  await sleep(900);
  assert((await H.store("x7.settings")).keepNewDays === 5, "grace period saved");
  await d.click("#trackFollowers");
  await sleep(900);
  assert((await H.store("x7.settings")).trackFollowers === false, "followers tracking can be turned off");
  // Chrome's permission prompt can't be answered in a test: grant it here.
  await d.evaluate(() => { chrome.permissions.request = async () => true; });
  await d.click("#notifyToggle");
  await H.waitFor(async () => (await H.store("x7.settings")).notify === true, "notify on", 5000);
  assert(true, "notifications turn on after Chrome's permission");
  await d.evaluate(() => { chrome.permissions.request = async () => false; });
  await d.click("#notifyToggle");
  await sleep(600);
  await d.click("#notifyToggle");
  await sleep(600);
  assert(!(await d.$eval("#notifyToggle", (c) => c.checked)) && (await H.store("x7.settings")).notify === false, "refused permission leaves them off");
  await d.screenshot({ path: OUT + "/u10-settings.png", fullPage: true });

  // Chart: seed a few weeks of scans
  const now = Date.now(), DAY = 864e5;
  const seeded = Array.from({ length: 8 }, (_, i) => ({ t: now - (56 - i * 7) * DAY, fg: 260 - i * 4, fl: 180 + i * 4, nf: 40 - i * 2, mu: 220 - i * 2 }));
  await H.setStore({ "x7.scanLog": seeded });
  await d.goto(d.url().replace(/#.*$/, "#overview"));
  await d.waitForSelector("#chart svg");
  assert((await d.$$eval("#chart svg path.line", (p) => p.length)) === 2, "two small multiples (following, followers)");
  const box = await d.$eval("#chart svg", (s) => { const r = s.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await d.mouse.move(box.x + box.w * 0.6, box.y + box.h * 0.4);
  await sleep(200);
  assert(!(await d.$eval(".chart-tip", (e) => e.hidden)) && /Following/.test(await d.textContent(".chart-tip")), "hover shows a tooltip with both values");
  assert((await d.$$eval("#chart table.sr-only tr", (r) => r.length)) === 9, "the numbers are also in a table");
  await d.screenshot({ path: OUT + "/u11-chart.png" });
  await (await d.$(".chart-card")).screenshot({ path: OUT + "/u11b-chart-card.png" });
  for (const theme of ["dark"]) {
    await d.evaluate((tt) => localStorage.setItem("x7.theme", tt), theme);
    await d.reload();
    await d.waitForSelector("#chart svg");
    await sleep(500);
    await d.screenshot({ path: OUT + `/u12-overview-${theme}.png` });
    await d.goto(d.url().replace(/#.*$/, "#followers"));
    await d.waitForSelector("#foRows .row");
    await d.screenshot({ path: OUT + `/u13-followers-${theme}.png` });
    await d.evaluate(() => localStorage.setItem("x7.theme", "light"));
  }

  // Popup: who unfollowed you
  const pop = await H.popup();
  await pop.waitForSelector('[data-view="ready"].is-on');
  await pop.waitForSelector("#lostLine:not([hidden])");
  assert(/3 people unfollowed you/.test(await pop.textContent("#lostText")), "popup: 3 people unfollowed you");
  const fits = await pop.evaluate(() => { const st = document.querySelector("#stage"); return st.scrollHeight - st.clientHeight; });
  assert(fits <= 2, "popup still fits with the line (" + fits + ")");
  await pop.screenshot({ path: OUT + "/u14-popup-lost.png" });

  // Narrow window: no sideways scroll on the new pages
  const n = await H.dashboard("followers");
  await n.setViewportSize({ width: 760, height: 900 });
  await n.waitForSelector("#foRows .row");
  await sleep(500);
  for (const page of ["followers", "history", "following", "settings", "overview"]) {
    await n.goto(n.url().replace(/#.*$/, "#" + page));
    await sleep(500);
    if (page === "following") { await n.click("#flFiltersBtn"); await sleep(300); }
    const over = await n.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert(!over, `no horizontal overflow at 760px on ${page}`);
  }
  await n.screenshot({ path: OUT + "/u15-narrow-overview.png" });
  log("t12 ui features: all checks passed");
} catch (e) {
  failed = true;
  console.error(e);
  console.log("SW logs:\n" + H.swLogs.slice(-30).join("\n"));
} finally {
  await H.close();
  process.exit(failed ? 1 : 0);
}
