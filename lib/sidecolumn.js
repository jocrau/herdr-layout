// The side columns (the side panel with Preview and Changes, the PR board, the fleet board) close the same way:
// a × at the right of their header, Esc once nothing in them is left to clear, and their keys.json toggle,
// which the × names. Opened as an overlay instead, they close that.
import { div, svg } from "gpui-kit";
import { layout, run, props, closeOverlay } from "herdr";

// The closable columns (layout ids) and the keys that toggle them (keys.json).
export const SHORTCUTS = { panel: "⌘⇧O", prs: "⌘⇧R", fleet: "⌘⇧F" };

// The closable column `mod` sits in (as a block's content or a stack's header), or null.
export function columnOf(mod) {
  const walk = (n, found) => {
    if (!n || typeof n !== "object") return undefined;
    const here = n.id in SHORTCUTS ? n.id : found;
    if (n.content?.mod === mod || n.header?.content?.mod === mod) return here ?? null;
    for (const c of n.children ?? []) { const r = walk(c, here); if (r !== undefined) return r; }
    return undefined;
  };
  return walk(layout(), null) ?? null;
}

// Closes the overlay `mod` was opened as, or its column. False when it is in neither.
export function closeSide(mod) {
  const overlay = props()?.overlay;
  if (overlay) { closeOverlay(overlay); return true; }
  const id = columnOf(mod);
  if (!id) return false;
  run("layout.hide", { id });
  return true;
}

// The × at the right of a side column's header.
export function closeButton(t, mod) {
  const id = props()?.overlay ? null : columnOf(mod);
  return div().id(`${mod}-close`).flex_none().size(22).flex().items_center().justify_center().rounded(5).text_color(t.dim)
    .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
    .tooltip(id ? `Close (${SHORTCUTS[id]} or esc)` : "Close (esc)")
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); closeSide(mod); })
    .child(svg("mods/pane/close.svg").size(12));
}
