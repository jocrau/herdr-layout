// pr-board: pr-flow's queue of pull requests beside the chat (⌘⇧R): the PRs you review and your own, in
// pr-flow's sections and words. pr-flow keeps the state and rules; this pane reads `queue --format json`, runs
// `act`, and adds what the workbench knows: each PR's own agent tab (agent verbs go there) and the PR view
// (the git graph's dialog on the PR's range, with its findings; d, or ⌘⌥R).
// It reads the queue when pr-flow's state folder changes (one watch), every minute while shown, and syncs
// with GitHub every 10 minutes while shown (s: now).
// Keys (when focused), as in the fleet board and the git graph: j k / ↑ ↓ move · ⏎ ⇥ details · space the
// section's first action · d the PR view · o GitHub · t its agent tab (or a new one to talk) · w its pr-flow job's
// log in the tail panel at the bottom (- = its height, esc closes it) · c stop that job · s sync · / filter · ? keys.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, Input, InputState, ScrollHandle, Popup } from "gpui-base";
import { theme, settings, nextCommand, props, layout, notify, watchFolder, checking, closeOverlay } from "herdr";
import { readQueue, lastQueue, queueRows, stateDir, doVerb, verbPlan, jobFor, jobText, jobLabel, detailJob, jobActive, jobDetail, findingsText, jobShow, jobStop, jobTerminal, jobLog, openPrView, talkTab, prTab, tabName, parseKey, draftReady, storedDraft, capabilities } from "./lib/prflow.js";
import { tabDot, alpha, numWidth } from "./lib/prrows.js";
import { GROUPS, arrange, moveOf, nextStep, people, waitingOn, splitTitle, ago, actionsFor, agentWaits, agentAtWork, placeText } from "./model.js";
import { tipText } from "./lib/tiptext.js";
import { closeSide } from "./lib/sidecolumn.js";
import { boardHeader, boardTop } from "./lib/boardheader.js";
import { tailPanel, TailSize } from "./lib/tailpanel.js";

const LINE = 20, GAP = 6; // a row's first line, and the gap between its columns
// Where a row's text column starts: the row's padding and border, the dot, the number column.
const textAt = (numW) => 8 + 2 + 8 + GAP + numW + GAP;
const SYNC_EVERY = 600000; // with GitHub (only what changed), while shown
const READ_EVERY = 60000; // pr-flow's stored queue (no GitHub), while shown
const STUCK_AFTER = 240000; // a read still going after this is taken as lost (a sync gives up after 180 s)
const FOLLOW_EVERY = 2000; // the open PR's running job (`job show --json`), while its details are open
const TAIL_EVERY = 3000; // the tail panel re-reads a running job's log this often
// Actions that finish what you had to do on the PR (nothing to follow up here): its card closes once one is done.
const NO_FOLLOW_UP = new Set(["handback", "later", "ignore", "approve", "post", "copy", "discard", "close"]);
const HOLD_AFTER_KEY = 4000; // the order holds this long after a key or click in the pane (and while the pointer is over it)
const MOVED_FLASH = 4000; // a PR that moved shows in its new place this long
const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const syncedAgo = (ms) => (ms < 60000 ? "just now" : ms < 3600000 ? `${Math.round(ms / 60000)}m ago` : `${Math.round(ms / 3600000)}h ago`);

// Whether the pane can be seen: a block unless it, or a node above it, is hidden (⌘⇧R).
function shown() {
  const walk = (n, hidden) => {
    if (!n || typeof n !== "object") return null;
    const h = hidden || Boolean(n.hidden);
    if (n.content?.mod === "pr-board") return !h;
    for (const c of n.children ?? []) { const r = walk(c, h); if (r !== null) return r; }
    return null;
  };
  return props()?.overlay ? true : walk(layout(), false) ?? true;
}

