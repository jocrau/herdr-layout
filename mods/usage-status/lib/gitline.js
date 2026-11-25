// Copied from lib/gitline.js by lib/sync.mjs: edit it there, then run `node lib/sync.mjs`.
// The status bar's git line (usage-status): where the focused terminal is, from git's own answers. Pure, for tests.

// `git status --porcelain=v2 --branch` → { head, branch, upstream, ahead, behind, gone, dirty, staged }. branch null
// when detached; upstream null when the branch was never pushed; gone when its upstream no longer exists (deleted after
// a merge); staged: changes in the index (a conflict isn't one).
export function parseStatus(out) {
  const s = { head: null, branch: null, upstream: null, ahead: 0, behind: 0, gone: false, dirty: 0, staged: 0 };
  for (const line of String(out ?? "").split("\n")) {
    if (!line) continue;
    if (line.startsWith("# branch.oid ")) { const o = line.slice(13); s.head = /^[0-9a-f]{7,}$/.test(o) ? o : null; }
    else if (line.startsWith("# branch.head ")) { const b = line.slice(14); s.branch = b === "(detached)" ? null : b; }
    else if (line.startsWith("# branch.upstream ")) { s.upstream = line.slice(18); s.gone = true; }
    else if (line.startsWith("# branch.ab ")) {
      s.gone = false;
      const [a, b] = line.slice(12).split(" ");
      s.ahead = Math.abs(parseInt(a, 10)) || 0;
      s.behind = Math.abs(parseInt(b, 10)) || 0;
    } else if (!line.startsWith("#")) { s.dirty++; if (/^[12] [^.]/.test(line)) s.staged++; }
  }
  return s;
}

// A remote's URL → "owner/repo" (GitHub's ssh and https forms), or null.
export function slugOf(url) {
  const m = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(url ?? "").trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

// The repository's name: its main checkout's folder (a worktree reads as its repository, as in the spaces list).
// `common`: `git rev-parse --git-common-dir`, absolute.
export function repoName(common) {
  const c = String(common ?? "").trim().replace(/\/+$/, "");
  const dir = c.endsWith("/.git") ? c.slice(0, -5) : c.replace(/\.git$/, "");
  return dir.split("/").pop() || null;
}

// What to say about pushing and pulling: [{ text, tone, tip }], tone "push" | "pull" | "quiet".
export function syncMarks(s) {
  if (!s?.branch) return [];
  if (!s.upstream) return [{ text: "not pushed", tone: "quiet", tip: `${s.branch} has no upstream yet: push it to share it` }];
  if (s.gone) return [{ text: "upstream gone", tone: "quiet", tip: `${s.upstream} no longer exists (deleted after a merge?)` }];
  const n = (k, w) => `${k} commit${k === 1 ? "" : "s"} ${w}`;
  return [
    s.ahead ? { text: `↑${s.ahead}`, tone: "push", tip: `${n(s.ahead, "to push")} to ${s.upstream}` } : null,
    s.behind ? { text: `↓${s.behind}`, tone: "pull", tip: `${n(s.behind, "behind")} ${s.upstream} (as of the last fetch): pull` } : null,
  ].filter(Boolean);
}

// The right-click menu on the status bar's branch: the git view's own repository menu (git-graph's popup, role
// "menu": pull, push and fetch first as fit, commit/stash when there are changes, copy, open on GitHub), whose
// actions ask in its dialogs and run without the git view open; first, Open in git view. → overlay props and the popup's height, as
// git-graph's menuHeight counts it (10 + 30 an item + 9 a separator). `remotes`: `git remote` names.
export function repoMenuProps(g, remotes, { root, on = null } = {}) {
  if (!g || !root) return null;
  const remote = remotes.length > 0, web = g.slug ? `https://github.com/${g.slug}` : null;
  const target = { kind: "repo", path: root, status: { branch: g.branch, upstream: g.upstream, gone: g.gone, ahead: g.ahead, behind: g.behind, dirty: g.dirty, staged: g.staged }, agents: [], web, gitView: true };
  const ctx = { root, on, current: g.branch, head: g.head, branches: [], remotes };
  const sections = [2, [remote && g.upstream && !g.gone, remote && g.branch, remote].filter(Boolean).length, g.dirty > 0 ? 3 : 0, 1 + (web ? 1 : 0) + (g.branch ? 1 : 0)].filter((n) => n > 0);
  const height = 10 + 30 * sections.reduce((a, b) => a + b, 0) + 9 * (sections.length - 1);
  return { target, ctx, height };
}
