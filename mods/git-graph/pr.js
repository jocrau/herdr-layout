// The PR view: the graph as a dialog on a pull request pr-flow tracks (props.pr = "owner/repo#n", opened from
// pr-board, ⌘⌥R or a PR badge). A bar with the PR (its name opens the queue, p) and what you can do (the queue as
// a list on the left, ⇧L, for triage), and the
// review of the PR's range (base…head in your checkout) with pr-flow's findings: listed above the files,
// marked in the file list, and shown under their line in the diff. Mixed into Graph.
// Also, in every graph: a branch with a tracked PR carries its pr-flow stage, and `p` turns the dialog into its PR
// view (esc steps back out); reviewing such a branch's head since base shows the PR's notes there too (a "lite" PR:
// this.pr with lite set, without the PR view's bar, scope and frame).
import { div } from "gpui-kit";
import { v_flex, h_flex, Popup, Scrollbar, v_virtual_list, VirtualListScrollHandle, Input, InputState } from "gpui-base";
import { exec, notify, props, shared, setShared, openOverlay } from "herdr";
import { OPEN_PR, VIEW_OPEN, lastQueue, readQueue, queueRows, showPr, findingsOf, prRange, doVerb, verbPlan, jobFor, jobText, showPrTab, prTab, tabName, openPrView, parseKey, act,
  draftView, draftOf, draftVersions, versionLabel, draftText, draftNotes, draftCommand, rewordDraft, jobShow, capabilities, prView, viewRow, openFromView, viewIsFull, notesOf, detailJob,
  fixPlanOf, PLAN_VERDICTS, planWords, planOpen, typeIntoTab } from "./lib/prflow.js";
import { prRow, sevColor, SEVERITIES, findingsBadge, ciGlyph, alpha, numWidth, repoWidth, tabDot } from "./lib/prrows.js";
import { READ, CHIP, chipWidth, prUrl } from "./git.js";
import { actionsFor, agentWaits, arrange, moveOf, nextStep, GROUPS } from "./lib/prmodel.js";
import { tipText } from "./lib/tiptext.js";
import { PAGE, VIEWER_CLOSED, count, DIFF_ROW } from "./common.js";
import { splitter } from "./lib/splitter.js";
import { fuzzy } from "./lib/fuzzy.js";

const RAIL = 210;
// The drafts' texts seen ({ "owner/repo#n@v": { v, body, comments, …, kept } }): pr-flow's view gives only the current
// version's, and a version is never rewritten, so an older one picked is shown from here. The last DRAFT_KEEP.
const DRAFT_TEXTS = "git-graph.draft-texts", DRAFT_KEEP = 40;
const TONES = [["shorter", "Shorter"], ["softer", "Softer, kinder"], ["more", "More detail"]];
// A draft comment's colour: not a finding's severity, not a place's accent, not a thread's.
const draftColor = (t) => t.ansi6 ?? t.ansi4 ?? t.accent;
const planColor = (t) => t.ansi3 ?? t.accent; // the fix round's plan (yellow: it waits for your go)
const PLAN_QUIET = 120000; // a change typed into the session with no new version after this long: said so
const VIEWED = "git-graph.viewed", VIEWED_KEEP = 80; // { [pr]: { at, files: { path: blob } } }, the last PRs
const CODE_AROUND = 3, CODE_MAX = 14; // a note's code: lines on each side, and the most of its own shown

// The file list's order in the PR view: files with something to look at (`hot` paths) first, then the rest, and
// last the noise (deleted, lockfiles, generated), folded into one row ({ fold: true, count, add, del, kinds })
// when there are two or more of it and `fold`. → { files, noise } (noise: the files in the folded row).
export const FOLD = "\u0000fold";
const LOCK = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|Gemfile\.lock|composer\.lock|go\.sum|mix\.lock|pubspec\.lock|flake\.lock)$/;
const GENERATED = /(^|\/)(dist|build|vendor|__generated__|generated|__snapshots__)\/|\.(min\.(js|css)|snap|pb\.go|map)$|[._-]generated\.[a-z]+$|_pb2\.py$/;
export const noiseKind = (f) => (f.status === "D" ? "deleted" : LOCK.test(f.path) ? "lockfile" : GENERATED.test(f.path) ? "generated" : null);

export function shapeFiles(files, hot, fold = true) {
  const first = [], rest = [], noise = [];
  for (const f of files) (hot.has(f.path) ? first : noiseKind(f) ? noise : rest).push(f);
  if (!fold || noise.length < 2 || !(first.length + rest.length)) return { files: [...first, ...rest, ...noise], noise: [] };
  const kinds = {};
  for (const f of noise) kinds[noiseKind(f)] = (kinds[noiseKind(f)] ?? 0) + 1;
  const row = { path: FOLD, fold: true, status: "", count: noise.length, add: noise.reduce((n, f) => n + f.add, 0), del: noise.reduce((n, f) => n + f.del, 0), kinds };
  return { files: [...first, ...rest, row], noise };
}

// The reading path: findings ({ kind: "f", i }), the fix plan's items ({ kind: "p", i }), the draft's comments
// ({ kind: "d", i }), places ({ kind: "l", i }) and open threads ({ kind: "t", i }) in the order of the file list
// (`paths`; files not in it last, by name), then by line; on one line in that order. Plan items without a code
// place aren't stops (they're in the notes).
const KIND_ORDER = { f: 0, p: 1, d: 2, l: 3, t: 4 };
export function readingPath(findings, looks, paths, threads = [], drafts = [], plan = []) {
  const order = new Map(paths.map((p, i) => [p, i])), at = (p) => order.get(p) ?? paths.length;
  return [...findings.map((f, i) => ({ kind: "f", i, path: f.path ?? "", line: f.line ?? 0 })), ...looks.map((l, i) => ({ kind: "l", i, path: l.path, line: l.line ?? 0 })),
    ...threads.map((x, i) => ({ kind: "t", i, path: x.path, line: x.line ?? 0 })), ...drafts.map((x, i) => ({ kind: "d", i, path: x.path, line: x.line ?? 0 })),
    ...plan.map((x, i) => ({ kind: "p", i, path: x.path, line: x.line ?? 0 })).filter((x) => x.path)]
    .sort((a, b) => at(a.path) - at(b.path) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || a.line - b.line || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.i - b.i);
}

export const THREADS_QUERY = "query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved isOutdated path line originalLine comments(first:30){nodes{author{login} body}}}}}}}";

