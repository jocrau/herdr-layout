// The PR view's helpers (mods/git-graph/pr.js): run with `node --test 'tests/unit/*.test.mjs'`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./stub-hooks.mjs", import.meta.url);
const { changedLines, wrapText } = await import("../../mods/git-graph/pr.js");

test("the lines a PR changed are the new side's lines of each hunk; a deletion-only hunk changes none", () => {
  const diff = "diff --git a/x b/x\n@@ -3,0 +4,2 @@\n+a\n+b\n@@ -10 +12 @@\n-c\n+d\n@@ -20,2 +21,0 @@\n-e\n-f\n";
  assert.deepEqual([...changedLines(diff)].sort((a, b) => a - b), [4, 5, 12]);
  assert.equal(changedLines("").size, 0);
});

test("text wraps between words at the width; a longer word gets a line of its own", () => {
  assert.deepEqual(wrapText("one two three four", 9), ["one two", "three", "four"]);
  assert.deepEqual(wrapText("a supercalifragilistic b", 5), ["a", "supercalifragilistic", "b"]);
  assert.deepEqual(wrapText("", 10), [""]);
});

test("look-ats are read as places whether pr-flow gave objects or 'path:line — why' text; one without a place is left out", async () => {
  const { PrMethods } = await import("../../mods/git-graph/pr.js");
  const look_at = [{ path: "a.js", line: 3, end_line: null, why: "w" }, "c.js:1 — y", "src/d.ts:10-14 – range", { why: "no path" }, "not a reference"];
  assert.deepEqual(PrMethods.prLooks.call({ pr: { notes: { explainer: { look_at } } } }), [
    { path: "a.js", line: 3, end_line: null, why: "w" },
    { path: "c.js", line: 1, end_line: null, why: "y" },
    { path: "src/d.ts", line: 10, end_line: 14, why: "range" },
  ]);
});

test("the reading path goes in the file list's order, then by line, a finding before a place on its line", async () => {
  const { readingPath } = await import("../../mods/git-graph/pr.js");
  const findings = [{ path: "b.js", line: 9 }, { path: "a.js", line: 5 }, { path: "z.js", line: 1 }];
  const looks = [{ path: "a.js", line: 5 }, { path: "b.js", line: 2 }];
  assert.deepEqual(readingPath(findings, looks, ["b.js", "a.js"]).map((x) => `${x.kind}${x.i}`), ["l1", "f0", "f1", "l0", "f2"]);
});

test("blob ids by path from ls-tree; a path it doesn't list is gone at that commit", async () => {
  const { blobsOf } = await import("../../mods/git-graph/pr.js");
  const out = "100644 blob aaa111\tsrc/a b.js\u0000100755 blob bbb222\trun.sh\u0000";
  assert.deepEqual([...blobsOf(out, ["src/a b.js", "run.sh", "gone.js"])], [["src/a b.js", "aaa111"], ["run.sh", "bbb222"], ["gone.js", "-"]]);
});

test("the PR view's files: those the notes point at first, then the rest, the noise (deleted, lockfiles, generated) folded last", async () => {
  const { shapeFiles, FOLD } = await import("../../mods/git-graph/pr.js");
  const f = (path, status = "M", add = 1, del = 0) => ({ path, status, add, del });
  const files = [f("a.js"), f("old.js", "D", 0, 80), f("package-lock.json", "M", 300, 200), f("b.js"), f("web/dist/app.min.js", "A", 900)];
  const { files: out, noise } = shapeFiles(files, new Set(["b.js"]));
  assert.deepEqual(out.slice(0, 2).map((x) => x.path), ["b.js", "a.js"]);
  assert.deepEqual(out[2], { path: FOLD, fold: true, status: "", count: 3, add: 1200, del: 280, kinds: { deleted: 1, lockfile: 1, generated: 1 } });
  assert.deepEqual(noise.map((x) => x.path), ["old.js", "package-lock.json", "web/dist/app.min.js"]);
  // A file with a finding stays up even when deleted; one noise file, or folding turned off, isn't folded.
  assert.deepEqual(shapeFiles(files, new Set(["old.js"])).files[0].path, "old.js");
  assert.deepEqual(shapeFiles([f("a.js"), f("yarn.lock")], new Set()).files.map((x) => x.path), ["a.js", "yarn.lock"]);
  assert.equal(shapeFiles(files, new Set(), false).files.some((x) => x.fold), false);
});

