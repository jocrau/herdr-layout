// Every menu in one order and with the same words (lib/menu.js): the git view's (git-graph/git.js menuFor, its
// repository menu also the status bar's) and the sidebar's (worktree-actions items), built for many targets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { groupOf, outOfOrder, word, WORDS } from "../../lib/menu.js";

register("./stub-hooks.mjs", import.meta.url);
const { menuFor } = await import("../../mods/git-graph/git.js");
const { items } = await import("../../mods/worktree-actions/main.js");

test("groups: links before opens (Open … on GitHub), worktree dialogs are branch work", () => {
  assert.equal(groupOf("Open branch on GitHub"), "links");
  assert.equal(groupOf("Open in VS Code"), "open");
  assert.equal(groupOf("Open worktree"), "work");
  assert.equal(groupOf("Push to origin/main…"), "sync");
  assert.equal(groupOf("Rename space"), null);
  assert.deepEqual(outOfOrder(["Copy path", "Fetch"]), ["Copy path", "Fetch"]);
  assert.equal(outOfOrder(["Open in git view", "Rename space", "Fetch", "Copy path", "Close space"]), null);
});

test("an item that asks gets its ellipsis once", () => {
  assert.equal(word("pull", { asks: true }).label, "Pull…");
  assert.equal(word("commit", { asks: true }).label, "Commit…");
});

const ctx = (over = {}) => ({
  current: "main", head: "c1", branches: ["main", "feat", "wt"], remotes: ["origin"], web: "https://github.com/acme/web",
  tracking: { main: { short: "origin/main", upstream: "refs/remotes/origin/main", ahead: 1, behind: 0 }, feat: { short: "origin/feat", upstream: "refs/remotes/origin/feat", ahead: 0, behind: 2 } },
  worktrees: { wt: "/r/.worktrees/wt" }, mainRoot: "/r", ...over,
});
const commit = { hash: "c2", parents: ["c1"], subject: "Add a thing" };
const TARGETS = {
  "uncommitted": { kind: "uncommitted", staged: true },
  "the current branch": { kind: "branch", name: "main", commit },
  "another branch, behind": { kind: "branch", name: "feat", commit },
  "a branch in a worktree": { kind: "branch", name: "wt", commit },
  "a remote branch": { kind: "remote", name: "origin/feat", commit },
  "a tag": { kind: "tag", name: "v1", commit },
  "a commit": { kind: "commit", commit },
  "the repository, dirty": { kind: "repo", path: "/r", status: { branch: "main", upstream: "origin/main", ahead: 1, behind: 2, dirty: 3, staged: 1 }, agents: [{ name: "Claude", run: ["claude"] }], web: "https://github.com/acme/web", gitView: true },
  "the repository, no remote": { kind: "repo", path: "/r", status: { branch: "main" }, agents: [], web: null },
};
const labelsOf = (menu) => menu.filter((i) => !i.separator).map((i) => i.label);
for (const [name, target] of Object.entries(TARGETS)) {
  test(`git view menu for ${name}: in order`, () => {
    const labels = labelsOf(menuFor(target, ctx(target.kind === "repo" && !target.web ? { remotes: [] } : {})));
    assert.ok(labels.length > 0);
    assert.equal(outOfOrder(labels), null, labels.join(" · "));
  });
}

const P = {
  "a worktree": { path: "/r/.worktrees/wt", branch: "wt", base: "main", behind: 2, repoSpace: "s1", repoName: "web", main: "/r", github: true, editors: [{ label: "VS Code", cli: "code" }] },
  "a worktree with a PR, finished, open as a space": { path: "/r/.worktrees/wt", branch: "wt", base: "main", repoSpace: "s1", repoName: "web", main: "/r", pr: "https://github.com/acme/web/pull/1", finished: "merged", space: "s2", remove: "rm -rf {path}" },
  "a space in a repository": { kind: "space", path: "/r", space: "s1", git: true, branch: "main", linked: true, editors: [{ label: "VS Code", cli: "code" }] },
  "a space, no git": { kind: "space", path: "/tmp", space: "s3" },
};
for (const [name, p] of Object.entries(P)) {
  test(`sidebar menu for ${name}: in order`, () => {
    const labels = items(p).map((it) => it[0]);
    assert.equal(outOfOrder(labels), null, labels.join(" · "));
  });
}

test("the shared items say the same in both menus", () => {
  const git = new Set(Object.values(TARGETS).flatMap((t) => labelsOf(menuFor(t, ctx()))));
  const side = new Set(Object.values(P).flatMap((p) => items(p).map((it) => it[0])));
  for (const key of ["gitView", "fetch", "reveal", "copyPath", "copyBranch", "removeWorktree"]) {
    assert.ok(git.has(WORDS[key].label), `git view: ${WORDS[key].label}`);
    assert.ok(side.has(WORDS[key].label), `sidebar: ${WORDS[key].label}`);
  }
});
