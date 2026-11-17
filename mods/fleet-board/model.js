// Fleet board: what the views compute from a snapshot, with no Herdr or UI imports (tests import it).

export const STEPS = ["implement", "fix", "review", "check", "merge"];
export const VIEWS = [{ id: "board", label: "Board" }, { id: "lanes", label: "Lanes" }];
// Lanes' time window: "fit" spans the run from its first step to now (or its last activity), filling the width.
export const SPANS = ["fit", ...[1, 4, 12, 48, 168].map((h) => h * 3600000)];
export const IDLE_POLL = 60000; // the watch is the main signal; this catches what it misses
export const SCAN_EVERY = 60000; // the run list is read (`fleet runs --json`, cheap) this often
export const DIRTY_EVERY = 15000; // another run whose files changed is read again at most this often
export const HIDDEN_CHECK = 120000; // hidden, the pane still looks this often for new waits (one cheap read)
export const MIN_GAP = 15000; // at most one `fleet status --json` per this many ms (a busy wave writes often)
export const TAIL_EVERY = 4000; // the tail panel re-reads an active bead's `fleet tail` this often
export const TAIL_LINES = 14; // lines the tail panel shows

// Sections of the board, most urgent first.
export const SECTIONS = [
  { state: "parked", label: "Needs you" },
  { state: "running", label: "Running" },
  { state: "interrupted", label: "Interrupted" },
  { state: "waiting for CI", label: "Waiting on GitHub" },
  { state: "queued", label: "Queued" },
  { state: "blocked", label: "Blocked" },
  // Dropped beads are closed too (out of the epic's scope): they fold away with the merged ones.
  { state: "done", also: "dropped", label: "Done", fold: true },
];

// One row size for every view (Board, Lanes), so a bead's row keeps its height and its id its place
// when you switch: the row's height, the id's size, the title's, and the small print's.
export const ROW = { h: 24, id: 12.5, text: 12, small: 11.5 };

export const OK = new Set(["pass", "done", "merged"]);
export const BAD = new Set(["fail", "changes"]);
// Gate actions run from here (they only show something, or wait for you to type); the rest are copied.
// A gate's command as words, only when every word is plain (no quotes, spaces or shell characters) and it
// is `fleet …` or `gh pr view …`: anything else is offered to copy, never run (the text comes from the run's JSON).
export const WORD = /^[A-Za-z0-9._:/=@+-]+$/;
export const wordsOf = (cmd) => {
  const w = String(cmd ?? "").trim().split(/ +/);
  return w.every((x) => WORD.test(x)) && (w[0] === "fleet" && w.length > 1 || (w[0] === "gh" && w[1] === "pr" && w[2] === "view")) ? w : null;
};
// Read-only looks run at once, in a terminal; everything else asks first.
export const readOnly = (w) => w[0] === "gh" || ["answer", "session", "diff", "tail"].includes(w[1]) || (w[1] === "gate" && w[2] === "show");
// One word for a shell line.
export const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

// Lanes groups the steps into three phases, drawn as three shades of one colour from faint to strong, so a
// bead darkens as it moves along: build (implement, check, fix), review, land (merge, CI). Colour beyond that is
// only for exceptions (red: sent back, waiting for you). The tooltip still names the step.
// What a step does, as Lanes and the details draw it: colour says what (a theme colour's name), height says who.
// An agent's steps (agent: true, the AGENT_STEPS below) are full bars; checks and the merge, which take no
// agent, thin lines. A fix is implementing again (the red tick before it says it was sent back).
export const PHASES = [
  { id: "implement", label: "implement", steps: ["implement", "fix"], color: "accent", agent: true },
  { id: "check", label: "check", steps: ["check", "prepare", "coverage"], color: "muted", agent: false },
  { id: "review", label: "review", steps: ["review"], color: "violet", agent: true },
  { id: "merge", label: "merge", steps: ["merge"], color: "ansi2", agent: false },
];
// A step this board doesn't know yet: drawn as a check (no agent assumed).
export const phaseOf = (step) => PHASES.find((p) => p.steps.includes(step)) ?? PHASES[1];

