// Modified by Jochen Rau, 2026-11, from natelandau/herdr-worktree-support (from Herdr's spaces mod): see NOTICE.md in this folder.
// Workspace spaces: stable colored avatars, worktrees under their checkout
// (`git worktree list`'s ones no space is in, whatever made them; local change: a space in a
// worktree is a row of its own, never nested under another space),
// grouped by machine when more than one is known. After a space's name, the repo
// its first terminal is in now, only where unusual: branch, ahead/behind. Agent state lives in the agents list, not here. Click to
// switch, right-click for its menu, drag to reorder.
// Worktree rows count ahead/behind against the main checkout's branch, show
// their last activity (newest first) and, for GitHub repos, their pull request.
// A click on one only goes where it is already open (its space, or a tab of the
// repo's space in it); right-click for `worktree-actions`, which opens it as a
// space or a tab and runs git there. A repo's chevron folds its worktrees.
// `git config herdr.worktreeRemove '<cmd>'` in a repo adds a remove action
// that runs <cmd> ({path} and {branch} filled in, quoted) in a new tab.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, panes, run, openOverlay, exec, hc, home, theme, shared, setShared, watchFolder, window, layout, notify } from "herdr";
import { branchTitle } from "./lib/names.js";
import { quote, customRemove, removeWorktreeArgs, deleteBranchArgs } from "./lib/worktree.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const rowHeight = ({ tree }) => (tree ? 28 : 30);
// What closes with a worktree that is cleaned up: each tab whose panes are all inside its folder (on its
// machine), and a whole space only when every one of its tabs is. A tab with a pane anywhere else stays.
function closing(path, machine = null) {
  const inside = (c) => typeof c === "string" && (c === path || c.startsWith(`${path}/`));
  const ps = panes(), out = { spaces: [], tabs: [] };
  for (const s of spaces()) {
    if ((s.machine ?? null) !== (machine ?? null)) continue;
    const tabs = s.tabs.filter((t) => { const tp = ps.filter((p) => p.tab === t.id); return tp.length > 0 && tp.every((p) => inside(p.cwd)); });
    if (!tabs.length) continue;
    if (tabs.length === s.tabs.length) out.spaces.push({ id: s.id, name: s.name });
    else for (const t of tabs) out.tabs.push({ id: t.id, name: t.name, space: s.name });
  }
  return out;
}
const names = (xs) => xs.map((x) => `"${x}"`).join(", ");
const q = quote;
// The worktree menu's git operations (`worktree-actions` names them by key).
// Rebase and merge undo themselves on a conflict, so a worktree is never left
// half way through one by a click.
const UPSTREAM = "git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1";
// Before a rebase or merge: none already in progress, no uncommitted changes to tracked files. Their
// undo (--abort) then only takes back what this click started, never your own conflict resolutions.
const CLEAN = 'g=$(git rev-parse --git-dir) && if [ -e "$g/MERGE_HEAD" ] || [ -d "$g/rebase-merge" ] || [ -d "$g/rebase-apply" ]; '
  + 'then echo "A merge or rebase is already in progress here: finish or abort it first." >&2; exit 1; fi && '
  + 'if [ -n "$(git status --porcelain --untracked-files=no)" ]; then echo "Uncommitted changes: commit or stash them first." >&2; exit 1; fi';
const LEASE = "--force-with-lease --force-if-includes";
// The upstream is this branch's own (same name): a worktree made with `-b feat origin/main` tracks main, and
// a plain push would go there (or fail). Then the branch is pushed to its own name and that becomes its upstream.
const OWN_UPSTREAM = `u=$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null) && [ "\${u#*/}" = "$(git symbolic-ref -q --short HEAD)" ]`;
// A push the remote refused because the branch was rewritten (or moved on).
const REJECTED = /\[rejected\]|non-fast-forward|fetch first|stale info/;
const GIT_OPS = {
  fetch: { label: () => "Fetch", cmd: () => "git fetch --prune" },
  pull: { label: () => "Pull", cmd: () => "git pull --ff-only" },
  push: { label: () => "Push", cmd: () => `if ${OWN_UPSTREAM}; then git push; else git push -u origin HEAD; fi` },
  rebase: { label: (r) => `Rebase onto ${r.base}`, cmd: (r) => `${CLEAN} && { git rebase ${q(r.base)} || { git rebase --abort; exit 1; }; }` },
  // A merge commit even when it could fast-forward, as the git graph's Merge does by default.
  merge: { label: (r) => `Merge ${r.base}`, cmd: (r) => `${CLEAN} && { git merge --no-edit --no-ff ${q(r.base)} || { git merge --abort; exit 1; }; }` },
  // Only after asking (see askForcePush): replaces the remote branch, but
  // still stops if it holds commits this clone hasn't fetched or integrated.
  forcePush: { label: () => "Force push", cmd: () => `if ${OWN_UPSTREAM}; then git push ${LEASE}; else git push -u ${LEASE} origin HEAD; fi` },
  pr: { label: () => "Create pull request", cmd: () => `{ ${OWN_UPSTREAM} || git push -u origin HEAD; } && gh pr create --web` },
};
// A new space asks for its name first (`new-space`), which it gives its first tab
// and the Claude session started there too.
const newSpace = (props = {}) => openOverlay({ mod: "new-space", kind: "dialog", width: 520, height: 560, props });
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
// Local change: every terminal's folder in a space, so a space spanning
// several repos is known as such instead of taking its first terminal's.
function places(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return [...new Set(ps.filter((p) => tabs.has(p.tab) && p.cwd).map((p) => JSON.stringify([s.machine ?? null, p.cwd])))];
}
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// A worktree's identity across its space row and its bare row: machine and top folder.
const treeKey = (g) => JSON.stringify([JSON.parse(g.repo)[0], g.top]);
const PR_EVERY = 60000;
const EDITORS = [
  { label: "VS Code", cli: "code", app: "Visual Studio Code" },
  { label: "Cursor", cli: "cursor", app: "Cursor" },
];

