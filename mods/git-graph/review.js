// Modified by Jochen Rau, 2026-11, from rabeeh-ta/herdr-git-graph: see NOTICE.md in this folder.
// Reviewing a commit or a range: its files beside their diff, the editor, the diff tool, reset. Mixed into Graph.
import { div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list } from "gpui-base";
import { exec, readTextFile, settings, props, shared, setShared, openOverlay, notify } from "herdr";
import { fileArgs, joinFiles, diffArgs, diffRows, baseCandidates, isBaseBranch, rangeFileArgs, rangeDiffArgs, READ, wrapDiff, ignoringSpace, fileRows } from "./git.js";
import { openDialog, showChanges } from "./act.js";
import { ago, stamp, count, keep, VIEWER_CLOSED, ROW, DIFF_ROW, DETAILS } from "./common.js";
import { exists, background, openInEditor } from "./tools.js";
import { splitter } from "./lib/splitter.js";
import { alpha } from "./lib/prrows.js";

export const ReviewMethods = {
  // Local change: the review's height: dragged or keyed (remembered), else half the dialog (320 in a panel).
  detailsHeight() {
    // Local change: under a folded graph (pr.js), all of the room: header, PR bar, toolbar and the folded line.
    if (this.prFolded()) return Math.max(160, Math.round((this.height ?? 700) - 42 - 40 - 34 - 30));
    const room = this.height ? this.height - 42 - 34 - 24 : 640;
    const want = this.split ?? (this.dialog && this.height ? Math.round(room * 0.5) : 320);
    return Math.round(Math.max(160, Math.min(want, room - 3 * ROW)));
  },

  // Local change: the file list's width: dragged (remembered), else a third of the review;
  // the diff keeps at least 240.
  filesWidth() {
    const width = this.width ?? 900, want = this.filesSplit ?? Math.min(560, Math.max(300, width * 0.34));
    return Math.round(Math.max(200, Math.min(want, width - 240)));
  },

  // The line between files and diff drags (double-click: back to the default).
  setFilesWidth(w, cx) {
    this.filesSplit = w === null ? null : Math.round(w);
    setShared("git-graph.files-width", this.filesSplit);
    cx.notify();
  },

  // The line between graph and review drags (double-click: back to half); - and = from the keyboard.
  setSplit(h, cx) {
    this.split = h === null ? null : Math.round(h);
    // Shared, not localStorage: each dialog opening is a new copy of the mod.
    setShared("git-graph.split", this.split);
    this.keepCursorVisible(cx); cx.notify();
  },

  // The graph shrinks when the pane opens: once it's laid out, centre the cursor row in it.
  keepCursorVisible(cx) {
    cx.timer.after(0, () => { const i = this.cursor ? this.index.get(this.cursor) : undefined; if (i !== undefined) this.scrollHandle.scroll_to_item(i, "center"); });
  },

  loadDetails(commit, cx) {
    const hash = commit.hash, git = (args) => exec("git", [...READ, ...args], { cwd: this.root, on: this.on });
    const since = this.reviewsSince(commit);
    this.detailsSince = since;
    const key = `${this.on}\0${this.root}\0${hash}`, known = !since && !commit.uncommitted && this.commitDetails.get(key);
    if (known) { this.details = known; return; }
    const current = () => this.selected === hash && this.reviewsSince(commit) === since;
    cx.spawn(async (cx) => {
      try {
        let details;
        if (since) {
          details = await this.loadSince(commit, git);
        } else if (commit.uncommitted) {
          const numstat = this.head ? await git(["diff", "--no-renames", "--no-ext-diff", "--numstat", "HEAD"]) : { stdout: "" };
          const untracked = new Set(this.files.filter((f) => f.untracked).map((f) => f.path));
          const stats = joinFiles(this.files.map((f) => `${f.status}\t${f.path}`).join("\n"), numstat.stdout)
            .map((f) => untracked.has(f.path) ? { ...f, untracked: true } : f);
          details = { files: stats.slice(0, 500), more: Math.max(0, stats.length - 500) };
        } else {
          const args = fileArgs(commit);
          const [body, status, numstat] = await Promise.all([git(["show", "-s", "--format=%an%x1f%ae%x1f%cn%x1f%ct%x1f%B", hash]), git(args.status), git(args.numstat)]);
          if (body.code !== 0) throw new Error(body.stderr.trim());
          const [author, email, committer, committed, message] = body.stdout.split("\x1f");
          const files = joinFiles(status.stdout, numstat.stdout);
          details = { author, email, committer, committed: Number(committed), message: (message ?? "").trim(), files: files.slice(0, 500), more: Math.max(0, files.length - 500) };
          keep(this.commitDetails, key, details, DETAILS);
        }
        if (current()) this.details = details;
      } catch (e) { if (current()) this.details = { error: String(e?.message ?? e), since: since ? {} : undefined }; }
      cx.notify();
    });
  },

  // Local change: opens the review props.review asked for, once the history it is in has loaded.
  openAsked(cx) {
    const ask = this.ask;
    if (!ask || ask.done || !this.root) return;
    ask.done = true;
    cx.spawn(async (cx) => {
      const r = await exec("git", [...READ, "rev-parse", "--verify", "-q", `${ask.head}^{commit}`], { cwd: this.root, on: this.on });
      const hash = r.code === 0 ? r.stdout.trim() : null;
      const commit = hash ? this.commits[this.index.get(hash)] : null;
      // Local change: the PR view's head further back than the pages read: read on (up to five more pages).
      if (!commit && hash && this.hasMore && (ask.tries ?? 0) < 5) { ask.tries = (ask.tries ?? 0) + 1; ask.done = false; this.loadMore(cx); return; }
      if (!commit) {
        notify({ title: ask.title ?? "Git", body: hash ? `${ask.head} (${hash.slice(0, 8)}) isn't in the loaded history.` : `No commit ${ask.head} in this repository.`, level: "warning", timeout: 6000 });
        return;
      }
      this.pick(commit, cx);
      cx.timer.after(0, () => { const i = this.index.get(hash); if (i !== undefined) this.scrollHandle.scroll_to_item(i, "center"); });
    });
  },

  // Local change: the base branch to review against: the one set in settings, else
  // origin/HEAD's target, main, master, origin/main, origin/master (the first that exists).
  async resolveBase(git) {
    if (this.ask?.base) { // the review another mod asked for compares against its own base
      const r = await git(["rev-parse", "--verify", "-q", `${this.ask.base}^{commit}`]);
      if (r.code !== 0) throw new Error(`No ${this.ask.base} to compare against`);
      return { name: this.ask.baseName ?? this.ask.base.replace(/^refs\/(heads|remotes)\//, ""), hash: r.stdout.trim() };
    }
    const head = await git(["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"]);
    const names = baseCandidates(shared("git-graph.base"), head.code === 0 ? head.stdout.trim() : null);
    for (const name of names) {
      const r = await git(["rev-parse", "--verify", "-q", `${name}^{commit}`]);
      if (r.code === 0) return { name, hash: r.stdout.trim() };
    }
    const set = String(shared("git-graph.base") ?? "").trim();
    throw new Error(set ? `No branch "${set}" to compare against (see the review base in settings)` : "No origin/HEAD, main or master to compare against: set the review base in settings");
  },

  // Everything from the merge base with the base branch up to the commit, or up to
  // the working tree (untracked files included) for the uncommitted row.
  async loadSince(commit, git) {
    const base = await this.resolveBase(git);
    const to = commit.uncommitted ? this.head : commit.hash;
    const mb = await git(["merge-base", base.hash, to]);
    if (mb.code !== 0) throw new Error(`${to.slice(0, 8)} shares no history with ${base.name}`);
    const from = mb.stdout.trim();
    const key = `${this.on}\0${this.root}\0${from}..${commit.hash}`, known = !commit.uncommitted && this.commitDetails.get(key);
    if (known) return known;
    const args = rangeFileArgs(from, commit.uncommitted ? null : commit.hash);
    const [status, numstat, n] = await Promise.all([git(args.status), git(args.numstat), git(["rev-list", "--count", `${from}..${to}`])]);
    if (status.code !== 0) throw new Error(status.stderr.trim());
    let files = joinFiles(status.stdout, numstat.stdout);
    if (commit.uncommitted) {
      const seen = new Set(files.map((f) => f.path));
      files = files.concat(this.files.filter((f) => f.untracked && !seen.has(f.path)).map((f) => ({ path: f.path, status: "A", add: 0, del: 0, untracked: true })))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    }
    const details = { since: { base: base.name, from, commits: Number(n.stdout.trim()) || 0 }, files: files.slice(0, 500), more: Math.max(0, files.length - 500) };
    if (!commit.uncommitted) keep(this.commitDetails, key, details, DETAILS);
    return details;
  },

  // Local change: the review is since base when that's the preference, except on the base branch itself (since base
  // is empty or the base's own history there): there it's the commit, unless `c` chose since base on this branch.
  // Since base needs a HEAD to start from; without one the uncommitted row stays as it is.
  reviewsSince(commit) {
    const on = this.onBase() ? this.sinceOnBase?.branch === this.current : this.sinceBase;
    return on && (!commit.uncommitted || Boolean(this.head));
  },

  // The checked-out branch is the base the review compares against (as resolved by checkBase; never in the PR view
  // or a review another mod asked for, which bring their own base).
  onBase() {
    const b = this.baseRef;
    return !this.ask && !this.prRevs && Boolean(b) && b.root === this.root && b.on === this.on && isBaseBranch(b.name, this.current, this.tracking);
  },

  // After a load: the base branch's name, resolved again when the repository or the base setting changed, then the
  // open review follows a checkout onto or off the base branch.
  checkBase(cx) {
    const key = `${this.on}\0${this.root}\0${String(shared("git-graph.base") ?? "").trim()}`;
    const follow = () => {
      if (this.sinceOnBase && this.sinceOnBase.branch !== this.current) this.sinceOnBase = null; // chosen for one stay on the branch
      const commit = this.selected && this.details ? this.commits[this.index.get(this.selected)] : null;
      if (commit && this.detailsSince !== this.reviewsSince(commit)) this.reloadReview(commit, cx);
    };
    if (this.ask || this.prRevs || !this.root) return;
    if (this.baseRef?.key === key) return follow();
    const { root, on } = this, git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
    cx.spawn(async (cx) => {
      let name = null;
      try { name = (await this.resolveBase(git)).name; } catch { /* no base: never on it */ }
      if (this.root !== root || this.on !== on) return;
      this.baseRef = { key, root, on, name };
      follow(); cx.notify();
    });
  },

  // `c`: this commit ⇄ everything since the base branch; remembered across openings. On the base branch it switches
  // for that branch only, the preference left as it is.
  toggleSince(cx) {
    const commit = this.selected ? this.commits[this.index.get(this.selected)] : null;
    if (this.onBase()) {
      this.sinceOnBase = this.sinceOnBase?.branch === this.current ? null : { branch: this.current };
    } else {
      this.sinceBase = !this.sinceBase;
      if (!this.ask) setShared("git-graph.since", this.sinceBase); // an asked-for review leaves the preference alone
    }
    if (commit) this.reloadReview(commit, cx);
    cx.notify();
  },

  // The open review again, from its first file (the mode changed).
  reloadReview(commit, cx) {
    this.details = null; this.diff = null; this.diffWant = null; this.fileAt = 0; this.diffAt = 0;
    this.fileScroll.scroll_to_item(0);
    this.loadDetails(commit, cx);
    cx.notify();
  },

  openDiff(commit, file, cx) {
    this.diff = { path: file.path, rows: null, width: 300 }; this.diffX = 0;
    const hash = commit.hash, details = this.details, since = details?.since;
    cx.spawn(async (cx) => {
      let rows, whole = false;
      try {
        if (this.asFile() && !commit.uncommitted && file.status !== "D" && !file.binary) {
          // Local change: the file as it is at the commit (for a PR, as it will be once merged), the change marked.
          const plain = since ? rangeDiffArgs(since.from, commit.hash, file.path) : diffArgs(commit, file.path);
          const u0 = [plain[0], "-U0", ...plain.slice(1)];
          const [show, d] = await Promise.all([exec("git", [...READ, "show", `${commit.hash}:${file.path}`], { cwd: this.root, on: this.on }),
            exec("git", [...READ, ...(this.ignoreSpace ? ignoringSpace(u0) : u0)], { cwd: this.root, on: this.on })]);
          if (show.code !== 0) throw new Error(show.stderr.trim());
          rows = show.stdout.includes("\0") ? [{ kind: "", text: "Binary file" }] : fileRows(show.stdout, d.stdout ?? "");
          whole = !show.stdout.includes("\0");
        } else if (commit.uncommitted && file.untracked) {
          const text = await readTextFile(`${this.root}/${file.path}`, { on: this.on }).catch(() => null);
          rows = text === null || text.includes("\0") ? [{ kind: "", text: "Binary or unreadable file" }]
            : diffRows(`@@ -0,0 +1 @@\n${text.slice(0, 400000).split("\n").slice(0, 3000).map((l) => `+${l}`).join("\n")}`);
        } else {
          const plain = since ? rangeDiffArgs(since.from, commit.uncommitted ? null : commit.hash, file.path) : diffArgs(commit, file.path);
          const args = this.ignoreSpace ? ignoringSpace(plain) : plain;
          const r = await exec("git", [...READ, ...args], { cwd: this.root, on: this.on });
          if (r.code !== 0) throw new Error(r.stderr.trim());
          rows = diffRows(r.stdout) ?? [{ kind: "", text: file.binary ? "Binary file changed" : "No text changes" }];
        }
      } catch (e) { rows = [{ kind: "", text: `Can't show this diff: ${e?.message ?? e}` }]; }
      if (this.selected === hash && this.details === details && this.diff?.path === file.path) {
        // The PR view: findings under their lines (again when the finding reached changes: raw is the diff alone).
        this.diff = { path: file.path, raw: rows, width: Math.max(300, ...rows.map((r) => r.text.length * 6.6 + 60)), asFile: whole };
        this.diff.rows = this.diffView(this.diff);
        // A whole file opens at its first change, unless a note's line is asked for (prJump).
        if (this.diff.asFile && !this.pr?.jump) { const i = this.diff.rows.findIndex((x) => x.start); if (i > 0) { this.diffAt = i; cx.timer.after(0, () => this.diffScroll.scroll_to_item(i, "center")); } }
        this.prJump(cx);
      }
      cx.notify();
    });
    cx.notify();
  },

  // Local change: the rows the diff shows: its own, the PR view's notes under their lines, and long lines wrapped
  // to the diff's width (unless ⇧W turned that off). diff.chars: the width they were wrapped to.
  diffView(diff) {
    const rows = this.prDiffRows(diff.path, diff.raw);
    diff.chars = this.wrapLines ? this.diffChars() : 0;
    return diff.chars ? wrapDiff(rows, diff.chars) : rows;
  },

  // Local change: the hunk header of the row at the top of the diff (none while a header is itself the top row),
  // noted as the list draws; shown over the top on the next frame (a redraw asked for while the list is laid out
  // is refused, so it's asked for after).
  diffTopAt(rows, top, cx) {
    let at = -1;
    for (let i = top; i >= 0; i--) if (rows[i]?.kind === "@") { at = i; break; }
    const sticky = at >= 0 && at < top ? rows[at] : null;
    if (sticky === this.diffSticky) return;
    this.diffSticky = sticky;
    cx?.timer?.after(0, (cx) => cx.notify());
  },

  // The characters a diff line has room for: the diff's width less the number column, at 11 px monospace.
  diffChars() {
    return Math.max(30, Math.floor(((this.width ?? 900) - this.filesWidth() - 72) / 6.6));
  },

  // Local change: the review's right side shows the file as it is at the commit (the change marked in it) or the
  // diff. s switches; remembered apart for the PR view (the file unless set) and other reviews (the diff unless set).
  asFile() {
    const pr = Boolean(this.pr?.status === "ready" && this.selected === this.pr.head);
    const v = shared(pr ? "git-graph.pr-as" : "git-graph.review-as");
    return v === "file" || (pr && v !== "diff");
  },

  toggleAsFile(cx) {
    const pr = Boolean(this.pr?.status === "ready" && this.selected === this.pr.head);
    setShared(pr ? "git-graph.pr-as" : "git-graph.review-as", this.asFile() ? "diff" : "file");
    this.diffWant = null; this.diff = null; cx.notify();
  },

  // ⇧W: long lines wrapped, or (unless set) one line each, scrolled sideways with the line numbers kept in place.
  toggleWrap(cx) {
    this.wrapLines = !this.wrapLines; setShared("git-graph.wrap", this.wrapLines);
    this.diffX = 0;
    if (this.diff?.raw) this.diff.rows = this.diffView(this.diff);
    cx.notify();
  },

  // Sideways in the diff: the text moves, the line numbers stay. The widest line sets how far (diff.width).
  diffRoom() { return Math.max(100, (this.width ?? 900) - this.filesWidth() - 66); },

  scrollDiffX(dx, cx) {
    const max = Math.max(0, (this.diff?.width ?? 0) - 60 - this.diffRoom());
    const x = Math.max(0, Math.min(max, (this.diffX ?? 0) + dx));
    if (x !== this.diffX) { this.diffX = x; cx.notify(); }
  },

  // w: whitespace ignored or not (read again), remembered.
  toggleSpace(cx) {
    this.ignoreSpace = !this.ignoreSpace; setShared("git-graph.ignore-space", this.ignoreSpace);
    this.diffWant = null; this.diff = null; cx.notify();
  },

  // The diff's title bar: the two switches, lit while on.
  diffSwitches(t) {
    const sw = (id, label, on, tip, go) => div().id(id).flex_none().px(5).rounded(4).text_size(10.5).cursor_pointer()
      .text_color(on ? t.accent : t.dim).when(on, (e) => e.bg(t.hover)).hover((e) => e.bg(t.hover).text_color(t.foreground))
      .tooltip(tip).on_click((_e, cx) => go(cx)).child(label);
    return h_flex().flex_none().gap(2)
      .child(sw("diff-file", "file", this.asFile(), "The file as it is at the commit (for a PR: once merged), the change marked; off, the diff (s)", (cx) => this.toggleAsFile(cx)))
      .child(sw("diff-ws", "no whitespace", Boolean(this.ignoreSpace), "Whitespace changes ignored (w)", (cx) => this.toggleSpace(cx)))
      .child(sw("diff-wrap", "wrap", Boolean(this.wrapLines), "Long lines wrapped (⇧W); off, they scroll sideways (shift-wheel or a sideways swipe) with the line numbers in place", (cx) => this.toggleWrap(cx)));
  },

  // Local change: commit review as a split. Changed files on the left (they keep
  // the keyboard), the selected file's diff beside them; graph ⇄ files ⇄ diff by keyboard.
  detailsPane(t, mono) {
    const commit = this.commits[this.index.get(this.selected)], d = this.details;
    if (!commit) return div();
    const zone = this.zone ?? "graph";
    const close = div().id("graph-details-close").px(6).py(1).rounded(4).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => this.closeDetails(cx)).child("×");
    const since = this.reviewsSince(commit), s = d?.since;
    const upTo = commit.uncommitted ? "working tree" : commit.hash.slice(0, 8);
    const title = since ? (s?.base ? `${s.base} … ${upTo} · ${count(s.commits, "commit")}` : `Since base … ${upTo}`)
      : commit.uncommitted ? "Uncommitted changes" : `Commit ${commit.hash.slice(0, 8)}`;
    // This commit ⇄ since base, by click as by `c`.
    const modeTab = (label, on) => div().px(6).py(1).rounded(4).text_color(on ? t.accent : t.dim).when(on, (e) => e.bg(t.hover))
      .when(!on, (e) => e.cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground))).child(label);
    const modes = h_flex().id("graph-review-mode").flex_none().gap(2).on_click((_e, cx) => this.toggleSince(cx))
      .child(modeTab(commit.uncommitted ? "Changes" : "Commit", !since)).child(modeTab("Since base", since));
    const files = d?.files ?? [];
    if (files.length) {
      // A reloaded list (a file staged, added or gone) keeps the highlight, and r, on the same file, not its old position.
      if (this.filesShown !== files) {
        const at = this.filesShown && this.filePath ? files.findIndex((f) => f.path === this.filePath) : -1;
        if (at >= 0) this.fileAt = at;
        this.filesShown = files;
      }
      this.fileAt = Math.max(0, Math.min(this.fileAt ?? 0, files.length - 1));
      this.filePath = files[this.fileAt]?.path ?? null;
    }
    const meta = (k, v, color) => h_flex().gap(8).text_size(11.5).child(div().w(64).flex_none().text_color(t.dim).child(k)).child(div().min_w(0).truncate().text_color(color ?? t.muted).child(v));
    const lines = commit.uncommitted || !d?.message ? "" : d.message.split("\n").slice(1).join("\n").trim();
    // Local change: in the PR view the notes are as tall as what they say (up to a cap), or the height the line
    // under them was dragged to.
    const info = v_flex().id("graph-details").flex_none().when(this.prReviewing(), (e) => this.notesFit(e)).when(!this.prReviewing(), (e) => e.max_h(230)).overflow_y_scrollbar().px(14).py(10).gap(4)
      .when(since && Boolean(s?.base) && !this.prReviewing(), (el) => el
        .child(meta("Base", s.base, t.accent))
        .child(meta("Branched", s.from?.slice(0, 8) ?? "").font_family(mono))
        .child(meta("Up to", commit.uncommitted ? "uncommitted changes" : commit.subject))
        .child(meta("Commits", String(s.commits))))
      .when(!since && !commit.uncommitted, (el) => el
        .child(div().font_semibold().child(commit.subject))
        .child(meta("Commit", commit.hash, t.accent).font_family(mono))
        .child(meta("Parents", commit.parents.map((p) => p.slice(0, 8)).join(", ") || "none"))
        // The labels in the graph are shortened: their full names, one per line.
        .children(["branch", "remote", "tag"].map((kind) => [kind, (commit.refs ?? []).filter((r) => r.kind === kind).map((r) => r.name)])
          .filter(([, names]) => names.length)
          .map(([kind, names]) => h_flex().gap(8).text_size(11.5).items_start()
            .child(div().w(64).flex_none().text_color(t.dim).child({ branch: "Branches", remote: "Remotes", tag: "Tags" }[kind]))
            .child(v_flex().min_w(0).flex_1().font_family(mono).children(names.map((n) => div().text_color(t.accent).child(n))))))
        .child(meta("Author", `${commit.author} <${commit.email}>`))
        .child(meta("Date", `${stamp(commit.time)} · ${ago(commit.time)}`)))
      .when(Boolean(d?.committer && d.committer !== d.author), (el) => el.child(meta("Committer", d.committer)))
      .when(this.prReviewing(), (el) => el.child(this.prNotes(t, mono)))
      .when(Boolean(lines), (el) => el.child(v_flex().pt(6).children(lines.split("\n").map((line) => div().text_color(t.muted).child(line || " ")))))
      .when(Boolean(d?.error), (el) => el.child(div().text_color(t.ansi1).child(d.error)));
    const add = files.reduce((n, f) => n + f.add, 0), del = files.reduce((n, f) => n + f.del, 0);
    const filesId = `${this.listId}-files`;
    const fileList = v_virtual_list(filesId, files.length, 24, (i) => String(i), (range) => files.slice(range.start, range.end).map((f, o) => {
      const i = range.start + o, parts = f.path.split("/"), name = parts.pop();
      // Local change: the PR view's folded row (deleted, lockfiles, generated).
      if (f.fold) return h_flex().h(24).px(8).gap(8).items_center().rounded(6).cursor_pointer().when(i === this.fileAt, (e) => e.bg(zone === "files" ? t.selected : t.hover)).child(div().w(6).flex_none()).child(this.prFoldRow(f, t));
      const sc = f.status === "A" ? t.ansi2 : f.status === "D" || f.status === "U" ? t.ansi1 : t.blocked;
      return h_flex().h(24).px(8).gap(8).items_center().rounded(6)
        .when(i === this.fileAt, (e) => e.bg(zone === "files" ? t.selected : t.hover))
        .child(div().w(6).flex_none().child(this.prFileMark(f.path, t) ?? div()))
        .child(this.prViewedMark(f.path, i, t) ?? div())
        .child(div().w(12).flex_none().text_size(11).text_color(sc).child(f.status))
        .child(h_flex().flex_1().min_w(0).when(this.prReviewing() && this.prViewed(f.path), (e) => e.opacity(0.5))
          .child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().min_w(0).truncate().child(name)))
        .when(f.add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`)))
        .when(f.del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`)));
    })).track_scroll(this.fileScroll)
      .on_item_click((key, cx) => { this.fileAt = Number(key); this.zone = "files"; this.handle.focus(); if (files[this.fileAt]?.fold) this.prUnfold(cx); cx.notify(); })
      .size_full();
    const left = v_flex().w(this.filesWidth()).flex_none().h_full().min_h(0)
      .child(h_flex().h(32).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border).text_size(11.5)
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(title))
        .when(!commit.uncommitted || Boolean(this.head), (e) => e.child(this.prMode() && this.prReviewing() ? this.prModes(t) : modes))
        .when(Boolean(commit.uncommitted), (e) => e.child(div().id("graph-open-changes").px(6).py(1).rounded(4).text_color(t.accent).cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click(() => showChanges()).child("Open Changes")))
        .child(close))
      .child(info)
      .when(this.prReviewing(), (e) => e.child(this.notesHandle(t)))
      .child(h_flex().h(26).flex_none().px(14).gap(8).items_center().text_size(11.5).when(!this.prReviewing(), (e) => e.border_t(1).border_color(t.border))
        .child(div().text_color(zone === "files" ? t.accent : t.muted).when(zone === "files", (e) => e.font_semibold()).child(d ? count(files.filter((f) => !f.fold).length + (d.noise?.length ?? 0) + (d.more ?? 0), "file") : "Loading files…"))
        .when(add > 0 || del > 0, (e) => e.child(div().text_color(t.ansi2).child(`+${add}`)).child(div().text_color(t.ansi1).child(`−${del}`)))
        .child(div().flex_1()).child(this.prViewedCount(t) ?? div()))
      .child(div().relative().flex_1().min_h(0).px(4).child(fileList).child(Scrollbar.vertical(filesId).viewport_from_layout().absolute().inset_0()));
    const diff = this.diff;
    // Wrapped to another width (the dialog or the files' edge moved): wrapped again.
    if (diff?.raw && this.wrapLines && diff.chars !== this.diffChars()) diff.rows = this.diffView(diff);
    const rows = diff?.rows;
    const right = v_flex().flex_1().min_w(0).h_full().min_h(0)
      .child(h_flex().h(32).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border).text_size(11.5)
        .child(div().flex_1().min_w(0).truncate().font_family(mono).text_color(t.foreground).child(diff?.path ?? (files.length ? "" : d ? "No changed files" : "")))
        .child(this.prDiffStop(t) ?? div())
        .when(Boolean(diff), (e) => e.child(this.diffSwitches(t))))
      .child(div().flex_1().min_h(0).relative().font_family(mono).text_size(11)
        .when(Boolean(diff) && !rows, (e) => e.child(div().p(12).text_color(t.dim).child("Loading diff…")))
        // Local change: sideways, only the text moves (diffX), the line numbers stay; or long lines wrap (⇧W).
        .on_scroll_wheel((ev, cx) => {
          if (this.wrapLines || !this.diff?.rows) return;
          const dx = Math.abs(ev.delta.x) > Math.abs(ev.delta.y) ? ev.delta.x : ev.modifiers?.shift ? ev.delta.y : 0;
          if (dx) { this.scrollDiffX(-dx / this.unit(), cx); cx.stop_propagation(); }
        })
        .when(Boolean(rows), (e) => e.child(v_virtual_list(this.diffId, rows.length, DIFF_ROW, (i) => String(i),
              (range, cx) => { this.diffTopAt(rows, range.start, cx); return rows.slice(range.start, range.end).map((r) => this.diffRow(r, t)); })
            .track_scroll(this.diffScroll).size_full())
          .child(Scrollbar.vertical(this.diffId).viewport_from_layout().absolute().inset_0())
          // The hunk scrolled past stays at the top until the next hunk's header takes its place.
          // Where the text is, sideways: a thin bar along the bottom while it's moved.
          .when(!this.wrapLines && (this.diffX ?? 0) > 0, (el) => {
            const room = this.diffRoom(), all = Math.max(room, (this.diff.width ?? 0) - 60), w = Math.max(30, room * room / all), at = (this.diffX / Math.max(1, all - room)) * (room - w);
            return el.child(div().absolute().bottom(2).left(50 + at).w(w).h(4).rounded(2).bg(alpha(t.foreground, "40")));
          })
          .when(Boolean(this.diffSticky), (el) => el.child(div().absolute().top(0).left(0).right(0).child(this.diffRow(this.diffSticky, t))))));
    const handle = splitter(t, { id: "graph-split", axis: "row", dragging: Boolean(this.splitDrag), from: () => this.detailsHeight(),
      onStart: (d) => { this.splitDrag = d; }, onReset: (cx) => this.setSplit(null, cx) });
    const filesHandle = splitter(t, { id: "graph-files-split", axis: "col", dragging: Boolean(this.filesDrag), from: () => this.filesWidth(),
      onStart: (d) => { this.filesDrag = d; }, onReset: (cx) => this.setFilesWidth(null, cx) });
    return v_flex().flex_none().h(this.detailsHeight()).when(!this.prFolded(), (e) => e.child(handle))
      .child(h_flex().flex_1().min_h(0).child(left).child(filesHandle).child(right));
  },

  // Local change: the reviewed commit and its selected file, for `o` and `d` (which start
  // the user's own tools, so on this computer only).
  reviewTarget() {
    const commit = this.commits[this.index.get(this.selected)], file = this.details?.files?.[this.fileAt ?? 0];
    if (!commit || !file || file.fold) return null;
    if (this.on) {
      notify({ title: "Only on this computer", body: "Your editor and diff tool work for local repositories.", level: "info", timeout: 3000 });
      return null;
    }
    const root = this.root;
    return { commit, file, since: this.details?.since, root, git: (args) => exec("git", [...READ, ...args], { cwd: root }) };
  },

  // `r`: one file of the uncommitted changes unstaged, or back to HEAD (deleted when new),
  // after the dialog asks. Its state comes from the status, not the review's list.
  resetFile() {
    const commit = this.selected ? this.commits[this.index.get(this.selected)] : null, file = this.details?.files?.[this.fileAt ?? 0];
    if (!commit || !file || !this.ctx) return;
    const now = commit.uncommitted && this.files.find((f) => f.path === file.path);
    if (!now) return notify({ title: "Nothing to reset", body: "r resets a file of the uncommitted changes.", level: "info", timeout: 3000 });
    openDialog({ type: "resetFile", path: now.path, status: now.status, staged: now.staged, untracked: now.untracked }, this.ctx);
  },

  // `o`: the working-tree file in git's editor, to edit it. One not in the working tree
  // (deleted, or only on a branch not checked out) shows as `d` shows it.
  openFile(cx) {
    const at = this.reviewTarget();
    if (!at) return;
    cx.spawn(async () => {
      const path = `${at.root}/${at.file.path}`;
      return (await exists(path)) ? openInEditor(path, at) : this.runDiffTool(at);
    });
  },

  // `d`: the change in git's diff tool (`git difftool`: diff.guitool, else diff.tool), the
  // comparison the review shows. Git writes the versions to compare and removes them after.
  diffInTool(cx) {
    const at = this.reviewTarget();
    if (at) cx.spawn(async () => this.runDiffTool(at));
  },

  async runDiffTool(at) {
    const { commit, file, since, root, git } = at;
    // Added or deleted: one side is empty, which diff tools show badly (VS Code can't open
    // git's /dev/null at all), so just the version there is.
    if (file.untracked || file.status === "A" || file.status === "D" || (!commit.uncommitted && !since && !commit.parents.length)) return this.openVersion(at);
    const range = since ? [since.from, ...(commit.uncommitted ? [] : [commit.hash])] : commit.uncommitted ? ["HEAD"] : [commit.parents[0], commit.hash];
    const [gui, tool] = await Promise.all([git(["config", "--get", "diff.guitool"]), git(["config", "--get", "diff.tool"])]);
    if (!gui.stdout.trim() && !tool.stdout.trim()) {
      return notify({ title: "No diff tool set", body: "Tell git which one to use, for example:\ngit config --global diff.tool vscode", level: "info", timeout: 6000 });
    }
    const r = await background(root, ["git", "difftool", "-y", ...(gui.stdout.trim() ? ["--gui"] : []), ...range, "--", file.path], "difftool");
    if (r.code !== 0) notify({ title: "Couldn't start the diff tool", body: r.stderr.trim(), level: "error" });
  },

  // The one version of an added or deleted file: the working-tree file in the editor when
  // it's there, else that version in the file viewer.
  async openVersion(at) {
    const { commit, file, root } = at;
    if (file.status !== "D" && (commit.uncommitted || (await exists(`${root}/${file.path}`)))) return openInEditor(`${root}/${file.path}`, at);
    this.viewAt(at);
  },

  // `v`: the file in the file viewer (the file-browser mod, over the graph; esc comes back),
  // as it was at the commit, read from git: before it for a file it deleted. Uncommitted
  // changes show the working-tree file, editable there.
  viewFile(cx) {
    const at = this.reviewTarget();
    if (at) this.viewAt(at);
  },

  viewAt({ commit, file, since, root }) {
    const deleted = file.status === "D";
    const rev = commit.uncommitted ? (deleted ? since?.from ?? this.head : null) : deleted ? since?.from ?? commit.parents[0] : commit.hash;
    // The viewer says when it closes (Herdr has no event for that); see returnFromViewer.
    this.viewing = `${Date.now()}`;
    openOverlay({ mod: "file-browser", kind: "dialog", width: 0.92, height: 0.9,
      props: { folder: root, path: file.path, rev, closedKey: VIEWER_CLOSED, closedToken: this.viewing } });
  },

  // Herdr redraws every mod when shared state changes: once the viewer has said it closed,
  // the file list takes the keyboard back, so j k go on to the next file. The keyboard
  // returns to the graph's dialog only after the one above has gone, hence the second try.
  // Local change: a menu or dialog over the graph has closed (confirmed or not): the graph,
  // where it was (review, file, cursor), has the keyboard again. Looked at again after a
  // moment, as a menu that opens a dialog closes first and the dialog should keep it.
  returnFromPopup(cx) {
    const open = shared("git-graph.popups") ?? 0;
    const was = this.popupsOpen ?? 0;
    this.popupsOpen = open;
    if (!this.dialog || !(was > 0 && open === 0) || this.viewing) return;
    const back = () => { if ((shared("git-graph.popups") ?? 0) === 0 && !this.bp && !this.rp && !this.search.typing) this.handle.focus(); };
    cx.timer.after(0, back);
    cx.timer.after(150, back);
  },

  returnFromViewer(cx) {
    if (!this.viewing || shared(VIEWER_CLOSED) !== this.viewing) return;
    this.viewing = null; this.zone = "files";
    cx.timer.after(0, () => this.handle.focus());
    cx.timer.after(150, () => this.handle.focus());
  },

  closeDetails(cx) { this.selected = null; this.details = null; this.diff = null; this.zone = "graph"; this.handle.focus(); cx.notify(); },

  // The diff beside the files follows the selected file (once the cursor rests).
  syncDiff(cx) {
    const commit = this.selected ? this.commits[this.index.get(this.selected)] : null, file = this.details?.files?.[this.fileAt ?? 0];
    if (!commit || !file || file.fold) return;
    const want = `${this.details?.since?.from ?? ""}\0${commit.hash}\0${file.path}`;
    if (this.diffWant === want) return;
    this.diffWant = want;
    cx.timer.after(90, (cx) => { if (this.diffWant === want && this.selected === commit.hash) { this.diffAt = 0; this.openDiff(commit, file, cx); } });
  },

  // Keys while reviewing: the file list keeps the keyboard and scrolls the diff beside it.
  // j/k files, J/K commits, ⌃D/⌃U half pages of the diff, ] [ its hunks, g/G first/last file,
  // h/←/⇥ back to the graph, - = size, x close.
  zoneKey(e, cx) {
    const k = e.keystroke, zone = this.zone ?? "graph";
    if (!this.selected || zone !== "files") return false;
    const files = this.details?.files ?? [], rows = this.diff?.rows ?? [];
    const toFile = (i) => { if (!files.length) return; this.fileAt = Math.max(0, Math.min(files.length - 1, i)); this.fileScroll.scroll_to_item(this.fileAt); };
    // The diff has no cursor: diffAt is the line kept in the middle of its view.
    const page = Math.max(5, Math.floor((this.detailsHeight() - 40) / DIFF_ROW / 2));
    const toLine = (i) => { if (!rows.length) return; this.diffAt = Math.max(0, Math.min(rows.length - 1, i)); this.diffScroll.scroll_to_item(this.diffAt, "center"); };
    // From the top the middle line is about half a page down already.
    const scroll = (d) => toLine(Math.max(page, this.diffAt ?? 0) + d * page);
    const hunk = (d) => { for (let i = (this.diffAt ?? 0) + d; i >= 0 && i < rows.length; i += d) if (rows[i].kind === "@" || rows[i].start) return toLine(i); };
    const commitStep = (d) => { this.moveTo(this.cursorIndex() + d, cx); this.fileAt = 0; this.fileScroll.scroll_to_item(0); };
    const back = () => { this.zone = "graph"; };
    const act = {
      j: () => toFile(this.fileAt + 1), down: () => toFile(this.fileAt + 1), k: () => toFile(this.fileAt - 1), up: () => toFile(this.fileAt - 1),
      g: () => toFile(0), "shift-g": () => toFile(files.length - 1),
      "shift-j": () => commitStep(1), "shift-k": () => commitStep(-1),
      "ctrl-d": () => scroll(1), pagedown: () => scroll(1), space: () => scroll(1),
      "ctrl-u": () => scroll(-1), pageup: () => scroll(-1), "shift-space": () => scroll(-1),
      "]": () => hunk(1), "[": () => hunk(-1),
      h: back, left: back, "shift-tab": back, tab: () => this.closeDetails(cx),
      x: () => this.closeDetails(cx), r: () => this.resetFile(), o: () => this.openFile(cx), d: () => this.diffInTool(cx), v: () => this.viewFile(cx), c: () => this.toggleSince(cx), w: () => this.toggleSpace(cx), "shift-w": () => this.toggleWrap(cx), s: () => this.toggleAsFile(cx),
      "-": () => this.setSplit(this.detailsHeight() - 3 * ROW, cx), "=": () => this.setSplit(this.detailsHeight() + 3 * ROW, cx),
    };
    const f = act[k];
    if (!f) return false;
    f(); cx.notify();
    return true;
  },

  diffRow(row, t) {
    const { kind, number, text } = row;
    if (kind === "F") return this.prDiffNote(row, t);
    if (kind === "@") return div().w_full().px(12).h(DIFF_ROW).flex_none().truncate().bg(t.raised).text_color(t.dim).child(text);
    // Local change: in the whole file, where lines were removed.
    if (kind === "r") return div().w_full().pl(50).h(DIFF_ROW).flex_none().truncate().border_t(1).border_color(alpha(t.ansi1, "66")).text_color(alpha(t.ansi1, "cc")).text_size(10.5).child(text);
    // Local change: the lines of the note reached (its range), marked as a GitHub line link marks them.
    const mark = this.prMarked?.(row);
    // Local change: added and removed lines stand out: a stronger tint, a stronger band
    // behind the line number, and the number in the line's color.
    const color = kind === "+" ? t.ansi2 : kind === "-" ? t.ansi1 : null;
    // The range marked: a bar in the number column and a light tint on unchanged lines (a changed line keeps its green).
    return h_flex().w_full().h(DIFF_ROW).flex_none().gap(10).when(Boolean(color), (e) => e.bg(color + "30")).when(Boolean(mark) && !color, (e) => e.bg(alpha(t.accent, "1a")))
      .child(div().w(40).h_full().pr(6).flex_none().text_right().when(Boolean(color), (e) => e.bg(color + "55")).when(Boolean(mark), (e) => e.border_l(3).border_color(t.accent))
        .text_color(color ?? t.dim).child(number === undefined ? "" : String(number)))
      // Unwrapped, the text moves sideways under a fixed number column (diffX).
      .child(this.wrapLines || !this.diffX ? div().flex_1().min_w(0).truncate().child(text)
        : div().flex_1().min_w(0).h_full().overflow_hidden().child(div().ml(-this.diffX).whitespace_nowrap().child(text)));
  },

};
