// pr-board on pr-flow's view model (pr-flow 0.32, capability `view`), and its fallback: run with
// `node --test 'tests/unit/*.test.mjs'`. Items shaped as `queue --format json` gives them (ENGINE.md "View").
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { arrange, nextStep, moveOf, actionsFor, actionOf, waitingOn, readableTimes, withProblem, viewOf } from "../../mods/pr-board/model.js";

register("./stub-hooks.mjs", import.meta.url);
const { verbPlan, jobFor, jobText, detailJob, jobActive, jobDetail, transcriptLines, toolLine, runTime, jobShowArgs, shq } = await import("../../lib/prflow.js");

const act = (verb, kind, role, extra = {}) => ({ verb, label: verb[0].toUpperCase() + verb.slice(1), kind, role, outward: false, confirm: null, disabled_reason: null, ...extra });
const merge = {
  key: "acme/api#149", short: "api#149", stage: "MY_MERGE", rec: { ci: "SUCCESS" },
  move: { group: "you", label: "Merge", order: 5, waiting_on: null },
  next_step: { text: "Merge · 1 approved · CI green", problem: false },
  actions: [act("merge", "session", "primary", { outward: true, confirm: "Merge api#149 on GitHub?" }), act("review", "job", "alternative", { label: "Self-check" }),
    act("show", "script", "housekeeping"), act("open", "script", "housekeeping")],
};
const ready = {
  key: "acme/core#506", short: "core#506", stage: "READY", rec: {},
  move: { group: "you", label: "Review", order: 4, waiting_on: null },
  next_step: { text: "Re-review what changed since 5a3fd56 · 1 high open", problem: false },
  actions: [act("review", "job", "primary", { label: "Re-review" }),
    act("approve", "script", "alternative", { outward: true, confirm: "Approve core#506 on GitHub?", disabled_reason: "new commits since your review at 5a3fd56: re-review first" }),
    act("later", "script", "housekeeping"), act("handback", "script", "housekeeping", { outward: true, confirm: "Hand core#506 back to its author on GitHub?" }),
    act("open", "script", "housekeeping")],
};
const pending = {
  key: "acme/ai#136", short: "ai#136", stage: "MY_PENDING", rec: {},
  move: { group: "waiting", label: "reviewers", order: null, waiting_on: { kind: "reviewers", who: ["sam", "me", "team:platform"], since: "2026-11-04T15:46:09Z" } },
  next_step: { text: "Waiting for sam", problem: false }, actions: [act("ping", "job", "primary")],
};
const snoozed = {
  key: "acme/act#67", short: "act#67", stage: "SNOOZED", rec: { ci: "FAILURE", conflicts: false },
  move: { group: "later", label: "later", order: null, waiting_on: null },
  next_step: { text: "Later: back at 2026-11-30T17:50:00.000Z", problem: true }, actions: [act("review", "job", "primary")],
};

test("with pr-flow's view model the pane groups by its move, in its order, and says its next step", () => {
  assert.deepEqual(moveOf(ready), ["you", "Review", "review", 4]);
  // The order comes from move.order: Review (4) before Merge (5) whatever the listing's order.
  assert.deepEqual(arrange([merge, ready, pending, snoozed]).map((b) => `${b.group}:${b.label}`), ["you:Review", "you:Merge", "waiting:Waiting on others", "later:Later"]);
  assert.deepEqual(nextStep(merge), { text: "Merge · 1 approved · CI green", problem: false });
  // Its Claude tab still outranks pr-flow: a blocked tab is your move.
  assert.deepEqual(moveOf({ ...pending, tab: "blocked" }).slice(0, 2), ["you", "Answer its agent"]);
});

test("its actions by role, open left out; a disabled one is kept and says why", () => {
  assert.deepEqual(actionsFor(ready), { main: "review", also: ["approve"], keep: ["later", "handback"] });
  assert.equal(actionOf(ready, "approve").disabled_reason, "new commits since your review at 5a3fd56: re-review first");
  assert.deepEqual(actionsFor(merge), { main: "merge", also: ["review"], keep: ["show"] });
});

test("whom a PR waits on, from move.waiting_on: you left out, teams by name, since the last push", () => {
  assert.deepEqual(waitingOn(pending, "me", Date.parse("2026-11-06T15:46:09Z")), { who: "sam, platform", since: "2d" });
});