test("open review threads: resolved ones left out, an outdated one on its original line, comments on one line", async () => {
  const { reviewThreads, readingPath, resolveQuery } = await import("../../mods/git-graph/pr.js");
  const openThreads = (d) => reviewThreads(d).open.map(({ id, resolved, ...x }) => x);
  const node = (over) => ({ isResolved: false, isOutdated: false, path: "a.js", line: 4, originalLine: 3, comments: { nodes: [{ author: { login: "ann" }, body: "Why\n\nthis?" }] }, ...over });
  const data = { data: { repository: { pullRequest: { reviewThreads: { nodes: [
    node({}), node({ isResolved: true }), node({ isOutdated: true, line: null, comments: { nodes: [{ author: null, body: "```suggestion\nx = 1\n```" }, { author: { login: "bo" }, body: "ok" }] } }),
  ] } } } } };
  const xs = openThreads(data);
  assert.deepEqual(xs, [
    { path: "a.js", line: 4, outdated: false, comments: [{ who: "ann", text: "Why this?" }] },
    { path: "a.js", line: 3, outdated: true, comments: [{ who: "someone", text: "suggestion: x = 1" }, { who: "bo", text: "ok" }] },
  ]);
  assert.deepEqual(openThreads(null), []);
  assert.equal(reviewThreads(data).resolved.length, 1);
  const md = { data: { repository: { pullRequest: { reviewThreads: { nodes: [node({ comments: { nodes: [{ author: { login: "bot" }, body: "### Hardcoded ARN\n**High Severity**\n<!-- DESCRIPTION START -->The `arn` is fixed<!-- END -->" }] } })] } } } } };
  assert.equal(reviewThreads(md).open[0].comments[0].text, "Hardcoded ARN High Severity The arn is fixed");
  assert.equal(resolveQuery(true), "mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}");
  assert.match(resolveQuery(false), /unresolveReviewThread/);
  // On one line: the finding, then the place, then the thread.
  assert.deepEqual(readingPath([{ path: "a.js", line: 4 }], [{ path: "a.js", line: 4 }], ["a.js"], reviewThreads(data).open).map((x) => `${x.kind}${x.i}`), ["t1", "f0", "l0", "t0"]);
});

test("a tracked PR's notes in the plain graph (lite) are shown while its head is reviewed since base; PR mode is a PR that isn't lite", async () => {
  const { PrMethods } = await import("../../mods/git-graph/pr.js");
  const g = (over) => ({ pr: { lite: true, status: "ready", head: "h1" }, details: { since: { from: "b" } }, selected: "h1", ...over });
  assert.equal(PrMethods.prReviewing.call(g({})), true);
  assert.equal(PrMethods.prReviewing.call(g({ selected: "other" })), false);
  assert.equal(PrMethods.prReviewing.call(g({ details: {} })), false);
  assert.equal(PrMethods.prMode.call(g({})), false);
  assert.equal(PrMethods.prMode.call({ pr: { key: "a/b#1" } }), true);
  assert.equal(PrMethods.prMode.call({ pr: null }), false);
});

test("a note on a range heads it (above its first line); a note on one line goes under it", async () => {
  const { PrMethods } = await import("../../mods/git-graph/pr.js");
  const g = { prReviewing: () => true, filesWidth: () => 300, width: 900, prFindings: PrMethods.prFindings, prPlanFindingIds: PrMethods.prPlanFindingIds,
    pr: { findings: [{ id: "F1", severity: "high", title: "t", path: "a.js", line: 3 }], fAt: -1, lAt: -1, tAt: -1, threads: [] },
    prLooks: () => [{ path: "a.js", line: 2, end_line: 4, why: "w" }], prDraftComments: () => [] };
  const rows = [1, 2, 3, 4, 5].map((n) => ({ kind: " ", number: n, text: `l${n}` }));
  const out = PrMethods.prDiffRows.call(g, "a.js", rows).map((r) => (r.kind === "F" ? `[${r.text.split(":")[0]}]` : r.number));
  assert.deepEqual(out, [1, "[Look here (lines 2–4)]", 2, 3, "[F1 high]", 4, 5]);
});

