// Modified by Jochen Rau, 2026-11, from rabeeh-ta/herdr-git-graph: see NOTICE.md in this folder.
// Git for the graph, with no herdr imports so node can test it: reading the
// history, the labels on each row and where they sit, and the actions behind
// the menus. Commands are argv arrays, never a shell line.

import { removeWorktreeArgs, deleteBranchArgs } from "./lib/worktree.js";

// Reads write nothing under .git (no index refresh or lock, no fsmonitor
// cookie), so the folder watch never wakes for the panel's own reads.
// core.quotePath=false: a path like été.txt comes back as itself, not as "\303\251t\303\251.txt", so the
// review, o, d and v find the file and the +/- counts match the status list.
export const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false", "-c", "core.quotePath=false"];
export const STATUS = ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"];
export const UNCOMMITTED = "*";
// Git's pretty fields are NUL-free strings; -z terminates each seven-field record.
const FORMAT = "%H%x00%P%x00%an%x00%ae%x00%at%x00%D%x00%s";
const objectId = (s) => typeof s === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(s);
const refName = (s) => typeof s === "string" && s.length > 0 && !/^[-/]/.test(s)
  && !/[\x00-\x20\x7f~^:?*\[\\]/.test(s) && !s.includes("..") && !s.includes("@{")
  && s !== "@" && !s.endsWith(".") && s.split("/").every((p) => p && !p.startsWith(".") && !p.endsWith(".lock"));

function checkCommit(commit) {
  if (!objectId(commit?.hash) || !Array.isArray(commit.parents) || !commit.parents.every(objectId)) {
    throw new Error("Invalid commit identity");
  }
}

export function logArgs({ all, remotes, limit, dateOrder = false, revs = null }) {
  // All branches walks local branches, tags, remote branches (with Remotes) and HEAD, as other Git tools do.
  // Not `--all`: it also walks the private refs of other tools, such as the per-turn checkpoints of
  // T3 Code (refs/t3/checkpoints/*), which have no label and show up as orphan commits.
  // `--ignore-missing` keeps a repository with no commits (no HEAD yet) an empty log.
  // Local change: `revs` (the PR view: the PR's head and its base branch) reads only those.
  const scope = revs?.length ? ["--ignore-missing", ...revs] : all ? ["--branches", "--tags", ...(remotes ? ["--remotes"] : []), "--ignore-missing", "HEAD"] : ["HEAD"];
  // --date-order sorts the whole history before printing the first line (0.6 s on a repository of 78,000
  // commits without a commit-graph); git's own order prints at once and differs only where a clock was wrong.
  return ["log", "-z", ...scope, ...(dateOrder ? ["--date-order"] : []), "--decorate=full", `-n${limit}`, `--format=${FORMAT}`];
}

// What --date-order adds to git's own order, for the commits read: no commit before its children
// (a clock set wrong can put a parent ahead of a child), otherwise as git listed them.
// The same array back when git's order needed nothing.
export function childrenFirst(commits) {
  const at = new Map(commits.map((c, i) => [c.hash, i]));
  const waiting = new Array(commits.length).fill(0); // children still to show, per commit
  for (const c of commits) for (const p of new Set(c.parents)) { const j = at.get(p); if (j !== undefined) waiting[j]++; }
  // Ready commits by their place in git's list: a small heap keeps it n log n.
  const heap = [], push = (i) => { heap.push(i); let k = heap.length - 1; while (k && heap[(k - 1) >> 1] > heap[k]) { [heap[k], heap[(k - 1) >> 1]] = [heap[(k - 1) >> 1], heap[k]]; k = (k - 1) >> 1; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l] < heap[m]) m = l; if (r < heap.length && heap[r] < heap[m]) m = r; if (m === k) break; [heap[k], heap[m]] = [heap[m], heap[k]]; k = m; } } return top; };
  commits.forEach((_, i) => { if (!waiting[i]) push(i); });
  const out = [];
  while (heap.length) {
    const c = commits[pop()]; out.push(c);
    for (const p of new Set(c.parents)) { const j = at.get(p); if (j !== undefined && --waiting[j] === 0) push(j); }
  }
  // A cycle can't happen in git; keep git's order if it does.
  return out.length === commits.length && out.some((c, i) => c !== commits[i]) ? out : commits;
}

// `git rev-parse --show-toplevel --path-format=absolute --git-common-dir HEAD --symbolic-full-name HEAD --`:
// four questions in one process. A repository with no commits stops after the first two lines.
export function parseRevParse(text) {
  const [root, common, head, full] = text.split("\n");
  if (!root) return null;
  return { root, common: common ?? "", head: objectId(head) ? head : null,
    current: objectId(head) && full?.startsWith("refs/heads/") ? full.slice(11) : null, unborn: !objectId(head) };
}
export const REV_PARSE = ["rev-parse", "--show-toplevel", "--path-format=absolute", "--git-common-dir", "HEAD", "--symbolic-full-name", "HEAD", "--"];

export function parseRefs(text) {
  const refs = [];
  for (let name of text ? text.split(", ") : []) {
    const head = name.startsWith("HEAD -> ");
    if (head) name = name.slice(8);
    if (name === "HEAD") refs.push({ kind: "detached", name: "HEAD" });
    else if (name.startsWith("refs/heads/") && refName(name.slice(11))) refs.push({ kind: "branch", name: name.slice(11), head });
    else if (name.startsWith("tag: refs/tags/") && refName(name.slice(15))) refs.push({ kind: "tag", name: name.slice(15) });
    else if (name.startsWith("refs/remotes/") && !name.endsWith("/HEAD") && refName(name.slice(13))) refs.push({ kind: "remote", name: name.slice(13) });
  }
  return refs;
}

export function parseLog(text) {
  if (!text) return [];
  const fields = text.split("\0");
  if (fields.pop() !== "" || fields.length % 7 !== 0) throw new Error("Invalid history framing");
  const commits = [];
  for (let i = 0; i < fields.length; i += 7) {
    const [hash, parents, author, email, time, refs, subject] = fields.slice(i, i + 7);
    const parsed = parseRefs(refs);
    const commit = { hash, parents: parents ? parents.split(" ") : [], author, email, time: Number(time), refs: parsed, subject,
      head: parsed.some((r) => r.head || r.kind === "detached") };
    checkCommit(commit);
    if (!/^\d+$/.test(time) || !Number.isSafeInteger(commit.time)) throw new Error("Invalid commit time");
    commits.push(commit);
  }
  return commits;
}

