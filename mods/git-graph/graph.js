// Modified by Jochen Rau, 2026-11, from rabeeh-ta/herdr-git-graph: see NOTICE.md in this folder.
// The graph itself: Git Graph's table (graph, description, date, author,
// commit) for the focused pane's repository, or `props.folder` when opened as
// a pane. Labels take double-clicks (checkout; a remote label also fast-forwards its local
// branch; a branch checked out in another worktree goes there) and right-clicks (menus).
import { div } from "gpui-kit";
import { v_flex, h_flex, VirtualListScrollHandle, InputState } from "gpui-base";
import { spaces, exec, watchFolder, theme, settings, props, shared, setShared, nextCommand, run, closeOverlay } from "herdr";
import { layoutLanes } from "./lanes.js";
import { UNCOMMITTED, parseStatus, withUncommitted, labelsOf, READ, STATUS } from "./git.js";
import { perform } from "./act.js";
import { location, PAGE, withDefaults, isRefChange, inGitDir, tilde, sameFiles, scopeOf, SEEN, keep, depthSetting, tagsShown } from "./common.js";
import { folderState, readFolder, readLog } from "./reads.js";
import { platform } from "./tools.js";
import { passBehind } from "./lib/behind.js";
import { runTestKey } from "./lib/testkeys.js";

