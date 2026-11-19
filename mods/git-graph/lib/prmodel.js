// Copied from lib/prmodel.js by lib/sync.mjs: edit it there, then run `node lib/sync.mjs`.
// The PR model shared by pr-board's pane and the PR view (git-graph): where a PR goes by your next move, what to
// say about it, and the actions possible in its state, from pr-flow's stage and the PR's facts. Pure functions
// (no Herdr calls), so tests can run them.
//
// The pane is grouped by your next move, not by pr-flow's stage:
//   your move     the PRs that wait on you, by what to do (decide, fix, review, answer, merge, get ready); a
//                 colleague's PR at any step of your review (review it, post your comments, finish your review)
//                 is under one "Review", so it stays there as the review goes on (REVIEW_STEPS)
//   waiting       on whom: the author, your reviewers, CI and bots
//                 (an agent you started is still yours: while it works the PR stays in Your move, where it was,
//                 agentAtWork; one that stopped to ask, "go?" or a permission, is your move too: agentWaits)
//   later, dormant
// Red is kept for real problems that are yours (a review loop; CI failing or conflicts on your own PR): on a
// colleague's PR they're its author's to fix, said in the text but not red (yoursToFix); counts are plain.
//
// With pr-flow's view model (pr-flow 0.32, capability `view`; ENGINE.md "View") each listing item carries `move`,
// `next_step` and `actions`, and these functions read them; the tables below (MOVES, nextStep's sentences,
// actionsFor's sections) are only the fallback for an older pr-flow. The PR's agent tab still outranks both
// (agentWaits): pr-flow can't see that an agent stopped to ask.

// Each stage: [group, action or whom it waits on, the verb for space, order within "your move"].
export const MOVES = {
  AGENT_WAITS: ["you", "Answer its agent", null, -1],
  LOOP_ALARM: ["you", "Decide", "nudge", 0],
  MY_BLOCKED: ["you", "Fix", "fix", 1],
  NEEDS_YOU: ["you", "Review", "post", 2],
  REVIEWED: ["you", "Review", "approve", 2], // pr-flow 0.33.2: clean but not approved, findings not sent
  MY_FEEDBACK: ["you", "Answer feedback", "fix", 4],
  READY: ["you", "Review", "review", 2],
  MY_MERGE: ["you", "Merge", "merge", 6],
  MY_ASK: ["you", "Ask for review", "ready", 7], // pr-flow 0.33.2: your PR nobody is asked to review
  MY_DRAFT: ["you", "Get ready", "ready", 8],
  WAITING: ["waiting", "author"],
  MY_PENDING: ["waiting", "reviewers"],
  SETTLING: ["waiting", "CI and bots"],
  REVIEWING: ["waiting", "an agent reviewing"],
  MY_BUSY: ["waiting", "an agent working"],
  SNOOZED: ["later", "later"],
  DORMANT: ["dormant", "dormant"],
  MY_DORMANT: ["dormant", "dormant"],
};

// pr-flow's labels for the steps of reviewing a colleague's PR: one block, "Review", where "Post your comments" was.
const REVIEW_STEPS = new Set(["Review", "Post your comments", "Finish your review"]);
const REVIEW_ORDER = 2;

export const GROUPS = [["you", "Your move"], ["waiting", "Waiting on others"], ["later", "Later"], ["dormant", "Dormant"]];

// The PR's agent tab outranks pr-flow's stage. pr-flow says an agent is at it (REVIEWING, MY_BUSY) until the job
// is recorded, but an agent that finished its turn to ask ("go?", "post these?") or stopped at a permission
// prompt waits on you. row.tab: the tab's status (working, blocked, done, idle; null without a tab). A blocked
// tab waits on you whatever the stage; a finished one only where pr-flow thinks it's still working.
const AGENT_AT_WORK = new Set(["REVIEWING", "MY_BUSY"]);
// A pr-flow job at it (row.job) is the agent then, not the tab: an idle tab from before doesn't wait on you.
export const agentWaits = (row) => row.tab === "blocked" || (AGENT_AT_WORK.has(row.stage) && !row.job && (row.tab === "done" || row.tab === "idle"));

// pr-flow's view model on a row, or null (an older pr-flow): { move, next_step, actions }.
export const viewOf = (row) => (row?.move && row.next_step && Array.isArray(row.actions) ? row : null);

// An agent at work on the PR (a review or self-check job, a session holding it) that hasn't stopped to ask. You
// started it, so the PR stays yours: it doesn't move to Waiting on others while the agent works.
export const agentAtWork = (row) => !agentWaits(row) && (AGENT_AT_WORK.has(row.stage) || viewOf(row)?.move?.waiting_on?.kind === "agent");

