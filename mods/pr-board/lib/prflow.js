// Copied from lib/prflow.js by lib/sync.mjs: edit it there, then run `node lib/sync.mjs`.
// pr-flow from a mod: where it is, its queue, one PR's record and findings, its actions (the `act` shorthand),
// and the two things the workbench adds: your local checkout of a PR's repository and the PR's own agent tab.
// Only pr-flow's published interface (its ENGINE.md, schema 1) is used; pr-flow keeps all the state.
import { exec, home, readTextFile, shared, setShared, spaces, terminals, run, openOverlay } from "herdr";
import { readSettings, settingPath, codeDir } from "./settings.js";

// The last queue read, for every mod (pane, PR view, git graph's labels): { at, data, records }.
export const QUEUE = "pr-board.queue";
// A PR the pane wants the PR view (git graph) to show: { key, at }.
export const OPEN_PR = "pr-board.open";
// The open PR view says it's there: { id, at }, renewed every 10 s while it's open (so one that went away
// without closing is forgotten).
export const VIEW_OPEN = "pr-board.view";
const viewOpen = () => { const v = shared(VIEW_OPEN); return Boolean(v?.id) && Date.now() - (v.at ?? 0) < 30000; };

// ---------- running pr-flow

// `node` as the person's shell finds it (Herdr may start without their PATH: nvm, Homebrew).
let nodeBin = null;
async function node() {
  if (nodeBin) return nodeBin;
  for (const c of ["node", "/opt/homebrew/bin/node", "/usr/local/bin/node"]) {
    try { if ((await exec(c, ["-v"], { timeout: 5000 })).code === 0) return (nodeBin = c); } catch { /* next */ }
  }
  try {
    const r = await exec("/bin/zsh", ["-ilc", "command -v node"], { timeout: 15000 });
    const p = r.stdout.trim().split("\n").pop();
    if (p?.startsWith("/")) return (nodeBin = p);
  } catch { /* none */ }
  return null;
}

// The newest installed pr-flow (Claude Code's plugin cache), by version.
const FIND = `const fs=require("fs"),p=require("path"),h=require("os").homedir();let best=null;
const base=p.join(h,".claude/plugins/cache");let ms=[];try{ms=fs.readdirSync(base)}catch{}
for(const m of ms){let cs=[];try{cs=fs.readdirSync(p.join(base,m,"pr-flow"))}catch{continue}
for(const c of cs){if(!/^\\d+\\.\\d+\\.\\d+$/.test(c))continue;const f=p.join(base,m,"pr-flow",c,"scripts","pr-flow.mjs");
if(!fs.existsSync(f))continue;const v=c.split(".").map(Number);
if(!best||v[0]-best.v[0]>0||(v[0]===best.v[0]&&(v[1]-best.v[1]>0||(v[1]===best.v[1]&&v[2]>best.v[2]))))best={v,f}}}
process.stdout.write(best?best.f:"")`;

let found = null, foundAt = 0;
// { node, script, state }: how to run pr-flow, or { error } saying what's missing. Settings (data/workbench.json):
// "pr_flow": a pr-flow.mjs to run instead of the installed one; "pr_flow_state": its state folder.
export async function prflowSetup() {
  if (found && Date.now() - foundAt < 60000) return found;
  const conf = await readSettings();
  const bin = await node();
  if (!bin) return { error: "No node found (pr-flow needs Node 20+)." };
  let script = settingPath(conf.pr_flow);
  if (!script) {
    const r = await exec(bin, ["-e", FIND], { timeout: 10000 }).catch(() => null);
    script = r?.stdout.trim() || null;
  }
  if (!script) return { error: "pr-flow isn't installed: install the pr-flow plugin in Claude Code, or set pr_flow in the settings." };
  found = { node: bin, script, state: settingPath(conf.pr_flow_state) };
  foundAt = Date.now();
  return found;
}

// Runs pr-flow with `args`: { code, stdout, stderr }, or code -1 with the reason.
export async function prflow(args, { timeout = 30000 } = {}) {
  const s = await prflowSetup();
  if (s.error) return { code: -1, stdout: "", stderr: s.error };
  const env = s.state ? [`PR_FLOW_STATE=${s.state}`] : [];
  try { return await exec("/usr/bin/env", [...env, s.node, s.script, ...args], { timeout }); }
  catch (e) { return { code: -1, stdout: "", stderr: String(e?.message ?? e) }; }
}

const json = (r) => { try { return r.code === 0 ? JSON.parse(r.stdout) : null; } catch { return null; } };

// pr-flow's state folder (to watch): the setting, else pr-flow's own settings.json, else its default.
export async function stateDir() {
  const s = await prflowSetup();
  if (s.state) return s.state;
  try {
    const conf = JSON.parse((await readTextFile(`${home()}/.claude/pr-flow/settings.json`)) ?? "{}");
    if (conf.state_dir) return settingPath(conf.state_dir);
  } catch { /* default */ }
  return `${home()}/.claude/pr-flow/state`;
}

// ---------- the queue

// What pr-flow offers (`version --json` capabilities), asked once per pr-flow found: Set of tokens, empty for a
// pr-flow from before 0.30.0 (no `version --json`).
let caps = null, capsFor = null;
export async function capabilities() {
  const s = await prflowSetup();
  if (s.error) return new Set();
  if (caps && capsFor === s.script) return caps;
  const d = json(await prflow(["version", "--json"], { timeout: 15000 }));
  caps = new Set(Array.isArray(d?.capabilities) ? d.capabilities : []);
  capsFor = s.script;
  return caps;
}
// Facts and --no-save (pr-flow 0.30.0): the listing carries everything the board needs, and reading it
// leaves the person's last listing alone.
const FACTS = ["nosave", "facts"];

