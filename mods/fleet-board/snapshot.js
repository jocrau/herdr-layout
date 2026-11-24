// Reading agent-fleet's JSON (`fleet status --json`, schema 1; `fleet runs --json`) into what the views draw.
// The schema is in agent-fleet's README ("fleet status --json"): times UTC ISO 8601, durations seconds, usage
// windows fractions. Pure: no Herdr imports, so the tests import it; fleet.js runs the commands.

export const SCHEMA = 1;
export const ms = (iso) => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};


// A bead's steps with epoch-ms times. A step with no recorded start (a merge: only merge.done says when) starts
// where the step before it ended, else at its own end; one with neither time is left out.
export function steps(history) {
  const out = [];
  for (const h of history) {
    let start = ms(h.start);
    const end = ms(h.end);
    if (start === null) start = end === null ? null : Math.min(end, out.at(-1)?.end ?? end);
    if (start === null) continue;
    out.push({ ...h, start, end });
  }
  return out;
}

// Every time the fleet waited for the person on a bead: its gates[], with epoch-ms times.
export function gatesOf(b) {
  const starts = (b.history ?? []).map((h) => ms(h.start)).filter((t) => t !== null).sort((x, y) => x - y);
  return (b.gates ?? []).map((g) => ({ ...g, opened: ms(g.opened), resolved: ms(g.resolved) })).filter((g) => g.opened !== null).map((g) => {
    // Open, but the bead isn't parked any more (it went on, or was dropped): the wait ended where its next
    // step started; with none, it isn't counted.
    if (g.resolved !== null || b.state === "parked") return g;
    const next = starts.find((t) => t > g.opened);
    return next === undefined ? null : { ...g, resolved: next, how: g.how ?? "went on" };
  }).filter(Boolean);
}

// A parked bead whose gate you already resolved (fleet resume / answer / approve write the gate's resolved file;
// the bead stays gated until the next wave picks it up): it waits for the fleet now, not for you. Queued, with
// `went` saying how its wait ended ("resumed", "answered", "approved"); no gate, so nothing offers to resume it again.
export function goneOn(b) {
  if (b.state !== "parked" || !b.gate?.id) return b;
  const g = b.gates.find((x) => x.id === b.gate.id);
  if (!g || g.resolved === null) return b;
  return { ...b, state: "queued", gate: null, went: g.how ?? "resumed" };
}

// Epoch milliseconds for every time; a few derived fields the views share.
export function normalize(raw, cwd) {
  const e = raw.epic;
  const beads = (raw.beads ?? []).map((b) => ({
    ...b,
    step_started: ms(b.step_started),
    gate: b.gate ? { ...b.gate, since: ms(b.gate.since) } : null,
    history: steps(b.history ?? []),
    blockers: b.blockers ?? [],
    gates: gatesOf(b),
  })).map(goneOn);
  // A bead you resumed, answered or approved isn't waiting for you any more: the counts say so too.
  const settled = beads.filter((b) => b.went).length;
  return {
    cwd,
    generated: ms(raw.generated),
    runDir: raw.run_dir,
    epic: {
      ...e,
      // Defaults for what a partial snapshot leaves out, so the views never read through undefined.
      workers: { used: 0, max: null, ...(e.workers ?? {}) },
      beads: (({ parked, ...rest }) => ({ ...rest, parked: Math.max(0, parked - settled) }))({ total: 0, done: 0, dropped: 0, parked: 0, running: 0, ...(e.beads ?? {}) }),
      wave: { running: false, ...e.wave, started: ms(e.wave?.started), last_ended: e.wave?.last_ended ? { ...e.wave.last_ended, at: ms(e.wave.last_ended.at) } : null },
      usage: e.usage ? { ...e.usage, reset_5h: ms(e.usage.reset_5h), reset_7d: ms(e.usage.reset_7d) } : null,
      // The epic's status now, read from the tracker on every call (fleet 0.39); null before, or when it can't say.
      status: e.status ? statusOf(e.status) : null,
    },
    beads,
    gauges: {
      ...raw.gauges,
      merged_per_hour: (raw.gauges?.merged_per_hour ?? []).map((m) => ({ from: ms(m.from), merged: m.merged })),
      parked_waits: (raw.gauges?.parked_waits ?? []).filter((p) => !beads.some((b) => b.went && b.id === p.bead)).map((p) => ({ ...p, since: ms(p.since) })),
      person_waits: raw.gauges?.person_waits ?? null,
    },
  };
}

