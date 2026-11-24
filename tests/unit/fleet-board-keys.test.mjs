// The fleet board's action keys (mods/fleet-board/actions.js): run with `node --test 'tests/unit/*.test.mjs'`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./stub-hooks.mjs", import.meta.url);
const { ActionsMethods, ACTION_KEYS } = await import("../../mods/fleet-board/actions.js");

test("each fleet action has its own key, none of them a key the board moves or views with", () => {
  const keys = Object.values(ACTION_KEYS);
  assert.equal(new Set(keys).size, keys.length, "one action per key");
  for (const k of ["j", "k", "g", "l", "h", "x", "e", "r", "/", "?", "0", "1", "2", "[", "]", "{", "}", "<", ">", "-", "=", "p"]) assert.ok(!keys.includes(k), `${k} is the board's own`);
  // Where the PR board has the same action, the same letter.
  assert.equal(ACTION_KEYS.approve, "a"); assert.equal(ACTION_KEYS.resume, "f"); assert.equal(ACTION_KEYS.tail, "w"); assert.equal(ACTION_KEYS.pr, "o");
});

test("a parked bead's actions carry their keys; one without a key (an unknown gate verb) has none", () => {
  const b = { id: "acme-1", state: "parked", pr: 12, history: [{}], gate: { id: "g1", actions: [
    { verb: "resume", command: "fleet resume acme-1", means: "another fix round" },
    { verb: "approve", command: "fleet approve acme-1", means: "merge it" },
    { verb: "answer", command: "fleet answer acme-1", means: "answer" },
    { verb: "poke", command: "fleet poke acme-1", means: "?" },
  ] } };
  const self = { busyOn: () => false, diffRange: () => ({ title: "t", base: "a", head: "b" }), confirm: null };
  const got = ActionsMethods.actions.call(self, b).map((a) => [a.label, a.key]);
  assert.deepEqual(got, [["resume", "f"], ["approve", "a"], ["poke", null], ["gate", "v"], ["tail", "w"], ["PR #12", "o"], ["diff", "d"], ["beads", "b"]]);
});
