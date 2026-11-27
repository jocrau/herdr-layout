// The sidebar's Remove worktree asks with the git view's dialog: removeFrom reads the repository as the graph would
// see it from the main checkout, for the worktree a folder is in (a real throwaway repository).
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
register("./stub-hooks.mjs", import.meta.url);

test("removeFrom: the worktree a folder is in, its branch, and the main checkout's context", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "wt-rm-")));
  const sh = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString();
  try {
    const main = join(dir, "main"); mkdirSync(main);
    sh(main, "init", "-q", "-b", "main"); sh(main, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one");
    sh(main, "worktree", "add", "-q", "-b", "fix/x", join(dir, "fix-x"));
    mkdirSync(join(dir, "fix-x", "sub"));
    globalThis.__herdrStubs = { exec: async (program, args, opts) => {
      try { return { code: 0, stdout: execFileSync(program, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] }).toString(), stderr: "" }; }
      catch (e) { return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" }; }
    } };
    const { removeFrom } = await import("../../mods/git-graph/act.js");
    const { commandsFor } = await import("../../mods/git-graph/git.js");
    const { action, ctx } = await removeFrom(join(dir, "fix-x", "sub"), null);
    assert.deepEqual(action, { type: "removeWorktree", name: "fix/x", path: join(dir, "fix-x") });
    assert.equal(ctx.root, main); assert.equal(ctx.current, "main");
    assert.equal(ctx.worktrees["fix/x"], join(dir, "fix-x"));
    assert.doesNotThrow(() => commandsFor(action, { branch: true }, ctx), "the graph's own checks accept it");
    await assert.rejects(removeFrom(main, null), /main checkout/);
  } finally {
    delete globalThis.__herdrStubs;
    rmSync(dir, { recursive: true, force: true });
  }
});
