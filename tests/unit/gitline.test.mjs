// The status bar's git line (lib/gitline.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStatus, slugOf, repoName, syncMarks } from "../../lib/gitline.js";

test("parseStatus: branch, upstream, ahead/behind, changes", () => {
  const s = parseStatus("# branch.oid abc\n# branch.head feat/x\n# branch.upstream origin/feat/x\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b f.js\n");
  assert.deepEqual(s, { branch: "feat/x", upstream: "origin/feat/x", ahead: 2, behind: 1, gone: false, dirty: 1 });
});

test("parseStatus: never pushed, upstream gone, detached", () => {
  assert.equal(parseStatus("# branch.head x\n").upstream, null);
  assert.equal(parseStatus("# branch.head x\n# branch.upstream origin/x\n").gone, true);
  assert.equal(parseStatus("# branch.head (detached)\n").branch, null);
});

test("slugOf: GitHub's ssh and https remotes", () => {
  assert.equal(slugOf("git@github.com:acme/web.git\n"), "acme/web");
  assert.equal(slugOf("https://github.com/acme/web"), "acme/web");
  assert.equal(slugOf("https://gitlab.com/acme/web.git"), null);
});

test("repoName: a worktree reads as its repository", () => {
  assert.equal(repoName("/Users/a/Code/web/.git\n"), "web");
  assert.equal(repoName("/srv/web.git"), "web");
});

test("syncMarks: what to push or pull, or that it isn't pushed", () => {
  assert.deepEqual(syncMarks({ branch: "x", upstream: "origin/x", ahead: 2, behind: 0 }).map((m) => m.text), ["↑2"]);
  assert.deepEqual(syncMarks({ branch: "x", upstream: "origin/x", ahead: 0, behind: 3 }).map((m) => [m.text, m.tone]), [["↓3", "pull"]]);
  assert.equal(syncMarks({ branch: "x", upstream: null })[0].text, "not pushed");
  assert.equal(syncMarks({ branch: "x", upstream: "origin/x", gone: true })[0].text, "upstream gone");
  assert.deepEqual(syncMarks({ branch: "x", upstream: "origin/x", ahead: 0, behind: 0 }), []);
});
