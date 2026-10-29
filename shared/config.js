// X Mass Unfollow - shared/config.js
// Loaded by the background worker (importScripts) and by every extension page.

(function (root) {
  "use strict";

  const K = {
    settings: "x7.settings",
    whitelist: "x7.whitelist",
    account: "x7.account",
    scan: "x7.scan",
    scanUsers: "x7.scanUsers",
    job: "x7.job",
    queue: "x7.queue",
    ledger: "x7.ledger",
    history: "x7.history",
    doneIds: "x7.doneIds",
    health: "x7.health",
    meta: "x7.meta",
    act: "x7.act",             // Scanner: activity-check progress
    actData: "x7.actData",     // Scanner: { accountId: { t, s, w, at } } last-post results
    review: "x7.review",       // review prompt: { state: "rated"|"no"|"later", job, asks, at }
    owner: "x7.owner",         // id of the X account the per-account data below belongs to
    profiles: "x7.profiles",   // { accountId: { h, n, a, at } } every X account seen here
    fol: "x7.fol",             // followers check progress
    folPartial: "x7.folPartial", // followers read so far (checkpoint while a check runs)
    followers: "x7.followers", // last complete followers snapshot { ownerId, at, total, ids, fans }
    fevents: "x7.fevents",     // follower changes: [{ k: "lost"|"gained", i, h, n, a, at, from, fw }]
    firstSeen: "x7.firstSeen", // { accountId: ts } when an account first showed up in your following
    scanLog: "x7.scanLog",     // [{ t, fg, fl, nf, mu }] counts after each scan, for the charts
    groups: "x7.groups"        // saved selections [{ id, name, ids, at }]
  };

  // Everything that belongs to one X account. When you sign in to X with a
  // different account, these are put aside and that account's own set loads.
  const PROFILE_KEYS = [
    K.whitelist, K.scan, K.scanUsers, K.ledger, K.history, K.doneIds, K.act, K.actData,
    K.job, K.queue, K.fol, K.folPartial, K.followers, K.fevents, K.firstSeen, K.scanLog, K.groups
  ];

  // Speed presets. Delays are seconds between actions (randomised inside the
  // range), then a rest every `restEvery` actions, and a rolling 24-hour cap.
  // X commonly limits accounts at around 400 follow/unfollow actions a day
  // (about 1,000 with Premium), so the defaults stay under that.
  const PRESETS = {
    safe:     { minDelay: 15, maxDelay: 35, restEvery: 30, restMinutes: 10, dailyLimit: 250 },
    balanced: { minDelay: 8,  maxDelay: 20, restEvery: 50, restMinutes: 6,  dailyLimit: 400 },
    fast:     { minDelay: 4,  maxDelay: 10, restEvery: 80, restMinutes: 5,  dailyLimit: 1000 }
  };

  const DEFAULT_SETTINGS = Object.assign({ speed: "balanced" }, PRESETS.balanced, {
    keepVerified: false,
    keepProtected: false,
    keepMinFollowers: 0,      // keep accounts with at least this many followers (0 = off)
    keepKeywords: "",         // comma separated; matched against name, handle and bio
    keepNewDays: 0,           // keep accounts you followed in the last N days (0 = off)
    scanMaxAgeHours: 12,      // older scans are refreshed before a quick run
    trackFollowers: true,     // read your followers after each scan, to see who unfollowed you
    notify: false,            // desktop notifications (needs Chrome's optional permission)
    lang: "auto",             // interface language ("auto" = the browser's)
    telemetry: true           // anonymous usage stats (install/active/uninstall + country)
  });

  const LIMITS = {
    minDelay: [2, 600], maxDelay: [2, 900], restEvery: [0, 1000],
    restMinutes: [1, 240], dailyLimit: [0, 5000], keepMinFollowers: [0, 100000000],
    keepNewDays: [0, 365], scanMaxAgeHours: [1, 720]
  };

  const LANGS = ["en", "es", "pt", "hi", "id", "tr", "ar"];

  function normalizeSettings(s) {
    const out = Object.assign({}, DEFAULT_SETTINGS, s || {});
    for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
      let n = Math.round(Number(out[k]));
      if (!Number.isFinite(n)) n = DEFAULT_SETTINGS[k];
      out[k] = Math.max(lo, Math.min(hi, n));
    }
    if (out.maxDelay < out.minDelay) [out.minDelay, out.maxDelay] = [out.maxDelay, out.minDelay];
    if (!["safe", "balanced", "fast", "custom"].includes(out.speed)) out.speed = "custom";
    out.keepVerified = !!out.keepVerified;
    out.keepProtected = !!out.keepProtected;
    out.trackFollowers = out.trackFollowers !== false;
    out.notify = !!out.notify;
    out.telemetry = out.telemetry !== false;
    out.keepKeywords = String(out.keepKeywords || "").slice(0, 2000);
    if (out.lang !== "auto" && !LANGS.includes(out.lang)) out.lang = "auto";
    return out;
  }

  function cleanHandle(raw) {
    if (!raw) return null;
    let h = String(raw).trim();
    const m = h.match(/(?:twitter|x)\.com\/(?:#!\/)?@?([A-Za-z0-9_]{1,15})/i);
    if (m) h = m[1];
    h = h.replace(/^@+/, "").trim();
    if (!/^[A-Za-z0-9_]{1,15}$/.test(h)) return null;
    if (/^(home|explore|notifications|messages|settings|i|search|compose|intent|share|login|logout|signup|tos|privacy)$/i.test(h)) return null;
    return h;
  }

  function parseKeywords(s) {
    return String(s || "").split(/[,\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  }

  // keepReason runs for every account on every refresh: parse the keyword
  // list once per distinct setting, not once per account.
  let kwMemo = { s: null, list: [] };
  function keywordsOf(s) {
    if (kwMemo.s !== s) kwMemo = { s, list: parseKeywords(s) };
    return kwMemo.list;
  }

  // Why an account would be kept, or null if it may be unfollowed.
  // Shared by the engine and the review table so both always agree.
  // ctx (optional): { firstSeen: { id: ts }, now } for the "followed recently" rule.
  function keepReason(u, settings, whitelistSet, ctx) {
    const h = String(u.h || "").toLowerCase();
    if (whitelistSet && whitelistSet.has(h)) return "whitelist";
    if (settings.keepVerified && u.v) return "verified";
    if (settings.keepProtected && u.p) return "private";
    if (settings.keepMinFollowers > 0 && typeof u.fc === "number" && u.fc >= settings.keepMinFollowers) return "big account";
    if (settings.keepNewDays > 0 && ctx && ctx.firstSeen) {
      const t = ctx.firstSeen[u.i];
      if (t && (ctx.now || Date.now()) - t < settings.keepNewDays * 864e5) return "followed recently";
    }
    const kws = keywordsOf(settings.keepKeywords);
    if (kws.length) {
      const hay = (u.n + " " + u.h + " " + (u.b || "")).toLowerCase();
      if (kws.some((k) => hay.includes(k))) return "keyword";
    }
    return null;
  }

  root.X7 = { K, PROFILE_KEYS, PRESETS, DEFAULT_SETTINGS, LIMITS, LANGS, normalizeSettings, cleanHandle, parseKeywords, keepReason };
})(typeof self !== "undefined" ? self : window);
