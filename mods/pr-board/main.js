// pr-board: pr-flow's queue of pull requests beside the chat (⌘⇧R): the PRs you review and your own, in
// pr-flow's sections and words. pr-flow keeps the state and rules; this pane reads `queue --format json`, runs
// `act`, and adds what the workbench knows: each PR's own Claude tab (agent verbs go there) and the PR view
// (the git graph's dialog on the PR's range, with its findings; d, or ⌘⌥R).
// It reads the queue when pr-flow's state folder changes (one watch), every minute while shown, and syncs
// with GitHub every 10 minutes while shown (s: now).
// Keys (when focused), as in the fleet board and the git graph: j k / ↑ ↓ move · ⏎ ⇥ details · space the
// section's first action · d the PR view · o GitHub · t its Claude tab · s sync · / filter · ? keys.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, Input, InputState, ScrollHandle } from "gpui-base";
import { theme, settings, nextCommand, props, layout, notify, watchFolder, checking, closeOverlay } from "herdr";
import { readQueue, lastQueue, queueRows, stateDir, verbsFor, doVerb, ASK_FIRST, openPrView, showPrTab, prTab, tabName, parseKey } from "./lib/prflow.js";
import { tabDot, alpha, numWidth } from "./lib/prrows.js";
import { GROUPS, arrange, moveOf, nextStep, people, waitingOn, splitTitle, ago, actionsFor } from "./model.js";
import { tipText } from "./lib/tiptext.js";
import { closeSide } from "./lib/sidecolumn.js";
import { boardHeader, boardTop } from "./lib/boardheader.js";