export default class PrBoard extends View {
  init(_props, cx) {
    this.h = cx.focus_handle();
    this.q = lastQueue(); this.err = null; this.loading = null; this.lastSync = 0; this.readAt = 0;
    this.sel = null; this.openKey = null; this.fold = new Map(); // section letter -> open (pr-flow's default otherwise)
    this.order = []; this.confirm = null; this.busy = null; this.help = false;
    this.follow = null; // the open PR's job as last shown: { id, job }
    // The tail panel at the bottom: the open (else selected) PR's job log, from the job's directory (w, log ↗).
    // `final`: read after the job ended, so it isn't read again.
    this.tailOn = false; this.tail = { id: null, lines: [], at: 0, error: null, final: false };
    this.tailSize = new TailSize("pr-board.tail-height"); this.tailWrap = false; this.tailOpen = new Set();
    // The order holds while you work in the pane (the pointer over it, a key or click just now): cards change in place,
    // none moves under the pointer. `snap`: the blocks as drawn when it started ([{ group, label, keys }]); `seen`:
    // each PR as last drawn (a PR gone from the queue stays in its place until the order is let go); `flash`: PRs
    // that moved when it was let go, key -> until, highlighted in their new place; `held`: each PR's place in Your
    // move, where it stays while an agent you started works on it (moveOf's row.held).
    this.hovered = false; this.inputAt = 0; this.snap = null; this.drawnBlocks = null; this.seen = new Map(); this.flash = new Map(); this.held = new Map();
    this.filter = ""; this.filtering = false;
    this.filterState = InputState.new({ placeholder: "number, repo, title, author" });
    this.filterState.on("change", (_e, cx) => { this.filter = this.filterState.value().trim().toLowerCase(); this.snap = null; cx.notify(); });
    this.filterState.on("focus", (_e, cx) => { this.filtering = true; cx.notify(); });
    this.filterState.on("blur", (_e, cx) => { this.filtering = false; cx.notify(); });
    this.scroll = ScrollHandle.new();
    if (checking()) return;
    // Opened as an overlay (⌘⌥R, mod.open:pr-board): only a way to the PR view, which works with the pane
    // hidden too: it opens the view on the first PR that needs you and closes itself.
    if (props()?.overlay) {
      const overlay = props().overlay;
      cx.spawn(async () => { if (!this.q) this.q = await readQueue(); this.openView(); closeOverlay(overlay); });
      return;
    }
    cx.spawn(async (cx) => { await this.read(cx, "sync"); this.watch(cx); });
    cx.timer.every(15000, (cx) => this.tick(cx));
    cx.timer.every(FOLLOW_EVERY, (cx) => this.followJob(cx));
    cx.timer.every(1000, (cx) => { this.tailRead(cx); this.settle(cx); });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^pr-board\./, "");
        if (c === "focus") this.h.focus();
        else if (c === "view") this.openView();
        // pr:<repo>#<n> (or owner/repo#n): that PR's view, e.g. from a key or a script.
        else if (c.startsWith("pr:")) { const want = c.slice(3); const r = queueRows(this.q).find((x) => x.key === want || x.short === want); if (r) openPrView(r.key); else notify({ title: `${want} isn't in pr-flow's queue`, level: "info", timeout: 3000 }); }
        else if (c === "sync") this.read(cx, "force");
        cx.notify();
      }
    });
  }

  // ---------- reading

  // The queue: pr-flow's stored one, or (`sync`) after asking GitHub what changed ("force": even if it synced
  // in the last 10 minutes).
  // One read at a time. A read that never comes back (cut off by a layout reload, say) mustn't stop the pane
  // reading for good: after STUCK_AFTER the next read goes ahead, and the stale one's answer is dropped.
  async read(cx, sync = null) {
    if (this.loading && Date.now() - this.loadingAt < STUCK_AFTER) return;
    const mine = (this.reads = (this.reads ?? 0) + 1);
    this.loading = sync ? "sync" : "read"; this.loadingAt = Date.now(); cx.notify();
    let q;
    try { q = await readQueue({ sync: Boolean(sync), maxAge: sync === "force" ? "1m" : "10m" }); }
    catch (e) { q = { error: `reading pr-flow's queue failed: ${e?.message ?? e}` }; }
    if (mine !== this.reads) return;
    this.loading = null; this.readAt = Date.now();
    if (q.error) this.err = q.error;
    else { this.q = q; this.err = null; if (sync) this.lastSync = Date.now(); }
    cx.notify();
  }

  // pr-flow's state folder: a recorded step (events.jsonl) or a PR's record changing means the queue did.
  // Changes right after this pane's own read are its own (sync writes them).
  async watch(cx) {
    const dir = await stateDir();
    for (;;) {
      let paths;
      try { paths = await watchFolder(dir); } catch { return; }
      if (!paths.some((p) => /\/events\.jsonl$|\/prs\/[^/]+\.json$/.test(p))) continue;
      if (this.loading || Date.now() - this.readAt < 3000) continue;
      cx.timer.after(800, (cx) => this.read(cx));
    }
  }

  tick(cx) {
    const q = lastQueue(); // another copy (the PR view) may have read it since
    if (q && q.at > (this.q?.at ?? 0)) this.q = q;
    if (!shown()) return;
    if (Date.now() - this.lastSync > SYNC_EVERY) this.read(cx, "sync");
    else if (Date.now() - this.readAt > READ_EVERY) this.read(cx);
    else cx.notify(); // the times and tab dots
  }

  // The open PR's job, followed while it runs: `job show <id> --json` every 2 s (the queue's `job list` is read only
  // when pr-flow records a step, a job's progress at most every 30 s), its current phase shown in the details. When
  // it ends, the queue is read again (the row, the findings).
  followJob(cx) {
    if (this.followBusy || !this.openKey || !shown()) return;
    const r = this.row(this.openKey), cur = r && this.jobOf(r);
    if (!jobActive(cur)) return;
    this.followBusy = true;
    cx.spawn(async (cx) => {
      let got = null;
      try { got = await jobShow(cur.id); } catch { /* next tick */ }
      this.followBusy = false;
      if (!got) return;
      this.follow = { id: got.id, job: got };
      if (!jobActive(got)) await this.read(cx);
      cx.notify();
    });
  }

  // The job shown in a row's details: the queue's, or the followed one when that's the same and newer.
  jobOf(r, now = Date.now()) {
    const j = detailJob(this.q, r, now);
    return j && this.follow?.id === j.id && this.follow.job ? this.follow.job : j;
  }

  // ---------- acting

  // The PR the tail panel shows: the open one, else the selected one; and its job.
  tailRow() { const key = this.openKey ?? this.sel; return key ? this.row(key) : null; }
  tailJob() { const r = this.tailRow(); return r ? this.jobOf(r) : null; }

  // w, log ↗ / output ↗: the tail panel with the job's log, or closed again.
  toggleTail(cx) {
    this.tailOn = !this.tailOn;
    if (this.tailOn) cx.timer.after(0, (cx) => this.tailRead(cx));
  }

  // The job's log for the panel (jobLog: its transcript, else runner.log, else its phase): at once when the job
  // changes, every TAIL_EVERY while it runs, once more when it ended; only while the panel is open and shown.
  tailRead(cx) {
    if (this.tailBusy || !this.tailOn || !shown()) return;
    const j = this.tailJob();
    if (!j) return;
    const same = this.tail.id === j.id;
    if (same && (this.tail.final || Date.now() - this.tail.at < TAIL_EVERY)) return;
    this.tailBusy = true;
    const final = !jobActive(j);
    cx.spawn(async (cx) => {
      let next;
      // An ended job is read once, unless that read found nothing (a timeout while busy): then again shortly.
      try { const r = await jobLog(j); next = { id: j.id, lines: r.lines, at: Date.now(), error: null, final: final && r.source !== "phase" }; }
      catch (e) { next = { id: j.id, lines: [], at: Date.now(), error: `reading the job's log failed: ${e?.message ?? e}`, final }; }
      this.tailBusy = false;
      this.tail = next;
      cx.notify();
    });
  }

  // The job's output from pr-flow in a terminal under the focused pane (`job show --follow` while it runs):
  // the tail panel's terminal button.
  jobOutput(row) {
    const j = row && this.jobOf(row);
    if (!j) return;
    jobTerminal(j).then((err) => { if (err) notify({ title: "Can't show the job", body: err, level: "error", timeout: 8000 }); });
  }

  // c: stops the PR's running or queued job. Local and quick to start again (pr-flow releases its claim), so not
  // asked first, as later and ignore aren't.
  stopJob(row, cx) {
    const j = row && this.jobOf(row);
    if (!jobActive(j)) return;
    this.busy = `stopping ${j.verb} ${row.short}`; cx.notify();
    cx.spawn(async (cx) => {
      const r = await jobStop(j.id);
      this.busy = null;
      if (r.job) this.follow = { id: r.job.id, job: r.job };
      notify({ title: r.ok ? r.message : `Stopping ${j.verb} ${row.short} failed`, body: r.ok ? "" : r.message, level: r.ok ? "success" : "error", timeout: r.ok ? 5000 : 12000 });
      await this.read(cx);
      cx.notify();
    });
  }

  // The queue's rows, each PR whose agent works with the place it had in Your move (row.held, moveOf).
  rows() {
    return queueRows(this.q).map((r) => (agentAtWork(r) && this.held.has(r.key) ? { ...r, held: this.held.get(r.key) } : r));
  }
  row(key) { return this.rows().find((r) => r.key === key) ?? null; }

  // Whether the order holds: the pointer over the pane, a key or click in it just now, a question or menu open.
  holding() { return this.hovered || Date.now() - this.inputAt < HOLD_AFTER_KEY || Boolean(this.confirm) || Boolean(this.moreOpen); }
  // A key or click: the order holds a while longer, and is looked at again when that's over.
  touched() { this.inputAt = Date.now(); }
  // Every second: drawn again when the order is let go, or a moved PR's highlight is over.
  settle(cx) {
    const now = Date.now(), over = [...this.flash].filter(([, until]) => until <= now).map(([k]) => k);
    for (const k of over) this.flash.delete(k);
    if (over.length || (this.snap && !this.holding())) cx.notify();
  }

  // The PR's agent tab, to talk about it: shown, or opened with the PR's context and no action (talkTab).
  talk(row, cx) {
    cx.spawn(async (cx) => {
      if ((await talkTab(row.key, row)) === "opened") notify({ title: `A new agent tab ${tabName(row.key)}`, body: "To talk about the PR: it reads it, then waits for you.", level: "success", timeout: 4000 });
      cx.notify();
    });
  }

  // A verb on a PR: a session's (and, until pr-flow has job definitions, a job's) in the PR's own agent tab, the
  // rest through pr-flow (verbPlan). One that changes something on GitHub asks first, in pr-flow's words with its
  // view model (in the bar at the top: ⏎ yes, Esc no); one that can't run now says why instead.
  runVerb(verb, row, cx, drafted = false) {
    if (!row) return;
    const plan = verbPlan(row, verb, this.q?.data?.verbs), kind = plan.kind;
    if (plan.disabled) { notify({ title: `${plan.label}: not now`, body: plan.disabled, level: "info", timeout: 5000 }); return; }
    // Post or copy with a stored draft (pr-flow's `draft`): the PR view shows that version first, its comments on
    // their lines, and posts or copies it from there; without one, as before.
    if ((verb === "post" || verb === "copy") && !drafted) {
      cx.spawn(async (cx) => {
        const d = (await capabilities()).has("draft") ? await storedDraft(row.key) : null;
        if (d) {
          openPrView(row.key);
          notify({ title: `${row.short}: draft v${d.v} in the PR view`, body: `Read it there, each comment on its line; ${verb} it from its panel.`, level: "info", timeout: 5000 });
        } else cx.timer.after(0, (cx) => this.runVerb(verb, row, cx, true));
        cx.notify();
      });
      return;
    }
    if (plan.confirm && this.confirm?.verb !== verb) {
      this.confirm = { verb, row, text: plan.confirm };
      cx.notify(); return;
    }
    this.confirm = null; this.busy = `${verb} ${row.short}`; cx.notify();
    cx.spawn(async (cx) => {
      const r = await doVerb(verb, row.key, { url: row.url, kind });
      this.busy = null;
      // Done, nothing to follow up: the card closes (a click on the card that comes under the pointer only opens it).
      if (r.ok && NO_FOLLOW_UP.has(verb) && this.openKey === row.key) { this.openKey = null; this.moreOpen = null; }
      notify({ title: r.ok ? r.message : `${verb} ${row.short}: ${r.status ?? "failed"}`, body: r.ok ? "" : r.message, level: r.ok ? "success" : r.status === "needs-human" ? "warning" : "error", timeout: r.ok ? 5000 : 12000 });
      if (kind !== "agent" && verb !== "open") await this.read(cx);
      cx.notify();
    });
  }

  // ⌘⌥R / d: the PR view on the selected PR, else the first that needs you.
  openView() {
    // In the pane's order (lib/prmodel.js): the selected PR, else the first of Your move.
    const key = this.sel ?? arrange(this.rows()).flatMap((b) => b.rows)[0]?.key;
    if (key) openPrView(key);
  }

  // ---------- keyboard

  key(e, cx) {
    const k = e.keystroke;
    this.touched();
    if (this.filtering) {
      if (k === "escape") { this.filterState.set_value(""); this.filter = ""; this.h.focus(); }
      else if (k === "enter" || k === "down") this.h.focus();
      else return;
      cx.stop_propagation(); cx.notify(); return;
    }
    if (this.confirm && (k === "enter" || k === "escape")) {
      const c = this.confirm; this.confirm = null;
      if (k === "enter") { this.confirm = c; this.runVerb(c.verb, c.row, cx); } // runVerb sees it was asked
      cx.stop_propagation(); cx.notify(); return;
    }
    const is = (...names) => names.includes(k), order = this.order, at = order.indexOf(this.sel);
    const row = this.sel ? this.row(this.sel) : null;
    const moveTo = (i) => { this.sel = order[Math.max(0, Math.min(order.length - 1, i))] ?? this.sel; if (this.openKey) this.openKey = this.sel; this.reveal = true; };
    if (this.help && !is("?", "shift-/")) { this.help = false; cx.stop_propagation(); cx.notify(); return; }
    if (is("j", "down", "ctrl-n")) moveTo(at + 1);
    else if (is("k", "up", "ctrl-p")) moveTo(at < 0 ? 0 : at - 1);
    else if (is("g", "home")) moveTo(0);
    else if (is("shift-g", "end")) moveTo(order.length - 1);
    else if (is("enter", "tab") && row) { this.openKey = this.openKey === row.key ? null : row.key; this.moreOpen = false; }
    else if (is("l", "right") && row) this.openKey = row.key;
    else if (is("escape") && this.tailOn) this.tailOn = false; // the tail first: the last thing opened, at the bottom
    else if (is("h", "left", "x", "escape") && this.openKey) this.openKey = null;
    else if (is("space") && row && agentWaits(row)) this.talk(row, cx);
    else if (is("space") && row && actionsFor(row).main) this.runVerb(actionsFor(row).main, row, cx);
    else if (is("d") && row) openPrView(row.key);
    else if (is("o") && row) this.runVerb("open", row, cx);
    else if (is("t") && row) this.talk(row, cx);
    else if (is("w") && (this.tailOn || (row && this.jobOf(row)))) this.toggleTail(cx);
    else if (is("-") && this.tailOn) this.tailSize.step(-1, this.height, cx);
    else if (is("=") && this.tailOn) this.tailSize.step(1, this.height, cx);
    else if (is("c") && row && jobActive(this.jobOf(row))) this.stopJob(row, cx);
    else if (is("s")) this.read(cx, "force");
    else if (is("r")) this.read(cx);
    else if (is("/")) cx.timer.after(0, () => this.filterState.focus());
    else if (is("backspace") && this.filter) { this.filterState.set_value(""); this.filter = ""; }
    // Esc undoes one thing at a time (the filter, then the open PR, above); with nothing left, it closes the column.
    else if (is("escape") && this.filter) { this.filterState.set_value(""); this.filter = ""; }
    else if (is("escape")) closeSide("pr-board");
    else if (is("?", "shift-/")) this.help = !this.help;
    else return;
    cx.stop_propagation(); cx.notify();
  }

  // ---------- drawing

  match(r) {
    const f = this.filter;
    return !f || `#${r.key.split("#")[1]} ${r.short} ${r.title} ${r.author}`.toLowerCase().includes(f);
  }

  header(t) {
    const rows = this.rows(), needs = rows.filter((r) => moveOf(r)[0] === "you" && !agentAtWork(r));
    const syncedAt = this.q?.data?.lastSync ? Date.parse(this.q.data.lastSync) : 0;
    const synced = syncedAt ? syncedAgo(Date.now() - syncedAt) : "not yet", stale = !syncedAt || Date.now() - syncedAt > 1800000;
    const warnings = this.q?.warnings ?? [];
    return boardTop(t,
      boardHeader(t, {
        mod: "pr-board", title: "PRs",
        facts: [
          { id: "pr-needs", text: needs.length ? `${needs.length} need you` : "nothing needs you", color: needs.length ? t.ansi1 : t.dim },
          ...(this.newCount ? [{ id: "pr-new", text: `+${this.newCount} new`, color: t.accent, tip: "New in the queue: shown when the pointer leaves the pane (the order holds while you work in it)" }] : []),
          { id: "pr-synced", text: `${this.q?.data?.tracked ?? 0} tracked · synced ${synced}`, color: stale ? t.ansi3 : t.dim,
            tip: stale ? "pr-flow hasn't synced with GitHub for a while: s syncs now" : "When pr-flow last asked GitHub" },
        ],
        buttons: [{ id: "pr-sync", label: "↻", tip: tipText("Sync with GitHub now (s)"), color: this.loading ? t.accent : null,
          pulse: Boolean(this.loading), onClick: (cx) => this.read(cx, "force") }],
      }),
      this.err ? div().w_full().text_size(11.5).text_color(t.ansi1).child(this.err) : null,
      ...warnings.map((w) => div().w_full().text_size(11).text_color(t.ansi3).child(w)));
  }

  // The question before an outward action: under its PR (rows below make room; nothing above moves), else, when the
  // PR isn't drawn (folded, filtered), at the top.
  confirmBar(t, numW = null) {
    const c = this.confirm;
    const btn = (id, label, primary, go) => div().id(id).px(10).py(3).rounded(5).text_size(12).cursor_pointer()
      .bg(primary ? t.solid ?? t.accent : t.raised).text_color(primary ? t.solid_foreground ?? t.background : t.foreground)
      .hover((e) => e.opacity(0.85)).on_click(go).child(label);
    return v_flex().px(10).py(8).gap(6).bg(t.raised).when(numW === null, (e) => e.border_b_1().border_color(t.border)).when(numW !== null, (e) => e.pl(textAt(numW)))
      .child(div().text_size(12).text_color(t.foreground).child(c.text))
      .child(h_flex().gap(6)
        .child(btn("pr-confirm-yes", `${c.verb[0].toUpperCase()}${c.verb.slice(1)} ⏎`, true, (_e, cx) => this.runVerb(c.verb, c.row, cx)))
        .child(btn("pr-confirm-no", "Cancel esc", false, (_e, cx) => { this.confirm = null; cx.notify(); })));
  }

  // The PR's own facts the row doesn't show (under its context line while open): the branch, GitHub's verdict
  // when it says something, open threads, conflicts, each unless the card says it already.
  prFacts(r) {
    const rec = r.rec ?? {}, said = `${r.detail ?? ""} ${r.title ?? ""} ${nextStep(r).text}`.toLowerCase();
    return [
      rec.headRef && rec.headRef !== r.title ? `${rec.headRef} → ${rec.baseRef ?? "?"}` : null,
      rec.decision === "APPROVED" || rec.decision === "CHANGES_REQUESTED" ? rec.decision.toLowerCase().replace(/_/g, " ") : null,
      rec.threads?.unresolved && !/thread/.test(said) ? `${rec.threads.unresolved} open thread${rec.threads.unresolved === 1 ? "" : "s"}` : null,
      rec.conflicts && !said.includes("conflict") ? "conflicts" : null,
    ].filter(Boolean);
  }

  // The open row's details: why it's where it is, the facts, and what you can do.
  // The open row's details: only what the row doesn't already say (its detail line, findings, CI and size are
  // on the row), lined up under the row's text.
  details(t, mono, r, numW) {
    const rec = r.rec ?? {}, verbs = this.q?.data?.verbs ?? {};
    // Each thing once. Not what the card says already (its title, detail line, next step), nor a one-word
    // reason that only names the section ("draft").
    const said = `${r.detail ?? ""} ${r.title ?? ""} ${nextStep(r).text}`.toLowerCase();
    const reasons = (rec.reasons ?? []).filter((x) => /\s/.test(x.trim()) && !/\bjob-\d{8}-/.test(x) && !said.includes(x.toLowerCase().replace(/^re-review: head moved since/, "re-review what changed since")));
    const pill = (id, label, tip, primary, go) => div().id(id).px(7).py(2).rounded(5).text_size(11.5).cursor_pointer()
      .border_1().border_color(primary ? t.accent : t.border).text_color(primary ? t.accent : t.foreground)
      .hover((e) => e.bg(t.hover)).tooltip(tipText(tip)).on_click(go).child(label);
    // Only what's possible now (actionsFor in model.js, pr-flow's labels): the next step's action, its
    // alternatives that can run now; housekeeping (later, ignore, close) quiet on the right.
    const tab = prTab(r.key), acts = actionsFor(r), job = this.jobOf(r);
    // A draft to read: the version a job stored, else whatever pr-flow drafted (the PR is at "post your comments").
    const draft = draftReady(this.q, r) ?? (r.stage === "NEEDS_YOU" ? { v: null } : null);
    const tip = (v) => {
      const p = verbPlan(r, v, verbs);
      const where = p.kind === "agent" ? `\nIn ${tabName(r.key)}'s agent tab` : p.kind === "job" ? `\nIn the background when pr-flow can run it as a job, else in ${tabName(r.key)}'s agent tab` : "";
      return `${verbs[v]?.help ?? v}${where}${p.disabled ? `\nNot now: ${p.disabled}` : ""}`;
    };
    // The verb the last job ran, done: its button says "again" (Self-check again).
    const again = (v) => job?.state === "done" && job.verb === v;
    const verbPill = (v, primary) => {
      const p = verbPlan(r, v, verbs);
      return pill(`pr-${r.key}-${v}`, again(v) ? `${p.label} again` : p.label, tip(v), primary && !p.disabled, (_e, cx) => this.runVerb(v, r, cx)).when(Boolean(p.disabled), (e) => e.opacity(0.5));
    };
    const quiet = (v) => div().id(`pr-${r.key}-${v}`).px(5).py(2).text_size(11.5).text_color(t.dim).cursor_pointer().hover((e) => e.text_color(t.foreground))
      .tooltip(tipText(tip(v))).on_click((_e, cx) => this.runVerb(v, r, cx)).child(verbPlan(r, v, verbs).label.toLowerCase());
    // A quiet text link (where to look; the job's output and stop).
    const link = (id, label, tip, go, hot = false) => div().id(id).px(5).py(2).text_size(11.5).cursor_pointer()
      .text_color(hot ? t.accent : t.muted).hover((e) => e.text_color(t.foreground)).tooltip(tipText(tip)).on_click(go).child(label);
    // Housekeeping on the right of the buttons: one as a quiet word, more under ⋯.
    const menuOpen = this.moreOpen === r.key;
    const more = acts.keep.length <= 1 ? acts.keep.map(quiet)
      : [Popup.new(`pr-${r.key}-more`, div().id(`pr-${r.key}-more-btn`).px(6).py(2).rounded(4).text_size(12).cursor_pointer()
          .text_color(menuOpen ? t.foreground : t.dim).hover((e) => e.text_color(t.foreground)).tooltip(tipText(acts.keep.map((v) => verbPlan(r, v, verbs).label).join(", ")))
          .on_click((_e, cx) => { this.moreOpen = menuOpen ? null : r.key; cx.notify(); }).child("⋯"))
        .anchor("top_right")
        .when(menuOpen, (e) => e.content(v_flex().id(`pr-${r.key}-more-menu`).mt(4).py(4).min_w(140).rounded(6).bg(t.raised ?? t.background).border_1().border_color(t.border).shadow_lg()
          .on_mouse_down_out((_e, cx) => { this.moreOpen = null; cx.notify(); })
          .children(acts.keep.map((v) => div().id(`pr-${r.key}-more-${v}`).px(10).py(3).text_size(11.5).text_color(t.foreground).cursor_pointer()
            .hover((e) => e.bg(t.hover)).tooltip(tipText(tip(v))).on_click((_e, cx) => { this.moreOpen = null; this.runVerb(v, r, cx); }).child(verbPlan(r, v, verbs).label)))))];
    const actions = h_flex().gap(4).items_start()
      .child(h_flex().flex_1().min_w(0).gap(4).flex_wrap().items_center()
        .when(Boolean(acts.main), (e) => e.child(verbPill(acts.main, true)))
        .children(acts.also.filter((v) => !verbPlan(r, v, verbs).disabled).map((v) => verbPill(v, false)))
        .when(Boolean(draft), (e) => e.child(pill(`pr-${r.key}-draft`, draft.v ? `draft v${draft.v} ↗` : "draft ↗", "The draft in the PR view: its summary, each comment on its line; post, copy, shorter, softer, more there (d)", false, () => openPrView(r.key)))))
      .child(h_flex().flex_none().pt(1).items_center().children(more));
    const where = h_flex().gap(2).flex_wrap().items_center()
      .child(link(`pr-${r.key}-view`, "PR view ↗", "The PR view: its files and diff, each finding on its line, in the git graph (d)", () => openPrView(r.key)))
      .child(link(`pr-${r.key}-tab`, "Agent tab ↗", tab ? `Its agent tab ${tabName(r.key)} (t)`
        : `Its agent tab ${tabName(r.key)} (t), new: it reads the PR, then waits for your questions and takes no action unless you ask. Actions on the PR go to the same tab.`, (_e, cx) => this.talk(r, cx), agentWaits(r)))
      .child(link(`pr-${r.key}-gh`, "GitHub ↗", r.url, (_e, cx) => this.runVerb("open", r, cx)));
    // What happened and what you can do; then, apart, where to look.
    return v_flex().pl(textAt(numW)).pr(10).pt(2).pb(8).gap(10).bg(alpha(t.raised, "aa"))
      .child(v_flex().gap(5)
        .when(Boolean(job), (e) => e.child(this.jobLine(t, r, job, link)))
        .children(reasons.filter((x) => !(draft && /draft ready/i.test(x))).slice(0, 3).map((x) => div().text_size(11.5).text_color(t.foreground).child(x)))
        .child(actions))
      .child(where);
  }

  // The PR's last pr-flow job, in a sentence (capability `jobs`): running ("Self-check running · reading the diff ·
  // 2m", with its output and stop), what a finished review or self-check found and when, why one failed; the
  // runtime, model, cost and id in its tooltip. One line that keeps its height while the job runs.
  jobLine(t, r, j, link) {
    const verb = jobLabel(j, r), label = `${verb[0]?.toUpperCase() ?? ""}${verb.slice(1)}`; // "Self-check" on your own PR
    const d = jobDetail(j, Date.now(), label), active = jobActive(j), failed = j.state === "failed";
    const ended = j.ended_at ? `${ago(Date.now() - Date.parse(j.ended_at))} ago` : null;
    const text = active ? `◷ ${d.state}`
      : failed ? `${label} failed${ended ? ` ${ended}` : ""}: ${d.error}`
      : j.state === "done" && j.artifact?.kind === "findings" ? `${label} found ${findingsText(r.rec?.open, true) || "nothing open"}${ended ? ` · ${ended}` : ""}`
      : `${d.state}${ended ? ` · ${ended}` : ""}`;
    const cost = typeof j.cost === "number" ? `$${j.cost.toFixed(2)}` : null;
    return h_flex().gap(2).items_start()
      .child(div().id(`pr-${r.key}-job`).flex_1().min_w(0).when(!failed, (e) => e.truncate()).py(2).text_size(11.5)
        .text_color(failed ? t.ansi1 : active ? t.accent : t.foreground)
        .tooltip(tipText([d.state, d.meta, cost].filter(Boolean).join("\n"))).child(text))
      .child(link(`pr-${r.key}-job-out`, active ? "output ↗" : "log ↗",
        active ? "What the agent is doing, followed in the tail at the bottom (w): its words, commands and errors" : "What the agent did, in the tail at the bottom (w): its words, commands, errors and result",
        (_e, cx) => { this.sel = r.key; this.toggleTail(cx); cx.notify(); }, this.tailOn && this.tail.id === j.id))
      .when(active, (e) => e.child(link(`pr-${r.key}-job-stop`, "stop", "Stop the job (c): pr-flow ends it and releases the PR", (_e, cx) => this.stopJob(r, cx))));
  }

  // The tail panel (lib/tailpanel.js, the fleet board's): "self-check #42", following or ended, the job's lines.
  tailView(t, mono) {
    const r = this.tailRow(), j = r && this.jobOf(r), same = j && this.tail.id === j.id, now = Date.now();
    const live = jobActive(j), secs = Math.max(0, Math.round((now - this.tail.at) / 1000));
    const k = r && parseKey(r.key);
    return tailPanel(t, {
      mono, size: this.tailSize, pane: this.height, ids: "pr-tail",
      title: j ? `${jobLabel(j, r)} #${k?.n ?? "?"}` : r ? `#${k?.n ?? "?"}` : "",
      titleTip: j ? `${r.short} · ${jobDetail(j, now, jobLabel(j, r)).state}\n${j.id}` : null,
      status: same ? { text: live ? `following · ${secs < 60 ? `${secs}s` : ago(now - this.tail.at)} ago` : "ended", live } : null,
      note: !r ? "Select a PR to see its job's log." : !j ? "No pr-flow job on this PR." : !same ? "Reading…" : null,
      error: same ? this.tail.error : null, lines: same ? this.tail.lines : [],
      wrap: this.tailWrap, opened: this.tailOpen,
      onWrap: same && !this.tail.error ? () => { this.tailWrap = !this.tailWrap; } : null,
      onTerminal: j ? () => this.jobOutput(r) : null,
      terminalTip: j ? `pr-flow job show ${j.id}${live ? " --follow" : ""}, in a terminal below` : "",
      onClose: () => { this.tailOn = false; }, closeTip: "Close the tail (w, esc)",
    });
  }

  keyList(t) {
    const rows = [
      ["j k  ↑ ↓", "move (g G top and bottom)"], ["⏎ ⇥  l h", "open or close the details"],
      ["space", "the section's first action (approve asks first); its agent tab when its agent waits for you"], ["d", "the PR view: files, diff, findings"],
      ["t", "its agent tab; without one, a new tab to talk about the PR (agent actions run there too)"], ["o", "the PR on GitHub"],
      ["w", "its pr-flow job's log in the tail at the bottom (followed while it runs; terminal there: pr-flow's own output)"],
      ["- =", "the tail three lines shorter / taller (or drag its top edge; double-click: back to 14)"], ["esc", "close the tail (then the details)"],
      ["c", "stop its running or queued pr-flow job"],
      ["s", "sync with GitHub now"], ["r", "read the queue again"], ["/", "filter (esc clears)"], ["?", "this list"],
    ];
    return v_flex().px(10).py(10).gap(3)
      .child(div().pb(4).text_size(11).font_semibold().text_color(t.dim).child("KEYS"))
      .children(rows.map(([k, w]) => h_flex().gap(10).child(div().w(80).flex_none().text_size(11.5).child(k)).child(div().flex_1().text_size(11.5).text_color(t.muted).child(w))));
  }

  // ---------- the list, by your next move (model.js)

  // A PR whose move is yours: what it is, who's in it, and the next step.
  // Rows are three columns: the agent tab's dot, the number (right-aligned, as wide as the widest), and the
  // text; every line of a row, and its details, start in the text column. The number stays on the first line.
  cols(t, mono, r, numW, text, { sel, problem, h, color, away }) {
    const k = parseKey(r.key), flash = (this.flash.get(r.key) ?? 0) > Date.now();
    return h_flex().id(`pr-row-${r.key}`).pl(8).pr(10).py(h ? 0 : 7).when(Boolean(h), (e) => e.h(h)).gap(GAP).when(!h, (e) => e.items_start()).when(Boolean(h), (e) => e.items_center()).cursor_pointer()
      .border_l_2().border_color(problem ? t.ansi1 : sel ? t.accent : alpha(t.border, "00"))
      .when(sel, (e) => e.bg(t.hover)).when(flash, (e) => e.bg(alpha(t.accent, "22"))).hover((e) => e.bg(t.hover))
      .when(Boolean(away), (e) => e.opacity(0.55))
      .child(h_flex().w(8).h(LINE).flex_none().items_center().child(tabDot(t, r.key)))
      .child(div().w(numW).h(LINE).flex_none().flex().items_center().justify_end().font_family(mono).text_size(11.5).text_color(color ?? t.dim).child(`#${k?.n ?? "?"}`))
      .child(text);
  }

  // A PR whose move is yours, in order of weight: what it is (the title), what to do (the next step: accent,
  // red when something's wrong), then one quiet line of context (repo · author → reviewers · pushed · size).
  // `leaving`: where it goes, while the order holds (it moves when you're done in the pane); `away`: out of Your move.
  card(t, mono, r, me, now, numW, leaving = null, away = false) {
    const k = parseKey(r.key), { tag, title } = splitTitle(r.title), p = people(r, me), step = nextStep(r);
    const rec = r.rec ?? {}, open = this.openKey === r.key && !r.gone, job = jobFor(this.q, r, now), ready = draftReady(this.q, r); // a pr-flow job on it; a draft it stored
    // The second line: where it goes; else, while a job runs, what the agent does (the next step waits for it); else the next step.
    const working = jobActive(job) && !open;
    const pushed = rec.lastPush ? ago(now - Date.parse(rec.lastPush)) : "";
    const nFound = Object.values(rec.open ?? {}).reduce((a, n) => a + (n > 0 ? n : 0), 0);
    const mark = (m) => (m === "✓" ? t.ansi2 : m === "✗" ? t.ansi1 : t.dim);
    const sep = () => div().flex_none().text_color(t.dim).child("·");
    const text = v_flex().flex_1().min_w(0).gap(1)
      .child(h_flex().min_h(LINE).gap(6).items_center()
        .child(div().flex_1().min_w(0).when(!open, (e) => e.truncate()).text_size(12.5).font_semibold().text_color(t.foreground).child(title))
        .when(Boolean(tag), (e) => e.child(div().flex_none().px(4).rounded(3).bg(alpha(t.muted, "1a")).text_size(10).text_color(t.dim).child(tag))))
      .child(div().min_w(0).when(!open, (e) => e.truncate()).text_size(12)
        .text_color(leaving ? t.muted : working ? t.accent : step.problem ? t.ansi1 : t.accent)
        .child(leaving ? `→ ${leaving}` : working ? `◷ ${jobText(job, r)}` : step.text))
      .when(Boolean(job) && !working && !open, (e) => e.child(div().min_w(0).truncate().text_size(11.5).text_color(job.state === "failed" ? t.ansi1 : t.muted).child(`◷ ${jobText(job, r)}`)))
      // A draft or reword job stored a comment draft: it's ready to read, post or reword in the PR view.
      .when(!job && Boolean(ready), (e) => e.child(div().min_w(0).when(!open, (x) => x.truncate()).text_size(11.5).text_color(t.ansi6 ?? t.accent).child(`✎ draft v${ready.v} ready: read it in the PR view (d)`)))
      .child(h_flex().min_w(0).gap(4).items_center().overflow_hidden().text_size(11).text_color(t.dim)
        .child(div().flex_none().max_w(130).truncate().child(k?.repo ?? "")).child(sep())
        .child(div().flex_none().text_color(p.author === "you" ? t.muted : t.dim).child(p.author))
        .when(p.others.length > 0, (e) => e.child(div().flex_none().child("→"))
          .children(p.others.slice(0, 3).map((o, i) => h_flex().flex_none()
            .child(div().text_color(o.who === "you" ? t.muted : t.dim).child(o.who))
            .when(Boolean(o.mark), (x) => x.child(div().text_color(mark(o.mark)).child(o.mark)))
            .when(i < Math.min(3, p.others.length) - 1, (x) => x.child(div().child(","))))))
        .when(p.others.length > 3, (e) => e.child(div().flex_none().child(`+${p.others.length - 3}`)))
        .when(Boolean(pushed), (e) => e.child(sep()).child(div().flex_none().child(pushed)))
        .when(Boolean(r.size), (e) => e.child(sep()).child(div().flex_none().child(r.size)))
        // Open findings as a count ("6 findings", red with a high one, amber with a medium), the kinds in its tooltip.
        .when(nFound > 0, (e) => e.child(sep()).child(div().id(`pr-${r.key}-found`).flex_none().tooltip(tipText(findingsText(rec.open, true)))
          .text_color(rec.open?.critical || rec.open?.high ? t.ansi1 : rec.open?.medium ? t.ansi3 : t.muted).child(`${nFound} finding${nFound === 1 ? "" : "s"}`))))
      // Open: the PR's own facts (its branch → base, …) and what it changes, right under its context line.
      .when(open && this.prFacts(r).length > 0, (e) => e.child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(this.prFacts(r).join(" · "))))
      .when(open && Boolean(rec.about), (e) => e.child(div().min_w(0).pt(2).text_size(11.5).text_color(t.muted).child(`Changes: ${rec.about}`)));
    return this.cols(t, mono, r, numW, text, { sel: this.sel === r.key, problem: step.problem && !leaving, away })
      .on_click((_e, cx) => { this.touched(); this.sel = r.key; this.h.focus(); this.openKey = open || r.gone ? null : r.key; this.moreOpen = false; cx.notify(); });
  }

  // A PR waiting on others: one line, on whom and since when; a pr-flow job at work on it, what it's doing.
  line(t, mono, r, me, now, numW, leaving = null) {
    const { title } = splitTitle(r.title), w = waitingOn(r, me, now), sel = this.sel === r.key, job = jobFor(this.q, r, now);
    const who = leaving ? `→ ${leaving}` : job ? `◷ ${jobText(job, r)}` : w.who;
    const text = h_flex().flex_1().min_w(0).h(LINE).gap(6).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(title))
      .child(div().flex_none().max_w(job || leaving ? 200 : 130).truncate().text_size(11).text_color(leaving ? t.accent : job ? (job.state === "failed" ? t.ansi1 : t.accent) : t.dim).child(who))
      .child(div().flex_none().w(28).text_right().text_size(11).text_color(t.dim).child(w.since));
    return this.cols(t, mono, r, numW, text, { sel, h: 24 })
      .tooltip(tipText(`${r.short} · ${r.title}\n${nextStep(r).text || r.detail || ""}${job ? `\n${jobText(job, r)}` : ""}`))
      .on_click((_e, cx) => { this.touched(); this.sel = r.key; this.h.focus(); this.openKey = this.openKey === r.key || r.gone ? null : r.key; this.moreOpen = false; cx.notify(); });
  }

  body(t, mono) {
    const q = this.q, out = [], now = Date.now();
    this.order = []; this.drawn = new Map(); this.newCount = 0;
    if (!q) return [div().p(14).text_size(12).text_color(t.dim).child(this.err ?? "Reading pr-flow's queue…")];
    const me = q.me ?? null, all = this.rows(), numW = numWidth(all), byKey = new Map(all.map((r) => [r.key, r]));
    const live = arrange(all.filter((r) => this.match(r)));
    // Each PR's place in Your move, kept while an agent you started works on it (rows(), moveOf's row.held).
    for (const b of live) for (const r of b.rows) {
      if (b.group === "you" && !agentAtWork(r)) this.held.set(r.key, moveOf(r));
      else if (b.group !== "you") this.held.delete(r.key);
    }
    const shape = (bs) => bs.map((b) => ({ group: b.group, label: b.label, keys: b.rows.map((r) => r.key) }));
    let blocks;
    if (this.holding()) {
      // The order as drawn when you started working in the pane; each PR as it is now, a gone one as last seen.
      // New PRs wait (the header counts them).
      if (!this.snap) this.snap = this.drawnBlocks ?? shape(live);
      const inSnap = new Set(this.snap.flatMap((b) => b.keys));
      this.newCount = all.filter((r) => this.match(r) && !inSnap.has(r.key)).length;
      blocks = this.snap.map((b) => ({ group: b.group, label: b.label,
        rows: b.keys.map((k) => byKey.get(k) ?? (this.seen.has(k) ? { ...this.seen.get(k), gone: true } : null)).filter(Boolean) }));
    } else {
      // Let go: the PRs that moved show in their new place for a moment.
      if (this.snap) {
        const was = new Map(this.snap.flatMap((b) => b.keys.map((k) => [k, `${b.group}|${b.label}`])));
        for (const b of live) for (const r of b.rows) if (was.has(r.key) && was.get(r.key) !== `${b.group}|${b.label}`) this.flash.set(r.key, now + MOVED_FLASH);
        this.snap = null;
      }
      blocks = live;
    }
    this.drawnBlocks = shape(blocks);
    this.seen = new Map([...blocks.flatMap((b) => b.rows).filter((r) => r.gone).map((r) => [r.key, this.seen.get(r.key)]), ...all.map((r) => [r.key, r])]);
    // Where a PR goes, while the order holds it in its old place: null when it's still there.
    const leaving = (r, b) => {
      if (r.gone) return "left the queue";
      const [g, label] = moveOf(r);
      return g === b.group && (g !== "you" || label === b.label) ? null : placeText(r, me);
    };
    // Each group folded or open: Later and Dormant start folded; a filter opens everything.
    const isOpen = (g) => (this.filter ? true : this.fold.has(g) ? this.fold.get(g) : g !== "later" && g !== "dormant");
    for (const [g, label] of GROUPS) {
      const mine = blocks.filter((x) => x.group === g), rows = mine.flatMap((x) => x.rows);
      if (!rows.length) continue;
      const open = isOpen(g);
      // The group's heading (Your move · 5); in Your move, each action's too (Review · 2).
      out.push(h_flex().id(`pr-grp-${g}`).px(10).pt(out.length ? 18 : 10).pb(2).gap(6).items_center().cursor_pointer()
        .on_click((_e, cx) => { this.fold.set(g, !open); cx.notify(); })
        .child(div().text_size(10.5).font_semibold().text_color(t.muted).child(label.toUpperCase()))
        .child(div().text_size(11).text_color(t.dim).child(String(rows.length)))
        .child(div().flex_1()).child(div().text_size(10).text_color(t.dim).child(open ? "▾" : "▸")));
      if (!open) {
        out.push(div().pl(8 + 2 + 8 + GAP).pr(10).pb(2).truncate().font_family(mono).text_size(11).text_color(t.dim).child(rows.map((r) => `#${r.key.split("#")[1]}`).join("  ")));
        continue;
      }
      for (const blk of mine) {
        if (g === "you") out.push(h_flex().px(10).pl(8 + 2 + 8 + GAP + numW + GAP).pt(8).pb(1).gap(5).text_size(11).text_color(t.dim).child(blk.label).child(div().child(String(blk.rows.length))));
        for (const r of blk.rows) {
          this.order.push(r.key);
          this.drawn.set(r.key, out.length);
          const to = leaving(r, blk);
          out.push(g === "you" ? this.card(t, mono, r, me, now, numW, to, Boolean(to) && (r.gone || moveOf(r)[0] !== "you")) : this.line(t, mono, r, me, now, numW, to));
          if (this.openKey === r.key && !r.gone) out.push(this.details(t, mono, r, numW));
          if (this.confirm?.row.key === r.key) { out.push(this.confirmBar(t, numW)); this.confirmDrawn = true; }
        }
      }
    }
    if (!this.order.includes(this.sel)) this.sel = this.order[0] ?? null;
    if (!out.length) out.push(div().p(14).text_size(12).text_color(t.dim).child(this.filter ? "No PR matches." : "Nothing in pr-flow's queue."));
    return out;
  }

  render(_cx) {
    if (props()?.overlay) return div();
    const t = theme(), mono = settings().font_family ?? "JetBrains Mono";
    this.confirmDrawn = false;
    const body = this.help ? [this.keyList(t)] : this.body(t, mono);
    if (this.reveal) { const at = this.drawn?.get(this.sel); if (at !== undefined) this.scroll.scroll_to_item(at); this.reveal = false; }
    return v_flex().id("pr-board").size_full().bg(t.background).text_color(t.foreground)
      // Its height, for the tail's room (a change is drawn on the next frame, never during layout).
      .on_size_change((size) => { if (Math.abs((this.height ?? 0) - size.height) > 1) { this.height = size.height; } })
      // The tail's top edge drags over the whole pane; a drag ends when the pointer leaves it (a release outside never arrives).
      .on_mouse_move((e, cx) => this.tailSize.move(e, cx))
      .on_mouse_up("left", (_e, cx) => this.tailSize.end(this.height, cx))
      // The pointer over the pane holds the order (holding()); leaving it lets go.
      .on_hover((hovered, cx) => {
        if (!hovered) this.tailSize.end(this.height, cx);
        if (this.hovered !== Boolean(hovered)) { this.hovered = Boolean(hovered); cx.notify(); }
      })
      .on_mouse_down("left", () => this.touched())
      .track_focus(this.h).on_key_down((e, cx) => this.key(e, cx))
      .child(this.header(t))
      .when(Boolean(this.confirm) && !this.confirmDrawn, (e) => e.child(this.confirmBar(t)))
      .when(this.filtering || Boolean(this.filter), (e) => e.child(h_flex().px(10).py(4).gap(6).items_center().border_b_1().border_color(t.border)
        .child(div().text_size(12).text_color(this.filtering ? t.accent : t.dim).child("/"))
        .child(Input.new(this.filterState).flex_1().text_size(12))))
      .child(v_flex().id("pr-list").flex_1().min_h(0).pb(8).overflow_y_scrollbar().track_scroll(this.scroll).children(body))
      .when(this.tailOn, (e) => e.child(this.tailView(t, mono)))
      .child(h_flex().px(10).py(5).border_t_1().border_color(t.border).gap(6).items_center()
        // What the pane is doing for you ("review #42…"), down here so nothing above the list moves.
        .child(this.busy ? div().flex_1().min_w(0).truncate().text_size(11).text_color(t.accent).loop("opacity", { from: 0.4, to: 1, period: 900 }).child(`${this.busy}…`)
          : div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(this.q?.data?.nextSweep ? `next sweep ${hhmm(new Date(this.q.data.nextSweep))}` : ""))
        .child(div().flex_none().text_size(11).text_color(t.dim).child("j k · ⏎ details · space act · d diff · ? keys")));
  }
}
