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
  assert.deepEqual(splitTitle("[Feature] Login form"), { tag: "Feature", title: "Login form" });
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

test("an agent that stopped to ask is your move; one still working waits", () => {
  assert.equal(moveOf(row("MY_BUSY", { role: "author", tab: "working" }))[0], "waiting", "working: waiting on it");
  assert.equal(moveOf(row("REVIEWING"))[0], "waiting", "no tab (a background job): waiting");
  for (const tab of ["done", "idle", "blocked"]) {
    const r = row("MY_BUSY", { role: "author", tab, detail: "pre-merge check" });
    assert.deepEqual(moveOf(r).slice(0, 2), ["you", "Answer its agent"], tab);
    assert.equal(actionsFor(r).main, null, "the answer goes in its tab");
  }
  assert.equal(nextStep(row("REVIEWING", { tab: "done" })).text, "Its agent stopped and waits for you: answer in its tab");
  assert.equal(moveOf(row("WAITING", { tab: "idle" }))[0], "waiting", "an idle tab beside a PR waiting on its author");
  assert.equal(moveOf(row("WAITING", { tab: "blocked" }))[1], "Answer its agent", "a blocked tab waits on you whatever the stage");
  const blocks = arrange([row("READY", { n: 1 }), row("LOOP_ALARM", { n: 2 }), row("REVIEWING", { n: 3, tab: "done" })]);
  assert.equal(blocks[0].label, "Answer its agent", "first in Your move");
});

// herdr-prboard.facts: the queue from pr-flow's listing facts (0.30.0) or, before, from its records.
import { register } from "node:module";
register("./stub-hooks.mjs", import.meta.url);
const { queueArgs, fromListing, recordOf } = await import("../../lib/prflow.js");

const FACTS = {
  head_ref: "login-form", base_ref: "main", head_sha: "abc123", ci: "FAILURE", review_decision: "CHANGES_REQUESTED",
  draft: false, conflicts: true, threads: { unresolved: 2, awaiting_reviewer: 1, awaiting_author: 1 }, reviewed_sha: "def456",
  open_findings: { high: 1, low: 2 }, pr_author: "vic", requested: ["ann", "team:qa"], reviews: [{ who: "bob", state: "APPROVED" }],
  last_push_at: "2026-11-16T09:00:00Z", updated_at: "2026-11-16T10:00:00Z", rounds: 2, summary: "Adds a login form.", reasons: ["new commits"], files: 7,
};

test("with facts and --no-save, the board reads the queue quietly and takes each PR's facts from it", () => {
  assert.deepEqual(queueArgs(new Set(["nosave", "facts"])).args, ["queue", "--format", "json", "--no-save"]);
  assert.deepEqual(queueArgs(new Set(["nosave", "facts"]), { sync: true, maxAge: "5m" }).args, ["sync", "--max-age", "5m", "--format", "json", "--no-save"]);
  const got = fromListing({ login: "me", warnings: ["a", "b", "c", "d"], sections: [{ items: [{ key: "o/r#1", facts: FACTS }, { key: "o/r#2", facts: null }] }] });
  assert.equal(got.me, "me");
  assert.deepEqual(got.warnings, ["b", "c", "d"]);
  assert.deepEqual(Object.keys(got.records), ["o/r#1"], "unknown facts: no record");
  assert.deepEqual(got.records["o/r#1"], {
    headRef: "login-form", baseRef: "main", headSha: "abc123", ci: "FAILURE", decision: "CHANGES_REQUESTED", draft: false, conflicts: true,
    threads: { unresolved: 2, awaitingReviewer: 1, awaitingAuthor: 1 }, reviewedSha: "def456", open: { high: 1, low: 2 }, reasons: ["new commits"],
    author: "vic", requested: ["ann", "qa"], reviewers: [{ who: "bob", state: "APPROVED" }], lastPush: "2026-11-16T09:00:00Z",
    updated: "2026-11-16T10:00:00Z", rounds: 2, about: "Adds a login form.", files: 7,
  });
  assert.deepEqual(recordOf({ draft: null, threads: null }), {
    headRef: null, baseRef: null, headSha: null, ci: null, decision: null, draft: false, conflicts: false, threads: null, reviewedSha: null,
    open: {}, reasons: [], author: null, requested: [], reviewers: [], lastPush: null, updated: null, rounds: 0, about: null, files: null,
  }, "nulls where pr-flow doesn't know");
  assert.deepEqual(fromListing({ sections: [] }), { records: {}, me: null, warnings: [] }, "an empty queue needs no records either");
});