// Editors on this computer: by their command, or (macOS) their app.
async function findEditors() {
  const ok = async (cmd, args) => (await exec(cmd, args).catch(() => null))?.code === 0;
  const mac = (await exec("uname").catch(() => null))?.stdout.trim() === "Darwin";
  const found = [];
  for (const e of EDITORS) {
    const cli = await ok("which", [e.cli]);
    const app = mac && ((await ok("test", ["-d", `/Applications/${e.app}.app`])) || (await ok("test", ["-d", `${home()}/Applications/${e.app}.app`])));
    if (cli || app) found.push({ label: e.label, cli: cli ? e.cli : null, app: app ? e.app : null });
  }
  return found;
}
// The last 50 pull requests, newest first, as `gh pr list --state all` lists them, but with each one's CI as
// GitHub's one rollup state of its last commit: `--json statusCheckRollup` fetches every check of all 50
// (4 s and 54 kB a minute on a busy repository; this is 1.3 s and 13 kB, same verdicts).
const PR_QUERY = "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){pullRequests(first:50,"
  + "states:[OPEN,CLOSED,MERGED],orderBy:{field:CREATED_AT,direction:DESC}){nodes{number headRefName isCrossRepository "
  + "state isDraft url commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}}}";
const ROLLUP = { SUCCESS: "pass", FAILURE: "fail", ERROR: "fail", PENDING: "pending", EXPECTED: "pending" };

