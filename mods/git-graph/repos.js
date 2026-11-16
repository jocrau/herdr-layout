// Manygit: the repositories under a folder that isn't one itself, after
// github.com/rabeeh-ta/manygit. Pure functions, so the tests run them against
// real folders; graph.js does the exec.
import { READ } from "./git.js";
import { isHomeOrAbove, findArgs as libFindArgs } from "./lib/repos.js";

export const DEPTH = { min: 1, max: 5, default: 3 };
// A home folder, or a folder above one, isn't searched: too big to walk, and on macOS walking it asks for
// Desktop, Documents and Downloads (lib/repos.js says which). home: this machine's, or null for another.
export const unsearched = (cwd, home) => isHomeOrAbove(cwd, home);

export const depthOf = (value) => (Number.isInteger(value) && value >= DEPTH.min && value <= DEPTH.max ? value : DEPTH.default);

// One `find` walks the whole tree, on this machine or another (lib/repos.js).
export const findArgs = (root, depth) => libFindArgs(root, depthOf(depth));

// find's output (one .git per line) as repositories, grouped by the folder
// they sit in under root, as manygit does. An unreadable subfolder makes find
// exit 1, so its output counts whatever the exit code.
export function parseFound(root, stdout, max = 500) {
  const base = root.replace(/[/\\]+$/, "");
  const paths = [...new Set(stdout.split("\n").filter((l) => /[/\\]\.git$/.test(l)).map((l) => l.replace(/[/\\]\.git$/, "")))];
  return paths.filter((p) => p.startsWith(base + "/") || p.startsWith(base + "\\")).slice(0, max).map((path) => {
    const rel = path.slice(base.length + 1).replace(/\\/g, "/"), cut = rel.lastIndexOf("/");
    return { path, name: cut < 0 ? rel : rel.slice(cut + 1), group: cut < 0 ? "" : rel.slice(0, cut) };
  }).sort((a, b) => (a.group === b.group ? a.name.localeCompare(b.name) : a.group.localeCompare(b.group)));
}

// Everything a row shows, in one git call: manygit needs six to eight.
export const REPO_STATUS = [...READ, "status", "--porcelain=v2", "--branch", "-z", "--no-renames", "--untracked-files=normal"];

export function parseRepoStatus(stdout) {
  // head: HEAD's hash (null before the first commit); staged: changes already in the index.
  // gone: the upstream is configured but no longer exists (git prints no branch.ab).
  const s = { branch: null, detached: false, head: null, upstream: null, gone: false, ahead: 0, behind: 0, dirty: 0, staged: 0 };
  let counted = false;
  for (const rec of stdout.split("\0")) {
    if (!rec) continue;
    if (!rec.startsWith("# ")) { s.dirty++; if (/^[12] [^.]/.test(rec)) s.staged++; continue; }
    const [key, ...rest] = rec.slice(2).split(" "), value = rest.join(" ");
    if (key === "branch.oid") s.head = /^[0-9a-f]{40,64}$/.test(value) ? value : null;
    else if (key === "branch.head") { s.detached = value === "(detached)"; s.branch = s.detached ? null : value; }
    else if (key === "branch.upstream") s.upstream = value;
    else if (key === "branch.ab") {
      const m = /^\+(\d+) -(\d+)$/.exec(value);
      if (m) { s.ahead = +m[1]; s.behind = +m[2]; counted = true; }
    }
  }
  s.gone = Boolean(s.upstream) && !counted;
  return s;
}

// A background fetch, as manygit runs it: saved credentials and SSH's own
// configuration still work, but nothing may stop to ask for a login. Git tries
// askpass before GIT_TERMINAL_PROMPT, so an empty GIT_ASKPASS goes with it.
export const FETCH = ["GCM_INTERACTIVE=0", "GIT_TERMINAL_PROMPT=0", "GIT_ASKPASS=", "git", "fetch", "--quiet"];
// Worth fetching: a repository that has a remote, or isn't read yet.
export const fetchable = (st) => !st || st.error || Boolean(st.upstream || st.hasRemote);

// A repository's remotes and their URLs, for the row's menu (Push, the web page).
export const REMOTES = [...READ, "config", "--get-regexp", "^remote\\..*\\.url$"];
export function parseRemotes(stdout) {
  return stdout.split("\n").map((l) => /^remote\.(.+)\.url (.+)$/.exec(l.trim())).filter(Boolean).map((m) => ({ name: m[1], url: m[2] }));
}

// A remote's page in the browser: http(s) without its credentials, and ssh://
// or scp-style URLs (git@github.com:owner/repo.git) on their host, without the
// ssh port. A host must have a dot, so paths, ssh aliases and `..` have none.
const HOST = "([a-zA-Z0-9][a-zA-Z0-9-]*(?:\\.[a-zA-Z0-9-]+)+)";
export function webUrl(url) {
  const tail = "\\/(.+?)(?:\\.git)?\\/?$";
  let m = new RegExp(`^(https?):\\/\\/(?:[^/]*@)?${HOST}(:\\d+)?${tail}`).exec(url);
  if (m) return `${m[1]}://${m[2]}${m[3] ?? ""}/${m[4]}`;
  m = new RegExp(`^ssh:\\/\\/(?:[^@/]+@)?${HOST}(?::\\d+)?${tail}`).exec(url)
    ?? new RegExp(`^(?:[^@/:]+@)?${HOST}:(?!\\/)(.+?)(?:\\.git)?\\/?$`).exec(url);
  return m ? `https://${m[1]}/${m[2]}` : null;
}

// The newest tag (by creation date), as manygit's `t` shows: only read while Show tags is on.
export const LATEST_TAG = [...READ, "for-each-ref", "--count=1", "--sort=-creatordate", "--format=%(refname:short)", "refs/tags"];

// What a row says of its upstream (manygit's states; drawn in Herdr's colors).
export function syncOf(st, fetchError) {
  if (!st) return { kind: "loading", text: "…" };
  if (fetchError) return { kind: "error", text: "fetch failed" };
  if (st.error) return { kind: "error", text: "!" };
  // A detached HEAD has no branch to push: the branch column already says "detached".
  if (st.detached) return { kind: "ok", text: "" };
  if (!st.upstream) return st.hasRemote ? { kind: "unpushed", text: "!" } : { kind: "local", text: "no remote" };
  if (st.gone) return { kind: "gone", text: "upstream gone" };
  if (st.ahead && st.behind) return { kind: "diverged", text: `↑${st.ahead} ↓${st.behind}` };
  if (st.ahead) return { kind: "ahead", text: `↑${st.ahead}` };
  if (st.behind) return { kind: "behind", text: `↓${st.behind}` };
  return { kind: "ok", text: "✓" };
}
