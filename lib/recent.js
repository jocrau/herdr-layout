// The panes you used last, most recent first, across spaces (the recent-panes switcher, option+tab): an always-shown
// mod (usage-status, the status bar) notes the focused pane a few times a second; the list lives in shared
// "recent.panes" (pane ids), so it outlasts a layout reload. Panes that are gone drop out when the list is read.
import { focused, shared, setShared } from "herdr";

export const RECENT_KEY = "recent.panes";
const KEEP = 40;

// The focused pane to the front of the list. A layout block or an overlay that has the keyboard has no pane id
// (focused().pane null): the list stays as it is.
export function noteFocus() {
  const id = focused()?.pane;
  if (!id) return;
  const list = shared(RECENT_KEY) ?? [];
  if (list[0] === id) return;
  setShared(RECENT_KEY, [id, ...list.filter((x) => x !== id)].slice(0, KEEP));
}

// A shell or program by what it set as its title; one that set none (Herdr then shows the terminal's id) by its
// program and folder: "zsh · handbook".
function shellTitle(p) {
  if (p.title && p.title !== p.terminal) return p.title;
  const folder = String(p.cwd ?? "").replace(/\/+$/, "").split("/").pop();
  return [p.program?.name, folder].filter(Boolean).join(" · ") || "terminal";
}

// The switcher's rows, most recent first: every pane still there, the ones never focused since the list began
// after them (in the spaces' own order), each with what it is and where. Pure, for tests: `ids` the list,
// `panes` panes(), `spaces` spaces(), `agents` agents().
// [{ pane, title, status, app, space, spaceName, tab, tabName, focused, agent }]
export function recentRows(ids, panes, spaces, agents = []) {
  const tabs = new Map(), byPane = new Map(agents.map((a) => [a.pane, a]));
  for (const s of spaces) for (const t of s.tabs ?? []) tabs.set(t.id, { space: s, tab: t });
  const known = new Map(panes.map((p) => [p.pane, p]));
  const order = [...new Set([...(ids ?? []).filter((id) => known.has(id)), ...panes.map((p) => p.pane)])];
  return order.map((id) => {
    const p = known.get(id), where = tabs.get(p.tab), a = byPane.get(id);
    return {
      pane: id, terminal: p.terminal ?? null, focused: Boolean(p.focused), agent: Boolean(a),
      // An agent's tab name says what it works on; a shell's title is its command line or folder.
      title: a ? a.tab_name || a.title || "agent" : p.mod ? p.title || p.mod : shellTitle(p),
      status: p.status ?? a?.status ?? null, app: p.app ?? null, program: p.program?.name ?? null,
      space: where?.space.id ?? null, spaceName: where?.space.name ?? "", tab: p.tab, tabName: where?.tab.name ?? "",
    };
  }).filter((r) => r.space);
}
