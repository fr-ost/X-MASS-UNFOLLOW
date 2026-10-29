// Translations: the dashboard and popup in Spanish, Hindi and Arabic (right-to-left),
// the language picker in Settings, and the worker's status messages and plurals.
//   - no static English text is left on any page when a translation exists
//   - nothing overflows sideways (long Hindi/Arabic labels, RTL layout)
//   - Arabic sets dir="rtl", puts the sidebar on the right and keeps the chart LTR
import { boot, log, assert, sleep, OUT } from "./harness.mjs";

const H = await boot();
let failed = false;
const PAGES = ["overview", "following", "followers", "whitelist", "history", "import", "settings", "help", "donate"];

const setLang = async (l) => {
  const p = await H.dashboard("settings");
  await p.evaluate((v) => { localStorage.setItem("x7.lang", v); }, l);
  await p.close();
  const s = (await H.store("x7.settings")) || {};
  await H.setStore({ "x7.settings": Object.assign(s, { lang: l }) });
  await sleep(300);
};

// Visible text that is still English although the dictionary has a translation for it.
const leftovers = (p) => p.evaluate(() => {
  const I = window.X7I18N, out = [];
  if (!I || I.lang === "en") return out;
  const norm = (s) => String(s).replace(/\s+/g, " ").trim();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const k = norm(n.nodeValue), el = n.parentElement;
    if (!k || !el || el.closest("[hidden], script, style, code, [data-no-i18n]")) continue;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    if (I.has(k) && I.t(k) !== k) out.push(k);
  }
  for (const el of document.querySelectorAll("[placeholder], [title], [aria-label]")) {
    for (const a of ["placeholder", "title", "aria-label"]) {
      const k = norm(el.getAttribute(a) || "");
      if (k && I.has(k) && I.t(k) !== k) out.push(a + ": " + k);
    }
  }
  return [...new Set(out)];
});

// Elements whose text is cut off or pushes the page wider than the window.
const overflow = (p) => p.evaluate(() => {
  const bad = [];
  if (document.documentElement.scrollWidth > innerWidth + 1) bad.push("page is " + document.documentElement.scrollWidth + "px wide");
  for (const el of document.querySelectorAll(".btn, .pill, .chips button, .seg button, .nav a, .kpi span, .stat span, .tag, .preset b")) {
    const r = el.getBoundingClientRect();
    if (!r.width || el.closest("[hidden]")) continue;
    if (el.scrollWidth > el.clientWidth + 2) bad.push((el.id || el.className || el.tagName) + ": " + el.textContent.trim().slice(0, 40));
  }
  return bad;
});

