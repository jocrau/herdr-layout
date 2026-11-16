// Removing a worktree and its branch, the same way from git-graph and the spaces list (worktree-support).
//
// The branch: `git branch -d`, which keeps a branch with commits merged nowhere, unless the dialog that
// asked said those commits are lost (`force`); then -D. A repository may remove worktrees its own way:
// `git config herdr.worktreeRemove '<cmd>'`, run by sh in the main checkout with {path} and {branch}
// filled in, quoted.

export const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// The repository's own remove command, filled in.
export function customRemove(cmd, path, branch) {
  return cmd.replaceAll("{path}", quote(path)).replaceAll("{branch}", quote(branch));
}

// git's arguments: removing the worktree (`force`: even with uncommitted changes) and deleting a branch.
export const removeWorktreeArgs = (path, force = false) => ["worktree", "remove", ...(force ? ["--force"] : []), path];
export const deleteBranchArgs = (name, force = false) => ["branch", force ? "-D" : "-d", name];

// git's refusal to delete a branch whose commits are merged nowhere.
export const unmerged = (stderr) => /not fully merged/.test(stderr ?? "");