// What's kept of each PR: the branches, head, CI, review state, reviewers and the open findings (per severity):
// `open` those made at the current head, `old` those made at an older one (`findingsSha`; pr-flow 0.41), which a
// re-review sorts out: they are not the PR's state now.
// From each listing item's `facts` (ENGINE.md, "Listing JSON"), in the board's own names.
export function recordOf(f) {
  if (!f) return null;
  const t = f.threads;
  return {
    headRef: f.head_ref ?? null, baseRef: f.base_ref ?? null, headSha: f.head_sha ?? null, ci: f.ci ?? null,
    decision: f.review_decision ?? null, draft: Boolean(f.draft), conflicts: Boolean(f.conflicts),
    threads: t ? { unresolved: t.unresolved ?? 0, awaitingReviewer: t.awaiting_reviewer ?? 0, awaitingAuthor: t.awaiting_author ?? 0 } : null,
    reviewedSha: f.reviewed_sha ?? null, open: f.open_findings ?? {}, old: f.old_findings ?? {}, findingsSha: f.findings_sha ?? null, reasons: f.reasons ?? [], author: f.pr_author ?? null,
    // Teams come as team:<slug>; the board names them by their slug, as before.
    requested: (f.requested ?? []).map((r) => String(r).replace(/^team:/, "")),
    reviewers: f.reviews ?? [], lastPush: f.last_push_at ?? null, updated: f.updated_at ?? null, rounds: f.rounds ?? 0,
    about: f.summary ?? null, files: f.files ?? null,
  };
}

// The same from the records an older pr-flow writes (<state>/prs/*.json), which it doesn't list.
const RECORDS = `const fs=require("fs"),p=require("path");const d=process.argv[1];const out={};
let conf={};try{conf=JSON.parse(fs.readFileSync(p.join(d,"config.json"),"utf8"))}catch{}
const bots=new Set([...(conf.bots||[]),"copilot-pull-request-reviewer","copilot","github-actions"]);
for(const f of fs.readdirSync(p.join(d,"prs"))){if(!f.endsWith(".json"))continue;try{const r=JSON.parse(fs.readFileSync(p.join(d,"prs",f),"utf8"));
const s=r.snapshot||{};const sev={};for(const x of r.findings||[])if(x.status==="open"||x.status==="partial")sev[x.severity]=(sev[x.severity]||0)+1;
const last={};for(const v of s.reviews||[]){if(!v.author||v.author===s.author||bots.has(v.author)||/\\[bot\\]$/.test(v.author))continue;if(v.state==="COMMENTED"&&last[v.author])continue;last[v.author]=v.state}
const e=r.explainer&&r.explainer.text?String(r.explainer.text).split(/(?<=[.!?])\\s/)[0]:null;
out[r.key]={headRef:s.headRef||null,baseRef:s.baseRef||null,headSha:s.headSha||null,ci:s.ciState||null,decision:s.reviewDecision||null,
draft:Boolean(s.isDraft),conflicts:Boolean(s.conflicts),threads:s.threads?{unresolved:s.threads.unresolved||0,awaitingReviewer:s.threads.awaitingReviewer||0,awaitingAuthor:s.threads.awaitingAuthor||0}:null,
reviewedSha:r.last_reviewed_sha||null,open:sev,reasons:r.reasons||[],author:s.author||r.author||null,requested:[...(s.requestedReviewers||[]),...(s.requestedTeams||[])],
reviewers:Object.entries(last).map(([who,state])=>({who,state})),lastPush:s.lastPushAt||null,updated:s.updatedAt||null,rounds:r.rounds||0,about:e,
files:s.size?s.size.files:null}}catch{}}process.stdout.write(JSON.stringify({me:conf.login||null,prs:out}))`;

// stderr lines worth showing (an older pr-flow's warnings): colours and stack frames left out, the last three.
const stderrWarnings = (err) => (err ?? "").split("\n").map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trim()).filter((l) => l && !/^\s*at /.test(l)).slice(-3);

// How to ask for the queue with what this pr-flow offers: { args, facts }.
export function queueArgs(caps, { sync = false, maxAge = "10m" } = {}) {
  const facts = FACTS.every((x) => caps.has(x));
  return { facts, args: [...(sync ? ["sync", "--max-age", maxAge] : ["queue"]), "--format", "json", ...(facts ? ["--no-save"] : [])] };
}

// The listing and each PR's facts from one read: { records, me, warnings }, or null when it carries no facts.
export function fromListing(data) {
  const items = (data?.sections ?? []).flatMap((s) => s.items ?? []);
  if (items.length && !items.some((it) => it.facts)) return null;
  const records = {};
  for (const it of items) { const r = recordOf(it.facts); if (r) records[it.key] = r; }
  return { records, me: data.login ?? null, warnings: Array.isArray(data.warnings) ? data.warnings.slice(-3) : [] };
}

// The queue as pr-flow lists it, plus each PR's facts: { at, data, records, me, warnings } (also kept in QUEUE),
// or { error }. `sync`: ask GitHub first (only what changed; skipped when synced within maxAge).
// With pr-flow 0.30.0 that's one quiet read (--no-save: listing.json, the person's last listing, stays as it
// was); before, the records are read from pr-flow's state folder.
export async function readQueue({ sync = false, maxAge = "10m" } = {}) {
  const { args, facts } = queueArgs(await capabilities(), { sync, maxAge });
  const r = await prflow(args, { timeout: sync ? 180000 : 30000 });
  const data = json(r);
  if (!data) return { error: (r.stderr || r.stdout || "pr-flow printed no queue").trim().split("\n").pop() };
  let got = facts ? fromListing(data) : null;
  // A plain read (no sync) keeps the last sync's warnings: they still hold until the next sync.
  if (got && !sync) got.warnings = lastQueue()?.warnings ?? [];
  if (!got) {
    const s = await prflowSetup();
    const rec = s.error ? null : await exec(s.node, ["-e", RECORDS, await stateDir()], { timeout: 15000 }).catch(() => null);
    const old = (rec && json(rec)) ?? {};
    // What pr-flow said besides the queue (a sync that failed and showed the stored queue, a PR it couldn't
    // reach, gh logged out): its stderr lines, kept for the pane's header.
    got = { records: old.prs ?? {}, me: old.me ?? null, warnings: sync ? stderrWarnings(r.stderr) : lastQueue()?.warnings ?? [] };
  }
  // pr-flow's jobs (capability `jobs`): running and queued, then the last ended ones, for the rows' progress.
  const jobs = (await capabilities()).has("jobs") ? json(await prflow(["job", "list", "--json"], { timeout: 15000 }))?.jobs : null;
  const out = { at: Date.now(), data, ...got, jobs: Array.isArray(jobs) ? jobs : [] };
  setShared(QUEUE, out);
  return out;
}

// The job to show on a PR's row: the listing item's own (`job`, on a busy item), else a running or queued one for
// the PR, else one that failed in the last hour (so its reason shows). Job objects as ENGINE.md "Jobs" has them.
export function jobFor(q, row, now = Date.now()) {
  const jobs = (q?.jobs ?? []).filter((j) => j?.key === row?.key);
  return jobs.find((j) => j.id === row.job) ?? jobs.find((j) => j.state === "running" || j.state === "queued")
    ?? jobs.find((j) => j.state === "failed" && now - Date.parse(j.ended_at ?? "") < 3600000) ?? null;
}

