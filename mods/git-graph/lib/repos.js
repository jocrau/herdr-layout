// Copied from lib/repos.js by lib/sync.mjs: edit it there, then run `node lib/sync.mjs`.
// Finding git repositories under a folder with one `find`, on this machine or another: the code folder's
// for new-space and git-graph's `R`, any folder's for git-graph's Manygit list.

// Never descended into: manygit's list, plus every hidden folder and macOS's Library (huge, and nobody
// keeps repositories there).
const PRUNE = ["node_modules", "vendor", "venv", "__pycache__", "dist", "build", "target", "site-packages", "Library"];
// Also skipped in a home folder: macOS asks for permission before anything reads them, and they hold
// documents, not repositories.
const PRUNE_HOME = ["Desktop", "Documents", "Downloads", "Movies", "Music", "Pictures", "Public", "Applications"];

// ~/Code/<repo>, <group>/<repo>, worktrees/<project>/<branch>/<repo>.
export const CODE_DEPTH = 4;
// A home folder (code_dir "~") is searched two levels down: ~/<repo> and ~/<group>/<repo>.
export const HOME_DEPTH = 2;

// A home folder, or a folder above one. home: this machine's, or null for another machine, whose usual
// places count instead: /, /root, /home/<name>, /Users/<name>.
export function isHomeOrAbove(dir, home) {
  const d = dir.replace(/[/\\]+$/, "") || "/";
  if (d === "/" || d === "/root" || /^\/(home|Users)(\/[^/]+)?$/.test(d)) return true;
  return Boolean(home) && (d === home || home.startsWith(d + "/"));
}

// find's arguments. A repository `depth` folders down has its .git one further. -H follows the folder
// itself when it's a symlink (macOS's find lists nothing under one otherwise), and no symlink below it.
// A repository whose own folder has a pruned name (`build`, `.dotfiles`) isn't found. `home`: also skip
// the home folder's document folders (see PRUNE_HOME).
export function findArgs(root, depth, { home = false } = {}) {
  const names = [...PRUNE, ...(home ? PRUNE_HOME : [])];
  return ["-H", root, "-mindepth", "1", "-maxdepth", String(depth + 1),
    "(", "-name", ".git", "-print", "-prune", ")", "-o",
    "(", "-type", "d", "(", "-name", ".*", ...names.flatMap((n) => ["-o", "-name", n]), ")", "-prune", ")"];
}

// The code folder's search: a home folder (or above) only two levels deep, without its document folders.
export function codeFindArgs(dir, home) {
  const atHome = isHomeOrAbove(dir, home);
  return findArgs(dir, atHome ? HOME_DEPTH : CODE_DEPTH, { home: atHome });
}

// The repositories in find's output (one .git per line; a worktree's .git is a file), sorted. An
// unreadable subfolder makes find exit 1, so its output counts whatever the exit code.
export function foundRepos(stdout) {
  return [...new Set(stdout.split("\n").filter((l) => /[/\\]\.git$/.test(l)).map((l) => l.replace(/[/\\]\.git$/, "")))].sort();
}
