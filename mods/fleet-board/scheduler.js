// Fleet board: the background work: one worker loop (Herdr wakes one sleeping task a mod reliably), the reads,
// the strip's scan, the tail, the hidden look, the folder watch. Mixed into FleetBoard.
import { props, panes, spaces, run, exec, watchFolder } from "herdr";
import { readSnapshot, fleetBin, readRuns } from "./fleet.js";
import { stateRoot, relevant, summarize, changedRepos, runKey } from "./snapshot.js";
import { IDLE_POLL, SCAN_EVERY, DIRTY_EVERY, HIDDEN_CHECK, MIN_GAP, TAIL_EVERY } from "./model.js";
import { shown, load, save, focusedFolder, targetOf, splitTarget } from "./env.js";

export const SchedulerMethods = {
  // What to read (a target: a folder, or a folder and one of its epics): the run you chose (the run list,
  // ⌘← ⌘→), else the one on screen. Focusing a terminal elsewhere doesn't switch runs. Only with none shown
  // yet: the run shown last (kept across restarts), else the focused terminal's folder, unless it had no run
  // a moment ago.
  wanted() {
    if (props()?.repo) return props().repo; // a layout block pinned to one repository
    if (this.pin) return this.pin.target;
    if (this.target) return this.target;
    const first = load() ?? focusedFolder();
    if (!first) return null;
    const at = this.tried.get(first);
    return at && Date.now() - at < 60000 ? null : first;
  },

  tick(cx) {
    // Watchdog: the worker marks each pass; silent for 40 s (its task died), a new one takes over.
    if (Date.now() - this.beat > 40000) {
      this.gen += 1; this.beat = Date.now(); this.loading = false; this.request = "force";
      cx.spawn((cx) => this.worker(cx, this.gen));
    }
    // Hidden: nothing to read until it shows again; then the run on screen and every other run, at once.
    if (!shown()) { this.hidden = true; return; }
    if (this.hidden) { this.hidden = false; this.dirty.add("*"); this.refresh(cx, true); return; }
    const want = this.wanted();
    if (want && !this.sameRun(want)) { // another run chosen: its last snapshot now, a fresh one next
      const cached = this.snaps.get(want);
      if (cached) this.show(cx, cached, want, true);
      this.refresh(cx, true);
    }
    else if (Date.now() - this.last > IDLE_POLL) this.refresh(cx);
    // Elapsed times move, but they show whole minutes: redraw for the clock every 10 s, not on every tick
    // (a change in the run redraws at once by itself).
    else if (Date.now() - (this.clockAt ?? 0) >= 10000) { this.clockAt = Date.now(); cx.notify(); }
  },

  // The run on screen? A worktree or subfolder of its repository is the same folder; a folder without an epic
  // means the repository's current one (the epic on screen, once shown).
  sameRun(target) {
    if (!this.target || !target) return false;
    const a = splitTarget(target), b = splitTarget(this.target), shownEpic = this.s?.epic.id ?? null;
    const sameFolder = a.cwd === b.cwd || a.cwd.startsWith(b.cwd + "/") || b.cwd.startsWith(a.cwd + "/");
    return sameFolder && (a.epic ?? shownEpic) === (b.epic ?? shownEpic);
  },

  // Asks for a read; the reader task does it (every await there uses that task's own context).
  refresh(cx, force = false) {
    this.request = force ? "force" : (this.request || "soft");
    cx.notify();
  },

  // One `fleet status --json` (exec's own timeout ends a slow one; a lost one is the watchdog's).
  timed(_cx, target) {
    const { cwd, epic } = splitTarget(target);
    return readSnapshot(cwd, epic);
  },

  // The worker: started in init, so its context outlives every await. Each pass sleeps once, then does the
  // first job that is due: the read you asked for (a focus change, a chip, a change on disk), else the tail,
  // else a step of the strip's scan; hidden, the look for new waits. A pass with nothing due (most of them)
  // ends there, without walking the layout to see whether the pane shows.
  async worker(cx, gen) {
    while (gen === this.gen) {
      this.beat = Date.now();
      await cx.sleep(200);
      if (gen !== this.gen) return;
      if (this.pendingFocus) { const f = this.pendingFocus; this.pendingFocus = null; f.focus(); } // drawn by now
      if (!this.due()) continue;
      try {
        if (shown()) {
          if (await this.readStep(cx, gen)) continue;
          if (await this.tailStep(cx)) continue;
          await this.scanStep(cx);
        } else if (!props()?.overlay) await this.lookStep(cx);
      } catch { /* the next pass tries again */ }
    }
  },

  // Whether any job could run this pass, from clocks and flags alone. `hidden` is tick's last look (every 2 s):
  // a pane just hidden or shown is at most one tick behind, and tick asks for the read on showing again.
  due() {
    const now = Date.now();
    if (this.hidden) return !props()?.overlay && now >= this.nextLook;
    if (this.request && (this.request === "force" || now - this.last >= MIN_GAP)) return true;
    if (this.tailDue()) return true;
    return now - this.scanAt > SCAN_EVERY || this.dirty.has("*")
      || (this.dirty.size > 0 && now - (this.rescanAt ?? 0) >= DIRTY_EVERY);
  },

  // The read that was asked for, if one is due (the pane shows: the worker looked). True when it read.
  async readStep(cx, gen) {
    const want = this.request;
    if (!want) return false;
    const cwd = this.wanted();
    if (!cwd) { this.request = null; return false; }
    if (want !== "force" && Date.now() - this.last < MIN_GAP) return false; // waits its turn
    this.request = null;
    this.loading = true;
    cx.notify();
    try {
      const r = await this.timed(cx, cwd);
      if (gen !== this.gen) return true; // a newer worker took over meanwhile
      // You moved on while it read (a chip, ⌘← ⌘→, another folder): drop it, don't flip back to that run.
      if (this.wanted() !== cwd) { this.loading = false; this.request ??= "force"; return true; }
      this.last = Date.now();
      if (r.ok) {
        this.problem = null;
        this.tried.delete(cwd);
        this.show(cx, r.snap, cwd);
      } else {
        this.tried.set(cwd, Date.now()); // not again for a minute, whatever went wrong
        // The last run stays on screen; the footer says the focused folder has none.
        this.problem = { ...r, cwd };
        // Nothing shown yet (a fresh start somewhere without a run): the repo shown last time,
        // else the first of the spaces' folders with a run, one with a wave running first.
        if (!this.s) {
          const pin = this.pin;
          const found = await this.findElsewhere(cx, cwd);
          // Only if nothing changed meanwhile: a newer worker, a chip picked.
          if (found && gen === this.gen && this.pin === pin && !this.s) this.show(cx, found.snap, found.cwd);
        }
      }
    } catch (e) {
      this.problem = { kind: "error", message: String(e?.message ?? e), cwd };
    }
    this.loading = false;
    cx.notify();
    return true;
  },

  async findElsewhere(cx, skip) {
    const seen = new Set([skip]), list = [];
    const add = (f) => { if (f && !seen.has(f) && !this.tried.has(f)) { seen.add(f); list.push(f); } };
    add(load());
    for (const sp of spaces()) add(sp.folder);
    for (const p of panes()) add(p.cwd);
    // All at once, four at a time: one after another took seconds before a fresh pane showed a run.
    // The first in the list's order wins, one with a wave running first, as before.
    const found = new Array(Math.min(list.length, 10)).fill(null);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, found.length) }, async () => {
      // A wave running ends the search: every folder before it is read or being read, so the pick is the same.
      while (next < found.length && !found.some((x) => x?.snap.epic.wave.running)) {
        const i = next++, f = list[i], r = await this.timed(cx, f);
        if (r.ok) found[i] = { snap: r.snap, cwd: f }; else this.tried.set(f, Date.now());
      }
    }));
    return found.find((x) => x?.snap.epic.wave.running) ?? found.find(Boolean) ?? null;
  },

  // Shows a snapshot of `target` (a folder, or a folder and an epic). `cached`: one kept from earlier (a run
  // picked), shown while a fresh one is read. this.cwd is the folder: fleet's commands run there.
  show(cx, snap, target, cached = false) {
    this.s = snap;
    this.target = target;
    this.cwd = splitTarget(target).cwd;
    if (this.confirm && this.confirm.key !== this.runKey()) this.confirm = null; // asked about another run
    this.remember(target, snap);
    const sum = this.summary(snap, this.cwd);
    this.runs.set(sum.key, sum);
    if (!cached) this.alertParked(snap);
    save(target);
    this.watch(cx, stateRoot(snap.runDir));
  },

  // The last snapshot per target, for instant switching: the 24 used most recently (each holds a whole run).
  remember(target, snap) {
    this.snaps.delete(target);
    this.snaps.set(target, snap);
    while (this.snaps.size > 24) this.snaps.delete(this.snaps.keys().next().value);
  },

  // The bead the tail panel shows: the open one, else the selected one.
  tailBead() {
    const id = this.openId ?? this.selId;
    return id ? this.s?.beads.find((b) => b.id === id) ?? null : null;
  },

  // Reads `fleet tail` for the panel: at once when its bead changes, then every few seconds while that bead
  // is still at work. Only while the panel is open. True when it read.
  // The bead whose tail is due now, or null.
  tailDue() {
    const b = this.tailOn ? this.tailBead() : null;
    if (!b || !b.history.length) return null;
    const active = ["running", "parked", "interrupted", "waiting for CI"].includes(b.state);
    return b.id === this.tail.id && (!active || Date.now() - this.tail.at < TAIL_EVERY) ? null : b;
  },

  async tailStep(cx) {
    const b = this.tailDue();
    if (!b) return false;
    const cwd = this.cwd;
    try {
      // Whole lines (`--full`): without it, fleet's tail cuts each line at a fixed width.
      const r = await exec(await fleetBin(), ["tail", b.id, "--repo", cwd, "--full"], { cwd, timeout: 15000 });
      // eslint-disable-next-line no-control-regex
      const lines = (r.stdout || "").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").split("\n").filter((l) => l.trim());
      this.tail = { id: b.id, lines: lines.slice(-200), at: Date.now(), error: r.code === 0 ? null : (r.stderr || "").trim().replace(/^fleet: /, "") || `fleet tail exited with ${r.code}` };
    } catch (e) {
      this.tail = { id: b.id, lines: [], at: Date.now(), error: String(e?.message ?? e) };
    }
    cx.notify();
    return true;
  },

  // Hidden, the pane reads nothing for the views; this still notices a bead that starts waiting for you,
  // every HIDDEN_CHECK, from `fleet runs --json` (one cheap call for every run).
  async lookStep() {
    if (Date.now() < this.nextLook) return false;
    this.nextLook = Date.now() + HIDDEN_CHECK;
    const listed = await readRuns();
    if (listed) {
      for (const r of listed) this.runs.set(r.key, r);
      this.alertRuns(true);
    }
    return true;
  },

  // The other runs, for the strip: `fleet runs --json` every SCAN_EVERY; in between, only a run whose files
  // changed is read again, as one watch on the whole state root reports it. True when it read something.
  // (A run recorded before agent-fleet kept its repository's path isn't listed; focusing its folder shows it.)
  async scanStep(cx) {
    if (Date.now() - this.scanAt > SCAN_EVERY || this.dirty.has("*")) {
      this.dirty.clear();
      this.scanAt = Date.now();
      const listed = await readRuns();
      // A failed listing keeps the chips there are; the next one comes SCAN_EVERY later.
      if (listed) { this.runs = new Map(listed.map((r) => [r.key, r])); this.alertRuns(); }
      this.watchRoot(cx); cx.notify();
      return true;
    }
    if (!this.dirty.size || Date.now() - (this.rescanAt ?? 0) < DIRTY_EVERY) return false;
    this.rescanAt = Date.now();
    await this.rescan(cx);
    this.alertRuns(); cx.notify();
    return true;
  },

  // The runs whose repository changed: read again (the one on screen is readStep's).
  async rescan(cx) {
    const changed = this.dirty;
    this.dirty = new Set();
    const current = this.s ? this.summary(this.s, this.cwd).key : null;
    for (const run of [...this.runs.values()]) {
      if (run.key === current || !changed.has(run.repoName)) continue;
      const target = targetOf(run.cwd, run.epic), r = await this.timed(cx, target);
      if (r.ok) { this.remember(target, r.snap); const sum = summarize(r.snap, run.cwd); this.runs.delete(run.key); this.runs.set(sum.key, sum); }
    }
  },

  // One watch on the state root (~/.local/state/agent-fleet): which repositories' runs change.
  watchRoot(cx) {
    const root = this.s?.runDir ? stateRoot(this.s.runDir).replace(/\/[^/]+$/, "") : null;
    if (!root || this.watchingRoot === root) return;
    this.watchingRoot = root;
    cx.spawn(async (cx) => {
      while (this.watchingRoot === root) {
        let paths;
        try { paths = await watchFolder(root); } catch { if (this.watchingRoot === root) this.watchingRoot = null; return; }
        for (const repo of changedRepos(root, paths)) this.dirty.add(repo);
      }
    });
  },

  // The run list (the title's ▾, ⌘← ⌘→): runs at work or unfinished from the last two weeks ("Active"), then
  // runs finished in the last week; the one on screen always. Each part in a fixed order (repository, then
  // epic), so rows don't move under the pointer and ⌘← ⌘→ always step the same way.
  runList(now) {
    const current = this.runKey(), day = 86400000, recent = (r, days) => r.last && now - r.last < days * day;
    const finished = (r) => (r.finished ?? r.open <= 0) && !r.running && !r.parked;
    const order = (a, b) => `${a.repoName}\0${a.epic}`.localeCompare(`${b.repoName}\0${b.epic}`);
    const all = [...this.runs.values()];
    const active = all.filter((r) => !finished(r) && (r.running || r.parked || recent(r, 14) || r.key === current)).sort(order);
    const done = all.filter((r) => finished(r) && (recent(r, 7) || r.key === current)).sort(order);
    return { active, done, flat: [...active, ...done] };
  },

  // ⌘← ⌘→ (keys.json, while the pane has focus): the run before or after the one shown, in the list's order.
  stepRun(cx, dir) {
    const list = this.runList(Date.now()).flat;
    if (!list.length) return;
    const at = list.findIndex((r) => r.key === this.runKey());
    // Not in the list: → goes to the first run, ← to the last.
    this.choose(cx, list[at < 0 ? (dir > 0 ? 0 : list.length - 1) : (at + dir + list.length) % list.length]);
  },

  // A press outside the open run list closes it.
  closePicker() {
    if (!this.picking) return;
    this.picking = false;
    this.pickClosedAt = Date.now();
  },

  // Opens or closes the run list, its selection on the run shown.
  togglePicker() {
    // The press that closed the list from outside was on the title: its click doesn't open it again.
    if (!this.picking && Date.now() - (this.pickClosedAt ?? 0) < 400) return;
    this.picking = !this.picking;
    if (this.picking) this.pickAt = Math.max(0, this.runList(Date.now()).flat.findIndex((r) => r.key === this.runKey()));
  },

  choose(cx, run) {
    const target = targetOf(run.cwd, run.epic);
    this.pin = { target };
    this.tried.delete(target);
    // At once from the last snapshot of that run; the fresh read replaces it a moment later.
    const cached = this.snaps.get(target);
    if (cached) { this.show(cx, cached, target, true); this.reveal = true; }
    this.request = "force";
    cx.notify();
  },

  // One watch at a time, on the shown run's state directory; another run ends the old loop.
  // One watch at a time: switching runs cancels the last one (a pending watch counts against Herdr's limit),
  // and each loop has its own token, so going back to a run never revives an old loop beside the new one.
  watch(cx, root) {
    if (!root || this.watching === root) return;
    this.watchHandle?.cancel();
    this.watching = root;
    const token = (this.watchToken = {});
    cx.spawn(async (cx) => {
      while (this.watchToken === token) {
        let paths;
        // A watch that fails ends; the worker's IDLE_POLL reads keep the run fresh without it.
        try { this.watchHandle = watchFolder(root); paths = await this.watchHandle; }
        catch { if (this.watchToken === token) { this.watching = null; this.watchHandle = null; } return; }
        if (this.watchToken !== token) return;
        // A soft request: readStep waits MIN_GAP between reads, so a step writing several files reads once.
        if (relevant(root, paths)) this.refresh(cx);
      }
    });
  },

  runKey() { return this.s ? this.summary(this.s, this.cwd).key : null; },

  // summarize() once per snapshot and folder: the strip, ⌘← ⌘→ and the confirm bar ask for it on every frame.
  summary(snap, cwd) {
    const memo = (this.sums ??= new WeakMap()).get(snap);
    if (memo && memo.cwd === cwd) return memo;
    const sum = summarize(snap, cwd);
    this.sums.set(snap, sum);
    return sum;
  },

};
