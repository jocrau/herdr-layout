import { exec, notify, setShared, openOverlay, closeOverlay, run, spaces, panes } from "herdr";
import { dialogFor, dialogHeight, doneText, DIALOG_WIDTH } from "./git.js";
import { executeAction } from "./execute.js";
import { branchTitle } from "./lib/names.js";

// Runs an action's git commands in order, stopping at the first failure. Every
// graph copy refreshes after, whether or not its folder watch saw the change.
export async function perform(action, values, ctx, { toast = true } = {}) {
  try {
    const result = await executeAction(action, values, ctx, exec);
    if (!result.ok) {
      if (toast) notify({ title: "Couldn't do that", body: result.message, level: "error" });
      return result;
    }
    if (result.warning) notify({ title: doneText({ ...action, kept: true }, values), body: result.warning, level: "info", timeout: 8000 });
    else notify({ title: doneText(action, values), level: "success", timeout: 3000 });
    // A Manygit row that failed in Fetch all reads as fetched again.
    if (action.type === "fetch") setShared("git-graph.fetched", { root: ctx.root, at: Date.now() });
    return { ok: true };
  } catch (e) {
    const message = String(e?.message ?? e);
    if (toast) notify({ title: "Git didn't run", body: message, level: "error" });
    return { ok: false, message };
  } finally {
    setShared("git-graph.changed", Date.now());
  }
}

// Opens the action's dialog; false when it has none and should run at once.
export function openDialog(action, ctx) {
  // Removing a worktree: the dialog says when it's open somewhere, and uses the repository's
  // own remove command when it sets one (read first, then the dialog opens).
  if (action.type === "removeWorktree" && !("custom" in action)) {
    const at = openAt(action.path, ctx.on);
    exec("git", ["config", "--get", "herdr.worktreeRemove"], { cwd: ctx.root, on: ctx.on })
      .catch(() => null)
      .then((r) => openDialog({ ...action, open: Boolean(at.space || at.pane), custom: r?.code === 0 ? r.stdout.trim() || null : null }, ctx));
    return true;
  }
  const spec = dialogFor(action, ctx);
  if (!spec) return false;
  openOverlay({ mod: "git-graph", kind: "dialog", width: DIALOG_WIDTH, height: dialogHeight(spec), props: { role: "dialog", action, ctx } });
  return true;
}

export function showChanges() {
  run("layout.select", { stack: "panel-body", child: "changes" });
  run("layout.show", { id: "panel" });
}

// Where a folder is open: a space that's there now (its first terminal's live folder, else
// where it started), else a terminal in it (in a tab of some space).
export function openAt(path, on) {
  const inside = (dir) => dir === path || Boolean(dir?.startsWith(`${path}/`));
  const ours = spaces().filter((s) => (s.machine ?? null) === (on ?? null));
  const spaceOf = new Map(ours.flatMap((s) => (s.tabs ?? []).map((t) => [t.id, s])));
  const ps = panes();
  const place = (s) => ps.find((p) => p.cwd && spaceOf.get(p.tab) === s)?.cwd ?? s.folder;
  const space = ours.find((s) => inside(place(s))) ?? null;
  const pane = space ? null : panes().find((p) => spaceOf.has(p.tab) && inside(p.cwd)) ?? null;
  return { space, pane, spaceOf };
}

// Local change: a worktree as a tab in the space the graph was opened in (`home`): the tab it
// has there, else a new one named after the branch in words. Other spaces may have it open
// too. `graph`, the graph's own dialog, closes, as what's wanted is behind it.
export function goToWorktree(path, branch, on, graph, home) {
  const inside = (dir) => dir === path || Boolean(dir?.startsWith(`${path}/`));
  const space = spaces().find((s) => s.id === home) ?? spaces().find((s) => s.active);
  const tabs = new Set((space?.tabs ?? []).map((t) => t.id));
  const pane = panes().find((p) => tabs.has(p.tab) && inside(p.cwd));
  if (graph) closeOverlay(graph);
  if (space) run("space.select", { id: space.id });
  if (pane) return void run("tab.select", { id: pane.tab });
  run("tab.new", { ...(space ? { space: space.id } : {}), folder: path, name: branchTitle(branch) });
}

