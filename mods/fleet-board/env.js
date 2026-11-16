// Fleet board: what it reads from the window around it (shown or hidden, the focused folder, the last run).
import { props, focused, panes, spaces, shared, setShared, layout } from "herdr";

// Whether this pane can be seen: a dialog always; a block unless it, or a node above it, is hidden (⌘⇧F).
// Hidden, it reads nothing (each read is a python process, up to 2 s on a big epic) until it shows again.
export function shown() {
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

// The repo shown last, kept in Herdr's shared state so every copy (pane, dialog) and a restart find it.
export const LAST = "fleet-board.lastRepo";
export const load = () => { const v = shared(LAST); return typeof v === "string" ? v : null; };
export const save = (v) => { if (shared(LAST) !== v) setShared(LAST, v); };

// The focused terminal's folder; else its pane's, else its space's (as the file browser finds it).
export function focusedFolder() {
  const f = focused();
  if (!f) return null;
  const pane = f.pane ? panes().find((p) => p.pane === f.pane) : null;
  const space = spaces().find((s) => s.id === f.space);
  return f.cwd || pane?.cwd || space?.folder || null;
}
