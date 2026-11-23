// git-graph's links to GitHub (mods/git-graph/git.js): #123 in commit messages, the PR chips' click targets, URLs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("./stub-hooks.mjs", import.meta.url);
const { mentions, hitChip, chipWidth, LABEL, prUrl, commitUrl, branchUrl, issueUrl } = await import("../../mods/git-graph/git.js");

test("#123 in a message, not in a word, an entity, a URL or a heading", () => {
  assert.deepEqual(mentions("Merge pull request #232 from x/y"), [{ text: "Merge pull request " }, { text: "#232", n: 232 }, { text: " from x/y" }]);
  assert.deepEqual(mentions("#7 first"), [{ text: "#7", n: 7 }, { text: " first" }]);
  assert.deepEqual(mentions("fixes (#12), #13."), [{ text: "fixes (" }, { text: "#12", n: 12 }, { text: "), " }, { text: "#13", n: 13 }, { text: "." }]);
  for (const s of ["abc#12", "&#39; quote", "see https://x.y/z#12", "## 12 heading", "color #fff", "#12abc"]) assert.deepEqual(mentions(s), [{ text: s }], s);
  assert.deepEqual(mentions(""), [{ text: "" }]);
});

test("a click lands on the PR chip after the labels, not on the labels or the gap", () => {
  const labels = [{ width: 100 }, { width: 50 }], chips = [{ width: 80, url: "a" }, { width: 40, url: "b" }];
  const start = 60, first = start + LABEL.GAP + 100 + LABEL.GAP + 50 + LABEL.GAP;
  assert.equal(hitChip(labels, chips, first - 1, start), null);
  assert.equal(hitChip(labels, chips, first, start).url, "a");
  assert.equal(hitChip(labels, chips, first + 79, start).url, "a");
  assert.equal(hitChip(labels, chips, first + 80 + LABEL.GAP, start).url, "b");
  assert.equal(hitChip(labels, chips, first + 80 + 2, start), null);
  assert.equal(hitChip(labels, chips, first, start, first), null, "past the description column");
  assert.equal(hitChip([], [], 100, 0), null);
  assert.ok(chipWidth("232", "agents at work") > chipWidth("7", "later"));
});

test("GitHub URLs", () => {
  const web = "https://github.com/acme/web";
  assert.equal(prUrl(web, 232), `${web}/pull/232`);
  assert.equal(issueUrl(web, 5), `${web}/issues/5`);
  assert.equal(commitUrl(web, "3a4d21f"), `${web}/commit/3a4d21f`);
  assert.equal(branchUrl(web, "fleet/pr-flow.followups"), `${web}/tree/fleet/pr-flow.followups`);
  assert.equal(branchUrl(web, "feat/a#b c"), `${web}/tree/feat/a%23b%20c`);
});

test("the menus offer GitHub pages when origin is on GitHub", async () => {
  const { menuFor } = await import("../../mods/git-graph/git.js");
  const web = "https://github.com/acme/web", commit = { hash: "abc1234def", parents: ["p"], subject: "s" };
  const ctx = { current: "main", head: "zzz", branches: ["main", "feat"], remotes: ["origin", "fork"], tracking: { feat: { short: "origin/feat", upstream: "refs/remotes/origin/feat" } }, worktrees: {}, web };
  const urls = (target, c = ctx) => menuFor(target, c).filter((i) => i.action?.type === "openUrl").map((i) => i.action.url);
  assert.deepEqual(urls({ kind: "commit", commit }), [`${web}/commit/abc1234def`]);
  assert.deepEqual(urls({ kind: "remote", name: "origin/feat", commit }), [`${web}/tree/feat`]);
  assert.deepEqual(urls({ kind: "remote", name: "fork/feat", commit }), []);
  assert.deepEqual(urls({ kind: "branch", name: "feat", commit }), [`${web}/tree/feat`]);
  assert.deepEqual(urls({ kind: "branch", name: "main", commit }), []);
  assert.deepEqual(urls({ kind: "commit", commit }, { ...ctx, web: null }), []);
});
