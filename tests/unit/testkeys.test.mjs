// The demo's key hook (lib/testkeys.js): commands to keystrokes, keystrokes to events, the settings switch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./stub-hooks.mjs", import.meta.url);
const { testKeystroke, keyEvent, keyContext, runTestKey } = await import("../../lib/testkeys.js");

test("only test.key.<keystroke> commands are test keys", () => {
  assert.equal(testKeystroke("test.key.shift-g"), "shift-g");
  assert.equal(testKeystroke("test.key.escape"), "escape");
  assert.equal(testKeystroke("focus"), null);
  assert.equal(testKeystroke("behind.tab.next"), null);
});

test("a keystroke becomes the event on_key_down gets", () => {
  assert.deepEqual(keyEvent("j"), { key: "j", keystroke: "j", modifiers: { shift: false, control: false, alt: false, platform: false, function: false } });
  const e = keyEvent("cmd-shift-up");
  assert.equal(e.key, "up");
  assert.equal(e.modifiers.platform && e.modifiers.shift && !e.modifiers.alt, true);
  assert.equal(keyEvent("-").key, "-");
  assert.equal(keyEvent("cmd--").key, "-");
  assert.equal(keyEvent("cmd--").modifiers.platform, true);
});

test("the handler's context ignores stop_propagation and passes the rest", () => {
  let notified = 0;
  const cx = keyContext({ notify() { notified++; }, stop_propagation() { throw new Error("no event"); } });
  cx.stop_propagation(); cx.notify();
  assert.equal(notified, 1);
});

test("off unless the settings say test_keys: the key isn't pressed, nothing is written", async () => {
  const written = [];
  globalThis.__herdrStubs = { appHome: () => "/h", readTextFile: async () => "{}", writeTextFile: async (...a) => { written.push(a); } };
  let pressed = 0;
  assert.equal(await runTestKey("fleet-board", "test.key.j", {}, () => pressed++, () => ({})), true);
  assert.equal(pressed, 0);
  assert.equal(written.length, 0);
  assert.equal(await runTestKey("fleet-board", "focus", {}, () => pressed++, () => ({})), false);
});

test("on: the key is pressed and the board's state written to data/test-keys.<mod>.json", async () => {
  const written = [];
  globalThis.__herdrStubs = {
    appHome: () => "/h",
    readTextFile: async (p) => (p.endsWith("workbench.json") ? '{"test_keys": true}' : null),
    writeTextFile: async (...a) => { written.push(a); },
  };
  const keys = [];
  await runTestKey("fleet-board", "test.key.escape", {}, (e) => keys.push(e.keystroke), () => ({ open: null }));
  assert.deepEqual(keys, ["escape"]);
  assert.equal(written[0][0], "/h/data/test-keys.fleet-board.json");
  assert.deepEqual(JSON.parse(written[0][1]).state, { open: null });
  assert.equal(written[0][2], null);
  // test.state: only the state, nothing pressed
  await runTestKey("fleet-board", "test.state", {}, (e) => keys.push(e.keystroke), () => ({ open: "x" }));
  assert.deepEqual(keys, ["escape"]);
  assert.equal(JSON.parse(written[1][1]).key, null);
  delete globalThis.__herdrStubs;
});

test("a refused key isn't pressed; the report says why", async () => {
  const written = [];
  globalThis.__herdrStubs = {
    appHome: () => "/h",
    readTextFile: async (p) => (p.endsWith("workbench.json") ? '{"test_keys": true}' : null),
    writeTextFile: async (...a) => { written.push(a); },
  };
  let pressed = 0;
  await runTestKey("pr-board", "test.key.m", {}, () => pressed++, () => ({}), (k) => (k === "m" ? "a pr-flow verb" : null));
  assert.equal(pressed, 0);
  assert.equal(JSON.parse(written[0][1]).error, "refused: a pr-flow verb");
  delete globalThis.__herdrStubs;
});