// `git status --porcelain=v1 -z --no-renames`: one NUL-terminated "XY path" per file.
export function parseStatus(text) {
  return text.split("\0").filter(Boolean).map((entry) => {
    const xy = entry.slice(0, 2), path = entry.slice(3);
    const status = xy === "??" ? "A" : xy.includes("U") || xy === "AA" || xy === "DD" ? "U" : xy.includes("D") ? "D" : xy.includes("A") ? "A" : "M";
    // staged: the index differs from HEAD (conflicts aren't staged changes).
    return { path, status, untracked: xy === "??", staged: status !== "U" && xy[0] !== " " && xy[0] !== "?" };
  });
}

// The working tree's changes as the newest row, drawn dashed to HEAD.
export function withUncommitted(commits, changes, head) {
  if (!changes) return commits;
  return [{ hash: UNCOMMITTED, parents: head ? [head] : [], uncommitted: true, dashed: true, refs: [], head: false,
    subject: `Uncommitted changes (${changes})`, author: "", email: "", time: null }, ...commits];
}

// Labels are drawn at these exact widths (monospace text, fixed padding and
// icon), so a press can be matched to the label under it: a virtual list's
// rows can't hold their own handlers.
export const LABEL = { CHAR: 6.6, PAD: 5, ICON: 13, GAP: 6, MAX: 30, FONT: 11 };
const fit = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
// Local change: ref names lose their middle, not their end: branches often share a long
// prefix (team/project-…) and differ only at the end. The first path part stays when it's
// short (origin/, feature/), and the end starts at a word when one is near.
// "origin/feat/x" as { remote: "origin", branch: "feat/x" }: the remote is matched against the known ones (longest
// first), so a remote named "team/eu" isn't split at its first slash; unknown, at the first slash.
export function splitRemote(name, remotes = []) {
  const known = [...remotes].sort((a, b) => b.length - a.length).find((r) => name.startsWith(`${r}/`));
  if (known) return { remote: known, branch: name.slice(known.length + 1) };
  const slash = name.indexOf("/");
  return { remote: name.slice(0, slash), branch: name.slice(slash + 1) };
}

export function fitRef(s, n = LABEL.MAX) {
  if (s.length <= n) return s;
  const slash = s.indexOf("/");
  const head = slash > 0 && slash < n / 2 ? slash + 1 : Math.ceil(n / 4);
  let tail = s.slice(s.length - (n - 1 - head));
  const word = tail.slice(0, 5).search(/[-_/.]/);
  if (word >= 0 && tail.length - word - 1 >= 8) tail = tail.slice(word + 1);
  return s.slice(0, head) + "…" + tail;
}
const partWidth = (part) => Math.ceil(LABEL.PAD * 2 + (part.icon ? LABEL.ICON : 0) + part.text.length * LABEL.CHAR) + 1;

// worktrees: branch → the other folder it's checked out in (its label shows a folder).
export function labelsOf(commit, remotesShown = true, worktrees = {}) {
  const labels = [], remotes = remotesShown ? commit.refs.filter((r) => r.kind === "remote") : [], paired = new Set();
  for (const ref of commit.refs) {
    if (ref.kind === "detached") labels.push({ kind: "head", head: true, parts: [{ kind: "head", name: "HEAD", text: "HEAD" }] });
    if (ref.kind !== "branch") continue;
    // A remote branch with the same name rides on its local branch's label, as in Git Graph.
    const parts = [{ kind: "branch", name: ref.name, text: fitRef(ref.name), icon: true, head: ref.head, worktree: ref.head ? null : worktrees[ref.name] ?? null }];
    for (const remote of remotes) {
      const slash = remote.name.indexOf("/");
      if (remote.name.slice(slash + 1) !== ref.name || paired.has(remote.name)) continue;
      paired.add(remote.name);
      parts.push({ kind: "remote", name: remote.name, text: fit(remote.name.slice(0, slash), 12) });
    }
    labels.push({ kind: "branch", head: ref.head, parts });
  }
  for (const remote of remotes) if (!paired.has(remote.name)) labels.push({ kind: "remote", parts: [{ kind: "remote", name: remote.name, text: fitRef(remote.name), icon: true }] });
  for (const ref of commit.refs) if (ref.kind === "tag") labels.push({ kind: "tag", parts: [{ kind: "tag", name: ref.name, text: fitRef(ref.name), icon: true }] });
  // What's checked out comes first.
  labels.sort((a, b) => Number(Boolean(b.head)) - Number(Boolean(a.head)));
  for (const label of labels) {
    for (const part of label.parts) part.width = partWidth(part);
    label.width = label.parts.reduce((n, p) => n + p.width, 2); // + a 1 px border each side
  }
  return labels;
}

// The label part at `x` in a row whose labels start after a `start`-wide graph
// and are cut off at `limit` (the description column's right edge).
export function hitLabel(labels, x, start, limit = Infinity) {
  if (x >= limit) return null;
  let left = start;
  for (const label of labels ?? []) {
    left += LABEL.GAP;
    if (x >= left && x < left + label.width) {
      let at = left + 1;
      for (const part of label.parts) {
        if (x < at + part.width) return { label, part };
        at += part.width;
      }
      return { label, part: label.parts[label.parts.length - 1] };
    }
    left += label.width;
  }
  return null;
}

const shortHash = (hash) => hash.slice(0, 8);
// Local change: branch tracking for fast-forward and push.
// `for-each-ref --format=%(refname)%00%(upstream)%00%(upstream:track)%00%(upstream:short)%00%(worktreepath) refs/heads`
// Local change: worktreepath: the folder a branch is checked out in, main checkout or linked worktree.
export const BRANCHES = ["for-each-ref", "--format=%(refname)%00%(upstream)%00%(upstream:track)%00%(upstream:short)%00%(worktreepath)", "refs/heads"];
export function parseBranches(text, root = null) {
  const names = [], tracking = {}, worktrees = {};
  for (const line of text.split("\n").filter(Boolean)) {
    const [ref, upstream, track = "", short = "", worktree = ""] = line.split("\0");
    if (!ref?.startsWith("refs/heads/")) continue;
    const name = ref.slice(11);
    names.push(name);
    // Only the ones checked out somewhere else: git won't check them out here too.
    if (worktree.startsWith("/") && worktree !== root) worktrees[name] = worktree;
    if (upstream) tracking[name] = { upstream, short, gone: track.includes("gone"),
      ahead: Number(track.match(/ahead (\d+)/)?.[1] ?? 0), behind: Number(track.match(/behind (\d+)/)?.[1] ?? 0) };
  }
  return { names, tracking, worktrees };
}
// Branches that only lack their upstream's commits: a fast-forward brings them level.
// One checked out in another worktree is left to its menu: someone, an agent perhaps, works there.
export const fastForwardable = (ctx) => Object.entries(ctx.tracking ?? {})
  .filter(([name, t]) => t.behind > 0 && !t.ahead && !t.gone && !ctx.worktrees?.[name])
  .map(([name, t]) => ({ name, upstream: t.upstream, short: t.short, current: name === ctx.current }));
