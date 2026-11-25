// The keys every board's list moves with (lib/keymap.js), and that the boards use them instead of their own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { navMove, navIndex, moveHelp } from "../../lib/keymap.js";

test("each move's keys", () => {
  assert.equal(navMove("j"), "down"); assert.equal(navMove("ctrl-j"), "down"); assert.equal(navMove("up"), "up");
  assert.equal(navMove("ctrl-d"), "halfDown"); assert.equal(navMove("pagedown"), "pageDown");
  assert.equal(navMove("g"), "first"); assert.equal(navMove("end"), "last"); assert.equal(navMove("x"), null);
});

test("where a move goes: clamped to the list; ⌃D half a page, PgDn a whole one", () => {
  assert.equal(navIndex("j", 3, 10), 4);
  assert.equal(navIndex("j", 9, 10), 9);
  assert.equal(navIndex("k", 0, 10), 0);
  assert.equal(navIndex("j", -1, 10), 0); // from no row, down is the first
  assert.equal(navIndex("k", -1, 10), 0);
  assert.equal(navIndex("ctrl-d", 0, 100, 20), 10);
  assert.equal(navIndex("pagedown", 0, 100, 20), 20);
  assert.equal(navIndex("ctrl-u", 5, 100, 20), 0);
  assert.equal(navIndex("shift-g", 0, 7), 6);
  assert.equal(navIndex("g", 5, 7), 0);
  assert.equal(navIndex("j", -1, 0), -1); // an empty list: nowhere to go
  assert.equal(navIndex("x", 3, 10), null);
});

test("the help rows name every key", () => {
  const keys = moveHelp("rows").map(([k]) => k).join(" ");
  for (const k of ["j", "k", "↑", "↓", "⌃N", "⌃P", "⌃D", "⌃U", "PgDn", "PgUp", "g", "G", "Home", "End"]) assert.ok(keys.split(/\s+/).includes(k), k);
});

// Each board moves with navIndex and lists moveHelp, and no longer binds the moves itself.
const BOARDS = {
  "fleet-board": ["mods/fleet-board/main.js", "mods/fleet-board/views.js"],
  "pr-board": ["mods/pr-board/main.js"],
  "git-graph": ["mods/git-graph/table.js", "mods/git-graph/pickers.js"],
  "file-browser": ["mods/file-browser/main.js"],
};
const OWN = [/is\("j", "down"/, /is\("g", "home"\)/, /is\("shift-g", "end"\)/, /is\("ctrl-d", "pagedown"\)/, /is\("pagedown", "ctrl-d"\)/,
  /k === "pagedown"/, /k === "home"/, /\["j k\s+↑ ↓\s+⌃N/, /"move \(ctrl-d/];
for (const [board, files] of Object.entries(BOARDS)) {
  test(`${board} moves with lib/keymap.js and lists its help rows`, () => {
    const src = files.map((f) => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8")).join("\n");
    assert.match(src, /navIndex\(/);
    assert.match(src, /moveHelp\(/);
    for (const re of OWN) assert.doesNotMatch(src, re, `${board} binds a move itself: ${re}`);
  });
}