test("times in pr-flow's texts read as dates", () => {
  const now = new Date("2026-11-18T12:00:00Z");
  assert.equal(readableTimes("Later: back at 2026-11-30T17:50:00.000Z", now), "Later: back at 30 Nov");
  assert.equal(readableTimes("No activity since 2025-08-11T19:29:52Z", now), "No activity since 11 Aug 2025");
});

test("shim for pr-flow 0.32.1: a problem the text doesn't name gets its reason from the facts, and nothing more once it does", () => {
  assert.equal(nextStep(snoozed).text.replace(/\d+ Nov/, "D Nov"), "Later: back at D Nov · CI failing");
  assert.equal(nextStep(snoozed).problem, true);
  assert.deepEqual(withProblem({ text: "Later", problem: true }, { conflicts: true }), { text: "Later · conflicts", problem: true });
  const named = { text: "No activity since x · CI failing", problem: true };
  assert.equal(withProblem(named, { ci: "FAILURE", conflicts: true }), named);
  assert.deepEqual(withProblem({ text: "Waiting", problem: false }, { ci: "FAILURE" }), { text: "Waiting", problem: false });
});

test("without the view model (an older pr-flow) the board's own tables still decide", () => {
  const old = { key: "a/b#1", short: "b#1", stage: "READY", rec: { reviewedSha: "abcdef1234" }, detail: "" };
  assert.equal(viewOf(old), null);
  assert.deepEqual(moveOf(old), ["you", "Review", "review", 5]);
  assert.equal(nextStep(old).text, "Re-review what changed since abcdef1");
  assert.equal(actionsFor(old).main, "review");
  assert.equal(verbPlan(old, "approve", {}).confirm, "Approve b#1? pr-flow checks it's ready first, then approves under your account.");
  assert.equal(verbPlan(old, "review", { review: { kind: "agent" } }).kind, "agent");
});

test("how a verb runs from pr-flow's action: a session in the tab without asking, an outward script asks in pr-flow's words, a disabled one doesn't run", () => {
  assert.deepEqual(verbPlan(merge, "merge", {}), { kind: "agent", confirm: null, disabled: null, label: "Merge" });
  assert.deepEqual(verbPlan(ready, "review", {}), { kind: "job", confirm: null, disabled: null, label: "Re-review" });
  assert.equal(verbPlan(ready, "handback", {}).confirm, "Hand core#506 back to its author on GitHub?");
  assert.equal(verbPlan(ready, "approve", {}).disabled, "new commits since your review at 5a3fd56: re-review first");
});

test("a PR's job on its row: the item's own, else a running one, else one that failed in the last hour", () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  const q = { jobs: [
    { id: "j1", key: "acme/core#506", verb: "review", state: "done", ended_at: "2026-11-18T11:00:00Z" },
    { id: "j2", key: "acme/core#506", verb: "review", state: "running", phase: "reading the diff", fraction: 0.4 },
    { id: "j3", key: "acme/ai#136", verb: "ping", state: "failed", error: "no runtime", ended_at: "2026-11-18T11:30:00Z" },
    { id: "j4", key: "acme/act#67", verb: "review", state: "failed", error: "old", ended_at: "2026-11-18T09:00:00Z" },
  ] };
  assert.equal(jobFor(q, { key: "acme/core#506" }, now).id, "j2");
  assert.equal(jobFor(q, { key: "acme/core#506", job: "j1" }, now).id, "j1");
  assert.equal(jobFor(q, { key: "acme/ai#136" }, now).id, "j3");
  assert.equal(jobFor(q, { key: "acme/act#67" }, now), null);
  assert.equal(jobFor({}, { key: "x" }, now), null);
  assert.equal(jobText(q.jobs[1]), "review 40% · reading the diff");
  assert.equal(jobText(q.jobs[2]), "ping failed: no runtime");
  assert.equal(jobText({ verb: "review", state: "queued" }), "review queued");
});

