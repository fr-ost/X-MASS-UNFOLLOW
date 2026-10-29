// X Mass Unfollow - shared/i18n.js
//
// Translations for the popup, the dashboard and the status messages the
// background worker writes. The English text is the key, so anything without
// a translation simply stays in English.
//
//   X7I18N.t("Read {n} accounts", { n })              -> translated, filled in
//   X7I18N.tn(n, "{n} account", "{n} accounts")        -> the right plural form
//   X7I18N.translateDom(document)                      -> static HTML of a page
//
// Dictionaries live in shared/i18n/<lang>.js and register with X7I18N.add().
// A plural entry is an object keyed by Intl.PluralRules categories
// ({ one, few, many, other, ... }) stored under the English "other" text.
//
// Pages: this file is loaded in <head>. It picks the language (the choice in
// Settings, else the browser's), loads that one dictionary synchronously, and
// sets lang/dir on <html> before anything paints (Arabic is right-to-left).
// The worker loads every dictionary and follows settings.lang.

(function (root) {
  "use strict";

  const SUPPORTED = ["en", "es", "pt", "hi", "id", "tr", "ar"];
  const RTL = new Set(["ar"]);
  const NAMES = { en: "English", es: "Español", pt: "Português (Brasil)", hi: "हिन्दी", id: "Bahasa Indonesia", tr: "Türkçe", ar: "العربية" };
  const PREF_KEY = "x7.lang";
  const dicts = {};
  let lang = "en";

  function pick(code) {
    const c = String(code || "").toLowerCase().replace(/_/g, "-");
    if (SUPPORTED.includes(c)) return c;
    const base = c.split("-")[0];
    return SUPPORTED.includes(base) ? base : "en";
  }

  const has = (d, k) => !!d && Object.prototype.hasOwnProperty.call(d, k);
  const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));
  // In right-to-left text an @handle is kept as one left-to-right piece, so it
  // reads "@name" and not "name@".
  const iso = (s) => (RTL.has(lang) ? s.replace(/@\w+/g, "\u2066$&\u2069") : s);
  const num = (n) => (typeof n === "number" ? n.toLocaleString(locale()) : n);

  // Locale for numbers and dates: the browser's own when it is the same
  // language (es-MX stays es-MX), else the language itself. English keeps the
  // browser default. Arabic uses Western digits, like handles and times do.
  function locale() {
    if (lang === "en") return undefined;
    const b = browserLang();
    const base = pick(b) === lang ? b : lang === "pt" ? "pt-BR" : lang;
    return lang === "ar" ? base + "-u-nu-latn" : base;
  }

  function t(s, v) {
    const d = dicts[lang];
    let out = has(d, s) ? d[s] : s;
    if (out && typeof out === "object") out = out.other || s;
    return iso(fill(out, v));
  }

  function tn(n, one, other, v) {
    const vars = Object.assign({ n: num(n) }, v || {});
    const d = dicts[lang];
    const e = has(d, other) ? d[other] : null;
    if (e && typeof e === "object") {
      let cat = "other";
      try { cat = new Intl.PluralRules(lang).select(Number(n)); } catch (_) {}
      return iso(fill(e[cat] || e.other || other, vars));
    }
    if (typeof e === "string") return iso(fill(e, vars));     // a language with a single form
    return fill(Number(n) === 1 ? one : other, vars);
  }

  // ---- static HTML ---------------------------------------------------------
  // Elements that mix text with inline markup (<b>, <a>, <kbd>...) are looked
  // up by their whole inner HTML first, so a translation can reorder the
  // sentence around the markup; otherwise each text node is looked up alone.
  const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "CODE", "SVG", "svg", "NOSCRIPT"]);
  const INLINE = new Set(["B", "STRONG", "EM", "I", "A", "KBD", "SPAN", "SMALL", "BR", "CODE"]);
  const norm = (s) => String(s).replace(/\s+/g, " ").trim();

  function isMixed(el) {
    let text = false, inline = false;
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { if (n.nodeValue.trim()) text = true; }
      else if (n.nodeType === 1) {
        if (!INLINE.has(n.tagName) || n.hasAttribute("id") || n.hasAttribute("data-icon")) return false;
        inline = true;
      }
    }
    return text && inline;
  }

  function translateNode(el, d) {
    if (!el || el.nodeType !== 1 || SKIP.has(el.tagName) || el.hasAttribute("data-no-i18n")) return;
    for (const a of ["placeholder", "title", "aria-label", "alt", "data-tip"]) {
      const v = el.getAttribute(a);
      if (v && has(d, norm(v))) el.setAttribute(a, t(norm(v)));
    }
    if (isMixed(el)) {
      const k = norm(el.innerHTML);
      if (has(d, k)) { el.innerHTML = t(k); return; }
    }
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) {
        const raw = n.nodeValue;
        const k = norm(raw);
        if (k && has(d, k)) n.nodeValue = raw.replace(/^(\s*)[\s\S]*?(\s*)$/, (m, a, b) => a + t(k) + b);
      } else if (n.nodeType === 1) translateNode(n, d);
    }
  }

  function translateDom(rootNode) {
    const d = dicts[lang];
    if (!d || lang === "en") return;
    const doc = rootNode && rootNode.nodeType === 9 ? rootNode : null;
    if (doc && doc.title && has(d, norm(doc.title))) doc.title = t(norm(doc.title));
    translateNode(doc ? doc.body : rootNode, d);
  }

  // ---- language choice ------------------------------------------------------
  function storedPref() {
    try { return root.localStorage ? root.localStorage.getItem(PREF_KEY) || "auto" : "auto"; } catch (_) { return "auto"; }
  }
  function browserLang() {
    try { if (root.chrome && chrome.i18n && chrome.i18n.getUILanguage) return chrome.i18n.getUILanguage(); } catch (_) {}
    return (root.navigator && navigator.language) || "en";
  }
  function resolve(pref) { return pick(!pref || pref === "auto" ? browserLang() : pref); }

  function use(code) {
    lang = pick(code);
    if (root.document && document.documentElement) {
      document.documentElement.lang = lang === "pt" ? "pt-BR" : lang;
      document.documentElement.dir = RTL.has(lang) ? "rtl" : "ltr";
    }
    return lang;
  }

  const api = {
    SUPPORTED, NAMES, PREF_KEY,
    get lang() { return lang; },
    get rtl() { return RTL.has(lang); },
    get locale() { return locale(); },
    add(code, dict) { dicts[code] = Object.assign(dicts[code] || {}, dict); },
    has: (s) => has(dicts[lang], s),
    t, tn, use, pick, resolve, translateDom,
    pref: storedPref,
    setPref(p) {
      try { if (root.localStorage) root.localStorage.setItem(PREF_KEY, p || "auto"); } catch (_) {}
      return use(resolve(p));
    }
  };
  root.X7I18N = api;

  // Pages: choose now and load the one dictionary needed, before first paint.
  if (root.document && document.readyState === "loading") {
    const l = use(resolve(storedPref()));
    if (l !== "en") {
      const base = (document.currentScript && document.currentScript.src) ? new URL("i18n/", document.currentScript.src).href : "shared/i18n/";
      try { document.write('<script src="' + base + l + '.js"><\/script>'); }
      catch (_) {
        const s = document.createElement("script");
        s.src = base + l + ".js";
        s.onload = () => translateDom(document);
        document.head.appendChild(s);
      }
    }
  }
})(typeof self !== "undefined" ? self : window);
