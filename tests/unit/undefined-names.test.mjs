// No mod uses a name it never declares or imports (ESLint's no-undef): such a slip only fails when that code
// path runs, so neither `node --check` nor `herdr-app check` sees it. Uses a global ESLint; skipped without one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let eslintApi = null;
try {
  const api = path.join(execFileSync("npm", ["root", "-g"]).toString().trim(), "eslint/lib/api.js");
  if (existsSync(api)) eslintApi = pathToFileURL(api).href;
} catch { /* no npm */ }

// What Herdr's JavaScript runtime provides besides the language's own globals.
const PLATFORM = ["console", "localStorage", "fetch", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "URL",
  "TextEncoder", "TextDecoder", "queueMicrotask", "structuredClone", "AbortController", "performance", "globalThis", "window"];

// Without ESLint, TypeScript's checker finds the same ("Cannot find name"), but it takes about a minute (it follows
// the viewers' imports into the mermaid bundles), so only with HERDR_LAYOUT_SLOW=1.
let tsc = null;
try { tsc = execFileSync("sh", ["-c", "command -v tsc"]).toString().trim() || null; } catch { /* none */ }
const slow = process.env.HERDR_LAYOUT_SLOW === "1";

test("every name a mod uses is declared or imported (tsc)", { skip: eslintApi ? "ESLint does it" : !tsc ? "no tsc" : !slow && "slow: HERDR_LAYOUT_SLOW=1", timeout: 300000 }, () => {
  const files = execFileSync("sh", ["-c", "ls mods/*/*.js mods/*/lib/*.js | grep -v bundle"], { cwd: ROOT }).toString().trim().split("\n");
  let out = "";
  try {
    execFileSync(tsc, ["--allowJs", "--checkJs", "--noEmit", "--target", "es2022", "--module", "esnext", "--moduleResolution", "bundler",
      "--skipLibCheck", "--lib", "es2023,dom", ...files], { cwd: ROOT, maxBuffer: 64 << 20 });
  } catch (e) { out = String(e.stdout ?? ""); } // tsc exits non-zero on any type complaint; only undefined names matter here
  const problems = out.split("\n").filter((l) => /error TS(2304|2552):/.test(l) && !l.includes(".bundle.js"));
  assert.deepEqual(problems, []);
});

test("every name a mod uses is declared or imported", { skip: !eslintApi && "no global eslint (npm i -g eslint)" }, async () => {
  const { ESLint } = await import(eslintApi);
  const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: true, overrideConfig: [{
    files: ["**/*.js"], ignores: ["**/*.bundle.js"],
    linterOptions: { reportUnusedDisableDirectives: "off" },
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: Object.fromEntries(PLATFORM.map((g) => [g, "readonly"])) },
    rules: { "no-undef": "error" } }] });
  const problems = (await eslint.lintFiles(["mods/*/*.js", "mods/*/lib/*.js"]))
    .flatMap((r) => r.messages.map((m) => `${path.relative(ROOT, r.filePath)}:${m.line} ${m.message}`));
  assert.deepEqual(problems, []);
});
