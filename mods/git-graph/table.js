// Modified by Jochen Rau, 2026-11, from rabeeh-ta/herdr-git-graph: see NOTICE.md in this folder.
// The graph table: rows, labels, columns, header and toolbar, the cursor, search, menus. Mixed into Graph.
import { div, svg, PathBuilder } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list, Input } from "gpui-base";
import { settings, props, setShared, openOverlay, home, notify, run } from "herdr";
import { LABEL, hitLabel, hitChip, menuFor, menuHeight, fastForwardable, worktreeOf, splitRemote } from "./git.js";
import { perform, openDialog, goToWorktree, checkoutNow } from "./act.js";
import { icon } from "./menu.js";
import { splitter, dragTo } from "./lib/splitter.js";
import { MORE_ROUNDS, PAGE, listsZoom, GRAPH_MIN, COLUMNS, laneColors, ago, tilde, brief, count, depthSetting, ROW, LANE, PAD } from "./common.js";

export const TableMethods = {
  // Local change: keyboard navigation of the graph. A cursor row moves with the
  // keys; with the details open they follow it, as the file viewer previews.
  cursorIndex() {
    const i = this.cursor ? this.index.get(this.cursor) : undefined;
    if (i !== undefined) return i;
    const head = this.commits.findIndex((c) => c.head);
    return head >= 0 ? head : 0;
  },

  moveTo(i, cx, why) {
    if (i === undefined || i < 0 || !this.commits.length) {
      if (why) notify({ title: why, level: "info", timeout: 2500 });
      return;
    }
    i = Math.min(i, this.commits.length - 1);
    const commit = this.commits[i];
    this.cursor = commit.hash;
    this.scrollHandle.scroll_to_item(i, "center");
    if (i >= this.commits.length - 3 && this.hasMore && !this.loading) cx.spawn(async (cx) => this.loadMore(cx));
    if (this.selected && this.selected !== commit.hash) {
      this.compare = null; // another commit: the comparison ends
      this.selected = commit.hash; this.details = null; this.diff = null; this.diffWant = null; this.fileAt = 0;
      const token = this.detailsToken = {};
      // loadDetails answers a commit seen before from its cache without redrawing: redraw here.
      cx.timer.after(120, (cx) => { if (this.detailsToken === token && this.selected === commit.hash) { this.loadDetails(commit, cx); cx.notify(); } });
    }
    cx.notify();
  },

  // The nearest row from `from` in `step` direction whose labels pass `test`.
  seek(from, step, test) {
    for (let i = from + step; i >= 0 && i < this.commits.length; i += step) {
      if ((this.labels.get(this.commits[i].hash) ?? []).some(test)) return i;
    }
    return undefined;
  },

  refIndex(kind, name) {
    const i = this.commits.findIndex((c) => (c.refs ?? []).some((r) => r.kind === kind && r.name === name));
    return i >= 0 ? i : undefined;
  },

  // Local branch ⇄ its upstream: from a branch label to where its upstream is,
  // from a remote label to the local branch that tracks it.
  toggleTracking(cx) {
    const commit = this.commits[this.cursorIndex()], refs = commit?.refs ?? [];
    for (const r of refs.filter((r) => r.kind === "branch")) {
      const tr = this.tracking?.[r.name];
      if (tr && !tr.gone) return this.moveTo(this.refIndex("remote", tr.short), cx, `${tr.short} isn't in the graph (Remotes off, or "Current" only)`);
    }
    for (const r of refs.filter((r) => r.kind === "remote")) {
      const local = Object.entries(this.tracking ?? {}).find(([, t]) => t.short === r.name)?.[0];
      if (local) return this.moveTo(this.refIndex("branch", local), cx, `${local} isn't in the graph`);
    }
    notify({ title: "No tracking pair here", body: "The row has no local branch with an upstream, and no remote branch a local one tracks.", level: "info", timeout: 3000 });
  },

  // The actions menu for the cursor row, as a right-click on its first label would open it.
  keyMenu(cx) {
    const commit = this.commits[this.cursorIndex()];
    if (!commit || !this.ctx) return;
    const part = commit.uncommitted ? null : (this.labels.get(commit.hash) ?? []).flatMap((l) => l.parts).find((p) => p.kind !== "head");
    const target = commit.uncommitted ? { kind: "uncommitted", commit: brief(commit), staged: this.files.some((f) => f.staged) }
      : part ? { kind: part.kind, name: part.name, commit: brief(commit) } : { kind: "commit", commit: brief(commit) };
    const items = menuFor(target, this.ctx);
    openOverlay({ mod: "git-graph", kind: "popup", at: { x: Math.round((this.width ?? 800) * 0.35), y: 140 }, width: 268, height: menuHeight(items), props: { role: "menu", target, ctx: this.ctx } });
  },

  navKey(e, cx) {
    const k = e.keystroke, i = this.cursorIndex(), n = this.commits.length;
    const is = (...names) => names.includes(k);
    const label = (test) => (l) => l.parts.some(test);
    if (is("ctrl-n", "ctrl-j")) return this.moveTo(Math.min(n - 1, i + 1), cx), true;
    if (is("ctrl-p", "ctrl-k")) return this.moveTo(Math.max(0, i - 1), cx), true;
    if (is("down", "j")) return this.moveTo(Math.min(n - 1, i + 1), cx), true;
    if (is("up", "k")) return this.moveTo(Math.max(0, i - 1), cx), true;
    if (is("pagedown", "ctrl-d")) return this.moveTo(Math.min(n - 1, i + 20), cx), true;
    if (is("pageup", "ctrl-u")) return this.moveTo(Math.max(0, i - 20), cx), true;
    if (is("g", "home")) return this.moveTo(0, cx), true;
    if (is("shift-g", "end")) return this.moveTo(n - 1, cx), true;
    // Any label (branch, remote, tag) / local branches only.
    if (is("]")) return this.moveTo(this.seek(i, 1, () => true), cx, "No more labelled commits below"), true;
    if (is("[")) return this.moveTo(this.seek(i, -1, () => true), cx, "No labelled commits above"), true;
    if (is("}", "shift-]", "shift-}")) return this.moveTo(this.seek(i, 1, label((p) => p.kind === "branch")), cx, "No more branches below"), true;
    if (is("{", "shift-[", "shift-{")) return this.moveTo(this.seek(i, -1, label((p) => p.kind === "branch")), cx, "No branches above"), true;
    if (is("t")) return this.toggleTracking(cx), true;
    if (is(".", "@", "shift-2")) return this.moveTo(this.commits.findIndex((c) => c.head), cx, "HEAD isn't in the graph"), true;
    if (is("u")) {
      const tr = this.current ? this.tracking?.[this.current] : null;
      return this.moveTo(tr ? this.refIndex("remote", tr.short) : undefined, cx, tr ? `${tr.short} isn't in the graph` : `${this.current ?? "HEAD"} has no upstream`), true;
    }
    if (is("m")) {
      const main = ["main", "master"].find((b) => this.branches.includes(b));
      return this.moveTo(main ? this.refIndex("branch", main) : this.refIndex("remote", "origin/main") ?? this.refIndex("remote", "origin/master"), cx, "No main or master branch in the graph"), true;
    }
    if (is("^", "shift-6")) {
      const parent = this.commits[i]?.parents?.[0];
      return this.moveTo(parent ? this.index.get(parent) : undefined, cx, "Its parent isn't loaded (or it has none)"), true;
    }
    // ⏎ / l / →: review the commit (the files take the keyboard); x closes the review.
    if (is("enter", "tab", "l", "right")) {
      const c = this.commits[i];
      if (!c) return true;
      // ⏎ and ⇥ toggle, as in beads: on the reviewed commit (graph or files) they close the review.
      if ((k === "enter" || k === "tab") && this.selected === c.hash) return this.closeDetails(cx), true;
      if (this.selected !== c.hash) this.pick(c, cx);
      this.zone = "files"; this.fileAt = this.fileAt ?? 0; cx.notify();
      return true;
    }
    // ← / h / x: out of the review again (Esc never reaches a dialog: Herdr closes it).
    if (is("x", "left", "h") && this.selected) return this.closeDetails(cx), true;
    if (is("c") && this.selected) return this.toggleSince(cx), true;
    if (is("-") && this.selected) return this.setSplit(this.detailsHeight() - 3 * ROW, cx), true;
    if (is("=") && this.selected) return this.setSplit(this.detailsHeight() + 3 * ROW, cx), true;
    if (is("space")) return this.keyMenu(cx), true;
    if (is("a")) return this.setScope(!this.all, cx), true;
    // An input takes the keyboard only once it's drawn: show the field, focus it next frame.
    if (is("/")) { this.search.open = true; cx.notify(); cx.timer.after(0, () => this.searchInput.focus()); return true; }
    if (is("n")) return this.searchStep(1, cx), true;
    if (is("shift-n")) return this.searchStep(-1, cx), true;
    if (is("backspace") && this.search.query) return this.clearSearch(cx), true;
    if (is("b")) return this.openBranches(cx), true;
    if (is("v")) return this.markKey(cx), true;
    return false;
  },

  // Local change: `/` search. Every term must appear in the subject, author, hash or a ref name.
  indexMatches() {
    const terms = this.search.query.toLowerCase().split(/\s+/).filter(Boolean), out = [];
    if (terms.length) this.commits.forEach((c, i) => {
      if (c.uncommitted) return;
      const hay = `${c.subject}\n${c.author}\n${c.hash}\n${(c.refs ?? []).map((r) => r.name).join(" ")}`.toLowerCase();
      if (terms.every((t) => hay.includes(t))) out.push(i);
    });
    this.search.matches = out;
    this.matchSet = new Set(out.map((i) => this.commits[i].hash));
  },

  // As you type, the cursor goes to the first match from where it is.
  runSearch(cx) {
    this.indexMatches();
    const m = this.search.matches, i = this.cursorIndex();
    const next = m.find((x) => x >= i) ?? m[0];
    if (next !== undefined) this.moveTo(next, cx);
    cx.notify();
  },

  // n / N: the next or previous match; past the loaded history, load more and keep looking.
  searchStep(step, cx, fresh = true) {
    if (!this.search.query) return;
    if (fresh) this.searchRounds = 0;
    const m = this.search.matches, i = this.cursorIndex();
    const next = step > 0 ? m.find((x) => x > i) : [...m].reverse().find((x) => x < i);
    if (next !== undefined) return this.moveTo(next, cx);
    if (step > 0 && this.hasMore && this.searchRounds++ < MORE_ROUNDS) { this.pendingSearch = step; return this.loadMore(cx); }
    if (m.length) return this.moveTo(step > 0 ? m[0] : m[m.length - 1], cx); // wrap
    notify({ title: "No match", body: `Nothing matches "${this.search.query}" in the ${this.commits.length} commits shown.`, level: "info", timeout: 3000 });
  },

  clearSearch(cx) {
    this.search.query = ""; this.search.open = false; this.search.matches = []; this.matchSet = null; this.searchInput.set_value("");
    this.handle.focus(); cx.notify();
  },

  // ⇧B: a new branch at the cursor commit (HEAD on the uncommitted row): here, in a new
  // worktree, or just made.
  newBranch() {
    const c = this.commits[this.cursorIndex()], hash = c?.uncommitted ? this.head : c?.hash;
    if (!hash || !this.ctx) return;
    openDialog({ type: "createBranch", hash, short: hash.slice(0, 8) }, this.ctx);
  },

  // Local change: the day-to-day sync actions, from the header and the keyboard.
  // ff: every branch that only lacks its upstream's commits; push: the current
  // branch to its upstream (the dialog when it has none); commit: the dialog.
  syncAction(kind, cx) {
    const ctx = this.ctx;
    if (!ctx || this.syncing) return;
    let action;
    if (kind === "ff") {
      const list = fastForwardable(ctx);
      if (!list.length) return notify({ title: "Nothing to fast-forward", body: "Every branch is level with or ahead of its upstream. Fetch (f) to look again.", level: "info", timeout: 3000 });
      action = { type: "ffAll", list };
    } else if (kind === "push") {
      const tr = ctx.current ? ctx.tracking?.[ctx.current] : null;
      if (!ctx.current || !ctx.remotes.length) return;
      if (!tr || tr.gone) return void openDialog({ type: "push", name: ctx.current }, ctx);
      if (!tr.ahead) return notify({ title: "Nothing to push", body: `${ctx.current} is level with ${tr.short}.`, level: "info", timeout: 3000 });
      // Asks first (⏎ confirms): a push reaches beyond this machine.
      return void openDialog({ type: "pushCurrent", name: ctx.current, short: tr.short }, ctx);
    } else if (kind === "commit") {
      // "Stage everything first" starts ticked only when nothing is staged (as the menus do): a partial staging stays as it is.
      if (this.files.length) openDialog({ type: "commit", staged: this.files.some((f) => f.staged) }, ctx);
      return;
    } else return;
    this.syncing = kind; cx.notify();
    cx.spawn(async (cx) => { await perform(action, {}, ctx).catch(() => {}); this.syncing = null; this.refresh(cx); cx.notify(); });
  },

  graphWidth() { return this.cols.graph ? this.clampColumn("graph", this.cols.graph) : Math.min(Math.max(GRAPH_MIN, PAD * 2 + this.lanes * LANE), this.graphMax); },

  trailing() { return this.wide ? ["date", "author", "hash"] : ["date"]; },

  clampColumn(key, w) {
    const { min, max = (this.width ?? Infinity) * 0.7 } = COLUMNS[key];
    return Math.round(Math.max(min, Math.min(max, w)));
  },

  resetColumn(key, cx) {
    if (this.cols[key] !== COLUMNS[key].width) { this.cols = { ...this.cols, [key]: COLUMNS[key].width }; this.saveColumns(); cx.notify(); }
  },

  moveDrag(e, cx) {
    const u = this.unit();
    const sd = this.splitDrag;
    if (sd) { this.split = dragTo(sd, e, u, -1); cx.notify(); return; }
    const fd = this.filesDrag;
    if (fd) { this.filesSplit = dragTo(fd, e, u); cx.notify(); return; }
    const rd = this.railDrag; // the PR view: the edge of the PR list on the left
    if (rd) { this.railSplit = dragTo(rd, e, u); cx.notify(); return; }
    const nd = this.notesDrag; // the PR view: the line between its notes and the file list
    if (nd) { this.notesSplit = dragTo(nd, e, u); cx.notify(); return; }
    const d = this.drag;
    if (!d) return;
    const w = this.clampColumn(d.key, d.from + COLUMNS[d.key].side * (dragTo(d, e, u) - d.from));
    if (w !== this.cols[d.key]) { this.cols = { ...this.cols, [d.key]: w }; cx.notify(); }
  },

  endDrag(cx) {
    const sd = this.splitDrag;
    if (sd) { this.splitDrag = null; if (sd.moved) this.setSplit(this.detailsHeight(), cx); return; }
    const fd = this.filesDrag;
    if (fd) { this.filesDrag = null; if (fd.moved) this.setFilesWidth(this.filesWidth(), cx); return; }
    const rd = this.railDrag;
    if (rd) { this.railDrag = null; if (rd.moved) this.setRailWidth(this.railWidth(), cx); return; }
    const nd = this.notesDrag;
    if (nd) { this.notesDrag = null; if (nd.moved) this.setNotesHeight(this.notesHeight(), cx); return; }
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.moved) this.saveColumns();
    cx.notify();
  },

  saveColumns() { this.seenCols = JSON.stringify(this.cols); setShared("git-graph.columns", this.cols); },

  // Where the description column ends: labels past it are clipped, so not clickable.
  labelLimit() {
    if (!this.width) return Infinity;
    return this.width - 2 - 10 - this.trailing().reduce((n, k) => n + this.cols[k] + LABEL.GAP, 0);
  },

  // Pointer positions come in window units; layout sizes are these units times the zoom.
  unit() { return this.scale ?? settings().zoom ?? 1; },

  // A row is a whole number of screen pixels (21.6 at zoom 0.9 leaves hairline gaps between rows): rowPx is that,
  // rowH the same in the units an element's h() takes (the zoom scales it back).
  rowPx() { return Math.max(1, Math.round(ROW * (settings().zoom ?? 1))); },

  rowH() { return this.rowPx() / (settings().zoom ?? 1); },

  // The list's row height: units where Herdr zooms lists (rowH, still a whole number
  // of pixels once zoomed), screen pixels before.
  listRow() { return listsZoom() ? this.rowH() : this.rowPx(); },

  // What the lines' coordinates are multiplied by: nothing where Herdr zooms them itself.
  pathScale() { return listsZoom() ? 1 : this.unit(); },

  // A left press, then on release the list names the row: together, a click on a label.
  clicked(key, cx) {
    const press = this.press; this.press = null;
    if (key === "more") return this.loadMore(cx);
    const commit = this.commits[this.index.get(key)];
    if (!commit) return;
    // Local change: ⌘-click compares the open (else the cursor's) commit with this one.
    if (press?.cmd) return this.compareWith(commit, cx);
    if (press?.count >= 2) {
      const hit = hitLabel(this.labels.get(key), press.x, this.graphWidth(), this.labelLimit());
      if (hit) this.checkout(hit.part, cx);
      return;
    }
    // A PR chip (#232 agents at work): its page on GitHub.
    const chip = press ? hitChip(this.labels.get(key), this.prChipsAt(commit), press.x, this.graphWidth(), this.labelLimit()) : null;
    if (chip?.url) return cx.open_url(chip.url);
    this.pick(commit, cx);
  },

  checkout(part, cx) {
    const ctx = this.ctx;
    // Local change: one checked out in another worktree: go there (git won't check it out twice).
    const wt = part.kind === "branch" ? worktreeOf(ctx, part.name) : null;
    if (wt) return goToWorktree(wt, part.name, ctx.on, ctx.overlay, ctx.space);
    // Local change: checked out here at once (a new worktree is in its right-click menu).
    if (part.kind === "branch" && part.name !== ctx.current) cx.spawn(async () => { await checkoutNow({ type: "checkout", name: part.name }, "here", ctx); });
    else if (part.kind === "remote") {
      // Local change: as Fork does: the local branch that tracks it (else the one of its name)
      // is checked out and, when it only lacks the remote's commits, fast-forwarded to it.
      const { remote: remoteName, branch } = splitRemote(part.name, ctx.remotes);
      const local = Object.entries(ctx.tracking ?? {}).find(([, t]) => t.short === part.name)?.[0] ?? (ctx.branches.includes(branch) ? branch : null);
      // None yet: a local branch of its name, tracking it, checked out here (another name: its menu's Checkout as…).
      if (!local) return void cx.spawn(async () => { await checkoutNow({ type: "checkoutRemote", name: part.name, remote: remoteName, branch }, "here", ctx); });
      const t = ctx.tracking?.[local], tracks = t && t.short === part.name && !t.gone, there = worktreeOf(ctx, local);
      // In another worktree: only gone to. Someone (an agent, perhaps) may be working there, so its files
      // aren't moved without asking; when it's behind, a toast says so and its menu or a pull there levels it.
      if (there) {
        if (tracks && t.behind > 0) notify({ title: `${local} is ${count(t.behind, "commit")} behind ${t.short}`, body: `It's checked out in ${there.split("/").pop()}: pull there when nobody is working in it.`, level: "info", timeout: 6000 });
        return goToWorktree(there, local, ctx.on, ctx.overlay, ctx.space);
      }
      cx.spawn(async () => {
        if (tracks && t.behind > 0 && !t.ahead) {
          const ff = await perform({ type: "ffBranch", name: local, upstream: t.upstream, short: t.short, current: local === ctx.current }, {}, ctx);
          if (!ff.ok) return;
        }
        if (local !== ctx.current) await perform({ type: "checkout", name: local }, {}, ctx);
        if (tracks && t.behind > 0 && t.ahead > 0) {
          notify({ title: `${local} can't fast-forward`, body: `It has ${count(t.ahead, "commit")} ${part.name} doesn't. Right-click the label to merge or rebase.`, level: "info", timeout: 5000 });
        }
      });
    }
  },

  // Right-click on the branch at the top (or its upstream): the repository menu, as the status bar's branch and
  // Manygit's rows have it: pull, push and fetch first as fit, commit and stash with changes, copy, GitHub.
  syncMenu(cx) {
    if (!this.ctx || !this.root || this.prMode()) return;
    const tr = this.current ? this.tracking?.[this.current] : null, files = this.files ?? [];
    const status = { branch: this.current ?? null, upstream: tr?.short ?? null, gone: Boolean(tr?.gone), ahead: tr?.ahead ?? 0, behind: tr?.behind ?? 0,
      dirty: files.length, staged: files.filter((f) => f.staged).length };
    const target = { kind: "repo", path: this.root, status, agents: [], web: this.webBase() };
    const ctx = { ...this.ctx, remotes: this.ctx.remotes ?? [] }, items = menuFor(target, ctx);
    openOverlay({ mod: "git-graph", kind: "popup", at: "pointer", width: 268, height: menuHeight(items), props: { role: "menu", target, ctx } });
  },

  contextMenu(key, e, cx) {
    const commit = this.commits[this.index.get(key)];
    if (!commit || !this.ctx) return;
    if (e.bounds?.height) this.scale = e.bounds.height / this.rowH();
    const x = (e.local_position?.x ?? 0) / this.unit();
    const hit = commit.uncommitted ? null : hitLabel(this.labels.get(key), x, this.graphWidth(), this.labelLimit());
    const target = commit.uncommitted ? { kind: "uncommitted", commit: brief(commit), staged: this.files.some((f) => f.staged) }
      : hit && hit.part.kind !== "head" ? { kind: hit.part.kind, name: hit.part.name, commit: brief(commit) }
      : { kind: "commit", commit: brief(commit) };
    // The repository's GitHub page, for the menu's "Open … on GitHub".
    const ctx = { ...this.ctx, web: this.webBase() };
    const items = menuFor(target, ctx);
    openOverlay({ mod: "git-graph", kind: "popup", at: "pointer", width: 268, height: menuHeight(items), props: { role: "menu", target, ctx } });
  },

  // Local change: two commits compared: the review shows the diff from the older to the newer (the uncommitted row:
  // to the working tree), as "since base" does. ⌘-click the same commit again, or pick another, to end it.
  // `v` (as vim's visual mode): marks the cursor's commit; moved on, `v` again compares the two (on the mark: unmarks).
  markKey(cx) {
    const at = this.cursor ? this.commits[this.index.get(this.cursor)] : null;
    if (!at) return;
    if (!this.mark || this.mark === at.hash) { this.mark = this.mark ? null : at.hash; return cx.notify(); }
    const mark = this.mark; this.mark = null;
    this.compareWith(at, cx, mark);
  },

  compareWith(commit, cx, from = null) {
    const anchor = from ?? this.selected ?? this.cursor, i = this.index.get(anchor), j = this.index.get(commit.hash);
    if (!anchor || anchor === commit.hash || i === undefined || j === undefined) return this.pick(commit, cx);
    const newer = this.commits[Math.min(i, j)], older = this.commits[Math.max(i, j)];
    if (older.uncommitted) return this.pick(commit, cx);
    this.compare = { from: older.hash, to: newer.hash };
    this.cursor = newer.hash; this.selected = newer.hash;
    this.details = null; this.diff = null; this.diffWant = null; this.fileAt = 0;
    this.loadDetails(newer, cx);
    this.handle.focus(); this.keepCursorVisible(cx); cx.notify();
  },

  pick(commit, cx) {
    this.compare = null;
    this.cursor = commit.hash;
    if (this.selected === commit.hash) return this.closeDetails(cx);
    this.selected = commit.hash; this.details = null; this.diff = null; this.diffWant = null; this.fileAt = 0;
    this.loadDetails(commit, cx);
    this.handle.focus();
    this.keepCursorVisible(cx);
    cx.notify();
  },

  graphCell(row, commit, colors, t, width) {
    const x = (lane) => PAD + lane * LANE + LANE / 2, y = (v) => v * this.rowH(), paths = new Map();
    // Elements are scaled by the zoom; before Herdr 0.1.12 a list's paint_path wasn't, so the lines scale to match the dots.
    const z = this.pathScale(), px = (lane) => x(lane) * z, py = (v) => y(v) * z;
    // One stroked path per color: a row is a handful of paints, however many lanes cross it.
    for (const [a, ya, b, yb, c, dashed] of row.segments) {
      const color = dashed ? t.dim : colors[c % colors.length], key = `${color}${dashed ? "-" : ""}`;
      let p = paths.get(key)?.p ?? (dashed ? PathBuilder.stroke(1.5 * z).dash_array([3 * z, 3 * z]) : PathBuilder.stroke(1.5 * z));
      p = p.move_to(px(a), py(ya));
      if (a === b) p = p.line_to(px(b), py(yb));
      else { const mid = (py(ya) + py(yb)) / 2; p = p.cubic_bezier_to(px(b), py(yb), px(a), mid, px(b), mid); }
      paths.set(key, { p, color });
    }
    const color = commit.uncommitted ? t.dim : colors[row.lane % colors.length];
    const dot = div().absolute().left(x(row.lane) - 4).top(this.rowH() / 2 - 4).size(8).rounded(4);
    return div().relative().flex_none().w(width).h(this.rowH()).overflow_hidden()
      .children([...paths.values()].map(({ p, color }) => window.paint_path(p.build(), color).absolute().top(0).left(0).size_full()))
      // HEAD is a ring, as in Git Graph; uncommitted changes a gray one.
      .child(commit.head || commit.uncommitted ? dot.bg(t.background).border(2).border_color(color) : dot.bg(color));
  },

  label(label, color, t, mono) {
    const current = label.kind === "branch" && label.head;
    const edge = label.kind === "tag" ? t.ansi3 : label.kind === "head" ? t.accent : color;
    return h_flex().flex_none().w(label.width).h(18).rounded(5).border_1().border_color(edge).overflow_hidden()
      .when(current, (e) => e.bg(color)).when(label.kind === "head", (e) => e.bg(t.accent))
      .children(label.parts.map((part, i) => {
        const fg = current || part.kind === "head" ? t.background : part.kind === "tag" ? t.ansi3 : i > 0 ? t.muted : t.foreground;
        // A folder: checked out in another worktree (double-click goes there).
        const glyph = part.kind === "branch" ? (part.head ? "check" : part.worktree ? "folder" : "branch") : part.kind === "tag" ? "tag" : "cloud";
        return h_flex().w(part.width).h_full().flex_none().px(LABEL.PAD).gap(3).items_center().overflow_hidden()
          .when(i > 0, (e) => e.border_l(1).border_color(edge).bg(current ? t.background + "33" : edge + "1f"))
          .when(Boolean(part.icon), (e) => e.child(svg(icon(glyph)).size(10).flex_none().text_color(fg)))
          .child(div().font_family(mono).text_size(LABEL.FONT).when(current, (e) => e.font_semibold()).text_color(fg).child(part.text));
      }));
  },

  row(i, t, colors, mono, width) {
    const commit = this.commits[i], row = this.rows[i], color = colors[row.lane % colors.length];
    // Merge commits are muted, as Git Graph does by default.
    const fg = commit.uncommitted ? t.muted : commit.parents.length > 1 ? t.dim : t.foreground;
    return h_flex().id(`c-${commit.hash}`).w_full().h(this.rowH()).flex_none().pr(10).gap(LABEL.GAP).items_center().overflow_hidden()
      .when(commit.head, (e) => e.bg(color + "14")).when(Boolean(this.matchSet?.has(commit.hash)), (e) => e.bg(t.ansi3 + "22"))
      .when(this.selected === commit.hash || this.compare?.from === commit.hash || this.mark === commit.hash, (e) => e.bg(t.selected))
      .when(this.cursor === commit.hash && this.selected !== commit.hash, (e) => e.bg(t.accent + "24")).hover((s) => s.bg(t.hover))
      .child(this.graphCell(row, commit, colors, t, width))
      // Labels and description clip together, so many labels never push the fixed columns out.
      .child(h_flex().flex_1().min_w(0).h_full().gap(LABEL.GAP).items_center().overflow_hidden()
        .children(this.labels.get(commit.hash).map((l) => this.label(l, color, t, mono)))
        .children(this.prChips(commit, t, mono))
        .child(div().flex_1().min_w(0).truncate().text_color(fg).when(commit.head, (e) => e.font_semibold()).child(commit.subject)))
      .child(div().w(this.cols.date).flex_none().text_right().truncate().text_color(t.dim).child(commit.uncommitted ? "*" : ago(commit.time)))
      .when(this.wide, (e) => e
        .child(div().w(this.cols.author).flex_none().truncate().text_color(t.muted).child(commit.uncommitted ? "*" : commit.author))
        .child(div().w(this.cols.hash).flex_none().font_family(mono).text_size(11).text_color(t.dim).child(commit.uncommitted ? "*" : commit.hash.slice(0, 8))));
  },

  iconButton(id, glyph, tip, active, action, t) {
    return h_flex().id(id).h(24).px(6).gap(5).flex_none().items_center().rounded(6).text_size(11.5).cursor_pointer()
      .text_color(active ? t.foreground : t.muted).when(active, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action)
      .child(svg(icon(glyph)).size(13).flex_none()).when(Boolean(tip), (e) => e.child(tip));
  },

  header(t) {
    const ready = this.state === "ready" || this.state === "empty", ws = this.workspace;
    // Local change: the PR view names the PR's branch, not the checkout's (prHeader in pr.js).
    const prh = this.prHeader?.() ?? null;
    const where = prh ? prh.branch : this.current ?? (this.head ? `detached at ${this.head.slice(0, 8)}` : null);
    // Opened from the Manygit list: "‹ Manygit" goes back to it, the repository's name
    // drops the same rows down over the graph to switch to another.
    const repo = ws && this.opened ? ws.repos.find((r) => r.path === this.opened) : null;
    const settingsShown = ready || this.state === "workspace" || (this.state === "norepo" && !this.skipped);
    const tr = this.current && !prh ? this.tracking?.[this.current] : null;
    const ffCount = this.ctx && !prh ? fastForwardable(this.ctx).length : 0;
    const canPush = !prh && Boolean(this.current) && this.remoteNames?.length > 0 && (!tr || tr.gone || tr.ahead > 0);
    return h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .when(!repo, (e) => e.child(div().text_size(13).font_semibold().child(ws ? "Manygit" : "Git")))
      // Local change: which repository, and a way to another one (as R).
      .when(!repo && ready && Boolean(this.root), (e) => e.child(h_flex().id("graph-switch").h(22).px(7).gap(5).min_w(0).items_center().rounded(6).cursor_pointer()
        .bg(this.rp ? t.selected : t.raised).text_color(t.foreground).hover((s) => s.bg(t.hover)).on_click((_e, cx) => (this.rp ? this.closeRepos(cx) : this.openRepos(cx)))
        .child(svg(icon("folder")).size(12).flex_none())
        // Local change: a linked worktree reads as its repository, then the worktree's folder.
        .when(Boolean(this.mainRoot), (e) => e.child(div().flex_none().text_size(11.5).font_semibold().child(this.mainRoot.split("/").pop()))
          .child(div().flex_none().text_size(11.5).text_color(t.dim).child("worktree")))
        .child(div().min_w(0).truncate().text_size(11.5).font_semibold().child(this.root.split("/").pop()))))
      .when(Boolean(repo), (e) => e
        .child(h_flex().id("graph-back").h(24).pl(2).pr(6).gap(3).flex_none().items_center().rounded(6).cursor_pointer()
          .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.back(cx))
          .child(svg(icon("back")).size(14).flex_none().text_color(t.muted)).child(div().text_size(13).font_semibold().child("Manygit")))
        .child(h_flex().id("graph-repository").h(22).px(7).gap(5).min_w(0).items_center().rounded(6).cursor_pointer()
          .bg(this.picking ? t.selected : t.raised).text_color(t.foreground).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.togglePicker(cx))
          .child(svg(icon("folder")).size(12).flex_none()).child(div().min_w(0).truncate().text_size(11.5).font_semibold().child(repo.name))))
      // Local change: the branch is a way to another one, as the repository is (a click: Branches & tags, as b).
      .when(ready && Boolean(where), (e) => e.child(h_flex().id("graph-where").h(22).px(7).gap(5).min_w(0).items_center().rounded(6).cursor_pointer()
        .bg(t.accent + (this.bp ? "40" : "26")).text_color(t.accent).hover((s) => s.bg(t.accent + "40"))
        .tooltip("Click: find a branch or tag (b)\nRight-click: pull, push, fetch").on_click((_e, cx) => (this.bp ? this.closeBranches(cx) : this.openBranches(cx)))
        .when(!prh, (el) => el.on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.syncMenu(cx); }))
        .child(svg(icon(this.current || prh ? "branch" : "commit")).size(12).flex_none()).child(div().min_w(0).truncate().text_size(11.5).font_semibold().child(where))))
      .when(Boolean(prh?.ahead !== undefined), (e) => e.child(h_flex().gap(4).flex_none().items_center().text_size(11.5)
        .tooltip("The PR's head against its base: commits it adds, commits the base has that it doesn't")
        .when(prh.ahead > 0, (el) => el.child(div().text_color(t.ansi2).child(`\u2191${prh.ahead}`)))
        .when(prh.behind > 0, (el) => el.child(div().text_color(t.ansi1).child(`\u2193${prh.behind} behind`)))))
      .when(this.state === "workspace", (e) => e.child(div().flex_none().text_size(11.5).text_color(t.dim).child(count(ws.repos.length, "repo"))))
      .when(ready && Boolean(tr), (e) => e.child(h_flex().id("graph-upstream").h(22).px(5).gap(4).flex_none().items_center().rounded(6).text_size(11.5)
        .hover((s) => s.bg(t.hover)).tooltip(`${tr.gone ? `${tr.short} no longer exists` : `${tr.ahead ? `${tr.ahead} to push` : ""}${tr.ahead && tr.behind ? ", " : ""}${tr.behind ? `${tr.behind} behind (as of the last fetch)` : ""}${!tr.ahead && !tr.behind ? `Level with ${tr.short}` : ""}`}\nRight-click: pull, push, fetch`)
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.syncMenu(cx); })
        .child(div().text_color(t.dim).child(tr.gone ? `${tr.short} (gone)` : tr.short))
        .when(tr.ahead > 0, (el) => el.child(div().text_color(t.ansi2).child(`\u2191${tr.ahead}`)))
        .when(tr.behind > 0, (el) => el.child(div().text_color(t.ansi1).child(`\u2193${tr.behind}`)))))
      .child(div().flex_1())
      .when(ready && ffCount > 0, (e) => e.child(this.iconButton("graph-ff", "fetch", this.syncing === "ff" ? "Fast-forwarding…" : `Fast-forward ${ffCount}`, false, (_e, cx) => this.syncAction("ff", cx), t)))
      .when(ready && canPush, (e) => e.child(this.iconButton("graph-push", "push", this.syncing === "push" ? "Pushing…" : tr && !tr.gone ? `Push \u2191${tr.ahead}` : "Publish", false, (_e, cx) => this.syncAction("push", cx), t)))
      .when(ready && this.remoteNames?.length > 0, (e) => e.child(this.iconButton("graph-fetch", "fetch", this.fetching ? "Fetching…" : null, false, (_e, cx) => this.fetch(cx), t)))
      .when(this.state === "workspace", (e) => {
        const run = this.fetchAll?.root === ws.root ? this.fetchAll : null;
        return e.child(this.iconButton("graph-fetch-all", "fetch", run ? `Fetching ${run.done}/${run.total}…` : "Fetch all", Boolean(run), (_e, cx) => this.fetchEvery(cx), t));
      })
      .when(this.state !== "nofolder", (e) => e.child(this.iconButton("graph-refresh", "refresh", null, false, (_e, cx) => this.refresh(cx), t)))
      .when(settingsShown, (e) => e.child(this.iconButton("graph-settings", "settings", null, false, () => this.openSettings(), t)));
  },

  openSettings() {
    openOverlay({ mod: "git-graph", kind: "popup", at: "pointer", width: 240, height: 130, props: { role: "settings" } });
  },

  toolbar(t) {
    const segment = (id, text, on, action) => div().id(id).h(22).px(9).flex().items_center().rounded(5).text_size(11.5).cursor_pointer()
      .bg(on ? t.raised : t.background).text_color(on ? t.foreground : t.muted).when(on, (e) => e.border_1().border_color(t.border))
      .hover((s) => s.text_color(t.foreground)).on_click(action).child(text);
    return h_flex().h(34).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border)
      .child(h_flex().p(2).gap(2).rounded(7).bg(t.background).border_1().border_color(t.border)
        // Local change: the PR view reads only the PR and its base ("This PR"); the others leave that.
        .when(this.prMode(), (e) => e.child(segment("graph-pr", "This PR", Boolean(this.prRevs), (_e, cx) => this.setPrScope(cx))))
        .child(segment("graph-all", "All branches", this.all && !this.prRevs, (_e, cx) => this.setScope(true, cx)))
        .child(segment("graph-current", "Current", !this.all && !this.prRevs, (_e, cx) => this.setScope(false, cx))))
      .child(h_flex().id("graph-remotes").h(24).px(6).gap(6).items_center().rounded(6).cursor_pointer().text_size(11.5).text_color(t.muted)
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => this.setRemotes(cx))
        .child(div().size(13).rounded(3).border_1().border_color(this.remotes ? t.accent : t.input).when(this.remotes, (e) => e.bg(t.accent)).flex().items_center().justify_center()
          .when(this.remotes, (e) => e.child(svg(icon("check")).size(10).text_color(t.accent_foreground))))
        .child("Remotes"))
      .when(this.search.open || this.search.typing || Boolean(this.search.query), (e) => {
        const m = this.search.matches, at = m.indexOf(this.cursorIndex());
        return e.child(h_flex().flex_1().min_w(0).h(24).ml(6).px(8).gap(6).items_center().rounded(6).border_1()
          .border_color(this.search.typing ? t.accent : t.border).bg(t.background)
          .child(div().flex_none().text_size(11.5).text_color(t.dim).child("/"))
          .child(Input.new(this.searchInput).flex_1().h_full().text_size(11.5).text_color(t.foreground))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(this.search.query ? `${at >= 0 ? at + 1 : "–"}/${m.length}${this.hasMore ? "+" : ""}` : ""))
          .child(div().flex_none().text_size(11).text_color(t.dim).child("n N next/prev · esc graph · ⌫ clear")));
      })
      .when(this.dialog && !this.search.open && !this.search.typing && !this.search.query, (e) => e.child(div().flex_1().min_w(0).pl(12).truncate().text_right().text_size(11).text_color(t.dim)
        .child(this.mark ? `marked ${this.mark.slice(0, 8)} · j k move · v compare with it · esc unmark` : this.selected ? "j k files · J K commits · c since base · \u2318-click compare · v view · o edit · d diff · r reset · \u2190 out · ? help"
          : "j k move · v mark · / search · b branches & tags · \u23ce review · \u21e7P push · \u21e7F ff · ? help")));
  },

  columns(t, width) {
    const head = (text, w) => div().when(w !== undefined, (e) => e.w(w).flex_none()).truncate().child(text);
    const titles = { date: "Date", author: "Author", hash: "Commit" };
    // Handles stand in for the rows' gaps, 1px wider each side.
    const handle = (key) => splitter(t, { id: `graph-col-${key}`, axis: "col", line: false, width: LABEL.GAP + 2, dragging: this.drag?.key === key,
      from: () => key === "graph" ? this.graphWidth() : this.cols[key], onStart: (d) => { this.drag = { ...d, key }; }, onReset: (cx) => this.resetColumn(key, cx) }).mx(-1);
    return h_flex().h(24).flex_none().pr(10).items_center().border_b(1).border_color(t.border).text_size(11).text_color(t.dim)
      .child(head("Graph", width).pl(PAD)).child(handle("graph")).child(div().flex_1().min_w(0).child("Description"))
      .children(this.trailing().flatMap((k) => [handle(k), head(titles[k], this.cols[k]).when(k === "date", (e) => e.text_right())]));
  },

  list(t, mono) {
    const colors = laneColors(t), width = this.graphWidth(), count = this.commits.length + (this.hasMore ? 1 : 0);
    return div().flex_1().min_h(0).relative()
      .on_mouse_down("left", (e) => { this.press = { x: (e.local_position?.x ?? 0) / this.unit(), count: e.click_count, cmd: Boolean(e.modifiers?.platform) }; })
      .child(v_virtual_list(this.listId, count, this.listRow(), (i) => this.commits[i]?.hash ?? "more",
        (range, cx) => {
          // Scrolling to the end loads the next page, as Git Graph does; the row also takes a click.
          if (range.end > this.commits.length && this.hasMore && !this.loading && this.moreAsked !== this.limit) {
            this.moreAsked = this.limit;
            // Local change: after this frame, not in it: loading redraws, and a redraw asked for while the list is
            // laid out is refused (the list then stayed blank).
            cx.timer.after(0, (cx) => this.loadMore(cx));
          }
          return Array.from({ length: range.end - range.start }, (_x, k) => range.start + k).map((i) => i < this.commits.length
            ? this.row(i, t, colors, mono, width)
            : div().id("graph-more").h(this.rowH()).flex_none().px(14).flex().items_center().text_color(t.accent).hover((s) => s.bg(t.hover))
              .child(this.loading ? "Loading more commits…" : `Load ${PAGE} more commits`));
        })
        // Rows of a virtual list can't hold their own handlers: the list reports the row's key.
        .on_item_click((key, cx) => this.clicked(key, cx))
        .on_item_secondary_click((key, e, cx) => this.contextMenu(key, e, cx))
        .track_scroll(this.scrollHandle)
        .size_full())
      .child(Scrollbar.vertical(this.listId).viewport_from_layout().absolute().inset_0());
  },

  empty(t) {
    const s = this.state, where = tilde(this.cwd, this.on);
    const [glyph, title, body] = s === "nofolder" ? ["folder", "No folder", "Focus a terminal to see the history of the repository it's in."]
      : s === "norepo" && this.skipped ? ["folder", "Not a git repository", `${where ?? "This folder"} isn't a repository, and is too big to search for them. Focus a terminal in a repository, or in a folder that holds some.`]
      : s === "norepo" ? ["folder", "Not a git repository", `${where ?? "This folder"} isn't inside a git repository, and holds none within ${count(depthSetting(), "level")}. Focus a terminal in one, or search deeper in settings.`]
      : s === "empty" ? ["commit", "No commits yet", "Make the first commit and it shows up here."]
      : s === "error" ? ["graph", "Can't read the history", this.error]
      : s === "prloading" ? ["graph", "Opening the PR…", "Its record, its branch in your checkout (fetched if it isn't there yet) and its findings."]
      : s === "prerror" ? ["graph", "Can't open the PR", this.pr?.error ?? ""]
      : ["graph", "Loading history…", ""];
    return v_flex().flex_1().min_h(0).items_center().justify_center().gap(10).px(28).pb(40)
      .child(div().size(46).rounded(12).bg(t.raised).border_1().border_color(t.border).flex().items_center().justify_center()
        .child(svg(icon(glyph)).size(22).text_color(s === "error" ? t.ansi1 : t.muted)))
      .child(div().text_size(14).font_semibold().text_color(t.foreground).child(title))
      .when(Boolean(body), (e) => e.child(div().max_w(280).text_center().text_size(12).text_color(t.muted).child(body)));
  },

};
