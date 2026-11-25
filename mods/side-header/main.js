// The side panel's header (the panel-body stack's "header" in the workbench layout): its views as tabs
// (Files, Changes) and a × that closes the panel, as the PR and fleet boards' headers have.
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, layout, run, props } from "herdr";
import { closeButton } from "./lib/sidecolumn.js";
import { TYPE } from "./lib/type.js";

const NAMES = { files: "Files", changes: "Changes" };

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class SideHeader extends View {
  render() {
    const t = theme(), stackId = props()?.stack ?? "panel-body", stack = find(layout(), stackId);
    const views = (stack?.children ?? []).filter((c) => !c.hidden);
    const active = stack?.active ?? views[0]?.id;
    // As every board's header (lib/boardheader.js): 40 px (the layout's header height), × at the right, 10 px in.
    return h_flex().size_full().px(10).gap(2).items_center().bg(t.background).border_b(1).border_color(t.border)
      .children(views.map((c) => {
        const on = c.id === active;
        return div().id(`side-${c.id}`).h(26).px(9).flex().items_center().rounded(6).text_size(TYPE.meta).cursor_pointer()
          .when(on, (el) => el.bg(t.selected)).text_color(on ? t.foreground : t.muted)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => run("layout.select", { stack: stackId, child: c.id }))
          .child(NAMES[c.id] ?? c.title ?? c.id);
      }))
      .child(div().flex_1())
      .child(h_flex().flex_none().gap(2).items_center().child(closeButton(t, "side-header")));
  }
}
