// Copied from lib/sidecolumn.js by lib/sync.mjs: edit it there, then run `node lib/sync.mjs`.
// The side columns (the side panel with Files and Changes, the PR board, the fleet board) close the same way:
// a × at the right of their header, Esc once nothing in them is left to clear, and their keys.json toggle,
// which the × names. Opened as an overlay instead, they close that.
import { div, svg } from "gpui-kit";
import { layout, run, props, closeOverlay, focused } from "herdr";

// The closable columns (layout ids) and the keys that toggle them (keys.json).
export const SHORTCUTS = { panel: "⌘⌥O", prs: "⌘⇧R", fleet: "⌘⇧F" };

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

// A side column's key (⌘⇧R prs, ⌘⇧F fleet), run by the summon-<id> popups: hidden, the column shows (its board
// takes the keyboard when it's shown); shown, the keyboard goes to its board. Pressed in the board, the key hides
// it instead (keys.json binds it there to layout.hide). The popup closes first, so the keyboard isn't handed
// back to where it was before the popup opened. A popup because keys run one command, and a hidden block (the
// tab bar in zen, the board itself) gets none.
export function summonColumn(id) {
  const find = (n) => (!n || typeof n !== "object" ? null : n.id === id ? n : (n.children ?? []).map(find).find(Boolean) ?? null);
  const node = find(layout()), mod = node?.content?.mod;
  closeOverlay(props()?.overlay);
  if (!mod) return;
  if (node.hidden) run("layout.show", { id }); else run(`${mod}.focus`);
}

// The line that shows a side column has the keyboard: the same 1 px line in the same color as a focused pane's
// (the layout's pane `focus`), around the board while `on`. Herdr draws a pane's line itself, but only around a
// pane among others (lone: false) and never around a mod block, so a lone terminal beside a board showed no
// focus anywhere. Always 1 px wide (transparent while off), so nothing moves when the keyboard comes or goes.
// Not in an overlay: a popup or dialog over everything has the keyboard anyway.
export function focusFrame(el, t, on) {
  if (props()?.overlay) return el;
  return el.border_1().border_color(on ? focusColor(t) : "#00000000");
}

function focusColor(t) {
  const find = (n) => (!n || typeof n !== "object" ? null : n.content?.pane?.focus?.color ?? (n.children ?? []).map(find).find(Boolean) ?? null);
  const c = find(layout());
  return typeof c === "string" ? (c.startsWith("#") ? c : t[c] ?? t.accent) : t.accent;
}

// ⌘⌥← in a board (keys.json binds it there to <mod>.leave): the keyboard back to the terminal it sits beside.
// Herdr's own ⌘⌥← (pane.go) doesn't leave a board in a side column, while pane.focus on the focused pane does.
export function toTerminal() {
  if (props()?.overlay) return; // a dialog keeps the keyboard
  const f = focused();
  if (f?.pane) run("pane.focus", { pane: f.pane });
  else if (f?.terminal) run("pane.focus", { terminal: f.terminal });
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
