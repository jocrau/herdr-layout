// Copied from lib/keymap.js by lib/sync.mjs: edit it there, then run `node lib/sync.mjs`.
// The keys every board's list moves with, in one place: the fleet board, the PR board, the git view and the file
// browser's tree move the same way, and their help pages list these rows from here, so a key and its help can't
// drift apart. Each board keeps its own keys for what only it does. tests/unit/keymap.test.mjs checks the boards
// use these and don't bind the keys themselves; tests/demo/keys/nav.keys presses them on every board.

export const NAV = {
  down: ["j", "down", "ctrl-n", "ctrl-j"],
  up: ["k", "up", "ctrl-p", "ctrl-k"],
  halfDown: ["ctrl-d"], halfUp: ["ctrl-u"], // half a page, as in vim
  pageDown: ["pagedown"], pageUp: ["pageup"], // a whole page
  first: ["g", "home"],
  last: ["shift-g", "end"],
};

export const HELP_KEYS = ["?", "shift-/"];

// Which move a keystroke is (a NAV name), or null.
export function navMove(k) {
  for (const [move, keys] of Object.entries(NAV)) if (keys.includes(k)) return move;
  return null;
}

// Where a move goes from row `at` in a list of n rows (`page`: the rows a page shows); null when k isn't a move.
// From no row (at < 0), down goes to the first row and up stays at the first.
export function navIndex(k, at, n, page = 20) {
  const move = navMove(k);
  if (!move) return null;
  if (n <= 0) return at;
  const half = Math.max(1, Math.ceil(page / 2)), from = at < 0 ? -1 : at;
  const to = {
    down: from + 1, up: from - 1, halfDown: from + half, halfUp: from - half, pageDown: from + page, pageUp: from - page,
    first: 0, last: n - 1,
  }[move];
  return Math.max(0, Math.min(n - 1, to));
}

// The help rows for these keys: `what` is what one step moves over ("commit by commit", "the beads").
export function moveHelp(what) {
  return [
    ["j k  ↑ ↓  ⌃N ⌃P", what],
    ["⌃D ⌃U  PgDn PgUp", "half a page / a whole page"],
    ["g G  Home End", "first / last"],
  ];
}

export const HELP_ROW = ["?", "this help (any key closes it)"];
