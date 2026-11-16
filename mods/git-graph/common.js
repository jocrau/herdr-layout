// Modified by Jochen Rau, 2026-11, from rabeeh-ta/herdr-git-graph: see NOTICE.md in this folder.
// The graph's small shared helpers and constants (moved out of graph.js).
import { spaces, panes, focused, shared, home, updates, run } from "herdr";
import { depthOf } from "./repos.js";

// a > b for versions like v1.2.3 (from the update check upstream had, which this copy doesn't run).
export function newer(a, b) {
  const parts = (v) => String(v).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

// The overview watches this many repositories at most (Herdr allows 64 pending watches a mod).
export const REPO_WATCHES = 48;

export function location(folder) {
  if (folder) return { cwd: folder, on: null };
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}

export const MORE_ROUNDS = 15; // pages loaded at most to reach a branch or the next match

export const PAGE = 300, ROW = 24, LANE = 12, PAD = 6, DIFF_ROW = 20;
// Herdr 0.1.12 zooms a list itself ("Lists in mods follow the zoom"): its row
// heights and the lines painted in its rows are layout units there, where before
// they were screen pixels. Asked once: the version doesn't change while running.
let zoomedLists; // set once by listsZoom()
export const listsZoom = () => zoomedLists ??= (() => { try { const v = updates()?.app?.version; return Boolean(v) && !newer("0.1.12", v); } catch { return false; } })();
// The graph column's default keeps room for its "Graph" heading (and a lane or two) in narrow repos.
export const GRAPH_MIN = 56;
// side: which way a drag widens it. Graph's handle is on its right edge, the others' on their left.
export const COLUMNS = { graph: { width: null, min: 24, side: 1 }, date: { width: 62, min: 36, max: 240, side: -1 },
  author: { width: 120, min: 50, max: 400, side: -1 }, hash: { width: 66, min: 40, max: 200, side: -1 } };
export const withDefaults = (saved) => ({ ...Object.fromEntries(Object.entries(COLUMNS).map(([k, c]) => [k, c.width])), ...saved });
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const pad2 = (n) => String(n).padStart(2, "0");
export const laneColors = (t) => [t.ansi4, t.ansi2, t.ansi5, t.ansi3, t.ansi6, t.ansi1, t.ansi12, t.ansi10, t.ansi13, t.ansi11, t.ansi14, t.ansi9];
export const isRefChange = (p) => /\/(HEAD|packed-refs)$|\/refs\//.test(p);
export const inGitDir = (p) => p.includes("/.git/") || p.endsWith("/.git");

export function ago(seconds) {
  const s = Date.now() / 1000 - seconds;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d`;
  const d = new Date(seconds * 1000);
  return d.getFullYear() === new Date().getFullYear() ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function stamp(seconds) {
  const d = new Date(seconds * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export const tilde = (path, on) => (!on && path?.startsWith(home()) ? "~" + path.slice(home().length) : path);
export const brief = (c) => ({ hash: c.hash, subject: c.subject, parents: c.parents });
export const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
// Staged and untracked count too: `git add` of a new file keeps its path and status ("A") but changes what
// r would do (unstage vs delete) and the commit dialog's default.
export const sameFiles = (a, b) => a.length === b.length && a.every((f, i) => f.path === b[i].path && f.status === b[i].status
  && Boolean(f.staged) === Boolean(b[i].staged) && Boolean(f.untracked) === Boolean(b[i].untracked));
export const scopeOf = ({ all, remotes, revs }) => `${all} ${remotes}${revs?.length ? ` ${revs.join(" ")}` : ""}`;
// Folders kept as they were last read, and commits' details (a commit never changes).
export const SEEN = 24, DETAILS = 200;
export const keep = (map, key, value, max) => { map.delete(key); map.set(key, value); if (map.size > max) map.delete(map.keys().next().value); };

export const VIEWER_CLOSED = "git-graph.viewer-closed";

export const depthSetting = () => depthOf(shared("git-graph.depth"));
export const tagsShown = () => shared("git-graph.tags") === true;
