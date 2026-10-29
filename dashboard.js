// X Mass Unfollow - dashboard.js
(function () {
  "use strict";

  const { $, $$ } = U;
  const K = X7.K;
  const t = U.t, tn = U.tn;
  const CHUNK = 60;
  const DAY = 86400000;

  const D = {
    S: null,                 // worker state (account, scan, job, settings, today...)
    users: [],               // scan results
    byId: new Map(),
    wl: new Set(),           // lowercase handles
    done: new Set(),         // unfollowed ids
    history: [],
    firstSeen: {},           // id -> when it first showed up in your following
    groups: [],              // saved selections
    followers: null,         // last followers snapshot
    fevents: [],             // follower changes
    scanLog: [],
    sel: new Set(),
    seg: "non",
    chips: new Set(),
    f: { minFc: "", maxFc: "", ratio: "", age: "", bioIn: "", bioOut: "", script: "" },
    group: "",
    sort: "list",
    q: "",
    list: [],                // current filtered list
    shown: 0,
    hiKind: "u",
    hiList: [],
    hiShown: 0,
    hiSel: new Set(),
    fo: { seg: "lost", q: "", list: [], shown: 0, sel: new Set() },
    chartRange: "90",
    page: "overview",
    act: {},                 // last-post results by account id (Inactive tab)
    idleAge: "30",           // Inactive tab: "30" | "90" | "180" | "365" | "na"
    idleDir: "desc",         // Inactive tab: "desc" = most inactive first
    counts: null
  };

  // ======================================================================
  // helpers
  // ======================================================================
  const settings = () => (D.S && D.S.settings) || X7.DEFAULT_SETTINGS;
  const keepCtx = () => ({ firstSeen: D.firstSeen, now: Date.now() });
  const keepOf = (u) => X7.keepReason(u, settings(), D.wl, keepCtx());
  const monthYear = (ts) => ts ? new Date(ts).toLocaleDateString(U.locale(), { month: "short", year: "numeric" }) : "-";
  const KEEP_LABEL = () => ({
    whitelist: t("whitelist"), verified: t("verified"), private: t("private"), "big account": t("big account"),
    "followed recently": t("followed recently"), keyword: t("keyword")
  });

  function avatarHtml(url, name, size) {
    const letter = U.esc((String(name || "?").trim()[0] || "?").toUpperCase());
    const st = size ? ` style="width:${size}px;height:${size}px"` : "";
    if (!url) return `<span class="avatar"${st}>${letter}</span>`;
    return `<span class="avatar"${st} data-letter="${letter}"><img class="av" alt="" loading="lazy" referrerpolicy="no-referrer" src="${U.esc(U.bigAvatar(url))}" style="width:100%;height:100%;object-fit:cover;display:block"></span>`;
  }
  // Broken avatar -> initial letter (one capturing listener; no inline handlers).
  document.addEventListener("error", (e) => {
    const el = e.target;
    if (el && el.tagName === "IMG" && el.classList.contains("av")) {
      const wrap = el.parentElement;
      el.remove();
      if (wrap) wrap.textContent = wrap.dataset.letter || "?";
    }
  }, true);

  function swapAvatar(sel, url, name, size) {
    const old = $(sel);
    if (!old) return;
    const el = U.avatar(url, name, size);
    el.id = old.id;
    old.replaceWith(el);
  }

  const profileUrl = (u) => u.h ? "https://x.com/" + encodeURIComponent(u.h) : "https://x.com/i/user/" + encodeURIComponent(u.i);
  const handleText = (u) => u.h ? U.at(u.h) : t("account #{id}", { id: u.i });

  // ======================================================================
  // confirm modal
  // ======================================================================
  function confirmBox(o) {
    return new Promise((resolve) => {
      $("#cfTitle").textContent = o.title;
      $("#cfBody").textContent = o.body || "";
      const icon = $("#cfIcon");
      icon.className = "modal-icon" + (o.info ? " is-info" : "");
      icon.innerHTML = U.icon(o.icon || "userX");
      const facts = $("#cfFacts");
      facts.innerHTML = "";
      for (const [k, v] of o.facts || []) {
        const d = document.createElement("div");
        d.innerHTML = `<span>${U.esc(k)}</span><b>${U.esc(v)}</b>`;
        facts.appendChild(d);
      }
      const ok = $("#cfOk");
      ok.className = "btn " + (o.danger ? "btn-danger-soft" : "btn-primary");
      ok.querySelector("span").textContent = o.ok || t("Confirm");
      const box = $("#confirm");
      box.hidden = false;
      setTimeout(() => ok.focus(), 30);
      const done = (v) => {
        box.hidden = true;
        ok.removeEventListener("click", yes);
        $("#cfCancel").removeEventListener("click", no);
        box.removeEventListener("click", outside);
        document.removeEventListener("keydown", key);
        resolve(v);
      };
      const yes = () => done(true);
      const no = () => done(false);
      const outside = (e) => { if (e.target === box) done(false); };
      const key = (e) => { if (e.key === "Escape") done(false); };
      ok.addEventListener("click", yes);
      $("#cfCancel").addEventListener("click", no);
      box.addEventListener("click", outside);
      document.addEventListener("keydown", key);
    });
  }

  function paceFacts(count) {
    const s = settings();
    const names = { safe: t("Safe"), balanced: t("Balanced"), fast: t("Fast"), custom: t("Custom") };
    const avg = (s.minDelay + s.maxDelay) / 2 + 1.5;
    let secs = count * avg;
    if (s.restEvery > 0) secs += Math.floor(count / s.restEvery) * s.restMinutes * 60;
    let eta = "~" + U.dur(secs);
    if (s.dailyLimit > 0) {
      const room = Math.max(0, s.dailyLimit - (D.S ? D.S.today : 0));
      if (count > room) eta = "~" + tn(Math.ceil((count - room) / s.dailyLimit) + 1, "{n} day (daily limit)", "{n} days (daily limit)");
    }
    return [
      [t("Pace"), t("{name} · {min}-{max}s apart", { name: names[s.speed] || names.custom, min: s.minDelay, max: s.maxDelay })],
      [t("Daily limit"), s.dailyLimit ? t("{n} ({used} used today)", { n: U.fmt(s.dailyLimit), used: U.fmt(D.S ? D.S.today : 0) }) : t("Off")],
      [t("Estimated time"), eta]
    ];
  }

  async function startRun(payload, count, label, follow) {
    const ok = await confirmBox({
      title: follow
        ? tn(count, "Follow {n} account?", "Follow {n} accounts?")
        : tn(count, "Unfollow {n} account?", "Unfollow {n} accounts?"),
      body: label || t("Whitelisted accounts are always skipped. You can pause or stop at any time."),
      facts: paceFacts(count),
      ok: follow ? t("Start following") : t("Start unfollowing"),
      icon: follow ? "userPlus" : "userX",
      info: !!follow
    });
    if (!ok) return false;
    const r = await U.cmd("run", payload);
    if (!r.ok) { U.toast(r.error || t("Couldn't start."), "err", 5000); return false; }
    U.toast(t("Started - {n} in the queue.", { n: U.fmt(r.total) }), "ok");
    location.hash = "#overview";
    return true;
  }

  async function startScan(then) {
    const r = await U.cmd("scan", then ? { then } : {});
    if (!r.ok) U.toast(r.error || t("Couldn't start the scan."), "err", 6000);
    else { U.toast(t("Scanning your following list..."), "ok"); location.hash = "#overview"; }
    await refreshState();
  }

  // ======================================================================
  // routing
  // ======================================================================
  function route() {
    let r = location.hash.replace(/^#/, "") || "overview";
    if (r === "welcome") {
      $("#welcome").hidden = false;
      history.replaceState(null, "", "#overview");
      r = "overview";
    }
    if (r === "scanner") { D.seg = "blue"; r = "following"; history.replaceState(null, "", "#following"); }
    if (!$(`.page[data-page="${r}"]`)) r = "overview";
    D.page = r;
    $$(".page").forEach((p) => p.classList.toggle("is-on", p.dataset.page === r));
    const navR = r === "import" ? "following" : r;      // Import lives under Following
    $$(".nav a").forEach((a) => a.classList.toggle("is-on", a.dataset.route === navR));
    if (r === "following") renderFollowing(true);
    if (r === "followers") renderFollowers(true);
    renderBulk();
    renderFoBulk();
    renderHiBulk();
    if (r === "whitelist") renderWhitelist();
    if (r === "history") renderHistory(true);
    if (r === "settings") fillSettings();
    if (r === "overview") renderChart();
    window.scrollTo({ top: 0 });
  }

  // ======================================================================
  // data
  // ======================================================================
  async function refreshState() {
    const s = await U.cmd("state");
    if (s && s.ok) D.S = s;
    renderOverview();
    renderSide();
    if (D.page === "following") renderFollowing(false);
    if (D.page === "followers") renderFollowersHead();
    if (D.page === "settings") renderAccounts();
    if (D.S && D.S.job) maybeAskReview(D.S.job);
  }

  // Review prompt when the daily limit pauses a run or a run finishes (see U.review).
  // The moment is claimed only when this page can show the prompt right away -
  // in front and with no other dialog open - so a tab in the background (or one
  // still showing the welcome screen) never uses up the ask.
  let reviewAsked = null;
  function maybeAskReview(j) {
    const key = U.review.moment(j);
    if (!key || reviewAsked === key) return;
    reviewAsked = key;
    const attempt = async () => {
      if (U.review.moment(D.S && D.S.job) !== key) return;                    // that moment has passed
      if (document.hidden || !$("#confirm").hidden || !$("#welcome").hidden || !$("#groupAsk").hidden) return setTimeout(attempt, 1500);
      if (!(await U.review.take(j))) return;
      $("#rateAsk").hidden = false;
      setTimeout(() => $("#rateAskGo").focus(), 30);
    };
    setTimeout(attempt, 900);
  }

  async function loadUsers() {
    const arr = await U.get(K.scanUsers, []);
    D.users = Array.isArray(arr) ? arr : [];
    D.byId = new Map(D.users.map((u) => [u.i, u]));
    for (const id of [...D.sel]) if (!D.byId.has(id)) D.sel.delete(id);
  }
  async function loadAct() {
    const d = await U.get(K.actData, {});
    D.act = d && typeof d === "object" && !Array.isArray(d) ? d : {};
  }
  async function loadWl() { const w = await U.get(K.whitelist, []); D.wl = new Set((Array.isArray(w) ? w : []).map((h) => String(h).toLowerCase())); }
  async function loadDone() { const d = await U.get(K.doneIds, []); D.done = new Set(Array.isArray(d) ? d : []); }
  async function loadHistory() { const h = await U.get(K.history, []); D.history = Array.isArray(h) ? h : []; }
  async function loadFirstSeen() { const f = await U.get(K.firstSeen, {}); D.firstSeen = f && typeof f === "object" ? f : {}; }
  async function loadGroups() { const g = await U.get(K.groups, []); D.groups = Array.isArray(g) ? g : []; }
  async function loadFollowers() {
    const [snap, ev] = await Promise.all([U.get(K.followers, null), U.get(K.fevents, [])]);
    D.followers = snap && Array.isArray(snap.ids) ? snap : null;
    D.fevents = Array.isArray(ev) ? ev : [];
  }
  async function loadScanLog() { const l = await U.get(K.scanLog, []); D.scanLog = Array.isArray(l) ? l : []; }

  async function saveWl() {
    await U.set({ [K.whitelist]: [...D.wl].sort() });
  }

  // Who you follow now: the last scan, minus anyone unfollowed since, plus
  // anyone followed with the extension since (oldest first, so a later
  // unfollow wins over an earlier follow).
  function followingSet() {
    const out = new Set();
    for (const u of D.users) if (!D.done.has(u.i)) out.add(u.i);
    const since = (D.S && D.S.scan && D.S.scan.finishedAt) || 0;
    for (const h of D.history) {
      if (!h.i || h.t <= since) continue;
      if (h.k === "f") out.add(h.i); else out.delete(h.i);
    }
    return out;
  }

  // ======================================================================
  // overview
  // ======================================================================
  function greeting() {
    const h = new Date().getHours();
    return h < 5 ? t("Working late") : h < 12 ? t("Good morning") : h < 18 ? t("Good afternoon") : t("Good evening");
  }

  function profileName(id) {
    const p = D.S && D.S.profiles && D.S.profiles[id];
    return p && p.h ? U.at(p.h) : t("your other account");
  }

  function renderOverview() {
    const S = D.S;
    if (!S) return;
    const acc = S.account;
    swapAvatar("#ovAvatar", acc && acc.avatar, acc && (acc.name || acc.handle), 52);
    if (acc && acc.id && !acc.signedOut) {
      const first = acc.name ? acc.name.split(" ")[0] : "";
      $("#ovHello").textContent = first ? t("{greeting}, {name}", { greeting: greeting(), name: first }) : greeting();
      const bits = [];
      if (acc.handle) bits.push(U.at(acc.handle));
      if (acc.following != null) bits.push(t("{n} following", { n: U.fmt(acc.following) }));
      if (acc.followers != null) bits.push(tn(acc.followers, "{n} follower", "{n} followers"));
      $("#ovSub").textContent = bits.join(" · ") || t("Connected to X");
    } else {
      $("#ovHello").textContent = t("Welcome");
      $("#ovSub").textContent = acc && acc.signedOut ? t("You're signed out of X. Sign in at x.com to continue.") : t("Open x.com and sign in, then scan your following list.");
    }

    // Signed in to X as someone else while another account's run is unfinished.
    const note = $("#acctNote");
    const other = acc && acc.id && S.owner && acc.id !== S.owner;
    note.hidden = !other;
    if (other) {
      note.textContent = t("You're signed in to X as {now}, but a run for {owner} isn't finished, so {owner}'s data is shown. Stop or finish that run to switch to {now}.",
        { now: acc.handle ? U.at(acc.handle) : t("another account"), owner: profileName(S.owner) });
    }

    const sc = S.scan && S.scan.status === "done" ? S.scan : null;
    if (sc) U.countTo($("#kFollowing"), sc.total); else $("#kFollowing").textContent = "-";
    $("#kFollowingSub").textContent = sc ? t("scanned {ago}", { ago: U.ago(sc.finishedAt) }) : t("scan to see");
    if (sc) U.countTo($("#kNon"), sc.nonFollowers); else $("#kNon").textContent = "-";
    $("#kNonSub").textContent = sc ? t("{n} ready to unfollow", { n: U.fmt(S.actionable) }) : " ";

    // Followers: exact from the last check, else the count on your profile.
    const fol = S.fol;
    const nFol = D.followers ? D.followers.total : (acc && acc.followers != null ? acc.followers : null);
    if (nFol != null) U.countTo($("#kFollowers"), nFol); else $("#kFollowers").textContent = "-";
    const fs = $("#kFollowersSub");
    if (fol && fol.status === "done" && !fol.baseline && (fol.lost || fol.gained)) {
      fs.innerHTML = `<span class="down">−${U.esc(U.fmt(fol.lost))}</span> · <span class="up">+${U.esc(U.fmt(fol.gained))}</span> ${U.esc(t("since last check"))}`;
    } else if (fol && fol.status === "running") fs.textContent = t("checking...");
    else fs.textContent = D.followers ? t("checked {ago}", { ago: U.ago(D.followers.at) }) : nFol != null ? t("from your profile") : " ";

    U.countTo($("#kToday"), S.today);
    $("#kTodaySub").textContent = S.settings.dailyLimit ? t("of {n} daily limit", { n: U.fmt(S.settings.dailyLimit) }) : t("no daily limit set");
    $("#ovScanBtn").querySelector("span").textContent = sc ? t("Rescan") : t("Scan following");
    $("#ovScanBtn").disabled = !!(S.scan && S.scan.status === "running");

    const nav = $("#navNon");
    nav.hidden = !(sc && S.actionable);
    nav.textContent = U.compact(S.actionable || 0);
    const navLost = $("#navLost");
    const lostN = fol && fol.status === "done" && !fol.baseline ? fol.lost || 0 : 0;
    navLost.hidden = !lostN;
    navLost.textContent = U.compact(lostN);
    navLost.title = tn(lostN, "{n} unfollowed you since the last check", "{n} unfollowed you since the last check");

    renderRunPanel();
    renderFeed();
    renderLostFeed();
  }

  function renderRunPanel() {
    const S = D.S;
    const j = S.job;
    const scan = S.scan;
    const pill = $("#rpPill");
    const setPill = (kind, text) => { pill.className = "pill" + (kind ? " is-" + kind : ""); $("#rpPillText").textContent = text; };

    $("#rpIdle").hidden = $("#rpActive").hidden = $("#rpScan").hidden = true;

    if (scan && scan.status === "running") {
      setPill("scan", t("Scanning"));
      $("#rpScan").hidden = false;
      $("#rpScanNum").textContent = U.fmt(scan.phase === "followers" ? scan.followersRead || 0 : scan.fetched || 0);
      $("#rpScanMsg").textContent = scan.message || "";
      const bar = $("#rpScanBar");
      if (scan.expected && scan.phase !== "followers") {
        bar.classList.remove("is-indeterminate");
        bar.firstElementChild.style.width = Math.min(98, Math.max(3, (scan.fetched || 0) / scan.expected * 100)) + "%";
      } else bar.classList.add("is-indeterminate");
      return;
    }

    if (j) {
      const follow = j.kind === "follow";
      const active = ["running", "resting", "paused", "halted"].includes(j.status);
      const labels = { running: ["run", t("Running")], resting: ["rest", t("Resting")], paused: ["", t("Paused")], halted: ["halt", t("Needs you")], done: ["done", t("Finished")], stopped: ["", t("Stopped")] };
      const [k, tx] = labels[j.status] || ["", j.status];
      setPill(k, tx);
      $("#rpActive").hidden = false;
      $("#runPanel h2").textContent = follow ? t("Follow run") : t("Unfollow run");
      const pct = j.total ? Math.round(((j.done + j.skipped + j.failed) / j.total) * 100) : 0;
      $("#rpDone").textContent = U.fmt(j.done);
      $("#rpTotal").textContent = follow ? t("/ {n} followed", { n: U.fmt(j.total) }) : t("/ {n} unfollowed", { n: U.fmt(j.total) });
      $("#rpPct").textContent = pct + "%";
      const bar = $("#rpBar");
      bar.className = "bar" + (j.status === "running" ? " is-live" : j.status === "resting" ? " is-rest" : (j.status === "done" ? " is-done" : ""));
      bar.firstElementChild.style.width = Math.max(2, pct) + "%";
      const t2 = j.current;
      swapAvatar("#rpAvatar", t2 && t2.a, t2 && (t2.n || t2.h), 40);
      $("#rpNow").textContent = active && t2 ? (t2.n ? `${t2.n}  ${U.at(t2.h)}` : U.at(t2.h)) : (j.message || "-");
      $("#rpNowLabel").textContent = active ? (j.inFlight ? (follow ? t("Following") : t("Unfollowing")) : t("Next up")) : t("Summary");
      const msg = $("#rpMsg");
      const took = j.finishedAt ? t(", took {d}", { d: U.dur((j.finishedAt - j.startedAt) / 1000) }) : "";
      msg.textContent = active ? (j.message || "") : (follow
        ? t("{done} followed, {skipped} skipped{took}.", { done: U.fmt(j.done), skipped: U.fmt(j.skipped + j.failed), took })
        : t("{done} unfollowed, {skipped} skipped{took}.", { done: U.fmt(j.done), skipped: U.fmt(j.skipped + j.failed), took }));
      msg.className = "rp-msg" + (j.status === "halted" ? " is-error" : j.status === "resting" ? " is-warn" : "");
      $("#rpSkipped").textContent = U.fmt(j.skipped + j.failed);
      $("#rpLeft").textContent = U.fmt(Math.max(0, j.total - j.index));
      $("#rpMode").textContent = j.executor === "profile" ? t("Profile") : t("Direct");
      $("#rpPause").hidden = !(j.status === "running" || j.status === "resting");
      $("#rpResume").hidden = !(j.status === "paused" || j.status === "halted");
      $("#rpStop").hidden = !active;
      $("#rpClear").hidden = active;
      tickTimers();
      return;
    }

    $("#runPanel h2").textContent = t("Unfollow run");
    setPill("", t("Idle"));
    $("#rpIdle").hidden = false;
    const sc = scan && scan.status === "done" ? scan : null;
    const n = S.actionable || 0;
    $("#rpRunNonLabel").textContent = sc ? (n ? tn(n, "Unfollow {n} non-follower", "Unfollow {n} non-followers") : t("No non-followers left")) : t("Scan & unfollow non-followers");
    $("#rpRunNon").disabled = !!(sc && (!n || sc.relationshipUnknown));
    $("#rpIdleText").textContent = sc
      ? (sc.relationshipUnknown
          ? t("X didn't report who follows you back in the last scan. Rescan in a few minutes.")
          : t("{non} of the {total} accounts you follow don't follow you back.", { non: U.fmt(sc.nonFollowers), total: U.fmt(sc.total) }))
      : t("Scan your following list, then unfollow everyone who doesn't follow you back with one click.");
  }

  function tickTimers() {
    const j = D.S && D.S.job;
    if (!j) return;
    const el = $("#rpTimer"), lab = $("#rpTimerLabel");
    if (j.status === "running" && j.inFlight) { el.innerHTML = '<span class="spinner"></span>'; lab.textContent = t("working"); return; }
    let target = null, label = t("next in");
    if (j.status === "resting") { target = j.restUntil; label = j.restReason === "daily" ? t("daily limit") : t("break"); }
    else if (j.status === "running") target = j.nextAt;
    if (!target) { el.textContent = "-"; lab.textContent = j.status === "paused" ? t("paused") : ""; return; }
    const secs = Math.max(0, Math.round((target - Date.now()) / 1000));
    el.textContent = secs >= 3600 ? U.clock(target) : secs >= 60 ? Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0") : secs + "s";
    lab.textContent = label;
  }
  setInterval(tickTimers, 500);

  function renderFeed() {
    const feed = $("#feed");
    const j = D.S && D.S.job;
    let items = [];
    if (j && j.log && j.log.length) {
      items = j.log.slice(0, 25).map((l) => ({ h: l.h, r: l.r, m: l.m, t: l.t }));
    } else {
      items = D.history.slice(-25).reverse().map((h) => ({ h: h.h, n: h.n, a: h.a, r: "ok", m: h.k === "f" ? t("followed") : t("unfollowed"), t: h.t }));
    }
    $("#feedEmpty").hidden = items.length > 0;
    const byH = new Map(D.users.map((u) => [u.h.toLowerCase(), u]));
    feed.innerHTML = items.map((it) => {
      const u = byH.get(String(it.h || "").toLowerCase()) || it;
      return `<li>${avatarHtml(u.a, u.n || it.h, 30)}<div class="f-text"><b>@${U.esc(it.h)}</b> ${U.esc(it.m || "")}<small>${U.esc(U.ago(it.t))}</small></div><span class="f-dot ${U.esc(it.r)}"></span></li>`;
    }).join("");
  }

  // ---------- followers changes (latest event per account wins) ----------
  function followerState() {
    const seen = new Map();
    for (let i = D.fevents.length - 1; i >= 0; i--) {
      const e = D.fevents[i];
      if (e && e.i && !seen.has(e.i)) seen.set(e.i, e);
    }
    const lost = [], gained = [];
    for (const e of seen.values()) (e.k === "lost" ? lost : gained).push(e);
    const newest = (a, b) => b.at - a.at;
    return { lost: lost.sort(newest), gained: gained.sort(newest) };
  }

  function renderLostFeed() {
    const { lost } = followerState();
    const items = lost.slice(0, 6);
    $("#lostEmpty").hidden = items.length > 0;
    $("#lostEmpty").textContent = D.followers
      ? t("Nobody yet. After your next scan, anyone who unfollows you shows up here.")
      : t("Scan once and your followers are saved. From the next scan on, anyone who unfollows you shows up here.");
    $("#lostFeed").innerHTML = items.map((e) => `<li>${avatarHtml(e.a, e.n || e.h, 30)}<div class="f-text"><b>${U.esc(handleText(e))}</b> ${U.esc(t("unfollowed you"))}<small>${U.esc(t("noticed {ago}", { ago: U.ago(e.at) }))}</small></div><span class="f-dot fail"></span></li>`).join("");
  }

  // ---------- chart: following and followers over time --------------------
  // Two small multiples (one series each, own y-scale) sharing the time axis,
  // with a crosshair + tooltip. Following and followers differ a lot in size,
  // so one shared y-axis would flatten the smaller line.
  function renderChart() {
    const host = $("#chart");
    if (!host || D.page !== "overview") return;
    $$("#chartRange button").forEach((b) => b.classList.toggle("is-on", b.dataset.r === D.chartRange));
    const from = D.chartRange === "all" ? 0 : Date.now() - Number(D.chartRange) * DAY;
    const pts = D.scanLog.filter((p) => p && p.t >= from).sort((a, b) => a.t - b.t);
    const fg = pts.filter((p) => typeof p.fg === "number").map((p) => ({ t: p.t, v: p.fg }));
    const fl = pts.filter((p) => typeof p.fl === "number").map((p) => ({ t: p.t, v: p.fl }));
    const mu = pts.filter((p) => typeof p.mu === "number" && typeof p.fg === "number" && p.fg > 0);
    const enough = fg.length >= 2 || fl.length >= 2;
    $("#chartEmpty").hidden = enough;
    host.hidden = !enough;
    const stats = $("#chartStats");
    stats.innerHTML = "";
    const stat = (label, series, extra) => {
      if (!series.length) return;
      const last = series[series.length - 1].v, first = series[0].v, d = last - first;
      const el = document.createElement("span");
      el.className = "key";
      const sw = document.createElement("span"); sw.className = "sw"; sw.style.background = "var(--accent)";
      const b = document.createElement("b"); b.textContent = U.fmt(last);
      el.append(document.createTextNode(label + " "), b);
      if (series.length > 1) el.append(document.createTextNode(" (" + (d > 0 ? "+" : d < 0 ? "−" : "±") + U.fmt(Math.abs(d)) + ")"));
      if (extra) el.append(document.createTextNode(extra));
      stats.appendChild(el);
    };
    stat(t("Following"), fg);
    stat(t("Followers"), fl);
    if (mu.length) {
      const last = mu[mu.length - 1];
      const el = document.createElement("span");
      el.className = "key";
      const b = document.createElement("b"); b.textContent = Math.round(last.mu / last.fg * 100) + "%";
      el.append(document.createTextNode(t("Follow-back rate") + " "), b);
      stats.appendChild(el);
    }
    if (!enough) { host.innerHTML = ""; return; }

    const W = Math.max(280, host.clientWidth || 560);
    const panes = [[t("Following"), fg], [t("Followers"), fl]].filter(([, s]) => s.length >= 1);
    const H = 210, padL = 46, padR = 12, gap = 18, axisH = 20;
    const paneH = Math.floor((H - axisH - gap * (panes.length - 1)) / panes.length);
    const t0 = Math.min(...pts.map((p) => p.t)), t1 = Math.max(...pts.map((p) => p.t));
    const span = Math.max(1, t1 - t0);
    const x = (tt) => padL + ((tt - t0) / span) * (W - padL - padR);
    const NS = "http://www.w3.org/2000/svg";
    const el = (n, a) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, tabindex: "0", focusable: "true" });
    const yScales = [];
    panes.forEach(([label, s], pi) => {
      const top = pi * (paneH + gap);
      let lo = Math.min(...s.map((p) => p.v)), hi = Math.max(...s.map((p) => p.v));
      if (lo === hi) { lo -= 1; hi += 1; }
      const pad = (hi - lo) * 0.15;
      lo = Math.max(0, Math.floor(lo - pad)); hi = Math.ceil(hi + pad);
      const y = (v) => top + 6 + (1 - (v - lo) / (hi - lo)) * (paneH - 12);
      yScales.push({ y, s, top });
      const g = el("g", { class: "grid" });
      const ax = el("g", { class: "axis" });
      [lo, Math.round((lo + hi) / 2), hi].forEach((v) => {
        g.appendChild(el("line", { x1: padL, x2: W - padR, y1: y(v), y2: y(v) }));
        const tx = el("text", { x: padL - 6, y: y(v) + 4, "text-anchor": "end" });
        tx.textContent = U.compact(v);
        ax.appendChild(tx);
      });
      const name = el("text", { x: padL, y: top + 2, "text-anchor": "start", class: "pane-label" });
      name.textContent = label;
      ax.appendChild(name);
      svg.append(g, ax);
      const ser = el("g", { class: "series" });
      if (s.length > 1) {
        const d = s.map((p, i) => (i ? "L" : "M") + x(p.t).toFixed(1) + " " + y(p.v).toFixed(1)).join(" ");
        ser.appendChild(el("path", { class: "line", d, stroke: "var(--accent)" }));
      }
      const lp = s[s.length - 1];
      ser.appendChild(el("circle", { cx: x(lp.t), cy: y(lp.v), r: 4, fill: "var(--accent)" }));
      svg.appendChild(ser);
    });
    // time axis
    const ax = el("g", { class: "axis" });
    const ticks = span < 2 * DAY ? [t0, t1] : [t0, t0 + span / 2, t1];
    ticks.forEach((tt, i) => {
      const tx = el("text", { x: x(tt), y: H - 4, "text-anchor": i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle" });
      tx.textContent = new Date(tt).toLocaleDateString(U.locale(), { month: "short", day: "numeric" });
      ax.appendChild(tx);
    });
    svg.appendChild(ax);
    // crosshair + tooltip (also on keyboard focus: arrow keys move it)
    const hl = el("line", { class: "hover-line", y1: 0, y2: H - axisH, visibility: "hidden" });
    svg.appendChild(hl);
    host.innerHTML = "";
    host.appendChild(svg);
    const tip = document.createElement("div");
    tip.className = "chart-tip";
    tip.hidden = true;
    host.appendChild(tip);
    let idx = -1;
    const show = (i) => {
      idx = Math.max(0, Math.min(pts.length - 1, i));
      const p = pts[idx];
      const px = x(p.t);
      hl.setAttribute("x1", px); hl.setAttribute("x2", px); hl.setAttribute("visibility", "visible");
      tip.textContent = "";
      const date = document.createElement("div");
      date.textContent = new Date(p.t).toLocaleString(U.locale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      tip.appendChild(date);
      for (const [label, key] of [[t("Following"), "fg"], [t("Followers"), "fl"]]) {
        if (typeof p[key] !== "number") continue;
        const row = document.createElement("div");
        const v = document.createElement("b"); v.textContent = U.fmt(p[key]);
        row.append(v, document.createTextNode(" " + label));
        tip.appendChild(row);
      }
      tip.hidden = false;
      const left = Math.max(70, Math.min(W - 70, px));
      tip.style.left = left + "px";
      tip.style.top = "36px";
    };
    const hide = () => { hl.setAttribute("visibility", "hidden"); tip.hidden = true; };
    svg.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      const mx = (e.clientX - r.left) * (W / r.width);
      let best = 0, bd = Infinity;
      pts.forEach((p, i) => { const d = Math.abs(x(p.t) - mx); if (d < bd) { bd = d; best = i; } });
      show(best);
    });
    svg.addEventListener("pointerleave", hide);
    svg.addEventListener("focus", () => show(pts.length - 1));
    svg.addEventListener("blur", hide);
    svg.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); show(idx - 1); }
      if (e.key === "ArrowRight") { e.preventDefault(); show(idx + 1); }
    });
    // The same numbers as a table, for screen readers.
    const table = document.createElement("table");
    table.className = "sr-only";
    const head = document.createElement("tr");
    for (const h of [t("Date"), t("Following"), t("Followers")]) { const th = document.createElement("th"); th.textContent = h; head.appendChild(th); }
    table.appendChild(head);
    for (const p of pts) {
      const tr = document.createElement("tr");
      for (const v of [new Date(p.t).toLocaleDateString(U.locale()), p.fg != null ? U.fmt(p.fg) : "-", p.fl != null ? U.fmt(p.fl) : "-"]) {
        const td = document.createElement("td"); td.textContent = v; tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    host.appendChild(table);
  }

  // ---------- sidebar run card ----------
  function renderSide() {
    const S = D.S;
    if (!S) return;
    $("#version").textContent = "v" + S.version;
    const card = $("#sideRun");
    const j = S.job, sc = S.scan;
    const pill = $("#sideRunPill");
    if (sc && sc.status === "running") {
      card.hidden = false;
      pill.className = "pill is-scan";
      $("#sideRunText").textContent = t("Scanning");
      $("#sideRunNum").textContent = U.fmt(sc.fetched || 0);
      $("#sideRunBar").className = "bar is-scan is-live is-indeterminate";
      $("#sideRunMsg").textContent = sc.message || "";
    } else if (j && ["running", "resting", "paused", "halted"].includes(j.status)) {
      card.hidden = false;
      const map = { running: ["run", t("Running")], resting: ["rest", t("Resting")], paused: ["", t("Paused")], halted: ["halt", t("Needs you")] };
      pill.className = "pill" + (map[j.status][0] ? " is-" + map[j.status][0] : "");
      $("#sideRunText").textContent = map[j.status][1];
      $("#sideRunNum").textContent = `${U.fmt(j.done)}/${U.fmt(j.total)}`;
      const bar = $("#sideRunBar");
      bar.className = "bar" + (j.status === "running" ? " is-live" : j.status === "resting" ? " is-rest" : "");
      bar.firstElementChild.style.width = Math.max(2, j.total ? (j.index / j.total) * 100 : 0) + "%";
      $("#sideRunMsg").textContent = j.message || "";
    } else {
      card.hidden = true;
    }
    const wl = $("#navWl");
    wl.hidden = !D.wl.size;
    wl.textContent = U.compact(D.wl.size);
  }

  // ======================================================================
  // following: one table for every view
  //
  // Tabs: Don't follow back, Mutuals, Not blue, Inactive, All, Kept,
  // Unfollowed. "Not blue" and "Inactive" (the former Scanner page) use the
  // same rows, selection, whitelist, Keep rules and "Unfollow selected".
  // Groups and "More filters" narrow any tab further.
  // ======================================================================
  const AGE_MIN = { "30": 30, "90": 90, "180": 180, "365": 365 };

  // What is known about an account's last activity. Never guessed.
  function activityOf(u) {
    const r = D.act[u.i];
    if (!r) return { s: "unchecked" };
    if (r.s === "ok" && typeof r.t === "number") return { s: "ok", t: r.t, days: Math.max(0, Math.floor((Date.now() - r.t) / DAY)) };
    if (r.s === "none") return { s: "none", why: t("Never posted") };
    return { s: "na", why: r.w ? t(r.w) : t("Couldn't be read") };
  }
  const daysLabel = (d) => (d === 0 ? t("today") : tn(d, "{n} day ago", "{n} days ago"));
  const dayDate = (ts) => new Date(ts).toLocaleDateString(U.locale(), { month: "short", day: "numeric", year: "numeric" });
  const isIdle = () => D.seg === "idle";
  const idleLocked = () => isIdle() && D.idleAge === "na";   // unavailable: listed, never selectable

  function matchesChips(u) {
    for (const c of D.chips) {
      if (c === "noavatar" && !u.d) return false;
      if (c === "fewposts" && !(typeof u.sc === "number" && u.sc < 10)) return false;
      if (c === "fewfollowers" && !(typeof u.fc === "number" && u.fc < 50)) return false;
      if (c === "spammy" && !(typeof u.fr === "number" && typeof u.fc === "number" && u.fr >= 100 && u.fr >= 10 * Math.max(1, u.fc))) return false;
      if (c === "verified" && !u.v) return false;
      if (c === "private" && !u.p) return false;
    }
    return true;
  }

  // "More filters". Empty fields don't filter; unknown values never match a set filter.
  function activeFilters() {
    const f = D.f;
    const num = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v));
    return {
      minFc: num(f.minFc), maxFc: num(f.maxFc), ratio: num(f.ratio), age: f.age || "",
      bioIn: X7.parseKeywords(f.bioIn), bioOut: X7.parseKeywords(f.bioOut), script: f.script || ""
    };
  }
  function filterCount() {
    const a = activeFilters();
    return [a.minFc != null, a.maxFc != null, a.ratio != null, !!a.age, a.bioIn.length > 0, a.bioOut.length > 0, !!a.script].filter(Boolean).length;
  }
  function matchesFilters(u, a) {
    if (a.minFc != null && !(typeof u.fc === "number" && u.fc >= a.minFc)) return false;
    if (a.maxFc != null && !(typeof u.fc === "number" && u.fc <= a.maxFc)) return false;
    if (a.ratio != null && !(typeof u.fr === "number" && typeof u.fc === "number" && u.fr / Math.max(1, u.fc) >= a.ratio)) return false;
    if (a.age) {
      if (typeof u.ca !== "number") return false;
      const days = (Date.now() - u.ca) / DAY;
      if (a.age === "new30" && days > 30) return false;
      if (a.age === "new365" && days > 365) return false;
      if (a.age === "old5" && days < 5 * 365) return false;
      if (a.age === "old10" && days < 10 * 365) return false;
    }
    if (a.bioIn.length || a.bioOut.length) {
      const bio = String(u.b || "").toLowerCase();
      if (a.bioIn.length && !a.bioIn.some((k) => bio.includes(k))) return false;
      if (a.bioOut.some((k) => bio.includes(k))) return false;
    }
    if (a.script) {
      if (u._sc === undefined) u._sc = U.scriptOf((u.n || "") + " " + (u.b || ""));
      if (u._sc !== a.script) return false;
    }
    return true;
  }

  const groupOf = (id) => D.groups.find((g) => g.id === id) || null;

  function computeList() {
    const q = D.q.trim().toLowerCase().replace(/^@/, "");
    const c = { non: 0, mutual: 0, all: 0, kept: 0, done: 0, blue: 0, unknown: 0,
      a30: 0, a90: 0, a180: 0, a365: 0, na: 0, retry: 0, unchecked: 0, checked: 0 };
    const out = [];
    const flt = activeFilters();
    const nFilters = filterCount();
    const grp = D.group ? groupOf(D.group) : null;
    const inGroup = grp ? new Set(grp.ids) : null;
    for (let idx = 0; idx < D.users.length; idx++) {
      const u = D.users[idx];
      const isDone = D.done.has(u.i);
      const kept = !isDone && keepOf(u);
      const act = activityOf(u);
      if (isDone) c.done++;
      else {
        c.all++;
        if (u.fy === false) c.non++;
        if (u.fy === true) c.mutual++;
        if (kept) c.kept++;
        if (u.bv === false) c.blue++; else if (typeof u.bv !== "boolean") c.unknown++;
        if (act.s === "ok") { c.checked++; for (const k of [30, 90, 180, 365]) if (act.days >= k) c["a" + k]++; }
        else if (act.s === "na" || act.s === "none") {
          c.na++;
          if (act.s === "na" && !D.wl.has(u.h.toLowerCase())) c.retry++;   // "never posted" is definitive
        } else c.unchecked++;
      }
      let inSeg;
      switch (D.seg) {
        case "non": inSeg = !isDone && u.fy === false; break;
        case "mutual": inSeg = !isDone && u.fy === true; break;
        case "blue": inSeg = !isDone && u.bv === false; break;
        case "idle":
          inSeg = !isDone && (D.idleAge === "na" ? (act.s === "na" || act.s === "none") : (act.s === "ok" && act.days >= AGE_MIN[D.idleAge]));
          break;
        case "kept": inSeg = !!kept; break;
        case "done": inSeg = isDone; break;
        default: inSeg = !isDone;
      }
      if (!inSeg || !matchesChips(u)) continue;
      if (inGroup && !inGroup.has(u.i)) continue;
      if (nFilters && !matchesFilters(u, flt)) continue;
      if (q && !(u.h.toLowerCase().includes(q) || (u.n || "").toLowerCase().includes(q) || (u.b || "").toLowerCase().includes(q))) continue;
      out.push({ u, idx, kept, isDone, act });
    }
    if (isIdle()) {
      if (D.idleAge !== "na") {
        const dir = D.idleDir === "asc" ? 1 : -1;            // desc = most inactive first
        out.sort((a, b) => dir * (a.act.days - b.act.days) || a.idx - b.idx);
      }
    } else {
      const cmpNum = (a, b, f, dir) => {
        const x = a.u[f], y = b.u[f];
        if (x == null && y == null) return a.idx - b.idx;
        if (x == null) return 1;
        if (y == null) return -1;
        return dir * (x - y) || a.idx - b.idx;
      };
      switch (D.sort) {
        case "oldest": out.sort((a, b) => b.idx - a.idx); break;
        case "name": out.sort((a, b) => (a.u.n || a.u.h).localeCompare(b.u.n || b.u.h)); break;
        case "fcDesc": out.sort((a, b) => cmpNum(a, b, "fc", -1)); break;
        case "fcAsc": out.sort((a, b) => cmpNum(a, b, "fc", 1)); break;
        case "posts": out.sort((a, b) => cmpNum(a, b, "sc", 1)); break;
        case "joined": out.sort((a, b) => cmpNum(a, b, "ca", -1)); break;
        default: break;
      }
    }
    D.counts = c;
    const set = (id, n) => { $(id).textContent = U.compact(n); };
    set("#cNon", c.non); set("#cMutual", c.mutual); set("#cAll", c.all); set("#cKept", c.kept); set("#cDone", c.done);
    set("#cBlue", c.blue); set("#cIdle", c.a30);
    set("#cA30", c.a30); set("#cA90", c.a90); set("#cA180", c.a180); set("#cA365", c.a365); set("#cANa", c.na);
    return out;
  }

  function rowHtml(it) {
    const u = it.u;
    const sel = D.sel.has(u.i);
    const selectable = !it.kept && !it.isDone && !idleLocked();
    const tags = [];
    if (u.fy === true) tags.push(`<span class="tag ok">${U.esc(t("Follows you"))}</span>`);
    if (u.v && u.bv === false) tags.push(`<span class="tag info" title="${U.esc(t("Verified, but not with a Premium blue check"))}">${U.esc(t("Verified (not blue)"))}</span>`);
    else if (u.v) tags.push(`<span class="tag info">${U.esc(t("Verified"))}</span>`);
    if (u.p) tags.push(`<span class="tag">${U.esc(t("Private"))}</span>`);
    if (it.isDone) tags.push(`<span class="tag">${U.esc(t("Unfollowed"))}</span>`);
    else if (it.kept && it.kept !== "whitelist") tags.push(`<span class="tag warn">${U.esc(t("Kept: {why}", { why: KEEP_LABEL()[it.kept] || it.kept }))}</span>`);
    const wl = D.wl.has(u.h.toLowerCase());
    const keepCls = wl ? "is-on" : (it.kept ? "is-rule" : "");
    const keepTitle = wl ? t("On your whitelist - click to remove") : (it.kept ? t("Kept by a Keep rule ({why})", { why: KEEP_LABEL()[it.kept] || it.kept }) : t("Add to whitelist"));
    let last;
    if (!isIdle()) last = `<span class="num-cell joined-cell">${U.esc(monthYear(u.ca))}</span>`;
    else if (it.act.s === "ok") {
      last = `<span class="num-cell joined-cell last-cell" title="${U.esc(t("Last active: {when} ({date})", { when: daysLabel(it.act.days), date: dayDate(it.act.t) }))}"><b>${U.esc(daysLabel(it.act.days))}</b><small>${U.esc(dayDate(it.act.t))}</small></span>`;
    } else {
      last = `<span class="num-cell joined-cell last-cell is-na" title="${U.esc(it.act.why || t("Not checked"))}"><b>${U.esc(t("Unavailable"))}</b><small>${U.esc(it.act.why || t("Not checked"))}</small></span>`;
    }
    return `<div class="row${sel ? " is-sel" : ""}${it.isDone ? " is-done" : ""}" data-id="${U.esc(u.i)}">
      <label class="cb"><input type="checkbox" class="rowcb" ${sel ? "checked" : ""} ${selectable ? "" : "disabled"}><span></span></label>
      <div class="who-cell">${avatarHtml(u.a, u.n || u.h, 40)}
        <div class="who-text">
          <div class="who-line"><b>${U.esc(u.n || u.h)}</b><a href="https://x.com/${encodeURIComponent(u.h)}" target="_blank" rel="noopener">@${U.esc(u.h)}</a><span class="tags">${tags.join("")}</span></div>
          <div class="bio"><bdi>${U.esc(u.b || "")}</bdi></div>
        </div>
      </div>
      <span class="num-cell fc-cell">${U.compact(u.fc)}</span>
      <span class="num-cell posts-cell">${U.compact(u.sc)}</span>
      ${last}
      <span class="keep-cell"><button class="keep-btn ${keepCls}" title="${U.esc(keepTitle)}" data-keep="${U.esc(u.h)}">${U.icon("shield")}</button></span>
    </div>`;
  }

  const SEG_TEXT = () => ({
    blue: t("Accounts you follow without X Premium's blue check. Legacy and organization checks aren't blue, so they show up too (tagged) - your Keep rules still protect them."),
    idle: t("Accounts whose most recent post, reply or repost is at least 30 days old. Pick how far back, and sort by how long they've been quiet.")
  });

  function renderActPanel() {
    const act = D.S && D.S.act;
    const c = D.counts || { checked: 0, na: 0, retry: 0, unchecked: 0 };
    const running = !!(act && act.status === "running");
    const j = D.S && D.S.job, sc = D.S && D.S.scan, fol = D.S && D.S.fol;
    const blocked = !!((j && ["running", "resting", "paused", "halted"].includes(j.status)) || (sc && sc.status === "running") || (fol && fol.status === "running"));
    const bar = $("#actBar");
    bar.hidden = !running;
    if (running) bar.firstElementChild.style.width = Math.max(2, act.total ? (act.index / act.total) * 100 : 0) + "%";
    $("#actTitle").textContent = running ? t("Checking activity...") : t("Last-active check");
    let text;
    if (running) text = (blocked ? t("Waiting for the current scan, run or followers check to finish.") + " " : "") + (act.message || "");
    else if (!c.checked && !c.na) text = t("Not checked yet. It reads one profile at a time in the background - you can close this tab.");
    else {
      text = t("{read} read · {na} unavailable · {left} not checked yet.", { read: U.fmt(c.checked), na: U.fmt(c.na), left: U.fmt(c.unchecked) });
      if (act && (act.status === "error" || act.status === "stopped") && act.message) text += " " + act.message;
    }
    $("#actText").textContent = text;
    $("#actScope").disabled = running;
    const go = $("#actGo");
    go.hidden = running;
    go.querySelector("span").textContent = c.checked || c.na ? t("Check remaining") : t("Check activity");
    $("#actStop").hidden = !running;
    const retry = $("#actRetry");
    retry.hidden = running || !c.retry;
    retry.querySelector("span").textContent = t("Retry unavailable ({n})", { n: U.compact(c.retry) });
  }

  function emptyText() {
    const c = D.counts || {};
    if (D.q.trim()) return t("No accounts match your search.");
    if (D.group || filterCount()) return t("No accounts match these filters.");
    if (D.seg === "blue") return c.unknown && !c.blue ? t("Premium-check information is missing - rescan to detect it.") : t("Every account you follow has a Premium blue check.");
    if (isIdle()) {
      if (D.idleAge === "na") return t("Nothing unavailable. Every account that was checked has a readable last post.");
      return c.checked || c.na ? t("No checked accounts are that inactive.") : t("Run the last-active check above to find inactive accounts.");
    }
    return t("No accounts match these filters.");
  }

  function renderGroups() {
    const sel = $("#flGroup");
    const cur = D.group;
    sel.innerHTML = "";
    const all = document.createElement("option");
    all.value = ""; all.textContent = t("All accounts");
    sel.appendChild(all);
    for (const g of D.groups) {
      const o = document.createElement("option");
      o.value = g.id;
      o.textContent = `${g.name} (${U.fmt(g.ids.length)})`;
      sel.appendChild(o);
    }
    if (cur && !groupOf(cur)) D.group = "";
    sel.value = D.group;
    sel.hidden = !D.groups.length;
    const dl = $("#groupNames");
    dl.innerHTML = "";
    for (const g of D.groups) { const o = document.createElement("option"); o.value = g.name; dl.appendChild(o); }
    const bar = $("#flGroupBar");
    const g = D.group ? groupOf(D.group) : null;
    bar.hidden = !g;
    if (g) {
      $("#flGroupName").textContent = g.name;
      const inScan = g.ids.filter((id) => D.byId.has(id)).length;
      $("#flGroupCount").textContent = tn(inScan, "{n} account in your last scan", "{n} accounts in your last scan");
    }
  }

  function renderFollowing(reset) {
    const hasScan = D.users.length > 0;
    $("#flEmpty").hidden = hasScan;
    $("#flBody").hidden = !hasScan;
    const sc = D.S && D.S.scan;
    const acc = D.S && D.S.account;
    const otherAccount = sc && acc && acc.id && sc.ownerId && sc.ownerId !== acc.id;
    $("#flSub").textContent = hasScan && sc && sc.finishedAt
      ? t("{n} accounts · scanned {ago}", { n: U.fmt(D.users.length), ago: U.ago(sc.finishedAt) }) + (sc.partial ? " " + t("(partial)") : "") +
        (otherAccount ? " · " + t("this scan is from a different X account - rescan") : "")
      : t("Review everyone you follow, choose who goes, protect who stays.");
    if (!hasScan) { $("#bulk").hidden = true; return; }

    const idle = isIdle();
    $$("#flSeg button").forEach((x) => x.classList.toggle("is-on", x.dataset.f === D.seg));
    keepTabVisible($("#flSeg"));
    $$("#flAge button").forEach((x) => x.classList.toggle("is-on", x.dataset.a === D.idleAge));
    $("#flAct").hidden = !idle;
    $("#flAge").hidden = !idle;
    $("#flIdleSort").hidden = !idle;
    $("#flIdleSort").value = D.idleDir;
    $("#flIdleSort").disabled = D.idleAge === "na";
    $("#flSort").hidden = idle;
    $("#flColLast").textContent = idle ? t("Last active") : t("Joined");
    $("#flTable").classList.toggle("is-idle", idle);
    renderGroups();
    const nF = filterCount();
    $("#flFiltersN").hidden = !nF;
    $("#flFiltersN").textContent = String(nF);
    $("#flFiltersBtn").classList.toggle("is-on", !$("#flFilters").hidden || nF > 0);

    if (reset) {
      D.list = computeList();
      D.shown = 0;
      $("#flRows").innerHTML = "";
      renderMoreRows();
    } else if (idle) computeList();          // keep counts and the panel current while results stream in
    const c = D.counts || {};
    const note = $("#flNote");
    const segText = SEG_TEXT();
    note.hidden = !segText[D.seg];
    note.textContent = segText[D.seg] || "";
    const unk = $("#flUnknown");
    unk.hidden = !(D.seg === "blue" && c.unknown > 0);
    unk.textContent = c.unknown > 0
      ? tn(c.unknown, "{n} account has no Premium-check information (scanned before this version, or X didn't report it). It's left out rather than guessed - rescan to include it.",
          "{n} accounts have no Premium-check information (scanned before this version, or X didn't report it). They're left out rather than guessed - rescan to include them.")
      : "";
    if (idle) renderActPanel();
    const none = $("#flNone");
    none.hidden = D.list.length > 0;
    none.textContent = emptyText();
    syncSelectAll();
    renderBulk();
  }

  // Narrow windows scroll the tab bar sideways; keep the active tab in view
  // (horizontally only - the page itself never jumps).
  function keepTabVisible(seg) {
    const on = seg && seg.querySelector(".is-on");
    if (!on || seg.scrollWidth <= seg.clientWidth) return;
    const rtl = document.documentElement.dir === "rtl";
    if (rtl) { on.scrollIntoView({ block: "nearest", inline: "nearest" }); return; }
    const l = on.offsetLeft - seg.offsetLeft, r = l + on.offsetWidth;
    if (l < seg.scrollLeft) seg.scrollLeft = Math.max(0, l - 16);
    else if (r > seg.scrollLeft + seg.clientWidth) seg.scrollLeft = r - seg.clientWidth + 16;
  }

  function renderMoreRows() {
    if (D.shown >= D.list.length) return;
    const next = D.list.slice(D.shown, D.shown + CHUNK);
    $("#flRows").insertAdjacentHTML("beforeend", next.map(rowHtml).join(""));
    D.shown += next.length;
  }

  const moreObs = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    if (D.page === "following") renderMoreRows();
    if (D.page === "history") renderMoreHistory();
    if (D.page === "followers") renderMoreFollowers();
  }, { rootMargin: "600px" });

  function selectable() { return idleLocked() ? [] : D.list.filter((it) => !it.kept && !it.isDone); }

  function syncSelectAll() {
    const all = $("#flAll");
    const sel = selectable();
    const n = sel.filter((it) => D.sel.has(it.u.i)).length;
    all.checked = sel.length > 0 && n === sel.length;
    all.indeterminate = n > 0 && n < sel.length;
    all.disabled = sel.length === 0;
  }

  function renderBulk() {
    const n = D.sel.size;
    $("#bulk").hidden = n === 0 || D.page !== "following";
    $("#bulkCount").textContent = t("{n} selected", { n: U.fmt(n) });
  }

  function updateRowSel(id) {
    const row = $(`#flRows .row[data-id="${CSS.escape(id)}"]`);
    if (!row) return;
    const on = D.sel.has(id);
    row.classList.toggle("is-sel", on);
    const cb = row.querySelector(".rowcb");
    if (cb) cb.checked = on;
  }

  async function toggleWhitelist(handle) {
    const k = handle.toLowerCase();
    if (D.wl.has(k)) { D.wl.delete(k); U.toast(t("@{h} removed from whitelist", { h: handle })); }
    else {
      D.wl.add(k);
      const u = D.users.find((x) => x.h.toLowerCase() === k);
      if (u) D.sel.delete(u.i);
      U.toast(t("@{h} will never be unfollowed", { h: handle }), "ok");
    }
    await saveWl();
  }

  function exportUsers(items, name) {
    const rows = items.map(({ u }) => {
      const a = activityOf(u);
      return [
        u.h, u.n, "https://x.com/" + u.h, u.fy === true ? "yes" : u.fy === false ? "no" : "unknown",
        u.fc ?? "", u.fr ?? "", u.sc ?? "", u.v ? "yes" : "no",
        u.bv === true ? "yes" : u.bv === false ? "no" : "unknown", u.p ? "yes" : "no",
        u.ca ? new Date(u.ca).toISOString().slice(0, 10) : "",
        a.s === "ok" ? new Date(a.t).toISOString().slice(0, 10) : "",
        a.s === "ok" ? a.days : "",
        a.s === "ok" ? "" : (a.s === "unchecked" ? "not checked" : a.why || ""),
        u.b || ""
      ];
    });
    const csv = U.csv(["handle", "name", "profile_url", "follows_you", "followers", "following", "posts", "verified",
      "premium_blue_check", "private", "joined", "last_post_date", "days_inactive", "activity_note", "bio"], rows);
    U.download(`x-${name}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  function setSeg(seg) {
    if (seg === D.seg) return;
    D.seg = seg;
    D.sel.clear();
    renderFollowing(true);
  }

  // ---------- groups ----------
  function askGroupName() {
    return new Promise((resolve) => {
      const box = $("#groupAsk"), input = $("#groupName");
      input.value = "";
      box.hidden = false;
      setTimeout(() => input.focus(), 30);
      const done = (v) => {
        box.hidden = true;
        $("#groupOk").removeEventListener("click", ok);
        $("#groupCancel").removeEventListener("click", no);
        box.removeEventListener("click", outside);
        input.removeEventListener("keydown", key);
        resolve(v);
      };
      const ok = () => { const v = input.value.trim().slice(0, 40); if (v) done(v); else input.focus(); };
      const no = () => done(null);
      const outside = (e) => { if (e.target === box) done(null); };
      const key = (e) => { if (e.key === "Enter") ok(); if (e.key === "Escape") no(); };
      $("#groupOk").addEventListener("click", ok);
      $("#groupCancel").addEventListener("click", no);
      box.addEventListener("click", outside);
      input.addEventListener("keydown", key);
    });
  }

  async function saveGroup(name, ids) {
    const groups = D.groups.slice();
    const k = name.toLowerCase();
    let g = groups.find((x) => x.name.toLowerCase() === k);
    if (g) g.ids = [...new Set(g.ids.concat(ids))];
    else { g = { id: "g" + Date.now().toString(36), name, ids: [...new Set(ids)], at: Date.now() }; groups.push(g); }
    D.groups = groups;
    await U.set({ [K.groups]: groups });
    return g;
  }

  function wireFollowing() {
    let qTimer = null;
    $("#flSearch").addEventListener("input", (e) => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => { D.q = e.target.value; renderFollowing(true); }, 140);
    });
    $("#flSeg").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-f]");
      if (b) setSeg(b.dataset.f);
    });
    $("#flAge").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-a]");
      if (!b || b.dataset.a === D.idleAge) return;
      D.idleAge = b.dataset.a;
      D.sel.clear();
      renderFollowing(true);
    });
    $("#flChips").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-x]");
      if (!b) return;
      const k = b.dataset.x;
      if (D.chips.has(k)) D.chips.delete(k); else D.chips.add(k);
      b.classList.toggle("is-on", D.chips.has(k));
      renderFollowing(true);
    });
    $("#flSort").addEventListener("change", (e) => { D.sort = e.target.value; renderFollowing(true); });
    $("#flIdleSort").addEventListener("change", (e) => { D.idleDir = e.target.value === "asc" ? "asc" : "desc"; renderFollowing(true); });

    // More filters
    $("#flFiltersBtn").addEventListener("click", () => {
      const p = $("#flFilters");
      p.hidden = !p.hidden;
      $("#flFiltersBtn").classList.toggle("is-on", !p.hidden || filterCount() > 0);
    });
    const FIELDS = { fMinFc: "minFc", fMaxFc: "maxFc", fRatio: "ratio", fAge: "age", fBioIn: "bioIn", fBioOut: "bioOut", fScript: "script" };
    let fTimer = null;
    for (const [id, key] of Object.entries(FIELDS)) {
      const el = $("#" + id);
      el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => {
        D.f[key] = el.value;
        clearTimeout(fTimer);
        fTimer = setTimeout(() => { D.sel.clear(); renderFollowing(true); }, 200);
      });
    }
    $("#fClear").addEventListener("click", () => {
      for (const [id, key] of Object.entries(FIELDS)) { $("#" + id).value = ""; D.f[key] = ""; }
      D.sel.clear();
      renderFollowing(true);
    });

    // Groups
    $("#flGroup").addEventListener("change", (e) => { D.group = e.target.value; D.sel.clear(); renderFollowing(true); });
    $("#grpSelect").addEventListener("click", () => {
      for (const it of selectable()) D.sel.add(it.u.i);
      $$("#flRows .row").forEach((r) => updateRowSel(r.dataset.id));
      syncSelectAll(); renderBulk();
    });
    $("#grpKeep").addEventListener("click", async () => {
      const g = groupOf(D.group);
      if (!g) return;
      let n = 0;
      for (const id of g.ids) { const u = D.byId.get(id); if (u && !D.wl.has(u.h.toLowerCase())) { D.wl.add(u.h.toLowerCase()); n++; } }
      await saveWl();
      U.toast(tn(n, "{n} added to your whitelist", "{n} added to your whitelist"), "ok");
    });
    $("#grpExport").addEventListener("click", () => {
      const g = groupOf(D.group);
      if (!g) return;
      exportUsers(g.ids.map((id) => ({ u: D.byId.get(id) })).filter((x) => x.u), "group-" + g.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    });
    $("#grpDelete").addEventListener("click", async () => {
      const g = groupOf(D.group);
      if (!g) return;
      if (!await confirmBox({ title: t("Delete the group \"{name}\"?", { name: g.name }), body: t("Only the group is deleted. Nobody is followed or unfollowed."), ok: t("Delete group"), danger: true, icon: "trash" })) return;
      D.groups = D.groups.filter((x) => x.id !== g.id);
      D.group = "";
      await U.set({ [K.groups]: D.groups });
      U.toast(t("Group deleted."));
    });

    $("#flRows").addEventListener("change", (e) => {
      if (!e.target.classList.contains("rowcb")) return;
      const id = e.target.closest(".row").dataset.id;
      if (e.target.checked) D.sel.add(id); else D.sel.delete(id);
      updateRowSel(id);
      syncSelectAll();
      renderBulk();
    });
    $("#flRows").addEventListener("click", (e) => {
      const k = e.target.closest("[data-keep]");
      if (!k || k.classList.contains("is-rule")) return;
      toggleWhitelist(k.dataset.keep);
    });
    $("#flAll").addEventListener("change", (e) => {
      for (const it of selectable()) { if (e.target.checked) D.sel.add(it.u.i); else D.sel.delete(it.u.i); }
      $$("#flRows .row").forEach((r) => updateRowSel(r.dataset.id));
      syncSelectAll();
      renderBulk();
    });

    $("#bulkClear").addEventListener("click", () => {
      D.sel.clear();
      $$("#flRows .row").forEach((r) => updateRowSel(r.dataset.id));
      syncSelectAll(); renderBulk();
    });
    $("#bulkKeep").addEventListener("click", async () => {
      for (const id of D.sel) { const u = D.byId.get(id); if (u) D.wl.add(u.h.toLowerCase()); }
      const n = D.sel.size;
      D.sel.clear();
      await saveWl();
      U.toast(tn(n, "{n} added to your whitelist", "{n} added to your whitelist"), "ok");
    });
    $("#bulkGroup").addEventListener("click", async () => {
      const ids = [...D.sel];
      if (!ids.length) return;
      const name = await askGroupName();
      if (!name) return;
      const g = await saveGroup(name, ids);
      U.toast(tn(g.ids.length, "Saved - \"{name}\" has {n} account.", "Saved - \"{name}\" has {n} accounts.", { name: g.name }), "ok");
    });
    $("#bulkExport").addEventListener("click", () => {
      exportUsers([...D.sel].map((id) => ({ u: D.byId.get(id) })).filter((x) => x.u), "selected");
    });
    $("#bulkRun").addEventListener("click", async () => {
      const ids = [...D.sel];
      if (await startRun({ source: "ids", ids }, ids.length, t("Only the accounts you selected. Whitelisted accounts are always skipped."))) {
        D.sel.clear();
        renderBulk();
      }
    });
    $("#flExport").addEventListener("click", () => {
      const names = { non: "non-followers", blue: "non-blue-verified", idle: D.idleAge === "na" ? "activity-unavailable" : `inactive-${D.idleAge}d-plus` };
      exportUsers(D.list, names[D.seg] || D.seg);
    });
    $("#flScan").addEventListener("click", () => startScan());
    $("#flEmptyScan").addEventListener("click", () => startScan());

    const startCheck = async (retry) => {
      const r = await U.cmd("actStart", { scope: $("#actScope").value, retry });
      if (!r.ok) U.toast(r.error || t("Couldn't start the check."), "err", 6000);
      else if (r.none) U.toast(retry ? t("Nothing to retry.") : t("Everything in this scope is already up to date."));
      else if (!r.already) U.toast(tn(r.total, "Checking {n} account...", "Checking {n} accounts..."), "ok");
      await refreshState();
    };
    $("#actGo").addEventListener("click", () => startCheck(false));
    $("#actRetry").addEventListener("click", () => startCheck(true));
    $("#actStop").addEventListener("click", async () => { await U.cmd("actStop"); await refreshState(); });
    moreObs.observe($("#flMore"));
  }

  // ======================================================================
  // followers: who unfollowed you, new followers, fans
  // ======================================================================
  function computeFollowers() {
    const q = D.fo.q.trim().toLowerCase().replace(/^@/, "");
    const { lost, gained } = followerState();
    const following = followingSet();
    const followedSince = new Set();
    const at = D.followers ? D.followers.at : 0;
    for (const h of D.history) if (h.k === "f" && h.i && h.t > at) followedSince.add(h.i);
    const fans = D.followers ? (D.followers.fans || []).filter((u) => !following.has(u.i) && !followedSince.has(u.i)) : [];
    const lostDone = new Set(lost.map((e) => e.i));
    const gainedFiltered = gained.filter((e) => !lostDone.has(e.i));
    const c = { lost: lost.length, gained: gainedFiltered.length, fans: fans.length };
    let list;
    if (D.fo.seg === "lost") list = lost.map((e) => ({ u: e, ev: e, canAct: following.has(e.i), act: "unfollow" }));
    else if (D.fo.seg === "gained") list = gainedFiltered.map((e) => ({ u: e, ev: e, canAct: !following.has(e.i), act: "follow" }));
    else list = fans.map((u) => ({ u, ev: null, canAct: true, act: "follow" }));
    if (q) list = list.filter((it) => String(it.u.h || "").toLowerCase().includes(q) || String(it.u.n || "").toLowerCase().includes(q) || String(it.u.b || "").toLowerCase().includes(q));
    $("#cLost").textContent = U.compact(c.lost);
    $("#cGained").textContent = U.compact(c.gained);
    $("#cFans").textContent = U.compact(c.fans);
    return list;
  }

  // "Oct 22 – Oct 29" (the year only when it isn't this year)
  function rangeText(a, b) {
    const da = new Date(a), db = new Date(b), y = new Date().getFullYear();
    const opt = da.getFullYear() === y && db.getFullYear() === y ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" };
    const fa = da.toLocaleDateString(U.locale(), opt), fb = db.toLocaleDateString(U.locale(), opt);
    return fa === fb ? fb : fa + " – " + fb;
  }

  function foRowHtml(it) {
    const u = it.u;
    const sel = D.fo.sel.has(u.i);
    const tags = [];
    if (it.ev && it.ev.fw) tags.push(`<span class="tag info">${U.esc(t("You follow them"))}</span>`);
    if (u.v) tags.push(`<span class="tag info">${U.esc(t("Verified"))}</span>`);
    if (u.p) tags.push(`<span class="tag">${U.esc(t("Private"))}</span>`);
    let when;
    if (it.ev) {
      const range = rangeText(it.ev.from || it.ev.at, it.ev.at);
      const title = it.ev.from ? t("Between your checks on {a} and {b}", { a: U.date(it.ev.from), b: U.date(it.ev.at) }) : U.date(it.ev.at);
      when = `<span class="when-cell" title="${U.esc(title)}"><b>${U.esc(U.ago(it.ev.at))}</b><small>${U.esc(range)}</small></span>`;
    } else {
      when = `<span class="when-cell"><b>${U.esc(monthYear(u.ca))}</b><small>${U.esc(t("joined X"))}</small></span>`;
    }
    return `<div class="row${sel ? " is-sel" : ""}" data-id="${U.esc(u.i)}">
      <label class="cb"><input type="checkbox" class="rowcb" ${sel ? "checked" : ""} ${it.canAct ? "" : "disabled"}><span></span></label>
      <div class="who-cell">${avatarHtml(u.a, u.n || u.h, 40)}
        <div class="who-text">
          <div class="who-line"><b>${U.esc(u.n || handleText(u))}</b><a href="${U.esc(profileUrl(u))}" target="_blank" rel="noopener">${U.esc(handleText(u))}</a><span class="tags">${tags.join("")}</span></div>
          <div class="bio"><bdi>${U.esc(u.b || "")}</bdi></div>
        </div>
      </div>
      <span class="num-cell fc-cell">${U.compact(u.fc)}</span>
      ${when}
    </div>`;
  }

  function renderFollowersHead() {
    const S = D.S;
    if (!S) return;
    const fol = S.fol;
    const running = !!(fol && fol.status === "running");
    const acc = S.account;
    const big = acc && acc.followers != null && acc.followers > (S.followersAutoMax || 20000);
    const box = $("#foStatus");
    const showMsg = running || (fol && ["partial", "error", "stopped"].includes(fol.status) && fol.message);
    box.hidden = !showMsg;
    $("#foStop").hidden = !running;
    $("#foBar").hidden = !running;
    if (running) {
      $("#foPill").className = "pill is-scan";
      $("#foPillText").textContent = t("Checking followers");
      const bar = $("#foBar");
      if (fol.expected) {
        bar.classList.remove("is-indeterminate");
        bar.firstElementChild.style.width = Math.min(98, Math.max(3, (fol.read || 0) / fol.expected * 100)) + "%";
      } else bar.classList.add("is-indeterminate");
    } else if (fol) {
      $("#foPill").className = "pill " + (fol.status === "error" ? "is-halt" : "is-rest");
      $("#foPillText").textContent = fol.status === "partial" ? t("Not compared") : fol.status === "error" ? t("Couldn't check") : t("Stopped");
    }
    $("#foMsg").textContent = showMsg ? fol.message || "" : "";
    $("#foCheck").disabled = running;
    const parts = [];
    if (D.followers) {
      parts.push(tn(D.followers.total, "{n} follower", "{n} followers"));
      parts.push(t("checked {ago}", { ago: U.ago(D.followers.at) }));
    }
    if (big) parts.push(t("checked only when you press Check now (big accounts take a while)"));
    else if (!settings().trackFollowers) parts.push(t("automatic check is off in Settings"));
    $("#foSub").textContent = parts.length ? parts.join(" · ") : t("See who unfollowed you, who's new, and who you don't follow back.");

    const hasData = !!D.followers;
    $("#foEmpty").hidden = hasData || running;
    $("#foBody").hidden = !hasData;
    if (!hasData && !running) {
      const sc = S.scan && S.scan.status === "done";
      $("#foEmptyGo").querySelector("span").textContent = sc ? t("Check followers now") : t("Scan now");
      $("#foEmptyText").textContent = big
        ? t("Your account has {n} followers, so they're only read when you ask - X limits how fast they can be read, so it can take a while. The first check saves them; from the next one on, everyone who unfollowed you is listed here.", { n: U.fmt(acc.followers) })
        : t("After a scan, the extension reads your followers. From the next scan on, everyone who unfollowed you since is listed here - plus your new followers and the people you don't follow back.");
    }
  }

  const FO_NOTE = () => ({
    lost: t("Everyone missing from your followers since the previous check (X hides suspended and deleted accounts too). Select people you still follow to unfollow them."),
    gained: t("People who started following you since the previous check. Select anyone to follow them back."),
    fans: t("People who follow you that you don't follow back. Select anyone to follow them back.")
  });
  const FO_WHEN = () => ({ lost: t("Noticed"), gained: t("Noticed"), fans: t("Joined") });

  function renderFollowers(reset) {
    renderFollowersHead();
    if (!D.followers) { renderFoBulk(); return; }
    $$("#foSeg button").forEach((b) => b.classList.toggle("is-on", b.dataset.f === D.fo.seg));
    $("#foNote").textContent = FO_NOTE()[D.fo.seg];
    $("#foColWhen").textContent = FO_WHEN()[D.fo.seg];
    if (reset) {
      D.fo.list = computeFollowers();
      for (const id of [...D.fo.sel]) if (!D.fo.list.some((it) => it.u.i === id && it.canAct)) D.fo.sel.delete(id);
      D.fo.shown = 0;
      $("#foRows").innerHTML = "";
      renderMoreFollowers();
    }
    const none = $("#foNone");
    none.hidden = D.fo.list.length > 0;
    none.textContent = D.fo.q.trim() ? t("No accounts match your search.")
      : D.fo.seg === "lost" ? t("Nobody unfollowed you since your followers were first saved.")
      : D.fo.seg === "gained" ? t("No new followers since your followers were first saved.")
      : t("You follow everyone who follows you.");
    syncFoAll();
    renderFoBulk();
  }

  function renderMoreFollowers() {
    if (D.fo.shown >= D.fo.list.length) return;
    const next = D.fo.list.slice(D.fo.shown, D.fo.shown + CHUNK);
    $("#foRows").insertAdjacentHTML("beforeend", next.map(foRowHtml).join(""));
    D.fo.shown += next.length;
  }

  function syncFoAll() {
    const all = $("#foAll");
    const can = D.fo.list.filter((it) => it.canAct);
    const n = can.filter((it) => D.fo.sel.has(it.u.i)).length;
    all.checked = can.length > 0 && n === can.length;
    all.indeterminate = n > 0 && n < can.length;
    all.disabled = can.length === 0;
  }

  function renderFoBulk() {
    const n = D.fo.sel.size;
    $("#foBulk").hidden = n === 0 || D.page !== "followers";
    $("#foBulkCount").textContent = t("{n} selected", { n: U.fmt(n) });
    const unf = D.fo.seg === "lost";
    $("#foBulkRunLabel").textContent = unf ? t("Unfollow selected") : t("Follow back");
    const run = $("#foBulkRun");
    run.dataset.icon = unf ? "userX" : "userPlus";
    const ic = run.querySelector("svg");
    if (ic) ic.outerHTML = U.icon(unf ? "userX" : "userPlus");
  }

  function wireFollowers() {
    $("#foSeg").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-f]");
      if (!b || b.dataset.f === D.fo.seg) return;
      D.fo.seg = b.dataset.f;
      D.fo.sel.clear();
      renderFollowers(true);
    });
    let q = null;
    $("#foSearch").addEventListener("input", (e) => {
      clearTimeout(q);
      q = setTimeout(() => { D.fo.q = e.target.value; renderFollowers(true); }, 140);
    });
    $("#foRows").addEventListener("change", (e) => {
      if (!e.target.classList.contains("rowcb")) return;
      const row = e.target.closest(".row");
      const id = row.dataset.id;
      if (e.target.checked) D.fo.sel.add(id); else D.fo.sel.delete(id);
      row.classList.toggle("is-sel", e.target.checked);
      syncFoAll();
      renderFoBulk();
    });
    $("#foAll").addEventListener("change", (e) => {
      for (const it of D.fo.list) if (it.canAct) { if (e.target.checked) D.fo.sel.add(it.u.i); else D.fo.sel.delete(it.u.i); }
      $$("#foRows .row").forEach((r) => {
        const on = D.fo.sel.has(r.dataset.id);
        r.classList.toggle("is-sel", on);
        const cb = r.querySelector(".rowcb"); if (cb) cb.checked = on;
      });
      syncFoAll();
      renderFoBulk();
    });
    $("#foBulkClear").addEventListener("click", () => { D.fo.sel.clear(); renderFollowers(true); });
    const selected = () => D.fo.list.filter((it) => D.fo.sel.has(it.u.i) && it.canAct);
    $("#foBulkExport").addEventListener("click", () => exportFollowers(selected(), "selected"));
    $("#foExport").addEventListener("click", () => exportFollowers(D.fo.list, D.fo.seg === "lost" ? "unfollowed-you" : D.fo.seg === "gained" ? "new-followers" : "dont-follow-back"));
    $("#foBulkRun").addEventListener("click", async () => {
      const items = selected();
      if (!items.length) return;
      if (D.fo.seg === "lost") {
        const ids = items.map((it) => it.u.i);
        if (await startRun({ source: "ids", ids }, ids.length, t("Only the accounts you selected. Whitelisted accounts are always skipped."))) { D.fo.sel.clear(); renderFoBulk(); }
      } else {
        const targets = items.map((it) => ({ i: it.u.i, h: it.u.h, n: it.u.n || "", a: it.u.a || "" }));
        if (await startRun({ source: "followback", targets }, targets.length, t("Follows use the same safe pacing and count towards your daily limit."), true)) { D.fo.sel.clear(); renderFoBulk(); }
      }
    });
    const check = async () => {
      const r = await U.cmd("folStart");
      if (!r.ok) U.toast(r.error || t("Couldn't start the check."), "err", 6000);
      else if (!r.already) U.toast(t("Reading your followers..."), "ok");
      await refreshState();
    };
    $("#foCheck").addEventListener("click", check);
    $("#foStop").addEventListener("click", async () => { await U.cmd("folStop"); await refreshState(); });
    $("#foEmptyGo").addEventListener("click", () => (D.S && D.S.scan && D.S.scan.status === "done" ? check() : startScan()));
    moreObs.observe($("#foMore"));
  }

  function exportFollowers(items, name) {
    const rows = items.map(({ u, ev }) => [
      u.h || "", u.n || "", profileUrl(u), u.fc ?? "",
      ev ? (ev.k === "lost" ? "unfollowed you" : "followed you") : "follows you",
      ev ? new Date(ev.at).toISOString().slice(0, 10) : "", ev && ev.from ? new Date(ev.from).toISOString().slice(0, 10) : "",
      ev ? (ev.fw ? "yes" : "no") : "no"
    ]);
    U.download(`x-${name}-${new Date().toISOString().slice(0, 10)}.csv`,
      U.csv(["handle", "name", "profile_url", "followers", "change", "noticed", "previous_check", "you_follow_them"], rows));
  }

  // ======================================================================
  // whitelist
  // ======================================================================
  function renderWhitelist() {
    const q = $("#wlSearch").value.trim().toLowerCase().replace(/^@/, "");
    const list = [...D.wl].sort().filter((h) => !q || h.includes(q));
    $("#wlCount").textContent = U.fmt(D.wl.size);
    $("#wlEmpty").hidden = list.length > 0;
    const byH = new Map(D.users.map((u) => [u.h.toLowerCase(), u]));
    $("#wlList").innerHTML = list.map((h) => {
      const u = byH.get(h);
      return `<span class="wl-item"><a href="https://x.com/${encodeURIComponent(h)}" target="_blank" rel="noopener">${U.esc(U.at(u ? u.h : h))}</a><button title="${U.esc(t("Remove"))}" data-rm="${U.esc(h)}">${U.icon("x")}</button></span>`;
    }).join("");
  }

  function wireWhitelist() {
    const add = async () => {
      const raw = $("#wlInput").value;
      const hs = raw.split(/[\s,;]+/).map(X7.cleanHandle).filter(Boolean);
      if (!hs.length) { U.toast(t("Type a handle like @name"), "err"); return; }
      let n = 0;
      for (const h of hs) { if (!D.wl.has(h.toLowerCase())) { D.wl.add(h.toLowerCase()); n++; } }
      $("#wlInput").value = "";
      await saveWl();
      U.toast(n ? tn(n, "{n} added to your whitelist", "{n} added to your whitelist") : t("Already on your whitelist"), n ? "ok" : "");
    };
    $("#wlAdd").addEventListener("click", add);
    $("#wlInput").addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
    $("#wlSearch").addEventListener("input", renderWhitelist);
    $("#wlList").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-rm]");
      if (!b) return;
      D.wl.delete(b.dataset.rm);
      await saveWl();
    });
    $("#wlExport").addEventListener("click", () => {
      U.download(`x-whitelist-${new Date().toISOString().slice(0, 10)}.csv`, U.csv(["handle", "profile_url"], [...D.wl].sort().map((h) => [h, "https://x.com/" + h])));
    });
  }

  // ======================================================================
  // history: unfollowed / followed, and "follow again"
  // ======================================================================
  const SOURCE_LABEL = () => ({
    nonfollowers: t("Non-follower"), all: t("Unfollow all"), ids: t("Selected"), handles: t("Imported"), v6: t("Earlier version"),
    refollow: t("Followed again"), followback: t("Followed back")
  });

  // When each account was last followed with the extension (for "followed again").
  function lastFollows() {
    const m = new Map();
    for (const h of D.history) if (h.k === "f" && h.i && (!m.has(h.i) || h.t > m.get(h.i))) m.set(h.i, h.t);
    return m;
  }

  function renderHistory(reset) {
    const nF = D.history.filter((h) => h.k === "f").length;
    $("#hiCountU").textContent = U.compact(D.history.length - nF);
    $("#hiCountF").textContent = U.compact(nF);
    $$("#hiSeg button").forEach((b) => b.classList.toggle("is-on", b.dataset.k === D.hiKind));
    if (reset) {
      const q = $("#hiSearch").value.trim().toLowerCase().replace(/^@/, "");
      const lf = lastFollows();
      const following = followingSet();
      D.hiList = D.history.slice().reverse()
        .filter((h) => (D.hiKind === "f" ? h.k === "f" : h.k !== "f"))
        .filter((h) => !q || String(h.h).toLowerCase().includes(q) || String(h.n || "").toLowerCase().includes(q))
        .map((h) => {
          const again = h.k !== "f" && h.i && lf.has(h.i) && lf.get(h.i) > h.t;
          return { h, again, canAct: D.hiKind === "u" && !!h.i && !!h.h && !again && !following.has(h.i) };
        });
      // Each account once in the selection, even if it appears several times.
      const valid = new Set(D.hiList.filter((x) => x.canAct).map((x) => x.h.i));
      for (const id of [...D.hiSel]) if (!valid.has(id)) D.hiSel.delete(id);
      D.hiShown = 0;
      $("#hiList").innerHTML = "";
    }
    $("#hiTools").hidden = D.hiKind !== "u" || !D.hiList.some((x) => x.canAct);
    $("#hiEmpty").hidden = D.hiList.length > 0;
    $("#hiEmpty").textContent = D.hiKind === "f" ? t("Nobody followed with the extension yet.") : t("No unfollows yet.");
    renderMoreHistory();
    syncHiAll();
    renderHiBulk();
  }

  function renderMoreHistory() {
    if (D.hiShown >= D.hiList.length) return;
    const next = D.hiList.slice(D.hiShown, D.hiShown + CHUNK);
    const labels = SOURCE_LABEL();
    const showCb = D.hiKind === "u";
    $("#hiList").insertAdjacentHTML("beforeend", next.map(({ h, again, canAct }) => {
      const sel = canAct && D.hiSel.has(h.i);
      const tag = h.k === "f" ? (labels[h.s] || t("Followed")) : (labels[h.s] || t("Unfollowed"));
      const tags = `<span class="tag${h.k === "f" ? " ok" : ""}">${U.esc(tag)}</span>` + (again ? `<span class="tag ok">${U.esc(t("Followed again"))}</span>` : "");
      const cb = showCb ? `<label class="cb"><input type="checkbox" class="hicb" ${sel ? "checked" : ""} ${canAct ? "" : "disabled"}><span></span></label>` : "";
      return `
      <div class="hi-row${showCb ? "" : " no-cb"}${sel ? " is-sel" : ""}" data-id="${U.esc(h.i || "")}">${cb}${avatarHtml(h.a, h.n || h.h, 36)}
        <div class="hi-who"><b>${U.esc(h.n || U.at(h.h))}</b><a href="https://x.com/${encodeURIComponent(h.h)}" target="_blank" rel="noopener">${U.esc(U.at(h.h))}</a></div>
        <span class="tags">${tags}</span>
        <time title="${U.esc(new Date(h.t).toLocaleString(U.locale()))}">${U.esc(U.ago(h.t))}</time>
      </div>`;
    }).join(""));
    D.hiShown += next.length;
  }

  function syncHiAll() {
    const all = $("#hiAll");
    const ids = new Set(D.hiList.filter((x) => x.canAct).map((x) => x.h.i));
    const n = [...ids].filter((id) => D.hiSel.has(id)).length;
    all.checked = ids.size > 0 && n === ids.size;
    all.indeterminate = n > 0 && n < ids.size;
    all.disabled = !ids.size;
  }

  function renderHiBulk() {
    const n = D.hiSel.size;
    $("#hiBulk").hidden = n === 0 || D.page !== "history";
    $("#hiBulkCount").textContent = t("{n} selected", { n: U.fmt(n) });
  }

  function wireHistory() {
    let tm = null;
    $("#hiSearch").addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(() => renderHistory(true), 140); });
    $("#hiSeg").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-k]");
      if (!b || b.dataset.k === D.hiKind) return;
      D.hiKind = b.dataset.k;
      D.hiSel.clear();
      renderHistory(true);
    });
    $("#hiList").addEventListener("change", (e) => {
      if (!e.target.classList.contains("hicb")) return;
      const row = e.target.closest(".hi-row");
      const id = row.dataset.id;
      if (e.target.checked) D.hiSel.add(id); else D.hiSel.delete(id);
      $$("#hiList .hi-row").forEach((r) => {
        if (r.dataset.id !== id) return;
        r.classList.toggle("is-sel", e.target.checked);
        const cb = r.querySelector(".hicb"); if (cb && !cb.disabled) cb.checked = e.target.checked;
      });
      syncHiAll();
      renderHiBulk();
    });
    $("#hiAll").addEventListener("change", (e) => {
      for (const x of D.hiList) if (x.canAct) { if (e.target.checked) D.hiSel.add(x.h.i); else D.hiSel.delete(x.h.i); }
      $$("#hiList .hi-row").forEach((r) => {
        const on = D.hiSel.has(r.dataset.id);
        const cb = r.querySelector(".hicb");
        if (cb && !cb.disabled) { cb.checked = on; r.classList.toggle("is-sel", on); }
      });
      syncHiAll();
      renderHiBulk();
    });
    $("#hiBulkClear").addEventListener("click", () => { D.hiSel.clear(); renderHistory(true); });
    $("#hiBulkRun").addEventListener("click", async () => {
      const seen = new Set();
      const targets = [];
      for (const x of D.hiList) {
        if (!x.canAct || !D.hiSel.has(x.h.i) || seen.has(x.h.i)) continue;
        seen.add(x.h.i);
        targets.push({ i: x.h.i, h: x.h.h, n: x.h.n || "", a: x.h.a || "" });
      }
      if (!targets.length) return;
      if (await startRun({ source: "refollow", targets }, targets.length, t("Follows use the same safe pacing and count towards your daily limit."), true)) {
        D.hiSel.clear();
        renderHiBulk();
      }
    });
    $("#hiExport").addEventListener("click", () => {
      if (!D.history.length) { U.toast(t("History is empty.")); return; }
      const rows = D.history.slice().reverse().map((h) => [h.h, h.n || "", "https://x.com/" + h.h, h.k === "f" ? "follow" : "unfollow", new Date(h.t).toISOString(), h.s || ""]);
      U.download(`x-history-${new Date().toISOString().slice(0, 10)}.csv`, U.csv(["handle", "name", "profile_url", "action", "at", "source"], rows));
    });
    $("#hiClear").addEventListener("click", async () => {
      if (!D.history.length) return;
      const ok = await confirmBox({ title: t("Clear your history?"), body: t("This only deletes the list kept in this browser. It doesn't follow or unfollow anyone."), ok: t("Clear history"), danger: true, icon: "trash" });
      if (!ok) return;
      await U.set({ [K.history]: [] });
      U.toast(t("History cleared."));
    });
    moreObs.observe($("#hiMore"));
  }

  // ======================================================================
  // import
  // ======================================================================
  let imported = [];
  function setImported(text) {
    const { handles, skipped } = U.handlesFrom(text);
    const fresh = handles.filter((h) => !D.wl.has(h.toLowerCase()));
    imported = fresh;
    const protectedN = handles.length - fresh.length;
    $("#impRun").disabled = !fresh.length;
    $("#impRunLabel").textContent = fresh.length ? tn(fresh.length, "Unfollow {n} account", "Unfollow {n} accounts") : t("Unfollow these");
    $("#impInfo").textContent = handles.length
      ? tn(handles.length, "Found {n} account", "Found {n} accounts") +
        (protectedN ? " · " + tn(protectedN, "{n} whitelisted (skipped)", "{n} whitelisted (skipped)") : "") +
        (skipped ? " · " + tn(skipped, "{n} unreadable line", "{n} unreadable lines") : "")
      : t("Whitelisted accounts are skipped automatically.");
  }

  function wireImport() {
    const drop = $("#drop");
    const readFile = (f) => {
      if (!f) return;
      if (f.size > 20 * 1024 * 1024) { U.toast(t("That file is too large."), "err"); return; }
      const r = new FileReader();
      r.onload = () => { $("#impText").value = String(r.result || ""); setImported($("#impText").value); };
      r.readAsText(f);
    };
    $("#impPick").addEventListener("click", () => $("#impFile").click());
    $("#impFile").addEventListener("change", (e) => readFile(e.target.files[0]));
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("is-over"); }));
    drop.addEventListener("drop", (e) => readFile(e.dataTransfer.files[0]));
    let tm = null;
    $("#impText").addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(() => setImported($("#impText").value), 200); });
    $("#impRun").addEventListener("click", async () => {
      if (!imported.length) return;
      if (await startRun({ source: "handles", handles: imported }, imported.length, t("Accounts from your list that you already don't follow are skipped automatically."))) {
        $("#impText").value = "";
        setImported("");
      }
    });
  }

  // ======================================================================
  // settings
  // ======================================================================
  const NUM_FIELDS = ["minDelay", "maxDelay", "restEvery", "restMinutes", "dailyLimit", "scanMaxAgeHours", "keepMinFollowers", "keepNewDays"];

  function fillSettings() {
    const s = settings();
    for (const k of NUM_FIELDS) if ($("#" + k) && document.activeElement !== $("#" + k)) $("#" + k).value = s[k];
    $("#keepVerified").checked = !!s.keepVerified;
    $("#keepProtected").checked = !!s.keepProtected;
    $("#trackFollowers").checked = s.trackFollowers !== false;
    $("#notifyToggle").checked = !!s.notify;
    if ($("#telemetry")) $("#telemetry").checked = s.telemetry !== false;
    if (document.activeElement !== $("#keepKeywords")) $("#keepKeywords").value = s.keepKeywords || "";
    $$(".preset").forEach((p) => p.classList.toggle("is-on", p.dataset.speed === s.speed));
    $("#langSel").value = window.X7I18N ? X7I18N.pref() : "auto";
    speedWarnings(s);
    renderAccounts();
  }

  function renderAccounts() {
    const S = D.S;
    const box = $("#acctList");
    if (!S || !box) return;
    const ids = Object.keys(S.profiles || {});
    if (S.owner && !ids.includes(S.owner)) ids.unshift(S.owner);
    box.innerHTML = "";
    if (!ids.length) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = t("No X account yet - sign in at x.com and open this page again.");
      box.appendChild(p);
      return;
    }
    ids.sort((a, b) => (a === S.owner ? -1 : b === S.owner ? 1 : 0));
    for (const id of ids) {
      const p = (S.profiles || {})[id] || {};
      const row = document.createElement("div");
      row.className = "acct";
      row.appendChild(U.avatar(p.a, p.n || p.h, 38));
      const txt = document.createElement("div");
      txt.className = "acct-text";
      const b = document.createElement("b");
      b.textContent = p.n || (p.h ? U.at(p.h) : t("account #{id}", { id }));
      const sm = document.createElement("small");
      sm.textContent = (p.h ? U.at(p.h) + " · " : "") + (id === S.owner ? t("data in use") : t("data saved, used when you sign in as this account"));
      txt.append(b, sm);
      row.appendChild(txt);
      if (id === S.owner) {
        const tag = document.createElement("span");
        tag.className = "tag ok";
        tag.textContent = t("Current");
        row.appendChild(tag);
      } else {
        const del = document.createElement("button");
        del.className = "btn btn-sm btn-danger-soft";
        del.innerHTML = U.icon("trash") + "<span></span>";
        del.querySelector("span").textContent = t("Delete data");
        del.addEventListener("click", async () => {
          if (!await confirmBox({ title: t("Delete the data saved for {who}?", { who: p.h ? U.at(p.h) : t("this account") }), body: t("Its scan, whitelist, history and groups are deleted from this browser. Nothing changes on X."), ok: t("Delete"), danger: true, icon: "trash" })) return;
          const r = await U.cmd("profileDelete", { id });
          if (!r.ok) U.toast(r.error || t("Couldn't delete."), "err");
          else { U.toast(t("Deleted.")); await refreshState(); renderAccounts(); }
        });
        row.appendChild(del);
      }
      box.appendChild(row);
    }
  }

  function speedWarnings(s) {
    const w = [];
    if (s.dailyLimit === 0) w.push(t("No daily limit: X may restrict your account if you unfollow hundreds in a day."));
    else if (s.dailyLimit > 400 && s.speed !== "fast") w.push(t("More than 400 a day is usually only safe on X Premium accounts."));
    if (s.minDelay < 4) w.push(t("Delays under 4 seconds are fast enough for X to notice."));
    if (s.speed === "fast") w.push(t("Fast is meant for Premium accounts. If X asks you to slow down, the run rests automatically."));
    const el = $("#speedWarn");
    el.hidden = !w.length;
    el.textContent = w.join(" ");
  }

  let saveTimer = null;
  function queueSave(patch) {
    D.S.settings = X7.normalizeSettings(Object.assign({}, D.S.settings, patch));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await U.set({ [K.settings]: D.S.settings });
      const b = $("#savedBadge");
      b.classList.add("show");
      setTimeout(() => b.classList.remove("show"), 1400);
      speedWarnings(D.S.settings);
    }, 350);
  }
  async function saveNow(patch) {
    D.S.settings = X7.normalizeSettings(Object.assign({}, D.S.settings, patch));
    clearTimeout(saveTimer);
    await U.set({ [K.settings]: D.S.settings });
    const b = $("#savedBadge");
    b.classList.add("show");
    setTimeout(() => b.classList.remove("show"), 1400);
  }

  const NOTIF = { permissions: ["notifications"] };
  async function setNotify(on) {
    if (on) {
      let ok = false;
      try { ok = await chrome.permissions.request(NOTIF); } catch (_) { ok = false; }
      if (!ok) {
        $("#notifyToggle").checked = false;
        U.toast(t("Chrome didn't allow notifications, so they stay off."), "err", 5000);
        return;
      }
      await saveNow({ notify: true });
      U.cmd("notifyHello");
      U.toast(t("Notifications are on."), "ok");
    } else {
      await saveNow({ notify: false });
      try { await chrome.permissions.remove(NOTIF); } catch (_) {}
    }
  }

  function wireSettings() {
    $("#presets").addEventListener("click", (e) => {
      const p = e.target.closest(".preset");
      if (!p) return;
      const speed = p.dataset.speed;
      const patch = speed === "custom" ? { speed } : Object.assign({ speed }, X7.PRESETS[speed]);
      queueSave(patch);
      fillSettings();
    });
    for (const k of NUM_FIELDS) {
      $("#" + k).addEventListener("input", (e) => {
        const v = e.target.value;
        if (v === "") return;
        const patch = { [k]: Number(v) };
        if (["minDelay", "maxDelay", "restEvery", "restMinutes", "dailyLimit"].includes(k)) patch.speed = "custom";
        queueSave(patch);
        $$(".preset").forEach((p) => p.classList.toggle("is-on", p.dataset.speed === (patch.speed || D.S.settings.speed)));
      });
      $("#" + k).addEventListener("blur", fillSettings);
    }
    $("#keepVerified").addEventListener("change", (e) => queueSave({ keepVerified: e.target.checked }));
    $("#keepProtected").addEventListener("change", (e) => queueSave({ keepProtected: e.target.checked }));
    $("#trackFollowers").addEventListener("change", (e) => queueSave({ trackFollowers: e.target.checked }));
    $("#notifyToggle").addEventListener("change", (e) => setNotify(e.target.checked));
    if ($("#telemetry")) $("#telemetry").addEventListener("change", async (e) => {
      queueSave({ telemetry: e.target.checked });
      await U.set({ [K.settings]: D.S.settings }); // flush now so the worker reads the new value
      U.cmd("syncTelemetry");
    });
    $("#keepKeywords").addEventListener("input", (e) => queueSave({ keepKeywords: e.target.value }));
    $("#langSel").addEventListener("change", async (e) => {
      const v = e.target.value;
      if (window.X7I18N) X7I18N.setPref(v);
      await saveNow({ lang: v });
      location.reload();
    });
    $("#resetSettings").addEventListener("click", async () => {
      if (!await confirmBox({ title: t("Reset settings?"), body: t("Speed and Keep rules go back to the recommended defaults. Your whitelist and history are kept."), ok: t("Reset"), info: true, icon: "refresh" })) return;
      // Only speed and Keep rules: privacy, notification, followers and language choices stay.
      const { lang, telemetry, notify, trackFollowers } = D.S.settings;
      D.S.settings = X7.normalizeSettings({ lang, telemetry, notify, trackFollowers });
      await U.set({ [K.settings]: D.S.settings });
      fillSettings();
      U.toast(t("Settings reset."), "ok");
    });
    $("#wipeAll").addEventListener("click", async () => {
      if (!await confirmBox({ title: t("Delete all extension data?"), body: t("Your scans, whitelists, history, groups and settings - for every X account - will be erased from this browser. This can't be undone."), ok: t("Delete everything"), danger: true, icon: "trash" })) return;
      await U.cmd("scanStop");
      await U.cmd("stop");
      await U.cmd("actStop");
      await U.cmd("folStop");
      await chrome.storage.local.clear();
      try { localStorage.removeItem("x7.lang"); } catch (_) {}
      try { await chrome.permissions.remove(NOTIF); } catch (_) {}
      U.toast(t("All data deleted."));
      setTimeout(() => location.reload(), 600);
    });
  }

  // ======================================================================
  // help / health
  // ======================================================================
  function renderHealth(h) {
    const list = $("#healthList");
    if (!h) { list.innerHTML = ""; return; }
    const row = (label, ok, detail) => `<li>${U.icon(ok ? "check" : "alert", ok ? "ok" : "bad")}<b>${U.esc(label)}</b><span>${U.esc(detail)}</span></li>`;
    const items = [];
    if (h.ok === false && h.message) items.push(row(t("Connection"), false, h.message));
    items.push(row(t("Signed in to X"), !!h.signedIn, h.signedIn ? t("Yes") : t("No - sign in at x.com")));
    if (h.signedIn) {
      items.push(row(t("Session token"), !!h.csrf, h.csrf ? t("Present") : t("Missing - reload x.com")));
      items.push(row(t("Request signing"), h.txid === "ok", h.txid === "ok" ? t("Working") : String(h.txid || t("Not checked"))));
      items.push(row(t("X app queries"), !!h.ops && !/could not|error/i.test(h.ops), String(h.ops || t("Not checked"))));
      items.push(row(t("Reading your list"), /^ok/.test(h.read || ""), String(h.read || t("Not checked"))));
      if (h.activity !== undefined) items.push(row(t("Reading profile activity"), /^ok/.test(h.activity || ""), String(h.activity || t("Not checked"))));
    }
    if (h.at) items.push(`<li>${U.icon("clock")}<b>${U.esc(t("Checked"))}</b><span>${U.esc(U.ago(h.at))}</span></li>`);
    list.innerHTML = items.join("");
  }

  function wireHelp() {
    $("#healthBtn").addEventListener("click", async () => {
      const b = $("#healthBtn");
      b.disabled = true;
      b.querySelector("span").textContent = t("Checking...");
      const r = await U.cmd("health");
      b.disabled = false;
      b.querySelector("span").textContent = t("Run check");
      if (!r.ok) { U.toast(r.error || t("Check failed."), "err"); return; }
      renderHealth(r.health);
    });
  }

  // ======================================================================
  // overview wiring
  // ======================================================================
  function wireOverview() {
    $("#ovScanBtn").addEventListener("click", () => startScan());
    $("#rpRunNon").addEventListener("click", async () => {
      const S = D.S;
      const sc = S.scan && S.scan.status === "done" ? S.scan : null;
      const stale = !sc || Date.now() - sc.finishedAt > S.settings.scanMaxAgeHours * 3600000;
      if (!sc) return startScan({ source: "nonfollowers" });
      if (stale) {
        const ok = await confirmBox({ title: t("Refresh your scan first?"), body: t("Your scan is from {ago}. It will be refreshed, then everyone who doesn't follow you back is unfollowed.", { ago: U.ago(sc.finishedAt) }), ok: t("Scan & start"), info: true, icon: "scan", facts: paceFacts(S.actionable || 0) });
        if (ok) startScan({ source: "nonfollowers" });
        return;
      }
      startRun({ source: "nonfollowers" }, S.actionable || 0, t("Only accounts that don't follow you back. Your whitelist and Keep rules always apply."));
    });
    $("#rpReview").addEventListener("click", () => { location.hash = "#following"; });
    $("#rpPause").addEventListener("click", () => U.cmd("pause").then(refreshState));
    $("#rpResume").addEventListener("click", () => U.cmd("resume").then(refreshState));
    $("#rpStop").addEventListener("click", async () => {
      if (await confirmBox({ title: t("Stop this run?"), body: t("Progress so far is kept. You can start a new run any time."), ok: t("Stop"), danger: true, icon: "stop" })) U.cmd("stop").then(refreshState);
    });
    $("#rpClear").addEventListener("click", () => U.cmd("clearJob").then(refreshState));
    $("#rpScanStop").addEventListener("click", () => U.cmd("scanStop").then(refreshState));
    $("#chartRange").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-r]");
      if (!b) return;
      D.chartRange = b.dataset.r;
      renderChart();
    });
    let rz = null;
    window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(renderChart, 150); });

    $("#welcomeScan").addEventListener("click", () => { $("#welcome").hidden = true; startScan(); });
    $("#welcomeLater").addEventListener("click", () => { $("#welcome").hidden = true; });
  }

  // ======================================================================
  // donate
  // ======================================================================
  function wireDonate() {
    const storeUrl = U.links.store;
    $("#rateLink").href = storeUrl + "/reviews";
    $("#rateLink").addEventListener("click", () => U.review.answer("rated"));     // reviewed from here: never ask

    const closeRate = (state) => { $("#rateAsk").hidden = true; if (state) U.review.answer(state); };
    $("#rateAskGo").addEventListener("click", async () => { closeRate(); await U.review.open(); });
    $("#rateAskLater").addEventListener("click", () => closeRate("later"));
    $("#rateAskNever").addEventListener("click", () => closeRate("no"));
    $("#rateAsk").addEventListener("click", (e) => { if (e.target.id === "rateAsk") closeRate("later"); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#rateAsk").hidden) closeRate("later"); });

    // In-page jumps scroll without touching the hash (the hash is the router).
    const jump = (id) => (e) => {
      e.preventDefault();
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    $("#donateJump").addEventListener("click", jump("wallets"));
    $("#helpJump").addEventListener("click", jump("helpfree"));

    U.$$(".wallet").forEach((card) => {
      const btn = card.querySelector(".w-copy");
      const addr = card.querySelector(".addr").textContent.trim();
      btn.addEventListener("click", async () => {
        const ok = await U.copy(addr);
        if (!ok) { U.toast(t("Couldn't copy - select the address and copy it manually."), "err"); return; }
        const label = btn.querySelector("span");
        btn.classList.add("is-copied");
        label.textContent = t("Copied - thank you!");
        U.toast(t("Address copied. Thank you for supporting a free tool!"), "ok");
        setTimeout(() => { btn.classList.remove("is-copied"); label.textContent = t("Copy address"); }, 2200);
      });
    });

    $("#shareBtn").addEventListener("click", async () => {
      const ok = await U.copy(storeUrl);
      U.toast(ok ? t("Store link copied - paste it anywhere to share.") : t("Couldn't copy the link."), ok ? "ok" : "err");
    });
  }

  function wireAppearance() {
    const seg = $("#themeSeg");
    const sync = () => U.$$("button", seg).forEach((b) => b.classList.toggle("is-on", b.dataset.pref === (window.X7Theme ? X7Theme.pref() : "system")));
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-pref]");
      if (!b || !window.X7Theme) return;
      X7Theme.set(b.dataset.pref);
      sync();
    });
    window.addEventListener("x7-theme", () => { sync(); renderChart(); });
    sync();
  }

  // ======================================================================
  // live updates
  // ======================================================================
  let stTimer = null;
  U.watch([K.job, K.scan, K.account, K.ledger, K.act, K.fol, K.owner, K.profiles], () => {
    clearTimeout(stTimer);
    stTimer = setTimeout(refreshState, 150);
  });
  U.watch([K.scanUsers], async () => { await loadUsers(); if (D.page === "following") renderFollowing(true); renderFeed(); });
  // The check streams results in; while it runs, only counts are refreshed (the list is rebuilt at most every few seconds).
  let actTimer = null, actListAt = 0;
  U.watch([K.actData], () => {
    clearTimeout(actTimer);
    actTimer = setTimeout(async () => {
      await loadAct();
      if (D.page !== "following" || !isIdle()) return;
      const running = !!(D.S && D.S.act && D.S.act.status === "running");
      if (running && Date.now() - actListAt < 4000) { renderFollowing(false); return; }
      actListAt = Date.now();
      const y = window.scrollY;
      renderFollowing(true);
      window.scrollTo(0, y);
    }, 500);
  });
  const keepScroll = (fn) => { const y = window.scrollY; fn(); window.scrollTo(0, y); };
  U.watch([K.whitelist], async () => {
    await loadWl();
    renderSide();
    if (D.page === "whitelist") renderWhitelist();
    if (D.page === "following") keepScroll(() => renderFollowing(true));
    refreshState();
  });
  U.watch([K.doneIds], async () => {
    await loadDone();
    if (D.page === "following") keepScroll(() => renderFollowing(true));
    if (D.page === "followers") keepScroll(() => renderFollowers(true));
    if (D.page === "history") keepScroll(() => renderHistory(true));
  });
  U.watch([K.history], async () => {
    await loadHistory();
    renderFeed();
    if (D.page === "history") keepScroll(() => renderHistory(true));
    if (D.page === "followers") keepScroll(() => renderFollowers(true));
  });
  U.watch([K.firstSeen], async () => { await loadFirstSeen(); if (D.page === "following") keepScroll(() => renderFollowing(true)); });
  U.watch([K.groups], async () => { await loadGroups(); if (D.page === "following") keepScroll(() => renderFollowing(true)); });
  U.watch([K.followers, K.fevents], async () => {
    await loadFollowers();
    renderOverview();
    if (D.page === "followers") keepScroll(() => renderFollowers(true));
  });
  U.watch([K.scanLog], async () => { await loadScanLog(); renderChart(); });
  U.watch([K.settings], async () => {
    const s = await U.get(K.settings, null);
    if (D.S && s) D.S.settings = X7.normalizeSettings(s);
    if (D.page === "settings") fillSettings();
    if (D.page === "following") renderFollowing(true);
  });

  // ======================================================================
  // boot
  // ======================================================================
  document.addEventListener("DOMContentLoaded", async () => {
    if (window.X7I18N) X7I18N.translateDom(document);
    U.icons();
    U.themeButtons();
    U.growxLinks();
    $("#year").textContent = String(new Date().getFullYear());
    await Promise.all([loadUsers(), loadWl(), loadDone(), loadHistory(), loadAct(), loadFirstSeen(), loadGroups(), loadFollowers(), loadScanLog()]);
    await refreshState();
    wireOverview();
    wireFollowing();
    wireFollowers();
    wireWhitelist();
    wireHistory();
    wireImport();
    wireSettings();
    wireHelp();
    wireDonate();
    wireAppearance();
    window.addEventListener("hashchange", route);
    route();
    renderHealth(D.S && D.S.health && D.S.health.signedIn !== undefined ? D.S.health : null);
    // The worker uses settings.lang; keep it in step with this browser's choice.
    if (window.X7I18N && D.S && D.S.settings && D.S.settings.lang !== X7I18N.pref()) saveNow({ lang: X7I18N.pref() });
    U.cmd("refreshAccount").then((r) => { if (r && r.ok) refreshState(); });
  });
})();