function age(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / 604800)}w`;
}

// One verdict for a PR's checks (GitHub's rollup: any failure wins, then anything unfinished); null: no checks.
const ci = (pr) => ROLLUP[pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state] ?? null;
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    this.trees = {}; // repo -> its linked worktrees: [{ path, branch, key }]
    this.relist = new Set(); // where()s whose repo's worktrees to list again
    this.activity = JSON.parse(localStorage.getItem("worktrees.activity") ?? "{}"); // treeKey -> ms
    this.sig = {}; // treeKey -> its status and diff size at the last look
    this.prs = {}; // repo -> branch -> { number, state, draft, url, ci }; absent: not on GitHub
    this.prAsked = {}; // repo -> when gh was last asked
    this.removeCmd = {}; // repo -> its `herdr.worktreeRemove`, or null
    // Local change: a space's worktree list is folded until you unfold it (remembered per space).
    this.treesOpen = new Set(JSON.parse(localStorage.getItem("worktrees.open") ?? "[]"));
    // Requests from `worktree-actions` (a queue; an older copy wrote a single one); those there at start are old.
    const queued = shared("worktree-support.request");
    this.handled = new Set((Array.isArray(queued) ? queued : queued ? [queued] : []).map((r) => r?.id));
    this.editors = [];
    cx.spawn(async () => { this.editors = await findEditors(); });
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.machines = [];
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx, true);
    if (sp.some((s) => !this.shown.has(s.id))) cx.notify();
    const queued = shared("worktree-support.request");
    for (const req of Array.isArray(queued) ? queued : queued ? [queued] : []) {
      if (!req?.id || this.handled.has(req.id)) continue;
      this.handled.add(req.id);
      if (now - req.at < 5000) this.act(req, cx);
    }
    if (this.handled.size > 200) this.handled = new Set([...this.handled].slice(-50)); // only recent ids matter
  }

  // The space showing a worktree's top folder, if any.
  spaceAt(path) {
    const ps = panes();
    return spaces().find((s) => this.spaceGit(s, ps).g?.top === path) ?? null;
  }

  // A space's git only when its terminals that are in a repo all are in the same
  // one; otherwise `mixed` says how many repos, and the row shows no git at all.
  spaceGit(s, ps) {
    const g = this.git[where(s, ps)] ?? null;
    const repos = new Set(places(s, ps).map((k) => this.git[k]?.repo).filter(Boolean));
    if (g) repos.add(g.repo);
    return repos.size > 1 ? { g: null, mixed: repos.size } : { g, mixed: 0 };
  }

  // Actions the menu can't wait for (it closes first): ones that need a new
  // space's id, and git operations, which report how they went.
  act(req, cx) {
    if (req.action === "git") return this.runGit(req, cx);
    if (req.action === "cleanup") return this.cleanup(req, cx);
    if (req.action === "askCleanup") return void this.askCleanup(req);
    if (req.action !== "changes") return;
    const s = this.spaceAt(req.path);
    if (s) return run("tab.new", { space: s.id, mod: "changes", name: "changes" });
    cx.spawn(async () => {
      const r = await exec("herdr-app", ["do", "space.new", JSON.stringify({ folder: req.path, ...(req.machine ? { machine: req.machine } : {}) })]).catch(() => null);
      const space = r?.code === 0 ? JSON.parse(r.stdout).space : null;
      if (space) run("tab.new", { space, mod: "changes", name: "changes" });
    });
  }

  // A git operation from the menu, run in the worktree; a toast says how it went.
  runGit(req, cx) {
    const op = GIT_OPS[req.op];
    if (!op) return;
    const on = req.machine ?? null;
    cx.spawn(async (cx) => {
      const r = await exec("sh", ["-c", op.cmd(req)], { cwd: req.path, on, timeout: 120000 })
        .catch((e) => ({ code: -1, stdout: "", stderr: String(e) }));
      const out = `${r.stderr ?? ""}\n${r.stdout ?? ""}`.trim().split("\n").filter(Boolean).slice(-4).join("\n");
      const what = op.label(req);
      if (req.op === "push" && r.code !== 0 && REJECTED.test(r.stderr ?? "")) return this.askForcePush(req);
      notify(r.code === 0
        ? { title: `${what}: done`, body: req.branch ?? undefined, level: "success", timeout: 4000 }
        : { title: `${what} failed`, body: out || `exit ${r.code}`, level: "error" });
      this.refreshGit([JSON.stringify([on, req.path])], cx, true);
      cx.notify();
    });
  }

  // What a clean-up takes away, said before it does: the folder, uncommitted changes, the
  // branch's commits found on no remote, and the space or tab open there.
  async askCleanup(p) {
    const on = p.machine ?? null;
    const ref = `refs/heads/${p.branch}`; // never a file or folder of the same name
    const tip = await exec("git", ["rev-parse", "--verify", "-q", ref], { cwd: p.main, on }).catch(() => null);
    const sha = tip?.code === 0 ? tip.stdout.trim() : null;
    const only = sha ? await exec("git", ["rev-list", "--count", sha, "--not", "--remotes", ...(p.base ? [p.base] : []), "--"], { cwd: p.main, on }).catch(() => null) : null;
    const n = only?.code === 0 ? parseInt(only.stdout, 10) || 0 : null;
    const closes = closing(p.path, on);
    const lines = [
      `Removes the worktree ${p.path}${p.remove ? " (with the repository's herdr.worktreeRemove command)" : ""} and deletes the branch ${p.branch}.`,
      p.dirty ? "It has uncommitted changes: they are lost." : "It has no uncommitted changes.",
      n === null ? "Couldn't count the commits that are on no remote: some may be lost." : n ? `${n} commit${n === 1 ? " is" : "s are"} on no remote${p.base ? ` and not in ${p.base}` : ""}${p.finished === "merged" ? " (a squash merge leaves them like that)" : ""}.` : "Every commit is on a remote or in the base branch.",
      closes.spaces.length ? `${closes.spaces.length === 1 ? "The space" : "The spaces"} ${names(closes.spaces.map((s) => s.name))} ${closes.spaces.length === 1 ? "closes" : "close"}, with ${closes.spaces.length === 1 ? "its" : "their"} terminals and agents.` : "",
      closes.tabs.length ? `${closes.tabs.length === 1 ? "The tab" : "The tabs"} ${names(closes.tabs.map((t) => `${t.name} in ${t.space}`))} ${closes.tabs.length === 1 ? "closes" : "close"}; the rest of ${closes.tabs.length === 1 ? "its space" : "their spaces"} stays.` : "",
    ].filter(Boolean);
    openOverlay({ mod: "worktree-actions", kind: "dialog", width: 480, height: 250, props: { confirm: {
      title: `Clean up ${p.branch}?`, detail: lines.join(" "), button: "Clean up", danger: Boolean(p.dirty || n || n === null),
      request: { action: "cleanup", path: p.path, branch: p.branch, sha, machine: p.machine ?? null, main: p.main, repoKey: p.repoKey ?? null,
        close: { spaces: closes.spaces.map((s) => s.id), tabs: closes.tabs.map((t) => t.id) }, remove: p.remove ?? null, dirty: Boolean(p.dirty) },
    } } });
  }

  // Local change: a finished worktree cleaned up, after `worktree-actions` asked: the worktree
  // removed (the repo's herdr.worktreeRemove command when it sets one), its branch deleted,
  // then the space or tab the dialog named closed. Stops at the first failure, with a toast.
  cleanup(req, cx) {
    const on = req.machine ?? null, sh = (cmd) => exec("sh", ["-c", cmd], { cwd: req.main, on, timeout: 120000 })
      .catch((e) => ({ code: -1, stdout: "", stderr: String(e) }));
    const fail = (what, r) => notify({ title: `${what} failed`, body: `${r.stderr ?? ""}\n${r.stdout ?? ""}`.trim().split("\n").filter(Boolean).slice(-4).join("\n") || `exit ${r.code}`, level: "error" });
    cx.spawn(async (cx) => {
      const remove = req.remove ? customRemove(req.remove, req.path, req.branch)
        : ["git", ...removeWorktreeArgs(req.path, req.dirty)].map(q).join(" ");
      // What closes: only what the dialog named and is still wholly inside the worktree now (before removing it).
      const now = closing(req.path, on), named = req.close ?? { spaces: [], tabs: [] };
      const closeSpaces = now.spaces.filter((s) => named.spaces.includes(s.id));
      const closeTabs = now.tabs.filter((t) => named.tabs.includes(t.id));
      // The branch must still be where the dialog saw it: an agent may have committed there since.
      const ref = `refs/heads/${req.branch}`;
      if (req.sha) {
        const now = await sh(`git rev-parse --verify -q ${q(ref)}`);
        if (now.code === 0 && now.stdout.trim() !== req.sha)
          return fail("Clean-up stopped", { stderr: `${req.branch} has new commits since you were asked. Nothing was removed: look again, then clean up.` });
      }
      // Changes since the dialog said "no uncommitted changes" (its look may be a minute old; a custom remove
      // command wouldn't check): stop before anything goes.
      if (!req.dirty) {
        const st = await sh(`git -C ${q(req.path)} status --porcelain`);
        if (st.code === 0 && st.stdout.trim()) return fail("Clean-up stopped", { stderr: `${req.path.split("/").pop()} has uncommitted changes now. Nothing was removed: look again, then clean up.` });
      }
      let r = await sh(remove);
      if (r.code !== 0) return fail("Removing the worktree", r);
      // A remove command that deletes the branch itself leaves nothing to delete: that's fine.
      const exists = await sh(`git rev-parse --verify -q ${q(`refs/heads/${req.branch}`)}`);
      // The dialog said how many of its commits are on no remote and not in the base branch, so it goes even
      // unmerged (a squash merge leaves it so), but only if it still points where the dialog saw it
      // (update-ref's old-value check). Without that look (sha unknown), only as merged: `git branch -d`.
      r = exists.code !== 0 ? { code: 0 } : req.sha ? await sh(`git update-ref -d ${q(ref)} ${q(req.sha)}`)
        : await sh(["git", ...deleteBranchArgs(req.branch)].map(q).join(" "));
      if (r.code !== 0) fail("Deleting the branch", r);
      for (const s of closeSpaces) run("space.close", { id: s.id, confirmed: true });
      for (const t of closeTabs) run("tab.close", { id: t.id, confirmed: true });
      if (r.code === 0) notify({ title: "Cleaned up", body: `${req.branch}: worktree removed, branch deleted`, level: "success", timeout: 4000 });
      // The repository's own key (its git folder, as listed): `<main>/.git` is wrong for a bare or symlinked one.
      await this.listTrees(req.repoKey ?? JSON.stringify([on, `${req.main}/.git`]), cx).catch(() => {});
      cx.notify();
    });
  }

  // A push refused after a rebase: ask (in `worktree-actions`) before forcing it,
  // saying how many of the remote branch's commits it would replace.
  async askForcePush(req) {
    const on = req.machine ?? null;
    const remote = `$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo origin/${q(req.branch ?? "HEAD")})`;
    const c = await exec("sh", ["-c", `git rev-list --left-right --count "${remote}...HEAD"`], { cwd: req.path, on }).catch(() => null);
    const [theirs, mine] = c?.code === 0 ? c.stdout.trim().split(/\s+/).map((n) => parseInt(n, 10) || 0) : [null, null];
    const n = (k, what) => `${k} ${what}${k === 1 ? "" : "s"}`;
    const counts = theirs === null ? "" : ` Its ${n(theirs, "commit")} not on your branch will be replaced by your ${n(mine, "commit")}.`;
    openOverlay({ mod: "worktree-actions", kind: "dialog", width: 460, height: 210, props: { confirm: {
      title: `Force-push ${req.branch ?? "this branch"}?`,
      detail: `The remote branch has diverged from yours, as it does after a rebase.${counts} The push still stops if someone else pushed there since your last fetch.`,
      request: { action: "git", op: "forcePush", path: req.path, machine: req.machine, branch: req.branch },
    } } });
  }

  // A tab of space w whose terminal is in path (or under it).
  tabIn(w, path) {
    const tabs = new Set((w.tabs ?? []).map((c) => c.id));
    const inside = (cwd) => cwd === path || cwd?.startsWith(`${path}/`);
    return panes().find((p) => tabs.has(p.tab) && inside(p.cwd))?.tab ?? null;
  }

  touch(k, ms) {
    this.activity[k] = ms;
    localStorage.setItem("worktrees.activity", JSON.stringify(this.activity));
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    for (const s of sp) for (const k of places(s, ps)) keys.add(k);
    for (const list of Object.values(this.trees)) for (const wt of list) keys.add(wt.key);
    // Worktrees on screen: those of a repository whose list some space has unfolded (or a space works in).
    // The rest are read once, then left until they show: with hundreds of worktrees, re-reading every one
    // on each turn end or fallback meant thousands of git processes.
    const openRepos = new Set(sp.filter((s) => this.treesOpen.has(s.id)).map((s) => this.spaceGit(s, ps).g?.repo).filter(Boolean));
    const placed = new Set(sp.flatMap((s) => places(s, ps)));
    const hidden = new Set();
    for (const [repo, list] of Object.entries(this.trees)) if (!openRepos.has(repo)) for (const wt of list) if (!placed.has(wt.key)) hidden.add(wt.key);
    this.hiddenKeys = hidden;
    const shown = new Set([...keys].filter((k) => !hidden.has(k)));
    // Places no longer anywhere (a folder a terminal left): forget them, or each .git change re-reads them.
    for (const k of Object.keys(this.git)) if (!keys.has(k)) { delete this.git[k]; delete this.checked[k]; this.unsure.delete(k); }
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) {
        this.sameRepo(at[spaceOf[p.tab].id], shown).forEach((k) => due.add(k));
        if (p.cwd) this.sameRepo(JSON.stringify([spaceOf[p.tab].machine ?? null, p.cwd]), shown).forEach((k) => due.add(k));
      }
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of shown) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  // `relist`: their repos' worktrees may have come or gone too.
  refreshGit(keys, cx, relist = false) {
    for (const k of keys) {
      this.pending.add(k);
      if (relist) this.relist.add(k);
    }
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
        const repos = new Set();
        for (const key of keys) {
          const g = this.git[key];
          if (g && (this.relist.has(key) || !(g.repo in this.trees))) repos.add(g.repo);
          this.relist.delete(key);
        }
        for (const repo of repos) await this.listTrees(repo, cx);
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) { this.watching.delete(repo); this.watches?.get(repo)?.cancel(); this.watches?.delete(repo); }
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Writes nothing under .git (index lock, fsmonitor cookie): watch() would wake on it.
      const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch"], { cwd, on });
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
      const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
      const repo = common.stdout.trim();
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const info = { name, branch: null, ahead: 0, behind: 0, dirty: false, repo: JSON.stringify([on, repo]), top: top.stdout.trim(), linked: repo !== `${top.stdout.trim()}/.git` };
      for (const line of r.stdout.split("\n")) {
        if (line && !line.startsWith("#")) info.dirty = true;
        else if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        // Local change: an upstream without ahead/behind is gone (deleted on the remote, often after a merge).
        else if (line.startsWith("# branch.upstream ")) info.gone = true;
        else if (line.startsWith("# branch.ab ")) {
          info.gone = false;
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      if (info.linked) await this.checkTree(info, r.stdout, cwd, on);
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  // A worktree against the main checkout's branch (its own upstream rarely
  // exists yet), and when it last changed: status or diff size moving.
  async checkTree(info, status, cwd, on) {
    const [, dir] = JSON.parse(info.repo);
    const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false"];
    if (dir.endsWith("/.git")) {
      const b = await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir.slice(0, -5), on });
      const baseRef = b.code === 0 ? b.stdout.trim() : "";
      info.ahead = info.behind = 0;
      info.base = baseRef && baseRef !== "HEAD" ? baseRef : null;
      if (baseRef && baseRef !== "HEAD" && baseRef !== info.branch) {
        const c = await exec("git", ["rev-list", "--left-right", "--count", `${baseRef}...HEAD`], { cwd, on });
        if (c.code === 0) [info.behind, info.ahead] = c.stdout.trim().split(/\s+/).map((n) => parseInt(n, 10) || 0);
      }
    }
    const k = treeKey(info);
    const stat = await exec("git", [...READ, "diff", "HEAD", "--shortstat"], { cwd, on });
    const sig = status + stat.stdout;
    if (this.sig[k] === undefined) {
      const l = await exec("git", ["log", "-1", "--format=%ct"], { cwd, on });
      const committed = (parseInt(l.stdout, 10) || 0) * 1000;
      if (committed > (this.activity[k] ?? 0)) this.touch(k, committed);
    } else if (this.sig[k] !== sig) this.touch(k, Date.now());
    this.sig[k] = sig;
  }

  // Pull requests by branch, when origin is on GitHub; gh at most once a minute.
  async loadPrs(repo, dir, on) {
    if (Date.now() - (this.prAsked[repo] ?? 0) < PR_EVERY) return;
    this.prAsked[repo] = Date.now();
    const cwd = dir.endsWith("/.git") ? dir.slice(0, -5) : dir;
    const origin = await exec("git", ["remote", "get-url", "origin"], { cwd, on }).catch(() => null);
    if (!origin || origin.code !== 0 || !/github\.com[:/]/.test(origin.stdout)) return void delete this.prs[repo];
    // {owner} and {repo}: gh fills them in from the folder's repository, as `gh pr list` finds it.
    const r = await exec("gh", ["api", "graphql", "-F", "owner={owner}", "-F", "name={repo}", "-f", `query=${PR_QUERY}`], { cwd, on }).catch(() => null);
    if (!r || r.code !== 0) {
      // Not installed: the feature just stays hidden. Logged out or rate-limited: say so, once a session.
      const why = /auth login|not logged|authentication/i.test(r?.stderr ?? "") ? "gh isn't logged in: run `gh auth login`."
        : /rate limit/i.test(r?.stderr ?? "") ? "GitHub's rate limit for gh is used up for now." : null;
      if (why && !(this.ghSaid ??= new Set()).has(why)) {
        this.ghSaid.add(why);
        notify({ title: "Pull requests not shown", body: why, level: "warning", timeout: 8000 });
      }
      return;
    }
    const byBranch = {};
    // Newest first: a branch reused after a merge shows its latest PR.
    // Only this repository's own branches: a fork's merged `fix-typo` is not your `fix-typo`.
    const nodes = JSON.parse(r.stdout)?.data?.repository?.pullRequests?.nodes ?? [];
    for (const p of nodes) if (p && !p.isCrossRepository) byBranch[p.headRefName] ??= { number: p.number, state: p.state, draft: p.isDraft, url: p.url, ci: ci(p) };
    this.prs[repo] = byBranch;
  }

  // A repo's linked worktrees, read from its git folder. Their git is looked at
  // like a space's, so their rows show branch, ahead/behind and changes.
  async listTrees(repo, cx) {
    const [on, dir] = JSON.parse(repo);
    let r;
    try { r = await exec("git", ["worktree", "list", "--porcelain"], { cwd: dir, on }); } catch { return; }
    if (r.code !== 0) return;
    const cfg = await exec("git", ["config", "--get", "herdr.worktreeRemove"], { cwd: dir, on }).catch(() => null);
    this.removeCmd[repo] = cfg?.code === 0 ? cfg.stdout.trim() || null : null;
    // On its own: the network mustn't hold up the rows.
    cx.spawn(async (cx) => { await this.loadPrs(repo, dir, on).catch(() => {}); cx.notify(); });
    const list = [];
    for (const block of r.stdout.split("\n\n").slice(1)) {
      const lines = block.split("\n");
      const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
      if (!path || lines.some((l) => l === "bare" || l.startsWith("prunable"))) continue;
      const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null;
      list.push({ path, branch, key: JSON.stringify([on, path]) });
    }
    const kept = new Set(list.map((wt) => wt.key));
    let pruned = false;
    for (const wt of this.trees[repo] ?? []) if (!kept.has(wt.key)) {
      delete this.git[wt.key]; delete this.checked[wt.key]; delete this.sig[wt.key];
      if (wt.key in this.activity) { delete this.activity[wt.key]; pruned = true; }
    }
    if (pruned) localStorage.setItem("worktrees.activity", JSON.stringify(this.activity));
    this.trees[repo] = list;
    for (const wt of list) if (!(wt.key in this.git)) await this.check(wt.key, cx);
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          // Kept so dropping the repo cancels the pending watch (Herdr allows only so many).
          const handle = watchFolder(repo);
          (this.watches ??= new Map()).set(repo, handle);
          const paths = await handle;
          const mine = JSON.stringify([null, repo]);
          // Adding, removing or committing in a worktree writes under `<git>/worktrees/`.
          const relist = paths.some((p) => p.startsWith(`${repo}/worktrees/`));
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine && !this.hiddenKeys?.has(k)), cx, relist);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    const { g } = this.spaceGit(w, panes());
    openOverlay({ mod: "worktree-actions", kind: "popup", width: 230, height: 400, props: {
      kind: "space", path: place(w, panes()), machine: w.machine ?? null, space: w.id, editors: this.editors,
      git: Boolean(g),
      branch: g?.branch && g.branch !== "(detached)" ? g.branch : null,
      linked: Boolean(g?.linked),
    } });
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, ...this.spaceGit(w, ps) })).filter((r) => this.shown.has(r.w.id));
    // Local change: spaces are never nested under another space; one in a worktree is a row of
    // its own (repository and branch in its tail). Only worktrees no space is in are listed.
    const out = [];
    // Local change: every space of a repository lists its worktrees (folded until you unfold
    // them there); opening one as a tab puts it in the space whose list it's in (treeMenu).
    for (const r of list) {
      const main = { ...r, tree: null };
      out.push(main);
      if (!r.g) continue;
      const open = new Set(list.filter((k) => k.g?.repo === r.g.repo).map((k) => k.g.top));
      const act = (k) => this.activity[k.wt.key] ?? 0;
      const all = (this.trees[r.g.repo] ?? []).filter((wt) => !open.has(wt.path))
        .map((wt) => ({ wt, w: r.w, g: this.git[wt.key] ?? null })).sort((a, b) => act(b) - act(a));
      if (!all.length) continue;
      const folded = !this.treesOpen.has(r.w.id);
      main.fold = { space: r.w.id, count: all.length, folded };
      if (folded) continue;
      all.forEach((k, n) => out.push({ ...k, act: act(k), parent: r.w, repo: r.g.repo, tree: n === all.length - 1 ? "└─" : "├─" }));
    }
    return out;
  }

  // A worktree row's right-click: `worktree-actions`, with all it needs to act.
  // A worktree row's menu (only those rows have one; a space's is menu()).
  treeMenu(r) {
    const { path, branch } = r.wt;
    const [, dir] = JSON.parse(r.repo);
    const space = this.spaceAt(path);
    const { g } = r;
    // "Open as tab" puts one in the space whose list this row is in (unless it has one there);
    // "Go to tab" shows a tab already in the worktree: this space's, else another's.
    const elsewhere = spaces().find((s) => s.id !== r.parent.id && (s.machine ?? null) === (r.parent.machine ?? null) && this.tabIn(s, path));
    const tabHere = this.tabIn(r.parent, path);
    const tabSpace = tabHere ? r.parent : elsewhere ?? null;
    openOverlay({ mod: "worktree-actions", kind: "popup", width: 250, height: 640, props: {
      path, branch,
      tab: tabHere ?? (elsewhere ? this.tabIn(elsewhere, path) : null), tabHere: Boolean(tabHere),
      tabSpace: tabSpace?.id ?? null, tabSpaceName: tabSpace?.name ?? null,
      base: g?.base && g.base !== branch ? g.base : null,
      behind: g?.behind ?? 0,
      machine: r.parent.machine ?? null,
      repoSpace: r.parent.id,
      repoName: r.parent.name,
      space: space?.id ?? null,
      main: dir.endsWith("/.git") ? dir.slice(0, -5) : dir, repoKey: r.repo,
      remove: this.removeCmd[r.repo] ?? null,
      finished: this.finished(r), dirty: Boolean(g?.dirty),
      pr: this.pr(r)?.url ?? null,
      github: r.repo in this.prs,
      editors: this.editors,
    } });
  }

  // Local change: why a worktree looks finished (its PR merged or closed, its remote branch
  // gone), or null. Its row is dimmed, and its menu offers to clean it up.
  finished(r) {
    const branch = r.wt ? r.wt.branch : r.g?.branch;
    if (!branch || !(r.wt || r.tree)) return null;
    const pr = this.pr(r);
    return pr?.state === "MERGED" ? "merged" : pr?.state === "CLOSED" ? "PR closed" : r.g?.gone ? "remote gone" : null;
  }

  pr(r) {
    const branch = r.wt ? r.wt.branch : r.g?.branch;
    return branch ? this.prs[r.repo]?.[branch] ?? null : null;
  }

  toggleFold(space, cx) {
    const opening = !this.treesOpen.has(space);
    opening ? this.treesOpen.add(space) : this.treesOpen.delete(space);
    // Unfolded: its worktrees were left alone while hidden, so they are read again at the next look.
    if (opening) {
      const sp = spaces().find((s) => s.id === space), repo = sp ? this.spaceGit(sp, panes()).g?.repo : null;
      for (const wt of this.trees[repo] ?? []) this.checked[wt.key] = 0;
    }
    // Spaces that are gone are forgotten.
    const ids = new Set(spaces().map((s) => s.id));
    localStorage.setItem("worktrees.open", JSON.stringify([...this.treesOpen].filter((id) => ids.has(id))));
    cx.notify();
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed) {
    const rows = this.ordered().filter((r) => !(collapsed && r.wt));
    const draw = (r) => (collapsed ? this.compact(r, t) : this.row(r, t));
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => div().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(8).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    if (!remote.length) return loading(null) && !rows.length ? [loadingRow(null)] : rows.map(draw);
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const machine = this.machines.find(k => k.name === m);
      const connected = !m || machine?.state === "connected";
      const folded = this.folded.has(m);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 2 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none())
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); newSpace(m ? { machine: m } : {}); }).child("+")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => newSpace(m ? { machine: m } : {}))
        .child(svg("mods/workspace-chrome/plus.svg").size(12)).when(!collapsed, el => el.child("New space there"));
      return [head, ...(folded ? [] : mine.length ? mine.map(draw) : [loading(m) ? loadingRow(m) : empty])];
    });
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one.
  // A worktree's extras: its pull request (click opens it) and last activity.
  treeTail(r, t) {
    const pr = this.pr(r);
    const color = !pr ? null : pr.state === "MERGED" ? t.ansi5 : pr.state === "CLOSED" ? t.ansi1 : pr.draft ? t.dim : t.ansi2;
    const check = pr?.state === "OPEN" && pr.ci ? { pass: ["✓", t.ansi2], fail: ["✗", t.ansi1], pending: ["◌", t.ansi3] }[pr.ci] : null;
    const done = this.finished(r);
    return [
      ...(done ? [div().flex_none().text_color(t.dim).child(done)] : []),
      ...(pr ? [h_flex().id(`pr-${r.parent?.id ?? r.w.id}-${pr.number}`).flex_none().gap(2).text_color(color).cursor_pointer().hover((s) => s.underline())
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); cx.open_url(pr.url); })
        .child(`#${pr.number}`)
        .when(Boolean(check), (el) => el.child(div().text_color(check[1]).child(check[0])))] : []),
      ...(r.act ? [div().flex_none().text_color(t.dim).child(age(r.act))] : []),
    ];
  }

  gitTail(g, tree, name, t, extra = []) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    // A worktree's tail keeps its counts whole; its name gives way instead.
    return h_flex()
      .when(!tree, (el) => el.flex_1().min_w(0))
      .when(Boolean(tree), (el) => el.flex_none())
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).when(Boolean(tree), (el) => el.max_w(80)).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)))
      .children(extra);
  }

  // A worktree with no space: a click goes to a space opened there since, else to a
  // tab of the repo's space already in the worktree, else does nothing. Opening
  // a space or a tab there is the right-click menu's.
  // (Local change: upstream opens a new space.)
  looseRow(r, t) {
    const { wt, w, g, tree } = r;
    const name = wt.branch ?? base(wt.path);
    // Local change: a double-click opens it as a tab in this space (or shows the one it has).
    const open = (e) => {
      if ((e?.click_count ?? 1) >= 2) {
        const tab = this.tabIn(w, wt.path);
        run("space.select", { id: w.id });
        return void (tab ? run("tab.select", { id: tab }) : run("tab.new", { space: w.id, folder: wt.path, name: branchTitle(wt.branch) || undefined }));
      }
      const s = this.spaceAt(wt.path);
      if (s) return run("space.select", { id: s.id });
      // Local change: a tab there in any space, the one you're in first.
      const order = [...spaces()].sort((a, b) => Number(b.active) - Number(a.active));
      const holder = order.find((x) => (x.machine ?? null) === (w.machine ?? null) && this.tabIn(x, wt.path));
      if (!holder) return;
      run("space.select", { id: holder.id });
      run("tab.select", { id: this.tabIn(holder, wt.path) });
    };
    return h_flex()
      .id(`worktree-${w.id}-${wt.key}`)
      .px(8)
      .h(rowHeight({ tree }))
      .flex_none()
      .gap(9)
      .items_center()
      .rounded(8)
      .hover((s) => s.bg(t.hover))
      .when(Boolean(this.finished(r)), (el) => el.opacity(0.55))
      .on_click(open)
      .on_mouse_down("right", () => this.treeMenu(r))
      .child(div().pl(22).child(svg("mods/workspace-chrome/branch.svg").size(13).text_color(t.dim)))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(name))
      .child(g ? this.gitTail(g, tree, name, t, this.treeTail(r, t)) : div().flex_1());
  }

  row(r, t) {
    if (r.wt) return this.looseRow(r, t);
    const { w, i, g, tree } = r;
    const on = w.active;
    const colors = shared("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .rounded(8)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(!on && Boolean(this.finished(r)), (el) => el.opacity(0.55))
      .when(this.pressed === i && this.over !== i, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.over === i && this.pressed !== i, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(this.pressed < i, line => line.bottom(0))
          .when(this.pressed > i, line => line.top(0)),
      ))
      .on_mouse_down("left", () => {
        this.pressed = i;
        this.over = i;
      })
      .on_mouse_move((_e, cx) => {
        const source = spaces()[this.pressed];
        const over = source && (source.machine ?? null) === (w.machine ?? null) ? i : null;
        if (this.pressed !== null && this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        const over = this.over;
        this.pressed = null;
        this.over = null;
        if (from !== null && over === i && from !== i) run("space.move", { id: spaces()[from].id, index: i + 1 });
        else if (from === i) run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          // Local change: a space in a worktree keeps its avatar (two spaces in one worktree
          // stay apart); the branch icon is for worktrees no space is in.
          .when(Boolean(tree), el => el.pl(22))
          .child(div().relative().flex_none()
            .child(h_flex().size(18).rounded(5).bg(fill).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...w.name][0]?.toUpperCase() ?? "?"))
            // Local addition (from my-spaces): an agent in it needs you (red) or finished while you looked elsewhere.
            .when(w.status === "blocked" || w.status === "done", el => el.child(
              div().absolute().right(-3).bottom(-3).size(8).rounded(4).border(1.5).border_color(on ? t.selected : t.chrome).bg(tone(t, w.status)))))
          .child(div().when(Boolean(tree), (el) => el.flex_1().min_w(0)).when(!tree, (el) => el.flex_shrink(0).max_w(150)).truncate().text_color(t.foreground).child(w.name))
          .child(g ? this.gitTail(g, tree, w.name, t, tree ? this.treeTail(r, t) : [])
            : r.mixed ? h_flex().id(`repos-${w.id}`).flex_1().min_w(0).justify_end().text_size(11.5).text_color(t.dim).tooltip("Its terminals are in different repos: see each tab").child(`${r.mixed} repos`)
            : div().flex_1())
          // Local change: a fixed slot for the chevron on every space row, so repos and chevrons line up.
          .when(!tree && !r.fold, (el) => el.child(div().w(18).flex_none()))
          .when(Boolean(r.fold), (el) => el.child(h_flex().id(`fold-${w.id}`).flex_none().w(18).h(18).justify_center().rounded(4).items_center()
            .text_size(11).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => { cx.stop_propagation(); this.toggleFold(r.fold.space, cx); })
            .child(svg(`mods/workspace-chrome/chevron-${r.fold.folded ? "right" : "down"}.svg`).size(11)))),
      );
  }

  compact({ w, i }, t) {
    return h_flex()
      .id(`space-${w.id}`)
      .h(26)
      .flex_none()
      .justify_center()
      .gap(4)
      .when(w.active, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("space.select", { id: w.id }))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .child(div().text_color(tone(t, w.status)).child(glyph(w.status)));
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(!collapsed, el => el.child("Spaces"))
        .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => newSpace()).child(svg("mods/workspace-chrome/plus.svg").size(14))))
      .child(v_flex().flex_1().min_h(0).px(8).pb(14).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        .children(this.grouped(t, collapsed)));
  }
}
