// The tail panel at the bottom of a board (the fleet board's bead tail, pr-board's job log): its top edge is the
// boards' one splitter (drag; double-click: back to the default; - = three lines), a header (TAIL, what it shows,
// following or ended, wrap, terminal, ✕), then the newest lines at the bottom, each optionally with a dim label
// in front. One line each, cut at the edge: hover shows it whole, a click wraps it (again: one line), "wrap" all.
// The board keeps a TailSize (its height, remembered under its own shared key) and passes its frame's mouse
// moves and releases to it (a release outside the frame never arrives, so leaving the frame ends a drag).
import { div } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { settings, shared, setShared } from "herdr";
import { splitter, dragTo } from "./splitter.js";

export const TAIL_LINE = 16; // a line's height
export const TAIL_LINES = 14; // lines shown, until its top edge is dragged
export const TAIL_MIN = 3; // the fewest lines a dragged tail keeps
export const TAIL_KEEP = 200; // lines kept

// The body's height: the one asked for (null: TAIL_LINES), at least TAIL_MIN lines, and leaving the board's
// header, tabs and a few rows (`pane`: the board's height, when known).
export function tailHeight(want, pane) {
  const min = TAIL_MIN * TAIL_LINE + 6, room = pane ? pane - 200 : Infinity;
  return Math.round(Math.max(min, Math.min(want ?? TAIL_LINES * TAIL_LINE + 6, room)));
}

// A wheel turn over the lines, in px (zoom applied by the caller): whether it still follows the newest line (a
// turn up stops it; "↓ newest" in the header starts it again) and the sideways offset `x` (0..widest).
export function scrolled(view, dy, dx, widest) {
  const x = Math.max(0, Math.min(Math.max(0, widest), (view.x ?? 0) - dx));
  return { follow: view.follow !== false && !(dy > 0), x };
}

// A line's identity (for clicked-open lines), and the clicked-open keys still among the lines (others dropped).
export const lineKey = (l) => l.key ?? `${l.label ?? ""}\t${l.text}`;
export function pruneOpened(opened, lines) {
  if (!opened.size) return opened;
  const keys = new Set(lines.map(lineKey));
  for (const k of opened) if (!keys.has(k)) opened.delete(k);
  return opened;
}

// The panel's height and its drag, remembered under `key` (shared state).
export class TailSize {
  constructor(key) { this.key = key; this.split = shared(key) ?? null; this.drag = null; this.view = { follow: true, x: 0, n: 0, of: null }; this.scroll = ScrollHandle.new(); }
  height(pane) { return tailHeight(this.split, pane); }
  set(h, cx) {
    this.split = h === null ? null : Math.round(h);
    setShared(this.key, this.split);
    cx.notify();
  }
  // Three lines shorter (-1) or taller (1): the - = keys.
  step(dir, pane, cx) { this.set(this.height(pane) + dir * 3 * TAIL_LINE, cx); }
  start(d, cx) { this.drag = d; cx.notify(); }
  // The board's frame: on_mouse_move, on_mouse_up("left") and on_hover(false) pass here.
  move(e, cx) { if (this.drag) { this.split = dragTo(this.drag, e, settings().zoom ?? 1, -1); cx.notify(); } }
  end(pane, cx) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.moved) this.set(this.height(pane), cx); else cx.notify();
  }
}

