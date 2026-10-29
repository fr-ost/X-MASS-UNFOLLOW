// Lists every interface string that needs a translation:
//   - static text of dashboard.html / popup.html, normalised exactly the way
//     shared/i18n.js looks it up (mixed-markup elements by their inner HTML)
//   - t()/tn()/T()/TN() calls in the scripts
// Usage: PLAYWRIGHT=... node tools/i18n-extract.mjs > tools/i18n-strings.json
import fs from "fs";
import path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");

const out = { html: [], js: [], plural: [] };
const add = (arr, s) => { if (s && !arr.includes(s)) arr.push(s); };

// ---- JS ---------------------------------------------------------------
const STR = String.raw`"((?:[^"\\]|\\.)*)"`;
const unq = (s) => JSON.parse('"' + s + '"');
for (const f of ["dashboard.js", "popup.js", "ui/common.js", "background.js"]) {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8");
  for (const m of src.matchAll(new RegExp(String.raw`(?<![\w$.])(?:t|T|U\.t)\(\s*` + STR, "g"))) add(out.js, unq(m[1]));
  for (const m of src.matchAll(new RegExp(String.raw`(?<![\w$.])(?:tn|TN|U\.tn)\(\s*[^,]+?,\s*` + STR + String.raw`\s*,\s*` + STR, "g"))) {
    const one = unq(m[1]), other = unq(m[2]);
    if (!out.plural.some((p) => p.other === other)) out.plural.push({ one, other });
  }
}
// Reasons the worker stores in English and the dashboard translates with t(r.w).
for (const w of ["Account not found", "X didn't return this profile's posts", "Posts are hidden", "Account unavailable", "No recent post could be read", "Unavailable"]) add(out.js, w);
// Reasons the page scripts send back in English; the engine passes them through T().
for (const w of ["rate limited", "account locked", "account suspended", "not signed in", "session token mismatch - reload x.com",
  "account not found", "follow request already sent", "this account blocked you", "action limit", "Network error talking to X.",
  "X rejected the follow request.", "X rejected the unfollow request.", "not on the profile yet", "already not following",
  "account unavailable", "the profile did not finish loading", "the confirmation did not open", "X says to slow down",
  "X did not confirm the unfollow", "X did not confirm the follow", "no handle", "couldn't open a tab", "the profile page didn't load",
  "The X tab did not answer.", "No answer from the X tab.", "no result"]) add(out.js, w);

// ---- HTML -------------------------------------------------------------
const browser = await chromium.launch();
const page = await browser.newPage();
for (const f of ["dashboard.html", "popup.html"]) {
  const html = fs.readFileSync(path.join(ROOT, f), "utf8").replace(/<script\b[\s\S]*?<\/script>/g, "");
  await page.setContent(html);
  const keys = await page.evaluate(() => {
    const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "CODE", "SVG", "svg", "NOSCRIPT"]);
    const INLINE = new Set(["B", "STRONG", "EM", "I", "A", "KBD", "SPAN", "SMALL", "BR", "CODE"]);
    const norm = (s) => String(s).replace(/\s+/g, " ").trim();
    const found = [];
    const isMixed = (el) => {
      let text = false, inline = false;
      for (const n of el.childNodes) {
        if (n.nodeType === 3) { if (n.nodeValue.trim()) text = true; }
        else if (n.nodeType === 1) {
          if (!INLINE.has(n.tagName) || n.hasAttribute("id") || n.hasAttribute("data-icon")) return false;
          inline = true;
        }
      }
      return text && inline;
    };
    const walk = (el) => {
      if (!el || el.nodeType !== 1 || SKIP.has(el.tagName) || el.hasAttribute("data-no-i18n")) return;
      for (const a of ["placeholder", "title", "aria-label", "alt", "data-tip"]) { const v = el.getAttribute(a); if (v && norm(v)) found.push(norm(v)); }
      if (isMixed(el)) { found.push(norm(el.innerHTML)); return; }
      for (const n of el.childNodes) {
        if (n.nodeType === 3) { const k = norm(n.nodeValue); if (k && /[A-Za-z]/.test(k)) found.push(k); }
        else if (n.nodeType === 1) walk(n);
      }
    };
    if (document.title) found.push(norm(document.title));
    walk(document.body);
    return found;
  });
  for (const k of keys) add(out.html, k);
}
await browser.close();
// Keys that are not words (numbers, symbols, addresses) need no translation.
const skip = (s) => !/[A-Za-z]{2}/.test(s) || /^0x[0-9a-f]{40}$/i.test(s) || /^(bc1|Gww)[0-9A-Za-z]{20,}$/.test(s) || /^[\w.-]+\.(net|com)$/.test(s);
out.html = out.html.filter((s) => !skip(s));
out.js = out.js.filter((s) => !skip(s) && !out.plural.some((p) => p.other === s));
console.log(JSON.stringify(out, null, 1));
