// file-browser's filter (main.js): run with `node --test 'tests/unit/*.test.mjs'`, Herdr's modules stubbed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./stub-hooks.mjs", import.meta.url);
const { matchFiles } = await import("../../mods/file-browser/main.js");

const files = ["src/App.tsx", "src/app/main.ts", "docs/apple.md", "lib/a/p/p.js", "README.md", "src/zapp.ts"];
const paths = (r) => r.rows.map((x) => x.path);

test("best first: file name and segment starts, then the shorter path, then the list's order", () => {
  assert.deepEqual(paths(matchFiles(files, "app")).slice(0, 3), ["src/App.tsx", "docs/apple.md", "src/zapp.ts"]);
  assert.deepEqual(paths(matchFiles(files, "APP")), paths(matchFiles(files, "app")), "case doesn't matter");
  assert.deepEqual(paths(matchFiles(files, "app main")), ["src/app/main.ts"], "every term must match");
  assert.deepEqual(paths(matchFiles(files, "qqq")), []);
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
  assert.equal(matchFiles(many, "m").rows.length, 300, "at most 300 rows");
});