const LINE = 20, GAP = 6; // a row's first line, and the gap between its columns
// Where a row's text column starts: the row's padding and border, the dot, the number column.
const textAt = (numW) => 8 + 2 + 8 + GAP + numW + GAP;
const SYNC_EVERY = 600000; // with GitHub (only what changed), while shown
const READ_EVERY = 60000; // pr-flow's stored queue (no GitHub), while shown
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
    this.filter = ""; this.filtering = false;
    this.filterState = InputState.new({ placeholder: "number, repo, title, author" });
    this.filterState.on("change", (_e, cx) => { this.filter = this.filterState.value().trim().toLowerCase(); cx.notify(); });
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
  async read(cx, sync = null) {
    if (this.loading) return;
    this.loading = sync ? "sync" : "read"; cx.notify();
    const q = await readQueue({ sync: Boolean(sync), maxAge: sync === "force" ? "1m" : "10m" });
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

  // ---------- acting

  row(key) { return queueRows(this.q).find((r) => r.key === key) ?? null; }

  // A verb on a PR: an agent's in the PR's own Claude tab, the rest through pr-flow. approve and hand back
  // ask first (in the bar at the top: ⏎ yes, Esc no).
  runVerb(verb, row, cx) {
    if (!row) return;
    const kind = this.q?.data?.verbs?.[verb]?.kind;
    if (ASK_FIRST.has(verb) && this.confirm?.verb !== verb) {
      this.confirm = { verb, row, text: verb === "approve" ? `Approve ${row.short}? pr-flow checks it's ready first, then approves under your account.` : `Hand ${row.short} back to its author?` };
      cx.notify(); return;
    }
    this.confirm = null; this.busy = `${verb} ${row.short}`; cx.notify();
    cx.spawn(async (cx) => {
      const r = await doVerb(verb, row.key, { url: row.url, kind });
      this.busy = null;
      notify({ title: r.ok ? r.message : `${verb} ${row.short}: ${r.status ?? "failed"}`, body: r.ok ? "" : r.message, level: r.ok ? "success" : r.status === "needs-human" ? "warning" : "error", timeout: r.ok ? 5000 : 12000 });
      if (kind !== "agent" && verb !== "open") await this.read(cx);
      cx.notify();
    });
  }

  // ⌘⌥R / d: the PR view on the selected PR, else the first that needs you.
  openView() {
    // In the pane's order (lib/prmodel.js): the selected PR, else the first of Your move.
    const key = this.sel ?? arrange(queueRows(this.q)).flatMap((b) => b.rows)[0]?.key;
    if (key) openPrView(key);
  }

  // ---------- keyboard

  key(e, cx) {
    const k = e.keystroke;
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
    else if (is("h", "left", "x", "escape") && this.openKey) this.openKey = null;
    else if (is("space") && row && actionsFor(row).main) this.runVerb(actionsFor(row).main, row, cx);
    else if (is("d") && row) openPrView(row.key);
    else if (is("o") && row) this.runVerb("open", row, cx);
    else if (is("t") && row) { if (!showPrTab(row.key)) notify({ title: `${tabName(row.key)} has no Claude tab yet`, body: "An agent's action (review, fix, …) opens one.", level: "info", timeout: 4000 }); }
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
    const rows = queueRows(this.q), needs = rows.filter((r) => moveOf(r)[0] === "you");
    const syncedAt = this.q?.data?.lastSync ? Date.parse(this.q.data.lastSync) : 0;
    const synced = syncedAt ? syncedAgo(Date.now() - syncedAt) : "not yet", stale = !syncedAt || Date.now() - syncedAt > 1800000;
    const warnings = this.q?.warnings ?? [];
    return boardTop(t,
      boardHeader(t, {
        mod: "pr-board", title: "PRs",
        facts: [
          { id: "pr-needs", text: needs.length ? `${needs.length} need you` : "nothing needs you", color: needs.length ? t.ansi1 : t.dim },
          { id: "pr-synced", text: `${this.q?.data?.tracked ?? 0} tracked · synced ${synced}`, color: stale ? t.ansi3 : t.dim,
            tip: stale ? "pr-flow hasn't synced with GitHub for a while: s syncs now" : "When pr-flow last asked GitHub" },
        ],
        buttons: [{ id: "pr-sync", label: "↻", tip: tipText("Sync with GitHub now (s)"), color: this.loading ? t.accent : null,
          pulse: Boolean(this.loading), onClick: (cx) => this.read(cx, "force") }],
      }),
      this.busy ? div().text_size(11).text_color(t.accent).loop("opacity", { from: 0.4, to: 1, period: 900 }).child(`${this.busy}…`) : null,
      this.err ? div().w_full().text_size(11.5).text_color(t.ansi1).child(this.err) : null,
      ...warnings.map((w) => div().w_full().text_size(11).text_color(t.ansi3).child(w)));
  }

  confirmBar(t) {
    const c = this.confirm;
    const btn = (id, label, primary, go) => div().id(id).px(10).py(3).rounded(5).text_size(12).cursor_pointer()
      .bg(primary ? t.solid ?? t.accent : t.raised).text_color(primary ? t.solid_foreground ?? t.background : t.foreground)
      .hover((e) => e.opacity(0.85)).on_click(go).child(label);
    return v_flex().px(10).py(8).gap(6).bg(t.raised).border_b_1().border_color(t.border)
      .child(div().text_size(12).text_color(t.foreground).child(c.text))
      .child(h_flex().gap(6)
        .child(btn("pr-confirm-yes", `${c.verb[0].toUpperCase()}${c.verb.slice(1)} ⏎`, true, (_e, cx) => this.runVerb(c.verb, c.row, cx)))
        .child(btn("pr-confirm-no", "Cancel esc", false, (_e, cx) => { this.confirm = null; cx.notify(); })));
  }

  // The open row's details: why it's where it is, the facts, and what you can do.
  // The open row's details: only what the row doesn't already say (its detail line, findings, CI and size are
  // on the row), lined up under the row's text.
  details(t, mono, r, numW) {
    const rec = r.rec ?? {}, verbs = this.q?.data?.verbs ?? {};
    // Not what the card says already: its title, pr-flow's detail line, the next step.
    const said = `${r.detail ?? ""} ${r.title ?? ""} ${nextStep(r).text}`.toLowerCase();
    const reasons = (rec.reasons ?? []).filter((x) => !said.includes(x.toLowerCase().replace(/^re-review: head moved since/, "re-review what changed since")));
    const facts = [
      rec.headRef && rec.headRef !== r.title ? `${rec.headRef} → ${rec.baseRef ?? "?"}` : null,
      // GitHub's verdict only when it says something (review required is the usual case).
      rec.decision === "APPROVED" || rec.decision === "CHANGES_REQUESTED" ? rec.decision.toLowerCase().replace(/_/g, " ") : null,
      rec.threads?.unresolved && !/thread/.test(said) ? `${rec.threads.unresolved} open thread${rec.threads.unresolved === 1 ? "" : "s"}` : null,
      rec.conflicts && !said.includes("conflict") ? "conflicts" : null, rec.draft && !said.includes("draft") ? "draft" : null,
    ].filter(Boolean);
    const pill = (id, label, tip, primary, go) => div().id(id).px(7).py(2).rounded(5).text_size(11.5).cursor_pointer()
      .border_1().border_color(primary ? t.accent : t.border).text_color(primary ? t.accent : t.foreground)
      .hover((e) => e.bg(t.hover)).tooltip(tipText(tip)).on_click(go).child(label);
    // Only what's possible now: the next step's action first, its alternatives, then where to look; housekeeping
    // (later, ignore, close) quieter at the end (actionsFor in model.js).
    const tab = prTab(r.key), acts = actionsFor(r);
    const verbPill = (v, primary) => pill(`pr-${r.key}-${v}`, v, `${verbs[v]?.help ?? v}${verbs[v]?.kind === "agent" ? `\nIn ${tabName(r.key)}'s Claude tab` : ""}`, primary, (_e, cx) => this.runVerb(v, r, cx));
    const quiet = (v) => div().id(`pr-${r.key}-${v}`).px(5).py(2).text_size(11.5).text_color(t.dim).cursor_pointer().hover((e) => e.text_color(t.foreground))
      .tooltip(tipText(verbs[v]?.help ?? v)).on_click((_e, cx) => this.runVerb(v, r, cx)).child(v);
    return v_flex().pl(textAt(numW)).pr(10).pt(2).pb(8).gap(5).bg(alpha(t.raised, "aa"))
      .when(Boolean(rec.about), (e) => e.child(div().text_size(11.5).text_color(t.muted).child(rec.about)))
      .children(reasons.slice(0, 3).map((x) => div().text_size(11.5).text_color(t.foreground).child(x)))
      .when(facts.length > 0, (e) => e.child(div().text_size(11.5).text_color(t.muted).child(facts.join(" · "))))
      .child(h_flex().gap(4).flex_wrap().items_center()
        .when(Boolean(acts.main), (e) => e.child(verbPill(acts.main, true)))
        .children(acts.also.map((v) => verbPill(v, false)))
        .child(pill(`pr-${r.key}-view`, "diff ↗", "The PR view: its files, diff and findings in the git graph (d)", false, () => openPrView(r.key)))
        .when(Boolean(tab), (e) => e.child(pill(`pr-${r.key}-tab`, "tab ↗", `Its Claude tab ${tabName(r.key)} (t)`, false, () => showPrTab(r.key))))
        .child(pill(`pr-${r.key}-gh`, "GitHub ↗", r.url, false, (_e, cx) => this.runVerb("open", r, cx)))
        .child(div().flex_1())
        .children(acts.keep.map(quiet)));
  }

  keyList(t) {
    const rows = [
      ["j k  ↑ ↓", "move (g G top and bottom)"], ["⏎ ⇥  l h", "open or close the details"],
      ["space", "the section's first action (approve asks first)"], ["d", "the PR view: files, diff, findings"],
      ["t", "its Claude tab (agent actions run there)"], ["o", "the PR on GitHub"],
      ["s", "sync with GitHub now"], ["r", "read the queue again"], ["/", "filter (esc clears)"], ["?", "this list"],
    ];
    return v_flex().px(10).py(10).gap(3)
      .child(div().pb(4).text_size(11).font_semibold().text_color(t.dim).child("KEYS"))
      .children(rows.map(([k, w]) => h_flex().gap(10).child(div().w(80).flex_none().text_size(11.5).child(k)).child(div().flex_1().text_size(11.5).text_color(t.muted).child(w))));
  }

  // ---------- the list, by your next move (model.js)

  // A PR whose move is yours: what it is, who's in it, and the next step.
  // Rows are three columns: the Claude tab's dot, the number (right-aligned, as wide as the widest), and the
  // text; every line of a row, and its details, start in the text column. The number stays on the first line.
  cols(t, mono, r, numW, text, { sel, problem, h, color }) {
    const k = parseKey(r.key);
    return h_flex().id(`pr-row-${r.key}`).pl(8).pr(10).py(h ? 0 : 5).when(Boolean(h), (e) => e.h(h)).gap(GAP).when(!h, (e) => e.items_start()).when(Boolean(h), (e) => e.items_center()).cursor_pointer()
      .border_l_2().border_color(problem ? t.ansi1 : sel ? t.accent : alpha(t.border, "00"))
      .when(sel, (e) => e.bg(t.hover)).hover((e) => e.bg(t.hover))
      .child(h_flex().w(8).h(LINE).flex_none().items_center().child(tabDot(t, r.key)))
      .child(div().w(numW).h(LINE).flex_none().flex().items_center().justify_end().font_family(mono).text_size(12).text_color(color ?? t.foreground).child(`#${k?.n ?? "?"}`))
      .child(text);
  }

  // A PR whose move is yours: what it is, who's in it, and the next step.
  card(t, mono, r, me, now, numW) {
    const k = parseKey(r.key), { tag, title } = splitTitle(r.title), p = people(r, me), step = nextStep(r);
    const rec = r.rec ?? {}, sel = this.sel === r.key, open = this.openKey === r.key;
    const pushed = rec.lastPush ? `pushed ${ago(now - Date.parse(rec.lastPush))} ago` : "";
    const mark = (m) => (m === "✓" ? t.ansi2 : m === "✗" ? t.ansi1 : t.dim);
    const text = v_flex().flex_1().min_w(0).gap(2)
      // What: the title (its [tag] apart), the repo.
      .child(h_flex().min_h(LINE).gap(6).items_start()
        .child(div().flex_1().min_w(0).when(!open, (e) => e.truncate()).text_size(12.5).font_semibold().text_color(t.foreground).child(title))
        .when(Boolean(tag), (e) => e.child(h_flex().h(LINE).flex_none().items_center().child(div().px(4).rounded(3).bg(alpha(t.muted, "22")).text_size(10).text_color(t.muted).child(tag))))
        .child(h_flex().h(LINE).flex_none().items_center().child(div().max_w(140).truncate().text_size(11).text_color(t.dim).child(k?.repo ?? ""))))
      // Who: author → reviewers (✓ approved, ✗ changes; dimmer: not reviewed yet); when it was last pushed.
      .child(h_flex().gap(4).items_center().text_size(11.5)
        .child(div().flex_none().text_color(p.author === "you" ? t.accent : t.muted).child(p.author))
        .when(p.others.length > 0, (e) => e.child(div().flex_none().text_color(t.dim).child("→"))
          .children(p.others.slice(0, 4).map((o, i) => h_flex().flex_none()
            .child(div().text_color(o.who === "you" ? t.accent : o.pending ? t.dim : t.muted).child(o.who))
            .when(Boolean(o.mark), (x) => x.child(div().text_color(mark(o.mark)).child(o.mark)))
            .when(i < Math.min(4, p.others.length) - 1, (x) => x.child(div().text_color(t.dim).child(","))))))
        .when(p.others.length > 4, (e) => e.child(div().text_color(t.dim).child(`+${p.others.length - 4}`)))
        .child(div().flex_1())
        .child(div().flex_none().text_size(11).text_color(t.dim).child(pushed)))
      // Next: the step (space does it), red when something's wrong; the size.
      .child(h_flex().gap(6).items_start()
        .child(div().flex_none().text_size(11.5).text_color(step.problem ? t.ansi1 : t.accent).child(step.problem ? "⚠" : "▶"))
        .child(div().flex_1().min_w(0).when(!open, (e) => e.truncate()).text_size(11.5).text_color(step.problem ? t.ansi1 : t.foreground).child(step.text))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(r.size ?? "")));
    return this.cols(t, mono, r, numW, text, { sel, problem: step.problem })
      .on_click((_e, cx) => { this.sel = r.key; this.h.focus(); this.openKey = open ? null : r.key; this.moreOpen = false; cx.notify(); });
  }

  // A PR waiting on others: one line, on whom and since when.
  line(t, mono, r, me, now, numW) {
    const { title } = splitTitle(r.title), w = waitingOn(r, me, now), sel = this.sel === r.key;
    const text = h_flex().flex_1().min_w(0).h(LINE).gap(6).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(title))
      .child(div().flex_none().max_w(150).truncate().text_size(11).text_color(t.dim).child(w.who))
      .child(div().flex_none().w(28).text_right().text_size(11).text_color(t.dim).child(w.since));
    return this.cols(t, mono, r, numW, text, { sel, h: 26, color: t.muted })
      .tooltip(tipText(`${r.short} · ${r.title}\n${r.detail ?? ""}`))
      .on_click((_e, cx) => { this.sel = r.key; this.h.focus(); this.openKey = this.openKey === r.key ? null : r.key; this.moreOpen = false; cx.notify(); });
  }

  body(t, mono) {
    const q = this.q, out = [], now = Date.now();
    this.order = []; this.drawn = new Map();
    if (!q) return [div().p(14).text_size(12).text_color(t.dim).child(this.err ?? "Reading pr-flow's queue…")];
    const me = q.me ?? null, numW = numWidth(queueRows(q));
    const blocks = arrange(queueRows(q).filter((r) => this.match(r)));
    // Each group folded or open: Later and Dormant start folded; a filter opens everything.
    const isOpen = (g) => (this.filter ? true : this.fold.has(g) ? this.fold.get(g) : g !== "later" && g !== "dormant");
    for (const [g, label] of GROUPS) {
      const mine = blocks.filter((x) => x.group === g), rows = mine.flatMap((x) => x.rows);
      if (!rows.length) continue;
      const open = isOpen(g);
      // The group's heading (Your move · 5); in Your move, each action's too (Review · 2).
      out.push(h_flex().id(`pr-grp-${g}`).px(10).pt(12).pb(4).gap(6).items_center().cursor_pointer()
        .on_click((_e, cx) => { this.fold.set(g, !open); cx.notify(); })
        .child(div().text_size(11).font_semibold().text_color(g === "you" ? t.foreground : t.muted).child(label.toUpperCase()))
        .child(div().text_size(11).text_color(t.dim).child(String(rows.length)))
        .child(div().flex_1()).child(div().text_size(10).text_color(t.dim).child(open ? "▾" : "▸")));
      if (!open) {
        out.push(div().pl(8 + 2 + 8 + GAP).pr(10).pb(2).truncate().font_family(mono).text_size(11).text_color(t.dim).child(rows.map((r) => `#${r.key.split("#")[1]}`).join("  ")));
        continue;
      }
      for (const blk of mine) {
        if (g === "you") out.push(div().px(10).pt(6).pb(1).text_size(10.5).text_color(t.muted).child(`${blk.label} · ${blk.rows.length}`));
        for (const r of blk.rows) {
          this.order.push(r.key);
          this.drawn.set(r.key, out.length);
          out.push(g === "you" ? this.card(t, mono, r, me, now, numW) : this.line(t, mono, r, me, now, numW));
          if (this.openKey === r.key) out.push(this.details(t, mono, r, numW));
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
    const body = this.help ? [this.keyList(t)] : this.body(t, mono);
    if (this.reveal) { const at = this.drawn?.get(this.sel); if (at !== undefined) this.scroll.scroll_to_item(at); this.reveal = false; }
    return v_flex().id("pr-board").size_full().bg(t.background).text_color(t.foreground)
      .track_focus(this.h).on_key_down((e, cx) => this.key(e, cx))
      .child(this.header(t))
      .when(Boolean(this.confirm), (e) => e.child(this.confirmBar(t)))
      .when(this.filtering || Boolean(this.filter), (e) => e.child(h_flex().px(10).py(4).gap(6).items_center().border_b_1().border_color(t.border)
        .child(div().text_size(12).text_color(this.filtering ? t.accent : t.dim).child("/"))
        .child(Input.new(this.filterState).flex_1().text_size(12))))
      .child(v_flex().id("pr-list").flex_1().min_h(0).pb(8).overflow_y_scrollbar().track_scroll(this.scroll).children(body))
      .child(h_flex().px(10).py(5).border_t_1().border_color(t.border).gap(6).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(this.q?.data?.nextSweep ? `next sweep ${hhmm(new Date(this.q.data.nextSweep))}` : ""))
        .child(div().flex_none().text_size(11).text_color(t.dim).child("j k · ⏎ details · space act · d diff · ? keys")));
  }
}
