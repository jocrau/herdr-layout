// file-browser's filter (main.js): run with `node --test 'tests/unit/*.test.mjs'`, Herdr's modules stubbed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./stub-hooks.mjs", import.meta.url);
const { matchFiles, withFolders, matchTree, default: FileBrowser } = await import("../../mods/file-browser/main.js");
const { default: Viewer } = await import("../../mods/file-browser/viewer.js");

const files = ["src/App.tsx", "src/app/main.ts", "docs/apple.md", "lib/a/p/p.js", "README.md", "src/zapp.ts"];
const paths = (r) => r.rows.map((x) => x.path);

test("best first: file name and segment starts, then the shorter path, then the list's order", () => {
  assert.deepEqual(paths(matchFiles(files, "app")).slice(0, 3), ["src/App.tsx", "docs/apple.md", "src/zapp.ts"]);
  assert.deepEqual(paths(matchFiles(files, "APP")), paths(matchFiles(files, "app")), "case doesn't matter");
  assert.deepEqual(paths(matchFiles(files, "app main")), ["src/app/main.ts"], "every term must match");
  assert.deepEqual(paths(matchFiles(files, "qqq")), []);
});

test("a term matches inside one name, as typed, never letters spread over the path", () => {
  const repo = ["mods/pr-board/lib/boardheader.js", "mods/git-graph/reads.js", "README.md", "mods/recent-panes/mod.json", "docs/read-me-first/notes.md"];
  assert.deepEqual(paths(matchFiles(withFolders(repo), "READ")), ["README.md", "docs/read-me-first", "mods/git-graph/reads.js"],
    "the folder's name holds READ, its notes.md doesn't: the folder is a match, notes.md isn't");
  assert.deepEqual(paths(matchFiles(repo, "board lib")), ["mods/pr-board/lib/boardheader.js"], "each term in a name of its own");
  assert.deepEqual(paths(matchFiles(repo, "git-graph/re")), ["mods/git-graph/reads.js"], "a / spans folders on purpose");
});

test("/ finds folders too: every folder on the way to a file, once, marked as a folder", () => {
  const all = withFolders(files);
  assert.deepEqual(all.filter((p) => p.endsWith("/")), ["src/", "src/app/", "lib/", "lib/a/", "lib/a/p/", "docs/"].sort((a, b) => all.indexOf(a) - all.indexOf(b)));
  const row = matchFiles(all, "src app").rows.find((r) => r.path === "src/app");
  assert.ok(row, "the folder src/app is found");
  assert.equal(row.dir, true);
  assert.equal(row.name, "app");
});

test("the matches as a tree: each inside its open folders, folders first, matched letters marked on their rows", () => {
  const { rows, best, hits } = matchTree(matchFiles(withFolders(files), "app main").rows, "app main");
  assert.equal(best, "src/app/main.ts");
  assert.equal(hits, 1);
  assert.deepEqual(rows.map((r) => [r.path, r.depth, r.hit]), [["src", 0, false], ["src/app", 1, false], ["src/app/main.ts", 2, true]]);
  assert.deepEqual(rows[1].hl, [0, 1, 2], "app lights up on the app folder's row");
  assert.deepEqual(rows[2].hl, [0, 1, 2, 3], "main on the file's row");
  const two = matchTree(matchFiles(withFolders(files), "readme").rows, "readme").rows;
  assert.deepEqual(two.map((r) => r.path), ["README.md"]);
});

test("a filter that grows looks only at the last matches, and finds what a full search finds", () => {
  const many = Array.from({ length: 3000 }, (_, i) => `pkg${i % 37}/module-${i}/file${i % 11}.ts`);
  let last = null;
  for (const f of ["m", "mo", "mod", "mod ", "mod f", "mod fi7"]) {
    const narrowed = matchFiles(many, f, last), full = matchFiles(many, f);
    assert.deepEqual(paths(narrowed), paths(full), f);
    assert.deepEqual(narrowed.pool, full.pool, f);
    last = { key: f, pool: narrowed.pool };
  }
  // Backspace: not a narrowing of the last filter, so everything is searched again.
  assert.deepEqual(paths(matchFiles(many, "mo", last)), paths(matchFiles(many, "mo")));
  assert.equal(matchFiles(many, "f").rows.length, 300, "at most 300 rows");
  assert.equal(matchFiles(many, "mod").rows.length, 0, "module-… is in the folders' names only");
});

