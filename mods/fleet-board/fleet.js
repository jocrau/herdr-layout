// Running agent-fleet: `fleet status --json` and `fleet runs --json` for the board; snapshot.js reads their
// output. This file runs commands and reads the settings; it never changes the run.

import { exec } from "herdr";
import { readSettings, settingPath, codeDir } from "./lib/settings.js";
import { homeOn, pathOf, machineSetting } from "./lib/machine.js";
import { failure, parseSnapshot, parseRuns, epicPhase, currentStatus } from "./snapshot.js";

// Which `fleet` to run: "fleet" from the person's PATH, or the one named in the layout's settings,
// <appHome>/data/workbench.json ({"fleet": "/path/to/fleet"}), e.g. a checkout's scripts/fleet.
// data/fleet-board.json, where it was before, is still read.
// Read again after a minute, so an edit to the settings applies without reloading the layout.
// The fleet may live on another machine ("fleet_machine": a name from `hc machine ls`): then every fleet command
// runs there, with that machine's login PATH, as `fleet` from it ("fleet" in the settings is this computer's).
let where = null, whereAt = 0;
export async function fleetWhere() {
  if (where && Date.now() - whereAt < 60000) return where;
  const conf = await readSettings(), on = machineSetting(conf.fleet_machine);
  const h = on ? await homeOn(on) : null;
  let bin = "fleet";
  for (const file of on ? [] : ["workbench.json", "fleet-board.json"]) {
    const named = settingPath((file === "workbench.json" ? conf : await readSettings(file)).fleet);
    if (named) { bin = named; break; }
  }
  where = { bin, on, home: h, path: on ? await pathOf(on) : null };
  whereAt = Date.now();
  return where;
}
export async function fleetBin() { return (await fleetWhere()).bin; }
// The machine the fleet lives on, null for this computer.
export async function fleetMachine() { return (await fleetWhere()).on; }

// Runs `command` (`fleet` for the fleet named in the settings) where the fleet lives: { code, stdout, stderr }.
// There, with that machine's login PATH (fleet's own tools, gh and git, come from it too).
export async function fleetExec(command, args, { cwd, timeout } = {}) {
  const w = await fleetWhere(), cmd = command === "fleet" ? w.bin : command;
  if (!w.on) return exec(cmd, args, { cwd, timeout });
  return exec("/usr/bin/env", [...(w.path ? [`PATH=${w.path}`] : []), cmd, ...args], { cwd, timeout, on: w.on });
}

// A shell line in a terminal where the fleet lives, staying open with a shell when it ends (zsh here, as before;
// there that machine's own login shell): the argv for terminal.open or tab.new.
export async function shellArgv(line) {
  return (await fleetMachine()) ? ["/bin/sh", "-c", `${line}; exec "\${SHELL:-/bin/sh}" -il`] : ["/bin/zsh", "-ic", `${line}; exec zsh -i`];
}

// One snapshot for the folder `cwd` (a repo or any worktree of it), of `epic` or else its current one:
// { ok: true, snap } or { ok: false, kind, message }.
export async function readSnapshot(cwd, epic = null) {
  const bin = await fleetBin();
  let r;
  try {
    r = await fleetExec("fleet", ["status", "--json", "--repo", cwd, ...(epic ? ["--epic", epic] : [])], { cwd, timeout: 20000 });
  } catch (e) {
    return { ok: false, kind: "missing", message: `Can't run ${bin}: ${String(e?.message ?? e)}` };
  }
  if (r.code !== 0) return failure(r.code, r.stderr, bin);
  const out = parseSnapshot(r.stdout, cwd);
  if (out.ok) {
    const phase = await readEpicPhase(out.snap.runDir);
    // The status as the tracker has it now (fleet 0.39), so a triage or close shows without a wave; else the event's.
    out.snap.epicPhase = { ...phase, status: currentStatus(out.snap, phase) };
  }
  return out;
}

// The run's epic.* events (the epic check, epic.status), which `fleet status --json` leaves out: only those
// lines of events.jsonl, so a long run's file isn't read whole. { check, status }, both null when none.
async function readEpicPhase(runDir) {
  if (!runDir) return { check: null, status: null };
  try {
    const r = await fleetExec("/usr/bin/grep", ["-F", '"type":"epic.', `${runDir}/events.jsonl`], { timeout: 5000 });
    return epicPhase((r.stdout ?? "").split("\n").filter(Boolean));
  } catch { return { check: null, status: null }; }
}

// `fleet runs --json` (agent-fleet.flow.runs) when this agent-fleet has it: every run with its repository's
// path, without a fleet status per folder. null when it doesn't (the board then tries the spaces' folders).
export async function readRuns() {
  const w = await fleetWhere();
  let r;
  try { r = await fleetExec("fleet", ["runs", "--json"], { timeout: 15000 }); } catch { return null; }
  return r.code === 0 ? parseRuns(r.stdout, w.on ? (w.home ? `${w.home}/Code` : null) : await codeDir()) : null;
}
