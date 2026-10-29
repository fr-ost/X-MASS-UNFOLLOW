// Review prompt: when the daily limit pauses a run, or when a run finishes.
//   - shown once per moment (popup or dashboard, never both)
//   - not after a stopped run, a run that unfollowed nobody, or a short break
//   - after any ask ("Maybe later" or no answer): not again for 3 days; 3 asks at most
//   - "Leave a review" opens the store's review page and never asks again;
//     so does the "Rate it" card on the Donate page, and "Don't ask again"
import { boot, log, assert, sleep, OUT } from "./harness.mjs";

const H = await boot({ reviewPrompt: true });
let failed = false;
const DAY = 864e5;
const job = (id, o = {}) => ({
  id, status: "done", source: "nonfollowers", ownerId: "1000", total: 40, index: 40, done: 38, skipped: 2, failed: 0,
  startedAt: Date.now() - 3600e3, finishedAt: Date.now(), message: "Finished. Unfollowed 38 accounts.", log: [], ...o
});
const review = () => H.store("x7.review");
const sheetUp = (p) => p.$eval("#rateSheet", (e) => !e.hidden);
const daily = (id, day, o = {}) => job(id, {
  status: "resting", restReason: "daily", restUntil: Date.now() + 20 * 3600e3 + day * DAY, total: 1500, index: 400, done: 400, skipped: 0,
  finishedAt: null, message: "Daily limit of 400 reached. Continues automatically at 9:41 AM.", ...o
});
async function popupFor(j) {
  await H.setStore({ "x7.job": j });
  const p = await H.popup();
  await p.waitForSelector(`[data-view="${j.status === "done" || j.status === "stopped" ? "done" : "run"}"].is-on`, { timeout: 10000 });
  await sleep(1300);
  return p;
}

