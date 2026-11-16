// pr-flow from a mod: where it is, its queue, one PR's record and findings, its actions (the `act` shorthand),
// and the two things the workbench adds: your local checkout of a PR's repository and the PR's own Claude tab.
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

// What's kept of each PR from its stored record: the branches, head, CI and the open findings (per severity).
// Read from the records pr-flow writes (<state>/prs/*.json); `show` gives the same, one PR per call.
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

// The queue as pr-flow lists it, plus each PR's record facts: { at, data, records } (also kept in QUEUE),
// or { error }. `sync`: ask GitHub first (only what changed; skipped when synced within maxAge).
export async function readQueue({ sync = false, maxAge = "10m" } = {}) {
  const r = await prflow(sync ? ["sync", "--max-age", maxAge, "--format", "json"] : ["queue", "--format", "json"], { timeout: sync ? 180000 : 30000 });
  const data = json(r);
  if (!data) return { error: (r.stderr || r.stdout || "pr-flow printed no queue").trim().split("\n").pop() };
  const s = await prflowSetup();
  const rec = s.error ? null : await exec(s.node, ["-e", RECORDS, await stateDir()], { timeout: 15000 }).catch(() => null);
  const got = (rec && json(rec)) ?? {}, records = got.prs ?? {};
  // What pr-flow said besides the queue (a sync that failed and showed the stored queue, a PR it couldn't
  // reach, gh logged out): its stderr lines, kept for the pane's header.
  const warnings = (r.stderr ?? "").split("\n").map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trim()).filter((l) => l && !/^\s*at /.test(l)).slice(-3);
  const out = { at: Date.now(), data, records, me: got.me ?? null, warnings: sync ? warnings : lastQueue()?.warnings ?? [] };
  setShared(QUEUE, out);
  return out;
}

// The last queue any mod read (null before the first read).
export const lastQueue = () => shared(QUEUE) ?? null;

// Every PR in the queue, in pr-flow's order: [{ ...item, section, letter, sectionTitle, expanded, rec }].
export function queueRows(q) {
  if (!q?.data?.sections) return [];
  return q.data.sections.flatMap((s) => s.items.map((it) => ({ ...it, letter: s.letter, sectionTitle: s.title, expanded: s.expanded, suggested: s.verbs, rec: q.records?.[it.key] ?? null })));
}

// The PR whose branch this is in a repository (owner/repo), from the last queue: its row, or null.
export function prForBranch(q, repoSlug, branch) {
  if (!repoSlug || !branch) return null;
  return queueRows(q).find((r) => r.key.startsWith(`${repoSlug}#`) && r.rec?.headRef === branch) ?? null;
}

// pr-flow's stage as two words for a label, and whether it needs you.
export const STAGE = {
  LOOP_ALARM: ["alarm", true], NEEDS_YOU: ["draft", true], READY: ["review", true], SETTLING: ["settling", false],
  REVIEWING: ["reviewing", false], WAITING: ["waiting", false], SNOOZED: ["later", false], DORMANT: ["dormant", false],
  MY_FEEDBACK: ["feedback", true], MY_BLOCKED: ["blocked", true], MY_MERGE: ["merge", true], MY_BUSY: ["busy", false],
  MY_PENDING: ["in review", false], MY_DRAFT: ["draft", true], MY_DORMANT: ["dormant", false],
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

// ---------- the PR's own Claude tab

// The tab's name: the PR's short key ("acme-api#506").
export const tabName = (key) => parseKey(key)?.short ?? key;

// Where the PR's tab is: { space, tab, terminal (address), status } or null.
export function prTab(key) {
  const name = tabName(key);
  for (const sp of spaces()) {
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

// Sends `text` to the PR's Claude tab, opening one (named after the PR, in its checkout) if it has none.
// Returns what happened: "sent", "opened", or an error message.
export async function toPrTab(key, text) {
  const at = prTab(key);
  if (at?.terminal) {
    run("space.select", { id: at.space }); run("tab.select", { id: at.tab });
    const r = await exec("hc", ["send", at.terminal, text], { timeout: 20000 }).catch((e) => ({ code: -1, stderr: String(e) }));
    return r.code === 0 ? "sent" : (r.stderr || "hc send failed").trim();
  }
  const k = parseKey(key), space = await prSpace();
  const folder = k ? await checkoutOf(k.slug) : null;
  run("tab.new", { name: tabName(key), ...(space ? { space } : {}), ...(folder ? { folder } : {}), argv: ["claude"], task: text, focus: true });
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

// Verbs that change something on GitHub without an agent's preview: asked first.
export const ASK_FIRST = new Set(["approve", "handback"]);

// The verbs a row offers: its section's suggestions first, then the usual ones for whose PR it is.
export function verbsFor(row, verbs) {
  const extra = row.role === "author" ? ["fix", "ready", "merge", "ping", "review", "later", "close"]
    : ["review", "post", "copy", "approve", "ping", "later", "ignore"];
  return [...new Set([...(row.suggested ?? []), ...extra])].filter((v) => !verbs || verbs[v]);
}

// Does `verb` on the PR: an agent's verb in the PR's Claude tab, `open` in the browser, the rest through
// pr-flow's `act` (a result that still needs an agent goes to the tab too). { ok, message }.
export async function doVerb(verb, key, { url, kind } = {}) {
  const short = parseKey(key)?.short ?? key;
  if (verb === "open") {
    await exec("open", [url ?? `https://github.com/${parseKey(key)?.slug}/pull/${parseKey(key)?.n}`]).catch(() => null);
    return { ok: true, message: `${short} on GitHub` };
  }
  const toTab = async () => {
    const how = await toPrTab(key, agentCommand(verb, key));
    return { ok: how === "sent" || how === "opened", message: how === "opened" ? `${verb}: a new Claude tab ${tabName(key)}` : how === "sent" ? `${verb}: sent to ${tabName(key)}` : how };
  };
  if (kind === "agent") return toTab();
  const r = (await act(`${verb} ${short}`))[0] ?? { status: "error", message: "pr-flow said nothing" };
  if (r.status === "needs-agent") return toTab();
  return { ok: r.status === "done", message: String(r.message ?? r.status).split("\n")[0], status: r.status };
}