test("with an older pr-flow, the board reads as before: no --no-save, records from its state folder", () => {
  for (const caps of [new Set(), new Set(["nosave"]), new Set(["facts"])]) {
    assert.deepEqual(queueArgs(caps), { facts: false, args: ["queue", "--format", "json"] });
  }
  assert.equal(fromListing({ sections: [{ items: [{ key: "o/r#1" }] }] }), null, "items without facts: read the records");
});

test("later from the board hides a PR until the next working day's morning; other verbs go as typed", async () => {
  const { shorthandFor } = await import("../../lib/prflow.js");
  const day = (d) => new Date(2026, 10, d, 15, 0); // Nov 2026: the 16th is a Monday
  assert.equal(shorthandFor("later", "acme-api#506", day(16)), "later acme-api#506 tomorrow");
  assert.equal(shorthandFor("later", "acme-api#506", day(19)), "later acme-api#506 tomorrow", "Thursday: Friday");
  assert.equal(shorthandFor("later", "acme-api#506", day(20)), "later acme-api#506 mon", "Friday: Monday");
  assert.equal(shorthandFor("later", "acme-api#506", day(21)), "later acme-api#506 mon", "Saturday: Monday");
  assert.equal(shorthandFor("later", "acme-api#506", day(22)), "later acme-api#506 tomorrow", "Sunday: Monday");
  assert.equal(shorthandFor("ignore", "acme-api#506"), "ignore acme-api#506");
});

test("a new PR tab starts from pr-flow's prompt when there is one, else from the typed shorthand", async () => {
  const { newTab } = await import("../../lib/prflow.js");
  const prompt = "You are picking up one pull request…\nTask (fix): …";
  assert.deepEqual(newTab("acme/api#7", { space: "s1", folder: "/c/api", text: "/pr-flow:inbox fix api#7", start: prompt }),
    { name: "api#7", space: "s1", folder: "/c/api", argv: ["claude", prompt], focus: true });
  assert.deepEqual(newTab("acme/api#7", { space: null, folder: null, text: "/pr-flow:inbox fix api#7", start: null }),
    { name: "api#7", argv: ["claude"], task: "/pr-flow:inbox fix api#7", focus: true });
});

test("a tab to talk about a PR starts from its context and takes no action", async () => {
  const { talkPrompt } = await import("../../lib/prflow.js");
  const row = { title: "Login form", url: "https://github.com/acme/acme-api/pull/506", role: "reviewer", rec: { headRef: "login-form", baseRef: "main" } };
  const p = talkPrompt("acme/acme-api#506", row, "/c/acme-api");
  assert.match(p, /^Let's talk about pull request acme-api#506: "Login form" \(https:\/\/github.com\/acme\/acme-api\/pull\/506\)\./);
  assert.match(p, /I'm a reviewer on it\.\nIts branch is login-form, into main\.\nThis folder is a checkout of acme\/acme-api/);
  assert.match(p, /gh pr view 506 --comments, gh pr diff 506/);
  assert.match(p, /conversation only: don't post/);
  const bare = talkPrompt("acme/acme-api#7", { role: "author" }, null);
  assert.match(bare, /\(https:\/\/github.com\/acme\/acme-api\/pull\/7\)\.\nIt's my PR\.\nThere's no local checkout of acme\/acme-api; use gh \(`--repo acme\/acme-api`\)\./);
});