const remoteRef = (s) => typeof s === "string" && s.startsWith("refs/remotes/") && refName(s.slice(13));
// The current branch merges --ff-only; another is updated with a local fetch, which refuses anything but a fast-forward.
// One checked out in another worktree merges there, as git refuses to move it from here.
const ffCommand = (b) => b.current ? ["merge", "--ff-only", b.upstream]
  : b.worktree ? ["-C", b.worktree, "merge", "--ff-only", b.upstream] : ["fetch", ".", `${b.upstream}:refs/heads/${b.name}`];
const currentName = (ctx) => ctx.current ?? "HEAD";
// The other folder a branch is checked out in, or null.
export const worktreeOf = (ctx, name) => {
  const path = ctx.worktrees?.[name];
  return typeof path === "string" && path.startsWith("/") && !path.includes("\0") ? path : null;
};
const folderName = (path) => path.split("/").filter(Boolean).pop();
// Local change: where a new worktree for a branch goes: <main checkout>/.worktrees/<branch>,
// slashes as dashes ("feat/csv" → .worktrees/feat-csv). Kept out of git status by info/exclude.
export const WORKTREES = ".worktrees";
export const worktreePath = (ctx, branch) => `${ctx.mainRoot ?? ctx.root}/${WORKTREES}/${branch.replaceAll("/", "-")}`;
// Here, or in a new worktree: the choice every checkout and new branch offers.
const whereChoice = (value, extra = []) => ({ id: "where", label: "Where", value, options: [...extra,
  { value: "here", label: "Here", detail: "Switch this folder to it" },
  { value: "worktree", label: "New worktree", detail: `${WORKTREES}/<branch>, opened in a tab here` }] });
// The worktree an action makes, as { path, branch }, or null.
export function createdWorktree(a, v = {}, ctx = {}) {
  if (v.where !== "worktree") return null;
  const branch = a.type === "checkout" ? a.name : String(v.name ?? "").trim();
  return ["checkout", "checkoutRemote", "createBranch"].includes(a.type) && branch ? { path: worktreePath(ctx, branch), branch } : null;
}
const section = (...items) => items.filter(Boolean);
const item = (label, icon, action) => ({ label, icon, action });

// The right-click menu for a commit, a label part or the uncommitted row:
// Git Graph's menus, minus what needs VS Code. Sections are separated.
export function menuFor(target, ctx) {
  if (target.kind === "repo") return repoMenu(target, ctx);
  const cur = currentName(ctx), c = target.commit;
  let sections;
  if (target.kind === "uncommitted") {
    sections = [
      section(item("Commit…", "commit", { type: "commit", staged: Boolean(target.staged) })),
      section(item("Stash uncommitted changes…", "stash", { type: "stash" })),
      section(item("Reset uncommitted changes…", "reset", { type: "resetUncommitted" })),
      section(item("Show in Changes panel", "mods/changes/changes.svg", { type: "showChanges" })),
    ];
  } else if (target.kind === "branch") {
    const name = target.name, current = name === ctx.current, wt = worktreeOf(ctx, name);
    sections = [
      // Checked out in another worktree: go there; git won't check it out here or delete it.
      section(wt && item(`Open its worktree here (${folderName(wt)})`, "folder", { type: "goWorktree", name, path: wt }),
        !current && !wt && item("Checkout branch…", "branch", { type: "checkout", name }),
        item("Rename branch…", "rename", { type: "renameBranch", name }),
        !current && !wt && item("Delete branch…", "trash", { type: "deleteBranch", name })),
      section(!current && item(`Merge into ${cur}…`, "merge", { type: "merge", ref: name, what: `branch ${name}` }),
        !current && item(`Rebase ${cur} on this branch…`, "rebase", { type: "rebase", ref: name, what: `branch ${name}` })),
      section((() => {
        const tr = ctx.tracking?.[name];
        return tr && tr.behind > 0 && !tr.ahead && !tr.gone && item(`Fast-forward to ${tr.short}${wt ? " (in its worktree)" : ""}`, "fetch", { type: "ffBranch", name, upstream: tr.upstream, short: tr.short, current });
      })(),
        current && ctx.tracking?.[name] && !ctx.tracking[name].gone && ctx.tracking[name].ahead > 0 && item(`Push to ${ctx.tracking[name].short}…`, "push", { type: "pushCurrent", name, short: ctx.tracking[name].short }),
        ctx.remotes.length > 0 && item("Push branch…", "push", { type: "push", name })),
      section(item("Copy branch name", "copy", { type: "copy", text: name }),
        wt && item("Copy worktree path", "copy", { type: "copy", text: wt })),
      // Never the main checkout (seen from a linked worktree, its branch has a worktree path too).
      section(wt && wt !== ctx.mainRoot && item("Remove worktree…", "trash", { type: "removeWorktree", name, path: wt })),
    ];
  } else if (target.kind === "remote") {
    const name = target.name, { remote, branch } = splitRemote(name, ctx.remotes);
    const local = ctx.branches.includes(branch), wt = local && worktreeOf(ctx, branch);
    sections = [
      section(branch !== ctx.current && (wt ? item(`Open ${branch}'s worktree here`, "folder", { type: "goWorktree", name: branch, path: wt })
        : local ? item(`Checkout ${branch}…`, "branch", { type: "checkout", name: branch })
        : item("Checkout branch…", "branch", { type: "checkoutRemote", name, remote, branch }))),
      section(item(`Merge into ${cur}…`, "merge", { type: "merge", ref: name, what: `remote branch ${name}` })),
      section(item("Delete remote branch…", "trash", { type: "deleteRemoteBranch", name, remote, branch })),
      section(item("Copy branch name", "copy", { type: "copy", text: name })),
    ];
  } else if (target.kind === "tag") {
    const name = target.name;
    sections = [
      section(item("Delete tag…", "trash", { type: "deleteTag", name })),
      section(ctx.remotes.length > 0 && item("Push tag…", "push", { type: "pushTag", name })),
      section(item("Copy tag name", "copy", { type: "copy", text: name })),
    ];
  } else {
    const hash = c.hash, short = shortHash(hash), here = hash === ctx.head, merge = c.parents.length > 1;
    sections = [
      section(item("Add tag…", "tag", { type: "addTag", hash, short }),
        item("Create branch…", "plus", { type: "createBranch", hash, short })),
      section(!here && item("Checkout…", "commit", { type: "checkoutCommit", hash, short }),
        !here && item("Cherry pick…", "cherry", { type: "cherryPick", hash, short, merge }),
        item("Revert…", "revert", { type: "revert", hash, short, merge })),
      section(!here && item(`Merge into ${cur}…`, "merge", { type: "merge", ref: hash, what: `commit ${short}` }),
        !here && item(`Rebase ${cur} on this commit…`, "rebase", { type: "rebase", ref: hash, what: `commit ${short}` }),
        item(`Reset ${cur} to this commit…`, "reset", { type: "reset", hash, short }),
        // As Fork does: move another local branch here (only its pointer; no working tree is touched).
        movable(ctx).length > 0 && item("Reset a branch to this commit…", "reset", { type: "resetBranch", hash, short })),
      section(item("Copy commit hash", "copy", { type: "copy", text: hash }),
        item("Copy commit subject", "copy", { type: "copy", text: c.subject })),
    ];
  }
  const out = [];
  for (const s of sections.filter((s) => s.length)) { if (out.length) out.push({ separator: true }); out.push(...s); }
  return out;
}

