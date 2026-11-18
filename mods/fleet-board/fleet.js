// Running agent-fleet: `fleet status --json` and `fleet runs --json` for the board; snapshot.js reads their
// output. This file runs commands and reads the settings; it never changes the run.

import { exec } from "herdr";
import { readSettings, settingPath, codeDir } from "./lib/settings.js";
import { failure, parseSnapshot, parseRuns, epicPhase } from "./snapshot.js";

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

// One snapshot for the folder `cwd` (a repo or any worktree of it), of `epic` or else its current one:
// { ok: true, snap } or { ok: false, kind, message }.
export async function readSnapshot(cwd, epic = null) {
  const bin = await fleetBin();
  let r;
  try {
    r = await exec(bin, ["status", "--json", "--repo", cwd, ...(epic ? ["--epic", epic] : [])], { cwd, timeout: 20000 });
  } catch (e) {
    return { ok: false, kind: "missing", message: `Can't run ${bin}: ${String(e?.message ?? e)}` };
  }
  if (r.code !== 0) return failure(r.code, r.stderr, bin);
  const out = parseSnapshot(r.stdout, cwd);
  if (out.ok) out.snap.epicPhase = await readEpicPhase(out.snap.runDir);
  return out;
}

// The run's epic.* events (the epic check, epic.status), which `fleet status --json` leaves out: only those
// lines of events.jsonl, so a long run's file isn't read whole. { check, status }, both null when none.
async function readEpicPhase(runDir) {
  if (!runDir) return { check: null, status: null };
  try {
    const r = await exec("/usr/bin/grep", ["-F", '"type":"epic.', `${runDir}/events.jsonl`], { timeout: 5000 });
    return epicPhase((r.stdout ?? "").split("\n").filter(Boolean));
  } catch { return { check: null, status: null }; }
}

// `fleet runs --json` (agent-fleet.flow.runs) when this agent-fleet has it: every run with its repository's
// path, without a fleet status per folder. null when it doesn't (the board then tries the spaces' folders).
export async function readRuns() {
  const bin = await fleetBin();
  let r;
  try { r = await exec(bin, ["runs", "--json"], { timeout: 15000 }); } catch { return null; }
  return r.code === 0 ? parseRuns(r.stdout, await codeDir()) : null;
}