// A job in a few words for its row: "review 40% · reading the diff", "review queued", "review failed: why".
export function jobText(j, row = null) {
  if (!j) return "";
  const pct = typeof j.fraction === "number" ? ` ${Math.round(j.fraction * 100)}%` : "", verb = jobLabel(j, row), phase = phaseText(j.phase);
  if (j.state === "running") return `${verb}${pct}${phase ? ` · ${phase}` : ""}`;
  if (j.state === "failed") return `${verb} failed${j.error ? `: ${j.error}` : ""}`;
  return `${verb} ${j.state}`;
}

// A job's verb as the person knows it: "self-check" for a review or check of your own PR (pr-flow before 0.33.2
// ran a review there), else pr-flow's verb.
export function jobLabel(j, row = null) {
  const own = row?.role === "author" || /^MY_/.test(row?.stage ?? "");
  return own && (j?.verb === "review" || j?.verb === "check") ? "self-check" : j?.verb ?? "";
}

// A job's phase in words: the commands an agent runs read as what they're for ("running gh api …" → "reading
// GitHub", "running git …" → "reading the code"); other phases as pr-flow gives them.
export function phaseText(p) {
  if (!p) return "";
  if (/^running gh\b/.test(p)) return "reading GitHub";
  if (/^running (git|rg|grep|sed|cat|head|ls|find)\b/.test(p)) return "reading the code";
  const cmd = /^running (\S+)/.exec(p);
  return cmd ? `running ${cmd[1]}` : p;
}

// The job to show in a PR's details: the row's (jobFor), else the PR's latest one, ended too (`job list` keeps the
// last 20 ended, newest first), so its output stays a key away after it's done or stopped.
export const detailJob = (q, row, now = Date.now()) => jobFor(q, row, now) ?? (q?.jobs ?? []).find((j) => j?.key === row?.key) ?? null;

// Running or queued: what `job stop` can stop and `job show --follow` follows.
export const jobActive = (j) => j?.state === "running" || j?.state === "queued";

// A job for the PR's details, longer than its row's chip: { state, meta, error }. state: "review running · 40% ·
// reading the diff · 3m", "review failed after 12m", "review done · $0.42"; meta: the runtime, model and effort,
// and its id; error: why it failed, whole (the row's chip truncates it).
export function jobDetail(j, now = Date.now(), label = null) {
  if (!j) return null;
  const verb = label ?? j.verb; // the board's name for it ("self-check" for a review of your own PR)
  const mins = (from, to) => { const ms = Date.parse(to ?? "") - Date.parse(from ?? ""); return Number.isFinite(ms) && ms >= 0 ? (ms < 60000 ? "<1m" : `${Math.round(ms / 60000)}m`) : null; };
  const took = jobActive(j) ? mins(j.started_at, new Date(now).toISOString()) : mins(j.started_at, j.ended_at);
  const cost = typeof j.cost === "number" ? `$${j.cost.toFixed(2)}` : null;
  const state = j.state === "running" ? [`${verb} running`, typeof j.fraction === "number" ? `${Math.round(j.fraction * 100)}%` : null, phaseText(j.phase), took]
    : j.state === "queued" ? [`${verb} queued`, took]
    : j.state === "cancelled" ? [`${verb} stopped`, took && `after ${took}`]
    : [`${verb} ${j.state}${took ? ` after ${took}` : ""}`, cost];
  return {
    state: state.filter(Boolean).join(" · "),
    meta: [j.runtime, j.model, j.effort, jobActive(j) ? cost : null, j.id].filter(Boolean).join(" · "),
    error: j.state === "failed" ? j.error || "pr-flow gave no reason" : null,
  };
}

// Open findings in a few words, most severe first: "2 low", "1 high, 2 low"; with `noun`, "2 low findings";
// "" for none. `open`: { severity: count } (the listing's open_findings).
export function findingsText(open, noun = false) {
  const order = ["blocker", "critical", "high", "medium", "low", "unrated", "nit"];
  const rank = (k) => (order.includes(k) ? order.indexOf(k) : order.length);
  const got = Object.entries(open ?? {}).filter(([, n]) => n > 0).sort(([a], [b]) => rank(a) - rank(b));
  const n = got.reduce((s, [, c]) => s + c, 0);
  if (!n) return "";
  return `${got.map(([k, c]) => `${c} ${k}`).join(", ")}${noun ? ` finding${n === 1 ? "" : "s"}` : ""}`;
}

// Findings from an older head, as pr-flow's next step names them: "1 high at abc1234, head moved"; "" for none.
// `rec`: a record (recordOf), its `old` counts and `findingsSha`.
export function oldFindingsText(rec, noun = false) {
  const text = findingsText(rec?.old, noun);
  return text ? `${text} at ${rec.findingsSha ? String(rec.findingsSha).slice(0, 7) : "an older head"}, head moved` : "";
}

// ---------- a job's log (its directory, ENGINE.md "Jobs": <state>/jobs/<id>/work/transcript.jsonl, runner.log)

export const LOG_LINES = 200; // lines kept for the tail panel
export const LOG_BYTES = 262144; // the transcript's last bytes read (it grows to MBs)

// A run's length: "45s", "4m 35s", "1h 05m".
export function runTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