// Where a PR stays while its agent works: `row.held`, the place the pane last drew it in Your move (pr-board keeps
// it, so a card you act on stays where it is); else a review of a colleague's PR under Review, the rest under
// "Agents at work" at the end of Your move.
function atWorkPlace(row) {
  if (row.held?.[0] === "you") return [row.held[1], row.held[3] ?? 9];
  const verb = /^job-\d{8}-\d{6}-([a-z]+)-/.exec(row.job ?? "")?.[1];
  const own = row.role === "author" || /^MY_/.test(row.stage ?? "");
  return !own && (verb === "review" || row.stage === "REVIEWING") ? ["Review", REVIEW_ORDER] : ["Agents at work", 9];
}

// [group, label, the verb for space, order within "your move"].
export function moveOf(row) {
  if (agentWaits(row)) return MOVES.AGENT_WAITS;
  const v = viewOf(row);
  const verb = v ? v.actions.find((a) => a.role === "primary" && !a.disabled_reason)?.verb ?? null : null;
  if (agentAtWork(row)) { const [label, order] = atWorkPlace(row); return ["you", label, verb, order]; }
  if (v) return v.move.group === "you" && REVIEW_STEPS.has(v.move.label) ? ["you", "Review", verb, REVIEW_ORDER] : [v.move.group, v.move.label, verb, v.move.order ?? 9];
  return MOVES[row.stage] ?? ["waiting", "others"];
}

// Where a PR goes, in a few words, for a card that's moving there: "Waiting on vic", "Merge",
// "Later", "Dormant". (`me`: the person using the pane.)
export function placeText(row, me) {
  const [g, label] = moveOf(row);
  if (g === "you") return label;
  if (g === "waiting") return `Waiting on ${waitingOn(row, me).who}`;
  return label[0].toUpperCase() + label.slice(1);
}