// A view --json as pr-flow 0.33.0 prints it (ENGINE.md "Drafts"), trimmed.
const VIEW = {
  key: "acme/api#473", stage: "NEEDS_YOU",
  draft: { version: 3, kind: "review", sha: "abc1234", channel: "automated", at: "2026-11-18T14:06:02.774Z", body: "Two things before it goes in.",
    comments: [
      { finding: "F2", path: "lib/x.js", line: 12, side: "RIGHT", start_line: null, start_side: null, body: "Could the id\n go first?", sha: "abc1234" },
      { finding: "F3", path: "lib/x.js", line: 9, side: "RIGHT", start_line: 7, start_side: "RIGHT", body: "A range.", sha: "abc1234" },
      { finding: null, path: "lib/old.js", line: 4, side: "LEFT", start_line: null, start_side: null, body: "On a removed line.", sha: "abc1234" },
    ] },
  draft_versions: [
    { v: 1, kind: "review", tone: null, at: "2026-11-18T14:02:10.301Z", job: "j1" },
    { v: 3, kind: "review", tone: "shorter", at: "2026-11-18T14:06:02.774Z", job: "j3" },
  ],
  notes: [{ v: 2, note_kind: "ping", at: "2026-11-18T14:03:55.090Z", text: "Could you take another look?" }],
};

test("pr-flow's view gives the current comment draft and its versions; no stored version or a note is no draft", async () => {
  const { draftOf, draftVersions, versionLabel } = await import("../../lib/prflow.js");
  const d = draftOf(VIEW);
  assert.equal(d.v, 3);
  assert.equal(d.tone, "shorter");
  assert.equal(d.body, "Two things before it goes in.");
  assert.deepEqual(d.comments.map((c) => `${c.path}:${c.line}:${c.side}`), ["lib/x.js:12:RIGHT", "lib/x.js:9:RIGHT", "lib/old.js:4:LEFT"]);
  assert.deepEqual(draftVersions({ draft_versions: [...VIEW.draft_versions].reverse() }).map(versionLabel), ["v1", "v3 shorter"], "oldest first");
  assert.equal(draftOf({ draft: { version: null, kind: "review", body: null, comments: [] } }), null, "findings not drafted yet");
  assert.equal(draftOf({ draft: { version: 2, kind: "note", text: "x" } }), null);
  assert.equal(draftOf({ draft: null }), null);
  assert.equal(draftOf(null), null, "no `draft` capability: no view");
});

test("a draft's comments become notes on their lines: a range from its first line, a removed line on the old side", async () => {
  const { draftOf, draftNotes, draftText } = await import("../../lib/prflow.js");
  assert.deepEqual(draftNotes(draftOf(VIEW)), [
    { path: "lib/x.js", line: 12, end: null, side: "RIGHT", body: "Could the id go first?", finding: "F2" },
    { path: "lib/x.js", line: 7, end: 9, side: "RIGHT", body: "A range.", finding: "F3" },
    { path: "lib/old.js", line: 4, end: null, side: "LEFT", body: "On a removed line.", finding: null },
  ]);
  assert.equal(draftText(draftOf(VIEW)), "Two things before it goes in.\n\nlib/x.js:12\nCould the id\n go first?\n\nlib/x.js:7-9\nA range.\n\nlib/old.js:4 (old side)\nOn a removed line.");
});

