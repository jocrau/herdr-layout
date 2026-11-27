import { exec, notify, setShared, openOverlay, closeOverlay, run, spaces, panes } from "herdr";
import { dialogFor, dialogHeight, doneText, DIALOG_WIDTH, validate, createdWorktree, READ, REV_PARSE, BRANCHES, parseRevParse, parseBranches } from "./git.js";
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

// Local change: a checkout without its dialog (a double-click, the menu's Checkout / Checkout in a new worktree):
// `where` "here" or "worktree" (then opened in a tab, as the dialog does); a remote branch becomes a local branch of
// its name. The menu's "Checkout as…" still asks for another name.
export async function checkoutNow(action, where, ctx) {
  const values = { where, ...(action.type === "checkoutRemote" ? { name: action.branch } : {}) };
  const problem = validate(action, values, ctx);
  if (problem) { notify({ title: "Couldn't do that", body: problem, level: "error" }); return { ok: false, message: problem }; }
  const r = await perform(action, values, ctx);
  const made = r.ok && createdWorktree(action, values, ctx);
  if (made) goToWorktree(made.path, made.branch, ctx.on, ctx.overlay, ctx.space);
  return r;
}

// Opens the action's dialog; false when it has none and should run at once (a promise of
// true when it first reads something).
export function openDialog(action, ctx) {
  // Removing a worktree: the dialog says when it's open somewhere, and uses the repository's
  // own remove command when it sets one (read first, then the dialog opens).
  // The caller awaits it before closing a popup: a closed popup's pending work never finishes.
  if (action.type === "removeWorktree" && !("custom" in action)) {
    return prepareRemove(action, ctx).then((a) => openDialog(a, ctx));
  }
  const spec = dialogFor(action, ctx);
  if (!spec) return false;
  openOverlay({ mod: "git-graph", kind: "dialog", width: DIALOG_WIDTH, height: dialogHeight(spec), props: { role: "dialog", action, ctx } });
  return true;
}

async function prepareRemove(action, ctx) {
  const at = openAt(action.path, ctx.on), opts = { cwd: ctx.root, on: ctx.on };
  const read = (args) => exec("git", args, opts).catch(() => null);
  const [cfg, st, only] = await Promise.all([
    read(["config", "--get", "herdr.worktreeRemove"]),
    read(["-C", action.path, ...READ, "status", "--porcelain"]),
    // The commits only this branch has: on no other branch, no remote branch.
    read([...READ, "rev-list", "--count", `refs/heads/${action.name}`, "--not", `--exclude=refs/heads/${action.name}`, "--branches", "--remotes"])]);
  const remote = await remoteOf(action.name, read, ctx);
  const count = (r) => (r?.code === 0 && /^\d+$/.test(r.stdout.trim()) ? Number(r.stdout.trim()) : null);
  return { ...action, open: Boolean(at.space || at.pane), custom: cfg?.code === 0 ? cfg.stdout.trim() || null : null,
    dirty: st?.code === 0 ? st.stdout.split("\n").filter(Boolean).length : null, unmerged: count(only), remote };
}

// The branch's upstream when it's still on the remote ({ remote, branch, pr }), else null; pr: its latest
// pull request ({ number, state: OPEN | MERGED | CLOSED }) when gh knows one.
async function remoteOf(name, read, ctx) {
  const r = await read([...READ, "for-each-ref", "--format=%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream:track)", `refs/heads/${name}`]);
  const [remote = "", ref = "", track = ""] = r?.code === 0 ? r.stdout.trim().split("\0") : [];
  if (!remote || !ref.startsWith("refs/heads/") || track.includes("gone") || !(ctx.remotes ?? []).includes(remote)) return null;
  const branch = ref.slice(11);
  const p = await exec("gh", ["pr", "list", "--head", branch, "--state", "all", "--limit", "1", "--json", "number,state"], { cwd: ctx.root, on: ctx.on, timeout: 8000 }).catch(() => null);
  let pr = null;
  try { pr = p?.code === 0 ? JSON.parse(p.stdout)[0] ?? null : null; } catch {}
  return { remote, branch, pr: pr && Number.isInteger(pr.number) ? { number: pr.number, state: String(pr.state) } : null };
}

// Removing a worktree from outside the git view (the sidebar): the worktree `folder` is in, and the
// repository as the graph would see it from the main checkout, so its dialog asks as the graph's does.
export async function removeFrom(folder, on) {
  const git = (cwd, args) => exec("git", [...READ, ...args], { cwd, on });
  const where = parseRevParse((await git(folder, REV_PARSE)).stdout);
  if (!where) throw new Error("That folder isn't in a git repository.");
  const main = where.common.endsWith("/.git") ? where.common.slice(0, -5) : null;
  if (!main || main === where.root) throw new Error("That's the main checkout, not a worktree.");
  if (!where.current) throw new Error("No branch is checked out there.");
  const [rev, branches, remotes] = await Promise.all([git(main, REV_PARSE), git(main, BRANCHES), git(main, ["remote"])]);
  const m = parseRevParse(rev.stdout);
  if (!m) throw new Error("Couldn't read the main checkout.");
  const parsed = parseBranches(branches.stdout, m.root);
  const ctx = { root: m.root, on, current: m.current, head: m.head, branches: parsed.names, tracking: parsed.tracking,
    worktrees: parsed.worktrees, mainRoot: null, remotes: remotes.stdout.split("\n").filter(Boolean), overlay: null, space: null };
  return { action: { type: "removeWorktree", name: where.current, path: where.root }, ctx };
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

