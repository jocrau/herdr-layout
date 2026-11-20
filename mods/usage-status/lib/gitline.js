// Copied from lib/gitline.js by lib/sync.mjs: edit it there, then run `node lib/sync.mjs`.
// The status bar's git line (usage-status): where the focused terminal is, from git's own answers. Pure, for tests.

// `git status --porcelain=v2 --branch` → { branch, upstream, ahead, behind, gone, dirty }. branch null when detached;
// upstream null when the branch was never pushed; gone when its upstream no longer exists (deleted after a merge).
export function parseStatus(out) {
  const s = { branch: null, upstream: null, ahead: 0, behind: 0, gone: false, dirty: 0 };
  for (const line of String(out ?? "").split("\n")) {
    if (!line) continue;
    if (line.startsWith("# branch.head ")) { const b = line.slice(14); s.branch = b === "(detached)" ? null : b; }
    else if (line.startsWith("# branch.upstream ")) { s.upstream = line.slice(18); s.gone = true; }
    else if (line.startsWith("# branch.ab ")) {
      s.gone = false;
      const [a, b] = line.slice(12).split(" ");
      s.ahead = Math.abs(parseInt(a, 10)) || 0;
      s.behind = Math.abs(parseInt(b, 10)) || 0;
    } else if (!line.startsWith("#")) s.dirty++;
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