// The browser extends the viewer: a method of its own with a viewer method's name replaces that method for the
// viewer's own calls too. A `load(s, cx)` once did that (11-19): picking a file reloaded the tree, the file view stayed empty;
// a `follow(cx)` for the docked terminal did it to Markdown links and [ ] (11-22).
test("the file browser replaces only the viewer methods it means to", () => {
  const meant = ["init", "context", "back", "keyDown", "render", "close"];
  const viewer = new Set(Object.getOwnPropertyNames(Viewer.prototype));
  const replaced = Object.getOwnPropertyNames(FileBrowser.prototype).filter((n) => n !== "constructor" && viewer.has(n));
  assert.deepEqual(replaced.sort(), meant.sort(), "a new name shared with viewer.js: rename it, or add it here if it is meant to replace the viewer's");
});

// Loads that answer out of order (11-22): the docked browser moves from repository A to B while git is still
// answering for A. A's late answer must not replace B's tree, nor fill B's filter with A's file names.
test("a late answer for the repository before lands nowhere", async () => {
  const calls = [];
  globalThis.__herdrStubs = { exec: (cmd, args, opts) => new Promise((resolve) => calls.push({ args, cwd: opts.cwd, resolve })) };
  const answer = (cwd, first, stdout) => {
    const i = calls.findIndex((c) => c.cwd === cwd && c.args[0] === first);
    calls.splice(i, 1)[0].resolve({ code: 0, stdout });
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const cx = { spawn: (f) => f(cx), notify() {} };
  try {
    // A remote location (`on`) keeps the tree from watching folders; the tree's own loads are never answered.
    const fb = Object.assign(Object.create(FileBrowser.prototype), { closed: false, git: true, place: { on: "box" }, reveal() {} });
    fb.openAt({ cwd: "/a", on: "box" }, cx);
    fb.openAt({ cwd: "/b", on: "box" }, cx);
    answer("/b", "rev-parse", "/b\n\n");
    await settle();
    answer("/a", "rev-parse", "/a\n\n");
    await settle();
    assert.equal(fb.root, "/b", "A's tree arrived after B's and replaced it");

    fb.ensureFiles(cx); // listing B's files for the filter
    fb.filesLoad = null; fb.loadingFiles = false; fb.files = null; // what a move to another repository does
    answer("/b", "ls-files", "b.txt\0");
    await settle();
    assert.equal(fb.files, null, "a file list for the repository before filled the filter");
  } finally {
    delete globalThis.__herdrStubs;
  }
});

// Following the heading you're under after j/k scrolled away from it (11-22) went nowhere: the anchor was the same,
// so follow returned, and the scroll position (top) kept winning over the anchor.
test("following the current heading after scrolling goes back to it, without a history entry", () => {
  let notified = 0;
  const cx = { notify() { notified++; }, open_url() {} };
  const v = Object.assign(Object.create(Viewer.prototype), {
    selected: { file: "/r/doc.md" }, headings: [{ slug: "setup" }, { slug: "usage" }],
    anchor: "usage", top: 7, source: false, history: [], actionError: null,
  });
  v.follow("#usage", cx);
  assert.equal(v.top, null, "still where the keys scrolled to");
  assert.equal(v.anchor, "usage");
  assert.deepEqual(v.history, [], "a history entry for the same heading");
  assert.equal(notified, 1);
  v.follow("#usage", cx);
  assert.equal(notified, 1, "already at the heading: nothing to redraw");
});
