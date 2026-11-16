// The PR view: the graph as a dialog on a pull request pr-flow tracks (props.pr = "owner/repo#n", opened from
// pr-board, ⌘⌥R or a PR badge). pr-board's queue on the left, a bar with the PR and what you can do, and the
// review of the PR's range (base…head in your checkout) with pr-flow's findings: listed above the files,
// marked in the file list, and shown under their line in the diff. Mixed into Graph.
// Also, in every graph: a branch with a tracked PR carries its pr-flow stage, and `p` opens its PR view.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, notify, props, shared, setShared, openOverlay } from "herdr";
import { OPEN_PR, VIEW_OPEN, lastQueue, readQueue, queueRows, showPr, findingsOf, prRange, verbsFor, doVerb, ASK_FIRST, showPrTab, prTab, tabName, openPrView, parseKey } from "./lib/prflow.js";
import { prRow, sevColor, SEVERITIES, findingsBadge, ciGlyph, alpha, numWidth } from "./lib/prrows.js";
import { READ } from "./git.js";
import { actionsFor, arrange, moveOf, nextStep, GROUPS } from "./lib/prmodel.js";
import { tipText } from "./lib/tiptext.js";
import { PAGE, VIEWER_CLOSED } from "./common.js";

const RAIL = 210;
const bySeverity = (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity);

