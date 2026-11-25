// Every board's text sizes come from lib/type.js: no literal number in a text_size call, so a size changes once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { TYPE } from "../../lib/type.js";

const ROOT = new URL("../../mods/", import.meta.url).pathname;
const VENDOR = /(\.bundle\.js|js-yaml\.js)$/;
const files = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  if (statSync(p).isDirectory()) return n === "lib" || n === "icons" ? [] : files(p);
  return p.endsWith(".js") && !VENDOR.test(p) ? [p] : [];
});

test("the scale is ascending and has no two names for one size", () => {
  const sizes = Object.values(TYPE);
  assert.deepEqual([...sizes].sort((a, b) => a - b), sizes);
  assert.equal(new Set(sizes).size, sizes.length);
});

test("no board writes a text size as a number", () => {
  const found = files(ROOT).flatMap((f) => readFileSync(f, "utf8").split("\n")
    .map((line, i) => (/text_size\(\s*\d/.test(line) ? `${f.slice(ROOT.length)}:${i + 1}` : null)).filter(Boolean));
  assert.deepEqual(found, [], "use TYPE.<name> from lib/type.js");
});
