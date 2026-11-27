// git-graph's git plumbing (git.js, execute.js): run with `node --test 'tests/unit/*.test.mjs'`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { READ, commandsFor, parseBranches, menuFor, worktreePath, parseStatus, splitRemote, childrenFirst, parseRevParse, REV_PARSE, logArgs, removeDialog } from "../../mods/git-graph/git.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeAction } from "../../mods/git-graph/execute.js";

const ctx = (over = {}) => ({ root: "/r/wt", mainRoot: "/r/main", head: "a".repeat(40), current: "feat", remotes: ["origin"],
  branches: ["main", "feat"], tracking: {}, worktrees: { main: "/r/main" }, on: null, ...over });

test("reads ask git for paths as they are (été.txt, not \\303\\251t\\303\\251.txt)", () => {
  const i = READ.indexOf("core.quotePath=false");
  assert.ok(i > 0 && READ[i - 1] === "-c");
});

test("resetting one file takes its name literally, after --", () => {
  for (const [a, v] of [[{ type: "resetFile", path: "a[1].log", untracked: true }, { mode: "discard" }],
                        [{ type: "resetFile", path: "*.json", staged: true }, { mode: "unstage" }],
                        [{ type: "resetFile", path: "x?.txt" }, { mode: "discard" }]]) {
    const [cmd] = commandsFor(a, v, ctx());
    assert.equal(cmd[0], "--literal-pathspecs", JSON.stringify(cmd));
    assert.deepEqual(cmd.slice(-2), ["--", a.path]);
  }
  assert.throws(() => commandsFor({ type: "resetFile", path: "/etc/passwd" }, { mode: "discard" }, ctx()), /Invalid file path/);
  assert.throws(() => commandsFor({ type: "resetFile", path: "x", staged: false }, { mode: "unstage" }, ctx()), /Invalid reset mode/);
});

test("the main checkout is never offered or accepted for worktree removal", () => {
  const c = ctx();
  const items = menuFor({ kind: "branch", name: "main" }, c).flat().filter(Boolean);
  assert.ok(!items.some((i) => i.action?.type === "removeWorktree"), "no Remove worktree… for the main checkout");
  assert.throws(() => commandsFor({ type: "removeWorktree", name: "main", path: "/r/main" }, {}, c), /main checkout/);
  // Positive control: a branch in another linked worktree does get it (so the absence above means something).
  const linked = ctx({ worktrees: { main: "/r/main", fix: "/r/main/.worktrees/fix" }, branches: ["main", "feat", "fix"] });
  const fixItems = menuFor({ kind: "branch", name: "fix" }, linked).flat().filter(Boolean);
  assert.ok(fixItems.some((i) => i.action?.type === "removeWorktree"), JSON.stringify(fixItems.map((i) => i.action?.type ?? i.label)));
  const other = ctx({ worktrees: { main: "/r/main", fix: "/r/main/.worktrees/fix" }, branches: ["main", "feat", "fix"] });
  assert.deepEqual(commandsFor({ type: "removeWorktree", name: "fix", path: "/r/main/.worktrees/fix" }, {}, other)[0], ["worktree", "remove", "/r/main/.worktrees/fix"]);
});

test("branches: tracking, ahead/behind, worktrees elsewhere", () => {
  const text = ["refs/heads/main\0refs/remotes/origin/main\0[behind 2]\0origin/main\0/r/main",
                "refs/heads/feat\0refs/remotes/origin/feat\0[ahead 1, behind 3]\0origin/feat\0/r/wt",
                "refs/heads/gone\0refs/remotes/origin/gone\0[gone]\0origin/gone\0"].join("\n");
  const b = parseBranches(text, "/r/wt");
  assert.deepEqual(b.names, ["main", "feat", "gone"]);
  assert.deepEqual(b.worktrees, { main: "/r/main" }, "the current root isn't 'elsewhere'");
  assert.equal(b.tracking.feat.ahead, 1); assert.equal(b.tracking.feat.behind, 3);
  assert.equal(b.tracking.gone.gone, true);
});

