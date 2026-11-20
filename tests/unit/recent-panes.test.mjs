// The option+tab switcher's order (lib/recent.js): most recent first, gone panes out, unseen ones after.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("./stub-hooks.mjs", import.meta.url);
const { recentRows } = await import("../../lib/recent.js");

const spaces = [
  { id: "s1", name: "Dev", tabs: [{ id: "t1", name: "Dev" }, { id: "t2", name: "2" }] },
  { id: "s2", name: "TSDB", tabs: [{ id: "t3", name: "tuning" }] },
];
const panes = [
  { pane: "p1", tab: "t1", terminal: "a", title: "claude", focused: true, status: "working" },
  { pane: "p2", tab: "t2", terminal: "b", title: "zsh ~/Code", status: null },
  { pane: "p5", tab: "t2", terminal: "e", title: "e", cwd: "/tmp/code/handbook/", program: { name: "zsh" } },
  { pane: "p3", tab: "t3", terminal: "c", title: "claude", status: "idle" },
  { pane: "p4", tab: "t3", mod: "git-graph", terminal: null, title: "git-graph" },
];
const agents = [{ pane: "p1", tab_name: "Dev", title: "✳ Claude" }, { pane: "p3", tab_name: "tuning", title: "✳ Claude" }];

test("recent panes: most recent first across spaces, gone ones dropped, never-focused ones after", () => {
  const rows = recentRows(["p3", "gone", "p1"], panes, spaces, agents);
  assert.deepEqual(rows.map((r) => r.pane), ["p3", "p1", "p2", "p5", "p4"]);
  assert.deepEqual(rows.map((r) => r.spaceName), ["TSDB", "Dev", "Dev", "Dev", "TSDB"]);
});

test("recent panes: an agent reads by its tab's name, a shell by its title, a mod pane by its mod", () => {
  const rows = recentRows([], panes, spaces, agents);
  assert.deepEqual(rows.map((r) => r.title), ["Dev", "zsh ~/Code", "zsh · handbook", "tuning", "git-graph"]);
  assert.equal(rows[0].focused, true);
  assert.equal(rows[3].agent, true);
});

test("recent panes: a pane whose tab isn't in any space is left out; no list at all is fine", () => {
  assert.deepEqual(recentRows(null, [{ pane: "x", tab: "nowhere" }], spaces).length, 0);
});