// The panel. `o`: { mono, size (TailSize), pane (the board's height), title, titleTip?, status?: { text, live },
// lines?: [{ label?, text, kind?: "text"|"command"|"error"|"mark", key? }], note? (a dim line instead of lines),
// error?, wrap (all lines wrapped), opened (Set of lines clicked open), labelW (the label column, 78),
// onWrap?, onTerminal?, terminalTip, onClose, closeTip, ids? (prefix, "tail") }.
export function tailPanel(t, o) {
  const p = o.ids ?? "tail", size = o.size, tall = size.height(o.pane), opened = o.opened;
  const btn = (id, label, tip, go) => div().id(id).px(6).h(18).rounded(4).flex().items_center().text_size(11).text_color(t.muted)
    .hover((x) => x.bg(t.border).text_color(t.foreground)).tooltip(tip).on_click((_e, cx) => { go(cx); cx.notify(); }).child(label);
  // The newest lines at the bottom: a wrapped line pushes the oldest out at the top.
  const lines = o.lines ?? [];
  // A scroll area (smooth, a wrapped line scrolls through as the lines it takes) over every kept line, kept on the
  // newest while it follows; a turn of the wheel up stops that, "↓ newest" starts it again. Sideways (a sideways
  // swipe or shift-wheel) by `x`, the labels staying put. Back to following when what it shows changes.
  if (size.view.of !== (o.title ?? "")) size.view = { follow: true, x: 0, n: 0, of: o.title ?? "" };
  const view = size.view, z = settings().zoom ?? 1;
  if (view.follow && lines.length && lines.length !== view.n) size.scroll.scroll_to_item(lines.length - 1);
  view.n = lines.length;
  const widest = Math.max(0, ...lines.map((l) => String(l.text ?? "").length)) * 6.7 - 160;
  const body = v_flex().id(`${p}-body`).px(10).pb(6).h(tall).overflow_y_scroll().track_scroll(size.scroll).font_family(o.mono)
    .on_scroll_wheel((ev, cx) => {
      const sideways = Math.abs(ev.delta.x) > Math.abs(ev.delta.y), shift = Boolean(ev.modifiers?.shift);
      const dx = sideways ? ev.delta.x : shift ? ev.delta.y : 0, dy = sideways || shift ? 0 : ev.delta.y;
      const next = scrolled(view, dy / z, dx / z, o.wrap ? 0 : widest);
      if (next.follow !== view.follow || next.x !== view.x) { Object.assign(view, next); cx.notify(); }
      if (dx) cx.stop_propagation(); // up and down: the area scrolls itself
    });
  if (o.note) body.child(div().text_size(11).text_color(t.dim).child(o.note));
  else if (o.error) body.child(div().text_size(11).text_color(t.ansi1).child(o.error));
  else {
    pruneOpened(opened, lines); // lines gone from the tail
    const x = o.wrap ? 0 : view.x;
    body.children(lines.map((l, i) => {
      const k = lineKey(l), wrap = o.wrap || opened.has(k);
      const color = l.kind === "mark" ? t.accent : l.kind === "error" ? t.ansi1 : l.kind === "command" ? t.dim : t.muted;
      return h_flex().id(`${p}-l-${i}`).flex_none().min_h(16).gap(6).items_start().text_size(11).rounded(3)
        .hover((e) => e.bg(t.hover)).tooltip(wrap ? "" : l.text)
        .on_click((_e, cx) => { if (opened.has(k)) opened.delete(k); else opened.add(k); cx.notify(); })
        .when(Boolean(l.label), (e) => e.child(div().flex_none().w(o.labelW ?? 78).h(16).flex().items_center().truncate().text_color(t.dim).child(l.label)))
        .child(wrap || !x ? div().flex_1().min_w(0).py(1).when(!wrap, (e) => e.truncate()).text_color(color).child(l.text)
          : div().flex_1().min_w(0).py(1).overflow_hidden().child(div().ml(-x).whitespace_nowrap().text_color(color).child(l.text)));
    }));
  }
  // Its top edge is the handle that sets its height (the boards' one splitter), in place of a border.
  return v_flex().flex_none()
    .child(splitter(t, { id: `${p}-split`, axis: "row", dragging: Boolean(size.drag), from: () => size.height(o.pane),
      onStart: (d, cx) => size.start(d, cx), onReset: (cx) => size.set(null, cx) }))
    .child(h_flex().px(10).pb(3).gap(6).items_center()
      .child(div().text_size(11).font_semibold().text_color(t.dim).child("TAIL"))
      .child(div().min_w(0).truncate().font_family(o.mono).text_size(11.5).text_color(t.foreground)
        .when(Boolean(o.titleTip), (x) => x.id(`${p}-title`).tooltip(o.titleTip)).child(o.title ?? ""))
      .when(Boolean(o.status), (el) => el.child(div().flex_none().text_size(11).text_color(o.status.live ? t.ansi4 : t.dim).child(o.status.text)))
      // Scrolled back: how far, and a way back to the newest (following again).
      .when(!view.follow && lines.length > 0, (el) => el.child(btn(`${p}-newest`, "↓ newest",
        "Back to the newest lines, following them again", () => { view.follow = true; size.scroll.scroll_to_item(lines.length - 1); })))
      .child(div().flex_1())
      .when(Boolean(o.onWrap), (el) => el.child(btn(`${p}-wrap`, o.wrap ? "unwrap" : "wrap",
        o.wrap ? "One line each again (a click on a line wraps only it)" : "Wrap every line (a click on a line wraps only it)", (cx) => o.onWrap(cx))))
      .when(Boolean(o.onTerminal), (el) => el.child(btn(`${p}-term`, "terminal", o.terminalTip ?? "", (cx) => o.onTerminal(cx))))
      .child(btn(`${p}-close`, "✕", o.closeTip ?? "Close the tail", (cx) => o.onClose(cx))))
    .child(body);
}