export const menuHeight = (items) => 10 + items.reduce((n, i) => n + (i.separator ? 9 : 30), 0);

// Local branches a commit can be reset to without touching a working tree: not the current one (that's
// "Reset <current> to this commit") and not one checked out in another worktree.
const movable = (ctx) => (ctx.branches ?? []).filter((b) => b !== ctx.current && !worktreeOf(ctx, b));
const remoteChoice = (ctx) => ({ id: "remote", label: "Remote", value: ctx.remotes.includes("origin") ? "origin" : ctx.remotes[0],
  options: ctx.remotes.map((r) => ({ value: r, label: r })) });
const mergeNote = (a) => (a.merge ? " It's a merge commit: its changes against its first parent are used." : "");

// The dialog an action asks first, or null when it runs at once.
// A Manygit row's menu. Herdr's own first: an agent's tab (most picked first, as
// its + menu) or a terminal in the repository. Then what the row's ↑/↓ asks for,
// its uncommitted changes, and its links.
function repoMenu(r, ctx) {
  const st = r.status ?? {}, branch = st.branch, remote = ctx.remotes.length > 0;
  const pull = remote && st.upstream && !st.gone && item("Pull…", "fetch", { type: "pull", upstream: st.upstream });
  const push = remote && branch && item(st.upstream ? "Push…" : "Push and set upstream…", "push", { type: "push", name: branch });
  const fetch = remote && item("Fetch", "refresh", { type: "fetch" });
  const sync = st.behind && !st.ahead ? [pull, fetch, push] : st.ahead && !st.behind ? [push, fetch, pull]
    : !st.upstream ? [push, fetch] : [fetch, pull, push];
  return [
    [...r.agents.slice(0, 3).map((a) => ({ ...item(`New ${a.name} tab`, a.icon ?? "plus", { type: "newTab", folder: r.path, name: a.name, argv: a.run }), image: Boolean(a.icon) && !a.tint })),
      item("New terminal tab", "plus", { type: "newTab", folder: r.path })],
    section(...sync),
    st.dirty > 0 ? section(item("Commit…", "commit", { type: "commit", staged: st.staged > 0 }),
      item("Stash uncommitted changes…", "stash", { type: "stash" }),
      item("Reset uncommitted changes…", "reset", { type: "resetUncommitted" })) : [],
    section(r.web && item(`Open on ${r.web.split("/")[2]}`, "cloud", { type: "openUrl", url: r.web }),
      item("Copy path", "copy", { type: "copy", text: r.path }),
      branch && item("Copy branch name", "copy", { type: "copy", text: branch })),
  ].filter((s) => s.length).flatMap((s, i) => (i ? [{ separator: true }, ...s] : s));
}