try {
  // ---- not after a stopped run, or a run that unfollowed nobody ----------
  let p = await popupFor(job("stopped1", { status: "stopped" }));
  assert(!(await sheetUp(p)), "no prompt after a stopped run");
  await p.close();
  p = await popupFor(job("zero1", { done: 0 }));
  assert(!(await sheetUp(p)), "no prompt after a run that unfollowed nobody");
  await p.close();
  assert(!(await review()), "nothing recorded yet");

  // ---- first successful run: asked once -----------------------------------
  p = await popupFor(job("run1"));
  assert(await sheetUp(p), "prompt shown after a successful run");
  assert((await p.textContent("#rateTitle")) === "Saved you 2 hours of clicking?", "title copy");
  assert(/Leave a 5-star review so we can keep this tool 100% free forever\./.test(await p.textContent("#rateSheet p")), "body copy");
  const fits = await p.evaluate(() => { const r = document.querySelector("#rateSheet .sheet").getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.top >= 0; });
  assert(fits, "sheet fits inside the popup");
  await p.screenshot({ path: OUT + "/rv1-popup.png" });
  await p.click("#rateLater");
  await sleep(300);
  let r = await review();
  assert(r.state === "later" && r.job === "run1" && r.asks === 1, "Maybe later is remembered");
  await p.close();

  p = await popupFor(job("run1"));
  assert(!(await sheetUp(p)), "same run never asks twice");
  await p.close();
  p = await popupFor(job("run2"));
  assert(!(await sheetUp(p)), "a new run within 3 days of 'Maybe later' doesn't ask");
  await p.close();

  // ---- 3+ days later, a new run asks again; leaving a review ends it --------
  await H.setStore({ "x7.review": { ...(await review()), at: Date.now() - 4 * DAY } });
  p = await popupFor(job("run3"));
  assert(await sheetUp(p), "asks again after a later run, 3+ days on");
  // The test browser is offline, so record the address the popup asks Chrome to open.
  await p.evaluate(() => {
    window.__opened = [];
    const create = chrome.tabs.create.bind(chrome.tabs);
    chrome.tabs.create = (o) => { window.__opened.push(o.url); return create(o); };
  });
  const tabP = H.ctx.waitForEvent("page", { timeout: 8000 });
  await p.click("#rateGo");
  const tab = await tabP;
  const storeUrl = (await p.evaluate(() => window.__opened)).join(" ");
  log("  opened:", storeUrl);
  assert(/^https:\/\/chromewebstore\.google\.com\/detail\/[^/]+\/[a-p]{32}\/reviews$/.test(storeUrl), "Leave a review opens the store's review page");
  assert(await p.$eval("#rateSheet", (e) => e.hidden), "sheet closes");
  await tab.close();
  r = await review();
  assert(r.state === "rated", "clicking Leave a review is recorded as reviewed");
  await p.close().catch(() => {});

  for (const id of ["run4", "run5"]) {
    await H.setStore({ "x7.review": { ...(await review()), at: Date.now() - 30 * DAY } });
    p = await popupFor(job(id));
    assert(!(await sheetUp(p)), `never asks again once reviewed (${id})`);
    await p.close();
  }

  // ---- dashboard: asks when the run finishes there; Don't ask again --------
  await H.setStore({ "x7.review": null });
  await H.setStore({ "x7.job": job("dash1") });
  const d = await H.dashboard("overview");
  await d.waitForSelector("#rateAsk:not([hidden])", { timeout: 8000 });
  assert(true, "dashboard asks after a successful run");
  await sleep(500);
  await d.screenshot({ path: OUT + "/rv2-dashboard.png" });
  // the popup opened now must not ask about the same run again
  p = await popupFor(job("dash1"));
  assert(!(await sheetUp(p)), "popup doesn't repeat a prompt the dashboard already showed");
  await p.close();
  await d.click("#rateAskNever");
  await sleep(300);
  assert(await d.$eval("#rateAsk", (e) => e.hidden), "dialog closes");
  assert((await review()).state === "no", "Don't ask again is remembered");
  await H.setStore({ "x7.review": { ...(await review()), at: Date.now() - 30 * DAY } });
  p = await popupFor(job("dash2"));
  assert(!(await sheetUp(p)), "never asks after Don't ask again");
  await p.close();

  // ---- reviewing from the Donate page's "Rate it" card counts too -------------------------------------
  await H.setStore({ "x7.job": job("dash2", { status: "stopped" }), "x7.review": null });
  await d.goto(d.url().replace(/#.*$/, "#donate"));
  await sleep(800);
  const helpTab = H.ctx.waitForEvent("page", { timeout: 8000 });
  await d.click("#rateLink");
  (await helpTab).close();
  await sleep(300);
  assert((await review()).state === "rated", "Rate it on the Donate page counts as reviewed");
  p = await popupFor(job("help1"));
  assert(!(await sheetUp(p)), "no prompt after reviewing from the Donate page");
  await p.close();

  // ---- at most 3 asks -------------------------------------------------------
  await H.setStore({ "x7.review": { state: "later", job: "old", asks: 3, at: Date.now() - 30 * DAY } });
  p = await popupFor(job("cap1"));
  assert(!(await sheetUp(p)), "stops after 3 asks");
  await p.close();

  // ---- daily limit: big runs take days, so ask when the limit pauses one ----
  await H.setStore({ "x7.review": null });
  p = await popupFor(daily("big1", 0));
  assert(await sheetUp(p), "asks when the daily limit pauses a run");
  await p.screenshot({ path: OUT + "/rv3-daily.png" });
  await p.click("#rateLater");
  await sleep(300);
  r = await review();
  assert(r.state === "later" && r.job.startsWith("big1:daily:") && r.asks === 1, "the daily-limit ask is remembered");
  await p.close();
  p = await popupFor(daily("big1", 0));
  assert(!(await sheetUp(p)), "same daily pause never asks twice");
  await p.close();
  p = await popupFor(daily("big1", 1));
  assert(!(await sheetUp(p)), "the next day's limit, within 3 days, doesn't ask");
  await p.close();
  p = await popupFor(job("big1"));
  assert(!(await sheetUp(p)), "the run finishing within 3 days doesn't ask");
  await p.close();

  await H.setStore({ "x7.review": { ...(await review()), at: Date.now() - 4 * DAY } });
  p = await popupFor(daily("big1", 4));
  assert(await sheetUp(p), "asks again at a daily limit 3+ days on");
  await p.close();                                            // closed without an answer
  r = await review();
  assert(r.asks === 2, "an unanswered ask still counts");
  p = await popupFor(daily("big1", 5));
  assert(!(await sheetUp(p)), "an unanswered ask also waits 3 days (no daily nagging)");
  await p.close();

  await H.setStore({ "x7.review": null });
  p = await popupFor(daily("big2", 0, { restReason: "cooldown" }));
  assert(!(await sheetUp(p)), "no prompt on a short break");
  await p.close();
  p = await popupFor(daily("big2", 0, { done: 0 }));
  assert(!(await sheetUp(p)), "no prompt at a daily limit with nothing unfollowed by this run");
  await p.close();

  // dashboard open at the daily limit
  await d.goto(d.url().replace(/#.*$/, "#overview"));
  await H.setStore({ "x7.job": daily("big3", 0) });
  await d.reload();
  await d.waitForSelector("#rateAsk:not([hidden])", { timeout: 8000 });
  assert(true, "dashboard asks at the daily limit");
  await d.click("#rateAskLater");
  await H.setStore({ "x7.job": job("big3", { status: "stopped" }) });
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await H.close();
  process.exit(failed ? 1 : 0);
}
