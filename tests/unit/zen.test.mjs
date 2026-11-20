// Zen mode's plan (lib/zen.js): which blocks ⌘. hides and shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { zenPlan } from "../../lib/zen.js";

const tree = ({ tabs = false, status = false, sidebar = false } = {}) => ({ id: "root", children: [
  { id: "sidebar", hidden: sidebar, children: [] },
  { id: "work", children: [{ id: "tabs", hidden: tabs }, { id: "main" }, { id: "status", hidden: status }] },
  { id: "prs", hidden: false },
] });

test("zen on: hides the tab bar, the status bar and the sidebar, and remembers the sidebar was open", () => {
  assert.deepEqual(zenPlan(tree(), undefined), { steps: [["layout.hide", "tabs"], ["layout.hide", "status"], ["layout.hide", "sidebar"]], remember: false });
});

test("zen on with the sidebar already hidden: remembers that", () => {
  assert.equal(zenPlan(tree({ sidebar: true })).remember, true);
});

test("zen off: shows the bars, and the sidebar only if it was open before", () => {
  const on = tree({ tabs: true, status: true, sidebar: true });
  assert.deepEqual(zenPlan(on, false).steps, [["layout.show", "tabs"], ["layout.show", "status"], ["layout.show", "sidebar"]]);
  assert.deepEqual(zenPlan(on, true).steps, [["layout.show", "tabs"], ["layout.show", "status"]]);
  assert.equal(zenPlan(on, true).remember, undefined);
});

test("zen leaves blocks a layout doesn't have alone", () => {
  assert.deepEqual(zenPlan({ id: "root", children: [{ id: "tabs" }] }).steps, [["layout.hide", "tabs"]]);
});
