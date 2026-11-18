// Copied from lib/splitter.js by lib/sync.mjs: edit it there, then run `node lib/sync.mjs`.
// The one look and behaviour of every resize handle in the boards (git-graph's splits and columns, the
// fleet board's tail): a 6 px band with the cursor for its direction, a 1 px line through its middle (the
// border colour; none at rest where it stands in for a gap, as between table columns), the band tinted on
// hover, the line in the accent colour while it drags. A double-click puts the size back to its default.
// The board keeps the size in shared state, clamps it, and ends a drag when the pointer leaves its frame
// (a release outside never arrives), passing its frame's mouse moves to `dragTo`.
import { div } from "gpui-kit";

export const SPLIT = 6;

// The handle. `axis`: "row" (a horizontal line, dragged up and down) or "col" (a vertical line, dragged
// left and right). `dragging`: this handle is the one dragging now. `from()`: the size when the drag starts.
// `onStart(drag)` keeps the drag; `onReset()` is the double-click. `line: false`: no line at rest.
// `width`: a column handle's band, when it isn't SPLIT (it stands in for a gap of that width).
export function splitter(t, { id, axis, dragging, from, onStart, onReset, line = true, width = SPLIT }) {
  const row = axis === "row";
  const band = div().id(id).flex_none().flex()
    .when(row, (e) => e.h(SPLIT).w_full().items_center().cursor_row_resize())
    .when(!row, (e) => e.w(width).h_full().justify_center().cursor_col_resize())
    .on_mouse_down("left", (e, cx) => {
      cx.stop_propagation();
      if (e.click_count >= 2) return onReset(cx);
      onStart({ axis, at: row ? e.position.y : e.position.x, from: from(), moved: false }, cx);
    })
    .hover((s) => s.bg(t.hover));
  const mark = dragging ? t.accent : line ? t.border : null;
  return band.child(div().when(row, (e) => e.h(1).w_full()).when(!row, (e) => e.w(1).h_full()).when(Boolean(mark), (e) => e.bg(mark)));
}

// The size a drag has reached: the pointer's move since the press, in layout units (`unit`: the window's
// zoom), added to the size it started at; `sign` -1 where moving up or left makes it bigger.
export function dragTo(drag, e, unit = 1, sign = 1) {
  const at = drag.axis === "row" ? e.position.y : e.position.x;
  drag.moved = true;
  return drag.from + sign * (at - drag.at) / unit;
}
