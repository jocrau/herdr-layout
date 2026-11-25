// Modified by Jochen Rau, 2026-11, from rabeeh-ta/herdr-git-graph: see NOTICE.md in this folder.
// Manygit: the overview of every repository under a folder, its rows, fetch-all and watches. Mixed into Graph.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, exec, watchFolder, props, shared, openOverlay, home, notify, knownAgents, run } from "herdr";
import { menuFor, menuHeight } from "./git.js";
import { icon } from "./menu.js";
import { unsearched, findArgs, parseFound, FETCH, REMOTES, fetchable, parseRemotes, webUrl, syncOf } from "./repos.js";
import { REPO_WATCHES, PAGE, isRefChange, scopeOf, SEEN, keep, depthSetting, tagsShown } from "./common.js";
import { readFolder, readRepo, folderState } from "./reads.js";
import { pool } from "./tools.js";
import { TYPE } from "./lib/type.js";

export const ManygitMethods = {
  stopRepoWatches(keep = new Set()) {
    for (const [path, h] of this.repoWatches ?? []) if (!keep.has(path)) { h.cancel(); this.repoWatches.delete(path); this.watched.delete(path); }
  },

  // Like manygit: read the folders open in other spaces ahead, one at a time, so switching to one shows it at once.
  warm(cx) {
    if (this.folder || this.warming) return;
    const machineOf = new Map(spaces().flatMap((s) => s.tabs.map((tab) => [tab.id, s.machine ?? null])));
    const todo = new Map();
    for (const p of panes()) {
      if (!p.cwd) continue;
      const where = { cwd: p.cwd, on: machineOf.get(p.tab) ?? null };
      todo.set(JSON.stringify(where), where);
    }
    // Other machines answer slower, and may not answer at all: last.
    const order = [...todo].filter(([key]) => key !== this.context && !this.seen.has(key)).sort(([, a], [, b]) => (a.on ? 1 : 0) - (b.on ? 1 : 0));
    if (!order.length) return;
    this.warming = true;
    cx.spawn(async () => {
      try {
        for (const [key, { cwd, on }] of order) {
          const scope = scopeOf(this);
          const read = await readFolder(cwd, on, { all: this.all, remotes: this.remotes, limit: PAGE }).catch(() => null);
          if (read && key !== this.context && !this.seen.has(key) && scope === scopeOf(this)) {
            // A folder that isn't a repository may hold some: entering it searches (Manygit).
            keep(this.seen, key, { ...folderState(), state: read.state ?? "ready", ...read, warmed: read.state === "norepo" }, SEEN);
          }
        }
      } finally { this.warming = false; }
    });
  },

  // Manygit: find the repositories under cwd, then read each one's status.
  async scan(cwd, on, stale, cx, timer) {
    const depth = depthSetting();
    if (timer && this.state === "norepo" && this.cwd === cwd) return;
    if (unsearched(cwd, on ? null : home())) { this.reset(); Object.assign(this, { state: "norepo", cwd, on, skipped: true }); return; }
    const found = await exec("find", findArgs(cwd, depth), { on }).catch(() => ({ stdout: "" }));
    if (stale()) return;
    const repos = parseFound(cwd, found.stdout);
    if (!repos.length) { this.reset(); Object.assign(this, { state: "norepo", cwd, on }); return; }
    // The same list keeps its rows' statuses while they're read again.
    const same = this.workspace?.root === cwd, statuses = same ? this.statuses : new Map();
    if (!same) this.reset();
    this.workspace = { root: cwd, depth, repos }; this.statuses = statuses; this.cwd = cwd; this.on = on; this.state = "workspace";
    if (!on) { this.watching = "workspace"; this.watchRepos(repos, cx); }
    cx.notify();
    await pool(repos, 8, (repo) => this.readStatus(repo.path, on, stale, cx));
  },

  // on: the machine the list was read on, never whatever the panel shows by the time it runs.
  async readStatus(path, on, stale, cx) {
    if (stale()) return;
    const st = await readRepo(path, on, tagsShown()).catch((e) => ({ error: String(e?.message ?? e) }));
    if (stale() || !this.workspace) return;
    if (JSON.stringify(st) !== JSON.stringify(this.statuses.get(path))) { this.statuses.set(path, st); cx.notify(); }
  },

  // A commit, checkout or fetch in a listed repository updates its row (local folders). One loop per
  // repository, for the first REPO_WATCHES of the list only (Herdr allows 64 pending watches a mod); the
  // others update on refresh. A repository that leaves the list has its watch cancelled.
  watchRepos(repos, cx) {
    const want = repos.slice(0, REPO_WATCHES).map((r) => r.path);
    this.stopRepoWatches(new Set(want));
    for (const path of want) {
      if (this.watched.has(path)) continue;
      this.watched.add(path);
      cx.spawn(async (cx) => {
        try {
          for (;;) {
            const handle = watchFolder(`${path}/.git`);
            (this.repoWatches ??= new Map()).set(path, handle);
            const paths = await handle, ws = this.workspace;
            if (!ws || this.on || !ws.repos.some((r) => r.path === path)) break;
            const root = ws.root;
            if (paths.some((p) => isRefChange(p.replace(/\\/g, "/")) || /[/\\]index$/.test(p))) await this.readStatus(path, null, () => this.workspace?.root !== root, cx);
          }
        } catch {} // a worktree's .git is a file: its row updates with the list (or the watch was cancelled)
        this.watched.delete(path); this.repoWatches?.delete(path);
      });
    }
  },

  // Manygit's fetch: every repository with a remote, 8 at a time, each row
  // updated as its fetch ends. It goes on in the background if you open a repository.
  fetchEvery(cx) {
    const ws = this.workspace;
    if (!ws || this.fetchAll?.root === ws.root) return;
    const repos = ws.repos.filter((r) => fetchable(this.statuses.get(r.path))), on = this.on;
    const run = this.fetchAll = { root: ws.root, done: 0, total: repos.length, failed: 0 };
    const stale = () => this.workspace?.root !== run.root;
    cx.spawn(async (cx) => {
      await pool(repos, 8, async (r) => {
        const out = await exec("env", FETCH, { cwd: r.path, on }).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
        if (out.code === 0) this.fetchErrors.delete(r.path);
        else { run.failed++; this.fetchErrors.set(r.path, (out.stderr || "git fetch failed").trim().split("\n").pop()); }
        run.done++;
        await this.readStatus(r.path, on, stale, cx);
        cx.notify();
      });
      if (this.fetchAll === run) this.fetchAll = null;
      const repositories = (n) => `${n} ${n === 1 ? "repository" : "repositories"}`;
      notify(run.failed ? { title: `Fetched ${run.total - run.failed} of ${repositories(run.total)}`, body: "The failed ones show git's error on their row.", level: "warning" }
        : { title: `Fetched ${repositories(run.total)}`, level: "success", timeout: 3000 });
      cx.notify();
    });
    cx.notify();
  },

  // A row's right-click: its remotes and the machine's agents are read first
  // (one quick git call), then the menu opens at the pointer.
  repoMenu(r, cx) {
    const st = this.statuses.get(r.path), on = this.on, where = on ?? "";
    cx.spawn(async (cx) => {
      const [remotes, agents] = await Promise.all([
        exec("git", REMOTES, { cwd: r.path, on }).then((o) => parseRemotes(o.stdout)).catch(() => []),
        // Herdr's + menu keeps the same list: use it at once rather than wait for the shell.
        this.agents.get(where) ?? shared("new-menu.agents")?.[where] ?? knownAgents({ on }).catch(() => []),
      ]);
      const installed = agents.filter((a) => a.installed);
      this.agents.set(where, agents);
      const web = webUrl((remotes.find((x) => x.name === "origin") ?? remotes[0])?.url ?? "");
      const ctx = { root: r.path, on, current: st?.detached ? null : st?.branch ?? null, head: st?.head ?? null, branches: [], remotes: remotes.map((x) => x.name) };
      const target = { kind: "repo", path: r.path, status: st, agents: installed, web };
      openOverlay({ mod: "git-graph", kind: "popup", at: "pointer", width: 268, height: menuHeight(menuFor(target, ctx)), props: { role: "menu", target, ctx } });
      // Ask again in the background, so a newly installed agent shows next time.
      knownAgents({ on }).then((a) => this.agents.set(where, a)).catch(() => {});
    });
  },

  open(path, cx) {
    const { workspace, statuses, cwd, on } = this;
    this.reset(); Object.assign(this, { workspace, statuses, cwd, on, opened: path, state: "loading" });
    this.refresh(cx); cx.notify();
  },

  back(cx) {
    const { workspace, statuses, cwd, on } = this;
    this.reset(); Object.assign(this, { workspace, statuses, cwd, on, state: "workspace" });
    this.refresh(cx); cx.notify();
  },

  // Manygit's repository pane: grouped by folder, each row its branch, uncommitted
  // changes and how it stands against its upstream. A click opens its graph.
  repoRows(t) {
    const repos = this.workspace.repos, grouped = repos.some((r) => r.group);
    const rows = [];
    let height = 8;
    repos.forEach((r, i) => {
      if (grouped && r.group !== repos[i - 1]?.group) {
        rows.push(div().h(26).flex_none().px(14).pt(9).text_size(TYPE.label).text_color(t.dim).truncate().child(r.group ? `${r.group}/` : "./"));
        height += 26;
      }
      rows.push(this.repoRow(r, i, grouped, t));
      height += 34;
    });
    return { rows, height };
  },

  workspaceList(t) {
    return v_flex().id(`${this.listId}-repos`).flex_1().min_h(0).py(4).overflow_y_scrollbar().children(this.repoRows(t).rows);
  },

  // The dropdown under the header while a repository is open: at most 260px, scrolling.
  picker(t) {
    const { rows, height } = this.repoRows(t);
    return v_flex().id(`${this.listId}-picker`).h(Math.min(height, 260)).flex_none().py(4).overflow_y_scrollbar()
      .bg(t.raised).border_b(1).border_color(t.border).children(rows);
  },

  // Opening it reads every row again, since the list stopped watching while the graph showed.
  togglePicker(cx) {
    this.picking = !this.picking;
    if (this.picking) {
      const { repos, root } = this.workspace, on = this.on;
      cx.spawn((cx) => pool(repos, 8, (r) => this.readStatus(r.path, on, () => this.workspace?.root !== root, cx)));
    }
    cx.notify();
  },

  // The name with its status right after it, the branch on the right (as PR #2's
  // picker). Under a folder heading the row steps in, to read as inside it.
  repoRow(r, i, indent, t) {
    const st = this.statuses.get(r.path), fetchError = this.fetchErrors.get(r.path), sync = syncOf(st, fetchError), here = r.path === this.opened;
    // ↑ and ↓ as Herdr's Spaces list draws them (ansi2, ansi1); in sync shows nothing.
    const counts = ["ahead", "behind", "diverged"].includes(sync.kind) && !fetchError;
    const color = { loading: t.dim, error: t.ansi1, unpushed: t.ansi1, gone: t.ansi1, local: t.dim }[sync.kind];
    const label = counts || sync.kind === "ok" ? null : fetchError ? sync.text : { unpushed: "not pushed", error: "error" }[sync.kind] ?? sync.text;
    // A failure (reading it, or its last fetch) shows git's words where the branch goes.
    const problem = st?.error ?? fetchError;
    const branch = st && !problem ? (st.detached ? "detached" : st.branch) : null, tag = !problem && tagsShown() && st?.tag;
    return h_flex().id(`graph-repo-${i}`).h(34).flex_none().pl(indent ? 28 : 14).pr(14).gap(10).items_center().cursor_pointer()
      .when(here, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { if (here) { this.picking = false; cx.notify(); } else this.open(r.path, cx); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); if (st && !st.error) this.repoMenu(r, cx); })
      .child(div().min_w(0).truncate().text_size(TYPE.label).text_color(here ? t.accent : t.foreground).child(r.name))
      .child(h_flex().flex_none().gap(5).items_center().text_size(TYPE.label)
        .when(st?.dirty > 0, (e) => e.child(h_flex().mr(2).gap(4).items_center().text_color(t.blocked)
          .child(div().size(6).rounded(3).bg(t.blocked)).child(String(st.dirty))))
        .when(counts && st.ahead > 0, (e) => e.child(div().text_color(t.ansi2).child(`\u2191${st.ahead}`)))
        .when(counts && st.behind > 0, (e) => e.child(div().text_color(t.ansi1).child(`\u2193${st.behind}`)))
        .when(Boolean(label), (e) => e.child(div().text_color(color).child(label))))
      .child(div().flex_1())
      // The newest tag, just before the branch (Show tags).
      .when(Boolean(tag), (e) => e.child(h_flex().flex_none().max_w(120).gap(4).items_center().text_color(t.dim)
        .child(svg(icon("tag")).size(11).flex_none()).child(div().min_w(0).truncate().text_size(TYPE.label).child(tag))))
      .when(Boolean(branch), (e) => e.child(h_flex().flex_none().max_w(200).gap(5).items_center().text_color(t.muted)
        .child(svg(icon("branch")).size(12).flex_none()).child(div().min_w(0).truncate().text_size(TYPE.label).child(branch))))
      .when(Boolean(problem), (e) => e.child(div().flex_none().max_w(200).truncate().text_size(TYPE.label).text_color(t.ansi1).child(problem)));
  },

};