// The epic-level phase, from the run's epic.* events (events.jsonl; `fleet status --json` carries neither):
//   check: the last epic check on the epic branch: { state: "running", head, since }, { state: "pass" | "fail",
//     head, at, log }, or { state: "stopped", head, at, lastPass: { head, at } | null } (its wave stopped it with
//     no result: not checked, never a failure); null before the first. Only status "fail" (or passed: false) fails.
//   status: the last epic.status: statusOf's shape (pr: the epic's PR to main, or null).
export function epicPhase(lines) {
  let check = null, status = null, lastPass = null;
  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    const d = ev?.detail ?? {};
    if (ev?.type === "epic.check") {
      const head = d.head ?? null, at = ms(ev.ts);
      const state = d.status === "started" ? "running"
        : d.status === "pass" || d.passed === true ? "pass"
        : d.status === "fail" || d.passed === false ? "fail"
        : "stopped"; // "stopped" (or anything else with no result): not checked
      check = state === "running" ? { state, head, since: at }
        : state === "stopped" ? { state, head, at, lastPass }
        : { state, head, at, log: d.log ?? null };
      if (state === "pass") lastPass = { head, at };
    } else if (ev?.type === "epic.status") {
      status = statusOf(d);
    }
  }
  return { check, status };
}
// An epic status (an epic.status event's detail, or `fleet status --json`'s epic.status): { closed, total,
// followups: [ids] (the agents' follow-ups not closed, decided or not), untriaged: [ids] (those waiting for
// `fleet triage`) or null when this agent-fleet doesn't say (before 0.39), pr }.
export function statusOf(d) {
  const ids = (v) => (Array.isArray(v) ? v : []);
  return { closed: d.closed ?? 0, total: d.total ?? 0, followups: ids(d.followups),
    untriaged: Array.isArray(d.untriaged) ? d.untriaged : null, pr: prOf(d.pr) };
}

// The follow-ups as the board says them: `triage` (ids waiting for `fleet triage`), `rest` (open ones decided
// already, or, when this agent-fleet doesn't say which wait (`known` false), every open one, with no triage claim).
export function followupCounts(st) {
  const fu = st?.followups ?? [], un = st?.untriaged;
  if (!Array.isArray(un)) return { triage: [], rest: fu.length, known: false };
  const waiting = new Set(un);
  return { triage: un, rest: fu.filter((id) => !waiting.has(id)).length, known: true };
}

// The status to show: the current one from `fleet status --json`, else the last wave's epic.status event.
export const currentStatus = (snap, phase) => snap?.epic?.status ?? phase?.status ?? null;

