// The code several mods share (lib/, copied into each by lib/sync.mjs): run with `node --test 'tests/unit/*.test.mjs'`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { problems } from "../../lib/sync.mjs";
import { fuzzy, fuzzyLower } from "../../lib/fuzzy.js";
import { branchTitle } from "../../lib/names.js";
import { codeFindArgs, findArgs, foundRepos, isHomeOrAbove, CODE_DEPTH, HOME_DEPTH } from "../../lib/repos.js";
import { customRemove, removeWorktreeArgs, deleteBranchArgs, unmerged } from "../../lib/worktree.js";
import { commandsFor } from "../../mods/git-graph/git.js";

test("every mod's copy of lib/ is the same as lib/ (edit lib/, then run node lib/sync.mjs)", () => {
  assert.deepEqual(problems(), []);
});

test("a copy edited in place is caught, and --check fails", () => {
  const root = fileURLToPath(new URL("../..", import.meta.url)), copy = `${root}mods/new-space/lib/fuzzy.js`;
  const text = readFileSync(copy, "utf8");
  try {
    writeFileSync(copy, text + "// edited here\n");
    assert.deepEqual(problems(), ["differs from lib/: mods/new-space/lib/fuzzy.js"]);
    assert.match(execFileSync("sh", ["-c", "node lib/sync.mjs --check 2>&1; echo exit=$?"], { cwd: root }).toString(), /differs[\s\S]*exit=1/);
  } finally { writeFileSync(copy, text); }
  assert.deepEqual(problems(), []);
});

test("fuzzy: letters in order, file names and segment starts first; case doesn't matter", () => {
  assert.equal(fuzzy("xyz", "src/app.js"), null);
  assert.ok(fuzzy("app", "src/app.js") > fuzzy("app", "a/p/p/main.js"));
  assert.equal(fuzzy("APP", "Src/App.js"), fuzzyLower("app", "src/app.js"));
});

test("a branch reads as words; one with no words keeps its name", () => {
  assert.equal(branchTitle("feat/csv-export"), "Csv Export");
  assert.equal(branchTitle("login_form"), "Login Form");
  assert.equal(branchTitle("fix/123"), "123");
  assert.equal(branchTitle("feat/--"), "feat/--");
  assert.equal(branchTitle(null), "");
});

test("the code folder: ~ (or above) only two levels down, without the home folder's document folders", () => {
  const home = "/Users/me";
  assert.ok(isHomeOrAbove("/Users/me", home) && isHomeOrAbove("/Users/me/", home) && isHomeOrAbove("/", home) && isHomeOrAbove("/Users", home));
  assert.ok(!isHomeOrAbove("/Users/me/Code", home));
  assert.ok(isHomeOrAbove("/home/someone", null), "another machine's home");
  const code = codeFindArgs("/Users/me/Code", home), atHome = codeFindArgs("/Users/me", home);
  assert.equal(code[code.indexOf("-maxdepth") + 1], String(CODE_DEPTH + 1));
  assert.equal(atHome[atHome.indexOf("-maxdepth") + 1], String(HOME_DEPTH + 1));
  for (const n of ["Desktop", "Documents", "Downloads", "Library"]) assert.ok(atHome.includes(n), n);
  assert.ok(!code.includes("Documents") && code.includes("Library"));
  assert.deepEqual(findArgs("/x", 3).slice(0, 2), ["-H", "/x"]);
});

test("find's output as repositories: worktrees too, once each, sorted", () => {
  assert.deepEqual(foundRepos("/c/b/.git\n/c/a/.git\n/c/a/.git\n/c/x/notgit\n/c/w/.git\n"), ["/c/a", "/c/b", "/c/w"]);
});

test("removing a worktree: the repository's command quoted; an unmerged branch only when forced", () => {
  assert.equal(customRemove("rm-wt {path} {branch}", "/r/it's", "fix"), "rm-wt '/r/it'\\''s' 'fix'");
  assert.deepEqual(removeWorktreeArgs("/w", true), ["worktree", "remove", "--force", "/w"]);
  assert.deepEqual(deleteBranchArgs("fix"), ["branch", "-d", "fix"]);
  assert.deepEqual(deleteBranchArgs("fix", true), ["branch", "-D", "fix"]);
  assert.ok(unmerged("error: the branch 'fix' is not fully merged."));
  // git-graph's dialog: "Delete the branch too" keeps an unmerged one; "even if it isn't merged" doesn't.
  const ctx = { root: "/r/main", mainRoot: "/r/main", head: "a".repeat(40), current: "main", remotes: [], branches: ["main", "fix"],
    tracking: {}, worktrees: { fix: "/r/main/.worktrees/fix" }, on: null };
  const a = { type: "removeWorktree", name: "fix", path: "/r/main/.worktrees/fix" };
  assert.deepEqual(commandsFor(a, { branch: true }, ctx)[1], ["branch", "-d", "fix"]);
  assert.deepEqual(commandsFor(a, { branch: true, branchForce: true }, ctx)[1], ["branch", "-D", "fix"]);
  assert.deepEqual(commandsFor(a, { branchForce: true }, ctx)[1], ["branch", "-D", "fix"], "ticking only the force box deletes it too");
  assert.equal(commandsFor(a, {}, ctx).length, 1);
});