// GitHub's review threads (the GraphQL reviewThreads nodes) as { open, resolved }, each { id, path, line, outdated,
// comments: [{ who, text }] }: a comment's text on one line, a suggestion block marked as one. An outdated thread is
// on the line it was written on.
export function reviewThreads(data) {
  const nodes = data?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
  // Markdown read as plain text: HTML comments, heading marks, bold/italic and code marks left out.
  const flat = (b) => String(b ?? "").replace(/<!--[\s\S]*?-->/g, "").replace(/```suggestion\s*/g, "suggestion: ").replace(/```\w*/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "").replace(/(\*\*|__)(.+?)\1/g, "$2").replace(/`([^`]*)`/g, "$1").replace(/\s+/g, " ").trim();
  const all = nodes.filter((n) => n?.path).map((n) => ({
    id: n.id, path: n.path, line: n.line ?? n.originalLine ?? null, outdated: Boolean(n.isOutdated), resolved: Boolean(n.isResolved),
    comments: (n.comments?.nodes ?? []).map((c) => ({ who: c.author?.login ?? "someone", text: flat(c.body) })),
  })).filter((x) => x.comments.length);
  return { open: all.filter((x) => !x.resolved), resolved: all.filter((x) => x.resolved) };
}

// Resolves (or unresolves) a review thread: the GraphQL mutation, for `gh api graphql -f query=… -f id=…`.
export const resolveQuery = (resolve) => `mutation($id:ID!){${resolve ? "resolveReviewThread" : "unresolveReviewThread"}(input:{threadId:$id}){thread{isResolved}}}`;

// `git ls-tree -r -z` entries (NUL-separated; newlines read too) as path → blob id, with "-" for each of `paths` it doesn't list (gone at that commit).
export function blobsOf(out, paths) {
  const m = new Map(paths.map((p) => [p, "-"]));
  for (const line of out.split(/[\n\0]/)) {
    const t = line.indexOf("\t");
    if (t > 0) m.set(line.slice(t + 1), line.slice(0, t).split(" ")[2]);
  }
  return m;
}

// The new side's line numbers a `git diff -U0` adds or changes.
export function changedLines(diff) {
  const out = new Set();
  for (const m of diff.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)) {
    const from = Number(m[1]), n = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < n; i++) out.add(from + i);
  }
  return out;
}

// Text in lines of at most `width` characters, broken between words (a longer word on a line of its own).
export function wrapText(text, width) {
  const out = [];
  let line = "";
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + w.length > width) { out.push(line); line = w; } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}
const bySeverity = (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity);

export const PrMethods = {
  // The dialog is the PR view (its bar, its scope, its frame), not a plain graph with a tracked PR's notes.
  prMode() { return Boolean(this.pr && !this.pr.lite); },

  prInit(cx) {
    { const v = Number(shared("git-graph.notes-dragged")); this.notesSplit = v > 0 ? v : null; }
    { const v = Number(shared("git-graph.pr-list-width")); this.railSplit = v > 0 ? v : null; }
    this.railOn = shared("git-graph.pr-list") === true; // the queue on the left: off unless asked for (⇧L)
    this.prPick = null; this.prPickScroll = VirtualListScrollHandle.new(); // the PR picker under the PR's name (p)
    // While in PR mode: say this PR view is open (see openPrView), and take the PRs asked for from then on.
    this.prViewId = Math.random().toString(36).slice(2);
    cx.timer.every(10000, () => this.prBeat());
    cx.timer.every(2000, (cx) => this.prDraftTick(cx)); // a reword job followed; the draft read again now and then
    // The fix plan's text box: what you'd type in the session's chat, typed into it on ⏎ (prPlanSend).
    this.planInput = InputState.new({ placeholder: "Tell the session… (⏎ types it there)" });
    this.planInput.on("focus", (_e, cx) => { this.planTyping = true; cx.notify(); });
    this.planInput.on("blur", (_e, cx) => { this.planTyping = false; cx.notify(); });
    this.planInput.on("submit", (_e, cx) => {
      const text = this.planInput.value().trim();
      if (text && this.pr) { this.prPlanSend(text, cx); this.planInput.set_value(""); }
      this.handle.focus(); cx.notify();
    });
    const key = props()?.pr;
    if (key) this.prEnter(key, cx);
  },

  prBeat() { if (this.prMode()) setShared(VIEW_OPEN, { id: this.prViewId, at: Date.now() }); },

  // The dialog becomes the PR view of `key` (props.pr, or p on a tracked PR's branch in the plain graph).
  prEnter(key, cx) {
    this.prAsked = shared(OPEN_PR)?.at ?? 0;
    if (!lastQueue()) cx.spawn(async (cx) => { await readQueue(); cx.notify(); });
    this.loadPr(key, cx);
    this.prBeat();
  },

  // esc in the PR view: back to the plain graph of the same repository (esc again closes the dialog).
  prExit(cx) {
    this.prClose();
    this.pr = null; this.prRevs = null; this.ask = null; this.prPick = null;
    this.selected = null; this.details = null; this.diff = null; this.zone = "graph";
    this.sinceBase = shared("git-graph.since") === true; this.limit = PAGE;
    this.refresh(cx); this.handle.focus(); cx.notify();
  },

  // Opens a PR: its record (branches, head), its range in your checkout (fetched when needed) and its
  // findings; then the graph moves to that repository and opens the review on the range.
  loadPr(key, cx) {
    const pr = this.pr = { key, status: "loading", findings: [], fAt: -1, lAt: -1, tAt: -1, dAt: -1, pAt: -1 };
    this.selected = null; this.details = null; this.diff = null; this.zone = "graph";
    // Another PR's history starts at its top: the list scrolled down in the last one may be past this one's end.
    this.cursor = null; this.moreAsked = null; this.scrollHandle.scroll_to_item(0);
    cx.spawn(async (cx) => {
      const caps = await capabilities();
      if (this.pr !== pr) return;
      let record, rec, range, findings, view, reviewed;
      if (caps.has("view")) {
        // pr-flow's `view`: the PR's stage, next step, actions, facts, draft, jobs, explainer and findings in one
        // read. show beside it only with an older pr-flow, whose view leaves out the explainer and the findings'
        // fixes and end lines (viewIsFull).
        pr.viewCap = true; pr.draftCap = caps.has("draft");
        view = await prView(key);
        if (this.pr !== pr) return;
        if (!viewIsFull(view)) { record = await showPr(key); if (this.pr !== pr) return; }
        const got = openFromView(view, record);
        rec = got.rec ?? lastQueue()?.records?.[key] ?? null; findings = got.findings; reviewed = got.reviewed;
        this.prTakeView(pr, view);
        pr.notes = notesOf(view, record); pr.headRef = rec?.headRef; pr.baseRef = rec?.baseRef;
        range = await prRange(key, rec);
        if (this.pr !== pr) return;
        this.prSetDraft(pr, pr.draftCap ? view : null);
      } else {
        record = await showPr(key);
        if (this.pr !== pr) return;
        const s = record?.snapshot;
        rec = s ? { headRef: s.headRef, baseRef: s.baseRef, headSha: s.headSha } : lastQueue()?.records?.[key] ?? null;
        pr.notes = notesOf(null, record); pr.headRef = rec?.headRef; pr.baseRef = rec?.baseRef;
        [range, findings, view] = await Promise.all([prRange(key, rec), findingsOf(key), draftView(key)]);
        if (this.pr !== pr) return;
        reviewed = record?.role === "author" ? record?.last_checked_sha : record?.last_reviewed_sha;
        this.prSetDraft(pr, view); // the stored comment draft, if any (pr-flow's `draft` capability)
      }
      if (range.error) { pr.status = "error"; pr.error = range.error; this.state = "prerror"; cx.notify(); return; }
      pr.status = "ready"; pr.root = range.root; pr.on = range.on ?? null; pr.head = range.head; pr.base = range.base; pr.baseName = range.baseName;
      const git = (args) => exec("git", [...READ, ...args], { cwd: range.root, on: range.on ?? null }).catch(() => ({ code: -1, stdout: "" }));
      // The header's ahead/behind: the PR's head against its base.
      if (range.base) {
        const lr = await git(["rev-list", "--left-right", "--count", `${range.base}...${range.head}`]);
        const [behind, ahead] = lr.code === 0 ? lr.stdout.trim().split(/\s+/).map(Number) : [];
        pr.ahead = ahead; pr.behind = behind;
        // One commit after another (no merge in it): the graph has nothing to show but a line, so it folds.
        const merges = await git(["rev-list", "--min-parents=2", "--count", `${range.base}..${range.head}`]);
        pr.straight = merges.code === 0 && Number(merges.stdout.trim()) === 0;
      }
      // Your last review's commit, for "Since my review" (gone after a force-push: then no such mode).
      if (reviewed && reviewed !== range.head && (await git(["merge-base", "--is-ancestor", reviewed, range.head])).code === 0) {
        const n = await git(["rev-list", "--count", `${reviewed}..${range.head}`]);
        pr.reviewed = reviewed; pr.newCommits = Number(n.stdout.trim()) || 0;
      }
      if (this.pr !== pr) return;
      pr.findings = findings.filter((f) => !f.status || f.status === "open" || f.status === "partial").sort(bySeverity);
      this.folder = range.root; this.folderOn = range.on ?? null;
      // Only the PR's head and its base in the graph ("This PR"): the head is near the top however busy the repo.
      pr.revs = [range.head, ...(range.base ? [range.base] : [])];
      this.prRevs = pr.revs; this.limit = PAGE;
      this.ask = { head: range.head, base: range.base, baseName: range.baseName, title: range.title, done: false };
      this.sinceBase = true;
      // Another PR in the same repository: the history is there already, only the review changes.
      this.refresh(cx, true);
      cx.notify();
    });
    cx.notify();
  },

  // "This PR": back to the PR's head and base after All branches or Current.
  setPrScope(cx) {
    if (!this.pr?.revs || this.prRevs) return;
    this.prRevs = this.pr.revs; this.limit = PAGE; this.refresh(cx);
    cx.notify();
  },

  // ---------- the header: the PR's branch, not the checkout's

  // { branch, ahead, behind } for the header while the PR view shows a PR; null otherwise.
  prHeader() {
    const pr = this.pr;
    if (!this.prMode() || pr.status !== "ready") return null;
    return { branch: `${pr.headRef ?? pr.head.slice(0, 8)} → ${pr.baseRef ?? "base"}`, ahead: pr.ahead, behind: pr.behind };
  },

  // ---------- since my review

  // c in the PR view: the whole PR ⇄ only what came after your last review.
  toggleSinceReview(cx) {
    const pr = this.pr;
    if (!pr?.reviewed) { notify({ title: "Nothing to compare with", body: "pr-flow has no review of yours on this PR's branch (none yet, or the branch was force-pushed since).", level: "info", timeout: 4000 }); return; }
    pr.sinceReview = !pr.sinceReview;
    this.ask = { ...this.ask, base: pr.sinceReview ? pr.reviewed : pr.base, baseName: pr.sinceReview ? `your review ${pr.reviewed.slice(0, 8)}` : pr.baseName };
    const commit = this.selected ? this.commits[this.index.get(this.selected)] : null;
    if (commit) {
      this.details = null; this.diff = null; this.diffWant = null; this.fileAt = 0; this.diffAt = 0;
      this.fileScroll.scroll_to_item(0);
      this.loadDetails(commit, cx);
    }
    cx.notify();
  },

  // The review's mode tabs in the PR view: Whole PR | Since my review (N).
  prModes(t) {
    const pr = this.pr;
    const tab = (id, label, on, tip) => div().id(id).px(6).py(1).rounded(4).text_color(on ? t.accent : t.dim).when(on, (e) => e.bg(t.hover)).tooltip(tipText(tip))
      .when(!on, (e) => e.cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => this.toggleSinceReview(cx))).child(label);
    return h_flex().flex_none().gap(2)
      .child(tab("pr-mode-all", "Whole PR", !pr.sinceReview, "Everything the PR changes against its base (c)"))
      .when(Boolean(pr.reviewed), (e) => e.child(tab("pr-mode-new", `Since my review · ${pr.newCommits}`, Boolean(pr.sinceReview), `Only the commits after your review at ${pr.reviewed.slice(0, 8)} (c)`)));
  },

  // ---------- why it's here, what it changes, where to look (pr-flow's review notes)

  prNotes(t, mono) {
    const notes = this.pr.notes ?? {}, th = notes.threads, e = notes.explainer;
    const head = (text) => div().pt(8).pb(1).text_size(10.5).font_semibold().text_color(t.muted).child(text);
    const facts = [
      // As on pr-board's card: not a one-word reason that only names the stage ("draft", shown in the bar), nor
      // pr-flow's "job-… working since" line (the bar's job chip says it).
      // While a fix plan waits for your go: its session's "An agent (session-…) working since" (before pr-flow
      // 0.45.1) isn't so, and "fix plan waiting for your go" (0.45.1) is the plan block's own header: both left out.
      ...(notes.reasons ?? []).filter((x) => /\s/.test(String(x).trim()) && !/\bjob-\d{8}-/.test(x)
        && !(planOpen(this.pr.plan) && (/\bsession-[0-9a-z]+\b.*\bworking\b/i.test(x) || /^fix plan waiting\b/i.test(x)))),
      th?.unresolved ? `${th.unresolved} open thread${th.unresolved === 1 ? "" : "s"}${th.awaitingReviewer ? `, ${th.awaitingReviewer} waiting on you` : th.awaitingAuthor ? `, ${th.awaitingAuthor} on the author` : ""}` : null,
    ].filter(Boolean);
    const stale = e?.sha && e.sha !== this.pr.head ? ` (at ${e.sha.slice(0, 8)})` : "";
    // Most useful first: why it's here, the findings, where to look, then what it changes.
    return v_flex().id("pr-notes").gap(1)
      // Its height as laid out (the panel's width fixes it), for notesHeight; drawn again when it changed.
      .on_size_change((size, cx) => { const h = size.height / this.unit(); if (Math.abs(h - (this.notesContent ?? 0)) > 1) { this.notesContent = h; cx.notify(); } })
      .when(facts.length > 0, (el) => el.child(div().w_full().text_size(11.5).text_color(t.foreground).child(facts.join(" · "))))
      .when(Boolean(this.pr.plan), (el) => el.child(this.prPlanPanel(t, mono)))
      .when(Boolean(this.pr.draft), (el) => el.child(this.prDraftPanel(t, mono)))
      .child(this.prFindingsList(t, mono))
      .when(Boolean(this.pr.threads?.length), (el) => el.child(this.prThreadsList(t, mono)))
      .when(Boolean(this.pr.threadsError), (el) => el.child(div().pt(4).text_size(11).text_color(t.dim).child(this.pr.threadsError)))
      .when(this.prLooks().length > 0, (el) => el.child(head("WHERE TO SPEND YOUR TIME"))
        .children(this.prLooks().map((l, i) => this.prLookCard(t, mono, l, i))))
      .when(Boolean(e?.points?.length || e?.text), (el) => el.child(head(`WHAT IT CHANGES${stale}`)).child(this.prChanges(t, e)));
  },

  // What the PR changes, all of it shown: pr-flow's points as a list (a dot, the lead in bold, its text below
  // in a quieter colour, room between the lines), or its text as paragraphs.
  prChanges(t, e) {
    // Markdown's code marks (`x`) read as noise in plain text: left out.
    const para = (text, color) => div().w_full().text_size(12).line_height(1.5).text_color(color).child(text.replace(/`([^`]*)`/g, "$1"));
    if (!e.points?.length) {
      return v_flex().gap(8).pr(4).children(String(e.text).split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean).map((x) => para(x.replace(/\s*\n\s*/g, " "), t.foreground)));
    }
    return v_flex().gap(10).pr(4).children(e.points.map((pt) => {
      const lead = typeof pt === "string" ? "" : String(pt.lead ?? "").trim(), text = typeof pt === "string" ? pt.trim() : String(pt.text ?? "").trim();
      return h_flex().gap(8).items_start()
        .child(div().flex_none().mt(7).size(5).rounded(3).bg(t.accent))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .when(Boolean(lead), (c) => c.child(div().w_full().text_size(12).line_height(1.5).font_semibold().text_color(t.foreground).child(lead)))
          .when(Boolean(text), (c) => c.child(para(text, lead ? t.muted : t.foreground))));
    }));
  },

  // A file and line of the review, as a finding is shown. Not in the diff on screen: under Since my review,
  // back to the whole PR and then there; a file the PR doesn't change, in the file viewer at the PR's head.
  gotoLine(path, line, cx) {
    if (this.details?.noise?.some((x) => x.path === path)) { this.pr.unfolded = true; this.prShape(); }
    const files = this.details?.files ?? [], at = files.findIndex((x) => x.path === path);
    if (at < 0 && this.pr.sinceReview) { this.pr.pendingGoto = { path, line }; this.toggleSinceReview(cx); return; }
    if (at < 0) {
      this.viewing = `${Date.now()}`; // the file list takes the keyboard back when the viewer closes (returnFromViewer)
      openOverlay({ mod: "file-browser", kind: "dialog", width: 0.92, height: 0.9,
        props: { folder: this.pr.root, on: this.pr.on ?? null, path, rev: /^[0-9a-f]{40}$/.test(this.pr.head) ? this.pr.head : undefined, line, closedKey: VIEWER_CLOSED, closedToken: this.viewing } });
      return;
    }
    this.zone = "files"; this.fileAt = at; this.fileScroll.scroll_to_item(at);
    this.pr.jump = { path, line };
    if (this.diff?.path === path && this.diff.rows) this.prJump(cx);
    this.handle.focus(); cx.notify();
  },

  // Another PR asked for while this view is open (openPrView): show it here. And a line asked for before the
  // review switched to the whole PR: there, once its files are read.
  prFollow(cx) {
    this.prAttach(cx);
    this.prShape();
    this.prLoadCode(cx);
    this.prLoadThreads(cx);
    this.prLoadBlobs(cx);
    const g = this.pr?.pendingGoto;
    if (g && this.prReviewing() && this.details?.files) { this.pr.pendingGoto = null; cx.timer.after(0, (cx) => this.gotoLine(g.path, g.line, cx)); }
    const want = shared(OPEN_PR);
    if (!this.prMode() || !want?.at || want.at <= this.prAsked) return;
    this.prAsked = want.at;
    if (want.key !== this.pr.key) cx.timer.after(0, (cx) => this.loadPr(want.key, cx));
  },

  prClose() {
    if (this.prViewId && shared(VIEW_OPEN)?.id === this.prViewId) setShared(VIEW_OPEN, null);
  },

  // refresh() waits for the PR's repository before reading anything.
  prWaiting() {
    if (!this.prMode() || this.pr.status === "ready") return false;
    this.state = this.pr.status === "error" ? "prerror" : "prloading";
    return true;
  },

  // ---------- a tracked PR's notes in the plain graph (lite): its branch's head reviewed since base

  // The PR whose branch head is reviewed since base, its notes read (or none: the lite PR let go).
  prAttach(cx) {
    if (this.prMode()) return;
    const commit = this.selected && this.sinceBase && this.details?.since?.from ? this.commits?.[this.index.get(this.selected)] : null;
    const r = commit && !commit.uncommitted ? this.prsAt(commit)[0] : null;
    if (!r) { if (this.pr?.lite) { this.pr = null; this.details = this.details?.orig ?? this.details; } return; }
    if (this.pr?.key === r.key && this.pr.head === commit.hash) return;
    const pr = this.pr = { key: r.key, lite: true, status: "loading", findings: [], fAt: -1, lAt: -1, tAt: -1, dAt: -1, pAt: -1,
      root: this.root, head: commit.hash, base: this.details.since.from, headRef: r.rec?.headRef, baseRef: r.rec?.baseRef };
    cx.spawn(async (cx) => {
      // One view when pr-flow's carries everything (viewIsFull); else show and findings, as before.
      const view = await prView(r.key);
      const [record, findings] = viewIsFull(view) ? [null, view.findings] : await Promise.all([showPr(r.key), findingsOf(r.key)]);
      if (this.pr !== pr) return;
      pr.notes = notesOf(view, record);
      pr.findings = findings.filter((f) => !f.status || f.status === "open" || f.status === "partial").sort(bySeverity);
      pr.status = "ready";
      this.prRenote(); cx.notify();
    });
  },

  // ---------- the queue on the left

  // The queue as the pane shows it (lib/prmodel.js): Your move by action, Waiting on others, then Later and
  // Dormant folded; the group of the PR shown stays open.
  prRail(t, mono) {
    const rows0 = this.prQueueRows(), out = [], numW = numWidth(rows0), blocks = arrange(rows0);
    this.prFold ??= new Map(); // group -> open
    for (const [g, label] of GROUPS) {
      const mine = blocks.filter((x) => x.group === g), rows = mine.flatMap((x) => x.rows);
      if (!rows.length) continue;
      const open = this.prFold.has(g) ? this.prFold.get(g) : g === "you" || g === "waiting" || rows.some((r) => r.key === this.pr.key);
      out.push(h_flex().id(`rail-grp-${g}`).px(8).pt(10).pb(2).gap(5).items_center().cursor_pointer().hover((e) => e.text_color(t.foreground))
        .on_click((_e, cx) => { this.prFold.set(g, !open); cx.notify(); })
        .child(div().flex_1().min_w(0).truncate().text_size(10.5).font_semibold().text_color(g === "you" ? t.foreground : t.muted).child(label.toUpperCase()))
        .child(div().flex_none().text_size(10).text_color(t.dim).child(`${rows.length} ${open ? "▾" : "▸"}`)));
      if (!open) {
        out.push(div().px(8).pb(1).truncate().font_family(mono).text_size(10.5).text_color(t.dim).child(rows.map((r) => `#${r.key.split("#")[1]}`).join(" ")));
        continue;
      }
      for (const blk of mine) {
        if (g === "you") out.push(div().px(8).pt(4).text_size(10).text_color(t.muted).child(`${blk.label} · ${blk.rows.length}`));
        for (const r of blk.rows) out.push(prRow(t, mono, r, { id: `rail-${r.key}`, compact: true, numW, selected: r.key === this.pr.key, focused: true,
          onClick: (_e, cx) => { this.loadPr(r.key, cx); this.handle.focus(); } }));
      }
    }
    return v_flex().w(this.railWidth()).flex_none().h_full().min_h(0).bg(t.chrome ?? t.background)
      .child(h_flex().h(42).flex_none().px(10).items_center().border_b(1).border_color(t.border)
        .child(div().text_size(13).font_semibold().child("PRs"))
        .child(div().flex_1())
        .child(div().text_size(10.5).text_color(t.dim).child("⌘↑ ⌘↓")))
      .child(v_flex().id("pr-rail").flex_1().min_h(0).px(4).pb(8).overflow_y_scrollbar().children(out.length ? out : [div().p(10).text_size(11.5).text_color(t.dim).child("Reading the queue…")]));
  },

  // ⌘↑ ⌘↓: the previous or next PR in the list's order (the pane's).
  prStep(d, cx) {
    const keys = arrange(this.prQueueRows()).flatMap((b) => b.rows).map((r) => r.key), at = keys.indexOf(this.pr.key);
    const next = keys[at < 0 ? 0 : Math.max(0, Math.min(keys.length - 1, at + d))];
    if (next && next !== this.pr.key) this.loadPr(next, cx);
  },

  // ⇧L: the queue on the left, for going through many PRs in a row; remembered.
  toggleRail(cx) {
    this.railOn = !this.railOn;
    setShared("git-graph.pr-list", this.railOn);
    cx.notify();
  },

  // Where the PR shown is in the queue's order (the pane's), and the PR ⌘↓ goes to.
  prPosition() {
    const keys = arrange(this.prQueueRows()).flatMap((b) => b.rows).map((r) => r.key), at = keys.indexOf(this.pr?.key);
    return { at, n: keys.length, next: at >= 0 ? keys[at + 1] ?? null : null };
  },

  // ---------- the PR picker: the PR's name in the bar opens the queue under it (p), as fleet-board's run list

  // Its lines: the queue in the pane's groups ({ kind: "head" } lines between them); typing filters it to the
  // PRs whose number, repository, title or author match, best first, without groups.
  prPickRows() {
    const q = (this.prPick?.query ?? "").trim(), blocks = arrange(this.prQueueRows());
    if (q) {
      return blocks.flatMap((b) => b.rows).map((r) => ({ r, s: fuzzy(q, `${r.key.split("/").pop()} ${r.title ?? ""} ${r.author ?? ""}`) }))
        .filter((m) => m.s !== null).sort((a, b) => b.s - a.s).map((m) => ({ kind: "pr", r: m.r }));
    }
    const out = [];
    for (const [g, label] of GROUPS) {
      const mine = blocks.filter((b) => b.group === g);
      if (!mine.length) continue;
      out.push({ kind: "head", text: label.toUpperCase(), n: mine.reduce((n, b) => n + b.rows.length, 0) });
      for (const b of mine) {
        if (g === "you") out.push({ kind: "sub", text: `${b.label} · ${b.rows.length}` });
        for (const r of b.rows) out.push({ kind: "pr", r });
      }
    }
    return out;
  },

  openPrPick(cx) {
    // The press that closed it (outside, which can be on the name itself) isn't also the one that opens it again.
    if (Date.now() - (this.prPickClosedAt ?? 0) < 400) return;
    this.prPick = { query: "", at: 0 };
    const rows = this.prPickRows(), here = rows.findIndex((x) => x.kind === "pr" && x.r.key === this.pr.key);
    this.prPick.at = here >= 0 ? here : Math.max(0, rows.findIndex((x) => x.kind === "pr"));
    cx.timer.after(0, () => this.prPickScroll.scroll_to_item(this.prPick?.at ?? 0, "center"));
    cx.notify();
  },

  closePrPick(cx) { this.prPick = null; this.prPickClosedAt = Date.now(); this.handle.focus(); cx.notify(); },

  // The highlight to the next (d 1) or previous (d -1) PR, over the group lines.
  prPickMove(d) {
    const rows = this.prPickRows(), p = this.prPick;
    for (let i = p.at + d; i >= 0 && i < rows.length; i += d) if (rows[i].kind === "pr") { p.at = i; this.prPickScroll.scroll_to_item(i); return; }
  },

  prPickChoose(cx) {
    const row = this.prPickRows()[this.prPick?.at ?? -1];
    this.closePrPick(cx);
    if (row?.kind === "pr" && row.r.key !== this.pr.key) this.loadPr(row.r.key, cx);
  },

  // Its keys while open (the graph keeps the keyboard): ↑ ↓ ⌃P ⌃N move, ⏎ shows, esc closes, letters filter.
  prPickKey(e, cx) {
    const k = e.keystroke, p = this.prPick, m = e.modifiers ?? {};
    if (/^(shift|ctrl|alt|cmd|platform|fn)$/.test(k)) return;
    if (k === "escape") return this.closePrPick(cx);
    if (k === "enter") return this.prPickChoose(cx);
    if (k === "down" || k === "ctrl-n" || k === "cmd-down") return this.prPickMove(1);
    if (k === "up" || k === "ctrl-p" || k === "cmd-up") return this.prPickMove(-1);
    if (k === "backspace") p.query = p.query.slice(0, -1);
    else if (e.key_char && !m.control && !m.platform && !m.alt) p.query += e.key_char;
    else return;
    const rows = this.prPickRows();
    p.at = Math.max(0, rows.findIndex((x) => x.kind === "pr"));
    this.prPickScroll.scroll_to_item(p.at);
  },

  // A PR in the picker: its tab's dot, number (in the accent when it needs you), repository, title, open findings.
  prPickRow(t, mono, r, i, { numW, repoW }) {
    const [grp] = moveOf(r), needs = grp === "you", here = r.key === this.pr.key;
    // A row of a virtual list takes no handlers: the list's on_item_click shows the PR clicked.
    return h_flex().h(26).px(10).gap(6).items_center().rounded(5).cursor_pointer()
      .when(i === this.prPick.at, (e) => e.bg(t.selected)).hover((e) => e.bg(t.hover))
      .child(tabDot(t, r.key))
      .child(div().w(numW).flex_none().text_right().font_family(mono).text_size(12).text_color(needs ? (nextStep(r).problem ? t.ansi1 : t.accent) : t.muted).when(needs, (e) => e.font_semibold()).child(`#${r.key.split("#")[1]}`))
      .child(div().w(repoW).flex_none().truncate().text_size(11.5).text_color(t.dim).child(parseKey(r.key)?.repo ?? ""))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(needs || here ? t.foreground : t.muted).when(here, (e) => e.font_semibold()).child(r.title ?? ""))
      .child(findingsBadge(t, r.rec));
  },

  // The dropdown under the PR's name.
  prPickList(t, mono) {
    const rows = this.prPickRows(), p = this.prPick, all = this.prQueueRows(), numW = numWidth(all), repoW = repoWidth(all), id = "pr-pick-list";
    p.at = Math.max(0, Math.min(p.at, rows.length - 1));
    const H = 26, h = Math.min(Math.max(1, rows.length) * H, 460);
    const line = (x, i) => x.kind === "head"
      ? h_flex().h(H).px(10).items_end().pb(3).gap(5).text_size(10.5).font_semibold().text_color(t.muted).child(div().flex_1().child(x.text)).child(div().text_color(t.dim).child(String(x.n)))
      : x.kind === "sub" ? h_flex().h(H).px(10).items_end().pb(3).text_size(10).text_color(t.muted).child(x.text)
      : this.prPickRow(t, mono, x.r, i, { numW, repoW });
    return v_flex().id("pr-pick").mt(4).w(560).py(4).rounded(8).bg(t.raised ?? t.background).border_1().border_color(t.border).shadow_lg()
      .on_mouse_down_out((_e, cx) => this.closePrPick(cx))
      .child(h_flex().h(26).px(10).gap(6).items_center().text_size(12)
        .child(div().flex_1().min_w(0).truncate().text_color(p.query ? t.foreground : t.dim).child(p.query ? p.query : "Type to filter: number, repository, title, author"))
        .when(Boolean(p.query), (e) => e.child(div().text_size(11).text_color(t.dim).child(`${rows.length} found`))))
      .child(div().relative().h(h).flex_none()
        .child(rows.length ? v_virtual_list(id, rows.length, H, (i) => (rows[i].kind === "pr" ? rows[i].r.key : `${rows[i].kind}-${i}`), (range) => rows.slice(range.start, range.end).map((x, o) => line(x, range.start + o)))
          .track_scroll(this.prPickScroll)
          .on_item_click((key, cx) => { const at = rows.findIndex((x) => x.kind === "pr" && x.r.key === key); if (at >= 0) { p.at = at; this.prPickChoose(cx); } })
          .size_full() : div().p(10).text_size(11.5).text_color(t.dim).child(lastQueue() ? "No PR matches." : "Reading the queue…"))
        .child(Scrollbar.vertical(id).viewport_from_layout().absolute().inset_0()))
      .child(div().px(10).pt(6).pb(2).mt(4).border_t_1().border_color(t.border).text_size(11).text_color(t.dim).child("↑ ↓ · ⏎ show · esc close · ⌘↑ ⌘↓ step without it · ⇧L the list on the left"));
  },

  // ---------- the bar: the PR and what you can do

  // The PR as a row (queueRows' shape) for the bar: with pr-flow's view (`view <pr> --json`, read when the PR opens and
  // on the refresh beats) its stage, next step, actions and jobs as pr-flow says them now, the queue's row under it
  // (detail, size, agent tab); without, the queue's row. Built at most once a second, as the queue's rows are.
  prRow() {
    const pr = this.pr, base = this.prQueueRows().find((r) => r.key === pr?.key) ?? null;
    if (!pr?.view) return base;
    const c = this.prViewRowCache;
    if (c && c.view === pr.view && c.base === base && Date.now() - c.at < 1000) return c.row;
    const row = viewRow(pr.view, base, base ? null : prTab(pr.key)?.status ?? null) ?? base;
    this.prViewRowCache = { view: pr.view, base, at: Date.now(), row };
    return row;
  },

  // The jobs the bar shows the PR's from: the view's, unless the queue was read since (its `job list` is newer then).
  prJobs() {
    const q = lastQueue(), pr = this.pr;
    return pr?.view && (q?.at ?? 0) <= (pr.viewAt ?? 0) ? { jobs: pr.view.jobs ?? [] } : q;
  },

  // Keeps a view read (the bar's row is built from it); one that failed keeps the last, and waits for the next beat.
  prTakeView(pr, view) {
    if (view) { pr.view = view; this.prSetPlan(pr, view); }
    pr.viewAt = Date.now();
  },

  // The queue's rows, read at most once a second: reading them parses the whole queue from shared state and looks
  // up each PR's agent tab, and the graph's rows ask for them per row (PR chips): every frame, the drawing ran
  // over Herdr's time and the list came up blank.
  prQueueRows() {
    const now = Date.now();
    if (!this.prRowsCache || now - this.prRowsCache.at > 1000) this.prRowsCache = { at: now, rows: queueRows(lastQueue()) };
    return this.prRowsCache.rows;
  },

  prBar(t, mono) {
    const pr = this.pr, r = this.prRow(), k = parseKey(pr.key), rec = r?.rec ?? {};
    const verbs = lastQueue()?.data?.verbs ?? {}, jobs = this.prJobs();
    if (pr.confirm) {
      return h_flex().h(40).flex_none().px(14).gap(10).items_center().bg(t.raised).border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().text_size(12).child(pr.confirm.text))
        .child(this.prButton("pr-yes", `${pr.confirm.label ?? pr.confirm.verb} ⏎`, true, (_e, cx) => this.prConfirmed(cx), t))
        .child(this.prButton("pr-no", "cancel esc", false, (_e, cx) => { pr.confirm = null; cx.notify(); }, t));
    }
    // Where it stands, in the pane's words: the action when it's your move, else on whom it waits.
    const [grp, what] = r ? moveOf(r) : [null, ""], needs = grp === "you", problem = r ? nextStep(r).problem : false, job = r ? jobFor(jobs, r) : null;
    const stage = grp === "you" ? what.toLowerCase() : grp === "waiting" ? `waiting on ${what}` : grp ?? "";
    // The PR's name opens the picker; where it is in the queue after it, and the next one in its tooltip.
    const pos = this.prPosition(), open = Boolean(this.prPick);
    const name = h_flex().id("pr-name").flex_none().h(26).px(6).ml(-6).gap(5).items_center().rounded(6).cursor_pointer()
      .when(open, (e) => e.bg(t.hover)).hover((e) => e.bg(t.hover))
      .tooltip(tipText(`Every PR in the queue (p)${pos.next ? `\nNext (⌘↓): ${tabName(pos.next)}` : ""}`))
      .on_click((_e, cx) => (this.prPick ? this.closePrPick(cx) : this.openPrPick(cx)))
      .child(div().font_family(mono).text_size(12.5).font_semibold().text_color(t.accent).child(k?.short ?? pr.key))
      .when(pos.at >= 0, (e) => e.child(div().text_size(11).text_color(t.dim).child(`${pos.at + 1}/${pos.n}`)))
      .child(div().text_size(11).text_color(open ? t.foreground : t.dim).child("▾"));
    return h_flex().h(40).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .child(Popup.new("pr-pick-popup", name).anchor("top_left").when(open, (e) => e.content(this.prPickList(t, mono))))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).child(r?.title ?? ""))
      .when(Boolean(r?.author), (e) => e.child(div().flex_none().text_size(11.5).text_color(t.dim).child(r.author)))
      .when(Boolean(stage), (e) => e.child(div().flex_none().px(6).rounded(4).text_size(11).bg(alpha(problem ? t.ansi1 : needs ? t.accent : t.muted, "22")).text_color(problem ? t.ansi1 : needs ? t.accent : t.muted).tooltip(tipText(r ? nextStep(r).text || r.detail || "" : "")).child(stage)))
      // A pr-flow job at work on it (or one that failed lately): what it's doing.
      .when(Boolean(job), (e) => e.child(div().flex_none().max_w(220).truncate().text_size(11).text_color(job.state === "failed" ? t.ansi1 : t.muted).tooltip(tipText(jobText(job, r))).child(`◷ ${jobText(job, r)}`)))
      .when(Boolean(rec.ci), (e) => e.child(ciGlyph(t, rec.ci)))
      .child(findingsBadge(t, rec))
      // Only what's possible now, as the pane's card offers it: the next step first (dimmed when it can't run now, its
      // tooltip says why), then the alternatives that can run, in pr-flow's words with its view model; the verb the
      // last job ran, done, says "again" (Self-check again).
      .when(Boolean(r), (e) => { const a = actionsFor(r), last = detailJob(jobs, r);
        return e.children([a.main, ...a.also.filter((v) => !verbPlan(r, v, verbs).disabled)].filter(Boolean).map((v, i) => {
          const p = verbPlan(r, v, verbs), again = last?.state === "done" && last.verb === v;
          return this.prButton(`pr-v-${v}`, again ? `${p.label} again` : p.label, i === 0 && !p.disabled, (_e, cx) => this.prVerb(v, cx), t, `${verbs[v]?.help ?? v}${p.disabled ? `\nNot now: ${p.disabled}` : ""}`).when(Boolean(p.disabled), (x) => x.opacity(0.5));
        })); })
      .child(this.prButton("pr-tab", prTab(pr.key) ? "tab ↗" : "tab", Boolean(r) && agentWaits(r), () => { if (!showPrTab(pr.key)) notify({ title: `${tabName(pr.key)} has no agent tab yet`, body: "An agent's action (review, fix, …) opens one.", level: "info", timeout: 4000 }); }, t, "Its agent tab: agent actions run there (t)"))
      .child(this.prButton("pr-gh", "GitHub ↗", false, (_e, cx) => this.prVerb("open", cx), t, r?.url));
  },

  prButton(id, label, primary, go, t, tip) {
    return div().id(id).flex_none().px(8).h(24).flex().items_center().rounded(6).text_size(11.5).cursor_pointer()
      .border_1().border_color(primary ? t.accent : t.border).text_color(primary ? t.accent : t.foreground)
      .hover((e) => e.bg(t.hover)).when(Boolean(tip), (e) => e.tooltip(tipText(tip))).on_click(go).child(label);
  },

  // A verb from the bar, as pr-board runs it (verbPlan): one that changes something on GitHub asks first, one that
  // can't run now says why.
  prVerb(verb, cx) {
    const pr = this.pr, r = this.prRow();
    if (!pr) return;
    // With a stored draft, post and copy are the draft's (the version shown), not a agent tab's.
    if (pr.draft && verb === "post") return this.prDraftAsk("post", cx);
    if (pr.draft && verb === "copy") return this.prDraftCopy(cx);
    if (pr.draft && verb === "discard") return this.prDraftAsk("discard", cx);
    const plan = verbPlan(r ?? { key: pr.key, short: tabName(pr.key) }, verb, lastQueue()?.data?.verbs), kind = plan.kind;
    if (plan.disabled) { notify({ title: `${plan.label}: not now`, body: plan.disabled, level: "info", timeout: 5000 }); return; }
    if (plan.confirm && pr.confirm?.verb !== verb) {
      pr.confirm = { verb, text: plan.confirm };
      cx.notify(); return;
    }
    pr.confirm = null;
    cx.spawn(async (cx) => {
      const res = await doVerb(verb, pr.key, { url: r?.url, kind });
      notify({ title: res.ok ? res.message : `${verb} ${tabName(pr.key)}: ${res.status ?? "failed"}`, body: res.ok ? "" : res.message, level: res.ok ? "success" : "error", timeout: res.ok ? 5000 : 12000 });
      if (kind !== "agent" && verb !== "open") await readQueue();
      cx.notify();
    });
    cx.notify();
  },

  // The bar's yes: the question's own action (the draft's), else the verb asked about.
  prConfirmed(cx) {
    const c = this.pr?.confirm;
    if (!c) return;
    if (c.go) { this.pr.confirm = null; c.go(cx); cx.notify(); return; }
    this.prVerb(c.verb, cx);
  },

  // ---------- the comment draft (pr-flow 0.33.0, capability `draft`): its summary in the notes, each comment on
  // its line in the diff; post (asked first), approve with it, copy, shorter / softer / more (reword jobs: a new
  // version), discard; free-text rewording in the PR's agent tab. Only pr-flow's view, post|approve|copy --draft,
  // job start reword and act discard: without the capability draftView is null and none of this shows.

  // Takes `view --json`: the current draft, its versions, and every version's text seen (here or before: a version is
  // never rewritten, so a text kept is still its text).
  prSetDraft(pr, view) {
    const d = draftOf(view), was = pr.draft?.v ?? null;
    pr.draft = d; pr.dVersions = view ? draftVersions(view) : []; pr.dActions = view?.actions ?? [];
    pr.dTexts ??= new Map();
    const kept = { ...(shared(DRAFT_TEXTS) ?? {}) };
    for (const x of pr.dVersions) { const k = kept[`${pr.key}@${x.v}`]; if (k && !pr.dTexts.has(x.v)) pr.dTexts.set(x.v, k); }
    if (d && !kept[`${pr.key}@${d.v}`]) {
      kept[`${pr.key}@${d.v}`] = { ...d, kept: Date.now() };
      setShared(DRAFT_TEXTS, Object.fromEntries(Object.entries(kept).sort((a, b) => (b[1].kept ?? 0) - (a[1].kept ?? 0)).slice(0, DRAFT_KEEP)));
    }
    if (d) pr.dTexts.set(d.v, d);
    // A new current version is the one shown; the one picked stays while it's still a version.
    if (!d || d.v !== was || (pr.dv !== null && pr.dv !== undefined && !pr.dVersions.some((x) => x.v === pr.dv))) { pr.dv = null; pr.dAt = -1; }
    pr.dReadAt = Date.now();
  },

  // The version shown: { v, tone, current, text } (text null: pr-flow shows only the current version's, and this view
  // hasn't seen this one's), or null without a draft.
  prDraftShown() {
    const pr = this.pr;
    if (!pr?.draft) return null;
    const v = pr.dv ?? pr.draft.v, meta = pr.dVersions?.find((x) => x.v === v);
    return { v, tone: meta?.tone ?? (v === pr.draft.v ? pr.draft.tone : null), current: v === pr.draft.v, text: pr.dTexts?.get(v) ?? null };
  },

  // The shown version's comments as notes on lines (draftNotes), [] without one.
  prDraftComments() {
    const s = this.prDraftShown();
    return s?.text ? draftNotes(s.text) : [];
  },

  // ⇧V or a version's chip: the next version (or that one), its comments on their lines.
  prDraftStep(cx, v = null) {
    const pr = this.pr, vs = pr.dVersions ?? [];
    if (!pr.draft || !vs.length) return;
    const at = vs.findIndex((x) => x.v === (pr.dv ?? pr.draft.v));
    const next = v ?? vs[(at + 1) % vs.length].v;
    pr.dv = next === pr.draft.v ? null : next; pr.dAt = -1;
    if (pr.range?.draft) pr.range = null;
    this.prShape(); this.prRenote(); cx.notify();
  },

  // A draft comment, as a finding: its file selected, its line in the middle of the diff.
  gotoDraft(i, cx) {
    const c = this.prDraftComments()[i];
    if (!c) return;
    this.pr.dAt = i; this.pr.fAt = -1; this.pr.lAt = -1; this.pr.tAt = -1; this.pr.pAt = -1;
    this.pr.range = c.side === "LEFT" ? null : { path: c.path, from: c.line, to: c.end ?? c.line, draft: true };
    this.prRenote();
    this.gotoLine(c.path, c.line, cx);
  },

  // pr-flow's own question for an outward verb (the view's action), with what goes out.
  prDraftAsk(verb, cx) {
    const pr = this.pr, s = this.prDraftShown();
    if (!s || pr.dBusy) return;
    if (verb !== "discard" && !s.text) { notify({ title: `Draft ${versionLabel(s)}: not shown here`, body: "pr-flow shows only the current version's text; this one wasn't read here before. Post the current one, or reword it again.", level: "info", timeout: 6000 }); return; }
    const a = pr.dActions?.find((x) => x.verb === verb), short = tabName(pr.key), n = s.text?.comments?.length ?? 0;
    if (a?.disabled_reason) { notify({ title: `${a.label ?? verb}: not now`, body: a.disabled_reason, level: "info", timeout: 5000 }); return; }
    const what = `draft ${versionLabel(s)}: the summary and ${n} comment${n === 1 ? "" : "s"}, as shown`;
    const text = verb === "post" ? `${a?.confirm ?? `Post your comments on ${short} to GitHub?`} (${what})`
      : verb === "approve" ? `${a?.confirm ?? `Approve ${short} on GitHub?`} With ${what}, as the approval.`
      : `Discard the draft on ${short}? Its versions stay in pr-flow's files; the PR goes back to its findings.`;
    pr.confirm = { verb, label: verb === "approve" ? "approve with it" : verb, text, go: (cx) => this.prDraftRun(verb, s.v, cx) };
    cx.notify();
  },

  // Runs what was confirmed: post | approve --draft v, or discard; then pr-flow's queue and the draft read again.
  prDraftRun(verb, v, cx) {
    const pr = this.pr, short = tabName(pr.key);
    pr.dBusy = verb; cx.notify();
    cx.spawn(async (cx) => {
      let res;
      if (verb === "discard") { const r = (await act(`discard ${short}`))[0] ?? {}; res = { ok: r.status === "done", message: String(r.message ?? r.status ?? "pr-flow said nothing").split("\n")[0] }; }
      else res = await draftCommand(verb, pr.key, v);
      pr.dBusy = null;
      notify({ title: res.ok ? `${verb === "discard" ? "Discarded the draft on" : verb === "post" ? `Posted draft v${v} on` : `Approved with draft v${v}:`} ${short}` : `${verb} ${short}: failed`, body: res.message, level: res.ok ? "success" : "error", timeout: res.ok ? 6000 : 12000 });
      await this.prDraftReload(pr, cx);
      await readQueue();
      cx.notify();
    });
  },

  // y or Copy: the version shown as copy-paste text on the clipboard (pr-flow's copy --draft: it records it as
  // handed over, so the PR waits on the author from then on).
  prDraftCopy(cx) {
    const pr = this.pr, s = this.prDraftShown(), short = tabName(pr.key);
    if (!s || pr.dBusy) return;
    if (!s.text) { notify({ title: `Draft ${versionLabel(s)}: not shown here`, body: "pr-flow shows only the current version's text.", level: "info", timeout: 5000 }); return; }
    pr.dBusy = "copy"; cx.notify();
    cx.spawn(async (cx) => {
      const res = await draftCommand("copy", pr.key, s.v);
      if (res.ok) await exec("/bin/sh", ["-c", 'printf %s "$1" | pbcopy', "sh", draftText(res.data ?? s.text)]).catch(() => null);
      pr.dBusy = null;
      notify({ title: res.ok ? `Copied draft ${versionLabel(s)} of ${short}` : `copy ${short}: failed`, body: res.ok ? "pr-flow counts it as handed over: paste it where it goes." : res.message, level: res.ok ? "success" : "error", timeout: res.ok ? 6000 : 12000 });
      if (res.ok) { await this.prDraftReload(pr, cx); await readQueue(); }
      cx.notify();
    });
  },

  // Shorter / softer / more: a reword job on the current version; its new version shows when it's done (prDraftTick).
  prDraftReword(tone, cx) {
    const pr = this.pr;
    if (!pr.draft || pr.rewording || pr.dBusy) return;
    pr.dBusy = tone; cx.notify();
    cx.spawn(async (cx) => {
      const res = await rewordDraft(pr.key, tone);
      pr.dBusy = null;
      if (res.ok) pr.rewording = { tone, job: res.job };
      notify({ title: res.ok ? `${tabName(pr.key)}: ${tone}, rewording v${pr.draft?.v ?? "?"}` : `${tone}: not now`, body: res.ok ? "In the background: the new version shows here when it's done." : res.message, level: res.ok ? "info" : "error", timeout: res.ok ? 4000 : 10000 });
      cx.notify();
    });
  },

  // Reword in your own words: the PR's agent tab on pr-flow's post flow (it shows the draft, you say what to
  // change, it posts only when you say so).
  prDraftSession(cx) {
    const pr = this.pr, r = this.prRow();
    cx.spawn(async (cx) => {
      const res = await doVerb("post", pr.key, { url: r?.url, kind: "agent" });
      notify({ title: res.ok ? res.message : `${tabName(pr.key)}: no tab`, body: res.ok ? "Say there how to change the draft; it posts only when you say so." : res.message, level: res.ok ? "success" : "error", timeout: 6000 });
      cx.notify();
    });
  },

  // The draft read again (after an action, a reword, or now and then: a reword from the board or a agent tab). With
  // pr-flow's view that one read is the bar's too (stage, next step, actions, jobs); a read that failed keeps the last.
  async prDraftReload(pr, cx) {
    const view = pr.viewCap ? await prView(pr.key) : await draftView(pr.key);
    if (this.pr !== pr) return;
    if (pr.viewCap) this.prTakeView(pr, view);
    if (pr.viewCap && !view) { pr.dReadAt = Date.now(); return; }
    const before = `${pr.draft?.v}/${pr.dVersions?.length}`;
    this.prSetDraft(pr, pr.viewCap && !pr.draftCap ? null : view);
    if (`${pr.draft?.v}/${pr.dVersions?.length}` !== before) { this.prShape(); this.prRenote(); }
    cx.notify();
  },

  // Every 2 s: a reword job followed to its end; every 20 s the draft (with pr-flow's view, the whole view) read
  // again, and with the view also when the queue was read since (an action, a job that ended, pr-board's reads):
  // the bar then says what pr-board's card says. Neither runs during a draw.
  prDraftTick(cx) {
    const pr = this.pr;
    if (!this.prMode() || pr.status !== "ready" || pr.dTicking) return;
    const rw = pr.rewording, queueNewer = pr.viewCap && (lastQueue()?.at ?? 0) > (pr.viewAt ?? 0);
    // A fix plan in play (waiting, going, pushed): read every 4 s, so a change typed into the session shows soon.
    const planLive = pr.plan && ["waiting", "going", "pushed"].includes(pr.plan.state);
    if (!rw && !queueNewer && Date.now() - (pr.dReadAt ?? 0) < (planLive ? 4000 : 20000)) return;
    pr.dTicking = true;
    cx.spawn(async (cx) => {
      try {
        if (!rw) { await this.prDraftReload(pr, cx); return; }
        const j = await jobShow(rw.job.id);
        if (this.pr !== pr) return;
        if (j && (j.state === "running" || j.state === "queued")) { rw.job = j; cx.notify(); return; }
        pr.rewording = null;
        if (j?.state === "done") {
          await this.prDraftReload(pr, cx);
          notify({ title: `${tabName(pr.key)}: draft v${pr.draft?.v ?? "?"} (${rw.tone}) ready`, body: "Shown in the notes and on its lines.", level: "success", timeout: 5000 });
        } else notify({ title: `${rw.tone} ${tabName(pr.key)}: ${j?.state ?? "lost"}`, body: j?.error ?? "", level: "error", timeout: 10000 });
        await readQueue();
        cx.notify();
      } finally { pr.dTicking = false; }
    });
  },

  // The draft in the notes: its versions (a chip each), its summary, its comments (each goes to its line), and what
  // to do with it.
  prDraftPanel(t, mono) {
    const pr = this.pr, s = this.prDraftShown(), c = draftColor(t), vs = pr.dVersions ?? [], busy = pr.dBusy, rw = pr.rewording;
    const approve = pr.dActions?.find((x) => x.verb === "approve" && !x.disabled_reason);
    const chip = (x) => { const on = x.v === s.v;
      return div().id(`pr-dv-${x.v}`).flex_none().px(5).h(18).flex().items_center().rounded(4).text_size(10.5).cursor_pointer()
        .text_color(on ? c : t.dim).when(on, (e) => e.bg(alpha(c, "22")).font_semibold()).hover((e) => e.bg(t.hover))
        .tooltip(tipText(`${versionLabel(x)}${x.v === pr.draft.v ? " · the current one" : ""} (⇧V the next)`))
        .on_click((_e, cx) => { cx.stop_propagation(); this.prDraftStep(cx, x.v); }).child(versionLabel(x)); };
    // Post, approve and copy send the version shown: dimmed while its text isn't (a click says why).
    const btn = (id, label, tip, go, primary = false) => this.prCardButton(t, `pr-db-${id}`, busy === id ? "…" : label, tip, go).when(primary && Boolean(s.text), (e) => e.border_color(c).text_color(c))
      .when(!s.text && (id === "post" || id === "approve" || id === "copy"), (e) => e.opacity(0.5));
    const comments = this.prDraftComments();
    return v_flex().id("pr-draft").mt(6).px(8).py(6).gap(5).rounded(6).border_l(2).border_color(c).bg(alpha(c, "0c"))
      .child(h_flex().gap(6).items_center().flex_wrap()
        .child(div().flex_none().text_size(10.5).font_semibold().text_color(c).child("YOUR DRAFT REVIEW"))
        .children(vs.length > 1 ? vs.map(chip) : [div().flex_none().text_size(10.5).text_color(t.dim).child(versionLabel(s))])
        .child(div().flex_1())
        .when(Boolean(rw), (e) => e.child(div().flex_none().max_w(200).truncate().text_size(10.5).text_color(t.muted).child(`◷ ${rw.tone}${rw.job?.phase ? ` · ${rw.job.phase}` : "…"}`))))
      .when(!s.text, (e) => e.child(div().w_full().text_size(11.5).text_color(t.dim).child(`${versionLabel(s)}'s text isn't shown: pr-flow gives only the current version's, and this view hadn't read this one.`)))
      .when(Boolean(s.text?.body), (e) => e.child(div().w_full().text_size(12).line_height(1.45).text_color(t.foreground).child(s.text.body)))
      .when(Boolean(s.text) && !s.current, (e) => e.child(div().text_size(10.5).text_color(t.muted).child(`An older version: post and copy send it as shown; shorter, softer and more reword v${pr.draft.v}, the current one.`)))
      .children(comments.map((x, i) => this.prDraftCard(t, mono, x, i)))
      .child(h_flex().pt(2).gap(5).flex_wrap()
        .child(btn("post", "Post…", "Post this version to GitHub as your review (asks first; ⌘⏎)", (cx) => this.prDraftAsk("post", cx), true))
        .when(Boolean(approve), (e) => e.child(btn("approve", "Approve with it…", "Approve on GitHub with this version as the review (asks first)", (cx) => this.prDraftAsk("approve", cx))))
        .child(btn("copy", "Copy", "This version as text on the clipboard (y); pr-flow counts it as handed over", (cx) => this.prDraftCopy(cx)))
        .child(div().w(4))
        .children(TONES.map(([tone, tip]) => btn(tone, tone[0].toUpperCase() + tone.slice(1), `${tip}: a new version of v${pr.draft.v}, in the background`, (cx) => this.prDraftReword(tone, cx))))
        .child(btn("session", "Reword in its tab ↗", "Say in your own words how to change it: the PR's agent tab, on pr-flow's post flow (it posts only when you say so)", (cx) => this.prDraftSession(cx)))
        .when(Boolean(pr.dActions?.some((x) => x.verb === "discard")), (e) => e.child(btn("discard", "Discard…", "Drop the draft (asks first); pr-flow keeps its versions' files", (cx) => this.prDraftAsk("discard", cx)))));
  },

  // A draft comment: Draft, its finding and place (which go to its line); its text, whole when reached or not in the diff.
  prDraftCard(t, mono, x, i) {
    const here = i === this.pr.dAt, c = draftColor(t), whole = here || !this.prInDiff(x.path, x.line);
    return v_flex().id(`pr-dc-${i}`).px(8).py(5).gap(3).rounded(6).cursor_pointer().bg(here ? t.hover : alpha(t.foreground, "08")).hover((e) => e.bg(t.hover))
      .on_click((_e, cx) => this.gotoDraft(i, cx))
      .child(h_flex().gap(6).items_center()
        .child(div().flex_none().px(5).rounded(4).bg(alpha(c, "22")).text_size(10.5).font_semibold().text_color(c).child("Draft"))
        .when(Boolean(x.finding), (e) => e.child(div().flex_none().font_family(mono).text_size(11).text_color(t.muted).child(x.finding)))
        .child(this.prPlace(t, mono, x.path, x.line, x.end, (cx) => this.gotoDraft(i, cx)))
        .when(x.side === "LEFT", (e) => e.child(div().flex_none().text_size(10.5).text_color(t.dim).child("old side")))
        .child(div().flex_1()))
      .child(div().w_full().text_size(12).text_color(t.foreground).when(!whole, (e) => e.max_h(36).overflow_hidden()).child(x.body));
  },

  // ---------- the fix round's plan (pr-flow 0.45.0, its ENGINE.md "Fix plans"): in the notes and on its items' lines. Your
  // go and changes are typed into the PR's session as you'd type them there; the session records the changed plan
  // as a new version, which replaces the one shown.

  // Takes `view --json`'s fix_plan. The item reached stays reached by its id; a change typed into the session is
  // answered by a new version (or the plan leaving `waiting`).
  prSetPlan(pr, view) {
    const p = fixPlanOf(view), was = pr.plan;
    if (p?.version === was?.version && p?.state === was?.state) return;
    const at = was && pr.pAt >= 0 ? was.items[pr.pAt]?.id : null, fid = pr.fAt >= 0 ? this.prFindings()[pr.fAt]?.id : null;
    pr.plan = p;
    if (fid) pr.fAt = this.prFindings().findIndex((f) => f.id === fid);
    if (pr.planSent && (!p || p.version > pr.planSent.version || !planOpen(p))) pr.planSent = null;
    pr.pAt = at && p ? p.items.findIndex((x) => x.id === at) : -1;
    if (!planOpen(p) || !p.items.some((x) => x.id === pr.planRow)) pr.planRow = null;
    if (pr.status === "ready") { this.prShape(); this.prRenote(); }
  },

  // A plan item, as a finding: reached (its card marked, its fix and code on it), its line in the middle of the
  // diff when the PR changes its file. A file outside the diff opens in the file viewer only from its place link
  // (`viewer`): the card shows its code instead.
  gotoPlan(i, cx, viewer = false) {
    const x = this.pr.plan?.items?.[i];
    if (!x) return;
    this.pr.pAt = i; this.pr.fAt = -1; this.pr.lAt = -1; this.pr.tAt = -1; this.pr.dAt = -1;
    if (this.pr.planRow !== x.id) this.pr.planRow = null;
    this.pr.range = x.path ? { path: x.path, from: x.line, to: x.end_line ?? x.line } : null;
    this.prRenote();
    const files = this.details?.orig?.files ?? this.details?.files ?? [];
    if (x.path && (viewer || files.some((f) => f.path === x.path))) this.gotoLine(x.path, x.line, cx);
    else cx.notify();
  },

  // ⏎ on an item (or a click on its verdict): its verdict row, open or closed.
  prPlanRow(id, cx) {
    const pr = this.pr;
    if (!id || !planOpen(pr.plan)) return;
    pr.planRow = pr.planRow === id ? null : id;
    const i = pr.plan.items.findIndex((x) => x.id === id);
    if (i >= 0 && pr.pAt !== i) { pr.pAt = i; pr.fAt = -1; pr.lAt = -1; pr.tAt = -1; pr.dAt = -1; this.prRenote(); }
    cx.notify();
  },

  // Is the session that made the plan here to type into (the PR's agent tab, with its terminal)?
  prPlanSession() { return Boolean(prTab(this.pr?.key)?.terminal); },

  // Types `words` into the PR's session (a verdict, go, or your own words). Shown on its item, or under the go line,
  // until the session records the next version.
  prPlanSend(words, cx, id = null) {
    const pr = this.pr, p = pr?.plan;
    if (!planOpen(p) || !words.trim()) return;
    if (!this.prPlanSession()) {
      notify({ title: `${tabName(pr.key)}: no session to type into`, body: "The session that made this plan isn't open here. t opens the PR's agent tab; a new fix round starts there.", level: "info", timeout: 6000 });
      return;
    }
    pr.planSent = { id, words, at: Date.now(), version: p.version };
    pr.planRow = null;
    cx.spawn(async (cx) => {
      const res = await typeIntoTab(pr.key, words);
      if (res !== "sent") {
        if (pr.planSent?.words === words) pr.planSent = null;
        notify({ title: `${tabName(pr.key)}: couldn't type “${words}”`, body: res ?? "The PR's agent tab is gone.", level: "error", timeout: 10000 });
      }
      pr.dReadAt = 0; // the plan read again at the next beat
      cx.notify();
    });
    cx.notify();
  },

  // ⌘⏎ or Go: types go. Pressing it is the yes: the go line it answers is right above it, and a plan from an older
  // head says so on the button (Go anyway: head moved).
  prPlanGo(cx) {
    const pr = this.pr, p = pr?.plan;
    if (!planOpen(p)) return;
    if (pr.planSent) { notify({ title: "Waiting for the session", body: `“${pr.planSent.words}” isn't in the plan shown yet: go once its new version is here.`, level: "info", timeout: 5000 }); return; }
    this.prPlanSend("go", cx); // without a session, says why it can't
  },

  // Has the PR's head moved since the plan was made?
  prPlanMoved() {
    const sha = String(this.pr?.plan?.sha ?? ""), head = String(this.pr?.head ?? "");
    return Boolean(sha && /^[0-9a-f]{7,}$/.test(head) && !head.startsWith(sha) && !sha.startsWith(head));
  },

  // The plan in the notes: where it stands, its items (each goes to its line; ⏎ or a click on its verdict opens
  // the verdict row), the go line, and the text box. Read-only once it's no longer waiting for your go.
  prPlanPanel(t, mono) {
    const pr = this.pr, p = pr.plan, c = planColor(t), open = planOpen(p), session = this.prPlanSession(), moved = this.prPlanMoved();
    const sz = p.size ?? {}, size = sz.added != null ? `+${sz.added} −${sz.deleted ?? 0} in ${sz.files ?? "?"} files${sz.after ? ` → +${sz.after.added} −${sz.after.deleted ?? 0}` : ""}` : "";
    const state = { waiting: session ? "waiting for your go" : "waiting, but its session isn't open here", going: "go given: fixing", pushed: "pushed: replies next", done: "done", dropped: "dropped: its session let go of the PR" }[p.state] ?? p.state;
    const sent = pr.planSent, late = sent && Date.now() - sent.at > PLAN_QUIET;
    return v_flex().id("pr-plan").mt(6).px(8).py(6).gap(5).rounded(6).border_l(2).border_color(c).bg(alpha(c, "0c"))
      .child(h_flex().gap(6).items_center().flex_wrap()
        .child(div().flex_none().text_size(10.5).font_semibold().text_color(c).child("FIX PLAN"))
        .child(div().flex_none().text_size(10.5).text_color(moved ? t.ansi1 : t.dim).child(`planned at ${String(p.sha ?? "?").slice(0, 8)}${moved ? ", head moved" : ""}`))
        .when(Boolean(size), (e) => e.child(div().flex_none().text_size(10.5).text_color(t.dim).child(size)))
        .child(div().flex_1())
        .child(div().flex_none().text_size(10.5).text_color(open ? c : t.muted).child(state)))
      .children(p.items.map((x, i) => this.prPlanItem(t, mono, x, i, open)))
      .when(Boolean(p.go), (e) => e.child(div().w_full().pt(2).font_family(mono).text_size(11).text_color(open ? t.foreground : t.muted).child(p.go)))
      // One slot under the go line, the same height in every state: what was typed, else the keys.
      .when(open, (e) => e.child(div().w_full().h(16).text_size(10.5).truncate().text_color(late ? t.ansi3 ?? t.muted : t.dim)
        .child(sent ? (late ? `no answer from the session yet to “${sent.words}” · t its tab` : `sent: ${sent.words} · waiting for the session's new version`)
          : session ? "n N its items · ⏎ an item's verdicts (f w a u s) · ⌘⏎ go: fixes, pushes and posts what the go line says" : "No session to type into: t opens the PR's agent tab")))
      .when(open, (e) => e.child(h_flex().gap(6).items_center()
        .child(Input.new(this.planInput).flex_1().h(26).px(8).rounded(6).border_1().border_color(this.planTyping ? c : t.border).bg(t.background).text_size(12).text_color(t.foreground)
          .when(!session, (x) => x.opacity(0.5)))
        .child(this.prCardButton(t, "pr-plan-go", moved ? "Go anyway: head moved ⌘⏎" : "Go ⌘⏎", `Type go into the session: ${p.go ?? ""}${moved ? `\nPlanned at ${String(p.sha).slice(0, 8)}; the PR's head has moved since.` : ""}`, (cx) => this.prPlanGo(cx))
          .when(moved, (x) => x.border_color(t.ansi1).text_color(t.ansi1)).when(!session || Boolean(sent), (x) => x.opacity(0.5)))));
  },

  // A plan item: severity, id, verdict (a click: its verdict row), place (goes there), who; its point; the reply
  // it gets (or a fix's proof); while waiting for the session, what was typed for it.
  prPlanItem(t, mono, x, i, open) {
    const pr = this.pr, here = i === pr.pAt, row = open && pr.planRow === x.id, c = planColor(t);
    const vc = x.verdict === "fix" ? t.ansi2 : x.verdict === "skip" ? t.dim : x.verdict === "won't-fix" ? t.ansi1 : t.accent;
    const sent = pr.planSent?.id === x.id ? pr.planSent : null;
    // Reached: the fix of the finding it takes up, and its code, unless the diff's note beside the code says them.
    const whole = here && !(x.path && this.prInDiff(x.path, x.line));
    const fix = whole && x.verdict === "fix" && x.kind === "finding" ? (pr.findings ?? []).find((f) => f.id === x.id)?.fix : null;
    return v_flex().id(`pr-plan-${x.id}`).px(8).py(5).gap(3).rounded(6).cursor_pointer().bg(here ? t.hover : alpha(t.foreground, "08")).hover((e) => e.bg(t.hover))
      .on_click((_e, cx) => this.gotoPlan(i, cx))
      .child(h_flex().gap(6).items_center()
        .when(Boolean(x.severity), (e) => e.child(div().flex_none().px(5).rounded(4).bg(alpha(sevColor(t, x.severity), "22")).text_size(10.5).font_semibold().text_color(sevColor(t, x.severity)).child(x.severity)))
        .child(div().flex_none().font_family(mono).text_size(11).text_color(t.muted).child(x.id))
        .child(div().id(`pr-plan-v-${x.id}`).flex_none().px(5).rounded(4).text_size(10.5).font_semibold().text_color(vc).bg(alpha(vc, row ? "33" : "18"))
          .when(open, (e) => e.cursor_pointer().tooltip(tipText("Change its verdict (⏎ on the item)")).on_click((_e, cx) => { cx.stop_propagation(); this.prPlanRow(x.id, cx); }))
          .child(`${x.verdict}${x.duplicate_of ? ` of ${x.duplicate_of}` : ""}`))
        .when(Boolean(x.path), (e) => e.child(this.prPlace(t, mono, x.path, x.line, x.end_line, (cx) => this.gotoPlan(i, cx, true))))
        .when(Boolean(x.who), (e) => e.child(div().flex_none().max_w(140).truncate().text_size(11).text_color(t.dim).child(x.who)))
        .child(div().flex_1()))
      .child(div().w_full().text_size(12).text_color(x.verdict === "skip" ? t.muted : t.foreground).child(x.text ?? ""))
      .when(Boolean(fix), (e) => e.child(h_flex().gap(6).items_start()
        .child(div().flex_none().pt(1).text_size(10).font_semibold().text_color(t.ansi2).child("FIX"))
        .child(div().flex_1().min_w(0).text_size(11.5).text_color(t.muted).child(fix))))
      .when(whole && Boolean(x.path && x.line), (e) => e.child(this.prCode(t, mono, x.path, x.line, x.end_line)))
      .when(x.verdict === "fix" && Boolean(x.proof), (e) => e.child(div().w_full().text_size(11).text_color(t.muted).child(`proof: ${x.proof}`)))
      .when(Boolean(x.reply), (e) => e.child(div().w_full().text_size(11).text_color(t.muted).child(`reply: ${x.reply}`)))
      .when(Boolean(sent), (e) => e.child(div().w_full().text_size(10.5).text_color(c).child(`sent: ${sent.words}`)))
      .when(row, (e) => e.child(h_flex().gap(4).flex_wrap().pt(2)
        .children(PLAN_VERDICTS.map(([key, v]) => this.prCardButton(t, `pr-plan-${x.id}-${key}`, `${key} ${v}`, `Type “${planWords(x.id, v)}” into the session`, (cx) => this.prPlanSend(planWords(x.id, v), cx, x.id))
          .when(v === x.verdict, (b) => b.border_color(vc).text_color(vc))))
        .child(div().flex_none().text_size(10.5).text_color(t.dim).child("esc closes"))));
  },

  // ---------- findings in the review

  // Is the review on screen the PR's range (not a commit picked in the graph)?
  prReviewing() {
    const pr = this.pr;
    if (pr?.lite) return pr.status === "ready" && Boolean(this.details?.since) && this.selected === pr.head;
    if (pr?.status !== "ready" || !this.details?.since || !this.selected || !this.ask?.done) return false;
    return !/^[0-9a-f]{40}$/.test(pr.head) || this.selected === pr.head; // the PR's head, not a commit picked since
  },

  // ---------- the PR list's width: its right edge drags (double-click: back to the default), remembered

  railWidth() {
    const want = this.railSplit ?? RAIL;
    return Math.round(Math.max(150, Math.min(want, 480)));
  },

  setRailWidth(w, cx) {
    this.railSplit = w === null ? null : Math.round(w);
    setShared("git-graph.pr-list-width", this.railSplit);
    cx.notify();
  },

  railHandle(t) {
    return splitter(t, { id: "graph-rail-split", axis: "col", dragging: Boolean(this.railDrag), from: () => this.railWidth(),
      onStart: (d) => { this.railDrag = d; }, onReset: (cx) => this.setRailWidth(null, cx) });
  },

  // ---------- the notes' height: as tall as what they say, up to a cap, so the files get the rest; the line
  // under them drags to a height of your own (double-click: back to fitting), remembered

  notesRoom() { return this.detailsHeight() - 32 - 26; }, // the review's title bar and the files' count line

  // The most the notes take while they fit their text: over half, as the files need the room more.
  notesCap() { return Math.round(Math.max(60, Math.min(this.notesRoom() * 0.55, this.notesRoom() - 3 * 24))); },

  notesHeight() {
    // Not dragged: the notes' own height (their text measured, plus the panel's padding) up to the cap.
    const want = this.notesSplit ?? (this.notesContent ? Math.min(this.notesContent + 20, this.notesCap()) : this.notesCap());
    return Math.round(Math.max(40, Math.min(want, this.notesRoom() - 3 * 24)));
  },

  // A height dragged to (remembered), or null: back to fitting what they say.
  setNotesHeight(h, cx) {
    this.notesSplit = h === null ? null : Math.round(h);
    setShared("git-graph.notes-dragged", this.notesSplit);
    cx.notify();
  },

  // The notes' element: always a definite height (a scroll area with only a maximum doesn't scroll): dragged, or
  // what their text measures (prNotes reports it) up to the cap.
  notesFit(e) { return e.h(this.notesHeight()); },

  notesHandle(t) {
    return splitter(t, { id: "graph-notes-split", axis: "row", dragging: Boolean(this.notesDrag), from: () => this.notesHeight(),
      onStart: (d) => { this.notesDrag = d; }, onReset: (cx) => this.setNotesHeight(null, cx) });
  },

  // The open findings the notes go through: with a fix plan, those it doesn't take up (a plan's finding item has
  // the finding's id), as the plan says them already, with their verdicts.
  prFindings() {
    const pr = this.pr, fs = pr?.findings ?? [], ids = this.prPlanFindingIds();
    return ids.size ? fs.filter((f) => !ids.has(f.id)) : fs;
  },

  prPlanFindingIds() { return new Set((this.pr?.plan?.items ?? []).filter((x) => x.kind === "finding").map((x) => x.id)); },

  prFindingsList(t, mono) {
    const fs = this.prFindings(), planned = this.pr.findings.length - fs.length;
    if (!fs.length) return planned ? div() : div().pt(4).text_size(11.5).text_color(t.dim).child("No open findings from pr-flow.");
    return v_flex().pt(6).gap(6)
      .child(div().pt(2).text_size(10.5).font_semibold().text_color(t.muted).child(`FINDINGS ${fs.length}${planned ? " not in the fix plan" : ""} · n N go through them and the places below`))
      .children(fs.map((f, i) => this.prFindingCard(t, mono, f, i)));
  },

  // A finding: a line with its severity, id and place (which goes there); its title, whole; opened (a click, or
  // reached with n N): how to fix it and the code at its line.
  prFindingCard(t, mono, f, i) {
    // Opened (or reached) on a line of the diff: the diff's note has the fix, beside the code; elsewhere the card.
    const id = `pr-f-${f.id}`, open = this.pr.opened?.has(id) || i === this.pr.fAt, c = sevColor(t, f.severity), whole = open && !this.prInDiff(f.path, f.line);
    return v_flex().id(id).px(8).py(6).gap(4).rounded(6).border_l(2).border_color(c).cursor_pointer()
      .bg(i === this.pr.fAt ? t.hover : alpha(t.foreground, "08")).hover((e) => e.bg(t.hover))
      .on_click((_e, cx) => {
        if (!open) { this.prToggle(id, false); this.gotoFinding(i, cx); cx.notify(); return; }
        // Closed again: and no longer the one reached, so it folds in the diff too.
        this.prToggle(id, true);
        if (this.pr.fAt === i) { this.pr.fAt = -1; this.pr.range = null; this.prRenote(); }
        cx.notify();
      })
      .child(h_flex().gap(6).items_center()
        .child(div().flex_none().px(5).rounded(4).bg(alpha(c, "22")).text_size(10.5).font_semibold().text_color(c).child(f.severity ?? "?"))
        .child(div().flex_none().font_family(mono).text_size(11).text_color(t.muted).child(f.id))
        .child(this.prPlace(t, mono, f.path, f.line, f.end_line, (cx) => this.gotoFinding(i, cx)))
        .child(div().flex_1()))
      .child(div().w_full().text_size(12).text_color(t.foreground).child(f.title ?? ""))
      .when(whole && Boolean(f.fix), (e) => e.child(h_flex().gap(6).items_start()
        .child(div().flex_none().pt(1).text_size(10).font_semibold().text_color(t.ansi2).child("FIX"))
        .child(div().flex_1().min_w(0).text_size(11.5).text_color(t.muted).child(f.fix))))
      .when(whole && Boolean(f.path && f.line), (e) => e.child(this.prCode(t, mono, f.path, f.line, f.end_line)));
  },

  // Where to spend your time: one place, why, and its code.
  prLookCard(t, mono, l, i) {
    const here = i === this.pr.lAt;
    return v_flex().id(`pr-look-${i}`).px(8).py(6).gap(4).rounded(6).border_l(2).border_color(here ? t.accent : alpha(t.accent, "00"))
      .bg(here ? t.hover : alpha(t.foreground, "08")).cursor_pointer().hover((e) => e.bg(t.hover))
      .on_click((_e, cx) => this.gotoLook(i, cx))
      .child(h_flex().gap(6).items_center().child(this.prPlace(t, mono, l.path, l.line, l.end_line, (cx) => this.gotoLook(i, cx))).child(div().flex_1()))
      .when(Boolean(l.why), (e) => e.child(div().w_full().text_size(12).text_color(t.foreground).child(l.why)))
      .when(Boolean(l.line) && !this.prInDiff(l.path, l.line), (e) => e.child(this.prCode(t, mono, l.path, l.line, l.end_line)));
  },

  // A file and line as a link: the file's name (its folder in the tooltip), the line or lines.
  prPlace(t, mono, path, line, end, go) {
    const where = `${(path ?? "").split("/").pop()}${line ? `:${line}${end && end !== line ? `-${end}` : ""}` : ""}`;
    return div().id(`place-${path}-${line}`).flex_none().max_w(260).truncate().font_family(mono).text_size(11).text_color(t.accent)
      .hover((e) => e.underline()).tooltip(tipText(`${path}\nShow it in the diff`))
      .on_click((_e, cx) => { cx.stop_propagation(); go(cx); }).child(where);
  },

  prToggle(id, open) {
    this.pr.opened ??= new Set();
    if (open) this.pr.opened.delete(id); else this.pr.opened.add(id);
  },

  // pr-flow's look-ats as { path, line, end_line, why }: an entry it couldn't read as one ("a.js:3 — why")
  // read here, one without a place left out.
  prLooks() {
    const raw = this.pr.notes?.explainer?.look_at ?? [];
    return raw.map((l) => {
      if (l && typeof l === "object") return l.path ? { path: l.path, line: Number(l.line) || null, end_line: Number(l.end_line) || null, why: l.why ?? "" } : null;
      const m = /^\s*([^\s:]+):(\d+)(?:-(\d+))?\s*(?:[—–-]\s*)?(.*)$/.exec(String(l ?? ""));
      return m ? { path: m[1], line: Number(m[2]), end_line: m[3] ? Number(m[3]) : null, why: m[4].trim() } : null;
    }).filter(Boolean);
  },

  // ---------- the code at a place, read at the PR's head: the lines (up to CODE_MAX), CODE_AROUND more on each
  // side, numbered; the lines the PR changed tinted as in the diff

  prCode(t, mono, path, line, end) {
    const file = this.pr.code?.get(path);
    if (!file) return div().text_size(11).text_color(t.dim).child("Reading the code…");
    if (file.error) return div().text_size(11).text_color(t.dim).child(file.error);
    const last = Math.min(end && end >= line ? end : line, line + CODE_MAX - 1), cut = (end ?? line) - last;
    const from = Math.max(1, line - CODE_AROUND), to = Math.min(file.lines.length, last + CODE_AROUND);
    const rows = [];
    for (let n = from; n <= to; n++) {
      const changed = file.changed.has(n), inside = n >= line && n <= last;
      rows.push(h_flex().h(17).gap(8).when(changed, (e) => e.bg(alpha(t.ansi2, "26")))
        .child(div().w(34).flex_none().h_full().pr(4).text_right().text_color(changed ? t.ansi2 : t.dim).when(changed, (e) => e.bg(alpha(t.ansi2, "40"))).child(String(n)))
        .child(div().flex_1().min_w(0).truncate().text_color(inside ? t.foreground : t.muted).child(file.lines[n - 1] || " ")));
    }
    return v_flex().w_full().py(3).rounded(4).overflow_hidden().bg(t.background).border_1().border_color(t.border).font_family(mono).text_size(11)
      .children(rows).when(cut > 0, (e) => e.child(div().px(8).text_size(10.5).text_color(t.dim).child(`… ${cut} more line${cut === 1 ? "" : "s"}`)));
  },

  // The files the notes point at, read once a PR is open: each at the PR's head, and which of its lines the PR
  // changed (against where it branched). In this.pr.code: path → { lines, changed } or { error }.
  prLoadCode(cx) {
    const pr = this.pr;
    if (pr?.status !== "ready") return;
    pr.code ??= new Map(); pr.codeAsked ??= new Set();
    // Each file once: those of the findings and places, then of the threads once they're read.
    const paths = [...new Set([...pr.findings.filter((f) => f.path && f.line).map((f) => f.path), ...this.prLooks().map((l) => l.path), ...(pr.threads ?? []).map((x) => x.path), ...this.prDraftComments().map((x) => x.path), ...(pr.plan?.items ?? []).filter((x) => x.path).map((x) => x.path)])]
      .filter((p) => !pr.codeAsked.has(p));
    if (!paths.length) return;
    for (const p of paths) pr.codeAsked.add(p);
    const git = (args) => exec("git", [...READ, ...args], { cwd: pr.root, on: pr.on ?? null }).catch(() => ({ code: -1, stdout: "", stderr: "" }));
    cx.spawn(async (cx) => {
      await Promise.all(paths.map(async (path) => {
        const [show, diff] = await Promise.all([git(["show", `${pr.head}:${path}`]), pr.base ? git(["diff", "--no-ext-diff", "-U0", `${pr.base}...${pr.head}`, "--", path]) : null]);
        if (show.code !== 0) { pr.code.set(path, { error: `${path} isn't in the PR's head.` }); return; }
        if (show.stdout.includes("\0")) { pr.code.set(path, { error: "A binary file." }); return; }
        pr.code.set(path, { lines: show.stdout.replace(/\t/g, "  ").split("\n"), changed: changedLines(diff?.stdout ?? "") });
      }));
      if (this.pr === pr) cx.notify();
    });
  },

  // The file list's mark: the most severe open finding in the file.
  prFileMark(path, t) {
    if (!this.prReviewing()) return null;
    const f = this.prFindings().filter((x) => x.path === path).sort(bySeverity)[0];
    if (f) return this.prMarkDot(sevColor(t, f.severity));
    // No finding there, but a draft comment: its colour.
    if (this.prDraftComments().some((x) => x.path === path)) return this.prMarkDot(draftColor(t));
    // Else a fix plan's item (a finding it takes up is its item now): the plan's colour, as its block and marks.
    return this.pr.plan?.items?.some((x) => x.path === path) ? this.prMarkDot(planColor(t)) : null;
  },

  // A file's mark. No tooltip: the file list is a virtual list, whose rows take no handlers.
  prMarkDot(c) { return div().size(6).flex_none().rounded(3).bg(c); },

  // A finding: its file selected, its line in the middle of the diff.
  gotoFinding(i, cx) {
    const f = this.pr ? this.prFindings()[i] : null;
    if (!f) return;
    this.pr.fAt = i; this.pr.lAt = -1; this.pr.tAt = -1; this.pr.dAt = -1; this.pr.pAt = -1;
    this.pr.range = { path: f.path, from: f.line, to: f.end_line ?? f.line };
    this.prRenote(); // the one reached unfolds
    this.gotoLine(f.path, f.line, cx);
  },

  // A place under "Where to spend your time", as a finding.
  gotoLook(i, cx) {
    const l = this.prLooks()[i];
    if (!l) return;
    this.pr.lAt = i; this.pr.fAt = -1; this.pr.tAt = -1; this.pr.dAt = -1; this.pr.pAt = -1;
    this.pr.range = { path: l.path, from: l.line, to: l.end_line ?? l.line };
    this.prRenote();
    this.gotoLine(l.path, l.line, cx);
  },

  // An open review thread, as a finding.
  gotoThread(i, cx) {
    const x = this.pr.threads?.[i];
    if (!x) return;
    this.pr.tAt = i; this.pr.fAt = -1; this.pr.lAt = -1; this.pr.dAt = -1; this.pr.pAt = -1;
    this.pr.range = { path: x.path, from: x.line, to: x.line };
    this.prRenote();
    this.gotoLine(x.path, x.line, cx);
  },

  // ---------- open review threads on GitHub (gh), read once a PR is open: in the notes, the diff and the path

  prLoadThreads(cx) {
    const pr = this.pr, k = parseKey(pr?.key);
    if (pr?.status !== "ready" || pr.threadsAsked || !k) return;
    pr.threadsAsked = true;
    cx.spawn(async (cx) => {
      const r = await exec("gh", ["api", "graphql", "-F", `owner=${k.owner}`, "-F", `name=${k.repo}`, "-F", `n=${k.n}`, "-f", `query=${THREADS_QUERY}`], { cwd: pr.root, on: pr.on ?? null, timeout: 20000 }).catch(() => null);
      let data = null;
      try { data = r?.code === 0 ? JSON.parse(r.stdout) : null; } catch { data = null; }
      if (this.pr !== pr) return;
      const got = data ? reviewThreads(data) : { open: [], resolved: [] };
      pr.threads = got.open; pr.resolvedThreads = got.resolved;
      if (!data) pr.threadsError = "Couldn't read the review threads (gh api).";
      this.prRenote(); cx.notify();
    });
  },

  prThreadsList(t, mono) {
    const xs = this.pr.threads ?? [], done = this.pr.resolvedThreads ?? [], open = Boolean(this.pr.showResolved);
    if (!xs.length && !done.length) return null;
    return v_flex().pt(8).gap(6)
      .when(xs.length > 0, (e) => e.child(div().text_size(10.5).font_semibold().text_color(t.muted).child(`OPEN THREADS ${xs.length} · ⇧R resolves the one reached`))
        .children(xs.map((x, i) => this.prThreadCard(t, mono, x, i))))
      .when(done.length > 0, (e) => e.child(div().id("pr-resolved").pt(2).text_size(10.5).font_semibold().text_color(t.dim).cursor_pointer().hover((h) => h.text_color(t.foreground))
          .on_click((_e, cx) => { this.pr.showResolved = !open; cx.notify(); }).child(`RESOLVED ${done.length} ${open ? "▾" : "▸"}`))
        .when(open, (el) => el.children(done.map((x, i) => this.prResolvedRow(t, mono, x, i)))));
  },

  // A small button on a card (its click isn't the card's).
  prCardButton(t, id, label, tip, go) {
    return div().id(id).flex_none().px(6).h(20).flex().items_center().rounded(4).border_1().border_color(t.border).text_size(10.5).text_color(t.foreground)
      .cursor_pointer().hover((e) => e.bg(t.background)).tooltip(tipText(tip)).on_click((_e, cx) => { cx.stop_propagation(); go(cx); }).child(label);
  },

  // A resolved thread: one line, and Unresolve.
  prResolvedRow(t, mono, x, i) {
    return h_flex().id(`pr-thr-${i}`).px(8).py(3).gap(6).items_center().rounded(6).bg(alpha(t.foreground, "05"))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(x.comments[0].who))
      .child(this.prPlace(t, mono, x.path, x.line, null, (cx) => this.gotoLine(x.path, x.line, cx)))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(x.comments[0].text))
      .child(this.prCardButton(t, `pr-unres-${i}`, x.busy ? "…" : "Unresolve", "Open the thread again on GitHub", (cx) => this.prResolve(x, false, cx)));
  },

  // A thread: who started it and where; its first comment; reached (n N, a click), the whole conversation.
  prThreadCard(t, mono, x, i) {
    // Reached and on a line of the diff: read there, the card stays short; elsewhere the card has it all.
    const here = i === this.pr.tAt, whole = here && !this.prInDiff(x.path, x.line), c = t.ansi5 ?? t.accent, [first, ...replies] = x.comments;
    return v_flex().id(`pr-th-${i}`).px(8).py(6).gap(4).rounded(6).border_l(2).border_color(c)
      .bg(here ? t.hover : alpha(t.foreground, "08")).cursor_pointer().hover((e) => e.bg(t.hover))
      .on_click((_e, cx) => this.gotoThread(i, cx))
      .child(h_flex().gap(6).items_center()
        .child(div().flex_none().text_size(11).font_semibold().text_color(c).child(first.who))
        .child(this.prPlace(t, mono, x.path, x.line, null, (cx) => this.gotoThread(i, cx)))
        .when(x.outdated, (e) => e.child(div().flex_none().text_size(10.5).text_color(t.dim).child("outdated")))
        .child(div().flex_1())
        .when(replies.length > 0, (e) => e.child(div().flex_none().text_size(10.5).text_color(t.dim).child(`${replies.length} repl${replies.length === 1 ? "y" : "ies"}`)))
        .child(this.prCardButton(t, `pr-res-${i}`, x.busy ? "…" : "Resolve", "Resolve the thread on GitHub (⇧R on the one reached)", (cx) => this.prResolve(x, true, cx))))
      .child(div().w_full().text_size(12).text_color(t.foreground).when(!whole, (e) => e.max_h(54).overflow_hidden()).child(first.text))
      .when(whole, (e) => e.children(replies.map((r) => h_flex().gap(6).items_start()
        .child(div().flex_none().text_size(11).font_semibold().text_color(c).child(r.who))
        .child(div().flex_1().min_w(0).text_size(11.5).text_color(t.muted).child(r.text)))));
  },

  // Is a place shown in the PR's diff: its file changed and the line within git's context (3 lines) of a change?
  // There the diff's note is where its text is read whole; elsewhere the card shows it, with the code.
  prInDiff(path, line) {
    const files = this.details?.orig?.files ?? this.details?.files ?? [];
    if (!line || !files.some((f) => f.path === path)) return false;
    const ch = this.pr.code?.get(path)?.changed;
    if (!ch) return true; // not read yet: the diff has the file
    for (let n = line - 3; n <= line + 3; n++) if (ch.has(n)) return true;
    return false;
  },

  // ⇧R or the card's button: resolve the thread on GitHub (or unresolve a resolved one), then move it across.
  prResolve(x, resolve, cx) {
    const pr = this.pr;
    if (!x?.id || x.busy) return;
    x.busy = true; cx.notify();
    cx.spawn(async (cx) => {
      const r = await exec("gh", ["api", "graphql", "-f", `query=${resolveQuery(resolve)}`, "-f", `id=${x.id}`], { cwd: pr.root, on: pr.on ?? null, timeout: 20000 }).catch((e) => ({ code: -1, stderr: String(e) }));
      x.busy = false;
      if (this.pr !== pr) return;
      if (r.code !== 0) {
        notify({ title: `Couldn't ${resolve ? "resolve" : "unresolve"} the thread`, body: (r.stderr || r.stdout || "").trim().split("\n").pop(), level: "error", timeout: 10000 });
        cx.notify(); return;
      }
      const from = resolve ? pr.threads : pr.resolvedThreads, to = resolve ? (pr.resolvedThreads ??= []) : (pr.threads ??= []);
      const at = from.indexOf(x);
      if (at >= 0) from.splice(at, 1);
      to.push(x); x.resolved = resolve;
      pr.tAt = -1; // indices moved
      notify({ title: `${resolve ? "Resolved" : "Unresolved"} ${x.comments[0].who}'s thread on ${x.path.split("/").pop()}${x.line ? `:${x.line}` : ""}`, level: "success", timeout: 4000 });
      this.prShape(); this.prRenote(); cx.notify();
    });
  },

  // Is a row of the diff (or the whole file) in the range of the note reached? Marked as a GitHub line link is.
  prMarked(row) {
    const r = this.pr?.range;
    return Boolean(r && row.number && row.kind !== "-" && this.diff?.path === r.path && row.number >= r.from && row.number <= r.to);
  },

  // The diff's notes again, after the one reached changed.
  prRenote() { if (this.diff?.raw) this.diff.rows = this.diffView(this.diff); },

  // ---------- one reading path: the findings and the places to look at, in the file list's order, then by line
  // (a finding before a place on the same line); n N go through them

  prStops() {
    return readingPath(this.prFindings(), this.prLooks(), (this.details?.files ?? []).map((f) => f.path), this.pr.threads ?? [], this.prDraftComments(), this.pr.plan?.items ?? []);
  },

  // The stop reached: its index in prStops(), or -1.
  prStopAt(stops = this.prStops()) {
    return stops.findIndex((x) => x.i === (x.kind === "f" ? this.pr.fAt : x.kind === "l" ? this.pr.lAt : x.kind === "d" ? this.pr.dAt : x.kind === "p" ? this.pr.pAt : this.pr.tAt));
  },

  prStepStop(d, cx) {
    const stops = this.prStops(), n = stops.length;
    if (!n) return;
    const at = this.prStopAt(stops), next = stops[at < 0 ? (d > 0 ? 0 : n - 1) : (at + d + n) % n];
    if (next.kind === "f") this.gotoFinding(next.i, cx); else if (next.kind === "l") this.gotoLook(next.i, cx); else if (next.kind === "d") this.gotoDraft(next.i, cx);
    else if (next.kind === "p") this.gotoPlan(next.i, cx); else this.gotoThread(next.i, cx);
  },

  // After a diff is drawn: the finding asked for, in the middle of the view.
  prJump(cx) {
    const j = this.pr?.jump, rows = this.diff?.rows;
    if (!j || !rows || this.diff.path !== j.path) return;
    this.pr.jump = null;
    const cur = rows.findIndex((r) => r.kind === "F" && r.cur && r.line === j.line), at = cur >= 0 ? cur : rows.findIndex((r) => r.kind === "F" && r.line === j.line);
    const i = at >= 0 ? at : Math.max(0, rows.findIndex((r) => r.kind !== "-" && r.number === j.line));
    this.diffAt = i;
    // A note heading a range: near the top, so as much of the range as fits is below it; else in the middle.
    const range = this.pr?.range, long = range && range.to > range.from;
    // ("top" brings a row to the nearer edge, the bottom when scrolling down: the row half a view further down is
    // centred instead, which leaves the note two rows from the top.)
    const half = Math.floor((this.detailsHeight() - 32) / DIFF_ROW / 2);
    const to = long ? Math.min(rows.length - 1, i - 2 + half) : i;
    cx.timer.after(0, () => this.diffScroll.scroll_to_item(to, "center"));
  },

  // The diff's rows with each finding and place to look at under its line (and those whose line isn't shown, at the
  // top). The one reached shows whole, wrapped to the diff's width: a finding's title and fix, a place's why.
  prDiffRows(path, rows) {
    if (!this.prReviewing()) return rows;
    const notes = [
      ...this.prFindings().map((f, i) => ({ f, i })).filter(({ f }) => f.path === path)
        .map(({ f, i }) => ({ line: f.line, end: f.end_line, head: `${f.id} ${f.severity}: ${f.title}`, fix: f.fix, severity: f.severity, cur: i === this.pr.fAt })),
      ...this.prLooks().map((l, i) => ({ l, i })).filter(({ l }) => l.path === path)
        .map(({ l, i }) => ({ line: l.line, end: l.end_line, head: `Look here${l.end_line && l.end_line > l.line ? ` (lines ${l.line}–${l.end_line})` : ""}: ${l.why}`, severity: "look", cur: i === this.pr.lAt })),
      ...(this.pr.threads ?? []).map((x, i) => ({ x, i })).filter(({ x }) => x.path === path)
        .map(({ x, i }) => ({ line: x.line, head: `${x.comments[0].who}${x.outdated ? " (outdated)" : ""}: ${x.comments[0].text}${x.comments.length > 1 ? `  · ${x.comments.length - 1} more` : ""}`,
          replies: x.comments.slice(1).map((c) => `${c.who}: ${c.text}`), severity: "thread", cur: i === this.pr.tAt })),
      // The draft's comments, as GitHub will show them: on the new side's line, or a removed line's (LEFT).
      ...this.prDraftComments().map((x, i) => ({ x, i })).filter(({ x }) => x.path === path)
        .map(({ x, i }) => ({ line: x.line, end: x.end, side: x.side, head: `Draft${x.finding ? ` ${x.finding}` : ""}${x.end ? ` (lines ${x.line}–${x.end})` : ""}${x.side === "LEFT" ? " (old side)" : ""}: ${x.body}`, severity: "draft", cur: i === this.pr.dAt })),
      // The fix plan's items, saying they're the plan's: its id in the gutter, then "fix plan", the verdict and the
      // point; reached, how the finding it takes up is fixed, the reply it gets, how a fix is proven.
      ...(this.pr.plan?.items ?? []).map((x, i) => ({ x, i })).filter(({ x }) => x.path === path)
        .map(({ x, i }) => { const f = x.kind === "finding" ? this.pr.findings.find((y) => y.id === x.id) : null;
          return { line: x.line, end: x.end_line, tag: x.id, head: `Fix plan · ${x.verdict}${x.duplicate_of ? ` of ${x.duplicate_of}` : ""}${x.severity ? ` · ${x.severity}` : ""}: ${x.text}`,
            fix: x.verdict === "fix" ? f?.fix : null,
            replies: [x.verdict === "fix" && x.proof ? `proof: ${x.proof}` : null, x.reply ? `reply: ${x.reply}` : null].filter(Boolean),
            severity: "plan", cur: i === this.pr.pAt }; }),
    ];
    if (!notes.length) return rows;
    const out = [...rows], loose = [];
    const chars = Math.max(40, Math.floor(((this.width ?? 900) - this.filesWidth() - 80) / 6.6));
    for (const n of notes.sort((a, b) => (b.line ?? 0) - (a.line ?? 0))) {
      const i = out.findIndex((r) => (n.side === "LEFT" ? r.kind === "-" : r.kind !== "-") && r.kind !== "F" && r.number === n.line), where = i >= 0 ? "" : `  (line ${n.line ?? "?"}${n.side === "LEFT" ? " of the old side" : ""} isn't in the diff)`;
      const base = { kind: "F", line: n.line, severity: n.severity, tag: n.tag };
      const note = !n.cur ? [{ ...base, text: `${n.head}${where}` }]
        : [...wrapText(`${n.head}${where}`, chars).map((text, k) => ({ ...base, text, more: k > 0, cur: true })),
          ...(n.fix ? wrapText(`Fix: ${n.fix}`, chars).map((text) => ({ ...base, text, more: true, fix: true, cur: true })) : []),
          ...(n.replies ?? []).flatMap((r) => wrapText(r, chars).map((text) => ({ ...base, text, more: true, fix: true, cur: true })))];
      // A note on several lines heads them (above the first, as the highlight starts there); one on a line goes
      // under it, as GitHub puts a comment. Notes on one line keep their order (findings first).
      if (i < 0) loose.push(...note);
      else if (n.end && n.end > n.line) { let j = i; while (j > 0 && out[j - 1].kind === "r") j--; out.splice(j, 0, ...note.map((x) => ({ ...x, above: true }))); }
      else { let j = i + 1; while (out[j]?.kind === "F" && out[j].line === n.line) j++; out.splice(j, 0, ...note); }
    }
    return [...loose, ...out];
  },

  prDiffNote(r, t) {
    const c = r.severity === "look" ? t.accent : r.severity === "thread" ? t.ansi5 ?? t.accent : r.severity === "draft" ? draftColor(t) : r.severity === "plan" ? planColor(t) : sevColor(t, r.severity);
    return h_flex().w_full().h(20).flex_none().gap(8).bg(alpha(c, r.cur ? "30" : "1c")).border_l(2).border_color(c)
      .child(div().w(40).flex_none().text_right().pr(6).text_color(c).when(Boolean(r.tag), (e) => e.font_semibold()).child(r.more ? "" : r.tag ?? "◀"))
      .child(div().flex_1().min_w(0).truncate().text_color(r.fix ? t.muted : t.foreground).child(r.text));
  },

  // The diff's title bar, on the right: which stop of the reading path is on screen.
  prDiffStop(t) {
    if (!this.prReviewing()) return null;
    const stops = this.prStops(), at = this.prStopAt(stops);
    if (!stops.length) return null;
    return div().flex_none().text_size(11).text_color(at >= 0 ? t.accent : t.dim).tooltip(tipText("The findings, the fix plan's items, the draft's comments, the places to look at and the open threads, in the files' order (n N)"))
      .child(at >= 0 ? `stop ${at + 1} of ${stops.length} · n N` : `${stops.length} stops · n`);
  },

  // ---------- the graph folded to one line on a straight PR (graphfold): z shows it again (remembered)

  prFolded() {
    return Boolean(this.prMode() && this.pr.straight && this.selected && shared("git-graph.pr-graph-open") !== true);
  },

  toggleGraphFold(cx) {
    setShared("git-graph.pr-graph-open", shared("git-graph.pr-graph-open") !== true);
    this.keepCursorVisible(cx); cx.notify();
  },

  // The line the graph folds to: which commit is reviewed, and how to step or unfold.
  prFoldLine(t, mono) {
    const pr = this.pr, i = this.index.get(this.selected), c = this.commits[i], n = pr.ahead ?? 0;
    const what = this.selected === pr.head ? `${count(n, "commit")} on ${pr.headRef ?? "the branch"}, one after another: the whole PR below`
      : i < n ? `commit ${i + 1} of ${n} · ${c?.hash.slice(0, 8) ?? ""} ${c?.subject ?? ""}`
      : `${c?.hash.slice(0, 8) ?? ""} ${c?.subject ?? ""} · on ${pr.baseRef ?? "the base"}, before the PR`;
    return h_flex().id("pr-fold").h(30).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border).cursor_pointer()
      .hover((e) => e.bg(t.hover)).on_click((_e, cx) => this.toggleGraphFold(cx)).tooltip(tipText("Show the graph (z)"))
      .child(div().flex_none().text_size(11).text_color(t.dim).child("▸"))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(what))
      .child(div().flex_none().text_size(11).text_color(t.dim).child("J K step · z the graph"));
  },

  // ---------- the file list in the PR view: what the notes point at first, the noise folded (filenoise)

  // The review's files in that order (again when what the notes point at changed); the list as git gave it is
  // kept in details.orig.
  prShape() {
    const d = this.details;
    if (!d?.files?.length || !this.prReviewing()) return;
    const pr = this.pr, hot = new Set([...pr.findings.map((f) => f.path), ...this.prLooks().map((l) => l.path), ...(pr.threads ?? []).map((x) => x.path), ...this.prDraftComments().map((x) => x.path),
      ...(pr.plan?.items ?? []).filter((x) => x.path).map((x) => x.path)]);
    const key = `${[...hot].join("\0")}\0${Boolean(pr.unfolded)}`, orig = d.orig ?? d;
    if (d.shapedKey === key) return;
    const { files, noise } = shapeFiles(orig.files, hot, !pr.unfolded);
    this.details = { ...orig, files, noise, orig, shapedKey: key };
  },

  // The folded row opened: its files at the end of the list, the selection on the first of them.
  prUnfold(cx) {
    const at = this.details?.files?.findIndex((f) => f.fold) ?? -1;
    this.pr.unfolded = true; this.prShape();
    if (at >= 0) { this.fileAt = at; this.fileScroll.scroll_to_item(at); }
    cx.notify();
  },

  // The folded row in the file list.
  prFoldRow(f, t) {
    const kinds = Object.entries(f.kinds).map(([k, n]) => `${n} ${k}`).join(", ");
    return h_flex().flex_1().min_w(0).gap(8).items_center()
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`▸ ${f.count} more: ${kinds}`))
      .when(f.add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`)))
      .when(f.del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`)));
  },

  // ---------- files you've viewed: marked (m) with the version of the file then; a file changed since comes back

  // The file's version at the PR's head for each changed file (blob ids; "-" where the head has none), read once
  // per file list.
  prLoadBlobs(cx) {
    const pr = this.pr, files = this.details?.orig?.files ?? this.details?.files;
    if (!this.prReviewing() || !files?.length || pr.blobsFor === files) return;
    pr.blobsFor = files;
    const paths = files.map((f) => f.path);
    cx.spawn(async (cx) => {
      const r = await exec("git", [...READ, "ls-tree", "-r", "-z", pr.head, "--", ...paths], { cwd: pr.root, on: pr.on ?? null }).catch(() => null);
      if (this.pr !== pr || r?.code !== 0) return;
      pr.blobs = blobsOf(r.stdout, paths);
      cx.notify();
    });
  },

  prViewedOf() { return (shared(VIEWED) ?? {})[this.pr.key]?.files ?? {}; },

  // Viewed: marked, and the file is still the version it was then.
  prViewed(path) {
    const blob = this.pr?.blobs?.get(path);
    return blob !== undefined && this.prViewedOf()[path] === blob;
  },

  // m: the selected file viewed (and on to the next one not viewed), or not viewed again.
  prMarkViewed(cx) {
    const files = this.details?.files ?? [], f = files[this.fileAt ?? 0];
    if (!f || f.fold || !this.pr.blobs) return;
    const all = { ...(shared(VIEWED) ?? {}) }, mine = { ...this.prViewedOf() }, was = this.prViewed(f.path);
    if (was) delete mine[f.path]; else mine[f.path] = this.pr.blobs.get(f.path);
    all[this.pr.key] = { at: Date.now(), files: mine };
    // The PRs looked at last are kept (VIEWED_KEEP), not every PR ever opened.
    setShared(VIEWED, Object.fromEntries(Object.entries(all).sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0)).slice(0, VIEWED_KEEP)));
    if (!was) {
      const next = files.findIndex((x, i) => i > this.fileAt && !x.fold && !this.prViewed(x.path));
      if (next >= 0) { this.fileAt = next; this.fileScroll.scroll_to_item(next); }
    }
    cx.notify();
  },

  // The files' count line, in the PR view: how many of them you've viewed.
  prViewedCount(t) {
    const files = this.details?.orig?.files ?? this.details?.files ?? [];
    if (!this.prReviewing() || !this.pr.blobs || !files.length) return null;
    const n = files.filter((f) => this.prViewed(f.path)).length;
    return div().flex_none().text_size(11).text_color(n === files.length ? t.ansi2 : t.dim).tooltip(tipText("Files you've viewed (m marks the selected one); one changed since comes back"))
      .child(`${n}/${files.length} viewed`);
  },

  // A file's ✓ in the list (m marks or unmarks it). Only drawn: a row of a virtual list takes no handlers.
  prViewedMark(path, i, t) {
    if (!this.prReviewing() || path === FOLD) return null;
    const on = this.prViewed(path);
    return div().w(14).flex_none().text_size(11).text_color(on ? t.ansi2 : t.border).child(on ? "✓" : "○");
  },

  // ---------- keys

  // p the picker, ⇧L the list, n N the reading path, m viewed, ⌘↑ ⌘↓ PRs, t its tab, the bar's ⏎ / Esc while it asks. True when handled.
  prKey(e, cx) {
    if (!this.pr) return false;
    const k = e.keystroke;
    // The plain graph with a tracked PR's notes: only the review's keys.
    if (this.pr.lite) {
      if ((k === "n" || k === "shift-n") && !this.search.query && this.prReviewing() && this.prStops().length) { this.prStepStop(k === "n" ? 1 : -1, cx); return true; }
      if (k === "m" && this.zone === "files" && this.prReviewing()) { this.prMarkViewed(cx); return true; }
      if (k === "shift-r" && this.pr.tAt >= 0 && this.pr.threads?.[this.pr.tAt]) { this.prResolve(this.pr.threads[this.pr.tAt], true, cx); return true; }
      if (["enter", "space", "l", "right"].includes(k) && this.zone === "files" && this.details?.files?.[this.fileAt]?.fold) { this.prUnfold(cx); return true; }
      return false;
    }
    if (this.prPick) { this.prPickKey(e, cx); return true; } // the picker has the keyboard while it's open
    // The fix plan's text box has the keyboard while it's focused: esc gives it back.
    if (this.planTyping) { if (k === "escape") this.handle.focus(); return true; }
    // An item's verdict row (⏎ on a plan item): f w a u s type that verdict into the session; esc closes it.
    if (this.pr.planRow && !this.pr.confirm) {
      const v = PLAN_VERDICTS.find(([key]) => key === k);
      if (v) { this.prPlanSend(planWords(this.pr.planRow, v[1]), cx, this.pr.planRow); return true; }
      if (k === "escape") { this.pr.planRow = null; return true; }
    }
    if (this.pr.confirm && (k === "enter" || k === "escape")) {
      if (k === "enter") this.prConfirmed(cx); else { this.pr.confirm = null; cx.notify(); }
      return true;
    }
    // The fix plan: ⏎ on an item opens its verdict row; ⌘⏎ go (asks first).
    if (planOpen(this.pr.plan) && k === "enter" && this.pr.pAt >= 0 && !this.pr.confirm) { this.prPlanRow(this.pr.plan.items[this.pr.pAt]?.id, cx); return true; }
    if (planOpen(this.pr.plan) && k === "cmd-enter") { this.prPlanGo(cx); return true; }
    // The draft: ⌘⏎ post it (asks first), y copy it, ⇧V the next version.
    if (this.pr.draft && k === "cmd-enter") { this.prDraftAsk("post", cx); return true; }
    if (this.pr.draft && k === "y" && !this.search.typing) { this.prDraftCopy(cx); return true; }
    if (this.pr.draft && k === "shift-v") { this.prDraftStep(cx); return true; }
    if (k === "cmd-down" || k === "cmd-up") { this.prStep(k === "cmd-down" ? 1 : -1, cx); return true; }
    if (k === "p" && !this.search.typing) { this.openPrPick(cx); return true; }
    if (k === "shift-l") { this.toggleRail(cx); return true; }
    if ((k === "n" || k === "shift-n") && !this.search.query && this.prReviewing() && this.prStops().length) { this.prStepStop(k === "n" ? 1 : -1, cx); return true; }
    if (k === "m" && this.zone === "files" && this.prReviewing()) { this.prMarkViewed(cx); return true; }
    if (k === "shift-r" && this.pr.tAt >= 0 && this.pr.threads?.[this.pr.tAt]) { this.prResolve(this.pr.threads[this.pr.tAt], true, cx); return true; }
    if (k === "z" && this.prMode() && this.pr.straight) { this.toggleGraphFold(cx); return true; }
    if (["enter", "space", "l", "right"].includes(k) && this.zone === "files" && this.details?.files?.[this.fileAt]?.fold) { this.prUnfold(cx); return true; }
    if (k === "t" && this.zone !== "files") { showPrTab(this.pr.key); return true; }
    if (k === "c" && this.prReviewing()) { this.toggleSinceReview(cx); return true; }
    // esc with nothing else open: out of the PR view, to the plain graph of the repository.
    if (k === "escape" && !this.picking && !this.help) { this.prExit(cx); return true; }
    return false;
  },

  // ---------- the stage of a branch's PR, in every graph

  // owner/repo of the graph's repository (origin on GitHub), read once per repository.
  prSlug(cx) {
    if (!this.root || this.on) return null;
    this.slugs ??= new Map();
    if (!this.slugs.has(this.root)) {
      const root = this.root;
      this.slugs.set(root, null);
      cx?.spawn?.(async (cx) => {
        const r = await exec("git", [...READ, "remote", "get-url", "origin"], { cwd: root }).catch(() => null);
        const m = /github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/.exec(r?.stdout?.trim() ?? "");
        this.slugs.set(root, m ? m[1] : null);
        if (m) cx.notify();
      });
    }
    return this.slugs.get(this.root);
  },

  // The tracked PRs whose branch points at this commit: [{ row, branch }].
  prsAt(commit) {
    const slug = this.slugs?.get(this.root);
    if (!slug || commit.uncommitted) return [];
    // A local branch by its name, a remote one (origin/x) by the branch it is.
    const names = new Set((commit.refs ?? []).flatMap((r) => (r.kind === "branch" ? [r.name] : r.kind === "remote" ? [r.name.split("/").slice(1).join("/")] : [])));
    if (!names.size) return [];
    return this.prQueueRows().filter((r) => r.key.startsWith(`${slug}#`) && r.rec?.headRef && names.has(r.rec.headRef));
  },

  // The PR chips of a commit row: [{ r, n, stage, width, url }]. A click on one opens the PR on GitHub (table.js clicked).
  prChipsAt(commit) {
    const web = this.webBase();
    return this.prsAt(commit).map((r) => {
      // In the pane's words: your move's action, else "waiting", "later", "dormant".
      const [grp, what] = moveOf(r), stage = grp === "you" ? what.toLowerCase() : grp, n = r.key.split("#")[1];
      return { r, n, stage, grp, width: chipWidth(n, stage), url: r.url || (web ? prUrl(web, n) : null) };
    });
  },

  prChips(commit, t, mono) {
    return this.prChipsAt(commit).map(({ r, n, stage, grp, width, url }) => {
      // In the pane's colours: red for a problem, else the accent for your move, muted for the rest.
      const c = grp !== "you" ? t.muted : nextStep(r).problem ? t.ansi1 : t.accent;
      return h_flex().w(width).flex_none().h(18).px(CHIP.PAD).gap(CHIP.GAP).items_center().rounded(5).bg(alpha(c, "22")).overflow_hidden()
        .when(Boolean(url), (e) => e.cursor_pointer().hover((st) => st.bg(alpha(c, "44"))))
        .child(div().flex_none().font_family(mono).text_size(CHIP.FONT).text_color(c).child(`#${n}`))
        .child(div().min_w(0).truncate().font_family(mono).text_size(CHIP.FONT).text_color(c).child(stage));
    });
  },

  // https://github.com/owner/repo of the graph's repository, once prSlug has read origin; else null.
  webBase() {
    const slug = this.slugs?.get(this.root);
    return slug ? `https://github.com/${slug}` : null;
  },

  // p: the PR view of the cursor row's PR: this dialog becomes it (a docked graph opens it as a dialog).
  openCursorPr(cx) {
    const commit = this.commits?.[this.cursorIndex()];
    const r = commit ? this.prsAt(commit)[0] : null;
    if (r && this.dialog && cx) this.prEnter(r.key, cx);
    else if (r) openPrView(r.key);
    else notify({ title: "No tracked PR here", body: "p opens the PR view of a branch pr-flow tracks a PR for.", level: "info", timeout: 3000 });
  },
};