const firstLine = (s) => String(s ?? "").split("\n").find((l) => l.trim())?.trim() ?? "";
// An error's first line; "Exit code 1" alone says little, so with the line after it.
const errorLine = (s) => {
  const ls = String(s ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  return /^Exit code \d+$/.test(ls[0] ?? "") && ls[1] ? `${ls[0]} · ${ls[1]}` : ls[0] ?? "";
};
// A path in a few words: under home with ~; a call's output Claude Code saved aside (…/tool-results/x.txt) as that.
const homeShort = (p, h) => {
  if (typeof p !== "string") return "";
  if (/\/tool-results\/[^/]+$/.test(p)) return "an earlier call's saved output";
  return h && p.startsWith(`${h}/`) ? `~${p.slice(h.length)}` : p;
};

// One tool call in a few words: "$ git log -3", "read ~/x.js", "grep TODO", other tools by name and main argument.
export function toolLine(name, input = {}, h = null) {
  const i = input ?? {};
  switch (name) {
    case "Bash": return `$ ${firstLine(i.command)}`;
    case "Read": return `read ${homeShort(i.file_path, h)}`;
    case "Grep": return `grep ${i.pattern ?? ""}${i.path ? ` ${homeShort(i.path, h)}` : ""}`;
    case "Glob": return `glob ${i.pattern ?? ""}`;
    case "Edit": case "MultiEdit": return `edit ${homeShort(i.file_path, h)}`;
    case "Write": return `write ${homeShort(i.file_path, h)}`;
    case "WebFetch": return `fetch ${i.url ?? ""}`;
    case "WebSearch": return `search ${i.query ?? ""}`;
    case "Task": case "Agent": return `agent ${i.description ?? firstLine(i.prompt)}`;
    case "Skill": return `skill ${i.skill ?? i.name ?? ""}`;
  }
  const main = Object.values(i).find((v) => typeof v === "string" && v.trim());
  return main ? `${name} ${firstLine(main)}` : name;
}

// A Claude stream-json transcript (the text of transcript.jsonl, or its last bytes: `partial` drops the first,
// cut line) as the tail panel's lines, the last `max`: the agent's words (text), each tool call (command), a
// failed call and a denied permission (error: its first line), the result (mark: "done · 4m 35s · $2.15", or
// error). Thinking, token counts, rate limits, init and the prompt are left out; a line that isn't JSON is skipped.
export function transcriptLines(text, { partial = false, max = LOG_LINES, home: h = null } = {}) {
  const out = [], denied = new Set();
  const rows = String(text ?? "").split("\n");
  if (partial) rows.shift();
  for (const row of rows) {
    if (!row.trim()) continue;
    let o;
    try { o = JSON.parse(row); } catch { continue; }
    if (!o || typeof o !== "object") continue;
    if (o.type === "assistant" && Array.isArray(o.message?.content)) {
      for (const b of o.message.content) {
        // The answer pr-flow parses (a JSON object, fenced or bare) in a few words, not as one long line of JSON.
        if (b?.type === "text" && /^(```json|\{)/.test(String(b.text ?? "").trim())) out.push({ text: "{…} the answer, as JSON for pr-flow", kind: "text" });
        else if (b?.type === "text") for (const l of String(b.text ?? "").split("\n")) { if (l.trim()) out.push({ text: l.trimEnd(), kind: "text" }); }
        else if (b?.type === "tool_use") out.push({ text: toolLine(b.name, b.input, h), kind: "command" });
      }
    } else if (o.type === "user" && Array.isArray(o.message?.content)) {
      for (const b of o.message.content) {
        if (b?.type !== "tool_result" || !b.is_error || denied.has(b.tool_use_id)) continue; // a denial says it once
        const c = Array.isArray(b.content) ? b.content.map((x) => x?.text ?? "").join("\n") : b.content;
        out.push({ text: `✗ ${errorLine(c) || "the call failed"}`, kind: "error" });
      }
    } else if (o.type === "system" && o.subtype === "permission_denied") {
      if (o.tool_use_id) denied.add(o.tool_use_id);
      out.push({ text: `✗ ${firstLine(o.message) || `${o.tool_name ?? "a tool"} denied`}`, kind: "error" });
    } else if (o.type === "result") {
      const ok = o.subtype === "success" && !o.is_error;
      const cost = typeof o.total_cost_usd === "number" ? `$${o.total_cost_usd.toFixed(2)}` : null;
      const head = ok ? "done" : `ended: ${String(o.subtype ?? "error").replace(/_/g, " ")}`;
      out.push({ text: [head, runTime(o.duration_ms), cost].filter(Boolean).join(" · "), kind: ok ? "mark" : "error" });
    }
  }
  return out.slice(-max);
}

// A job's lines for the tail panel, from its directory: the transcript's last LOG_BYTES (Claude's), else
// runner.log's last lines, else its state and phase; a failed job's error last. { lines, source }.
export async function jobLog(j) {
  const dir = `${await stateDir()}/jobs/${j.id}`;
  let lines = [], source = "phase";
  // One call: the file's size, then its last bytes (a missing file: exit 3).
  const t = await exec("/bin/sh", ["-c", `[ -f "$1" ] || exit 3; wc -c < "$1"; tail -c ${LOG_BYTES} "$1"`, "sh", `${dir}/work/transcript.jsonl`], { timeout: 10000 }).catch(() => null);
  if (t?.code === 0) {
    const nl = t.stdout.indexOf("\n"), size = Number(t.stdout.slice(0, nl).trim());
    lines = transcriptLines(t.stdout.slice(nl + 1), { partial: size > LOG_BYTES, home: home() });
    source = "transcript";
  }
  if (!lines.length) {
    const r = await exec("/usr/bin/tail", ["-n", String(LOG_LINES), `${dir}/runner.log`], { timeout: 10000 }).catch(() => null);
    // eslint-disable-next-line no-control-regex
    const got = r?.code === 0 ? r.stdout.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").split("\n").filter((l) => l.trim()) : [];
    if (got.length) { lines = got.map((l) => ({ text: l, kind: "text" })); source = "runner.log"; }
  }
  if (!lines.length) lines = [{ text: [j.state, phaseText(j.phase)].filter(Boolean).join(" · ") || "nothing written yet", kind: "mark" }];
  if (j.state === "failed" && j.error && lines[lines.length - 1]?.kind !== "error") lines.push({ text: `✗ ${firstLine(j.error)}`, kind: "error" });
  return { lines: lines.slice(-LOG_LINES), source };
}

// One job now (`job show <id> --json`): the job object, or null (no `jobs` capability, or no such job).
export async function jobShow(id) {
  if (!id || !(await capabilities()).has("jobs")) return null;
  return json(await prflow(["job", "show", id, "--json"], { timeout: 15000 }))?.job ?? null;
}

// Stops a running or queued job (`job stop <id> --json`: the runner gets SIGTERM, the job ends `cancelled` and
// its claim is released). { ok, message, job }.
export async function jobStop(id) {
  if (!(await capabilities()).has("jobs")) return { ok: false, message: "This pr-flow has no jobs." };
  const r = await prflow(["job", "stop", id, "--json"], { timeout: 30000 });
  const j = json(r)?.job;
  if (!j) return { ok: false, message: (r.stderr || r.stdout || `pr-flow exited with ${r.code}`).trim().split("\n").pop() };
  return { ok: true, job: j, message: j.state === "cancelled" ? `${j.verb} ${tabName(j.key)}: stopped` : `${j.verb} ${tabName(j.key)}: ${j.state} already` };
}

// A word for a shell line, quoted when it needs to be.
export const shq = (s) => (/^[\w@%+=:,./-]+$/.test(String(s)) ? String(s) : `'${String(s).replace(/'/g, "'\\''")}'`);

// The words that show a job in a terminal: `job show <id> --follow` while it runs or waits (each new phase as it
// comes, then the job's line when it ends), `job show <id>` once it ended.
export const jobShowArgs = (j) => ["job", "show", j.id, ...(jobActive(j) ? ["--follow"] : [])];

// pr-flow's own output for a job, in a terminal under the focused pane (as the fleet board's commands run), in
// the PR's checkout when there is one. The terminal stays open with a shell when the command ends.
export async function jobTerminal(j) {
  const s = await prflowSetup();
  if (s.error) return s.error;
  if (!(await capabilities()).has("jobs")) return "This pr-flow has no jobs.";
  const k = parseKey(j.key), folder = (k && (await checkoutOf(k.slug))) || home();
  const line = ["/usr/bin/env", ...(s.state ? [`PR_FLOW_STATE=${s.state}`] : []), s.node, s.script, ...jobShowArgs(j)].map(shq).join(" ");
  const ended = shq(`[pr-flow job show ${j.id} ended]`);
  run("terminal.open", { argv: ["/bin/zsh", "-ic", `${line}; echo; echo ${ended}; exec zsh -i`], folder, place: "down", name: `${j.verb} ${tabName(j.key)}` });
  return null;
}

// The last queue any mod read (null before the first read).
export const lastQueue = () => shared(QUEUE) ?? null;

// Every PR in the queue, in pr-flow's order: [{ ...item, section, letter, sectionTitle, expanded, rec }].
export function queueRows(q) {
  if (!q?.data?.sections) return [];
  return q.data.sections.flatMap((s) => s.items.map((it) => ({ ...it, letter: s.letter, sectionTitle: s.title, expanded: s.expanded, suggested: s.verbs, rec: q.records?.[it.key] ?? null, tab: prTab(it.key)?.status ?? null })));
}

// The PR whose branch this is in a repository (owner/repo), from the last queue: its row, or null.
export function prForBranch(q, repoSlug, branch) {
  if (!repoSlug || !branch) return null;
  return queueRows(q).find((r) => r.key.startsWith(`${repoSlug}#`) && r.rec?.headRef === branch) ?? null;
}

// pr-flow's stage as two words for a label, and whether it needs you.
export const STAGE = {
  LOOP_ALARM: ["alarm", true], NEEDS_YOU: ["draft", true], READY: ["review", true], REVIEWED: ["finish", true], SETTLING: ["settling", false],
  REVIEWING: ["reviewing", false], WAITING: ["waiting", false], SNOOZED: ["later", false], DORMANT: ["dormant", false],
  MY_FEEDBACK: ["feedback", true], MY_BLOCKED: ["blocked", true], MY_MERGE: ["merge", true], MY_BUSY: ["busy", false],
  MY_PENDING: ["in review", false], MY_ASK: ["ask", true], MY_DRAFT: ["draft", true], MY_DORMANT: ["dormant", false],
};

// ---------- one PR

// The stored record (`show`): branches, head, CI, reviews, history.
export async function showPr(key) {
  return json(await prflow(["show", key]));
}

// The findings, most severe first (`findings --json`): [{ id, severity, title, path, line, status, … }].
export async function findingsOf(key) {
  const d = json(await prflow(["findings", key, "--all", "--json"]));
  return d?.findings ?? [];
}

// ---------- one PR in one read (pr-flow 0.32, capability `view`; ENGINE.md "View")

// `view <pr> --json`: the PR's stage, move, next step and actions, its facts, findings, draft and jobs, from
// pr-flow's stored record (no GitHub call, nothing written). null without the capability or when pr-flow doesn't
// know the PR.
export async function prView(key) {
  if (!(await capabilities()).has("view")) return null;
  return json(await prflow(["view", key, "--json"], { timeout: 20000 }));
}

const BUSY = new Set(["REVIEWING", "MY_BUSY"]);
// A view as a queue row (queueRows' shape), so the PR view's bar reads it with pr-board's own helpers (moveOf,
// nextStep, actionsFor, verbPlan, jobFor, jobText, jobLabel): the same next step, labels and actions as the PR's
// card. `base`: the PR's queue row, if it's in the queue (its detail, size, section and agent tab stay); `tab`:
// the agent tab's status when it isn't. `job` as the listing has it: a running job's id on a REVIEWING or
// MY_BUSY PR. null for no view (an older pr-flow, or a PR pr-flow doesn't know).
export function viewRow(view, base = null, tab = null) {
  if (!view?.key || !view.move || !view.next_step || !Array.isArray(view.actions)) return null;
  const k = parseKey(view.key), f = view.facts ?? null;
  const running = (view.jobs ?? []).find((j) => j?.state === "running" || j?.state === "queued");
  return {
    ...(base ?? {}),
    key: view.key, short: base?.short ?? k?.short ?? view.key, url: view.url ?? base?.url ?? null, title: view.title ?? base?.title ?? "",
    role: view.role ?? base?.role ?? null, stage: view.stage ?? base?.stage ?? null,
    // The listing leaves the author out on your own PRs.
    author: base ? base.author : view.role === "author" ? "" : f?.pr_author ?? "",
    move: view.move, next_step: view.next_step, actions: view.actions,
    rec: recordOf(f) ?? base?.rec ?? null,
    job: BUSY.has(view.stage) && running ? running.id : null,
    tab: base ? base.tab ?? null : tab,
  };
}

// The PR view's opening read, from `view` and `show` (pure, for tests): { rec, reviewed, findings }. rec: the
// branches and head (the facts, else show's snapshot); reviewed: your last review's head (on your own PR, the last
// self-check's); findings: show's, which carry each one's fix and end line (view's are id, place, severity,
// status and title only), else view's.
export function openFromView(view, record) {
  const f = view?.facts, s = record?.snapshot;
  const rec = f?.head_sha || f?.head_ref ? { headRef: f.head_ref ?? null, baseRef: f.base_ref ?? null, headSha: f.head_sha ?? null }
    : s ? { headRef: s.headRef, baseRef: s.baseRef, headSha: s.headSha } : null;
  const reviewed = f ? f.reviewed_sha ?? null : record?.role === "author" ? record?.last_checked_sha ?? null : record?.last_reviewed_sha ?? null;
  // In `findings --json`'s order within a severity: by id (F2 before F10).
  const findings = (Array.isArray(record?.findings) ? record.findings : view?.findings ?? []).slice()
    .sort((a, b) => String(a?.id ?? "").localeCompare(String(b?.id ?? ""), undefined, { numeric: true }));
  return { rec, reviewed, findings };
}

// ---------- comment drafts (pr-flow 0.33.0, capability `draft`; ENGINE.md "Drafts")

// One PR from pr-flow's stored record (`view <pr> --json`): its draft, draft_versions, notes, actions, jobs. null
// without the capability (nothing changes then) or when pr-flow doesn't know the PR.
export async function draftView(key) {
  if (!(await capabilities()).has("draft")) return null;
  return json(await prflow(["view", key, "--json"], { timeout: 20000 }));
}

// The stored comment draft `view` names as current: { v, tone, sha, at, body, comments: [{ finding, path, line,
// side, start_line, start_side, body }] }, or null (no draft, findings not yet drafted (no version), or a note).
export function draftOf(view) {
  const d = view?.draft;
  if (!d || d.version === null || d.version === undefined || (d.kind && d.kind !== "review")) return null;
  const meta = (view.draft_versions ?? []).find((x) => x.v === d.version);
  return { v: d.version, tone: meta?.tone ?? null, sha: d.sha ?? null, at: d.at ?? meta?.at ?? null, body: d.body ?? "",
    comments: (d.comments ?? []).filter((c) => c?.path).map((c) => ({ finding: c.finding ?? null, path: c.path, line: c.line ?? null, side: c.side ?? "RIGHT", start_line: c.start_line ?? null, start_side: c.start_side ?? null, body: c.body ?? "" })) };
}

// The comment drafts' versions, oldest first: [{ v, tone, at }] (notes left out).
export const draftVersions = (view) => (view?.draft_versions ?? []).filter((x) => x && (x.kind ?? "review") === "review").map((x) => ({ v: x.v, tone: x.tone ?? null, at: x.at ?? null })).sort((a, b) => a.v - b.v);

// A version in a few words: "v2 shorter", "v1".
export const versionLabel = (x) => `v${x.v}${x.tone ? ` ${x.tone}` : ""}`;

// A draft as copy-paste text: the summary, then each comment under its place.
export function draftText(d) {
  const place = (c) => `${c.path}${c.line ? `:${c.start_line && c.start_line !== c.line ? `${c.start_line}-` : ""}${c.line}` : ""}${c.side === "LEFT" ? " (old side)" : ""}`;
  return [String(d?.body ?? "").trim(), ...(d?.comments ?? []).map((c) => `${place(c)}\n${String(c.body ?? "").trim()}`)].filter(Boolean).join("\n\n");
}

// A draft's comments as notes on lines (as findings are placed): { path, line, end, side, body, finding }, a range
// (start_line … line) from its first line.
export const draftNotes = (d) => (d?.comments ?? []).map((c) => ({
  path: c.path, line: c.start_line && c.start_line < c.line ? c.start_line : c.line, end: c.start_line && c.start_line < c.line ? c.line : null,
  side: c.side === "LEFT" ? "LEFT" : "RIGHT", body: String(c.body ?? "").replace(/\s+/g, " ").trim(), finding: c.finding ?? null,
}));

// A draft or reword job that stored a comment draft on the PR (the queue's `job list`): { v, verb, at }, while the PR
// is at "post your comments" (NEEDS_YOU); null otherwise. The listing doesn't say a stored version exists: this is
// what the board can tell without a `view` per row.
export function draftReady(q, row) {
  if (row?.stage !== "NEEDS_YOU") return null;
  const j = (q?.jobs ?? []).filter((x) => x?.key === row.key && x.state === "done" && x.artifact?.kind === "draft")
    .sort((a, b) => String(b.ended_at ?? "").localeCompare(String(a.ended_at ?? "")))[0];
  const v = Number(String(j?.artifact?.ref ?? "").split("@").pop());
  return j && v > 0 ? { v, verb: j.verb, at: j.ended_at ?? null } : null;
}

// The stored draft version, if the PR has one (the board's post and copy show it in the PR view first).
export async function storedDraft(key) { return draftOf(await draftView(key)); }

// post | approve | copy a stored version unchanged: { ok, message, data? } (copy: the version's text as JSON).
export async function draftCommand(verb, key, v) {
  const args = verb === "copy" ? ["copy", key, "--draft", String(v), "--json"] : [verb, key, "--draft", String(v)];
  const r = await prflow(args, { timeout: 120000 });
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.split("\n").map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trim()).filter(Boolean);
  const said = out.filter((l) => !/^[{}\[\]"]/.test(l));
  // pr-flow's own line (✔, ✘ or "pr-flow: why") over a tool's stderr after it.
  const last = said.filter((l) => /^(✔|✘|pr-flow:)/.test(l)).pop() ?? said.pop() ?? (r.code === 0 ? "done" : `pr-flow exited with ${r.code}`);
  return { ok: r.code === 0, message: last.replace(/^pr-flow:\s*/, ""), data: verb === "copy" ? json(r) : null };
}

// A reword job (shorter | softer | more) on the current version: { ok, job, message }.
export async function rewordDraft(key, tone) {
  const r = await prflow(["job", "start", "reword", key, "--tone", tone, "--json"], { timeout: 30000 });
  const j = json(r)?.job;
  return j?.id ? { ok: true, job: j, message: `${tone}: rewording in the background` } : { ok: false, job: null, message: (r.stderr || r.stdout || "pr-flow refused").trim().split("\n").pop().replace(/^pr-flow:\s*/, "") };
}


// Runs shorthand (`later 63 fri`): [{ verb, key, status, message, task? }], or [{ status: "error", message }].
export async function act(shorthand) {
  const r = await prflow(["act", shorthand, "--json"], { timeout: 120000 });
  const d = json(r) ?? (() => { try { return JSON.parse(r.stdout); } catch { return null; } })();
  return Array.isArray(d) ? d : [{ status: "error", message: (r.stderr || r.stdout || `pr-flow exited with ${r.code}`).trim() }];
}

// "acme/acme-api#506" → { owner, repo, n, slug: "owner/repo", short: "acme-api#506" }.
export function parseKey(key) {
  const m = /^([^/]+)\/([^#]+)#(\d+)$/.exec(key ?? "");
  return m ? { owner: m[1], repo: m[2], n: Number(m[3]), slug: `${m[1]}/${m[2]}`, short: `${m[2]}#${m[3]}` } : null;
}

// ---------- your checkout of a PR's repository

const checkouts = new Map(); // owner/repo -> folder or null
// Your local clone of owner/repo: a folder named after the repo under the code folder (or anywhere the
// new-space list found one) whose origin is that repository. null when there's none.
export async function checkoutOf(slug) {
  if (checkouts.has(slug)) return checkouts.get(slug);
  const repo = slug.split("/")[1], dir = await codeDir();
  const listed = (shared("new-space.repos") ?? []).filter((p) => typeof p === "string" && p.split("/").pop() === repo);
  const candidates = [...new Set([`${dir}/${repo}`, ...listed])];
  for (const c of candidates) {
    const r = await exec("git", ["-C", c, "remote", "get-url", "origin"], { timeout: 5000 }).catch(() => null);
    const url = r?.code === 0 ? r.stdout.trim().replace(/\.git$/, "") : "";
    if (url.endsWith(`/${slug}`) || url.endsWith(`:${slug}`)) { checkouts.set(slug, c); return c; }
  }
  checkouts.set(slug, null);
  return null;
}

// The PR's range in that checkout, fetching its branch when the head commit isn't there:
// { root, base, head, title } for the git graph's review, or { error }.
export async function prRange(key, rec) {
  const k = parseKey(key);
  if (!k) return { error: `Not a PR: ${key}` };
  const root = await checkoutOf(k.slug);
  if (!root) return { error: `No local clone of ${k.slug} found (looked in the code folder).` };
  const git = (args, timeout = 10000) => exec("git", ["-C", root, ...args], { timeout }).catch((e) => ({ code: -1, stdout: "", stderr: String(e) }));
  const has = async (rev) => rev && (await git(["cat-file", "-e", `${rev}^{commit}`])).code === 0;
  if (!(await has(rec?.headSha))) {
    // The PR's branch as a normal remote-tracking branch (origin/<branch>), and its head by number as a fallback.
    const refs = [rec?.headRef && `+refs/heads/${rec.headRef}:refs/remotes/origin/${rec.headRef}`, rec?.baseRef && `+refs/heads/${rec.baseRef}:refs/remotes/origin/${rec.baseRef}`].filter(Boolean);
    if (refs.length) await git(["fetch", "--no-tags", "origin", ...refs], 60000);
    if (!(await has(rec?.headSha))) await git(["fetch", "--no-tags", "origin", `pull/${k.n}/head`], 60000);
  }
  const head = (await has(rec?.headSha)) ? rec.headSha : rec?.headRef && (await has(`origin/${rec.headRef}`)) ? `origin/${rec.headRef}` : null;
  if (!head) return { error: `Couldn't get the PR's head (${(rec?.headSha ?? "?").slice(0, 8)}) into ${root}.` };
  const base = rec?.baseRef && (await has(`origin/${rec.baseRef}`)) ? `refs/remotes/origin/${rec.baseRef}` : null;
  return { root, head, base, baseName: rec?.baseRef ? `origin/${rec.baseRef}` : undefined, title: k.short };
}

// ---------- the PR's own agent tab

// The tab's name: the PR's short key ("acme-api#506").
export const tabName = (key) => parseKey(key)?.short ?? key;

// Where the PR's tab is: { space, tab, terminal (address), status } or null.
export function prTab(key) {
  const name = tabName(key);
  for (const sp of spaces() ?? []) {
    for (const tab of sp.tabs ?? []) {
      if (tab.name !== name) continue;
      const term = terminals().find((t) => t.labels?.["herdr.tab"] === tab.id && t.agent) ?? terminals().find((t) => t.labels?.["herdr.tab"] === tab.id);
      return { space: sp.id, tab: tab.id, terminal: term?.address ?? null, status: tab.status ?? null };
    }
  }
  return null;
}

// The space PR tabs go to: the `pr_space` setting's name (default "PR Reviews"); null when there's no such
// space (the tab then opens in the space shown).
export async function prSpace() {
  const name = (await readSettings()).pr_space ?? "PR Reviews";
  return spaces().find((s) => s.name === name)?.id ?? null;
}

// The pr-flow command an agent runs for `verb` on the PR: the inbox command takes every verb.
export const agentCommand = (verb, key) => `/pr-flow:inbox ${verb} ${parseKey(key)?.short ?? key}`;

// Sends `text` to the PR's agent tab, opening one (named after the PR, in its checkout) if it has none.
// `fresh`: what a new tab starts from instead (pr-flow's self-contained prompt, as `claude "<prompt>"`); a tab
// that's there already has its context and gets `text`. Returns what happened: "sent", "opened", or an error.
export async function toPrTab(key, text, { fresh = null } = {}) {
  const at = prTab(key);
  if (at?.terminal) {
    run("space.select", { id: at.space }); run("tab.select", { id: at.tab });
    const r = await exec("hc", ["send", at.terminal, text], { timeout: 20000 }).catch((e) => ({ code: -1, stderr: String(e) }));
    return r.code === 0 ? "sent" : (r.stderr || "hc send failed").trim();
  }
  const k = parseKey(key), space = await prSpace();
  const folder = k ? await checkoutOf(k.slug) : null;
  const start = typeof fresh === "function" ? await fresh() : fresh;
  run("tab.new", newTab(key, { space, folder, text, start }));
  return "opened";
}

// tab.new for the PR's tab: Claude started from the prompt (one argument, newlines and all), else started
// plain with the shorthand as its first message.
export const newTab = (key, { space, folder, text, start }) => ({
  name: tabName(key), ...(space ? { space } : {}), ...(folder ? { folder } : {}),
  ...(start ? { argv: ["claude", start] } : { argv: ["claude"], task: text }), focus: true,
});

// pr-flow's opening message for a fresh session doing `verb` on the PR (`prompt <pr> <verb> --json`, pr-flow
// 0.31.0): the prompt text, or null (an older pr-flow, or a verb that isn't a session's: the tab then starts
// from the typed shorthand, as before).
export async function promptFor(key, verb) {
  if (!(await capabilities()).has("prompt")) return null;
  const d = json(await prflow(["prompt", key, verb, "--json"], { timeout: 30000 }));
  return typeof d?.prompt === "string" && d.prompt.trim() ? d.prompt : null;
}

// The opening message for a tab that only talks about the PR: what it is, where to read it, and no action until
// asked. `row`: the queue's row (title, url, role) and its record (branches); `folder`: a checkout, or null.
export function talkPrompt(key, row, folder) {
  const k = parseKey(key), rec = row?.rec ?? {}, n = k?.n ?? "";
  const repo = folder ? `This folder is a checkout of ${k?.slug}; read the code here as needed.` : `There's no local checkout of ${k?.slug}; use gh (\`--repo ${k?.slug}\`).`;
  return [
    `Let's talk about pull request ${k?.short ?? key}${row?.title ? `: "${row.title}"` : ""} (${row?.url ?? `https://github.com/${k?.slug}/pull/${n}`}).`,
    row?.role === "author" ? "It's my PR." : "I'm a reviewer on it.",
    rec.headRef ? `Its branch is ${rec.headRef}${rec.baseRef ? `, into ${rec.baseRef}` : ""}.` : "",
    repo,
    `Get familiar with it (gh pr view ${n} --comments, gh pr diff ${n}), then tell me in a sentence or two what it does and wait for my questions.`,
    "This is a conversation only: don't post, comment, review, approve, push, commit or change anything, on GitHub or here, unless I ask for it.",
  ].filter(Boolean).join("\n");
}

// The PR's agent tab to talk about it: shown when there is one, else a new one (named after the PR, in its
// checkout, in the PR space) started from talkPrompt. Later actions on the PR go to the same tab.
export async function talkTab(key, row) {
  if (showPrTab(key)) return "shown";
  const k = parseKey(key), space = await prSpace();
  const folder = k ? await checkoutOf(k.slug) : null;
  run("tab.new", newTab(key, { space, folder, start: talkPrompt(key, row, folder) }));
  return "opened";
}

// Brings the PR's tab forward; false when it has none.
export function showPrTab(key) {
  const at = prTab(key);
  if (!at) return false;
  run("space.select", { id: at.space }); run("tab.select", { id: at.tab });
  return true;
}

// ---------- acting on a PR

// "https://github.com/o/r/pull/12" → "o/r#12" (null when it isn't a PR's URL).
export function keyFromUrl(url) {
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url ?? "");
  return m ? `${m[1]}/${m[2]}#${m[3]}` : null;
}

// The PR view: the git graph as a dialog on the PR's range, with the queue beside it.
export function openPrView(key) {
  // One PR view: an open one switches to the PR, another dialog would stack on it.
  if (viewOpen()) { setShared(OPEN_PR, { key, at: Date.now() }); return; }
  openOverlay({ mod: "git-graph", kind: "dialog", width: 0.94, height: 0.9, props: { pr: key } });
}

// Verbs that change something on GitHub without an agent's preview: asked first (an older pr-flow; with its view
// model, the action's `confirm` says what to ask).
export const ASK_FIRST = new Set(["approve", "handback"]);

// How a verb runs on a row: { kind, confirm, disabled, label }. With pr-flow's view model (row.actions) from its
// action: kind script (act), job (a background job; the PR's agent tab while pr-flow has no job definition) or
// session (the PR's agent tab, as "agent"); confirm: the question to ask first (an outward script or job verb;
// a session's own conversation asks there); disabled: why it can't run now. Else from the listing's verbs and
// ASK_FIRST, as before.
export function verbPlan(row, verb, verbs) {
  const a = Array.isArray(row?.actions) ? row.actions.find((x) => x.verb === verb) : null;
  if (a) return { kind: a.kind === "session" ? "agent" : a.kind, confirm: a.kind === "session" ? null : a.confirm ?? null, disabled: a.disabled_reason ?? null, label: a.label ?? verb };
  const short = row?.short ?? tabName(row?.key ?? "");
  const confirm = !ASK_FIRST.has(verb) ? null : verb === "approve" ? `Approve ${short}? pr-flow checks it's ready first, then approves under your account.` : `Hand ${short} back to its author?`;
  return { kind: verbs?.[verb]?.kind ?? null, confirm, disabled: null, label: verb };
}

// The verbs a row offers: its section's suggestions first, then the usual ones for whose PR it is.
export function verbsFor(row, verbs) {
  const extra = row.role === "author" ? ["fix", "ready", "merge", "ping", "review", "later", "close"]
    : ["review", "post", "copy", "approve", "ping", "later", "ignore"];
  return [...new Set([...(row.suggested ?? []), ...extra])].filter((v) => !verbs || verbs[v]);
}

// The shorthand for a verb on a PR. A click on later hides it until the next working day's morning (pr-flow:
// that day's first sweep), not just until the next sweep: tomorrow, or Monday from Friday and Saturday.
export const shorthandFor = (verb, short, now = new Date()) =>
  verb !== "later" ? `${verb} ${short}` : `later ${short} ${now.getDay() === 5 || now.getDay() === 6 ? "mon" : "tomorrow"}`;

// Does `verb` on the PR: an agent's verb in the PR's agent tab, `open` in the browser, the rest through
// pr-flow's `act` (a result that still needs an agent goes to the tab too). { ok, message }.
export async function doVerb(verb, key, { url, kind } = {}) {
  const short = parseKey(key)?.short ?? key;
  if (verb === "open") {
    await exec("open", [url ?? `https://github.com/${parseKey(key)?.slug}/pull/${parseKey(key)?.n}`]).catch(() => null);
    return { ok: true, message: `${short} on GitHub` };
  }
  const toTab = async () => {
    const how = await toPrTab(key, agentCommand(verb, key), { fresh: () => promptFor(key, verb) });
    return { ok: how === "sent" || how === "opened", message: how === "opened" ? `${verb}: a new agent tab ${tabName(key)}` : how === "sent" ? `${verb}: sent to ${tabName(key)}` : how };
  };
  if (kind === "agent") return toTab();
  // A job verb (pr-flow's view): in the background when pr-flow has a job definition for it (`job start` refuses
  // one it hasn't, changing nothing), else in the PR's agent tab as before.
  if (kind === "job") {
    if ((await capabilities()).has("jobs")) {
      const j = json(await prflow(["job", "start", verb, key, "--json"], { timeout: 30000 }))?.job;
      if (j?.id) return { ok: true, message: `${verb} ${short}: running in the background`, job: j };
    }
    return toTab();
  }
  const r = (await act(shorthandFor(verb, short)))[0] ?? { status: "error", message: "pr-flow said nothing" };
  if (r.status === "needs-agent") return toTab();
  // job-started: pr-flow ran the verb as a job (its id in r.job); the rows show it from `job list`.
  return { ok: r.status === "done" || r.status === "job-started", message: String(r.message ?? r.status).split("\n")[0], status: r.status };
}