export class Graph {
  init(cx) {
    bindEscape(cx);
    this.folder = props()?.folder ?? null; this.folderOn = props()?.on ?? null;
    // A scrollbar finds its list by name: each copy (panel, pane) needs its own.
    this.listId = `graph-rows-${Math.random().toString(36).slice(2)}`;
    this.diffId = `${this.listId}-diff`;
    this.all = true; this.remotes = true; this.wide = false; this.graphMax = 160; this.scale = null;
    this.watchToken = 0; this.seenChange = shared("git-graph.changed");
    this.cols = withDefaults(); this.drag = null;
    this.seen = new Map(); this.commitDetails = new Map();
    // Fetch all: its progress for one Manygit folder, and each repository's last failure.
    this.fetchAll = null; this.fetchErrors = new Map();
    // Manygit's .git watchers, one per repository, kept while it's listed (see watchRepos).
    this.watched = new Set();
    // Herdr's agents per machine, for a row's "New … tab" (as its + menu lists them).
    this.agents = new Map();
    this.handle = cx.focus_handle();
    // Local change: opened as a dialog (cmd+g), the graph takes the keyboard.
    this.dialog = Boolean(props()?.overlay); this.overlay = props()?.overlay ?? null;
    // The space it was opened in: worktrees open as tabs there.
    this.home = spaces().find((s) => s.active)?.id ?? null;
    // Nothing is over a graph that just opened: a count left from a close that never came starts again.
    if (this.dialog) setShared("git-graph.popups", 0);
    this.scrollHandle = VirtualListScrollHandle.new(); this.cursor = null;
    this.fileScroll = VirtualListScrollHandle.new(); this.diffScroll = VirtualListScrollHandle.new();
    this.zone = "graph"; this.fileAt = 0; this.diffAt = 0;
    { const v = Number(shared("git-graph.split")); this.split = v > 0 ? v : null; }
    // Local change: the review's file list width, dragged (remembered), else a third of it.
    { const v = Number(shared("git-graph.files-width")); this.filesSplit = v > 0 ? v : null; }
    // Local change: `c` reviews everything since the base branch instead of the one commit.
    this.sinceBase = shared("git-graph.since") === true;
    // Local change: the diff ignores whitespace (w); long lines scroll sideways, or wrap (⇧W).
    this.ignoreSpace = shared("git-graph.ignore-space") === true; this.wrapLines = shared("git-graph.wrap") === true; this.diffX = 0;
    // Local change: another mod can open the graph on one review, e.g. the fleet board's diff of a bead:
    // props.review = { head, base, title } reviews everything from the merge-base of base and head up to
    // head (git diff base...head), for this copy only.
    this.ask = props()?.review?.head ? { ...props().review, done: false } : null;
    if (this.ask) this.sinceBase = true;
    // Local change: props.pr = "owner/repo#n": the PR view (see pr.js), on that PR's repository and range.
    this.prInit(cx);
    // `/` search over the loaded commits; `b` branch picker.
    this.search = { query: "", matches: [], typing: false };
    this.searchInput = InputState.new({ placeholder: "Search messages, authors, hashes, branches" });
    this.searchInput.on("focus", (_e, cx) => { this.search.typing = true; cx.notify(); });
    // Left empty, the field goes away again.
    this.searchInput.on("blur", (_e, cx) => { this.search.typing = false; if (!this.search.query) this.search.open = false; cx.notify(); });
    this.searchInput.on("change", (_e, cx) => { this.search.query = this.searchInput.value(); this.runSearch(cx); });
    this.searchInput.on("submit", (_e, cx) => { this.handle.focus(); cx.notify(); });
    this.bp = null; this.bpScroll = VirtualListScrollHandle.new();
    // `R`: the repository switcher (see openRepos).
    this.rp = null; this.rpScroll = VirtualListScrollHandle.new();
    this.rpInput = InputState.new({ placeholder: "Repository" });
    this.rpInput.on("change", (_e, cx) => { if (this.rp) { this.rp.query = this.rpInput.value(); this.rp.at = 0; } cx.notify(); });
    this.rpInput.on("submit", (_e, cx) => this.rpChoose(cx));
    this.bpInput = InputState.new({ placeholder: "Branch or tag" });
    this.bpInput.on("change", (_e, cx) => { if (this.bp) { this.bp.query = this.bpInput.value(); this.bp.at = 0; } cx.notify(); });
    this.bpInput.on("submit", (e, cx) => this.bpChoose(Boolean(e?.modifiers?.shift), cx));
    if (this.dialog) { this.handle.focus(); cx.timer.after(300, () => this.handle.focus()); }
    this.reset();
    this.refresh(cx);
    cx.timer.after(1500, (cx) => this.warm(cx));
    // Local change: keys.json's "mod:git-graph" section: ⌘↑ ⌘↓ step through the PRs in the PR view, and switch
    // spaces as they do everywhere else in a plain graph.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^git-graph\./, ""), inDialog = Boolean(props()?.overlay);
        // The demo's scripts press keys here (lib/testkeys.js); off outside the demo. Esc goes the way the key does
        // (its action); keys that change a repository or reach GitHub aren't pressed.
        if (await runTestKey("git-graph", c, cx, (e, kcx) => (e.keystroke === "escape" ? this.escapeKey(kcx) : this.onKey?.(e, kcx)),
          () => this.testState(), (k) => this.testRefuses(k))) { cx.notify(); continue; }
        // The window's keys (tabs, spaces, agents, panes): kept while it's a dialog (keys.json's mod:git-graph).
        if (passBehind(c, inDialog, run)) { cx.notify(); continue; }
        if (c === "prev-pr" || c === "next-pr") {
          if (this.prPick) this.prPickMove(c === "next-pr" ? 1 : -1);
          else if (this.prMode()) this.prStep(c === "next-pr" ? 1 : -1, cx); else if (!inDialog) run(c === "next-pr" ? "space.next" : "space.prev");
        }
        cx.notify();
      }
    });
    // Remote spaces can't be watched: poll them gently. New folders get read ahead.
    // The Manygit list re-reads too: edits in a working tree don't touch .git.
    cx.timer.every(15000, (cx) => { if (!this.watching || this.state === "workspace") this.refresh(cx, true, true); this.warm(cx); });
  }

  key() { return JSON.stringify(location(this.folder, this.folderOn)); }

  reset() {
    Object.assign(this, folderState());
    this.watchToken++; this.watching = null; this.picking = false;
    this.cancelWatches();
  }

  // Pending watches count against Herdr's limit (64 a mod): a loop that's no longer wanted is cancelled,
  // not left waiting for that folder's next change.
  cancelWatches() {
    for (const h of this.watchHandles ?? []) h.cancel();
    this.watchHandles = [];
  }

  // Leaving a folder keeps it as it was; coming back shows that at once, while refresh reads it again.
  enter(context) {
    if (this.context && ["ready", "empty", "norepo", "workspace"].includes(this.state)) {
      keep(this.seen, this.context, Object.fromEntries(Object.keys(folderState()).map((k) => [k, this[k]])), SEEN);
    }
    this.context = context; this.reset(); this.loading = null;
    const kept = this.seen.get(context);
    if (kept && (kept.state === "workspace" || (kept.state === "norepo" ? !kept.warmed : kept.scope === scopeOf(this)))) {
      Object.assign(this, kept);
      // A folder read ahead has its history but no table yet.
      if (this.root && !this.commits.length) this.build();
    }
  }

  // A load belongs to its folder: a new folder starts at once, and a slower
  // load for the old one finds itself stale and drops its result.
  // timer: the 15 s re-read, which doesn't search a folder again that held no repositories.
  // more: the next page, which reads the log alone (see loadMore).
  refresh(cx, full = true, timer = false, more = false) {
    if (this.prWaiting()) return; // the PR view: its repository isn't known yet
    const { cwd, on } = location(this.folder, this.folderOn), context = this.key();
    if (context !== this.context) { this.enter(context); full = true; }
    if (!cwd) { this.state = "nofolder"; return; }
    // A repository opened from the Manygit list loads in place of the folder.
    const { all, remotes, limit } = this, opened = this.opened, revs = this.prRevs ?? null;
    const loadKey = JSON.stringify([context, opened]);
    // A page asked for during a load waits for it, then reads everything: the load had the old limit.
    if (this.loading?.key === loadKey) { this.again = this.again === "full" || full || more ? "full" : "status"; return; }
    // Each load has its own id: opening a repository and coming back can't revive an older one.
    const id = this.loadSeq = (this.loadSeq ?? 0) + 1;
    this.loading = { key: loadKey, id }; this.again = null;
    const stale = () => this.loadSeq !== id || this.key() !== context;
    cx.spawn(async (cx) => {
      try {
        if (more && this.root && this.state === "ready") {
          const { root, on: at, refSignature } = this;
          const log = await readLog((args) => exec("git", [...READ, ...args], { cwd: root, on: at }), { all, remotes, limit, revs }, JSON.stringify([opened ?? cwd, on]));
          if (stale()) return;
          if (log.error) throw new Error(log.error);
          Object.assign(this, { base: log.base, hasMore: log.hasMore, limit, signature: `${log.text}\0${refSignature}` });
        } else if (full || !this.root) {
          const read = await readFolder(opened ?? cwd, on, { all, remotes, limit, revs });
          if (stale()) return;
          if (read.state === "norepo") {
            if (opened) { this.state = "error"; this.error = `${tilde(opened, on)} isn't a git repository any more.`; return; }
            await this.scan(cwd, on, stale, cx, timer); return;
          }
          if (!opened) { this.workspace = null; this.stopRepoWatches(); }
          if (!on) this.watch(read.root, context, cx);
          // A second look that finds nothing new leaves the table as it is.
          const shown = this.state === "ready" || this.state === "empty";
          // (A review asked for still opens: the PR view coming back to a PR whose history didn't change.)
          if (shown && read.signature === this.signature && read.scope === this.scope && sameFiles(read.files, this.files)) return this.openAsked(cx);
          Object.assign(this, read);
        } else {
          const status = await exec("git", [...READ, ...STATUS], { cwd: this.root, on: this.on });
          if (stale()) return;
          const files = status.code === 0 ? parseStatus(status.stdout) : [];
          if (sameFiles(files, this.files)) return;
          this.files = files;
        }
        this.build();
        if (this.selected === UNCOMMITTED && this.details) this.loadDetails(this.commits[0], cx);
        this.checkBase(cx);
        this.openAsked(cx);
      } catch (e) {
        if (!stale()) { this.state = "error"; this.error = String(e?.message ?? e); }
      } finally {
        if (this.loading?.id === id) {
          this.loading = null; cx.notify();
          if (this.again) this.refresh(cx, this.again === "full");
        }
      }
    });
  }

  build() {
    // Local change: the PR view leaves your checkout's uncommitted changes out (they aren't the PR's).
    const commits = withUncommitted(this.base, this.prRevs ? 0 : this.files.length, this.head);
    const { rows, width } = layoutLanes(commits);
    this.commits = commits; this.rows = rows; this.lanes = width;
    this.labels = new Map(commits.map((c) => [c.hash, labelsOf(c, this.remotes, this.worktrees)]));
    this.index = new Map(commits.map((c, i) => [c.hash, i]));
    this.ctx = { root: this.root, on: this.on, current: this.current, head: this.head, branches: this.branches, tracking: this.tracking, worktrees: this.worktrees ?? {}, mainRoot: this.mainRoot ?? null, remotes: this.remoteNames, overlay: this.overlay, space: this.home };
    this.state = commits.length ? "ready" : "empty"; this.error = null;
    if (this.selected && !this.index.has(this.selected)) { this.selected = null; this.details = null; this.diff = null; }
    if (this.search?.query) this.indexMatches();
  }

  // Ref moves reload the history; other edits only the uncommitted row, at most every 1.5 s.
  watch(root, context, cx) {
    if (this.watching === root) return;
    this.cancelWatches(); // the last repository's watches
    this.watching = root;
    // A token of its own: the cancelled loops of the last repository see a newer one and end quietly,
    // instead of clearing `watching` for this one.
    const token = ++this.watchToken;
    const loop = (dir, gitDir) => cx.spawn(async (cx) => {
      try {
        while (token === this.watchToken) {
          // Windows reports backslashes; the ref checks read slashes.
          const handle = watchFolder(dir);
          (this.watchHandles ??= []).push(handle);
          const paths = (await handle).map((p) => p.replace(/\\/g, "/"));
          this.watchHandles = this.watchHandles.filter((h) => h !== handle);
          if (token !== this.watchToken) return;
          if (paths.some((p) => (gitDir || inGitDir(p)) && isRefChange(p))) this.refresh(cx, true);
          // A file changed, or the index did (git add, git rm --cached in a terminal): the uncommitted list.
          else if (paths.some((p) => (!gitDir && !inGitDir(p)) || /\/index$/.test(p))) this.statusSoon(cx);
        }
      } catch { if (token === this.watchToken) this.watching = null; }
    });
    loop(root, false);
    // A linked worktree keeps its refs in the main checkout's .git.
    cx.spawn(async (cx) => {
      const common = (await exec("git", [...READ, "rev-parse", "--git-common-dir"], { cwd: root })).stdout.trim();
      const dir = /^([a-zA-Z]:)?[\\/]/.test(common) ? common : `${root}/${common}`;
      if (token === this.watchToken && this.key() === context && !dir.startsWith(`${root}/`)) loop(dir, true);
    });
  }

  statusSoon(cx) {
    if (this.statusTimer) return;
    this.statusTimer = true;
    cx.timer.after(Math.max(0, 1500 - (Date.now() - (this.lastStatus ?? 0))), (cx) => {
      this.statusTimer = false; this.lastStatus = Date.now(); this.refresh(cx, false);
    });
  }

  loadMore(cx) { this.limit += PAGE; this.refresh(cx, true, false, true); cx.notify(); }
  setScope(all, cx) { if (this.all !== all || this.prRevs) { this.all = all; this.prRevs = null; this.limit = PAGE; this.refresh(cx); } cx.notify(); }
  setRemotes(cx) { this.remotes = !this.remotes; this.refresh(cx); cx.notify(); }

  fetch(cx) {
    if (this.fetching || !this.ctx) return;
    this.fetching = true;
    const ctx = this.ctx;
    cx.spawn(async (cx) => {
      await perform({ type: "fetch" }, {}, ctx).catch(() => {});
      this.fetching = false; this.refresh(cx); cx.notify();
    });
    cx.notify();
  }

  // ---- drawing

  // What a test key script checks (lib/testkeys.js): what has the keyboard and what's open, in Esc's order.
  testState() {
    return {
      shown: Boolean(props()?.overlay), state: this.state ?? null, pr: Boolean(this.prMode?.()), fromGraph: Boolean(this.pr?.fromGraph),
      help: Boolean(this.help), repos: Boolean(this.rp), branches: Boolean(this.bp), search: Boolean(this.search?.open),
      searchTyping: Boolean(this.search?.typing), query: this.search?.query ?? "", mark: Boolean(this.mark), picking: Boolean(this.picking),
      review: Boolean(this.selected), opened: Boolean(this.opened), cursor: this.cursorIndex?.() ?? null, rows: this.commits?.length ?? 0,
      index: this.cursorIndex?.() ?? -1, atEnd: (this.commits?.length ?? 0) > 0 && this.cursorIndex?.() === this.commits.length - 1,
    };
  }

  // Keys a test script may not press (lib/testkeys.js): ones that fetch, pull, push, commit or branch, open an
  // editor or a tab, use the clipboard, and in the PR view ones that post, resolve or type into an agent's session.
  testRefuses(k) {
    if (["f", "shift-f", "shift-p", "shift-c", "shift-b", "space", "o", "d", "t", "y", "cmd-enter"].includes(k)) return "it changes the repository, reaches GitHub or leaves the view";
    const pr = this.pr && !this.pr.lite;
    if (pr && (k === "shift-r" || ["w", "a", "u", "s"].includes(k) || (k === "enter" && this.pr.confirm))) return "in the PR view it posts, resolves or answers";
    return null;
  }

  // Esc, from its action (see bindEscape): the key handler's own steps; with nothing of ours left to close, the
  // dialog closes (an action passed on unhandled reaches Herdr as an unknown command, not as its Esc).
  escapeKey(cx) {
    this.escLeft = false;
    this.onKey?.({ key: "escape", keystroke: "escape", modifiers: {} }, cx);
    this.escAt = Date.now();
    if (this.escLeft && props()?.overlay) closeOverlay(props().overlay);
  }

  render(cx) {
    if (this.key() !== this.context) this.refresh(cx);
    const changed = shared("git-graph.changed");
    const savedCols = shared("git-graph.columns"), seen = JSON.stringify(savedCols ?? null);
    if (!this.drag && seen !== this.seenCols) { this.seenCols = seen; this.cols = withDefaults(savedCols); }
    const fetched = shared("git-graph.fetched");
    if (fetched?.at !== this.seenFetched) { this.seenFetched = fetched?.at; if (fetched?.root) this.fetchErrors.delete(fetched.root); }
    // After an action (here, or from a Manygit row's menu) the graph or the list reads again.
    if (changed !== this.seenChange) { this.seenChange = changed; if (this.root || this.state === "workspace") this.refresh(cx); }
    // New settings: a depth searches again, tags read every row again.
    const setting = `${depthSetting()} ${tagsShown()}`;
    if (setting !== this.seenSetting) { const first = this.seenSetting === undefined; this.seenSetting = setting; if (!first && !this.opened) this.refresh(cx); }
    if ((this.pendingJump || this.pendingSearch) && !this.loading && !this.resolving) {
      this.resolving = true;
      cx.timer.after(0, (cx) => { this.resolving = false; this.resolvePending(cx); });
    }
    if (this.selected && this.details?.files?.length) this.syncDiff(cx);
    this.returnFromViewer(cx);
    this.returnFromPopup(cx);
    const t = theme(), mono = settings().font_family ?? "JetBrains Mono", ready = this.state === "ready";
    this.prSlug(cx); // for the PR stage on branches
    this.prFollow(cx); // the PR view: another PR asked for
    const graph = v_flex().id("git-graph").size_full().min_h(0).when(!this.prMode(), (e) => e.rounded(10).border_1().border_color(t.border)).overflow_hidden().bg(t.background)
      .text_color(t.foreground).text_size(TYPE.body).track_focus(this.handle)
      .key_context("GitGraph").on_action("git_graph_escape", (_a, cx) => this.escapeKey(cx))
      .on_mouse_move((e, cx) => this.moveDrag(e, cx))
      .on_mouse_up("left", (_e, cx) => this.endDrag(cx))
      // A drag ends when the pointer leaves (a release outside never arrives); in the PR view, the whole frame.
      .on_hover((hovered, cx) => { if (!hovered && !this.prMode()) this.endDrag(cx); })
      .on_key_down(this.onKey = (e, cx) => {
        if (e.keystroke === "ctrl-[") e = { ...e, key: "escape", keystroke: "escape" }; // ⌃[ is Esc, as in vim
        if (e.keystroke === "escape" && Date.now() - (this.escAt ?? 0) < 300) return; // the action had it
        const k = e.keystroke;
        // The help panel: any key closes it.
        if (this.help) { if (!/^(shift|ctrl|alt|cmd|platform|fn)$/.test(k)) { this.help = false; cx.notify(); } cx.stop_propagation(); return; }
        // The repository switcher's field has the keyboard: ↑↓ move, esc (or ⇥) back (⏎ arrives as its submit).
        if (this.rp) {
          const rows = this.rpRows(), move = (d) => { this.rp.at = Math.max(0, Math.min(rows.length - 1, this.rp.at + d)); this.rpScroll.scroll_to_item(this.rp.at); };
          if (k === "down" || k === "ctrl-n" || k === "ctrl-j") move(1);
          else if (k === "up" || k === "ctrl-p" || k === "ctrl-k") move(-1);
          else if (k === "pagedown") move(15);
          else if (k === "pageup") move(-15);
          else if (k === "tab" || k === "shift-tab") return this.closeRepos(cx), cx.stop_propagation();
          // Local change: esc back to the graph (the field keeps ⇥); esc there closes the dialog.
          else if (k === "escape") this.closeRepos(cx);
          else return;
          cx.stop_propagation(); cx.notify(); return;
        }
        // The branch picker's field has the keyboard: ↑↓ move, esc (or ⇥) back (⏎ / ⇧⏎ arrive as its submit).
        if (this.bp) {
          const rows = this.bpRows(), move = (d) => { this.bp.at = Math.max(0, Math.min(rows.length - 1, this.bp.at + d)); this.bpScroll.scroll_to_item(this.bp.at); };
          if (k === "down" || k === "ctrl-n" || k === "ctrl-j") move(1);
          else if (k === "up" || k === "ctrl-p" || k === "ctrl-k") move(-1);
          else if (k === "pagedown") move(15);
          else if (k === "pageup") move(-15);
          else if (k === "tab" || k === "shift-tab") return this.closeBranches(cx), cx.stop_propagation();
          else if (k === "escape") this.closeBranches(cx);
          else if (!this.bpAction(k, cx)) return;
          cx.stop_propagation(); cx.notify(); return;
        }
        // Typing a search: ↑↓ step through matches, esc (or ⇥) back to the graph; letters are the query's.
        if (this.search.typing) {
          if (k === "down" || k === "ctrl-n" || k === "ctrl-j") this.searchStep(1, cx);
          else if (k === "up" || k === "ctrl-p" || k === "ctrl-k") this.searchStep(-1, cx);
          // Esc (or ⇥, ⏎) back to the graph with the matches kept for n N (⌫ clears them); esc there goes on as usual.
          else if (k === "tab" || k === "shift-tab" || k === "escape") this.handle.focus();
          else return;
          cx.stop_propagation(); cx.notify(); return;
        }
        // Local change: a mark (v) waiting for its second commit: esc drops it first.
        if (k === "escape" && this.mark && !this.picking && !this.planTyping && !this.prPick) { this.mark = null; cx.stop_propagation(); cx.notify(); return; }
        if (this.prKey(e, cx)) { cx.stop_propagation(); cx.notify(); return; }
        if (k === "shift-r" && !this.search.typing) { this.openRepos(cx); cx.stop_propagation(); return; }
        if (this.state === "ready" && !this.picking && this.zoneKey(e, cx)) { cx.stop_propagation(); return; }
        if (this.state === "ready" && !this.picking) {
          // Lowercase reads (fetch, refresh); a change to branches takes Shift.
          const act = { f: () => this.fetch(cx), "shift-f": () => this.syncAction("ff", cx), "shift-p": () => this.syncAction("push", cx),
            "shift-c": () => this.syncAction("commit", cx), r: () => this.refresh(cx), "shift-b": () => this.newBranch(), p: () => this.openCursorPr(cx),
            "?": () => { this.help = true; }, "shift-/": () => { this.help = true; } }[e.keystroke];
          if (act) { act(); cx.stop_propagation(); cx.notify(); return; }
          if (this.navKey(e, cx)) { cx.stop_propagation(); return; }
        }
        if (e.key !== "escape" || !(this.selected || this.opened)) { if (e.key === "escape") this.escLeft = true; return; }
        // Esc closes the dropdown, then the review (back to the graph, the cursor where it was),
        // then goes back to the Manygit list; with nothing open it closes the dialog.
        if (this.picking) this.picking = false; else if (this.selected) this.closeDetails(cx); else this.back(cx);
        cx.stop_propagation(); cx.notify();
      })
      .on_size_change((size, cx) => {
        const width = size.width / this.unit(), wide = width >= 600, graphMax = Math.max(60, Math.round(width * 0.4));
        this.width = width;
        if (wide !== this.wide || graphMax !== this.graphMax) { this.wide = wide; this.graphMax = graphMax; cx.notify(); }
        const height = size.height / this.unit();
        if (Math.abs(height - (this.height ?? 0)) > 1) { this.height = height; if (this.selected) this.keepCursorVisible(cx); cx.notify(); }
      })
      .child(this.header(t))
      .when(this.prMode(), (e) => e.child(this.prBar(t, mono)))
      .when(Boolean(this.rp), (e) => e.child(this.repoPanel(t)))
      .when(!this.rp && this.state === "workspace", (e) => e.child(this.workspaceList(t)))
      .when(Boolean(this.picking && this.workspace && this.opened), (e) => e.child(this.picker(t)))
      .when(!this.rp && ready && Boolean(this.help), (e) => e.child(this.helpPanel(t)))
      .when(!this.rp && ready && !this.help && Boolean(this.bp), (e) => e.child(this.branchPanel(t)))
      .when(!this.rp && ready && !this.help && !this.bp, (e) => e.child(this.toolbar(t))
        // Local change: a straight PR's graph folds to one line, the review below gets the room (pr.js).
        .when(this.prFolded(), (el) => el.child(this.prFoldLine(t, mono)))
        .when(!this.prFolded(), (el) => el.child(this.columns(t, this.graphWidth())).child(this.list(t, mono)))
        .when(Boolean(this.selected), (el) => el.child(this.detailsPane(t, mono))))
      .when(!this.rp && !ready && this.state !== "workspace", (e) => e.child(this.empty(t)));
    // The PR view: pr-board's queue beside the graph (when asked for, ⇧L), one frame around both.
    // Drags that start on its edges (the list's width) move over the list too: the frame passes them on.
    return !this.prMode() ? graph : h_flex().id("git-graph-pr").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .on_mouse_move((e, cx) => this.moveDrag(e, cx)).on_mouse_up("left", (_e, cx) => this.endDrag(cx))
      .on_hover((hovered, cx) => { if (!hovered) this.endDrag(cx); })
      .when(Boolean(this.railOn), (e) => e.child(this.prRail(t, mono)).child(this.railHandle(t))).child(div().flex_1().min_w(0).h_full().child(graph));
  }
}

// Esc (and ⌃[) as an action of this board's own: Herdr binds Esc to close the dialog or popup, and a text field
// binds it too, both ahead of any key handler. A binding of our own in this board's context, and one for a text
// field directly in it, come first (as Herdr's own menus do); the board then steps back itself.
let escBound = false;
function bindEscape(cx) {
  if (escBound) return;
  escBound = true;
  try { cx.bind_keys(["escape", "ctrl-["].flatMap((keystroke) => [{ keystroke, action: "git_graph_escape", context: "GitGraph" }, { keystroke, action: "git_graph_escape", context: "GitGraph > Input" }])); } catch {}
}

// The class's methods live in these modules by topic; `this` is the Graph in all of them.
import { ManygitMethods } from "./manygit.js";
import { PickersMethods } from "./pickers.js";
import { ReviewMethods } from "./review.js";
import { TableMethods } from "./table.js";
import { PrMethods } from "./pr.js";
import { TYPE } from "./lib/type.js";
Object.assign(Graph.prototype, ManygitMethods, PickersMethods, ReviewMethods, TableMethods, PrMethods);
