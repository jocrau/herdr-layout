// Modified by Jochen Rau, 2026-11: only the footer of Herdr's workspace-chrome, without Add machine
// (Settings > Machines adds them).
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, run, updates, layout } from "herdr";
import { footerBar, FOOTER_H } from "./lib/bars.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// One footer row like the status bar beside it (lib/bars.js), Settings in it as a button a little shorter than the row.
export default class SidebarFooter extends View {
  render() {
    const t = theme();
    const collapsed = narrow();
    const ready = div().size(6).rounded_full().bg(t.accent);
    return footerBar(h_flex().w_full(), t).bg(t.chrome).px(8).text_color(t.muted)
      .when(collapsed, el => el.px(0).justify_center())
      .child(h_flex().id("settings").h(FOOTER_H - 6).px(6).gap(7).items_center().rounded(6)
        .when(collapsed, el => el.relative().w(32).px(0).justify_center().tooltip("Settings"))
        .hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
        .on_click(() => run("app.settings"))
        .child(svg("mods/sidebar-footer/settings.svg").size(13))
        .when(!collapsed, el => el.child("Settings"))
        .when(Boolean(updates().app.ready), el => el.child(collapsed ? ready.absolute().top(3).right(6) : ready)));
  }
}
