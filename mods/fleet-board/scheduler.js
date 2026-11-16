// Fleet board: the background work: one worker loop (Herdr wakes one sleeping task a mod reliably), the reads,
// the strip's scan, the tail, the hidden look, the folder watch. Mixed into FleetBoard.
import { props, panes, spaces, run, exec, watchFolder } from "herdr";
import { readSnapshot, fleetBin, readRuns } from "./fleet.js";
import { stateRoot, relevant, summarize, changedRepos, runKey } from "./snapshot.js";
import { IDLE_POLL, SCAN_EVERY, NO_RUN_FOR, DIRTY_EVERY, HIDDEN_CHECK, MIN_GAP, TAIL_EVERY } from "./model.js";
import { shown, load, save, focusedFolder } from "./env.js";

export const SchedulerMethods = {
  // The folder to read: the focused terminal's, unless it had no run a moment ago.
  wanted() {
    if (props()?.repo) return props().repo; // a layout block pinned to one repository
    const cwd = focusedFolder();
    if (this.pin && this.pin.focus === cwd) return this.pin.cwd; // a chip chosen, focus unmoved
    this.pin = null;
    if (!cwd) return this.cwd;
    const at = this.tried.get(cwd);
    if (at && Date.now() - at < 60000) return this.cwd;
    return cwd;
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
    if (want && !this.sameRun(want)) { // focus moved to another repository: its last snapshot now, a fresh one next
      const cached = this.snaps.get(want);
      if (cached) this.show(cx, cached, want, true);
      this.refresh(cx, true);
    }
    else if (Date.now() - this.last > IDLE_POLL) this.refresh(cx);
    // Elapsed times move, but they show whole minutes: redraw for the clock every 10 s, not on every tick
    // (a change in the run redraws at once by itself).
    else if (Date.now() - (this.clockAt ?? 0) >= 10000) { this.clockAt = Date.now(); cx.notify(); }
  },

  // A worktree or subfolder of the repo shown is the same run.
  sameRun(cwd) {
    return Boolean(this.cwd && (cwd === this.cwd || cwd.startsWith(this.cwd + "/") || this.cwd.startsWith(cwd + "/")));
  },

  // Asks for a read; the reader task does it (every await there uses that task's own context).
  refresh(cx, force = false) {
    this.request = force ? "force" : (this.request || "soft");
    cx.notify();
  },

  // One `fleet status --json` (exec's own timeout ends a slow one; a lost one is the watchdog's).
  timed(_cx, cwd) {
    return readSnapshot(cwd);
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
    return Boolean(this.scanQ) || now - this.scanAt > (this.hasRunsList ? SCAN_EVERY : NO_RUN_FOR) || this.dirty.has("*")
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
          const focus = focusedFolder(), pin = this.pin;
          const found = await this.findElsewhere(cx, cwd);
          // Only if nothing changed meanwhile: a newer worker, another folder focused, a chip picked.
          // (Not wanted(): after a failed read it names the last run's folder for a minute, by design.)
          if (found && gen === this.gen && focusedFolder() === focus && this.pin === pin && !this.s) this.show(cx, found.snap, found.cwd);
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

  // Shows a snapshot. `cached`: one kept from earlier (a chip, a focus change), shown while a fresh one is read.
  show(cx, snap, cwd, cached = false) {
    this.s = snap;
    this.cwd = cwd;
    if (this.confirm && this.confirm.key !== this.runKey()) this.confirm = null; // asked about another run
    this.remember(cwd, snap);
    const sum = this.summary(snap, cwd);
    this.runs.set(sum.key, sum);
    if (!cached) this.alertParked(snap);
    save(cwd);
    this.watch(cx, stateRoot(snap.runDir));
  },

  // The last snapshot per folder, for instant switching: the 24 used most recently (each holds a whole run).
  remember(cwd, snap) {
    this.snaps.delete(cwd);
    this.snaps.set(cwd, snap);
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
      // Whole lines (`--full`) where agent-fleet has it; before it, its own tail cuts each line at a fixed width.
      const args = ["tail", b.id, "--repo", cwd];
      let r = await exec(await fleetBin(), this.tailFull === false ? args : [...args, "--full"], { cwd, timeout: 15000 });
      if (this.tailFull !== false && r.code !== 0 && /unrecognized arguments: --full/.test(r.stderr || "")) {
        this.tailFull = false;
        r = await exec(await fleetBin(), args, { cwd, timeout: 15000 });
      } else if (r.code === 0) this.tailFull = true;
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
  // every HIDDEN_CHECK: every run when agent-fleet lists them cheaply, else the last run shown.
  async lookStep(cx) {
    if (Date.now() < this.nextLook) return false;
    this.nextLook = Date.now() + HIDDEN_CHECK;
    const listed = this.hasRunsList !== false ? await readRuns() : null;
    if (listed) {
      this.hasRunsList = true;
      for (const r of listed) this.runs.set(r.key, r);
      this.alertRuns(true);
      return true;
    }
    this.hasRunsList = false;
    const cwd = this.cwd ?? load();
    if (!cwd) return true;
    const r = await this.timed(cx, cwd);
    if (r.ok) { this.s = r.snap; this.cwd = cwd; this.remember(cwd, r.snap); this.last = Date.now(); this.alertParked(r.snap); }
    return true;
  },

  // The other runs, for the strip, one step per worker pass (so a read you ask for never waits behind a whole
  // scan). A full search now and then (every minute with `fleet runs --json`, else every 10 minutes over the
  // spaces' and panes' folders, one folder a step); in between, only a run whose files changed is read again,
  // as one watch on the whole state root reports it. True when it read something.
  async scanStep(cx) {
    if (!this.scanQ) {
      if (Date.now() - this.scanAt > (this.hasRunsList ? SCAN_EVERY : NO_RUN_FOR) || this.dirty.has("*")) {
        this.dirty.clear();
        const listed = await readRuns();
        this.hasRunsList = Boolean(listed);
        if (listed) {
          this.runs = new Map(listed.map((r) => [r.key, r]));
          this.scanAt = Date.now(); this.alertRuns(); this.watchRoot(cx); cx.notify();
          return true;
        }
        const folders = new Set();
        for (const sp of spaces()) if (sp.folder && !sp.machine) folders.add(sp.folder);
        for (const p of panes()) if (p.cwd) folders.add(p.cwd);
        this.scanQ = [...folders]; this.scanSeen = new Set(); this.scanFound = new Map(); this.scanGone = new Set();
        return true;
      }
      if (!this.dirty.size || Date.now() - (this.rescanAt ?? 0) < DIRTY_EVERY) return false;
      this.rescanAt = Date.now();
      await this.rescan(cx);
      this.alertRuns(); cx.notify();
      return true;
    }
    while (this.scanQ.length) {
      const f = this.scanQ.shift();
      if (Date.now() - (this.noRun.get(f) ?? 0) < NO_RUN_FOR) continue;
      // A folder inside a repository already read this scan (a worktree, a subfolder) is that run.
      if ([...this.scanSeen].some((r) => f === r || f.startsWith(r + "/"))) continue;
      const r = await this.timed(cx, f);
      if (!r.ok) { this.noRun.set(f, Date.now()); if (r.kind === "none") this.scanGone.add(f); return true; }
      this.remember(f, r.snap);
      const sum = summarize(r.snap, f);
      this.scanSeen.add(f);
      if (!this.scanFound.has(sum.key)) this.scanFound.set(sum.key, sum);
      return true;
    }
    // Done. The run on screen stays; so does a run found before whose folder couldn't be read this time
    // (only a folder that now says it has no run drops its chip).
    const found = this.scanFound;
    if (this.s && this.cwd) { const cur = this.summary(this.s, this.cwd); if (!found.has(cur.key)) found.set(cur.key, cur); }
    for (const [k, r] of this.runs) if (!found.has(k) && !this.scanGone.has(r.cwd)) found.set(k, r);
    this.runs = found; this.scanQ = null; this.scanAt = Date.now();
    this.alertRuns(); this.watchRoot(cx); cx.notify();
    return true;
  },

  // The runs whose repository changed: read again (the one on screen is readStep's).
  async rescan(cx) {
    const changed = this.dirty;
    this.dirty = new Set();
    const current = this.s ? this.summary(this.s, this.cwd).key : null;
    for (const run of [...this.runs.values()]) {
      if (run.key === current || !changed.has(run.repoName)) continue;
      const r = await this.timed(cx, run.cwd);
      if (r.ok) { this.remember(run.cwd, r.snap); const sum = summarize(r.snap, run.cwd); this.runs.delete(run.key); this.runs.set(sum.key, sum); }
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

  // Chips: every run with a wave running, beads waiting for you or still open, or activity in the last week
  // (a finished one is dimmed, so you can still go back to it).
  chips(now) {
    return [...this.runs.values()]
      .filter((r) => r.running || r.parked || r.open > 0 || (r.last && now - r.last < 7 * 86400000))
      // A fixed order (repository, then epic), so chips don't move under the pointer and ⌘← ⌘→ always step
      // the same way; the red count and the breathing dot say which run needs you or is busy.
      .sort((a, b) => `${a.repoName}\0${a.epic}`.localeCompare(`${b.repoName}\0${b.epic}`));
  },

  // ⌘← ⌘→ (keys.json, while the pane has focus): the run before or after the one shown, in the strip's order.
  stepRun(cx, dir) {
    const list = this.chips(Date.now());
    if (!list.length) return;
    const current = this.s ? this.summary(this.s, this.cwd).key : null;
    const at = list.findIndex((r) => r.key === current);
    // Not on the strip: → goes to the first chip, ← to the last.
    this.choose(cx, list[at < 0 ? (dir > 0 ? 0 : list.length - 1) : (at + dir + list.length) % list.length]);
  },

  choose(cx, run) {
    this.pin = { cwd: run.cwd, focus: focusedFolder() };
    this.tried.delete(run.cwd);
    // At once from the last snapshot of that run; the fresh read replaces it a moment later.
    const cached = this.snaps.get(run.cwd);
    if (cached) { this.show(cx, cached, run.cwd, true); this.reveal = true; }
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
