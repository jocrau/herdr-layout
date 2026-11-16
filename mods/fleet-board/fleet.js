// Running agent-fleet: `fleet status --json` and `fleet runs --json` for the board; snapshot.js reads their
// output. This file runs commands and reads the settings; it never changes the run.

import { exec } from "herdr";
import { readSettings, settingPath } from "./lib/settings.js";
import { failure, parseSnapshot, parseRuns } from "./snapshot.js";

// Which `fleet` to run: "fleet" from the person's PATH, or the one named in the layout's settings,
// <appHome>/data/workbench.json ({"fleet": "/path/to/fleet"}), e.g. a checkout's scripts/fleet.
// data/fleet-board.json, where it was before, is still read.
// Read again after a minute, so an edit to the settings applies without reloading the layout.
let binCache = null, binAt = 0;
export async function fleetBin() {
  if (binCache && Date.now() - binAt < 60000) return binCache;
  let bin = "fleet";
  for (const file of ["workbench.json", "fleet-board.json"]) {
    const named = settingPath((await readSettings(file)).fleet);
    if (named) { bin = named; break; }
  }
  binCache = bin; binAt = Date.now();
  return bin;
}

// One snapshot for the folder `cwd` (a repo or any worktree of it): { ok: true, snap } or { ok: false, kind, message }.
export async function readSnapshot(cwd) {
  const bin = await fleetBin();
  let r;
  try {
    r = await exec(bin, ["status", "--json", "--repo", cwd], { cwd, timeout: 20000 });
  } catch (e) {
    return { ok: false, kind: "missing", message: `Can't run ${bin}: ${String(e?.message ?? e)}` };
  }
  return r.code !== 0 ? failure(r.code, r.stderr, bin) : parseSnapshot(r.stdout, cwd);
}

// `fleet runs --json` (agent-fleet.flow.runs) when this agent-fleet has it: every run with its repository's
// path, without a fleet status per folder. null when it doesn't (the board then tries the spaces' folders).
export async function readRuns() {
  const bin = await fleetBin();
  let r;
  try { r = await exec(bin, ["runs", "--json"], { timeout: 15000 }); } catch { return null; }
  return r.code === 0 ? parseRuns(r.stdout) : null;
}
