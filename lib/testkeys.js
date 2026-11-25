// Keys for scripts, in the demo only: `herdr-app do <mod>.test.key.<keystroke>` presses a key on a board as if it
// were typed (the board's own key handler), then the board writes what it shows to <appHome>/data/test-keys.<mod>.json,
// so tests/demo/keys.sh can check keyboard behaviour without a person at the window. Off unless the layout's
// settings (data/workbench.json) say "test_keys": true, which only the demo's do.
//
// What it can't check: keys Herdr handles before a mod sees them (Esc closing a dialog, keys.json bindings).
// Nor focus moving into a text field: GPUI focuses fields only in the active window, and the demo stays behind.
// Those still need a person; the board's own decisions (what Esc closes first, where j moves) don't.
import { readTextFile, writeTextFile, appHome } from "herdr";

// "test.key.shift-g" → "shift-g"; anything else → null.
export function testKeystroke(c) {
  const m = /^test\.key\.(.+)$/.exec(String(c ?? ""));
  return m ? m[1] : null;
}

// A keystroke as an on_key_down event: "cmd-shift-up" → { key: "up", keystroke, modifiers }. "-" and "cmd--" too.
export function keyEvent(keystroke) {
  const s = String(keystroke);
  const parts = s.endsWith("-") && (s === "-" || s.endsWith("--")) ? [...s.slice(0, -2).split("-").filter(Boolean), "-"] : s.split("-");
  const mods = new Set(parts.slice(0, -1));
  return {
    key: parts[parts.length - 1], keystroke: s,
    modifiers: { shift: mods.has("shift"), control: mods.has("ctrl"), alt: mods.has("alt"), platform: mods.has("cmd"), function: mods.has("fn") },
  };
}

// A command context for a key handler: stop_propagation and propagate do nothing (there's no event to stop).
export function keyContext(cx) {
  return new Proxy(cx, {
    get(target, name) {
      if (name === "stop_propagation" || name === "propagate") return () => {};
      const v = target[name];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

// Where a board reports after a test key (data/ always exists; writeTextFile makes no folders).
export function testKeysFile(home, mod) { return `${home}/data/test-keys.${mod}.json`; }

// True when the layout's settings switch the hook on.
export async function testKeysOn() {
  try { return JSON.parse((await readTextFile(`${appHome()}/data/workbench.json`)) ?? "{}")?.test_keys === true; }
  catch { return false; }
}

// Handles a `test.key.<keystroke>` command when the hook is on: runs press(event, cx), then writes state() for the
// script. `test.state` only writes state(): what a key changes later (focus, a render) shows there, so the script
// asks for it after a moment. Returns true when the command was one (handled or refused), so the caller moves on.
// refuse(keystroke): a reason not to press it (a key that runs an action: pr-flow verbs reach GitHub), or null.
export async function runTestKey(mod, c, cx, press, state, refuse = () => null) {
  const k = testKeystroke(c), only = c === "test.state";
  if (!k && !only) return false;
  if (!(await testKeysOn())) return true;
  let error = k ? refuse(k) : null;
  if (error) error = `refused: ${error}`;
  else if (k) try { press(keyEvent(k), keyContext(cx)); } catch (e) { error = String(e?.message ?? e); }
  let shown = null;
  try { shown = state(); } catch (e) { error = error ?? `state: ${e?.message ?? e}`; }
  const file = testKeysFile(appHome(), mod);
  await writeTextFile(file, JSON.stringify({ key: k ?? null, at: Date.now(), error, state: shown }, null, 2), await readTextFile(file));
  return true;
}