// The PR to main as { url, label }: a URL, a number, or an object with url/number (null when none).
function prOf(pr) {
  if (!pr) return null;
  if (typeof pr === "string") return { url: /^https?:/.test(pr) ? pr : null, label: pr.replace(/^https?:\/\/github\.com\/[^/]+\/([^/]+)\/pull\//, "$1#") };
  if (typeof pr === "number") return { url: null, label: `#${pr}` };
  const n = pr.number ?? null, url = pr.url ?? null;
  return { url, label: n ? `#${n}${pr.state ? ` ${String(pr.state).toLowerCase()}` : ""}` : url ?? "PR" };
}

// The folder whose changes mean the snapshot changed: the repo's state directory
// (<state>/<repo>), which holds run.lock and every epic. Paths under it that matter:
export const RELEVANT = /(\/events\.jsonl|\/wave\.json|\/run\.json|\/state\.json|\/run\.lock|\/current|\/gates\/[^/]+\.json|\/merge\.json)$/;
export const stateRoot = (runDir) => runDir ? runDir.replace(/\/(epics|runs)\/[^/]+\/?$/, "") : null;
// A batch holding the root itself means "refresh everything" (watchFolder overflowed).
export const relevant = (root, paths) => paths.some((p) => p === root || p === `${root}/` || RELEVANT.test(p));

// ---------- every run on this machine (the strip of chips)

// One chip's worth of a run: where it is, its epic, whether a wave runs, what needs the person.
// `key` tells runs apart: the repository's name (its state directory's) and the epic. Several folders
// (worktrees, spaces) of one repository share it, and `fleet runs --json` (readRuns) gives the same key.
export const runKey = (repoName, epic) => `${repoName}\0${epic}`;
export function summarize(snap, cwd) {
  const b = snap.epic.beads ?? {};
  const last = Math.max(0, ...snap.beads.flatMap((x) => x.history.map((h) => h.end ?? h.start)));
  const repoName = (snap.runDir ?? cwd).split("/").slice(-3, -2)[0] || cwd.split("/").pop();
  return {
    key: runKey(repoName, snap.epic.id),
    cwd, repoName, epic: snap.epic.id,
    running: Boolean(snap.epic.wave?.running), parked: b.parked ?? 0, busy: b.running ?? 0,
    open: (b.total ?? 0) - (b.done ?? 0) - (b.dropped ?? 0), last: last || null,
    finished: (b.total ?? 0) - (b.done ?? 0) - (b.dropped ?? 0) <= 0 && !snap.epic.wave?.running,
  };
}


// The repositories (state directory names) whose run changed, in one batch of paths watched under the
// state root (~/.local/state/agent-fleet). A batch holding the root itself means "all of them".
export function changedRepos(root, paths) {
  const out = new Set();
  for (const p of paths) {
    if (p === root || p === `${root}/`) { out.add("*"); continue; }
    if (!p.startsWith(root + "/") || !RELEVANT.test(p)) continue;
    out.add(p.slice(root.length + 1).split("/")[0]);
  }
  return out;
}

// What a failed `fleet status --json` means, from its exit code and error text:
//   kind "none": no fleet here (no .fleet.toml, no run); "old": an agent-fleet without status --json;
//   "missing": no fleet command; "error": anything else.
export function failure(code, stderr, bin = "fleet") {
  const err = (stderr || "").trim();
  if (/unrecognized arguments: --json/.test(err)) return { ok: false, kind: "old", message: "The fleet board needs agent-fleet 0.37 or later." };
  if (/\.fleet\.toml is missing|no (fleet )?run|nothing has run|no epic/i.test(err)) return { ok: false, kind: "none", message: err.replace(/^fleet: /, "") };
  if (code === 127 || /command not found|No such file/.test(err)) return { ok: false, kind: "missing", message: `No ${bin} command: run \`fleet install-cli\`.` };
  return { ok: false, kind: "error", message: err.replace(/^fleet: /, "") || `fleet exited with ${code}` };
}

// `fleet status --json`'s output for the folder `cwd`, as { ok: true, snap } or { ok: false, kind, message }.
export function parseSnapshot(stdout, cwd) {
  let raw;
  try { raw = JSON.parse(stdout); } catch { return { ok: false, kind: "error", message: "fleet status --json printed no JSON." }; }
  if (raw?.schema !== SCHEMA) return { ok: false, kind: "error", message: `Unknown snapshot schema ${raw?.schema} (this pane reads ${SCHEMA}).` };
  return { ok: true, snap: normalize(raw, cwd) };
}

// `fleet runs --json`'s output as the strip's runs (summarize()'s shape), or null when it isn't that.
// Every run, each epic of each repository (not only a repository's current one), read again by folder and epic.
// A run that didn't record its repository's folder is looked for under the code folder (`codeDir/<repo>`).
export function parseRuns(stdout, codeDir = null) {
  let raw;
  try { raw = JSON.parse(stdout); } catch { return null; }
  if (raw?.schema !== 1 || !Array.isArray(raw.runs)) return null;
  return raw.runs.map((x) => {
    const repoName = x.repo_name ?? x.repo?.split("/").pop() ?? null;
    const cwd = x.repo ?? (repoName && codeDir ? `${codeDir}/${repoName}` : null);
    return cwd && x.epic ? {
      key: runKey(repoName, x.epic), cwd, repoName, epic: x.epic,
      running: Boolean(x.wave?.running), parked: x.beads?.parked ?? 0, busy: x.beads?.running ?? 0,
      open: (x.beads?.total ?? 0) - (x.beads?.done ?? 0) - (x.beads?.dropped ?? 0), last: ms(x.last_activity),
      finished: Boolean(x.finished),
    } : null;
  }).filter(Boolean);
}
