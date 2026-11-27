// "Clean up N finished worktrees": only ones that lose nothing go; the rest are named with why.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("./stub-hooks.mjs", import.meta.url);
const { keepReason } = await import("../../mods/worktree-support/main.js");

test("what a bulk clean-up keeps, and why", () => {
  assert.equal(keepReason({ dirty: 0, unpushed: 0, why: "remote gone" }), null);
  assert.equal(keepReason({ dirty: 0, unpushed: 4, why: "merged" }), null, "a merged PR's squash leaves its commits on no remote");
  assert.equal(keepReason({ dirty: 0, unpushed: 1, why: "remote gone" }), "1 unpushed commit");
  assert.equal(keepReason({ dirty: 0, unpushed: 3, why: "PR closed" }), "3 unpushed commits");
  assert.equal(keepReason({ dirty: 2, unpushed: 0, why: "merged" }), "2 uncommitted changes");
  assert.equal(keepReason({ dirty: null, unpushed: 0, why: "merged" }), "couldn't look");
});