try {
  await H.page("https://x.com/home");
  await sleep(800);

  // ---- Spanish: pages, popup and worker messages ----------------------------
  await setLang("es");
  const d = await H.dashboard("overview");
  await d.waitForSelector(".nav");
  assert(await d.evaluate(() => document.documentElement.lang) === "es", "html lang is es");
  assert(/Resumen/.test(await d.textContent('.nav a[data-route="overview"]')), "nav is in Spanish");
  assert(/Seguidores/.test(await d.textContent('.nav a[data-route="followers"]')), "Followers nav in Spanish");

  // a scan, so lists, chips and counters have content
  await d.click("#ovScanBtn");
  const scan = await H.waitFor(async () => { const s = await H.scan(); return s && s.status === "done" ? s : null; }, "scan", 90000);
  assert(/^(Escaneo completado\.|Leídas \d)/.test(scan.message || "") || /Escaneo/.test(scan.message || ""), "worker wrote the scan message in Spanish: " + scan.message);
  await sleep(1500);

  for (const pg of PAGES) {
    await d.goto(d.url().replace(/#.*$/, "#" + pg));
    await d.waitForSelector(`.page[data-page="${pg}"].is-on`);
    await sleep(500);
    const left = await leftovers(d);
    if (left.length) log("  English left on", pg, JSON.stringify(left));
    assert(!left.length, `es: no English left on ${pg}`);
    const of = await overflow(d);
    if (of.length) log("  overflow on", pg, JSON.stringify(of));
    assert(!of.length, `es: nothing overflows on ${pg}`);
  }
  await d.goto(d.url().replace(/#.*$/, "#following"));
  await d.waitForSelector(".row");
  await d.screenshot({ path: OUT + "/i1-es-following.png" });

  const p = await H.popup();
  await p.waitForSelector("#statusText");
  await sleep(800);
  const pl = await leftovers(p);
  if (pl.length) log("  popup English", JSON.stringify(pl));
  assert(!pl.length, "es: popup has no English left");
  assert(!(await overflow(p)).length, "es: popup has no overflow");
  await p.screenshot({ path: OUT + "/i2-es-popup.png" });
  await p.close();

  // plurals in the worker
  const plural = await H.sw.evaluate(() => [TN(1, "{n} follower", "{n} followers"), TN(3, "{n} follower", "{n} followers")]);
  assert(plural[0] === "1 seguidor" && plural[1] === "3 seguidores", "worker plurals in Spanish: " + plural.join(" / "));

  // ---- Hindi: longest strings -------------------------------------------------
  await setLang("hi");
  for (const pg of PAGES) {
    await d.goto(d.url().replace(/#.*$/, "#" + pg));
    await d.reload();
    await d.waitForSelector(`.page[data-page="${pg}"].is-on`);
    await sleep(400);
    const of = await overflow(d);
    if (of.length) log("  overflow on", pg, JSON.stringify(of));
    assert(!of.length, `hi: nothing overflows on ${pg}`);
    assert(!(await leftovers(d)).length, `hi: no English left on ${pg}`);
  }
  const ph = await H.popup();
  await ph.waitForSelector("#statusText");
  await sleep(600);
  assert(!(await overflow(ph)).length, "hi: popup has no overflow");
  await ph.screenshot({ path: OUT + "/i3-hi-popup.png" });
  await ph.close();

  // ---- Portuguese, Indonesian, Turkish: every page and the popup ---------------
  for (const l of ["pt", "id", "tr"]) {
    await setLang(l);
    for (const pg of PAGES) {
      await d.goto(d.url().replace(/#.*$/, "#" + pg));
      await d.reload();
      await d.waitForSelector(`.page[data-page="${pg}"].is-on`);
      await sleep(300);
      const of = await overflow(d);
      if (of.length) log("  overflow on", pg, JSON.stringify(of));
      assert(!of.length, `${l}: nothing overflows on ${pg}`);
      const left = await leftovers(d);
      if (left.length) log("  English left on", pg, JSON.stringify(left));
      assert(!left.length, `${l}: no English left on ${pg}`);
    }
    const pp = await H.popup();
    await pp.waitForSelector("#statusText");
    await sleep(500);
    assert(!(await overflow(pp)).length && !(await leftovers(pp)).length, `${l}: popup has no overflow and no English left`);
    await pp.close();
  }

  // ---- Arabic: right to left -----------------------------------------------------
  await setLang("ar");
  await d.goto(d.url().replace(/#.*$/, "#overview"));
  await d.reload();
  await d.waitForSelector(".nav");
  assert(await d.evaluate(() => document.documentElement.dir) === "rtl", "Arabic sets dir=rtl");
  const side = await d.evaluate(() => { const r = document.querySelector(".side").getBoundingClientRect(); return { l: r.left, w: innerWidth }; });
  assert(side.l > side.w / 2, "sidebar is on the right");
  assert(await d.evaluate(() => getComputedStyle(document.querySelector(".chart svg") || document.body).direction) !== "rtl" || !(await d.$(".chart svg")), "chart keeps left-to-right time");
  for (const pg of PAGES) {
    await d.goto(d.url().replace(/#.*$/, "#" + pg));
    await d.waitForSelector(`.page[data-page="${pg}"].is-on`);
    await sleep(400);
    const of = await overflow(d);
    if (of.length) log("  overflow on", pg, JSON.stringify(of));
    assert(!of.length, `ar: nothing overflows on ${pg}`);
    assert(!(await leftovers(d)).length, `ar: no English left on ${pg}`);
  }
  await d.goto(d.url().replace(/#.*$/, "#overview"));
  await sleep(600);
  await d.screenshot({ path: OUT + "/i4-ar-overview.png" });
  await d.goto(d.url().replace(/#.*$/, "#following"));
  await d.waitForSelector(".row");
  await d.click(".row .cb");
  await d.waitForSelector("#bulk:not([hidden])");
  await sleep(500);
  const bulk = await d.evaluate(() => { const b = document.querySelector("#bulk").getBoundingClientRect(), s = document.querySelector(".side").getBoundingClientRect(); return { l: b.left, r: b.right, side: s.left }; });
  assert(bulk.r <= bulk.side + 1 && bulk.l >= 0, "bulk bar sits in the content area, clear of the right-hand sidebar");
  await d.screenshot({ path: OUT + "/i5-ar-following.png" });
  const pa = await H.popup();
  await pa.waitForSelector("#statusText");
  await sleep(600);
  assert(await pa.evaluate(() => document.documentElement.dir) === "rtl", "popup is right-to-left");
  assert(!(await overflow(pa)).length, "ar: popup has no overflow");
  await pa.screenshot({ path: OUT + "/i6-ar-popup.png" });
  await pa.close();
  const arPl = await H.sw.evaluate(() => [1, 2, 5, 11, 100].map((n) => TN(n, "{n} follower", "{n} followers")));
  assert(arPl[0] === "متابِع واحد" && arPl[1] === "متابِعان" && /^5 /.test(arPl[2]) && /^11 /.test(arPl[3]), "Arabic plural forms: " + arPl.join(" | "));

  // ---- the picker in Settings ------------------------------------------------------
  await d.goto(d.url().replace(/#.*$/, "#settings"));
  await d.waitForSelector("#langSel");
  await Promise.all([d.waitForEvent("load"), d.selectOption("#langSel", "tr")]);
  await d.waitForSelector(".nav");
  assert(await d.evaluate(() => document.documentElement.lang) === "tr" && /Genel bakış/.test(await d.textContent('.nav a[data-route="overview"]')), "choosing Türkçe reloads the page in Turkish");
  assert(((await H.store("x7.settings")) || {}).lang === "tr", "the worker is told about the language too");
  await Promise.all([d.waitForEvent("load"), d.selectOption("#langSel", "auto")]);
  await d.waitForSelector(".nav");
  assert(await d.evaluate(() => document.documentElement.lang) === "en" && /Overview/.test(await d.textContent('.nav a[data-route="overview"]')), "Automatic goes back to the browser language (English here)");
  assert(await H.sw.evaluate(() => T("Scan complete.")) === "Scan complete.", "worker back to English");
} catch (e) {
  failed = true;
  log("FAIL", e.stack || e.message);
} finally {
  await H.close();
  log(failed ? "t13 FAILED" : "t13 passed");
  process.exit(failed ? 1 : 0);
}