export function dialogFor(action, ctx) {
  const cur = currentName(ctx), a = action;
  switch (a.type) {
    case "checkout": return { title: "Checkout branch", detail: `Check out ${a.name}.`, choice: whereChoice("here"), confirm: "Checkout" };
    case "checkoutRemote": return { title: "Checkout remote branch", detail: `Create a local branch that tracks ${a.name}, and check it out.`,
      inputs: [{ id: "name", label: "Local branch name", value: a.branch }], choice: whereChoice("here"), confirm: "Checkout" };
    case "removeWorktree": return { title: "Remove worktree", detail: `Remove the worktree ${a.path}, where ${a.name} is checked out?${a.custom ? ` The repository's own remove command does it (${a.custom}).` : ""}${a.open ? " A space or tab is open there: close it first, or its terminals are left in a deleted folder." : ""}`,
      checks: [...(a.custom ? [] : [{ id: "force", label: "Even with uncommitted changes (they're lost)", value: false }]),
        { id: "branch", label: `Delete the branch ${a.name} too (kept if it has unmerged commits)`, value: false },
        // As the spaces list's clean-up: an unmerged branch goes only when the dialog said its commits are lost.
        { id: "branchForce", label: "Delete it even if it isn't merged (its unmerged commits are lost)", value: false }],
      confirm: "Remove", danger: true };
    case "checkoutCommit": return { title: "Checkout commit", detail: `Check out commit ${a.short}? You'll be on a detached HEAD: new commits belong to no branch until you create one.`, confirm: "Checkout" };
    case "createBranch": return { title: "New branch", detail: `At commit ${a.short}.`,
      inputs: [{ id: "name", label: "Branch name", value: "" }],
      choice: whereChoice("here", [{ value: "none", label: "Just create it", detail: "Stay where you are" }]), confirm: "Create" };
    case "addTag": return { title: "Add tag", detail: `At commit ${a.short}.`,
      inputs: [{ id: "name", label: "Tag name", value: "" }, { id: "message", label: "Message (makes an annotated tag)", value: "", optional: true }], confirm: "Add tag" };
    case "renameBranch": return { title: "Rename branch", detail: `Rename ${a.name}.`, inputs: [{ id: "name", label: "New name", value: a.name }], confirm: "Rename" };
    case "deleteBranch": return { title: "Delete branch", detail: `Delete the local branch ${a.name}?`,
      checks: [{ id: "force", label: "Force delete, even if it isn't merged", value: false }], confirm: "Delete", danger: true };
    case "deleteRemoteBranch": return { title: "Delete remote branch", detail: `Delete ${a.branch} on ${a.remote}? This changes the remote for everyone who uses it.`, confirm: "Delete", danger: true };
    case "deleteTag": return { title: "Delete tag", detail: `Delete the local tag ${a.name}?`, confirm: "Delete", danger: true };
    case "merge": return { title: "Merge", detail: `Merge ${a.what} into ${cur}?`,
      checks: [{ id: "noff", label: "Create a merge commit, even when it could fast-forward", value: true }], confirm: "Merge" };
    case "rebase": return { title: "Rebase", detail: `Rebase ${cur} on ${a.what}?`, confirm: "Rebase" };
    case "cherryPick": return { title: "Cherry pick", detail: `Apply commit ${a.short} on top of ${cur}?${mergeNote(a)}`, confirm: "Cherry pick" };
    case "revert": return { title: "Revert", detail: `Add a commit to ${cur} that undoes ${a.short}?${mergeNote(a)}`, confirm: "Revert" };
    case "resetBranch": return { title: "Reset a branch", confirm: "Reset branch", danger: true,
      detail: `Move the branch you pick to commit ${a.short}. Only the branch moves; no files change. Commits that were only on that branch after this one are no longer on any branch (git's reflog still has them for a while).`,
      choice: { id: "branch", label: "Branch", value: movable(ctx)[0], options: movable(ctx).map((b) => ({ value: b, label: b })) } };
    case "reset": return { title: "Reset", detail: `Move ${cur} to commit ${a.short}.`, confirm: "Reset",
      choice: { id: "mode", label: "Mode", value: "mixed", options: [
        { value: "soft", label: "Soft", detail: "Keep every change, staged" },
        { value: "mixed", label: "Mixed", detail: "Keep every change, unstaged" },
        { value: "hard", label: "Hard", detail: "Discard every change", danger: true }] } };
    case "push": return { title: "Push branch", detail: `Push ${a.name}.`, choice: remoteChoice(ctx),
      checks: [{ id: "upstream", label: "Set as upstream", value: true }], confirm: "Push" };
    case "pushTag": return { title: "Push tag", detail: `Push the tag ${a.name}.`, choice: remoteChoice(ctx), confirm: "Push" };
    case "commit": return { title: "Commit", detail: ctx.current ? `Commit to ${ctx.current}.` : "You're on a detached HEAD: the commit belongs to no branch until you create one.",
      inputs: [{ id: "message", label: "Message", value: "", text: true }],
      // With changes already staged, commit just those unless the person ticks this.
      checks: [{ id: "all", label: "Stage every change first (untracked too)", value: !a.staged }], confirm: "Commit" };
    case "pushCurrent": return { title: "Push", detail: `Push ${a.name} to ${a.short ?? "its upstream"}?`, confirm: "Push" };
    case "pull": return { title: "Pull", detail: `Fast-forward ${cur} to ${a.upstream}? A pull that can't fast-forward changes nothing.`, confirm: "Pull" };
    case "stash": return { title: "Stash uncommitted changes", inputs: [{ id: "message", label: "Message", value: "", optional: true }],
      checks: [{ id: "untracked", label: "Include untracked files", value: true }], confirm: "Stash" };
    case "resetUncommitted": return { title: "Reset uncommitted changes", detail: "Reset the working tree to HEAD.", confirm: "Reset",
      choice: { id: "mode", label: "Mode", value: "mixed", options: [
        { value: "mixed", label: "Mixed", detail: "Unstage everything, keep the changes" },
        { value: "hard", label: "Hard", detail: "Discard every change to tracked files", danger: true }] } };
    // One file of the uncommitted changes, from the review (`r`).
    case "resetFile": return { title: "Reset file", detail: a.path, confirm: a.untracked ? "Delete" : "Reset",
      choice: { id: "mode", label: "Mode", value: a.staged ? "unstage" : "discard", options: [
        ...(a.staged ? [{ value: "unstage", label: "Unstage", detail: "Keep the change, unstaged" }] : []),
        a.untracked ? { value: "discard", label: "Delete", detail: "Delete this untracked file", danger: true }
          : a.status === "A" ? { value: "discard", label: "Discard", detail: "Delete this new file", danger: true }
          : { value: "discard", label: "Discard", detail: "Back to HEAD's version", danger: true }] } };
    default: return null;
  }
}

// Local change: wider (460) dialogs; long tick labels wrap; room for a two-line error.
export const DIALOG_WIDTH = 460;
export function dialogHeight(spec) {
  const lines = (text, per) => Math.ceil(text.length / per);
  const detail = spec.detail ? lines(spec.detail, 56) * 19 + 8 : 0;
  const checks = (spec.checks ?? []).reduce((n, c) => n + 16 + lines(c.label, 50) * 19, 0);
  return Math.ceil(36 + 26 + detail + (spec.inputs ?? []).length * 66 + checks
    + (spec.choice ? 24 + spec.choice.options.length * 42 : 0) + 30 + 52 + 44);
}

const values = (spec) => {
  const v = {};
  for (const i of spec?.inputs ?? []) v[i.id] = i.value ?? "";
  for (const c of spec?.checks ?? []) v[c.id] = c.value;
  if (spec?.choice) v[spec.choice.id] = spec.choice.value;
  return v;
};
export const initialValues = (action, ctx) => values(dialogFor(action, ctx));

// What's wrong with the typed values, or null. A name never reaches git as an option.
export function validate(action, v, ctx) {
  const spec = dialogFor(action, ctx);
  for (const input of spec?.inputs ?? []) {
    const text = String(v[input.id] ?? "").trim();
    if (input.optional) continue;
    if (!text) return `${input.label} is empty.`;
    if (input.text) continue; // free text, passed as one argument after its option
    if (text.startsWith("-") || /\s/.test(text)) return `${input.label} can't start with "-" or contain spaces.`;
  }
  if (spec?.choice && !spec.choice.options.some((o) => o.value === v[spec.choice.id])) return `Pick a ${spec.choice.label.toLowerCase()}.`;
  return null;
}

