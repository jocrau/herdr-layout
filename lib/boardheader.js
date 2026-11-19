// The header every board in a side column draws (the PR board, the fleet board, the side panel's): one row of
// HEADER_H px, the title on the left (with a chevron when it opens a list), dim facts after it, small action buttons on
// the right and the × last, always in the same place. What a board says beyond that goes in rows below it
// (boardTop), so the row itself never grows or moves.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Popup } from "gpui-base";
import { closeButton } from "./sidecolumn.js";
import { HEADER_H, FOOTER_TEXT } from "./bars.js";

export { HEADER_H };

// One of the header's small buttons (22 px, as the ×): { id, label, tip, onClick, color, pulse }.
export function headerButton(t, { id, label, tip, onClick, color, pulse }) {
  return div().id(id).flex_none().size(22).flex().items_center().justify_center().rounded(5).text_size(12.5)
    .text_color(color ?? t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
    .when(Boolean(tip), (el) => el.tooltip(tip))
    .when(Boolean(pulse), (el) => el.loop("opacity", { from: 0.35, to: 1, period: 900 }))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
    .child(label);
}

// The row. title: text; onTitle: makes the title open something (a down chevron after it, highlighted while `open`);
// menu: what opens, drawn as a dropdown under the title, over the board (the board keeps it open: `open`, esc);
// onClose: a press outside the dropdown (also on the title: the board ignores the click that follows);
// titleTip; facts: [{ id?, text, color?, tip? }] after the title, cut first when room is short;
// buttons: headerButton specs; mod: the board's mod (for the ×).
export function boardHeader(t, { mod, title, titleTip, onTitle, onClose, open = false, menu = null, facts = [], buttons = [] }) {
  const titleEl = h_flex().id(`${mod}-title`).flex_none().max_w(260).h(26).px(onTitle ? 6 : 0).gap(5).items_center().rounded(6)
    .when(Boolean(onTitle), (el) => el.ml(-6).cursor_pointer().when(open, (x) => x.bg(t.hover)).hover((x) => x.bg(t.hover))
      .on_click((_e, cx) => onTitle(cx)))
    .when(Boolean(titleTip), (el) => el.tooltip(titleTip))
    .child(div().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child(title))
    .when(Boolean(onTitle), (el) => el.child(svg("mods/files/chevron-down.svg").size(12).flex_none()
      .text_color(open ? t.foreground : t.dim)));
  // The dropdown: anchored under the title, above everything else; a press outside it closes it (onTitle again).
  const titled = menu ? Popup.new(`${mod}-menu`, titleEl).anchor("top_left")
    .when(open, (el) => el.content(v_flex().id(`${mod}-menu-list`).mt(4).w(340).max_h(420).py(4).rounded(8)
      .bg(t.raised ?? t.background).border_1().border_color(t.border).shadow_lg().overflow_y_scrollbar()
      .on_mouse_down_out((_e, cx) => (onClose ?? onTitle)(cx))
      .children(menu))) : titleEl;
  return h_flex().h(HEADER_H).flex_none().px(10).gap(8).items_center()
    .child(titled)
    .child(h_flex().flex_1().min_w(0).gap(8).items_center().overflow_hidden()
      .children(facts.filter(Boolean).map((f, i) => div().id(f.id ?? `${mod}-fact-${i}`).min_w(0).truncate().text_size(FOOTER_TEXT)
        .text_color(f.color ?? t.dim).when(Boolean(f.tip), (el) => el.tooltip(f.tip)).child(f.text))))
    .child(h_flex().flex_none().gap(2).items_center()
      .children(buttons.filter(Boolean).map((b) => headerButton(t, b)))
      .child(closeButton(t, mod)));
}

// The header row and the board's own rows under it, with one border below all of them.
export function boardTop(t, header, ...rows) {
  return v_flex().flex_none().border_b_1().border_color(t.border).child(header)
    .when(rows.some(Boolean), (el) => el.child(v_flex().px(10).pb(7).gap(5).children(rows.filter(Boolean))));
}
