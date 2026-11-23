// The file browser's ⌘-click handler (mods/file-browser/link.js): the line and the path read from what was clicked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("./stub-hooks.mjs", import.meta.url);
const { lineOf, pathOf } = await import("../../mods/file-browser/link.js");

test("the line a clicked path names", () => {
  assert.equal(lineOf("src/main.rs:42"), 42);
  assert.equal(lineOf("src/main.rs:42:7"), 42);
  assert.equal(lineOf("lib/x.js:12:"), 12);
  assert.equal(lineOf("Foo.cs(42)"), 42);
  assert.equal(lineOf("Foo.cs(42,7)"), 42);
  assert.equal(lineOf("README.md"), null);
  assert.equal(lineOf("v1.2.3/notes.md"), null);
});

test("the path without its line, from a file URI too", () => {
  assert.equal(pathOf("src/main.rs:42:7"), "src/main.rs");
  assert.equal(pathOf("/srv/app/a b.txt"), "/srv/app/a b.txt");
  assert.equal(pathOf("file://box/srv/app/My%20Notes.md"), "/srv/app/My Notes.md");
  assert.equal(pathOf("Foo.cs(42,7)"), "Foo.cs");
});