test("a PR's job in its details: the row's, else its latest ended one; what it's doing or why it failed", () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  const q = { jobs: [
    { id: "j2", key: "acme/core#506", verb: "review", state: "running", phase: "reading the diff", fraction: 0.4, started_at: "2026-11-18T11:57:00Z", runtime: "claude", model: "opus", effort: "high" },
    { id: "j1", key: "acme/core#506", verb: "review", state: "done", started_at: "2026-11-18T10:00:00Z", ended_at: "2026-11-18T10:12:00Z", cost: 0.42 },
    { id: "j5", key: "acme/web#9", verb: "check", state: "cancelled", started_at: "2026-11-18T09:00:00Z", ended_at: "2026-11-18T09:00:20Z" },
    { id: "j4", key: "acme/act#67", verb: "review", state: "failed", error: "the answer does not match the schema", started_at: "2026-11-18T08:00:00Z", ended_at: "2026-11-18T08:30:00Z" },
  ] };
  assert.equal(detailJob(q, { key: "acme/core#506" }, now).id, "j2");
  assert.equal(detailJob(q, { key: "acme/web#9" }, now).id, "j5"); // not on the row, still in the details
  assert.equal(detailJob(q, { key: "acme/act#67" }, now).id, "j4"); // failed hours ago: off the row, in the details
  assert.equal(detailJob(q, { key: "acme/none#1" }, now), null);
  assert.equal(detailJob(null, { key: "x" }, now), null);
  assert.ok(jobActive(q.jobs[0]) && jobActive({ state: "queued" }) && !jobActive(q.jobs[1]) && !jobActive(null));
  assert.deepEqual(jobDetail(q.jobs[0], now), { state: "review running · 40% · reading the diff · 3m", meta: "claude · opus · high · j2", error: null });
  assert.deepEqual(jobDetail(q.jobs[1], now), { state: "review done after 12m · $0.42", meta: "j1", error: null });
  assert.equal(jobDetail(q.jobs[2], now).state, "check stopped · after <1m");
  assert.deepEqual(jobDetail(q.jobs[3], now), { state: "review failed after 30m", meta: "j4", error: "the answer does not match the schema" });
  assert.equal(jobDetail({ id: "j6", verb: "review", state: "failed" }, now).error, "pr-flow gave no reason");
  assert.equal(jobDetail({ id: "j7", verb: "review", state: "queued" }, now).state, "review queued");
  assert.equal(jobDetail(null), null);
  assert.equal(jobDetail(q.jobs[1], now, "self-check").state, "self-check done after 12m · $0.42");
});

// Claude's stream-json, as a job's work/transcript.jsonl has it (ENGINE.md "Jobs"), one event per line.
const ev = (o) => JSON.stringify(o);
const say = (...content) => ev({ type: "assistant", message: { content } });
const back = (...content) => ev({ type: "user", message: { content } });
const transcript = [
  ev({ type: "system", subtype: "init", cwd: "/s/jobs/x/work", tools: ["Bash"] }),
  back({ type: "text", text: "Review PR #42" }), // the prompt
  say({ type: "thinking", thinking: "", signature: "abc" }),
  ev({ type: "system", subtype: "thinking_tokens", tokens: 120 }),
  say({ type: "text", text: "Reading the diff first.\n\nThen the tests." }),
  say({ type: "tool_use", id: "t1", name: "Bash", input: { command: "gh pr diff 42\n# and more", description: "diff" } }),
  back({ type: "tool_result", tool_use_id: "t1", content: "diff --git …" }),
  say({ type: "tool_use", id: "t2", name: "Read", input: { file_path: "/Users/me/x/api.py", offset: 3 } }),
  say({ type: "tool_use", id: "t3", name: "Grep", input: { pattern: "cache_clear", path: "/Users/me/x" } }),
  say({ type: "tool_use", id: "t4", name: "ReportFindings", input: { summary: "two lows\nmore" } }),
  ev({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } }),
  ev({ type: "system", subtype: "permission_denied", tool_name: "Bash", tool_use_id: "t5", message: "Permission to use Bash with command rm -rf x has been denied." }),
  back({ type: "tool_result", tool_use_id: "t5", is_error: true, content: "Permission to use Bash with command rm -rf x has been denied." }),
  back({ type: "tool_result", tool_use_id: "t6", is_error: true, content: [{ type: "text", text: "Exit code 1\nfatal: not a git repository" }] }),
  "not json {",
  say({ type: "text", text: "```json\n{\"findings\":[]}\n```" }),
  ev({ type: "result", subtype: "success", is_error: false, duration_ms: 275000, total_cost_usd: 2.1484924 }),
].join("\n");

