// recent-panes: the panes you used last, across spaces, as Firefox's ctrl+tab does it, on option+tab (ctrl+tab stays
// the next tab). option+tab opens this list on the pane before the one you're in; tab again (option still held) goes
// further back, shift+tab forward; letting go of option goes to the highlighted pane. ⏎ or a click goes too (opened
// from the palette, without option held); esc stays.
// The order comes from lib/recent.js (the status bar notes the focused pane); it holds still while the list is open.
// Panes only: a layout block (the PR board, the fleet board) has no pane id and isn't listed.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, closeOverlay, run, panes, spaces, agents, shared, nextCommand, checking } from "herdr";
import { recentRows, RECENT_KEY } from "./lib/recent.js";

const ROW = 30, SHOWN = 12;
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

export default class RecentPanes extends View {
  init(_props, cx) {
    this.h = cx.focus_handle();
    // The order as it was when the list opened: going through it must not reorder it.
    this.rows = recentRows(shared(RECENT_KEY), panes(), spaces(), agents());
    // On the pane before this one (the first row is where you are).
    this.at = this.rows.length > 1 && this.rows[0].focused ? 1 : 0;
    this.done = false;
    if (checking()) return;
    this.h.focus();
    cx.timer.after(50, () => this.h.focus());
    // option+tab and option+shift+tab while the list is open (keys.json "mod:recent-panes"), and for scripts.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^recent-panes\./, "");
        if (c === "next") this.move(1);
        else if (c === "prev") this.move(-1);
        else if (c === "go") { this.go(); return; }
        cx.notify();
      }
    });
  }

  move(by) {
    const n = this.rows.length;
    if (n) this.at = (this.at + by + n) % n;
  }

  close() {
    if (this.done) return;
    this.done = true;
    closeOverlay(props()?.overlay);
  }

  // To the highlighted pane: its space and tab come with it.
  go(i = this.at) {
    const r = this.rows[i];
    if (this.done) return;
    this.close();
    if (r && !r.focused) run("pane.focus", { pane: r.pane });
  }

  key(e, cx) {
    const k = e.keystroke;
    if (k === "alt-tab" || k === "tab" || k === "down" || k === "j" || k === "ctrl-n") this.move(1);
    else if (k === "alt-shift-tab" || k === "shift-tab" || k === "up" || k === "k" || k === "ctrl-p") this.move(-1);
    else if (k === "enter" || k === "space") return this.go();
    else if (k === "escape") return this.close();
    else return;
    cx.stop_propagation(); cx.notify();
  }

  // Letting go of option goes (shift alone, for shift+tab, doesn't).
  modifiers(e) {
    if (!e.modifiers.alt && !e.modifiers.shift) this.go();
  }

  avatar(t, r) {
    const color = (shared("space.colors") ?? {})[r.space] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    return h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center()
      .text_size(10.5).font_bold().text_color("#ffffff").child([...(r.spaceName || "?")][0].toUpperCase());
  }

  status(t, r) {
    if (r.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working ?? t.accent).spin(900);
    if (r.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg((t.blocked ?? t.ansi1) + "26").text_size(10.5).font_semibold().text_color(t.blocked ?? t.ansi1).flex().items_center().child("Needs you");
    if (r.status === "done") return div().size(7).flex_none().rounded(4).bg(t.done ?? t.ansi2);
    if (r.status === "idle") return div().size(7).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    return div().size(7).flex_none();
  }

  render() {
    const t = theme(), rows = this.rows;
    const first = Math.max(0, Math.min(this.at - SHOWN + 2, rows.length - SHOWN)), shown = rows.slice(first, first + SHOWN);
    return v_flex().id("recent-panes").track_focus(this.h).size_full().p(8).gap(2).bg(t.popover ?? t.background).text_color(t.foreground)
      .on_key_down((e, cx) => this.key(e, cx))
      .on_modifiers_changed((e) => this.modifiers(e))
      .when(!rows.length, (e) => e.child(div().p(10).text_size(12.5).text_color(t.dim).child("No panes yet.")))
      .children(shown.map((r, k) => {
        const i = first + k, sel = i === this.at;
        const where = [r.spaceName, r.tabName && r.tabName !== r.title ? r.tabName : null].filter(Boolean).join(" · ");
        return h_flex().id(`rp-${r.pane}`).h(ROW).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer()
          .when(sel, (e) => e.bg(t.selected ?? t.hover)).hover((e) => e.bg(t.hover))
          .on_click(() => this.go(i))
          .child(this.avatar(t, r))
          .child(div().flex_1().min_w(0).truncate().text_size(12.8).text_color(sel ? t.foreground : t.muted).child(r.title))
          .child(div().flex_none().max_w(200).truncate().text_size(11.5).text_color(t.dim).child(r.focused ? `${where} · here` : where))
          .child(h_flex().w(70).flex_none().justify_end().child(this.status(t, r)));
      }))
      .child(div().flex_1())
      .child(div().px(8).pt(4).text_size(11).text_color(t.dim).child("tab, ⇧tab move · let go of ⌥, ⏎ or click goes · esc stays"));
  }
}
