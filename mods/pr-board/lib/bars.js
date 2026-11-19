// Copied from lib/bars.js by lib/sync.mjs: edit it there, then run `node lib/sync.mjs`.
// The header and footer rows every column of the window shares, so their edges and text line up across it:
// the sidebar, the work column (tabs, status bar) and the boards beside them (fleet, PRs, the side panel).
// layouts/workbench.json sizes the rows Herdr draws itself to the same numbers (the brand row, the tab bar,
// the side panel's header, the sidebar's Settings row, the status bar); tests/unit/lib.test.mjs checks it.

export const HEADER_H = 42;    // the top row: brand, tabs, every board's header
export const FOOTER_H = 28;    // the bottom row: Settings, the status bar, every board's footer
export const FOOTER_TEXT = 12; // the bars' small text: footers (hints, facts, Settings) and a board header's facts

// A footer row: FOOTER_H tall, a line on top, the footer's text size, dim. The caller adds its own padding and
// children: footerBar(h_flex(), t).px(10).gap(6).child(…).
export function footerBar(el, t) {
  return el.h(FOOTER_H).flex_none().items_center().border_t(1).border_color(t.border).text_size(FOOTER_TEXT).text_color(t.dim);
}