export const PrMethods = {
  prInit(cx) {
    const key = props()?.pr;
    if (!key) return;
    this.pr = { key, status: "loading", findings: [] };
    { const v = Number(shared("git-graph.notes-height")); this.notesSplit = v > 0 ? v : null; }
    { const v = Number(shared("git-graph.pr-list-width")); this.railSplit = v > 0 ? v : null; }
    // Say this PR view is open (see openPrView), and take the PRs asked for from then on.
    this.prViewId = Math.random().toString(36).slice(2);
    this.prAsked = shared(OPEN_PR)?.at ?? 0;
    const beat = () => setShared(VIEW_OPEN, { id: this.prViewId, at: Date.now() });
    beat(); cx.timer.every(10000, beat);
    if (!lastQueue()) cx.spawn(async (cx) => { await readQueue(); cx.notify(); });
    this.loadPr(key, cx);
  },

  // Opens a PR: its record (branches, head), its range in your checkout (fetched when needed) and its
  // findings; then the graph moves to that repository and opens the review on the range.
  loadPr(key, cx) {
    const pr = this.pr = { key, status: "loading", findings: [], fAt: -1 };
    this.selected = null; this.details = null; this.diff = null; this.zone = "graph";
    cx.spawn(async (cx) => {
      const record = await showPr(key);
      if (this.pr !== pr) return;
      const s = record?.snapshot;
      const rec = s ? { headRef: s.headRef, baseRef: s.baseRef, headSha: s.headSha } : lastQueue()?.records?.[key] ?? null;
      pr.record = record; pr.headRef = rec?.headRef; pr.baseRef = rec?.baseRef;
      const [range, findings] = await Promise.all([prRange(key, rec), findingsOf(key)]);
      if (this.pr !== pr) return;
      if (range.error) { pr.status = "error"; pr.error = range.error; this.state = "prerror"; cx.notify(); return; }
      pr.status = "ready"; pr.root = range.root; pr.head = range.head; pr.base = range.base; pr.baseName = range.baseName;
      const git = (args) => exec("git", [...READ, ...args], { cwd: range.root }).catch(() => ({ code: -1, stdout: "" }));
      // The header's ahead/behind: the PR's head against its base.
      if (range.base) {
        const lr = await git(["rev-list", "--left-right", "--count", `${range.base}...${range.head}`]);
        const [behind, ahead] = lr.code === 0 ? lr.stdout.trim().split(/\s+/).map(Number) : [];
        pr.ahead = ahead; pr.behind = behind;
      }
      // Your last review's commit, for "Since my review" (gone after a force-push: then no such mode).
      const reviewed = record?.role === "author" ? record?.last_checked_sha : record?.last_reviewed_sha;
      if (reviewed && reviewed !== range.head && (await git(["merge-base", "--is-ancestor", reviewed, range.head])).code === 0) {
        const n = await git(["rev-list", "--count", `${reviewed}..${range.head}`]);
        pr.reviewed = reviewed; pr.newCommits = Number(n.stdout.trim()) || 0;
      }
      if (this.pr !== pr) return;
      pr.findings = findings.filter((f) => !f.status || f.status === "open" || f.status === "partial").sort(bySeverity);
      this.folder = range.root;
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
    if (pr?.status !== "ready") return null;
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
    const rec = this.pr.record ?? {}, th = rec.snapshot?.threads, e = rec.explainer;
    const head = (text) => div().pt(8).pb(1).text_size(10.5).font_semibold().text_color(t.muted).child(text);
    const facts = [
      ...(rec.reasons ?? []),
      th?.unresolved ? `${th.unresolved} open thread${th.unresolved === 1 ? "" : "s"}${th.awaitingReviewer ? `, ${th.awaitingReviewer} waiting on you` : th.awaitingAuthor ? `, ${th.awaitingAuthor} on the author` : ""}` : null,
    ].filter(Boolean);
    const stale = e?.sha && e.sha !== this.pr.head ? ` (at ${e.sha.slice(0, 8)})` : "";
    // Most useful first: why it's here, the findings, where to look, then what it changes.
    return v_flex().gap(1)
      .when(facts.length > 0, (el) => el.child(div().w_full().text_size(11.5).text_color(t.foreground).child(facts.join(" · "))))
      .child(this.prFindingsList(t, mono))
      .when(Boolean(e?.look_at?.length), (el) => el.child(head("WHERE TO SPEND YOUR TIME"))
        .children(e.look_at.map((l, i) => this.prEntry(t, `pr-look-${i}`, [
          div().flex_none().max_w(170).truncate().font_family(mono).text_size(11).text_color(t.accent).child(`${l.path.split("/").pop()}:${l.line}${l.end_line ? `-${l.end_line}` : ""}`),
        ], l.why, [l.path], (cx) => this.gotoLine(l.path, l.line, cx)))))
      .when(Boolean(e?.points?.length || e?.text), (el) => el.child(head(`WHAT IT CHANGES${stale}`))
        .children(e.points?.length ? e.points.map((pt, i) => this.prEntry(t, `pr-pt-${i}`, [
          div().flex_none().text_size(11.5).font_semibold().text_color(t.foreground).child(pt.lead),
        ], this.pr.opened?.has(`pr-pt-${i}`) ? "" : pt.text, [pt.text])) : [div().w_full().text_size(11.5).text_color(t.foreground).child(e.text)]));
  },

  // A file and line of the review, as a finding is shown. Not in the diff on screen: under Since my review,
  // back to the whole PR and then there; a file the PR doesn't change, in the file viewer at the PR's head.
  gotoLine(path, line, cx) {
    const files = this.details?.files ?? [], at = files.findIndex((x) => x.path === path);
    if (at < 0 && this.pr.sinceReview) { this.pr.pendingGoto = { path, line }; this.toggleSinceReview(cx); return; }
    if (at < 0) {
      this.viewing = `${Date.now()}`; // the file list takes the keyboard back when the viewer closes (returnFromViewer)
      openOverlay({ mod: "file-browser", kind: "dialog", width: 0.92, height: 0.9,
        props: { folder: this.pr.root, path, rev: /^[0-9a-f]{40}$/.test(this.pr.head) ? this.pr.head : undefined, line, closedKey: VIEWER_CLOSED, closedToken: this.viewing } });
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
    const g = this.pr?.pendingGoto;
    if (g && this.prReviewing() && this.details?.files) { this.pr.pendingGoto = null; cx.timer.after(0, (cx) => this.gotoLine(g.path, g.line, cx)); }
    const want = shared(OPEN_PR);
    if (!this.pr || !want?.at || want.at <= this.prAsked) return;
    this.prAsked = want.at;
    if (want.key !== this.pr.key) cx.timer.after(0, (cx) => this.loadPr(want.key, cx));
  },

  prClose() {
    if (this.prViewId && shared(VIEW_OPEN)?.id === this.prViewId) setShared(VIEW_OPEN, null);
  },

  // refresh() waits for the PR's repository before reading anything.
  prWaiting() {
    if (!this.pr || this.pr.status === "ready") return false;
    this.state = this.pr.status === "error" ? "prerror" : "prloading";
    return true;
  },

  // ---------- the queue on the left

  // The queue as the pane shows it (lib/prmodel.js): Your move by action, Waiting on others, then Later and
  // Dormant folded; the group of the PR shown stays open.
  prRail(t, mono) {
    const q = lastQueue(), out = [], numW = numWidth(queueRows(q)), blocks = arrange(queueRows(q));
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
    const keys = arrange(queueRows(lastQueue())).flatMap((b) => b.rows).map((r) => r.key), at = keys.indexOf(this.pr.key);
    const next = keys[at < 0 ? 0 : Math.max(0, Math.min(keys.length - 1, at + d))];
    if (next && next !== this.pr.key) this.loadPr(next, cx);
  },

  // ---------- the bar: the PR and what you can do

  prRow() { return queueRows(lastQueue()).find((r) => r.key === this.pr?.key) ?? null; },

  prBar(t, mono) {
    const pr = this.pr, r = this.prRow(), k = parseKey(pr.key), rec = r?.rec ?? {};
    const verbs = lastQueue()?.data?.verbs ?? {};
    if (pr.confirm) {
      return h_flex().h(40).flex_none().px(14).gap(10).items_center().bg(t.raised).border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().text_size(12).child(pr.confirm.text))
        .child(this.prButton("pr-yes", `${pr.confirm.verb} ⏎`, true, (_e, cx) => this.prVerb(pr.confirm.verb, cx), t))
        .child(this.prButton("pr-no", "cancel esc", false, (_e, cx) => { pr.confirm = null; cx.notify(); }, t));
    }
    // Where it stands, in the pane's words: the action when it's your move, else on whom it waits.
    const [grp, what] = r ? moveOf(r) : [null, ""], needs = grp === "you", problem = r ? nextStep(r).problem : false;
    const stage = grp === "you" ? what.toLowerCase() : grp === "waiting" ? `waiting on ${what}` : grp ?? "";
    return h_flex().h(40).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().flex_none().font_family(mono).text_size(12.5).font_semibold().text_color(t.accent).child(k?.short ?? pr.key))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).child(r?.title ?? ""))
      .when(Boolean(r?.author), (e) => e.child(div().flex_none().text_size(11.5).text_color(t.dim).child(r.author)))
      .when(Boolean(stage), (e) => e.child(div().flex_none().px(6).rounded(4).text_size(11).bg(alpha(problem ? t.ansi1 : needs ? t.accent : t.muted, "22")).text_color(problem ? t.ansi1 : needs ? t.accent : t.muted).tooltip(tipText(r?.detail ?? "")).child(stage)))
      .when(Boolean(rec.ci), (e) => e.child(ciGlyph(t, rec.ci)))
      .child(findingsBadge(t, rec.open))
      // Only what's possible now (as the pane offers it): the next step first, then its alternatives.
      .when(Boolean(r), (e) => { const a = actionsFor(r); return e.children([a.main, ...a.also].filter(Boolean).map((v, i) => this.prButton(`pr-v-${v}`, v, i === 0, (_e, cx) => this.prVerb(v, cx), t, verbs[v]?.help))); })
      .child(this.prButton("pr-tab", prTab(pr.key) ? "tab ↗" : "tab", false, () => { if (!showPrTab(pr.key)) notify({ title: `${tabName(pr.key)} has no Claude tab yet`, body: "An agent's action (review, fix, …) opens one.", level: "info", timeout: 4000 }); }, t, "Its Claude tab: agent actions run there (t)"))
      .child(this.prButton("pr-gh", "GitHub ↗", false, (_e, cx) => this.prVerb("open", cx), t, r?.url));
  },

  prButton(id, label, primary, go, t, tip) {
    return div().id(id).flex_none().px(8).h(24).flex().items_center().rounded(6).text_size(11.5).cursor_pointer()
      .border_1().border_color(primary ? t.accent : t.border).text_color(primary ? t.accent : t.foreground)
      .hover((e) => e.bg(t.hover)).when(Boolean(tip), (e) => e.tooltip(tipText(tip))).on_click(go).child(label);
  },

  // A verb from the bar, as pr-board runs it: approve and hand back ask first.
  prVerb(verb, cx) {
    const pr = this.pr, r = this.prRow();
    if (!pr) return;
    if (ASK_FIRST.has(verb) && pr.confirm?.verb !== verb) {
      pr.confirm = { verb, text: verb === "approve" ? `Approve ${tabName(pr.key)}? pr-flow checks it's ready first, then approves under your account.` : `Hand ${tabName(pr.key)} back to its author?` };
      cx.notify(); return;
    }
    pr.confirm = null;
    const kind = lastQueue()?.data?.verbs?.[verb]?.kind;
    cx.spawn(async (cx) => {
      const res = await doVerb(verb, pr.key, { url: r?.url, kind });
      notify({ title: res.ok ? res.message : `${verb} ${tabName(pr.key)}: ${res.status ?? "failed"}`, body: res.ok ? "" : res.message, level: res.ok ? "success" : "error", timeout: res.ok ? 5000 : 12000 });
      if (kind !== "agent" && verb !== "open") await readQueue();
      cx.notify();
    });
    cx.notify();
  },

  // ---------- findings in the review

  // Is the review on screen the PR's range (not a commit picked in the graph)?
  prReviewing() {
    const pr = this.pr;
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
    return div().id("graph-rail-split").w(6).flex_none().h_full().cursor_col_resize().flex().justify_center()
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation();
        if (e.click_count >= 2) return this.setRailWidth(null, cx);
        this.railDrag = { x: e.position.x, from: this.railWidth() };
      })
      .child(div().w(1).h_full().bg(this.railDrag ? t.accent : t.border))
      .hover((s) => s.bg(t.hover));
  },

  // ---------- the notes' height: the line under them drags (double-click: back to the default), remembered

  notesHeight() {
    const total = this.detailsHeight() - 32 - 26; // the review's title bar and the files' count line
    const want = this.notesSplit ?? Math.round(total * 0.45);
    return Math.round(Math.max(60, Math.min(want, total - 3 * 24)));
  },

  setNotesHeight(h, cx) {
    this.notesSplit = h === null ? null : Math.round(h);
    setShared("git-graph.notes-height", this.notesSplit);
    cx.notify();
  },

  notesHandle(t) {
    return div().id("graph-notes-split").h(6).flex_none().w_full().cursor_row_resize().flex().items_center()
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation();
        if (e.click_count >= 2) return this.setNotesHeight(null, cx);
        this.notesDrag = { y: e.position.y, from: this.notesHeight() };
      })
      .child(div().h(1).w_full().bg(this.notesDrag ? t.accent : t.border))
      .hover((s) => s.bg(t.hover));
  },

  // One note entry: a line that a click unfolds to its whole text, wrapped (and folds again). `go`: also go
  // somewhere (a finding's or a look-at's lines). `head`: the line's fixed parts; `text`: what unfolds.
  prEntry(t, id, head, summary, more, go) {
    const open = this.pr.opened?.has(id);
    return v_flex().id(id).px(4).py(1).rounded(4).cursor_pointer().when(open, (e) => e.bg(t.hover)).hover((e) => e.bg(t.hover))
      .on_click((_e, cx) => { (this.pr.opened ??= new Set()); if (open) this.pr.opened.delete(id); else this.pr.opened.add(id); go?.(cx); cx.notify(); })
      .child(h_flex().gap(6).items_center().children(head)
        .child(div().flex_1().min_w(0).when(!open, (e) => e.truncate()).text_size(11.5).text_color(t.foreground).child(summary)))
      .when(open && more.length > 0, (e) => e.child(v_flex().pt(2).pb(3).gap(3).children(more.filter(Boolean).map((m) => div().w_full().text_size(11.5).text_color(t.foreground).child(m)))));
  },

  prFindingsList(t, mono) {
    const fs = this.pr.findings;
    if (!fs.length) return div().pt(4).text_size(11.5).text_color(t.dim).child("No open findings from pr-flow.");
    return v_flex().pt(6).gap(1)
      .child(div().pt(2).pb(1).text_size(10.5).font_semibold().text_color(t.muted).child(`FINDINGS · n N · a click opens one`))
      .children(fs.map((f, i) => this.prEntry(t, `pr-f-${f.id}`, [
        div().w(22).flex_none().font_family(mono).text_size(11).text_color(i === this.pr.fAt ? t.accent : t.muted).child(f.id),
        div().w(48).flex_none().text_size(11).text_color(sevColor(t, f.severity)).child(f.severity),
        div().flex_none().max_w(160).truncate().font_family(mono).text_size(11).text_color(t.accent).child(`${(f.path ?? "").split("/").pop()}${f.line ? `:${f.line}` : ""}`),
      ], f.title, [f.fix ? `Fix: ${f.fix}` : null, f.path], (cx) => this.gotoFinding(i, cx))));
  },

  // The file list's mark: the most severe open finding in the file.
  prFileMark(path, t) {
    if (!this.prReviewing()) return null;
    const f = this.pr.findings.filter((x) => x.path === path).sort(bySeverity)[0];
    return f ? div().size(6).flex_none().rounded(3).bg(sevColor(t, f.severity)) : null;
  },

  // A finding: its file selected, its line in the middle of the diff.
  gotoFinding(i, cx) {
    const f = this.pr?.findings?.[i], files = this.details?.files ?? [];
    if (!f) return;
    this.pr.fAt = i;
    this.gotoLine(f.path, f.line, cx);
  },

  // After a diff is drawn: the finding asked for, in the middle of the view.
  prJump(cx) {
    const j = this.pr?.jump, rows = this.diff?.rows;
    if (!j || !rows || this.diff.path !== j.path) return;
    this.pr.jump = null;
    const at = rows.findIndex((r) => r.kind === "F" && r.line === j.line);
    const i = at >= 0 ? at : Math.max(0, rows.findIndex((r) => r.kind !== "-" && r.number === j.line));
    this.diffAt = i;
    cx.timer.after(0, () => this.diffScroll.scroll_to_item(i, "center"));
  },

  // The diff's rows with each finding under its line (and those whose line isn't shown, at the top).
  prDiffRows(path, rows) {
    if (!this.prReviewing()) return rows;
    const fs = this.pr.findings.filter((f) => f.path === path);
    if (!fs.length) return rows;
    const out = [...rows], loose = [];
    for (const f of [...fs].sort((a, b) => (b.line ?? 0) - (a.line ?? 0))) {
      const i = out.findIndex((r) => r.kind !== "-" && r.kind !== "F" && r.number === f.line);
      const note = { kind: "F", line: f.line, text: `${f.id} ${f.severity}: ${f.title}`, severity: f.severity };
      if (i >= 0) out.splice(i + 1, 0, note); else loose.push(note);
    }
    return [...loose.map((n) => ({ ...n, text: `${n.text}  (line ${n.line ?? "?"} isn't in the diff)` })), ...out];
  },

  prDiffNote(r, t) {
    const c = sevColor(t, r.severity);
    return h_flex().w_full().h(20).flex_none().gap(8).bg(alpha(c, "1c")).border_l(2).border_color(c)
      .child(div().w(40).flex_none().text_right().pr(6).text_color(c).child("◀"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).font_family(undefined).child(r.text));
  },

  // ---------- keys

  // n N findings, ⌘↑ ⌘↓ PRs, t its tab, the bar's ⏎ / Esc while it asks. True when handled.
  prKey(e, cx) {
    if (!this.pr) return false;
    const k = e.keystroke;
    if (this.pr.confirm && (k === "enter" || k === "escape")) {
      const c = this.pr.confirm;
      if (k === "enter") this.prVerb(c.verb, cx); else { this.pr.confirm = null; cx.notify(); }
      return true;
    }
    if (k === "cmd-down" || k === "cmd-up") { this.prStep(k === "cmd-down" ? 1 : -1, cx); return true; }
    if ((k === "n" || k === "shift-n") && !this.search.query && this.prReviewing() && this.pr.findings.length) {
      const n = this.pr.findings.length, d = k === "n" ? 1 : -1;
      this.gotoFinding(((this.pr.fAt < 0 ? (d > 0 ? -1 : 0) : this.pr.fAt) + d + n) % n, cx);
      return true;
    }
    if (k === "t" && this.zone !== "files") { showPrTab(this.pr.key); return true; }
    if (k === "c" && this.prReviewing()) { this.toggleSinceReview(cx); return true; }
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
    const slug = this.slugs?.get(this.root), q = lastQueue();
    if (!slug || !q || commit.uncommitted) return [];
    // A local branch by its name, a remote one (origin/x) by the branch it is.
    const names = new Set((commit.refs ?? []).flatMap((r) => (r.kind === "branch" ? [r.name] : r.kind === "remote" ? [r.name.split("/").slice(1).join("/")] : [])));
    return queueRows(q).filter((r) => r.key.startsWith(`${slug}#`) && r.rec?.headRef && names.has(r.rec.headRef));
  },

  prChips(commit, t, mono) {
    return this.prsAt(commit).map((r) => {
      // In the pane's words and colours: your move's action (red for a problem), else "waiting", "later", "dormant".
      const [grp, what] = moveOf(r), stage = grp === "you" ? what.toLowerCase() : grp;
      const c = grp !== "you" ? t.muted : nextStep(r).problem ? t.ansi1 : t.accent;
      return h_flex().flex_none().h(18).px(5).gap(4).items_center().rounded(5).bg(alpha(c, "22"))
        .child(div().font_family(mono).text_size(10.5).text_color(c).child(`#${r.key.split("#")[1]}`))
        .child(div().text_size(10.5).text_color(c).child(stage));
    });
  },

  // p: the PR view of the cursor row's PR.
  openCursorPr() {
    const commit = this.commits?.[this.cursorIndex()];
    const r = commit ? this.prsAt(commit)[0] : null;
    if (r) openPrView(r.key);
    else notify({ title: "No tracked PR here", body: "p opens the PR view of a branch pr-flow tracks a PR for.", level: "info", timeout: 3000 });
  },
};
