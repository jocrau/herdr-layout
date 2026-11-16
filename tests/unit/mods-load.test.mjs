// Every mod's modules load and link (imports match exports), with Herdr's own modules stubbed; and the classes
// that are split across modules still have every method. Run with `node --test 'tests/unit/*.test.mjs'`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readdirSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

register("./stub-hooks.mjs", import.meta.url);
const MODS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../mods");

for (const mod of readdirSync(MODS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
  const lib = path.join(MODS, mod, "lib");
  const files = [...readdirSync(path.join(MODS, mod)).filter((f) => f.endsWith(".js") && !f.endsWith(".bundle.js")),
    ...(existsSync(lib) ? readdirSync(lib).filter((f) => f.endsWith(".js")).map((f) => `lib/${f}`) : [])];
  for (const f of files) {
    test(`${mod}/${f} loads`, async () => { await import(pathToFileURL(path.join(MODS, mod, f)).href); });
  }
}

test("FleetBoard has its methods from every module", async () => {
  const { default: FleetBoard } = await import(pathToFileURL(path.join(MODS, "fleet-board/main.js")).href);
  for (const m of ["init", "key", "render", "worker", "readStep", "scanStep", "show", "alertParked", "ask", "runFleet",
    "sendAnswer", "actions", "header", "board", "lanes", "details", "stepTable", "row", "tailPanel"]) {
    assert.equal(typeof FleetBoard.prototype[m], "function", m);
  }
});

test("Graph has its methods from every module", async () => {
  const { Graph } = await import(pathToFileURL(path.join(MODS, "git-graph/graph.js")).href);
  for (const m of ["init", "refresh", "render", "watch", "scan", "watchRepos", "openBranches", "openRepos",
    "loadDetails", "detailsPane", "resetFile", "navKey", "list", "header", "toolbar", "checkout"]) {
    assert.equal(typeof Graph.prototype[m], "function", m);
  }
});