test("draft comments sit on their lines in the diff, marked Draft; one on the old side on its removed line; one not shown, at the top", async () => {
  const { PrMethods } = await import("../../mods/git-graph/pr.js");
  const { draftOf, draftNotes } = await import("../../lib/prflow.js");
  const notes = draftNotes(draftOf(VIEW));
  const g = { prReviewing: () => true, filesWidth: () => 300, width: 900, prLooks: () => [], prDraftComments: () => notes, prFindings: PrMethods.prFindings, prPlanFindingIds: PrMethods.prPlanFindingIds,
    pr: { findings: [{ id: "F2", severity: "medium", title: "t", path: "lib/x.js", line: 12 }], fAt: -1, lAt: -1, tAt: -1, dAt: 0, threads: [] } };
  const rows = [6, 7, 8, 9, 10, 11, 12].map((n) => ({ kind: " ", number: n, text: `l${n}` }));
  const label = (r) => (r.kind === "F" ? `[${r.severity}:${r.text.split(":")[0]}${r.cur ? "*" : ""}]` : r.number);
  assert.deepEqual(PrMethods.prDiffRows.call(g, "lib/x.js", rows).filter((r) => !r.more).map(label),
    [6, "[draft:Draft F3 (lines 7–9)]", 7, 8, 9, 10, 11, 12, "[medium:F2 medium]", "[draft:Draft F2*]"], "the finding first, then the draft's comment; the one reached whole");
  const old = [{ kind: "-", number: 4, text: "gone" }, { kind: "+", number: 4, text: "new" }];
  assert.deepEqual(PrMethods.prDiffRows.call(g, "lib/old.js", old).map((r) => (r.kind === "F" ? label(r) : `${r.kind}${r.number}`)), ["-4", "[draft:Draft (old side)]", "+4"]);
  const loose = PrMethods.prDiffRows.call({ ...g, pr: { ...g.pr, dAt: -1 } }, "lib/old.js", [{ kind: " ", number: 1, text: "a" }]);
  assert.match(loose[0].text, /line 4 of the old side isn't in the diff/);
});

test("n N go through draft comments too: after a finding on the same line, before places and threads", async () => {
  const { readingPath } = await import("../../mods/git-graph/pr.js");
  const out = readingPath([{ path: "a.js", line: 4 }], [{ path: "a.js", line: 4 }], ["a.js", "b.js"], [{ path: "a.js", line: 4 }], [{ path: "b.js", line: 1 }, { path: "a.js", line: 4 }]);
  assert.deepEqual(out.map((x) => `${x.kind}${x.i}`), ["f0", "d1", "l0", "t0", "d0"]);
});

test("the board says a draft is ready from the job that stored it, only while the PR waits for your comments", async () => {
  const { draftReady } = await import("../../lib/prflow.js");
  const q = { jobs: [
    { id: "j1", key: "o/r#1", verb: "draft", state: "done", ended_at: "2026-11-18T14:02:10Z", artifact: { kind: "draft", ref: "o/r#1@1" } },
    { id: "j2", key: "o/r#1", verb: "reword", state: "done", ended_at: "2026-11-18T14:06:02Z", artifact: { kind: "draft", ref: "o/r#1@3" } },
    { id: "j3", key: "o/r#2", verb: "review", state: "done", ended_at: "2026-11-18T14:06:02Z", artifact: { kind: "findings", ref: "o/r#2" } },
  ] };
  assert.deepEqual(draftReady(q, { key: "o/r#1", stage: "NEEDS_YOU" }), { v: 3, verb: "reword", at: "2026-11-18T14:06:02Z" });
  assert.equal(draftReady(q, { key: "o/r#1", stage: "WAITING" }), null, "posted or handed over since");
  assert.equal(draftReady(q, { key: "o/r#2", stage: "NEEDS_YOU" }), null);
  assert.equal(draftReady({}, { key: "o/r#1", stage: "NEEDS_YOU" }), null);
});

// `view <pr> --json` as pr-flow 0.33.2 prints it for your own draft PR after a self-check (ENGINE.md "View"), trimmed.
const PR_VIEW = {
  key: "acme/api#42", url: "https://github.com/acme/api/pull/42", title: "[Feature] Login form", role: "author", stage: "MY_DRAFT", reasons: ["draft"],
  facts: { head_ref: "feat/skeleton", base_ref: "main", head_sha: "1a2b3c47c56b", ci: "SUCCESS", draft: true, conflicts: false,
    threads: { unresolved: 1, awaiting_reviewer: 0, awaiting_author: 1 }, reviewed_sha: "1a2b3c47c56b", open_findings: { low: 2 }, pr_author: "me", requested: [], reviews: [], reasons: ["draft"], files: 61 },
  findings: [
    { id: "F10", path: "a.py", line: 25, severity: "low", status: "open", title: "Ten" },
    { id: "F2", path: "b.py", line: 397, severity: "low", status: "open", title: "Two" },
  ],
  draft: null, draft_versions: [], notes: [],
  jobs: [{ id: "20260301-101500-review-42-a1b2", key: "acme/api#42", verb: "review", state: "done", phase: "running gh api repos/acme/api", ended_at: "2026-03-01T10:20:10.017Z", artifact: { kind: "findings" } }],
  move: { group: "you", label: "Get ready", order: 8, waiting_on: null },
  next_step: { text: "Self-checked at 1a2b3c4: fix the findings, or mark ready · 2 low open", problem: false },
  actions: [
    { verb: "ready", label: "Mark ready", kind: "session", role: "primary", outward: true, confirm: "Mark api#42 ready for review and request reviewers on GitHub?", disabled_reason: null },
    { verb: "review", label: "Self-check", kind: "job", role: "alternative", outward: false, confirm: null, disabled_reason: null },
    { verb: "later", label: "Later", kind: "script", role: "housekeeping", outward: false, confirm: null, disabled_reason: null },
    { verb: "open", label: "Open on GitHub", kind: "script", role: "housekeeping", outward: false, confirm: null, disabled_reason: null },
  ],
};

test("the PR view's bar reads pr-flow's view as pr-board reads a card: the same move, next step, actions and labels", async () => {
  const { viewRow, verbPlan, jobFor, jobText, detailJob } = await import("../../lib/prflow.js");
  const { moveOf, nextStep, actionsFor } = await import("../../lib/prmodel.js");
  const r = viewRow(PR_VIEW);
  assert.deepEqual(moveOf(r), ["you", "Get ready", "ready", 8]);
  assert.deepEqual(nextStep(r), { text: "Self-checked at 1a2b3c4: fix the findings, or mark ready · 2 low open", problem: false });
  assert.deepEqual(actionsFor(r), { main: "ready", also: ["review"], keep: ["later"] });
  assert.deepEqual(verbPlan(r, "ready", {}), { kind: "agent", confirm: null, disabled: null, label: "Mark ready" });
  assert.deepEqual(verbPlan(r, "review", {}), { kind: "job", confirm: null, disabled: null, label: "Self-check" });
  assert.equal(r.author, "", "your own PR: no author, as the listing has it");
  assert.equal(r.short, "api#42");
  assert.deepEqual([r.rec.headRef, r.rec.baseRef, r.rec.ci, r.rec.open.low, r.rec.threads.awaitingAuthor], ["feat/skeleton", "main", "SUCCESS", 2, 1]);
  // Its jobs: the done self-check is the details' job, not a running one; a running one on your PR reads as a self-check.
  const jobs = { jobs: PR_VIEW.jobs };
  assert.equal(jobFor(jobs, r), null);
  assert.equal(detailJob(jobs, r).verb, "review");
  const running = { ...PR_VIEW.jobs[0], state: "running", fraction: 0.4 };
  assert.equal(jobText(jobFor({ jobs: [running] }, r), r), "self-check 40% · reading GitHub");
  // A job's id in pr-flow's text reads as "a job", as on the card.
  assert.equal(nextStep(viewRow({ ...PR_VIEW, next_step: { text: "job-20260301-101500-review-42-a1b2 working", problem: false } })).text, "a job working");
});

test("a view's row keeps the queue row's own fields, takes pr-flow's judgment from the view, and is null without a view model", async () => {
  const { viewRow } = await import("../../lib/prflow.js");
  const base = { key: "acme/api#42", short: "api#42", detail: "draft", size: "M", tab: "idle", author: "", stage: "MY_PENDING", move: { group: "waiting" }, next_step: { text: "old" }, actions: [] };
  const r = viewRow(PR_VIEW, base);
  assert.equal(r.detail, "draft"); assert.equal(r.size, "M"); assert.equal(r.tab, "idle");
  assert.equal(r.stage, "MY_DRAFT"); assert.equal(r.next_step.text, PR_VIEW.next_step.text); assert.equal(r.actions.length, 4);
  assert.equal(viewRow(PR_VIEW, null, "blocked").tab, "blocked", "not in the queue: the agent tab's status passed in");
  // A colleague's PR shows its author; a job holding a REVIEWING PR is the row's job, as the listing's `job`.
  const busy = viewRow({ ...PR_VIEW, role: "reviewer", stage: "REVIEWING", jobs: [{ id: "j9", state: "running", key: PR_VIEW.key }] });
  assert.equal(busy.author, "me"); assert.equal(busy.job, "j9");
  assert.equal(viewRow({ key: "acme/api#1", stage: "READY" }), null, "an older pr-flow's view: no move, next_step, actions");
  assert.equal(viewRow(null), null);
});

test("opening a PR with pr-flow's view: branches and head from its facts, your last review's head, show's findings (with fix and end line)", async () => {
  const { openFromView } = await import("../../lib/prflow.js");
  const record = { role: "author", last_checked_sha: "old", snapshot: { headRef: "x", baseRef: "y", headSha: "z" },
    findings: [{ id: "F10", severity: "low", fix: "do", end_line: 30 }, { id: "F2", severity: "low", fix: "that" }] };
  const got = openFromView(PR_VIEW, record);
  assert.deepEqual(got.rec, { headRef: "feat/skeleton", baseRef: "main", headSha: "1a2b3c47c56b" });
  assert.equal(got.reviewed, "1a2b3c47c56b");
  assert.deepEqual(got.findings.map((f) => [f.id, f.fix]), [["F2", "that"], ["F10", "do"]], "show's findings, by id as findings --json lists them");
  // show failed: view's findings; view failed: show's snapshot and its last review.
  assert.deepEqual(openFromView(PR_VIEW, null).findings.map((f) => f.id), ["F2", "F10"]);
  const old = openFromView(null, record);
  assert.deepEqual(old.rec, { headRef: "x", baseRef: "y", headSha: "z" }); assert.equal(old.reviewed, "old");
  assert.deepEqual(openFromView(null, null), { rec: null, reviewed: null, findings: [] });
});

// A newer pr-flow's view: the explainer, and each finding's fix and end line, so no show beside it.
const FULL_VIEW = { ...PR_VIEW, reasons: ["self-checked at 1a2b3c4"],
  explainer: { sha: "1a2b3c47c56b", at: "2026-03-01T10:20:10.017Z", text: "Adds a login form.", points: [], look_at: [{ path: "a.py", line: 3, end_line: null, why: "the check" }] },
  findings: PR_VIEW.findings.map((f, i) => ({ ...f, end_line: null, fix: `fix ${i}`, evidence: null })) };

test("a view with the explainer and each finding's fix and end line needs no show; an older one does", async () => {
  const { viewIsFull } = await import("../../lib/prflow.js");
  assert.equal(viewIsFull(FULL_VIEW), true);
  assert.equal(viewIsFull({ ...FULL_VIEW, explainer: null, findings: [] }), true, "no explainer stored and no findings is still a full view");
  assert.equal(viewIsFull(PR_VIEW), false, "no explainer field, findings without fix");
  assert.equal(viewIsFull({ ...PR_VIEW, explainer: null }), false, "findings without fix and end line");
  assert.equal(viewIsFull(null), false);
});

test("the PR view's notes (reasons, explainer, threads) come from a full view, else from show's record", async () => {
  const { notesOf, openFromView } = await import("../../lib/prflow.js");
  assert.deepEqual(notesOf(FULL_VIEW, null), { reasons: ["self-checked at 1a2b3c4"], explainer: FULL_VIEW.explainer,
    threads: { unresolved: 1, awaitingReviewer: 0, awaitingAuthor: 1 } });
  const record = { reasons: ["waiting on the author"], explainer: { text: "old" }, snapshot: { threads: { unresolved: 2, awaitingReviewer: 1, awaitingAuthor: 0, open: [] } } };
  assert.deepEqual(notesOf(PR_VIEW, record), { reasons: ["waiting on the author"], explainer: { text: "old" }, threads: { unresolved: 2, awaitingReviewer: 1, awaitingAuthor: 0 } });
  assert.deepEqual(notesOf(null, null), { reasons: [], explainer: null, threads: null });
  // Opening from a full view alone: its findings carry their fixes.
  assert.deepEqual(openFromView(FULL_VIEW, null).findings.map((f) => [f.id, f.fix]), [["F2", "fix 1"], ["F10", "fix 0"]]);
});

// The fix round's plan (pr-flow 0.45.0, its ENGINE.md "Fix plans").
const PLAN = { version: 2, at: "2026-11-21T10:00:00Z", sha: "1a2b3c47c56b", session: "session-ab12cd", state: "waiting", state_at: null,
  size: { added: 412, deleted: 37, files: 9 }, handback: ["erin"], go: "go = fix T1, commit, push, post these replies, resolve T1 T2, hand back to erin",
  items: [
    { id: "T1", kind: "thread", severity: "high", verdict: "fix", path: "b.py", line: 12, end_line: null, who: "copilot", text: "stale dial", reply: "Fixed in <sha>", proof: "a test", resolve: true },
    { id: "T3", kind: "conversation", severity: "low", verdict: "answer", path: null, line: null, who: "bob", text: "why a function?", reply: "@bob — it takes arguments", resolve: false },
    { id: "F2", kind: "finding", severity: "low", verdict: "skip", path: "a.py", line: 3, text: "nit", reply: null },
  ] };

test("the fix plan is read from view's fix_plan field, never from 0.44.0's earlier `plan`", async () => {
  const { fixPlanOf, planOpen } = await import("../../lib/prflow.js");
  assert.equal(fixPlanOf({ ...PR_VIEW, fix_plan: PLAN }), PLAN);
  assert.equal(fixPlanOf({ ...PR_VIEW, plan: PLAN }), null, "0.44.0's view.plan is another design");
  assert.equal(fixPlanOf({ ...PR_VIEW, fix_plan: null }), null);
  assert.equal(fixPlanOf({ ...PR_VIEW, fix_plan: { state: "waiting" } }), null, "a plan without items isn't one");
  assert.equal(fixPlanOf(null), null);
  assert.equal(planOpen(PLAN), true); assert.equal(planOpen({ ...PLAN, state: "going" }), false); assert.equal(planOpen(null), false);
});

test("the words typed into the session are the chat's own: `<id> <verdict>`, `skip <id>`", async () => {
  const { planWords, PLAN_VERDICTS } = await import("../../lib/prflow.js");
  assert.equal(planWords("T2", "won't-fix"), "T2 won't-fix"); assert.equal(planWords("T1", "follow-up"), "T1 follow-up"); assert.equal(planWords("T3", "skip"), "skip T3");
  assert.deepEqual(PLAN_VERDICTS.map(([k]) => k), ["f", "w", "a", "u", "s"], "none of them needs a modifier; they mean verdicts only in an item's row");
});

test("plan items with a code place are stops on the reading path, after findings on the same line; one without a place isn't", async () => {
  const { readingPath } = await import("../../mods/git-graph/pr.js");
  const stops = readingPath([{ path: "b.py", line: 12 }], [], ["a.py", "b.py"], [], [], PLAN.items);
  assert.deepEqual(stops.map((s) => `${s.kind}${s.i}`), ["p2", "f0", "p0"]);
});

test("a finding the fix plan takes up is said once, by the plan: out of FINDINGS and the diff, its mark naming the item and verdict", async () => {
  const { PrMethods } = await import("../../mods/git-graph/pr.js");
  const findings = [{ id: "F2", severity: "low", title: "nit", path: "a.py", line: 3, fix: "rename it" }, { id: "F5", severity: "medium", title: "other", path: "a.py", line: 5 }];
  const g = { prReviewing: () => true, filesWidth: () => 300, width: 900, prLooks: () => [], prDraftComments: () => [], prFindings: PrMethods.prFindings, prPlanFindingIds: PrMethods.prPlanFindingIds,
    pr: { findings, plan: PLAN, fAt: -1, lAt: -1, tAt: -1, dAt: -1, pAt: -1, threads: [] } };
  assert.deepEqual(PrMethods.prFindings.call(g).map((f) => f.id), ["F5"], "F2 is the plan's item F2");
  assert.deepEqual(PrMethods.prFindings.call({ ...g, pr: { ...g.pr, plan: null } }).map((f) => f.id), ["F2", "F5"], "no plan: all of them");
  const rows = [3, 5].map((n) => ({ kind: " ", number: n, text: `l${n}` }));
  const notes = PrMethods.prDiffRows.call(g, "a.py", rows).filter((r) => r.kind === "F");
  assert.deepEqual(notes.map((r) => [r.tag ?? null, r.severity, r.text]), [["F2", "plan", "Fix plan · skip · low: nit"], [null, "medium", "F5 medium: other"]]);
  const reached = PrMethods.prDiffRows.call({ ...g, pr: { ...g.pr, plan: { ...PLAN, items: PLAN.items.map((x) => (x.id === "F2" ? { ...x, verdict: "fix" } : x)) }, pAt: 2 } }, "a.py", rows);
  assert.ok(reached.some((r) => r.fix && r.text === "Fix: rename it"), "reached, a fix item shows how its finding is fixed");
});

test("the review is the commit on the base branch and since base again on another branch; c there doesn't change the preference", async () => {
  const { ReviewMethods } = await import("../../mods/git-graph/review.js");
  const { isBaseBranch } = await import("../../mods/git-graph/git.js");
  assert.ok(isBaseBranch("main", "main", {}));
  assert.ok(isBaseBranch("origin/main", "main", { main: { short: "origin/main" } }), "main tracking the base");
  assert.ok(!isBaseBranch("origin/main", "feat", { feat: { short: "origin/feat" } }));
  assert.ok(!isBaseBranch(null, "main", {}) && !isBaseBranch("main", null, {}), "no base, or detached: never on it");

  const saved = [];
  globalThis.__herdrStubs = { setShared: (k, v) => saved.push([k, v]) };
  const loads = [];
  const g = Object.assign(Object.create(ReviewMethods), {
    root: "/r", on: null, head: "a".repeat(40), current: "main", tracking: { main: { short: "origin/main" } },
    sinceBase: true, ask: null, prRevs: null, baseRef: { key: "null\0/r\0", root: "/r", on: null, name: "origin/main" },
    selected: "c1", index: new Map([["c1", 0]]), commits: [{ hash: "c1", parents: [] }], details: {}, detailsSince: true,
    fileScroll: { scroll_to_item() {} },
  });
  g.loadDetails = (commit) => { g.details = {}; g.detailsSince = g.reviewsSince(commit); loads.push(g.detailsSince); };
  const cx = { notify() {}, spawn() { throw new Error("the base is known: no git"); } };
  const commit = g.commits[0];
  try {
    assert.equal(g.reviewsSince(commit), false, "on the base branch: the commit");
    g.checkBase(cx);
    assert.deepEqual(loads, [false], "an open since-base review follows onto the base branch");
    g.toggleSince(cx);
    assert.equal(g.reviewsSince(commit), true, "c on the base branch: since base");
    assert.deepEqual(saved, [], "...for that branch only, the preference left alone");
    g.current = "feat"; g.checkBase(cx);
    assert.equal(g.reviewsSince(commit), true, "another branch: the preference");
    g.current = "main"; g.checkBase(cx);
    assert.equal(g.reviewsSince(commit), false, "back on the base branch: the commit again (c was for one stay)");
    assert.deepEqual(loads, [false, true, false], "a reload only where the mode changed (main → feat kept since base)");
    g.current = "feat"; g.checkBase(cx); g.toggleSince(cx);
    assert.equal(g.sinceBase, false); assert.deepEqual(saved, [["git-graph.since", false]], "off the base branch c sets the preference");
    g.ask = { head: "c1", base: "origin/main" }; g.current = "main"; g.sinceBase = true;
    assert.equal(g.reviewsSince(commit), true, "a review another mod asked for keeps since base, on any branch");
  } finally { globalThis.__herdrStubs = undefined; }
});