test("a job's transcript as the tail's lines: words, one line per call, errors once, the result; the rest left out", () => {
  assert.deepEqual(transcriptLines(transcript, { home: "/Users/me" }), [
    { text: "Reading the diff first.", kind: "text" },
    { text: "Then the tests.", kind: "text" },
    { text: "$ gh pr diff 42", kind: "command" },
    { text: "read ~/x/api.py", kind: "command" },
    { text: "grep cache_clear ~/x", kind: "command" },
    { text: "ReportFindings two lows", kind: "command" },
    { text: "✗ Permission to use Bash with command rm -rf x has been denied.", kind: "error" },
    { text: "✗ Exit code 1 · fatal: not a git repository", kind: "error" },
    { text: "{…} the answer, as JSON for pr-flow", kind: "text" },
    { text: "done · 4m 35s · $2.15", kind: "mark" },
  ]);
  // The last bytes of a big file: the first, cut line is dropped; only the last `max` lines are kept.
  const cut = transcript.slice(transcript.indexOf("rate_limit") - 5);
  assert.equal(transcriptLines(cut, { partial: true })[0].kind, "error");
  assert.deepEqual(transcriptLines(transcript, { max: 2 }).map((l) => l.kind), ["text", "mark"]);
  assert.deepEqual(transcriptLines(ev({ type: "result", subtype: "error_max_turns", is_error: true, duration_ms: 30000 })), [{ text: "ended: error max turns · 30s", kind: "error" }]);
  assert.deepEqual(transcriptLines(""), []);
  assert.equal(toolLine("Read", { file_path: "/Users/me/.claude/projects/p/s/tool-results/b4.txt" }, "/Users/me"), "read an earlier call's saved output");
  assert.equal(toolLine("WebSearch", { query: "linkml cache" }), "search linkml cache");
  assert.equal(toolLine("Mystery", {}), "Mystery");
  assert.equal(runTime(3_725_000), "1h 02m");
  assert.equal(runTime(-1), null);
});

test("how a terminal shows a job (the tail's terminal button)", () => {
  assert.deepEqual(jobShowArgs({ id: "x", state: "running" }), ["job", "show", "x", "--follow"]);
  assert.deepEqual(jobShowArgs({ id: "x", state: "queued" }), ["job", "show", "x", "--follow"]);
  assert.deepEqual(jobShowArgs({ id: "x", state: "failed" }), ["job", "show", "x"]);
  assert.equal(shq("/opt/homebrew/bin/node"), "/opt/homebrew/bin/node");
  assert.equal(shq("PR_FLOW_STATE=/tmp/a b"), "'PR_FLOW_STATE=/tmp/a b'");
  assert.equal(shq("it's"), "'it'\\''s'");
});

test("findingsText: open findings in a few words, most severe first", async () => {
  const { findingsText } = await import("../../lib/prflow.js");
  assert.equal(findingsText({ low: 2 }), "2 low");
  assert.equal(findingsText({ low: 2 }, true), "2 low findings");
  assert.equal(findingsText({ high: 1 }, true), "1 high finding");
  assert.equal(findingsText({ low: 2, high: 1, medium: 0 }), "1 high, 2 low");
  assert.equal(findingsText({}), "");
  assert.equal(findingsText(null), "");
});

test("a job on your own PR is a self-check, its phase in words, and it doesn't make an idle tab wait on you", async () => {
  const { jobText, jobLabel, phaseText } = await import("../../lib/prflow.js");
  const { agentWaits, nextStep } = await import("../../mods/pr-board/model.js");
  const own = { key: "o/r#42", stage: "MY_BUSY", role: "author", tab: "idle", job: "job-20260301-101500-review-42-a1b2" };
  const j = { id: own.job, key: own.key, verb: "review", state: "running", phase: 'running gh api "repos/x/y/pulls/42"' };
  assert.equal(jobLabel(j, own), "self-check");
  assert.equal(jobLabel(j, { stage: "READY", role: "reviewer" }), "review");
  assert.equal(jobText(j, own), "self-check · reading GitHub");
  assert.equal(phaseText("running git diff main...HEAD"), "reading the code");
  assert.equal(phaseText("running npm test"), "running npm");
  assert.equal(phaseText("checking tests"), "checking tests");
  assert.equal(agentWaits(own), false);
  assert.equal(agentWaits({ ...own, job: null }), true);
  const view = { ...own, move: { group: "waiting", label: "x" }, actions: [], next_step: { text: "job-20260301-101500-review-42-a1b2 working since 19:53 · 2 check findings open", problem: false } };
  assert.equal(nextStep(view).text.startsWith("a job working since 19:53"), true);
});
