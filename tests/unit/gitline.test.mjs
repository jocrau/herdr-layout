// The status bar's git line (lib/gitline.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStatus, slugOf, repoName, syncMarks, repoMenuProps } from "../../lib/gitline.js";

test("parseStatus: branch, upstream, ahead/behind, changes", () => {
  const s = parseStatus("# branch.oid abc1234\n# branch.head feat/x\n# branch.upstream origin/feat/x\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b f.js\n1 A. N... 000000 100644 100644 a b g.js\n");
  assert.deepEqual(s, { head: "abc1234", branch: "feat/x", upstream: "origin/feat/x", ahead: 2, behind: 1, gone: false, dirty: 2, staged: 1 });
  assert.equal(parseStatus("# branch.oid (initial)\n# branch.head main\n").head, null, "no commit yet");
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

test("repoMenuProps: the git view's repository menu for the status bar's branch, as tall as git-graph draws it", async () => {
  const { menuFor, menuHeight } = await import("../../mods/git-graph/git.js");
  const g = { head: "abc1234", branch: "main", upstream: "origin/main", ahead: 0, behind: 34, gone: false, dirty: 0, staged: 0, slug: "o/r" };
  for (const st of [g, { ...g, dirty: 2, staged: 1, ahead: 1 }, { ...g, upstream: null, slug: null }]) {
    const m = repoMenuProps(st, ["origin"], { root: "/r" });
    const items = menuFor(m.target, m.ctx);
    assert.equal(m.height, menuHeight(items));
    assert.ok(!st.upstream || items.find((i) => i.action?.type === "pull"), "pull offered");
  }
  assert.equal(repoMenuProps(g, ["origin"], { root: "/r" }).ctx.root, "/r");
  const first = menuFor(repoMenuProps(g, ["origin"], { root: "/r" }).target, { root: "/r", remotes: ["origin"], branches: [] })[0];
  assert.deepEqual([first.label, first.action], ["Open in git view", { type: "openGitView", folder: "/r" }]);
  assert.equal(repoMenuProps(null, [], { root: "/r" }), null);
});

test("behind: a dialog keeps the window's keys; docked, the mod runs them as the global key would", async () => {
  const { behindCommand, passBehind, BEHIND_KEYS } = await import("../../lib/behind.js");
  assert.deepEqual(behindCommand("behind.tab.prev"), { name: "tab.prev", args: {} });
  assert.deepEqual(behindCommand("behind.tab.select.3"), { name: "tab.select", args: { index: 3 } });
  assert.deepEqual(behindCommand("behind.pane.go.left"), { name: "pane.go", args: { direction: "left" } });
  assert.equal(behindCommand("prev-pr"), null);
  const ran = [];
  const run = (n, a) => ran.push([n, a]);
  assert.equal(passBehind("behind.space.next", true, run), true);
  assert.deepEqual(ran, [], "in a dialog: kept");
  assert.equal(passBehind("behind.space.next", false, run), true);
  assert.deepEqual(ran, [["space.next", {}]], "docked: run");
  assert.equal(passBehind("leave", false, run), false);
  for (const cmd of Object.values(BEHIND_KEYS)) assert.ok(behindCommand(`behind.${cmd}`), cmd);
});