// The git commands an action runs, in order.
export function commandsFor(a, v = {}, ctx = {}) {
  // Validate again at the execution boundary, including actions without dialogs.
  const hashes = ["checkoutCommit", "createBranch", "addTag", "cherryPick", "revert", "reset", "resetBranch"];
  const names = ["checkout", "checkoutRemote", "renameBranch", "deleteBranch", "deleteRemoteBranch", "deleteTag", "push", "pushTag"];
  if (hashes.includes(a.type) && !objectId(a.hash)) throw new Error("Invalid commit identity");
  if (names.includes(a.type) && !refName(a.name)) throw new Error("Invalid ref name");
  if (["merge", "rebase"].includes(a.type) && !refName(a.ref)) throw new Error("Invalid ref name");
  if (a.type === "deleteRemoteBranch" && (!refName(a.remote) || !refName(a.branch))) throw new Error("Invalid remote branch");
  if (["checkoutRemote", "createBranch", "addTag", "renameBranch"].includes(a.type) && !refName(String(v.name ?? "").trim())) throw new Error("Invalid ref name");
  if (["push", "pushTag"].includes(a.type) && (!refName(v.remote) || !ctx.remotes?.includes(v.remote))) throw new Error("Invalid remote");
  if (a.type === "reset" && !["soft", "mixed", "hard"].includes(v.mode)) throw new Error("Invalid reset mode");
  if (a.type === "resetBranch" && !movable(ctx).includes(v.branch)) throw new Error("Pick a branch that isn't checked out");
  if (a.type === "resetUncommitted" && !["mixed", "hard"].includes(v.mode)) throw new Error("Invalid reset mode");
  if (a.type === "commit" && !String(v.message ?? "").trim()) throw new Error("Empty commit message");
  if (["checkout", "checkoutRemote"].includes(a.type) && v.where !== undefined && !["here", "worktree"].includes(v.where)) throw new Error("Invalid place");
  if (a.type === "createBranch" && !["none", "here", "worktree"].includes(v.where)) throw new Error("Invalid place");
  if (a.type === "removeWorktree" && a.custom !== undefined && a.custom !== null && typeof a.custom !== "string") throw new Error("Invalid remove command");
  if (a.type === "removeWorktree" && (!refName(a.name) || !worktreeOf(ctx, a.name) || worktreeOf(ctx, a.name) !== a.path)) throw new Error("Not a worktree of this repository");
  if (a.type === "removeWorktree" && a.path === ctx.mainRoot) throw new Error("That is the main checkout, not a worktree you can remove");
  if (a.type === "resetFile" && (typeof a.path !== "string" || !a.path || a.path.includes("\0") || a.path.startsWith("/"))) throw new Error("Invalid file path");
  if (a.type === "resetFile" && !(v.mode === "discard" || (v.mode === "unstage" && a.staged))) throw new Error("Invalid reset mode");
  if (a.type === "resetFile" && !a.untracked && !ctx.head) throw new Error("No commit to reset to yet");
  if (a.type === "ffBranch" && (!refName(a.name) || !remoteRef(a.upstream))) throw new Error("Invalid branch");
  if (a.type === "ffAll" && !(Array.isArray(a.list) && a.list.length && a.list.every((b) => refName(b.name) && remoteRef(b.upstream)))) throw new Error("Invalid branches");
  if (a.type === "pushCurrent" && (!refName(a.name) || a.name !== ctx.current)) throw new Error("Not the current branch");
  const name = String(v.name ?? "").trim(), message = String(v.message ?? "").trim();
  switch (a.type) {
    // In a new worktree: git makes the folder, checks the branch out there, and leaves this one be.
    case "checkout": return [v.where === "worktree" ? ["worktree", "add", worktreePath(ctx, a.name), a.name] : ["checkout", a.name]];
    case "checkoutRemote": return [v.where === "worktree" ? ["worktree", "add", "--track", "-b", name, worktreePath(ctx, name), a.name] : ["checkout", "-b", name, "--track", a.name]];
    case "removeWorktree": return [removeWorktreeArgs(a.path, v.force), ...(v.branch || v.branchForce ? [deleteBranchArgs(a.name, v.branchForce)] : [])];
    case "checkoutCommit": return [["checkout", "--detach", a.hash]];
    case "createBranch": return [v.where === "worktree" ? ["worktree", "add", "-b", name, worktreePath(ctx, name), a.hash]
      : v.where === "here" ? ["checkout", "-b", name, a.hash] : ["branch", name, a.hash]];
    case "addTag": return [message ? ["tag", "-a", name, "-m", message, a.hash] : ["tag", name, a.hash]];
    case "renameBranch": return [["branch", "-m", a.name, name]];
    case "deleteBranch": return [deleteBranchArgs(a.name, v.force)];
    // Full ref names: a tag of the same name can't be what's deleted or pushed.
    case "deleteRemoteBranch": return [["push", a.remote, "--delete", `refs/heads/${a.branch}`]];
    case "deleteTag": return [["tag", "-d", a.name]];
    case "merge": return [["merge", "--no-edit", ...(v.noff ? ["--no-ff"] : []), a.ref]];
    case "rebase": return [["rebase", a.ref]];
    case "cherryPick": return [["cherry-pick", ...(a.merge ? ["-m", "1"] : []), a.hash]];
    case "revert": return [["revert", "--no-edit", ...(a.merge ? ["-m", "1"] : []), a.hash]];
    case "reset": return [["reset", `--${v.mode}`, a.hash]];
    case "resetBranch": return [["branch", "-f", "--", v.branch, a.hash]];
    case "push": return [["push", ...(v.upstream ? ["--set-upstream"] : []), v.remote, `refs/heads/${a.name}:refs/heads/${a.name}`]];
    case "pushTag": return [["push", v.remote, `refs/tags/${a.name}`]];
    // The message is -m's own argument, so one starting with "-" stays a message.
    case "commit": return [...(v.all ? [["add", "--all"]] : []), ["commit", "-m", message]];
    // Fast-forward only, as manygit pulls: never a merge or a rebase.
    case "pull": return [["pull", "--ff-only", "--quiet"]];
    case "stash": return [["stash", "push", ...(v.untracked ? ["--include-untracked"] : []), ...(message ? ["-m", message] : [])]];
    case "resetUncommitted": return [["reset", `--${v.mode}`, "HEAD"]];
    // After "--", a path is never an option, and --literal-pathspecs keeps it one file: without it
    // `a[1].log` or `*.json` are patterns that reach other files. Discarding a staged new file deletes it, as git does.
    case "resetFile": return [a.untracked ? ["--literal-pathspecs", "clean", "-f", "-q", "--", a.path]
      : v.mode === "unstage" ? ["--literal-pathspecs", "restore", "--staged", "--", a.path]
      : ["--literal-pathspecs", "restore", "--source=HEAD", "--staged", "--worktree", "--", a.path]];
    case "fetch": return [["fetch", "--all"]];
    case "ffBranch": return [ffCommand({ ...a, current: a.name === ctx.current, worktree: worktreeOf(ctx, a.name) })];
    case "ffAll": return a.list.map((b) => ffCommand({ ...b, current: b.name === ctx.current, worktree: worktreeOf(ctx, b.name) }));
    // To its upstream by name, whatever push.default says (a bare push may refuse, or push every matching branch).
    case "pushCurrent": {
      const t = ctx.tracking?.[ctx.current];
      if (!t?.short || !ctx.current) return [["push"]];
      const { remote, branch } = splitRemote(t.short, ctx.remotes);
      return [["push", remote, `refs/heads/${ctx.current}:refs/heads/${branch}`]];
    }
    default: throw new Error("Unknown Git action");
  }
}

