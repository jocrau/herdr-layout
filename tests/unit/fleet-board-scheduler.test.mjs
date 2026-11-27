// fleet-board's worker loop: which passes have anything to do (scheduler.js), with Herdr's modules stubbed.
// Run with `node --test 'tests/unit/*.test.mjs'`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./stub-hooks.mjs", import.meta.url);
const { SchedulerMethods } = await import("../../mods/fleet-board/scheduler.js");
const { MIN_GAP, SCAN_EVERY, DIRTY_EVERY, TAIL_EVERY } = await import("../../mods/fleet-board/model.js");

// A board that just finished its reads: nothing asked, the strip scanned, no tail panel.
const board = (over = {}) => Object.assign(Object.create(SchedulerMethods), {
  hidden: false, request: null, last: Date.now(), scanAt: Date.now(),
  dirty: new Set(), rescanAt: 0, tailOn: false, tail: { id: null, at: 0 }, s: null, nextLook: Date.now() + 60000,
  runs: new Map(), snaps: new Map(), tried: new Map(), ...over,
});

test("an idle pass has nothing due, so it never looks at the layout", () => {
  assert.equal(board().due(), false);
});

test("a read asked for is due: forced at once, a soft one after MIN_GAP", () => {
  assert.equal(board({ request: "force" }).due(), true);
  assert.equal(board({ request: "soft" }).due(), false);
  assert.equal(board({ request: "soft", last: Date.now() - MIN_GAP - 1 }).due(), true);
});

test("the strip's scan is due when its time comes, or for a changed run", () => {
  assert.equal(board({ scanAt: Date.now() - SCAN_EVERY - 1 }).due(), true);
  assert.equal(board({ dirty: new Set(["*"]) }).due(), true);
  assert.equal(board({ dirty: new Set(["repo"]), rescanAt: Date.now() }).due(), false);
  assert.equal(board({ dirty: new Set(["repo"]), rescanAt: Date.now() - DIRTY_EVERY }).due(), true);
});

test("the tail is due for a new bead, and again every TAIL_EVERY while it works", () => {
  const bead = (state) => ({ id: "b1", state, history: [{}] });
  const s = (state) => ({ epic: { id: "e", beads: {}, wave: {} }, beads: [bead(state)] });
  assert.equal(board({ tailOn: true, openId: "b1", s: s("running") }).due(), true, "not read yet");
  assert.equal(board({ tailOn: true, openId: "b1", s: s("running"), tail: { id: "b1", at: Date.now() } }).due(), false);
  assert.equal(board({ tailOn: true, openId: "b1", s: s("running"), tail: { id: "b1", at: Date.now() - TAIL_EVERY } }).due(), true);
  assert.equal(board({ tailOn: true, openId: "b1", s: s("done"), tail: { id: "b1", at: 0 } }).due(), false, "a finished bead's tail stays");
});

test("hidden, only the look for new waits is due, whatever else is asked", () => {
  assert.equal(board({ hidden: true, request: "force", scanAt: 0 }).due(), false);
  assert.equal(board({ hidden: true, nextLook: Date.now() - 1 }).due(), true);
});

// A run of the run list (parseRuns' shape), active.
const listed = (epic, repoName = "repo") => ({ key: `${repoName}\0${epic}`, cwd: `/code/${repoName}`, repoName, epic,
  running: false, parked: 0, busy: 0, open: 3, last: Date.now(), finished: false });

test("a listed run with no snapshot kept is read in the background, once, so picking it shows at once", async () => {
  const run = listed("e1"), reads = [];
  const b = board({ runs: new Map([[run.key, run]]) });
  b.timed = async (_cx, target) => { reads.push(target); return { ok: false, kind: "error", message: "x" }; };
  assert.equal(b.due(), true, "an unread run is due");
  assert.equal(await b.warmStep({ notify() {} }), true);
  assert.equal(reads.length, 1);
  assert.equal(b.due(), false, "tried once: not again, even when it failed");
  assert.equal(board({ runs: new Map([[run.key, run]]), scanAt: 0 }).warmNext(), null, "not before the list was read");
});

test("a run picked with nothing kept shows as being read at once, and a background rescan yields to it", async () => {
  const a = listed("e1"), c = listed("e2"), reads = [];
  const b = board({ runs: new Map([[a.key, a], [c.key, c]]), dirty: new Set(["repo"]) });
  b.choose({ notify() {} }, a);
  assert.equal(b.pending?.epic, "e1");
  assert.equal(b.runKey(), a.key, "the run list marks the run picked");
  b.timed = async (_cx, target) => { reads.push(target); return { ok: false }; };
  await b.rescan({});
  assert.deepEqual(reads, [], "the picked run's read goes first");
  assert.ok(b.dirty.has("repo"), "the rescan comes back to it");
});

test("⌘← ⌘→ step through the active runs only; ⌘⇧← ⌘⇧→ the finished ones too", () => {
  const a = listed("a"), c = listed("c"), old = { ...listed("b"), finished: true, open: 0 };
  const picked = [];
  const b = board({ runs: new Map([[a.key, a], [old.key, old], [c.key, c]]) });
  b.runKey = () => a.key;
  b.choose = (_cx, run) => picked.push(run.epic);
  b.stepRun({}, 1); b.stepRun({}, -1); b.stepRun({}, -1, true); // all: active ones first, then finished
  assert.deepEqual(picked, ["c", "c", "b"], "a finished run is skipped unless asked for");
});

test("Lanes: a step is a full bar exactly when an agent works in it, and each step has one colour", async () => {
  const { PHASES, phaseOf, AGENT_STEPS, STEPS } = await import("../../mods/fleet-board/model.js");
  for (const step of STEPS) assert.equal(phaseOf(step).agent, AGENT_STEPS.has(step), step);
  assert.equal(new Set(PHASES.map((p) => p.color)).size, PHASES.length, "four different colours");
  assert.equal(phaseOf("something-new").agent, false, "an unknown step isn't drawn as an agent's");
});
