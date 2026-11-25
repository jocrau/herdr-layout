// Fleet board: the agent-fleet epic of the focused terminal's repo, beside the chat.
// Reads `fleet status --json` (agent-fleet 0.37+) and draws it two ways:
//   Board  every bead sorted by what needs you, with the step it is at in words; what each unblocks (⇣N)
//          and, when beads wait on each other, the critical path above the queued ones
//   Lanes  each bead's steps over time: parallel work, long steps, fix loops, waits
// It follows the focused terminal's repo and keeps the last repo with a run while you are elsewhere;
// a block's props can pin it instead: { "repo": "/path/to/repo", "view": "lanes" }.
// It re-reads when the run's state directory changes (watchFolder), and every minute anyway.
// Keys (when focused), as in the git graph and the beads view: j k / ↑ ↓ move · ⏎ ⇥ l → details in, h ← x out ·
// space act · a f i approve, resume, drop · p answer · t session · v gate · d diff · o PR · w tail · b in the beads
// view · / filter · ? keys · 1 2 views · 0 done · [ ] zoom lanes · < > a wave · { } move back / on · r refresh
// (pr-board's letters where they match). Lanes: drag across the time axis, click a wave or ⌘-scroll to zoom into the past;
// esc goes back to now. ⌘← ⌘→ (keys.json, mod:fleet-board) the previous / next run.
// A bead that starts waiting for you posts a notification; while the docked pane is hidden it still looks every
// 2 minutes (`fleet runs --json` when agent-fleet has it, else one `fleet status --json` of the last run shown).

import { View, div } from "gpui-kit";
import { v_flex, h_flex, Input, InputState, ScrollHandle } from "gpui-base";
import { theme, settings, nextCommand, props, focused, run, shared, setShared, layout } from "herdr";
import { passBehind } from "./lib/behind.js";
import { navMove, navIndex, HELP_KEYS } from "./lib/keymap.js";
import { runTestKey } from "./lib/testkeys.js";
import { VIEWS, SPANS, HIDDEN_CHECK, dur, shortener, graph, tipText, clampWindow, zoomWindow, panWindow, waveWindow, nextWave } from "./model.js";
import { closeSide, focusFrame, toTerminal } from "./lib/sidecolumn.js";
import { splitTarget } from "./env.js";
import { boardHeader, boardTop } from "./lib/boardheader.js";
import { footerBar } from "./lib/bars.js";
import { TailSize } from "./lib/tailpanel.js";

