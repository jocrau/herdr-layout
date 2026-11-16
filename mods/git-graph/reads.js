// Modified by Jochen Rau, 2026-11, from rabeeh-ta/herdr-git-graph: see NOTICE.md in this folder.
// Reading a folder's repository state for the graph: log, branches, status (moved out of graph.js).
import { exec, shared } from "herdr";
import { STATUS, logArgs, parseLog, parseStatus, BRANCHES, parseBranches, READ, REV_PARSE, parseRevParse, childrenFirst } from "./git.js";
import { REPO_STATUS, LATEST_TAG, parseRepoStatus } from "./repos.js";
import { PAGE, scopeOf } from "./common.js";

// What belongs to one folder: a new folder starts from this, and leaving one keeps it.
// workspace: the repositories under a folder that isn't one (Manygit), their
// statuses, and the one opened from that list (its graph shows until Back).
export const folderState = () => ({
  state: "loading", root: null, on: null, cwd: null, error: null,
  workspace: null, statuses: new Map(), opened: null, skipped: false,
  base: [], commits: [], rows: [], lanes: 1, labels: new Map(), index: new Map(), hasMore: false, limit: PAGE, files: [], ctx: null,
  head: null, current: null, branches: [], tracking: {}, worktrees: {}, mainRoot: null, remoteNames: [], signature: null, refSignature: null, scope: null, moreAsked: null,
  selected: null, details: null, diff: null,
});

// Everything the table shows for a folder, in one round of five git calls: each
// answers from any subfolder, and status names paths from the repository root.
export async function readFolder(cwd, on, { all, remotes, limit }) {
  const git = (args) => exec("git", [...READ, ...args], { cwd, on });
  const [rev, log, branches, remoteNames, status] = await Promise.all([
    git(REV_PARSE), readLog(git, { all, remotes, limit }, JSON.stringify([cwd, on])), git(BRANCHES), git(["remote"]), git(STATUS)]);
  const where = parseRevParse(rev.stdout);
  if (!where) return { state: "norepo", cwd, on };
  const { root, head } = where;
  // A branch with no commits yet is still the current one.
  const current = where.unborn ? (await git(["symbolic-ref", "-q", "--short", "HEAD"])).stdout.trim() || null : where.current;
  const parsed = parseBranches(branches.stdout, root);
  // A linked worktree's main checkout holds the shared .git (a bare repository has none).
  const shared = where.common;
  const mainRoot = shared.endsWith("/.git") && shared.slice(0, -5) !== root ? shared.slice(0, -5) : null;
  // A log that fails without a HEAD is a repository with no commits yet.
  if (log.error && head) throw new Error(log.error);
  const refSignature = [rev.stdout, current ?? "", branches.stdout, remoteNames.stdout].join("\0");
  return {
    root, mainRoot, on, cwd, base: log.base, limit, hasMore: log.hasMore, head, current,
    branches: parsed.names, tracking: parsed.tracking, worktrees: parsed.worktrees,
    remoteNames: remoteNames.stdout.split("\n").filter(Boolean),
    files: status.code === 0 ? parseStatus(status.stdout) : [],
    refSignature, signature: `${log.text}\0${refSignature}`, scope: scopeOf({ all, remotes }),
  };
}

// The history alone, for the next page: the refs, branches and status are as the last read left them.
// Git's own order, read two pages deep: where it already has every child before its parents, so does
// --date-order, at a fraction of the time. A wrong clock among those commits asks git for --date-order
// itself, since the child that belongs above a commit may be further down than any page.
// A folder found that way asks for --date-order from then on (skewed: its folder keys, kept while Herdr runs).
// One commit past the page says whether there are more, as Git Graph asks.
const skewed = new Set();
export async function readLog(git, { all, remotes, limit }, folder) {
  let log = skewed.has(folder) ? null : await git(logArgs({ all, remotes, limit: 2 * limit + 1 }));
  if (log && log.code !== 0) return { base: [], hasMore: false, text: "", error: log.stderr.trim() };
  let base = log ? parseLog(log.stdout) : null;
  if (!base || childrenFirst(base) !== base) {
    if (skewed.size > 200) skewed.clear();
    skewed.add(folder);
    log = await git(logArgs({ all, remotes, limit: limit + 1, dateOrder: true }));
    if (log.code !== 0) return { base: [], hasMore: false, text: "", error: log.stderr.trim() };
    base = parseLog(log.stdout);
  }
  return { base: base.slice(0, limit), hasMore: base.length > limit, text: log.stdout };
}

// A row's status: one git call (with the newest tag beside it when tags show),
// and `git remote` only when the branch has no upstream.
export async function readRepo(path, on, tags) {
  const [r, tag] = await Promise.all([exec("git", REPO_STATUS, { cwd: path, on }), tags ? exec("git", LATEST_TAG, { cwd: path, on }) : null]);
  if (r.code !== 0) return { error: (r.stderr || "git status failed").trim().split("\n").pop() };
  const st = parseRepoStatus(r.stdout);
  if (tag?.code === 0 && tag.stdout.trim()) st.tag = tag.stdout.trim();
  if (!st.upstream) st.hasRemote = Boolean((await exec("git", [...READ, "remote"], { cwd: path, on })).stdout.trim());
  return st;
}
