// Copied from lib/prmodel.js by lib/sync.mjs: edit it there, then run `node lib/sync.mjs`.
// The PR model shared by pr-board's pane and the PR view (git-graph): where a PR goes by your next move, what to
// say about it, and the actions possible in its state, from pr-flow's stage and the PR's facts. Pure functions
// (no Herdr calls), so tests can run them.
//
// The pane is grouped by your next move, not by pr-flow's stage:
//   your move     the PRs that wait on you, by what to do (decide, fix, post, answer, review, merge, get ready)
//   waiting       on whom: the author, your reviewers, CI and bots, an agent at work
//   later, dormant
// Red is kept for real problems (a review loop, CI failing, conflicts); counts are plain.

// Each stage: [group, action or whom it waits on, the verb for space, order within "your move"].
export const MOVES = {
  LOOP_ALARM: ["you", "Decide", "nudge", 0],
  MY_BLOCKED: ["you", "Fix", "fix", 1],
  NEEDS_YOU: ["you", "Post your comments", "post", 2],
  MY_FEEDBACK: ["you", "Answer feedback", "fix", 3],
  READY: ["you", "Review", "review", 4],
  MY_MERGE: ["you", "Merge", "merge", 5],
  MY_DRAFT: ["you", "Get ready", "ready", 6],
  WAITING: ["waiting", "author"],
  MY_PENDING: ["waiting", "reviewers"],
  SETTLING: ["waiting", "CI and bots"],
  REVIEWING: ["waiting", "an agent reviewing"],
  MY_BUSY: ["waiting", "an agent working"],
  SNOOZED: ["later", "later"],
  DORMANT: ["dormant", "dormant"],
  MY_DORMANT: ["dormant", "dormant"],
};

export const GROUPS = [["you", "Your move"], ["waiting", "Waiting on others"], ["later", "Later"], ["dormant", "Dormant"]];

export const moveOf = (row) => MOVES[row.stage] ?? ["waiting", "others"];

// "[Feature] Carbide Data model" → { tag: "Feature", title: "Carbide Data model" }; conventional-commit
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

// The one sentence under a PR whose move is yours: what to do, and what matters for it. { text, problem }.
export function nextStep(row) {
  const rec = row.rec ?? {}, detail = row.detail ?? "", f = openFindings(rec.open);
  const join = (...xs) => xs.filter(Boolean).join(" · ");
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

// For a PR waiting on others: who it waits on, by name, and since when. { who, since }.
export function waitingOn(row, me, now = Date.now()) {
  const rec = row.rec ?? {}, [, whom] = moveOf(row), p = people(row, me);
  const since = ago(now - Date.parse(rec.updated ?? rec.lastPush ?? ""));
  if (whom === "author") return { who: p.author, since };
  if (whom === "reviewers") {
    const pending = p.others.filter((o) => o.who !== "you" && o.mark !== "✓").map((o) => o.who);
    return { who: pending.length ? pending.join(", ") : "no reviewer yet", since };
  }
  return { who: whom, since };
}

// The pane's rows in order: [{ group, label, rows }] for the groups that have any; "your move" split by
// action (in MOVES' order), the rest one block each.
export function arrange(rows) {
  const out = [];
  const you = rows.filter((r) => moveOf(r)[0] === "you");
  const actions = [...new Set(you.map((r) => moveOf(r)[1]))].sort((a, b) =>
    (Object.values(MOVES).find((m) => m[1] === a)?.[3] ?? 9) - (Object.values(MOVES).find((m) => m[1] === b)?.[3] ?? 9));
  for (const a of actions) out.push({ group: "you", label: a, rows: you.filter((r) => moveOf(r)[1] === a) });
  for (const [g, label] of GROUPS.slice(1)) {
    const rs = rows.filter((r) => moveOf(r)[0] === g);
    if (rs.length) out.push({ group: g, label, rows: rs });
  }
  return out;
}

// The actions a PR offers now, from pr-flow's section table (README: Sections and actions), minus what can't work
// yet: { main, also, keep } — main: the next step's verb; also: real alternatives; keep: housekeeping.
// post and copy need a drafted review; approve needs your review at the current head (pr-flow checks again).
export function actionsFor(row) {
  const rec = row.rec ?? {}, unposted = /not posted|finding/.test(row.detail ?? "");
  const A = {
    LOOP_ALARM: ["nudge", ["review"], ["later", "ignore"]],
    NEEDS_YOU: ["post", ["copy", "approve"], ["discard"]],
    READY: ["review", rec.files > 40 ? ["split"] : [], ["later", "ignore"]],
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
    MY_DRAFT: ["ready", ["review"], ["later", "close"]],
    MY_DORMANT: ["close", ["review"], ["ignore"]],
  }[row.stage] ?? [null, [], ["later"]];
  return { main: A[0], also: A[1], keep: A[2] };
}