test("new worktrees go in .worktrees of the main checkout, slashes as dashes", () => {
  assert.equal(worktreePath(ctx(), "feat/csv-export"), "/r/main/.worktrees/feat-csv-export");
  assert.equal(worktreePath(ctx({ mainRoot: null, root: "/r" }), "x"), "/r/.worktrees/x");
});

test("status: staged and untracked are told apart", () => {
  const files = parseStatus("A  new.txt\0?? loose.txt\0 M changed.txt\0");
  const by = Object.fromEntries(files.map((f) => [f.path, f]));
  assert.equal(by["new.txt"].staged, true);
  assert.equal(by["loose.txt"].untracked, true);
  assert.ok(!by["changed.txt"].staged);
});

// A fake exec: answers HEAD checks, records every command.
function fakeExec({ head = "a".repeat(40), branch = "feat" } = {}) {
  const calls = [];
  const exec = async (program, args, opts) => {
    calls.push({ program, args, opts });
    if (args.includes("rev-parse") && args.includes("HEAD")) return { code: 0, stdout: head + "\n", stderr: "" };
    if (args.includes("symbolic-ref")) return { code: 0, stdout: branch + "\n", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  return { exec, calls };
}

test("nothing changes when HEAD moved since the dialog", async () => {
  const { exec, calls } = fakeExec({ head: "b".repeat(40) });
  const r = await executeAction({ type: "resetFile", path: "x", untracked: true }, { mode: "discard" }, ctx(), exec);
  assert.equal(r.ok, false); assert.equal(r.stale, true);
  assert.ok(!calls.some((c) => c.args.includes("clean")), "no clean ran");
});

test("fetch, pull and push run with no credential prompt and a long timeout; local commands don't", async () => {
  const { exec, calls } = fakeExec();
  await executeAction({ type: "pull" }, {}, ctx(), exec);
  const pull = calls.find((c) => c.args.includes("pull"));
  assert.equal(pull.program, "env");
  assert.ok(pull.args.includes("GIT_TERMINAL_PROMPT=0"));
  assert.equal(pull.opts.timeout, 300000);
  const { exec: e2, calls: c2 } = fakeExec();
  await executeAction({ type: "resetFile", path: "x", untracked: true }, { mode: "discard" }, ctx(), e2);
  assert.equal(c2.find((c) => c.args.includes("clean")).program, "git");
});

test("remote names with a slash split at the known remote, not the first slash", () => {
  assert.deepEqual(splitRemote("team/eu/feat/x", ["origin", "team/eu"]), { remote: "team/eu", branch: "feat/x" });
  assert.deepEqual(splitRemote("origin/feat/x", ["origin", "team/eu"]), { remote: "origin", branch: "feat/x" });
  assert.deepEqual(splitRemote("other/x", []), { remote: "other", branch: "x" });
});

test("pushes name full refs: the upstream by name, never whatever push.default does", () => {
  const c = ctx({ current: "feat", tracking: { feat: { upstream: "refs/remotes/team/eu/feature", short: "team/eu/feature", ahead: 1 } }, remotes: ["origin", "team/eu"] });
  assert.deepEqual(commandsFor({ type: "pushCurrent", name: "feat" }, {}, c)[0], ["push", "team/eu", "refs/heads/feat:refs/heads/feature"]);
  assert.deepEqual(commandsFor({ type: "push", name: "feat" }, { remote: "origin" }, ctx())[0], ["push", "origin", "refs/heads/feat:refs/heads/feat"]);
  assert.deepEqual(commandsFor({ type: "deleteRemoteBranch", name: "origin/x", remote: "origin", branch: "x" }, {}, ctx())[0], ["push", "origin", "--delete", "refs/heads/x"]);
});

test("fast-forward all goes on past a failing branch and says which moved", async () => {
  const calls = [];
  const exec = async (program, args) => {
    calls.push(args);
    if (args.includes("rev-parse") && args.includes("HEAD")) return { code: 0, stdout: "a".repeat(40) + "\n", stderr: "" };
    if (args.includes("symbolic-ref")) return { code: 0, stdout: "feat\n", stderr: "" };
    if (args.some((a) => String(a).includes("bad"))) return { code: 1, stdout: "", stderr: "fatal: not a fast-forward" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const list = [{ name: "one", upstream: "refs/remotes/origin/one", short: "origin/one" },
                { name: "bad", upstream: "refs/remotes/origin/bad", short: "origin/bad" },
                { name: "two", upstream: "refs/remotes/origin/two", short: "origin/two" }];
  const r = await executeAction({ type: "ffAll", list }, {}, ctx({ branches: ["main", "feat", "one", "bad", "two"] }), exec);
  assert.equal(r.ok, true);
  assert.match(r.warning, /Fast-forwarded one, two/);
  assert.match(r.warning, /bad: fatal: not a fast-forward/);
});

test("merges make a merge commit by default", () => {
  const c = ctx();
  const items = menuFor({ kind: "branch", name: "main" }, ctx({ current: "feat", worktrees: {} })).flat().filter(Boolean);
  const merge = items.find((i) => i.action?.type === "merge");
  assert.ok(merge);
  const [cmd] = commandsFor(merge.action, { noff: true }, c);
  assert.ok(cmd.includes("--no-ff"));
});

test("reset a branch to a commit: only other branches not checked out, with branch -f", () => {
  const c = ctx({ branches: ["main", "feat", "free", "busy"], worktrees: { main: "/r/main", busy: "/r/main/.worktrees/busy" } });
  const items = menuFor({ kind: "commit", commit: { hash: "b".repeat(40), parents: ["c".repeat(40)], subject: "s" } }, c).flat().filter(Boolean);
  const reset = items.find((i) => i.action?.type === "resetBranch");
  assert.ok(reset, JSON.stringify(items.map((i) => i.action?.type)));
  assert.deepEqual(commandsFor(reset.action, { branch: "free" }, c)[0], ["branch", "-f", "--", "free", "b".repeat(40)]);
  for (const bad of ["feat", "busy", "main", "nope"]) assert.throws(() => commandsFor(reset.action, { branch: bad }, c), /isn't checked out/, bad);
});

test("git's own order stands where children already come first; a wrong clock moves only the parent", () => {
  const c = (hash, ...parents) => ({ hash, parents });
  const fine = [c("d", "b", "c"), c("c", "a"), c("b", "a"), c("a")];
  assert.equal(childrenFirst(fine), fine, "the same array back: nothing to fix");
  // b's clock was ahead: git lists it before its child c.
  const skew = [c("b", "a"), c("x"), c("c", "b"), c("a")];
  assert.deepEqual(childrenFirst(skew).map((x) => x.hash), ["x", "c", "b", "a"]);
  // A parent outside the commits read doesn't hold anything back.
  const page = [c("z", "outside"), c("y", "z")];
  assert.deepEqual(childrenFirst(page).map((x) => x.hash), ["y", "z"]);
  assert.ok(!logArgs({ all: true, remotes: true, limit: 5 }).includes("--date-order"));
  assert.ok(logArgs({ all: false, remotes: false, limit: 5, dateOrder: true }).includes("--date-order"));
});

test("one rev-parse answers top level, common dir, HEAD and branch, also with a file named HEAD and no commits", () => {
  const dir = mkdtempSync(join(tmpdir(), "gg-rev-")), sh = (...a) => execFileSync("git", a, { cwd: dir, stdio: ["ignore", "pipe", "ignore"] }).toString();
  const rev = () => { try { return sh(...READ, ...REV_PARSE); } catch (e) { return e.stdout.toString(); } };
  try {
    sh("init", "-q", "-b", "trunk");
    let r = parseRevParse(rev());
    assert.equal(r.head, null); assert.equal(r.unborn, true); assert.ok(r.root.endsWith(dir.split("/").pop()));
    sh("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x");
    execFileSync("touch", ["HEAD"], { cwd: dir });
    r = parseRevParse(rev());
    assert.match(r.head, /^[0-9a-f]{40}$/); assert.equal(r.current, "trunk"); assert.equal(r.unborn, false);
    assert.ok(r.common.endsWith("/.git"));
    sh("checkout", "-q", "--detach");
    r = parseRevParse(rev());
    assert.match(r.head, /^[0-9a-f]{40}$/); assert.equal(r.current, null);
    assert.equal(parseRevParse(""), null, "not a repository");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the PR view's log reads only the PR's head and its base", async () => {
  const { logArgs } = await import("../../mods/git-graph/git.js");
  const args = logArgs({ all: true, remotes: true, limit: 300, revs: ["abc123", "refs/remotes/origin/main"] });
  assert.ok(args.includes("abc123") && args.includes("refs/remotes/origin/main"));
  assert.ok(!args.includes("--branches") && !args.includes("--remotes"), "no other branches");
  assert.ok(logArgs({ all: true, remotes: true, limit: 300 }).includes("--branches"), "without revs: all branches as before");
});

test("a merge of HEAD below the uncommitted changes draws a solid line to HEAD, not the dashed one", async () => {
  const { layoutLanes } = await import("../../mods/git-graph/lanes.js");
  // Uncommitted → main (dashed); development merges main in, so it joins that lane.
  const { rows } = layoutLanes([
    { hash: "U", parents: ["M"], dashed: true },
    { hash: "D", parents: ["D0", "M"] },
    { hash: "M", parents: ["M0"] },
  ]);
  const merge = rows[1].segments.find(([a, ya, b]) => a === rows[1].lane && ya === 0.5 && b === 0);
  assert.equal(merge[5], false, "the merge line is solid");
  const intoM = rows[2].segments.find(([a, ya, b, yb]) => a === 0 && ya === 0 && yb === 0.5);
  assert.equal(intoM[5], false, "the line into HEAD is solid below the merge");
  assert.equal(rows[1].segments.find(([a, ya, b, yb]) => a === 0 && b === 0 && ya === 0 && yb === 1)[5], true, "above it stays dashed");
});

test("long diff lines wrap to the width, the rest of the line without a number; hunk heads and notes don't", async () => {
  const { wrapDiff, ignoringSpace } = await import("../../mods/git-graph/git.js");
  const rows = [{ kind: "@", text: "@@ -1 +1 @@ a very long hunk head" }, { kind: "+", number: 7, text: "abcdefghij\tk" }, { kind: "F", text: "a finding note longer than ten" }, { kind: " ", number: 8, text: "short" }];
  assert.deepEqual(wrapDiff(rows, 10), [rows[0], { kind: "+", number: 7, text: "abcdefghij" }, { kind: "+", text: "    k", cont: true }, rows[2], rows[3]]);
  assert.deepEqual(ignoringSpace(["diff", "--no-color", "a", "b"]), ["diff", "-w", "--no-color", "a", "b"]);
});

test("a file as it is after a change: every line numbered, added lines marked, removed lines noted where they were", async () => {
  const { fileRows } = await import("../../mods/git-graph/git.js");
  // Line 2 changed (1 for 1), lines 4-5 added, 2 lines removed after line 6, the old last line removed.
  const diff = "@@ -2 +2 @@\n-b\n+B\n@@ -3,0 +4,2 @@\n+x\n+y\n@@ -5,2 +6,0 @@\n-p\n-q\n@@ -9 +8,0 @@\n-z\n";
  const rows = fileRows("a\nB\nc\nx\ny\nd\ne\nf\n", diff);
  assert.deepEqual(rows.map((r) => `${r.kind}${r.number ?? ""}${r.start ? "*" : ""}`), [" 1", "+2*", " 3", "+4*", "+5", " 6", "r*", " 7", " 8", "r*"]);
  assert.equal(rows[6].text, "⋯ 2 lines removed here");
});

test("checkout from the menu: here or in a new worktree, at once; a remote branch as its own name, or as… another", () => {
  const c = ctx({ current: "main", branches: ["main", "feat"], worktrees: {} });
  const acts = (t) => menuFor(t, c).filter((i) => !i.separator).map((i) => [i.label, i.action.where ?? null]);
  const local = acts({ kind: "branch", name: "feat", commit: {} });
  assert.deepEqual(local.filter(([l]) => l.startsWith("Checkout")), [["Checkout", "here"], ["Checkout in a new worktree", "worktree"]]);
  const remote = acts({ kind: "remote", name: "origin/csv", commit: {} });
  assert.deepEqual(remote.filter(([l]) => l.startsWith("Checkout")), [["Checkout as csv", "here"], ["Checkout as csv in a new worktree", "worktree"], ["Checkout as…", null]]);
  // A remote branch run at once becomes a local branch of its name, tracking it.
  assert.deepEqual(commandsFor({ type: "checkoutRemote", name: "origin/csv", remote: "origin", branch: "csv" }, { where: "here", name: "csv" }, c), [["checkout", "-b", "csv", "--track", "origin/csv"]]);
  assert.deepEqual(commandsFor({ type: "checkout", name: "feat" }, { where: "worktree" }, c), [["worktree", "add", "/r/main/.worktrees/feat", "feat"]]);
});

test("Remove worktree: its branch goes too by default, unless it has unpushed commits of its own", () => {
  const ctx = { root: "/r/main", mainRoot: "/r/main", tracking: { gone: { gone: true } } };
  const a = { type: "removeWorktree", name: "fix/x", path: "/r/main/.claude/worktrees/fix-x", custom: null, open: false };
  const clean = removeDialog({ ...a, dirty: 0, unmerged: 0 }, ctx);
  assert.equal(clean.detail, ".claude/worktrees/fix-x");
  assert.deepEqual(clean.checks.map((c) => [c.id, c.value]), [["branchForce", true]], "merged, clean: one tick, on");
  const own = removeDialog({ ...a, dirty: 2, unmerged: 3 }, ctx);
  assert.match(own.checks[0].label, /its 3 unmerged commits are lost/);
  assert.equal(own.checks[0].value, false, "commits only it has, never pushed: kept unless ticked");
  assert.match(own.checks[1].label, /Discard its 2 uncommitted changes/);
  assert.equal(removeDialog({ ...a, name: "gone", dirty: 0, unmerged: 1 }, ctx).checks[0].value, true, "upstream gone (merged on GitHub): on");
  const unknown = removeDialog({ ...a, dirty: null, unmerged: null }, ctx);
  assert.deepEqual(unknown.checks.map((c) => [c.id, c.value]), [["branch", true], ["force", false]], "facts unknown: git branch -d keeps an unmerged one");
});

test("Remove worktree: the remote branch only when ticked, its PR named; what can't go is kept and said", async () => {
  const c = { root: "/r/main", mainRoot: "/r/main", head: "a".repeat(40), current: "feat", remotes: ["origin"], branches: ["feat", "fix"],
    tracking: {}, worktrees: { fix: "/r/main/.worktrees/fix" }, on: null };
  const a = { type: "removeWorktree", name: "fix", path: "/r/main/.worktrees/fix", custom: null, dirty: 0, unmerged: 0,
    remote: { remote: "origin", branch: "fix", pr: { number: 7, state: "OPEN" } } };
  const tick = removeDialog(a, c).checks.find((x) => x.id === "remoteBranch");
  assert.equal(tick.value, false, "never by default");
  assert.equal(tick.label, "Also delete origin/fix (PR #7 is open and would close)");
  assert.ok(!removeDialog({ ...a, remote: null }, c).checks.some((x) => x.id === "remoteBranch"), "no upstream left: no tick");
  assert.deepEqual(commandsFor(a, { branchForce: true, remoteBranch: true }, c).slice(1), [["branch", "-D", "fix"], ["push", "origin", "--delete", "refs/heads/fix"]]);
  assert.equal(commandsFor(a, { branchForce: true }, c).length, 2);
  assert.throws(() => commandsFor({ ...a, remote: { remote: "evil", branch: "fix" } }, { remoteBranch: true }, c), /remote branch/);
  // The branch kept (unmerged), the push still runs; both said in one warning.
  const calls = [];
  const exec = async (program, args) => {
    calls.push(args);
    if (args.includes("rev-parse") && args.includes("HEAD")) return { code: 0, stdout: c.head + "\n", stderr: "" };
    if (args.includes("symbolic-ref")) return { code: 0, stdout: "feat\n", stderr: "" };
    if (args[0] === "branch") return { code: 1, stdout: "", stderr: "error: the branch 'fix' is not fully merged." };
    return { code: 0, stdout: "", stderr: "" };
  };
  const r = await executeAction(a, { branch: true, remoteBranch: true }, c, exec);
  assert.equal(r.ok, true);
  assert.match(r.warning, /Kept the branch fix/);
  assert.ok(calls.some((x) => x.includes("--delete")), "the remote branch was still deleted");
});