export function doneText(a, v = {}) {
  const name = String(v.name ?? "").trim();
  switch (a.type) {
    case "checkout": return v.where === "worktree" ? `${a.name} is in ${WORKTREES}/${a.name.replaceAll("/", "-")}` : `Checked out ${a.name}`;
    case "removeWorktree": return `Removed the worktree ${folderName(a.path)}${(v.branch || v.branchForce) && !a.kept ? ` and the branch ${a.name}` : ""}`;
    case "checkoutRemote": return v.where === "worktree" ? `Created ${name} in ${WORKTREES}/${name.replaceAll("/", "-")}, tracking ${a.name}` : `Checked out ${name}, tracking ${a.name}`;
    case "checkoutCommit": return `Checked out ${a.short}`;
    case "createBranch": return v.where === "worktree" ? `Created ${name} in ${WORKTREES}/${name.replaceAll("/", "-")}` : v.where === "here" ? `Created and checked out ${name}` : `Created branch ${name}`;
    case "addTag": return `Tagged ${a.short} as ${name}`;
    case "renameBranch": return `Renamed ${a.name} to ${name}`;
    case "deleteBranch": return `Deleted branch ${a.name}`;
    case "deleteRemoteBranch": return `Deleted ${a.name}`;
    case "deleteTag": return `Deleted tag ${a.name}`;
    case "merge": return `Merged ${a.what}`;
    case "rebase": return `Rebased on ${a.what}`;
    case "cherryPick": return `Cherry-picked ${a.short}`;
    case "revert": return `Reverted ${a.short}`;
    case "reset": return `Reset to ${a.short} (${v.mode})`;
    case "resetBranch": return `Reset ${v.branch} to ${a.short}`;
    case "push": return `Pushed ${a.name} to ${v.remote}`;
    case "pushTag": return `Pushed tag ${a.name} to ${v.remote}`;
    case "commit": return "Committed";
    case "pull": return `Pulled ${a.upstream}`;
    case "stash": return "Stashed uncommitted changes";
    case "resetUncommitted": return `Reset uncommitted changes (${v.mode})`;
    case "resetFile": return `${a.untracked ? "Deleted" : v.mode === "unstage" ? "Unstaged" : "Discarded the changes to"} ${a.path.split("/").pop()}`;
    case "fetch": return "Fetched";
    case "ffBranch": return `Fast-forwarded ${a.name} to ${a.short}`;
    case "ffAll": return a.kept ? "Fast-forwarded some branches" : `Fast-forwarded ${a.list.map((b) => b.name).join(", ")}`;
    case "pushCurrent": return `Pushed ${a.name}`;
    default: return "Done";
  }
}

// Git's own words, without its hints; its usual refusals first in plain words, with
// what to do, as a toast only shows its first lines.
export function gitError(result) {
  const text = result.stderr || result.stdout || "";
  const lines = text.split("\n").map((l) => l.trimEnd()).filter((l) => l && !l.startsWith("hint:"));
  const raw = lines.slice(-6).join("\n") || `git exited with ${result.code}`;
  const plain = explain(text);
  return plain ? `${plain}\n\n${raw}` : raw;
}