// pr-flow's texts give times as ISO (ENGINE.md: hosts format them): "2026-11-30T17:50:00.000Z" → "30 Nov"
// ("30 Nov 2025" in another year).
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function readableTimes(text, now = new Date()) {
  return String(text ?? "").replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})/g, (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ""}`;
  });
}

// Shim for pr-flow 0.32.1 (fixed in 0.32.2): its next_step for SNOOZED, REVIEWING and MY_BUSY says problem: true
// without naming the problem. When the text names none, add what the facts say ("CI failing", "conflicts").
// Does nothing once the text names it; remove when the minimum pr-flow is 0.32.2.
export function withProblem(step, rec) {
  if (!step?.problem || /CI failing|conflict/i.test(step.text ?? "")) return step;
  const why = [rec?.ci === "FAILURE" || rec?.ci === "ERROR" ? "CI failing" : null, rec?.conflicts ? "conflicts" : null].filter(Boolean);
  return why.length ? { ...step, text: [step.text, ...why].filter(Boolean).join(" · ") } : step;
}

// "[Feature] Login form" → { tag: "Feature", title: "Login form" }; conventional-commit
// prefixes ("feat(cml): x") stay: they say what it is.
export function splitTitle(title) {
  const m = /^\s*\[([^\]]{1,20})\]\s*(.*)$/.exec(title ?? "");
  return m ? { tag: m[1], title: m[2] } : { tag: null, title: title ?? "" };
}

// A duration in the pane's words: 5m, 3h, 2d.
export function ago(ms) {
  if (!(ms >= 0)) return "";
  const m = Math.round(ms / 60000);
  return m < 60 ? `${Math.max(1, m)}m` : m < 2880 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}

const SEV = ["blocker", "high", "medium", "low"];
// "1 high open" (the worst open findings), or "".
export function openFindings(open) {
  const s = SEV.find((x) => open?.[x]);
  return s ? `${open[s]} ${s === "medium" ? "medium" : s} open` : "";
}

// Who's involved: { author, others: [{ who, mark, pending }] } — "you" for the person using pr-board; reviewers
// marked ✓ approved, ✗ changes requested; `pending`: asked, hasn't reviewed yet (drawn dimmer, no mark).
export function people(row, me) {
  const rec = row.rec ?? {}, you = (x) => (x && x === me ? "you" : x);
  const seen = new Map();
  for (const r of rec.reviewers ?? []) {
    const mark = r.state === "APPROVED" ? "✓" : r.state === "CHANGES_REQUESTED" ? "✗" : "";
    seen.set(r.who, { mark, pending: false });
  }
  for (const who of rec.requested ?? []) if (!seen.has(who)) seen.set(who, { mark: "", pending: true });
  // A PR you review that names nobody else: you're the reviewer.
  if (row.role === "reviewer" && me && !seen.has(me)) seen.set(me, { mark: "", pending: true });
  return { author: you(rec.author ?? row.author) || "?", others: [...seen].map(([who, v]) => ({ who: you(who), ...v })) };
}

// Whether a problem on the PR is yours to fix: on your own PR, yes; on a colleague's, only a review loop (talking
// to the author is yours); its failing CI or conflicts are its author's (said in the text, not red).
const yoursToFix = (row) => row.role !== "reviewer" || row.stage === "LOOP_ALARM" || viewOf(row)?.move.label === "Decide";

// The one sentence under a PR whose move is yours: what to do, and what matters for it. { text, problem }.
export function nextStep(row) {
  const step = stepOf(row);
  return step.problem && !yoursToFix(row) ? { ...step, problem: false } : step;
}
function stepOf(row) {
  const rec = row.rec ?? {}, detail = row.detail ?? "", f = openFindings(rec.open);
  const join = (...xs) => xs.filter(Boolean).join(" · ");
  if (agentWaits(row)) return { text: join(row.tab === "blocked" ? "Its agent needs you: answer in its tab" : "Its agent stopped and waits for you: answer in its tab", detail), problem: false };
  const v = viewOf(row);
  // A job's id in pr-flow's text ("job-20260301-101500-review-42-a1b2 working since …") reads as "a job".
  if (v) return withProblem({ text: readableTimes(v.next_step.text).replace(/\bjob-\d{8}-\d{6}-[\w-]+/g, "a job"), problem: Boolean(v.next_step.problem) }, rec);
  switch (row.stage) {
    case "LOOP_ALARM": return { text: join(`${detail || "many rounds"}: talk to the author`, f), problem: true };
    case "MY_BLOCKED": return { text: join(`Fix ${[rec.ci === "FAILURE" || rec.ci === "ERROR" ? "failing CI" : null, rec.conflicts ? "the conflicts" : null].filter(Boolean).join(" and ") || detail}`), problem: true };
    case "NEEDS_YOU": return { text: join("Post or copy your drafted comments", f), problem: false };
    case "MY_FEEDBACK": return { text: join(`Answer ${detail || "the review"}`), problem: false };
    case "READY": return {
      text: join(rec.reviewedSha ? `Re-review what changed since ${rec.reviewedSha.slice(0, 7)}` : "First review", f, rec.conflicts ? "conflicts" : null),
      problem: Boolean(rec.conflicts || rec.ci === "FAILURE"),
    };
    case "MY_MERGE": {
      const approved = (rec.reviewers ?? []).filter((r) => r.state === "APPROVED").length;
      return { text: join("Merge", approved ? `${approved} approved` : null, rec.ci === "SUCCESS" ? "CI ✓" : null), problem: false };
    }
    case "MY_DRAFT": return { text: join("Self-check, then mark ready and ask for reviews", rec.conflicts ? "conflicts" : null), problem: Boolean(rec.conflicts) };
    default: return { text: detail, problem: false };
  }
}

// Since when a PR waits (ms, NaN when unknown): pr-flow's waiting_on.since (the last push, the handback, the
// agent's start), else the record's last update or push.
export function waitingSince(row) {
  const w = !agentWaits(row) ? viewOf(row)?.move.waiting_on : null, rec = row.rec ?? {};
  return Date.parse((w ? w.since : null) ?? rec.updated ?? rec.lastPush ?? "");
}

// For a PR waiting on others: who it waits on, by name, and since when. { who, since }.
export function waitingOn(row, me, now = Date.now()) {
  const rec = row.rec ?? {}, [, whom] = moveOf(row), p = people(row, me);
  // pr-flow's view: whom (author, reviewers, CI, an agent) and since when (the last push, or the agent's start).
  const w = !agentWaits(row) ? viewOf(row)?.move.waiting_on : null;
  if (w) {
    const at = ago(now - Date.parse(w.since ?? "")), names = (Array.isArray(w.who) ? w.who : [w.who]).filter(Boolean)
      .map((x) => String(x).replace(/^team:/, "")).map((x) => (x === me ? "you" : x)).filter((x) => w.kind !== "reviewers" || x !== "you");
    if (w.kind === "author") return { who: names[0] ?? p.author, since: at };
    if (w.kind === "reviewers") return { who: names.length ? names.join(", ") : "no reviewer yet", since: at };
    if (w.kind === "ci") return { who: "CI and bots", since: at };
    return { who: whom, since: at }; // an agent: the pane names what it does, not the claim's holder
  }
  const since = ago(now - Date.parse(rec.updated ?? rec.lastPush ?? ""));
  if (whom === "author") return { who: p.author, since };
  if (whom === "reviewers") {
    const pending = p.others.filter((o) => o.who !== "you" && o.mark !== "✓").map((o) => o.who);
    return { who: pending.length ? pending.join(", ") : "no reviewer yet", since };
  }
  return { who: whom, since };
}

// Within a block, PRs keep one order whatever happens to them (a new push, a step of the review): by repository,
// then number.
const byPr = (a, b) => {
  const [ra, na] = a.key.split("#"), [rb, nb] = b.key.split("#");
  return ra < rb ? -1 : ra > rb ? 1 : Number(na) - Number(nb);
};

// The pane's rows in order: [{ group, label, rows }] for the groups that have any; "your move" split by
// action (in MOVES' order), the rest one block each; in each, by repository and number (byPr).
export function arrange(rows) {
  const out = [];
  rows = [...rows].sort(byPr);
  const you = rows.filter((r) => moveOf(r)[0] === "you");
  // In each action's order (pr-flow's move.order, else MOVES'), from the rows that have it.
  const orderOf = (a) => moveOf(you.find((r) => moveOf(r)[1] === a))[3] ?? 9;
  const actions = [...new Set(you.map((r) => moveOf(r)[1]))].sort((a, b) => orderOf(a) - orderOf(b));
  for (const a of actions) out.push({ group: "you", label: a, rows: you.filter((r) => moveOf(r)[1] === a) });
  for (const [g, label] of GROUPS.slice(1)) {
    const rs = rows.filter((r) => moveOf(r)[0] === g);
    // Waiting: the shortest wait first, the longest at the bottom, next to Dormant where it goes in time; an
    // unknown wait last. The rest keep byPr.
    if (g === "waiting") rs.sort((a, b) => (waitingSince(b) || 0) - (waitingSince(a) || 0) || byPr(a, b));
    if (rs.length) out.push({ group: g, label, rows: rs });
  }
  return out;
}

// pr-flow's action for a verb on a row (its label, kind, outward, confirm, disabled_reason), or null.
export const actionOf = (row, verb) => viewOf(row)?.actions.find((a) => a.verb === verb) ?? null;

// The actions a PR offers now, from pr-flow's section table (README: Sections and actions), minus what can't work
// yet: { main, also, keep } — main: the next step's verb; also: real alternatives; keep: housekeeping.
// post and copy need a drafted review; approve needs your review at the current head (pr-flow checks again).
// With pr-flow's view: its actions by role (open left out: the pane has its own GitHub button); a disabled one
// stays, drawn as such (actionOf says why).
export function actionsFor(row) {
  if (agentWaits(row)) return { main: null, also: [], keep: [] }; // the answer goes in its tab (space, t)
  const v = viewOf(row);
  if (v) {
    // Hand back is a real choice on a colleague's PR (it's the author's to fix first), not housekeeping: a button.
    const shown = (a) => a.role === "alternative" || (a.verb === "handback" && row.role === "reviewer");
    const by = (pick) => v.actions.filter((a) => pick(a) && a.verb !== "open").map((a) => a.verb);
    return { main: by((a) => a.role === "primary")[0] ?? null, also: by((a) => a.role !== "primary" && shown(a)), keep: by((a) => a.role === "housekeeping" && !shown(a)) };
  }
  const rec = row.rec ?? {}, unposted = /not posted|finding/.test(row.detail ?? "");
  const A = {
    LOOP_ALARM: ["nudge", ["review"], ["later", "ignore"]],
    NEEDS_YOU: ["post", ["copy", "approve"], ["discard"]],
    READY: ["review", rec.files > 40 ? ["split"] : [], ["later", "ignore"]],
    REVIEWED: ["approve", ["post", "copy"], ["later", "ignore"]],
    SETTLING: ["review", [], ["later", "ignore"]],
    WAITING: [unposted ? "post" : "approve", unposted ? ["copy", "approve", "ping"] : ["ping", "review"], ["later", "ignore"]],
    REVIEWING: [null, [], []],
    SNOOZED: ["review", [], ["later", "ignore"]],
    DORMANT: ["review", [], ["ignore", "close"]],
    MY_FEEDBACK: ["fix", [], ["later"]],
    MY_BLOCKED: ["fix", [], ["later"]],
    MY_MERGE: ["merge", ["ready"], []],
    MY_BUSY: [null, [], []],
    MY_PENDING: ["ping", ["ready"], ["later"]],
    MY_ASK: ["ready", [], ["later", "close"]],
    MY_DRAFT: ["ready", ["review"], ["later", "close"]],
    MY_DORMANT: ["close", ["review"], ["ignore"]],
  }[row.stage] ?? [null, [], ["later"]];
  return { main: A[0], also: A[1], keep: A[2] };
}
