// Translation completeness and safety check (no browser needed, but uses the
// extractor, which needs Playwright to read the static HTML).
//   PLAYWRIGHT=... node tests/i18n_check.mjs
// For every language: every interface string has a translation (brand names
// and proper nouns excepted), {placeholders} are kept exactly, HTML markup in
// mixed sentences is kept (same tags, same links), plural entries are objects
// with an "other" form, and no translation is left empty.
import fs from "fs";
import path from "path";
import vm from "vm";
import { execFileSync } from "child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const LANGS = ["es", "pt", "hi", "id", "tr", "ar"];
const KEEP_ENGLISH = new Set([
  "GrowX", "ETH", "USDT", "BNB", "AVAX", "SOL", "BTC", "Ethereum", "BNB Smart Chain", "Avalanche C-Chain", "Solana", "Bitcoin",
  "Native SegWit (bc1)", "Telegram @igfrostt", "English", "Español", "Português (Brasil)", "Bahasa Indonesia", "Türkçe",
  "Mass Unfollow", "0 selected", "Unfollow 0 accounts?", "Unfollows in the last 24 hours"
]);

const json = execFileSync(process.execPath, [path.join(ROOT, "tools/i18n-extract.mjs")], { env: process.env, encoding: "utf8", maxBuffer: 1 << 26 });
fs.writeFileSync(path.join(ROOT, "tools/i18n-strings.json"), json);
const S = JSON.parse(json);
const plurals = new Map(S.plural.map((p) => [p.other, p.one]));
const keys = [...new Set([...S.html, ...S.js, ...S.plural.map((p) => p.other)])].filter((k) => !KEEP_ENGLISH.has(k));

const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(",");
const tags = (s) => (String(s).match(/<\/?[a-z]+\b[^>]*>/gi) || []).map((x) => x.replace(/\s+/g, " ")).sort().join("|");

const sandbox = { X7I18N: { add(l, d) { sandbox.dicts[l] = Object.assign(sandbox.dicts[l] || {}, d); } }, dicts: {} };
vm.createContext(sandbox);
let problems = 0;
const report = (lang, msg) => { problems++; if (problems < 80) console.log(`  [${lang}] ${msg}`); };

for (const lang of LANGS) {
  const file = path.join(ROOT, "shared/i18n", lang + ".js");
  if (!fs.existsSync(file)) { report(lang, "missing file " + file); continue; }
  vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
  const d = sandbox.dicts[lang] || {};
  let missing = 0;
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(d, k)) { missing++; if (missing <= 12) report(lang, "missing: " + JSON.stringify(k)); continue; }
    const v = d[k];
    if (plurals.has(k)) {
      if (typeof v === "string") { if (ph(v) !== ph(k) && !(ph(k).includes("{n}") && ph(v) === ph(k).replace(/\{n\},?/, ""))) report(lang, `placeholders differ: ${k}`); continue; }
      if (!v || typeof v !== "object" || typeof v.other !== "string") { report(lang, "plural needs an object with 'other': " + k); continue; }
      for (const [cat, form] of Object.entries(v)) {
        if (!["zero", "one", "two", "few", "many", "other"].includes(cat)) report(lang, `bad plural category ${cat}: ${k}`);
        if (!form || typeof form !== "string") report(lang, `empty plural form ${cat}: ${k}`);
        // {n} may be dropped in a "one"/"two"/"zero" form ("one account"), every other placeholder must stay
        const need = ph(k).split(",").filter((x) => x && x !== "{n}").join(",");
        const got = ph(form).split(",").filter((x) => x && x !== "{n}").join(",");
        if (need !== got) report(lang, `placeholders differ in ${cat}: ${k} -> ${form}`);
        if (["other", "many", "few"].includes(cat) && ph(k).includes("{n}") && !form.includes("{n}")) report(lang, `"${cat}" form must show {n}: ${k}`);
      }
      continue;
    }
    if (typeof v !== "string" || !v.trim()) { report(lang, "empty or non-string: " + k); continue; }
    if (ph(v) !== ph(k)) report(lang, `placeholders differ: ${k} -> ${v}`);
    if (tags(v) !== tags(k)) report(lang, `markup differs: ${k} -> ${v}`);
  }
  const extra = Object.keys(d).filter((k) => !keys.includes(k) && !KEEP_ENGLISH.has(k));
  console.log(`${lang}: ${keys.length - missing}/${keys.length} translated` + (extra.length ? `, ${extra.length} unused (e.g. ${JSON.stringify(extra.slice(0, 3))})` : ""));
  if (missing) problems++;
}
console.log(problems ? `\n${problems} problem(s)` : "\nall translations complete and safe");
process.exit(problems ? 1 : 0);