export function dur(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "-";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h${String(m % 60).padStart(2, "0")}` : `${Math.floor(h / 24)}d${h % 24}h`;
}
export const spanLabel = (ms) => (ms === "fit" ? "fit" : ms >= 86400000 ? `${ms / 86400000}d` : `${ms / 3600000}h`);
// Agent steps take a worker (as agent-fleet counts workers); checks and merges run in the coordinator.
export const AGENT_STEPS = new Set(["implement", "review", "fix"]);
export const hm = (ms) => new Date(ms).toTimeString().slice(0, 5);

// Where a bead's time went: its steps (a running one ends now), the time between them (queued: waiting for a
// worker, or for the next wave), agent and check time, and its rounds (0 the build, then one per fix).
export function timeline(b, now) {
  const segs = b.history.map((h) => {
    const live = h.end === null && !h.outcome && b.state === "running";
    return { ...h, live, to: h.end ?? (live ? now : h.start) };
  });
  if (!segs.length) return null;
  const from = segs[0].start, to = Math.max(...segs.map((x) => x.to));
  let agents = 0, checks = 0, busy = 0, end = from, prev = null;
  const parts = [];
  for (const x of segs) {
    const d = Math.max(0, x.to - x.start);
    if (AGENT_STEPS.has(x.step)) agents += d; else checks += d;
    if (x.start - end >= 60000) parts.push({ gap: true, ms: x.start - end, from: end, to: x.start, waves: prev && prev.wave !== x.wave ? [prev.wave, x.wave] : null });
    busy += Math.max(x.to, end) - Math.max(x.start, end); end = Math.max(end, x.to);
    parts.push({ step: x, ms: d });
    prev = x;
  }
  const rounds = [];
  for (const x of segs) {
    let r = rounds.at(-1);
    if (!r || r.round !== x.round) rounds.push((r = { round: x.round, steps: [], cost: 0 }));
    r.steps.push(x); r.cost += x.cost ?? 0;
  }
  return { from, to, wall: to - from, agents, checks, queued: Math.max(0, to - from - busy), parts, rounds, live: segs.some((x) => x.live) };
}

// Each id as short as it reads: the epic's own beads without the epic (".12", ".snapshot"), others without
// the repository's prefix (acme-web-erd.8.16: "erd.8.16").
export function shortener(epic) {
  const dash = epic.lastIndexOf("-"), repo = dash > 0 ? epic.slice(0, dash + 1) : "";
  return (id) => (id.startsWith(epic + ".") ? id.slice(epic.length) : repo && id.startsWith(repo) ? id.slice(repo.length) : id);
}

// Who waits for whom among the open beads; the critical path; how many each unblocks.
export function graph(beads) {
  const byId = new Map(beads.map((b) => [b.id, b]));
  const isOpen = (id) => byId.has(id) && !["done", "dropped"].includes(byId.get(id).state);
  const kids = new Map(beads.map((b) => [b.id, []]));
  for (const b of beads) for (const p of b.blockers) if (kids.has(p)) kids.get(p).push(b.id);
  const reach = new Map();
  const down = (id, seen) => {
    for (const k of kids.get(id) ?? []) if (!seen.has(k) && isOpen(k)) { seen.add(k); down(k, seen); }
    return seen;
  };
  for (const b of beads) reach.set(b.id, isOpen(b.id) ? down(b.id, new Set()).size : 0);
  const memo = new Map();
  const longest = (id, path = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    if (path.has(id)) return [id]; // a cycle: stop
    path.add(id);
    let best = [];
    for (const k of kids.get(id) ?? []) if (isOpen(k)) { const c = longest(k, path); if (c.length > best.length) best = c; }
    path.delete(id);
    const chain = [id, ...best];
    memo.set(id, chain);
    return chain;
  };
  let chain = [];
  for (const b of beads) if (isOpen(b.id)) { const c = longest(b.id); if (c.length > chain.length) chain = c; }
  if (chain.length < 2) chain = [];
  return { byId, kids, reach, chain, critical: new Set(chain), isOpen };
}

// A gate's reason without the kind it starts with ("questions: How should…" -> "How should…").
export const gateText = (gate) => (gate?.reason ?? "").replace(new RegExp(`^${(gate?.shown ?? gate?.kind ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*`), "")
  .replace(/(?:~|\/[^\s/:]+)(?:\/[^\s/:]+)+\/([^\s/:]+)/g, "$1"); // a path as its file name (fleet gate show has it in full)
// A gate the agent asked something in (its questions), not one where a step failed and only wants a resume.
export const asks = (b) => b.state === "parked" && (b.gate?.questions ?? []).length > 0;

// Fix rounds (a round resumed in a later wave is still one round), and the fix sessions they took.
export const fixRounds = (b) => new Set(b.history.filter((h) => h.step === "fix").map((h) => h.round)).size;
export const fixSessions = (b) => b.history.filter((h) => h.step === "fix").length;
// Ids in reading order: .2 before .10.
export function natural(a, b) {
  const x = a.split(/(\d+)/), y = b.split(/(\d+)/);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    return i % 2 ? Number(x[i]) - Number(y[i]) : x[i] < y[i] ? -1 : 1;
  }
  return x.length - y.length;
}
export const mergedAt = (b) => b.history.filter((h) => h.step === "merge" && h.end).at(-1)?.end ?? 0;

// Text for a tooltip: wrapped on word boundaries, at most a few lines (shared: lib/tiptext.js).
export { tipText } from "./lib/tiptext.js";

