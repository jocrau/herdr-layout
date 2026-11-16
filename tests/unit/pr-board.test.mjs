// pr-board's model: grouping by your next move, the next-step sentence, who's involved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { arrange, nextStep, people, waitingOn, splitTitle, moveOf, ago, actionsFor } from "../../mods/pr-board/model.js";

const row = (stage, over = {}, rec = {}) => ({ key: `o/r#${over.n ?? 1}`, stage, role: "reviewer", title: "t", detail: "", ...over, rec });

test("the pane groups by your next move: actions in order, then waiting, later, dormant", () => {
  const rows = [row("WAITING", { n: 1 }), row("READY", { n: 2 }), row("LOOP_ALARM", { n: 3 }), row("MY_MERGE", { n: 4 }), row("SNOOZED", { n: 5 }), row("DORMANT", { n: 6 }), row("READY", { n: 7 })];
  const blocks = arrange(rows);
  assert.deepEqual(blocks.map((b) => [b.group, b.label, b.rows.length]), [
    ["you", "Decide", 1], ["you", "Review", 2], ["you", "Merge", 1], ["waiting", "Waiting on others", 1], ["later", "Later", 1], ["dormant", "Dormant", 1]]);
  assert.equal(moveOf(row("READY"))[2], "review", "space reviews");
});

test("the next step says what to do; red only for real problems", () => {
  assert.equal(nextStep(row("READY", {}, { reviewedSha: "5a3fd56d950e", open: { high: 1 } })).text, "Re-review what changed since 5a3fd56 · 1 high open");
  assert.equal(nextStep(row("READY", {}, { files: 33 })).text, "First review");
  assert.equal(nextStep(row("READY", {}, {})).problem, false);
  assert.equal(nextStep(row("READY", {}, { conflicts: true })).problem, true);
  const alarm = nextStep(row("LOOP_ALARM", { detail: "3 review rounds already" }));
  assert.equal(alarm.text, "3 review rounds already: talk to the author");
  assert.equal(alarm.problem, true);
  assert.equal(nextStep(row("MY_BLOCKED", {}, { ci: "FAILURE", conflicts: true })).text, "Fix failing CI and the conflicts");
  assert.equal(nextStep(row("MY_MERGE", {}, { ci: "SUCCESS", reviewers: [{ who: "a", state: "APPROVED" }, { who: "b", state: "COMMENTED" }] })).text, "Merge · 1 approved · CI ✓");
});

test("who's involved: the author, then reviewers with what they said; you as 'you'", () => {
  const p = people(row("READY", {}, { author: "vic", reviewers: [{ who: "ann", state: "APPROVED" }, { who: "me", state: "COMMENTED" }], requested: ["bob", "ann"] }), "me");
  assert.equal(p.author, "vic");
  assert.deepEqual(p.others, [{ who: "ann", mark: "✓", pending: false }, { who: "you", mark: "", pending: false }, { who: "bob", mark: "", pending: true }]);
  assert.deepEqual(people(row("READY", {}, { author: "vic" }), "me").others, [{ who: "you", mark: "", pending: true }], "a PR you review names you");
  assert.equal(people(row("MY_PENDING", { role: "author" }, { author: "me" }), "me").author, "you");
});

test("a PR waiting on others says on whom and since when", () => {
  const now = Date.parse("2026-11-16T12:00:00Z");
  assert.deepEqual(waitingOn(row("WAITING", {}, { author: "vic", updated: "2026-11-14T12:00:00Z" }), "me", now), { who: "vic", since: "2d" });
  assert.deepEqual(waitingOn(row("MY_PENDING", { role: "author" }, { author: "me", requested: ["ann"], reviewers: [{ who: "bob", state: "APPROVED" }], updated: "2026-11-16T09:00:00Z" }), "me", now), { who: "ann", since: "3h" });
  assert.equal(waitingOn(row("MY_PENDING", { role: "author" }, { author: "me" }), "me", now).who, "no reviewer yet");
});

test("titles lose their [tag] to a chip; times read 5m, 3h, 2d", () => {
  assert.deepEqual(splitTitle("[Feature] Carbide Data model"), { tag: "Feature", title: "Carbide Data model" });
  assert.deepEqual(splitTitle("feat(cml): x"), { tag: null, title: "feat(cml): x" });
  assert.equal(ago(5 * 60000), "5m");
  assert.equal(ago(3 * 3600000), "3h");
  assert.equal(ago(50 * 3600000), "2d");
});

test("a PR offers only what's possible now: no post, copy or approve before your review", () => {
  assert.deepEqual(actionsFor(row("READY", {}, { files: 8 })), { main: "review", also: [], keep: ["later", "ignore"] });
  assert.deepEqual(actionsFor(row("NEEDS_YOU")).main, "post");
  assert.deepEqual(actionsFor(row("WAITING", { detail: "clean · approve?" })), { main: "approve", also: ["ping", "review"], keep: ["later", "ignore"] });
  assert.equal(actionsFor(row("WAITING", { detail: "2 findings not posted" })).main, "post");
  assert.equal(actionsFor(row("MY_MERGE", { role: "author" })).main, "merge");
  assert.equal(actionsFor(row("MY_BUSY", { role: "author" })).main, null, "an agent is at it");
});