export function explain(text) {
  let m;
  if ((m = /'([^']+)' is already (?:checked out|used by worktree) at '([^']+)'/.exec(text)))
    return `${m[1]} is checked out in the worktree ${folderName(m[2])}. Double-click its label to go there.`;
  if ((m = /refusing to fetch into branch '(?:refs\/heads\/)?([^']+)' checked out at '([^']+)'/.exec(text)))
    return `${m[1]} is checked out in the worktree ${folderName(m[2])}: fast-forward it from its menu, or there.`;
  if (/local changes to the following files would be overwritten by (checkout|merge|switch)/.test(text) || /untracked working tree files would be (overwritten|removed)/.test(text))
    return "Your uncommitted changes would be overwritten. Commit or stash them first (right-click Uncommitted changes).";
  if ((m = /branch '([^']+)' is not fully merged/.exec(text)))
    return `${m[1]} has commits that aren't merged anywhere. Tick "Force delete" to delete it anyway.`;
  if (/\[rejected\][^\n]*\((non-fast-forward|fetch first)\)/.test(text) || /Updates were rejected because/.test(text))
    return "The remote has commits you don't have. Fetch, then merge or rebase, and push again.";
  if (/Not possible to fast-forward|diverging branches can't be fast-forwarded/.test(text))
    return "The branches have diverged: merge or rebase instead of fast-forwarding.";
  if (/CONFLICT|Merge conflict|could not apply/.test(text))
    return "Stopped at a conflict. Resolve it, or undo with git merge --abort / git rebase --abort.";
  if ((m = /fatal: '([^']+)' already exists/.exec(text)))
    return `The folder ${folderName(m[1])} already exists: remove it, or pick another branch name.`;
  if ((m = /a branch named '([^']+)' already exists/.exec(text)))
    return `There's already a branch ${m[1]}: pick another name, or check that one out.`;
  if (/contains modified or untracked files, use --force to delete it/.test(text))
    return "The worktree has uncommitted changes. Tick \"Even with uncommitted changes\" to remove it anyway.";
  if (/You have unstaged changes|cannot rebase: You have/.test(text))
    return "Commit or stash your uncommitted changes before rebasing.";
  return null;
}

// The files a commit changed against its first parent, joined from
// --name-status and --numstat (renames off, so the paths match).
export function fileArgs(commit) {
  checkCommit(commit);
  const range = commit.parents.length ? [commit.parents[0], commit.hash] : null;
  const base = range ? ["diff", "--no-renames", "--no-ext-diff", ...range] : ["diff-tree", "--root", "--no-commit-id", "-r", "--no-renames", commit.hash];
  return { status: [...base, "--name-status"], numstat: [...base, "--numstat"] };
}

export function joinFiles(statusText, numstatText) {
  const stats = new Map();
  for (const line of numstatText.split("\n").filter(Boolean)) {
    const [a, d, ...path] = line.split("\t");
    stats.set(path.join("\t"), { add: Number(a) || 0, del: Number(d) || 0, binary: a === "-" });
  }
  return statusText.split("\n").filter(Boolean).map((line) => {
    const [s, ...path] = line.split("\t"), p = path.join("\t");
    return { path: p, status: s[0], ...(stats.get(p) ?? { add: 0, del: 0 }) };
  });
}

export function diffArgs(commit, path) {
  if (!commit.uncommitted) checkCommit(commit);
  const opts = ["--no-color", "--no-ext-diff", "--no-textconv"];
  if (commit.uncommitted) return ["diff", ...opts, "HEAD", "--", path];
  if (!commit.parents.length) return ["show", ...opts, "--format=", commit.hash, "--", path];
  return ["diff", ...opts, commit.parents[0], commit.hash, "--", path];
}

// Local change: the review "since base": everything from where the branch left the
// base (their merge base, `from`) to a commit, or to the working tree when `to` is null.

// The branches to compare against, best first: a name set in settings alone, else
// origin/HEAD's target, then main and master, local before remote.
export function baseCandidates(setting, originHead) {
  const set = String(setting ?? "").trim();
  if (set) return [set];
  return [...new Set([originHead, "main", "master", "origin/main", "origin/master"].filter(refName))];
}

// The checked-out branch is the base itself: its own name, or the remote branch it tracks (main ⇄ origin/main).
export function isBaseBranch(base, current, tracking) {
  if (!base || !current) return false;
  return base === current || base === tracking?.[current]?.short;
}

function rangeOf(from, to) {
  if (!objectId(from) || (to !== null && !objectId(to))) throw new Error("Invalid commit range");
  return to ? [from, to] : [from];
}

export function rangeFileArgs(from, to) {
  const base = ["diff", "--no-renames", "--no-ext-diff", ...rangeOf(from, to)];
  return { status: [...base, "--name-status"], numstat: [...base, "--numstat"] };
}

export function rangeDiffArgs(from, to, path) {
  return ["diff", "--no-color", "--no-ext-diff", "--no-textconv", ...rangeOf(from, to), "--", path];
}

// Local change: diff rows with lines longer than `chars` broken into rows of that width (tabs as four
// spaces); a continuation row has no number. Hunk heads and notes (kind "F") stay as they are.
export function wrapDiff(rows, chars) {
  const out = [];
  for (const r of rows) {
    if (r.kind === "@" || r.kind === "F" || r.text.length <= chars) { out.push(r); continue; }
    const text = r.text.replace(/\t/g, "    ");
    for (let i = 0; i < text.length; i += chars) out.push(i === 0 ? { ...r, text: text.slice(0, chars) } : { kind: r.kind, text: text.slice(i, i + chars), cont: true });
  }
  return out;
}

// Local change: a file as it is at a commit, as diff rows: every line numbered, the lines the change added or
// changed marked "+" (the first of each run `start`, for ] [), and where lines went a "r" row saying how many.
// `diff` is `git diff -U0` of the same change. Up to 3000 lines.
export function fileRows(text, diff) {
  const added = new Set(), removed = new Map(); // new-side line → lines removed just before it
  for (const m of diff.matchAll(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const gone = m[1] === undefined ? 1 : Number(m[1]), from = Number(m[2]), n = m[3] === undefined ? 1 : Number(m[3]);
    for (let i = 0; i < n; i++) added.add(from + i);
    // Only removed (n 0): the hunk names the line they followed; else they stood where the new lines are.
    if (gone > 0 && (gone > n || n === 0)) { const at = n === 0 ? from + 1 : from; removed.set(at, (removed.get(at) ?? 0) + (n === 0 ? gone : gone - n)); }
  }
  const lines = text.replace(/\n$/, "").split("\n").slice(0, 3000), out = [];
  lines.forEach((line, i) => {
    const n = i + 1, gone = removed.get(n);
    if (gone) out.push({ kind: "r", text: `⋯ ${gone} line${gone === 1 ? "" : "s"} removed here`, start: true });
    const plus = added.has(n);
    out.push({ kind: plus ? "+" : " ", number: n, text: (line.length > 2000 ? line.slice(0, 2000) + "…" : line) || " ", start: plus && !added.has(n - 1) && !gone });
  });
  const tail = removed.get(lines.length + 1);
  if (tail) out.push({ kind: "r", text: `⋯ ${tail} line${tail === 1 ? "" : "s"} removed here`, start: true });
  return out;
}

// Local change: `git diff -w` (whitespace ignored) for the same comparison.
export const ignoringSpace = (args) => [args[0], "-w", ...args.slice(1)];

// Numbers each diff line once, so a frame only draws the rows on screen.
export function diffRows(text) {
  const all = text.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
  if (first < 0) return null;
  let old = 0, next = 0;
  return all.slice(first, first + 3000).map((raw) => {
    const line = raw.length > 2000 ? raw.slice(0, 2000) + "…" : raw;
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (m) { old = +m[1]; next = +m[2]; return { kind: "@", text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, number: old++, text: line.slice(1) || " " };
    if (kind === "+") return { kind, number: next++, text: line.slice(1) || " " };
    if (kind === " ") { old++; return { kind, number: next++, text: line.slice(1) || " " }; }
    return { kind: "", text: line };
  });
}