export default class FleetBoard extends View {
  init(_props, cx) {
    bindEscape(cx);
    // A view that no longer exists (a block pinned to "tree" before it went into Board) shows Board.
    const asked = props()?.view;
    this.view = VIEWS.some((v) => v.id === asked) ? asked : props()?.overlay ? "lanes" : "board";
    this.selId = null; // the bead selected, the same in every view
    this.order = []; this.ordered = new Set(); // the beads in the order the current view draws them (j k walk it)
    this.drawn = new Map(); // bead -> its element in the body, to scroll the selected one into view
    this.reveal = false; // scroll the selected bead into view on the next frame
    this.scroll = ScrollHandle.new();
    // "/" filters every view by id or title.
    this.filter = ""; this.showFilter = false; this.filtering = false;
    this.filterState = InputState.new({ placeholder: "id or title" });
    this.filterState.on("change", (_e, cx) => { this.filter = this.filterState.value().trim().toLowerCase(); this.reveal = true; cx.notify(); });
    this.filterState.on("focus", (_e, cx) => { this.filtering = true; cx.notify(); });
    this.filterState.on("blur", (_e, cx) => { this.filtering = false; cx.notify(); });
    // Who waited for you at the last look, to notify only about new waits: epic -> parked ids / parked count.
    this.parkedIds = new Map(); this.parkedSeen = new Map();
    // The tail panel at the bottom: the open (else selected) bead's last lines of `fleet tail`.
    this.tailOn = false; this.tail = { id: null, lines: [], at: 0, error: null };
    // Its body's height: its top edge drags (double-click, back to the default; - = three lines), remembered.
    this.tailSize = new TailSize("fleet-board.tail-height");
    this.openId = null; // the one bead showing its details (they follow j k while open)
    this.showDone = true; // open, so j k reach the done beads too (d folds it)
    this.help = false; // ? shows the keys
    this.confirm = null; // { title, detail, label, run, copy? }: a command that changes the run, asked about first
    this.busy = null; // the command running now: { text, bead, at, until? } (actions.js runFleet)
    // Lanes' zoom, remembered: the last hour unless set; [ ] zoom (out to 7 days, in to "fit": the whole run).
    this.span = SPANS.includes(shared("fleet-board.span")) ? shared("fleet-board.span") : 3600000;
    // A window pinned in the past, to look at earlier waves: { from, to, wave, key } (key: the run's), else null.
    this.win = null;
    this.sel = null; // a drag across Lanes' time axis: { a, b } (0 to 1 along it), and where the axis is: { x, w }
    this.h = cx.focus_handle();
    this.s = null; // the snapshot shown
    this.problem = null; // why the focused folder shows nothing: { kind, message, cwd }
    this.cwd = null; // the folder the shown snapshot came from
    this.target = null; // what was read for it: the folder, or the folder and its epic (env.js targetOf)
    this.picking = false; this.pickAt = 0; // the run list (the title's ▾): open, and the row selected
    this.tried = new Map(); // folder -> when it last had no run, so focus there doesn't run fleet each tick
    this.last = 0;
    this.watching = null;
    this.loading = false;
    // Focus moves and the clock: cheap, no fleet call unless the repo changed or it's time.
    cx.timer.every(2000, (cx) => this.tick(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^fleet-board\./, "");
        // The demo's scripts press keys here (lib/testkeys.js); off outside the demo.
        if (await runTestKey("fleet-board", c, cx, (e, kcx) => this.key(e, kcx), () => this.testState())) { cx.notify(); continue; }
        // The window's keys (tabs, spaces, agents, panes): kept while it's a dialog, run when it's docked.
        if (passBehind(c, Boolean(props()?.overlay), run)) { cx.notify(); continue; }
        if (c === "focus") this.h.focus();
        else if (c === "leave") toTerminal();
        else if (VIEWS.some((v) => v.id === c)) this.view = c;
        else if (c === "refresh") this.refresh(cx, true);
        else if (c === "next-run" || c === "prev-run") this.stepRun(cx, c === "next-run" ? 1 : -1);
        cx.notify();
      }
    });
    this.runs = new Map(); // every run found: key -> summary (the run list)
    this.pin = null; // { target }: the run chosen (the run list, ⌘← ⌘→); focusing another terminal doesn't move it
    this.dirty = new Set(); // repositories (state directory names) whose run changed since the run list read it
    this.hidden = false;
    this.answers = new Map(); // bead -> { picks, area }: an answer being written in its details
    this.typing = false; // an answer field has the keyboard: the pane's keys stay out of it
    this.request = "force";
    this.gen = 0; this.beat = Date.now();
    this.snaps = new Map(); // folder -> the last snapshot read there, shown at once when you switch to it
    this.scanAt = 0; this.nextLook = Date.now() + HIDDEN_CHECK;
    // One worker does every background job in turn (reads, the strip's scan, the tail, the hidden look):
    // Herdr wakes only one of a mod's sleeping tasks reliably, so tasks sleeping side by side starve.
    cx.spawn((cx) => this.worker(cx, this.gen));
    // Shown (⌘⇧F): the keyboard comes here. Not when the layout loads with it shown already.
    this.wasShown = shownHere();
    cx.timer.every(200, (cx) => {
      const now = shownHere(); if (now && !this.wasShown) { this.h.focus(); cx.notify(); } this.wasShown = now;
      // A dialog keeps the keyboard: when it slips away (a click on something that takes no focus), it comes back,
      // so no key goes to the terminal behind. Not while the filter or an answer field has it.
      if (props()?.overlay) this.keepKeys();
    });
    // As a dialog (⌘⌥F), like the git graph and the file browser: the keyboard is on it at once.
    if (props()?.overlay) { this.h.focus(); cx.timer.after(300, () => this.h.focus()); }
  }

  // ---------- acting

  // ---------- answering a parked bead's questions in place

  // ---------- keyboard

  // Esc, from its action (see bindEscape): out of an answer field, else the key handler's steps (it closes the board last).
  escapeKey(cx) {
    if (this.typing) { this.typing = false; this.h.focus(); }
    else this.key({ key: "escape", keystroke: "escape", modifiers: {} }, cx, true);
    this.escAt = Date.now(); cx.notify();
  }

  key(e, cx, fromAction = false) {
    if (e.keystroke === "ctrl-[") e = { ...e, key: "escape", keystroke: "escape" }; // ⌃[ is Esc, as in vim
    if (e.keystroke === "escape" && !fromAction && Date.now() - (this.escAt ?? 0) < 300) return; // the action had it
    // The filter field has the keyboard: Esc (⏎, ↓) back to the list, the filter kept (⌫ there clears it); an
    // empty field closes. As every board's text field.
    if (this.filtering) {
      if (e.keystroke === "escape") { if (!this.filter) this.showFilter = false; this.h.focus(); }
      else if (["enter", "down", "ctrl-n", "ctrl-j"].includes(e.keystroke)) this.h.focus();
      else return;
      cx.stop_propagation(); cx.notify(); return;
    }
    // An answer field has the keyboard, unless it went away while focused (answered elsewhere): blur may not come then.
    if (this.typing && !this.s?.beads.some((x) => x.id === this.openId && this.answerable(x))) this.typing = false;
    if (this.typing) return;
    if (this.confirm && (e.keystroke === "enter" || e.keystroke === "escape")) { // the bar that asks has ⏎ and Esc
      const c = this.confirm; this.confirm = null;
      if (e.keystroke === "enter" && c.run) c.run(cx); // a copy-only question has nothing to run
      cx.stop_propagation(); cx.notify(); return;
    }
    // The run list has the keys while it's open: j k move, ⏎ shows the run, esc closes it.
    if (this.picking) {
      const k = e.keystroke, list = this.runList(Date.now()).flat;
      if (["j", "down", "ctrl-n", "ctrl-j"].includes(k)) this.pickAt = Math.min(list.length - 1, this.pickAt + 1);
      else if (["k", "up", "ctrl-p", "ctrl-k"].includes(k)) this.pickAt = Math.max(0, this.pickAt - 1);
      else if (k === "enter" && list[this.pickAt]) { this.picking = false; this.choose(cx, list[this.pickAt]); }
      else if (k === "escape" || k === "q" || k === "e") this.picking = false;
      else return;
      cx.stop_propagation(); cx.notify(); return;
    }
    // The same keys as the git graph and the beads view: j k move, ⏎ ⇥ l → in, h ← x out, / filter, ? keys.
    const k = e.keystroke, order = this.order, at = order.indexOf(this.selId);
    const b = this.s?.beads.find((x) => x.id === this.selId);
    const is = (...names) => names.includes(k);
    const moveTo = (i) => {
      this.selId = order[Math.max(0, Math.min(order.length - 1, i))] ?? this.selId;
      this.reveal = true;
      // While a row is open, its details follow the selection.
      const next = this.openId && this.s?.beads.find((x) => x.id === this.selId);
      if (next) this.openOnly(next);
    };
    if (this.help && !is(...HELP_KEYS)) this.help = false; // any key closes the key list
    if (is("e")) this.togglePicker(); // every run, in the dropdown under the title
    else if (is("1", "2")) { this.view = VIEWS[Number(k) - 1].id; this.reveal = true; }
    else if (navMove(k)) moveTo(navIndex(k, at, order.length)); // lib/keymap.js: the same on every board
    // ⏎ and ⇥ toggle the details, as in beads and the git graph; l → open them, h ← x close them.
    else if (is("enter", "tab") && b) this.toggle(b.id);
    else if (is("l", "right") && b) { if (this.openId !== b.id) this.openOnly(b); }
    else if (is("h", "left", "x") && this.openId) this.openId = null;
    else if (is("space") && b) this.act(b, cx);
    // An action's own key, the same on every bead (ACTION_KEYS; p the answer field); b the beads view.
    else if (is("a", "f", "i", "t", "v", "o", "d", "p") && b) this.keyAction(b, k, cx);
    else if (is("/")) { this.showFilter = true; this.focusSoon(this.filterState, cx); }
    else if (is("backspace") && this.filter) { this.filterState.set_value(""); this.filter = ""; this.showFilter = false; }
    else if (is(...HELP_KEYS)) this.help = !this.help;
    else if (is("w")) this.tailOn = !this.tailOn;
    else if (is("-") && this.tailOn) this.tailSize.step(-1, this.height, cx);
    else if (is("=") && this.tailOn) this.tailSize.step(1, this.height, cx);
    else if (is("b") && b) this.inBeads(b);
    else if (is("escape") && this.openId) this.openId = null;
    else if (is("escape") && this.win) this.unpin();
    // Esc closes one thing at a time (the open bead, a pinned Lanes window), then the column; a filter stays (⌫ clears it).
    else if (is("escape")) closeSide("fleet-board");
    else if (is("0")) this.showDone = !this.showDone; // digits change what's shown
    // [ ] zoom: through the spans up to now, or a window pinned in the past, around its middle.
    else if (is("[")) { if (this.pinnedWin()) this.pinWindow(zoomWindow(this.pinnedWin(), 0.5)); else this.zoom(SPANS[Math.max(0, SPANS.indexOf(this.span) - 1)]); }
    else if (is("]")) { if (this.pinnedWin()) this.pinWindow(zoomWindow(this.pinnedWin(), 2)); else this.zoom(SPANS[Math.min(SPANS.length - 1, SPANS.indexOf(this.span) + 1)]); }
    // < > the wave before / after (past the last one, back to now); { } move the window by a quarter.
    else if (is("<", "shift-,", "shift-<")) this.stepWave(-1);
    else if (is(">", "shift-.", "shift->")) this.stepWave(1);
    else if (is("{", "shift-[", "shift-{")) this.panLanes(-0.25);
    else if (is("}", "shift-]", "shift-}")) this.panLanes(0.25);
    else if (is("r")) this.refresh(cx, true);
    // A dialog keeps its plain keys, used or not: one it lets through types into the terminal behind it.
    // ⌘, ctrl and alt chords still reach Herdr (⌘⌥F closes it, ⌘← ⌘→ change the run).
    else if (!props()?.overlay || /(^|-)(cmd|ctrl|alt|fn)-/.test(k)) return;
    cx.stop_propagation();
    cx.notify();
  }

  // What a test key script checks (lib/testkeys.js): what has the keyboard and what's open.
  testState() {
    return {
      shown: shownHere(), view: this.view, sel: this.selId ?? null, open: this.openId ?? null, rows: this.order?.length ?? 0,
      picking: this.picking, pickAt: this.pickAt, filtering: Boolean(this.filtering), filter: this.filter ?? "",
      confirm: Boolean(this.confirm), help: Boolean(this.help), tail: Boolean(this.tailOn), span: this.span ?? null,
      pinned: Boolean(this.win), run: this.runKey?.() ?? null,
      index: this.order?.indexOf(this.selId) ?? -1, atEnd: (this.order?.length ?? 0) > 0 && this.order.indexOf(this.selId) === this.order.length - 1,
    };
  }

  // In a dialog, the keyboard back on the board unless one of its fields has it.
  keepKeys() {
    if (props()?.overlay && !this.filtering && !this.typing && !this.h.is_focused()) this.h.focus();
  }

  // Lanes' time window (one of SPANS), kept for the next session; it follows now again.
  zoom(span) {
    this.span = span; this.win = null;
    setShared("fleet-board.span", span);
  }

  // ---------- Lanes pinned to a window in the past (lanesAt: what the last Lanes frame showed)

  pinnedWin() { return this.win?.key === this.runKey() && this.lanesAt ? { from: this.lanesAt.from, to: this.lanesAt.to } : null; }
  // What Lanes shows now, pinned or not.
  shownWin() { return this.lanesAt ? { from: this.lanesAt.from, to: this.lanesAt.to } : null; }
  pinWindow(w, wave = null) {
    const a = this.lanesAt;
    if (!a) return;
    this.win = { ...clampWindow(w, a.first, a.head), wave, key: this.runKey() };
    this.view = "lanes";
  }
  unpin() { this.win = null; this.sel = null; }
  zoomWave(w) {
    const r = this.lanesAt?.ranges.get(w);
    if (r) this.pinWindow(waveWindow(r), w);
  }
  // The wave before or after the one shown (or the window's middle); after the last, back to now.
  stepWave(dir) {
    const a = this.lanesAt;
    if (!a || this.view !== "lanes") return;
    const pinned = this.pinnedWin(), w = this.win?.wave;
    if (!pinned && dir > 0) return;
    const at = !pinned ? Infinity : w !== null && w !== undefined && a.ranges.has(w) ? a.ranges.get(w).from : (pinned.from + pinned.to) / 2;
    const next = nextWave(a.ranges, at, dir);
    if (next !== null) this.zoomWave(next);
    else if (dir > 0) this.unpin();
  }
  panLanes(f) {
    const w = this.shownWin();
    if (w && this.view === "lanes") this.pinWindow(panWindow(w, f * (w.to - w.from)));
  }
  // Over the axis or a lane: ⌘ (or ctrl, alt) with the wheel zooms at the pointer; a sideways swipe moves the
  // window. A plain up/down scroll still scrolls the lanes.
  wheelLanes(e, cx) {
    const w = this.shownWin();
    if (!w || !e.bounds || !e.local_position) return;
    const at = Math.max(0, Math.min(1, e.local_position.x / e.bounds.width)), m = e.modifiers;
    if ((m.platform || m.control || m.alt) && e.delta.y) this.pinWindow(zoomWindow(w, Math.exp(-e.delta.y / 200), at));
    else if (Math.abs(e.delta.x) > Math.abs(e.delta.y)) this.pinWindow(panWindow(w, (-e.delta.x / e.bounds.width) * (w.to - w.from)));
    else return;
    cx.stop_propagation(); cx.notify();
  }
  pinchLanes(e, cx) {
    const w = this.shownWin();
    if (!w || !e.bounds || !e.local_position || !e.delta) return;
    this.pinWindow(zoomWindow(w, 1 / (1 + e.delta), Math.max(0, Math.min(1, e.local_position.x / e.bounds.width))));
    cx.stop_propagation(); cx.notify();
  }
  // The drag across the axis follows the pointer anywhere over the pane and zooms in on release (a click alone
  // does nothing).
  selMove(e, cx) {
    if (!this.sel) return;
    this.sel.b = Math.max(0, Math.min(1, (e.position.x - this.sel.x) / this.sel.w)); cx.notify();
  }
  selEnd(cx) {
    const s = this.sel, w = this.shownWin();
    if (!s) return;
    this.sel = null;
    const lo = Math.min(s.a, s.b), hi = Math.max(s.a, s.b);
    if (w && (hi - lo) * s.w >= 6) this.pinWindow({ from: w.from + lo * (w.to - w.from), to: w.from + hi * (w.to - w.from) });
    cx.notify();
  }

  // ---------- pieces

  // ---------- lanes: one bar per bead over time

  // ---------- frame

  render(_cx) {
    const t = theme(), mono = settings().font_family ?? "JetBrains Mono", now = Date.now();
    const root = focusFrame(v_flex().id("fleet-board").size_full().bg(t.background).text_color(t.foreground)
      .on_size_change((size, cx) => {
        if (Math.abs((this.width ?? 0) - size.width) > 1 || Math.abs((this.height ?? 0) - size.height) > 1) { this.width = size.width; this.height = size.height; cx.notify(); }
      })
      // The tail's top edge drags over the whole pane; a drag ends when the pointer leaves it (a release outside never arrives).
      .on_mouse_move((e, cx) => { this.tailSize.move(e, cx); this.selMove(e, cx); })
      .on_mouse_up("left", (_e, cx) => { this.tailSize.end(this.height, cx); this.selEnd(cx); })
      .on_hover((hovered, cx) => { if (!hovered) { this.tailSize.end(this.height, cx); this.selEnd(cx); } })
      .track_focus(this.h).key_context("FleetBoard").on_action("fleet_board_escape", (_a, cx) => this.escapeKey(cx))
      .on_key_down((e, cx) => this.key(e, cx)), t, this.h.is_focused() || this.filtering);
    // No run shown yet: the same header (the run list behind its title), then what's missing.
    if (!this.s) {
      const head = boardHeader(t, { mod: "fleet-board", title: "Fleet", open: this.picking, onTitle: (cx) => { this.togglePicker(); cx.notify(); }, onClose: (cx) => { this.closePicker(); cx.notify(); },
        menu: this.picking ? this.runPicker(t, now) : null, titleTip: "Every run (click or e)" });
      return root.child(boardTop(t, head)).child(this.empty(t));
    }
    // The dependency graph once per snapshot (it walks every bead's dependents), not once per frame.
    if (this.graphOf !== this.s) { this.graphOf = this.s; this.graphMemo = graph(this.s.beads); }
    const g = this.graphMemo, short = shortener(this.s.epic.id);
    this.order = []; this.ordered = new Set(); this.drawn = new Map(); this.pinned = null;
    this.confirmDrawn = false; this.mono = mono; // item() draws a bead's question under it (confirmBar needs the font)
    // The id column fits the longest short id (monospace, ~7.5 px a character at this size), up to 11 characters:
    // a longer id is cut with "…" (the open row's details show it whole), so the title keeps its room.
    this.idW = Math.round(Math.min(6 + 7.5 * 11, Math.max(40, 6 + 7.5 * Math.max(0, ...this.s.beads.map((b) => short(b.id).length)))));
    const body = this.help ? this.keyList(t) : this.view === "board" ? this.board(t, mono, g, short, now) : this.lanes(t, mono, g, short, now);
    // The selected bead on screen after a move, a view switch or a new filter.
    if (this.reveal) {
      const at = body.indexOf(this.drawn.get(this.selId));
      if (at >= 0) this.scroll.scroll_to_item(at);
      this.reveal = false;
    }
    const elsewhere = this.problem && !this.sameRun(this.problem.cwd);
    const missed = elsewhere ? [splitTarget(this.problem.cwd).cwd, splitTarget(this.problem.cwd).epic].filter(Boolean).join(" · ") : "";
    const repo = this.cwd.split("/").pop();
    return root
      .child(this.header(t, mono, now))
      .child(this.tabs(t))
      .when(Boolean(this.confirm) && !this.confirmDrawn, (el) => el.child(this.confirmBar(t, mono))) // about no bead drawn (the wave): at the top
      .when(this.showFilter || Boolean(this.filter), (el) => el.child(h_flex().px(10).py(4).gap(6).items_center().border_b_1().border_color(t.border)
        .child(div().text_size(TYPE.meta).text_color(this.filtering ? t.accent : t.dim).child("/"))
        .child(Input.new(this.filterState).flex_1().text_size(TYPE.meta))
        .child(div().flex_none().text_size(TYPE.label).text_color(t.dim).child(this.filter ? `${this.order.length} of ${this.s.beads.length}` : "esc closes"))))
      .when(Boolean(this.pinned) && !this.help, (el) => el.child(this.pinned))
      .child(v_flex().id(`fb-${this.view}`).flex_1().min_h(0).pb(8).overflow_y_scrollbar().track_scroll(this.scroll).children(body))
      .when(this.tailOn, (el) => el.child(this.tailPanel(t, mono, short, now)))
      .child(footerBar(h_flex().id("footer"), t).px(10).gap(6)
        .tooltip(tipText(elsewhere ? `No run could be read in ${missed}: ${this.problem.message}` : `${this.cwd}\nupdated ${new Date(this.last).toLocaleTimeString()}`))
        .child(div().min_w(0).truncate().text_color(elsewhere ? t.ansi3 : t.dim).child(elsewhere ? `${repo} · ${missed.split("/").pop()} has no run` : repo))
        .child(div().flex_none().child(`· ${dur(now - this.last)} ago`))
        .child(div().flex_1())
        .child(div().flex_none().child("j k · ⏎ details · space act · / · ? keys")));
  }
}

