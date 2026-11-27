// Action execution is separate from the UI so context checks can be tested
// against disposable repositories. exec has Herdr's (program, argv, options) shape.
import { READ, commandsFor, gitError } from "./git.js";
import { customRemove, unmerged } from "./lib/worktree.js";

// Commands that reach a remote: no credential prompt (it would wait unseen until the timeout, as the
// overview's fetch already avoids) and five minutes instead of exec's 30 s, so a big push isn't cut off.
const NETWORK = new Set(["fetch", "pull", "push"]);
const networked = (args) => NETWORK.has(args.find((a) => !a.startsWith("-") && !a.includes("=")) ?? "");

export async function executeAction(action, values, ctx, exec) {
  const git = (args) => exec("git", args, { cwd: ctx.root, on: ctx.on });
  const remoteGit = (args) => exec("env", ["GCM_INTERACTIVE=0", "GIT_TERMINAL_PROMPT=0", "GIT_ASKPASS=", "git", ...args], { cwd: ctx.root, on: ctx.on, timeout: 300000 });
  const commands = commandsFor(action, values, ctx);
  // A dialog/menu describes this snapshot, not whatever HEAD happens to be
  // when the user confirms it. Fetch does not operate on the current branch.
  if (action.type !== "fetch") {
    const head = await git([...READ, "rev-parse", "--verify", "-q", "HEAD"]);
    const branch = await git([...READ, "symbolic-ref", "-q", "--short", "HEAD"]);
    // Exit 1 means unborn HEAD or detached HEAD, respectively. Other failures
    // are not empty states and must not authorize a mutation.
    if (![0, 1].includes(head.code) || ![0, 1].includes(branch.code)) {
      return { ok: false, message: "Cannot verify the repository state. Close this action and refresh the graph." };
    }
    const actualHead = head.code === 0 ? head.stdout.trim() : null;
    const actualBranch = branch.code === 0 ? branch.stdout.trim() : null;
    if (actualHead !== ctx.head || actualBranch !== ctx.current) {
      return { ok: false, stale: true, message: "The repository's branch or HEAD changed. Close this action, refresh the graph, and review it again." };
    }
  }
  // Staging everything would mark unresolved conflicts resolved and commit their markers.
  if (action.type === "commit" && values.all) {
    const unmerged = await git([...READ, "ls-files", "--unmerged"]);
    if (unmerged.code !== 0 || unmerged.stdout.trim()) {
      return { ok: false, message: "There are unresolved merge conflicts. Resolve them first, or untick \"Stage every change\" to let git decide." };
    }
  }
  // Local change: new worktrees go in .worktrees/, which the main checkout's status
  // shouldn't list: info/exclude (shared by every worktree, never committed) gets it once.
  const adding = commands.find((c) => c[0] === "worktree" && c[1] === "add");
  if (adding) {
    // git makes a -b branch before it finds the folder taken, and leaves it behind: look first.
    const path = adding[adding.length - 2]; // worktree add [options] <path> <commit-ish>
    const taken = await exec("test", ["-e", path], { cwd: ctx.root, on: ctx.on });
    if (taken.code === 0) return { ok: false, message: `The folder ${path.split("/").pop()} already exists in .worktrees: remove it, or pick another branch name.\n\n${path}` };
    const file = await git([...READ, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
    if (file.code === 0) {
      await exec("sh", ["-c", 'mkdir -p "$1/info" && { grep -qxF "/.worktrees/" "$1/info/exclude" 2>/dev/null || printf "\\n/.worktrees/\\n" >> "$1/info/exclude"; }', "sh", file.stdout.trim()], { cwd: ctx.root, on: ctx.on });
    }
  }
  // Local change: a repository that sets `git config herdr.worktreeRemove '<cmd>'` removes
  // worktrees its own way (as the spaces list does): {path} and {branch} filled in, quoted,
  // run in the main checkout. The branch is deleted after, when asked.
  if (action.type === "removeWorktree" && action.custom) {
    const cmd = customRemove(action.custom, action.path, action.name);
    const r = await exec("sh", ["-c", cmd], { cwd: ctx.mainRoot ?? ctx.root, on: ctx.on, timeout: 120000 });
    if (r.code !== 0) return { ok: false, message: `The repository's remove command failed.\n\n${gitError(r)}` };
    commands.shift();
    if (commands[0]?.[0] === "branch") {
      const still = await git([...READ, "rev-parse", "--verify", "-q", `refs/heads/${action.name}`]);
      if (still.code !== 0) commands.shift(); // the command deleted the branch too
    }
  }
  // Git has no transaction spanning these commands and other terminals. This
  // preflight detects an already changed context; it cannot lock out future edits.
  let moved, failed, kept; // fast-forward all's branches, each on its own; what Remove worktree kept
  for (const [i, args] of commands.entries()) {
    const result = await (networked(args) ? remoteGit(args) : git(args));
    // Local change: the worktree is gone once its removal ran; a branch git won't delete (unmerged
    // commits), or a remote branch the push couldn't delete, is kept and said so, and the rest goes on,
    // rather than failing an action that can't run again.
    if (result.code !== 0 && action.type === "removeWorktree" && (i > 0 || action.custom)) {
      (kept ??= []).push(args[0] === "push"
        ? `Kept ${action.remote.remote}/${action.remote.branch}: the push to delete it failed.\n\n${gitError(result)}`
        : unmerged(result.stderr)
          ? `Kept the branch ${action.name}: it has commits that aren't merged anywhere. To delete it anyway, right-click it, Delete branch…, and tick "Force delete".`
          : `Kept the branch ${action.name}: git wouldn't delete it.\n\n${gitError(result)}`);
      continue;
    }
    // Fast-forward all: one branch failing doesn't stop the others; the toast says which moved and which didn't.
    if (action.type === "ffAll") {
      const name = action.list[i]?.name ?? `branch ${i + 1}`;
      (result.code === 0 ? (moved ??= []) : (failed ??= [])).push(result.code === 0 ? name : `${name}: ${gitError(result).split("\n")[0]}`);
      continue;
    }
    if (result.code !== 0) return { ok: false, message: gitError(result) };
  }
  if (kept) return { ok: true, warning: kept.join("\n\n") };
  if (failed?.length) return moved?.length
    ? { ok: true, warning: `Fast-forwarded ${moved.join(", ")}. Not: ${failed.join("; ")}` }
    : { ok: false, message: `Nothing fast-forwarded. ${failed.join("; ")}` };
  return { ok: true };
}
