// X Mass Unfollow - popup.js
(function () {
  "use strict";

  const { $, $$ } = U;
  const K = X7.K;
  const t = U.t, tn = U.tn;
  let S = null;              // latest state from the worker
  let pending = null;        // action waiting in the confirm sheet

  // ------------------------------------------------------------------ views
  function show(name) {
    $$(".view").forEach((v) => v.classList.toggle("is-on", v.dataset.view === name));
  }

  function setStatus(kind, text) {
    const pill = $("#statusPill");
    pill.className = "pill" + (kind ? " is-" + kind : "");
    $("#statusText").textContent = text;
  }

  function renderAccount() {
    const acc = S.account;
    const av = $("#accAvatar");
    const fresh = U.avatar(acc && acc.avatar, acc && (acc.name || acc.handle), 40);
    av.replaceWith(fresh);
    fresh.id = "accAvatar";
    if (acc && acc.id && !acc.signedOut) {
      $("#accName").textContent = acc.name || (acc.handle ? U.at(acc.handle) : t("Signed in"));
      $("#accHandle").textContent = acc.handle
        ? U.at(acc.handle) + (acc.following != null ? " · " + t("{n} following", { n: U.compact(acc.following) }) : "")
        : t("Connected to X");
    } else {
      $("#accName").textContent = acc && acc.signedOut ? t("Signed out of X") : t("Not connected");
      $("#accHandle").textContent = t("Open x.com and sign in");
    }

    const limit = S.settings.dailyLimit;
    const used = S.today || 0;
    U.countTo($("#todayNum"), used, U.compact);
    $("#todayCap").textContent = limit ? t("of {n}", { n: U.compact(limit) }) : t("today");
    const frac = limit ? Math.min(1, used / limit) : (used ? 1 : 0);
    $("#todayRing").style.strokeDashoffset = String(97.4 * (1 - frac));
    const box = $("#todayBox");
    box.classList.toggle("is-near", !!limit && frac >= 0.8 && frac < 1);
    box.classList.toggle("is-full", !!limit && frac >= 1);
    box.title = limit
      ? t("{used} of {limit} follow/unfollow actions used in the last 24 hours", { used: U.fmt(used), limit: U.fmt(limit) })
      : t("{used} follow/unfollow actions in the last 24 hours (no daily limit)", { used: U.fmt(used) });
  }

  function settingsLine() {
    const s = S.settings;
    const names = { safe: t("Safe"), balanced: t("Balanced"), fast: t("Fast"), custom: t("Custom") };
    return t("{name} · {min}-{max}s apart", { name: names[s.speed] || names.custom, min: s.minDelay, max: s.maxDelay });
  }

  function estimate(count) {
    const s = S.settings;
    const avg = (s.minDelay + s.maxDelay) / 2 + 1.5;
    let secs = count * avg;
    if (s.restEvery > 0) secs += Math.floor(count / s.restEvery) * s.restMinutes * 60;
    if (s.dailyLimit > 0) {
      const room = Math.max(0, s.dailyLimit - (S.today || 0));
      if (count > room) {
        const days = Math.ceil((count - room) / s.dailyLimit);
        return { short: U.dur(Math.min(secs, room * avg)), long: tn(days, "{time} today, then ~{n} more day", "{time} today, then ~{n} more days", { time: U.dur(Math.min(secs, room * avg)) }) };
      }
    }
    return { short: U.dur(secs), long: "~" + U.dur(secs) };
  }

  function scanIsStale() {
    const sc = S.scan;
    if (!sc || !sc.finishedAt) return true;
    return Date.now() - sc.finishedAt > S.settings.scanMaxAgeHours * 3600000;
  }

  // ------------------------------------------------------------------ render
  function render() {
    renderAccount();
    const { scan, job, account } = S;
    const signedOut = account && account.signedOut;

    if (scan && scan.status === "running") return renderScanning();
    if (job && ["running", "resting", "paused", "halted"].includes(job.status)) return renderRun();
    if (job && ["done", "stopped"].includes(job.status)) return renderDone();
    if (signedOut) { setStatus("halt", t("Signed out")); return show("signin"); }
    if (scan && scan.status === "done" && (!account || !account.id || scan.ownerId === account.id)) return renderReady();

    setStatus("", t("Ready"));
    show("start");
    const note = $("#startNotice");
    note.hidden = !(scan && scan.status === "error" && scan.error);
    if (!note.hidden) note.textContent = scan.error;
  }

  function renderScanning() {
    const sc = S.scan;
    setStatus("scan", t("Scanning"));
    show("scanning");
    $("#scanCount").textContent = U.fmt(sc.phase === "followers" ? sc.followersRead || 0 : sc.fetched || 0);
    $("#scanMsg").textContent = sc.message || t("Reading your following list...");
    const bar = $("#scanBar");
    if (sc.expected && sc.phase !== "followers") {
      bar.classList.remove("is-indeterminate");
      bar.firstElementChild.style.width = Math.min(98, Math.max(3, (sc.fetched || 0) / sc.expected * 100)) + "%";
    } else {
      bar.classList.add("is-indeterminate");
    }
  }

  function renderReady() {
    const sc = S.scan;
    setStatus("", t("Ready"));
    show("ready");
    U.countTo($("#stFollowing"), sc.total, U.compact);
    U.countTo($("#stNon"), sc.nonFollowers, U.compact);
    U.countTo($("#stMutual"), sc.mutuals, U.compact);

    const n = S.actionable || 0;
    const runNon = $("#runNonBtn");
    $("#runNonLabel").textContent = n ? tn(n, "Unfollow {n} non-follower", "Unfollow {n} non-followers") : t("No non-followers to unfollow");
    runNon.disabled = !n || !!sc.relationshipUnknown;
    $("#runAllBtn").disabled = !S.actionableAll;

    const note = $("#readyNotice");
    note.className = "notice";
    if (sc.relationshipUnknown) {
      note.hidden = false;
      note.classList.add("is-error");
      note.textContent = t("X didn't say who follows you back this time, so non-followers can't be picked safely. Rescan in a few minutes.");
    } else if (sc.partial) {
      note.hidden = false;
      note.textContent = (sc.error || t("The scan stopped early.")) + " " + tn(sc.total, "Results cover {n} account.", "Results cover {n} accounts.");
    } else if (sc.nonFollowers > 0 && !n) {
      note.hidden = false;
      note.classList.add("is-info");
      note.textContent = t("Everyone who doesn't follow back is already unfollowed or protected by your whitelist / Keep rules.");
    } else {
      note.hidden = true;
    }

    // Who unfollowed you, from the last followers check.
    const fol = S.fol;
    const line = $("#lostLine");
    if (fol && fol.status === "running") {
      line.hidden = false;
      line.classList.remove("is-hot");
      $("#lostText").textContent = t("Checking who unfollowed you...");
    } else if (fol && fol.status === "done" && !fol.baseline && fol.lost) {
      line.hidden = false;
      line.classList.add("is-hot");
      $("#lostText").textContent = tn(fol.lost, "{n} person unfollowed you · See who", "{n} people unfollowed you · See who");
    } else line.hidden = true;

    $("#scanAge").textContent = t("Scanned {ago}", { ago: U.ago(sc.finishedAt) }) + (sc.method === "dom" ? " " + t("(page mode)") : "");
  }

  function renderRun() {
    const j = S.job;
    const follow = j.kind === "follow";
    const pct = j.total ? Math.round(((j.done + j.skipped + j.failed) / j.total) * 100) : 0;
    const left = Math.max(0, j.total - j.index);
    show("run");

    const states = {
      running: ["run", t("Running")], resting: ["rest", t("Resting")], paused: ["", t("Paused")], halted: ["halt", t("Needs you")]
    };
    const [kind, label] = states[j.status] || ["", j.status];
    setStatus(kind, label);

    U.countTo($("#runDone"), j.done);
    $("#runTotal").textContent = follow ? t("/ {n} followed", { n: U.fmt(j.total) }) : t("/ {n} unfollowed", { n: U.fmt(j.total) });
    $("#runPct").textContent = pct + "%";
    const bar = $("#runBar");
    bar.className = "bar" + (j.status === "running" ? " is-live" : j.status === "resting" ? " is-rest" : "");
    bar.firstElementChild.style.width = Math.max(2, pct) + "%";

    $("#runSkipped").textContent = U.fmt(j.skipped + j.failed);
    $("#runLeft").textContent = U.fmt(left);
    $("#runEta").textContent = left ? estimate(left).short : "-";

    const tg = j.current;
    const av = $("#nowAvatar");
    const fresh = U.avatar(tg && tg.a, tg && (tg.n || tg.h), 38);
    av.replaceWith(fresh);
    fresh.id = "nowAvatar";
    $("#nowHandle").textContent = tg ? (tg.n ? tg.n + "  " + U.at(tg.h) : U.at(tg.h)) : "-";
    $("#nowLabel").textContent = j.status === "running" ? (j.inFlight ? (follow ? t("Following") : t("Unfollowing")) : t("Next up")) : t("Up next");

    const msg = $("#runMsg");
    msg.textContent = j.message || "";
    msg.className = "run-msg" + (j.status === "halted" ? " is-error" : j.status === "resting" ? " is-warn" : "");

    // The background hint is least useful while a longer status message shows.
    $(".hint-line").hidden = !(j.status === "running" || j.status === "paused");
    if (j.status === "resting" && j.restReason === "daily") maybeAskReview(j);
    $("#pauseBtn").hidden = !(j.status === "running" || j.status === "resting");
    $("#resumeBtn").hidden = !(j.status === "paused" || j.status === "halted");
    tickTimer();
  }

  function renderDone() {
    const j = S.job;
    const follow = j.kind === "follow";
    setStatus("done", j.status === "done" ? t("Finished") : t("Stopped"));
    show("done");
    $("#doneTitle").textContent = j.status === "done" ? t("All done") : t("Stopped");
    $("#doneMsg").textContent = j.message || "";
    $("#doneUn").textContent = U.fmt(j.done);
    $("#doneUnLabel").textContent = follow ? t("Followed") : t("Unfollowed");
    $("#doneSkip").textContent = U.fmt(j.skipped + j.failed);
    $("#doneTime").textContent = j.finishedAt ? U.dur((j.finishedAt - j.startedAt) / 1000) : "-";
    maybeAskReview(j);
  }

  // ------------------------------------------------------------------ review prompt
  // At the daily-limit pause or the end of a run (see U.review).
  let reviewAsked = null;
  async function maybeAskReview(j) {
    const key = U.review.moment(j);
    if (!key || reviewAsked === key) return;
    reviewAsked = key;
    if (!(await U.review.due(j))) return;
    await U.review.claim(j);
    const view = j.status === "done" ? "done" : "run";
    setTimeout(() => {
      if (!$(`[data-view="${view}"]`).classList.contains("is-on") || !$("#sheet").hidden) return;
      $("#rateSheet").hidden = false;
      setTimeout(() => $("#rateGo").focus(), 50);
    }, 700);
  }
  function closeRate() { $("#rateSheet").hidden = true; }

  // live countdown for the run view
  function tickTimer() {
    if (!S || !S.job) return;
    const j = S.job;
    let target = null, label = t("next in");
    if (j.status === "resting") { target = j.restUntil; label = j.restReason === "daily" ? t("daily limit") : t("break"); }
    else if (j.status === "running") { target = j.inFlight ? null : j.nextAt; }
    const el = $("#nowTimer");
    if (j.status === "running" && j.inFlight) { el.innerHTML = '<span class="spinner"></span>'; $("#nowTimerLabel").textContent = t("working"); return; }
    if (!target || j.status === "paused" || j.status === "halted") { el.textContent = "-"; $("#nowTimerLabel").textContent = j.status === "paused" ? t("paused") : ""; return; }
    const secs = Math.max(0, Math.round((target - Date.now()) / 1000));
    el.textContent = secs >= 3600 ? U.clock(target) : secs >= 60 ? Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0") : secs + "s";
    $("#nowTimerLabel").textContent = label;
  }
  setInterval(() => { if (S && S.job && $('[data-view="run"]').classList.contains("is-on")) tickTimer(); }, 500);

  // ------------------------------------------------------------------ sheet
  function openSheet(opts) {
    pending = opts;
    $("#sheetTitle").textContent = opts.title;
    $("#sheetBody").textContent = opts.body;
    const facts = $("#sheetFacts");
    facts.innerHTML = "";
    for (const [k, v] of opts.facts) {
      const row = document.createElement("div");
      row.innerHTML = `<span>${U.esc(k)}</span><b>${U.esc(v)}</b>`;
      facts.appendChild(row);
    }
    $("#sheetOk").querySelector("span").textContent = opts.ok || t("Start");
    $("#sheet").hidden = false;
    setTimeout(() => $("#sheetOk").focus(), 50);
  }
  function closeSheet() { $("#sheet").hidden = true; pending = null; }

  function confirmRun(source) {
    const stale = scanIsStale();
    const n = source === "all" ? S.actionableAll : S.actionable;
    const s = S.settings;
    const facts = [
      [t("Pace"), settingsLine()],
      [t("Daily limit"), s.dailyLimit ? t("{n} ({used} used)", { n: U.fmt(s.dailyLimit), used: U.fmt(S.today) }) : t("Off")],
      [t("Estimated time"), estimate(n).long]
    ];
    if (stale) facts.unshift([t("Scan"), t("Older than {h}h - refreshed first", { h: s.scanMaxAgeHours })]);
    openSheet({
      title: source === "all"
        ? t("Unfollow everyone ({n})?", { n: U.fmt(n) })
        : tn(n, "Unfollow {n} non-follower?", "Unfollow {n} non-followers?"),
      body: source === "all"
        ? t("This includes people who follow you back. Your whitelist and Keep rules still apply.")
        : t("Only accounts that don't follow you back. Your whitelist and Keep rules always apply."),
      facts,
      ok: stale ? t("Scan & start") : t("Start"),
      run: async () => {
        const r = stale
          ? await U.cmd("scan", { then: { source } })
          : await U.cmd("run", { source });
        if (!r.ok) U.toast(r.error || t("Couldn't start."), "err", 5000);
        refresh();
      }
    });
  }

  // ------------------------------------------------------------------ actions
  async function startScan() {
    const btn = $("#scanBtn");
    btn.disabled = true;
    const r = await U.cmd("scan");
    btn.disabled = false;
    if (!r.ok) {
      U.toast(r.error || t("Couldn't start the scan."), "err", 5000);
      if (r.needLogin) { S.account = { signedOut: true }; render(); }
    }
    refresh();
  }

  function openDash(hash) {
    U.cmd("dashboard", { hash });
    window.close();
  }

  function wire() {
    U.icons();
    U.themeButtons();
    U.growxLinks();
    $("#scanBtn").addEventListener("click", startScan);
    $("#rescanBtn").addEventListener("click", startScan);
    $("#scanStopBtn").addEventListener("click", () => U.cmd("scanStop").then(refresh));
    $("#runNonBtn").addEventListener("click", () => confirmRun("nonfollowers"));
    $("#runAllBtn").addEventListener("click", () => confirmRun("all"));
    $("#reviewBtn").addEventListener("click", () => openDash("following"));
    $("#pauseBtn").addEventListener("click", () => U.cmd("pause").then(refresh));
    $("#resumeBtn").addEventListener("click", () => U.cmd("resume").then(refresh));
    $("#stopBtn").addEventListener("click", () => U.cmd("stop").then(refresh));
    $("#doneOkBtn").addEventListener("click", () => U.cmd("clearJob").then(refresh));
    $("#donateDoneBtn").addEventListener("click", () => openDash("donate"));
    $("#openXBtn").addEventListener("click", () => { U.cmd("openX"); window.close(); });
    $("#retryBtn").addEventListener("click", async () => {
      const r = await U.cmd("refreshAccount");
      if (!r.ok && r.noTab) U.toast(t("Open x.com in a tab first."), "err");
      refresh();
    });
    $$("[data-open]").forEach((b) => b.addEventListener("click", () => openDash(b.dataset.open)));
    $("#sheetCancel").addEventListener("click", closeSheet);
    $("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });
    $("#sheetOk").addEventListener("click", async () => {
      const p = pending;
      closeSheet();
      if (p && p.run) await p.run();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#sheet").hidden) { e.preventDefault(); closeSheet(); } });
    $("#rateGo").addEventListener("click", async () => { closeRate(); await U.review.open(); });
    $("#rateLater").addEventListener("click", () => { closeRate(); U.review.answer("later"); });
    $("#rateNever").addEventListener("click", () => { closeRate(); U.review.answer("no"); });
    $("#rateSheet").addEventListener("click", (e) => { if (e.target.id === "rateSheet") { closeRate(); U.review.answer("later"); } });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#rateSheet").hidden) { e.preventDefault(); closeRate(); U.review.answer("later"); } });
  }

  // ------------------------------------------------------------------ data
  let refreshing = null;
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const r = await U.cmd("state");
      if (r && r.ok) { S = r; render(); }
      else if (!S) { setStatus("halt", t("Error")); show("start"); }
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  let debounce = null;
  U.watch([K.job, K.scan, K.account, K.settings, K.ledger, K.whitelist, K.fol, K.owner], () => {
    clearTimeout(debounce);
    debounce = setTimeout(refresh, 120);
  });

  document.addEventListener("DOMContentLoaded", async () => {
    if (window.X7I18N) X7I18N.translateDom(document);
    wire();
    show("loading");
    await refresh();
    // Quietly refresh who is signed in, if an X tab is open.
    U.cmd("refreshAccount").then((r) => { if (r && r.ok) refresh(); });
  });
})();