// Esc (and ⌃[) as an action of this board's own: Herdr binds Esc to close the dialog or popup, and a text field
// binds it too, both ahead of any key handler. A binding of our own in this board's context, and one for a text
// field directly in it, come first (as Herdr's own menus do); the board then steps back itself.
let escBound = false;
function bindEscape(cx) {
  if (escBound) return;
  escBound = true;
  try { cx.bind_keys(["escape", "ctrl-["].flatMap((keystroke) => [{ keystroke, action: "fleet_board_escape", context: "FleetBoard" }, { keystroke, action: "fleet_board_escape", context: "FleetBoard > Input" }])); } catch {}
}

// The class's methods live in these modules by topic; `this` is the FleetBoard in all of them.
import { SchedulerMethods } from "./scheduler.js";

// Whether the pane can be seen: a dialog, or a block with nothing above it hidden.
function shownHere() {
  if (props()?.overlay) return true;
  const walk = (n, hidden) => {
    if (!n || typeof n !== "object") return null;
    const h = hidden || Boolean(n.hidden);
    if (n.content?.mod === "fleet-board") return !h;
    for (const c of n.children ?? []) { const r = walk(c, h); if (r !== null) return r; }
    return null;
  };
  return walk(layout(), false) ?? true;
}
import { AlertsMethods } from "./alerts.js";
import { ActionsMethods } from "./actions.js";
import { ViewsMethods } from "./views.js";
import { TYPE } from "./lib/type.js";
Object.assign(FleetBoard.prototype, SchedulerMethods, AlertsMethods, ActionsMethods, ViewsMethods);
