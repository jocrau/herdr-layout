// Modified by Jochen Rau, 2026-11, from rabeeh-ta/herdr-git-graph: see NOTICE.md in this folder.
// The branch picker (b) and the repository switcher (⇧R). Mixed into Graph.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list, Input } from "gpui-base";
import { exec, shared, setShared, home, notify, pickFolder } from "herdr";
import { worktreeOf, READ, splitRemote } from "./git.js";
import { openDialog, goToWorktree } from "./act.js";
import { icon } from "./menu.js";
import { MORE_ROUNDS, tilde, count } from "./common.js";
import { fuzzy } from "./lib/fuzzy.js";
import { codeDir } from "./lib/settings.js";
import { codeFindArgs, foundRepos } from "./lib/repos.js";

export const PickersMethods = {
  // `b`: every local and remote branch and (local change) every tag, newest first, fuzzy-filtered.
  openBranches(cx) {
    if (!this.root) return;
    this.bp = { refs: null, query: "", at: 0, only: false };
    this.bpInput.set_value(""); cx.timer.after(0, () => this.bpInput.focus());
    // Local change: open pull requests by branch, when gh is there (kept per repository).
    const root = this.root;
    this.prs = this.prs?.root === root ? this.prs : { root, by: {} };
    cx.spawn(async (cx) => {
      const r = await exec("gh", ["pr", "list", "--state", "open", "--limit", "200", "--json", "number,headRefName,isDraft"], { cwd: root, on: this.on }).catch(() => null);
      if (r?.code !== 0 || this.root !== root) return;
      try { this.prs = { root, by: Object.fromEntries(JSON.parse(r.stdout).map((p) => [p.headRefName, p])) }; } catch {}
      cx.notify();
    });
    cx.spawn(async (cx) => {
      // Local change: tags too; an annotated tag's commit is its peeled object (%(*objectname)), its date its own.
      const r = await exec("git", [...READ, "for-each-ref", "--sort=-creatordate",
        "--format=%(refname)%00%(objectname)%00%(creatordate:relative)%00%(upstream:short)%00%(*objectname)", "refs/heads", "refs/remotes", "refs/tags"], { cwd: this.root, on: this.on }).catch(() => null);
      if (!this.bp) return;
      this.bp.refs = r?.code !== 0 ? [] : r.stdout.split("\n").filter(Boolean).map((line) => {
        const [ref, hash, when, up, peeled] = line.split("\0");
        const kind = ref.startsWith("refs/heads/") ? "branch" : ref.startsWith("refs/tags/") ? "tag" : "remote";
        return { kind, name: ref.replace(/^refs\/(heads|remotes|tags)\//, ""), hash: peeled || hash, when, up };
      }).filter((b) => !(b.kind === "remote" && b.name.endsWith("/HEAD")));
      cx.notify();
    });
    cx.notify();
  },

  bpRows() {
    const all = this.bp?.refs ?? [], q = this.bp?.query.trim() ?? "";
    // ⌃T: only branches checked out in a worktree (this one's included).
    const refs = this.bp?.only === "tags" ? all.filter((r) => r.kind === "tag") : this.bp?.only ? all.filter((r) => r.kind === "branch" && (r.name === this.current || worktreeOf(this.ctx ?? {}, r.name))) : all;
    if (!q) return refs;
    const terms = q.split(/\s+/), scored = [];
    for (const r of refs) {
      let total = 0;
      for (const t of terms) { const s = fuzzy(t, r.name); if (s === null) { total = null; break; } total += s; }
      if (total !== null) scored.push([total, r]);
    }
    return scored.sort((a, b) => b[0] - a[0]).map(([, r]) => r);
  },

  // `?`: every key, grouped as the file and beads viewers list theirs.
  helpPanel(t) {
    const groups = [
      ["Move", [["j k  ↑ ↓  ⌃N ⌃P", "commit by commit"], ["⌃D ⌃U  PgDn PgUp", "half / whole page"], ["g G  Home End", "first / last"],
        ["[ ]", "previous / next labelled commit"], ["{ }", "previous / next branch"], ["t", "local branch ⇄ its upstream"],
        [". u m", "HEAD / upstream / main"], ["^", "first parent"], ["/  n N  ⌫", "search, next / previous match, clear (in the field ↑↓ ⌃J ⌃K step; esc: back to the graph, matches kept)"], ["b", "branches and tags, type to find one (↑↓ ⌃J ⌃K move, ⏎ jump, ⇧⏎ checkout, ⌃O its worktree or a new one, ⌃D delete, ⌃X remove its worktree, ⌃T worktrees only, ⌃G tags only)"], ["⇧B", "new branch at the cursor: here, in a new worktree (.worktrees/), or just made"], ["⇧R", "switch to another repository (⏎ open, esc back)"]]],
      ["Review", [["⏎ ⇥ l →", "review the commit (files take the keyboard); ⏎ ⇥ again close it"], ["j k", "files (the diff follows)"], ["J K", "previous / next commit"],
        ["⌃D ⌃U  space", "scroll the diff"], ["s", "the file as it is at the commit (a PR: as it will be once merged), the change marked in it ⇄ the diff"], ["w", "whitespace changes ignored or shown"], ["⇧W", "long lines wrapped, or scrolled sideways (shift-wheel, a sideways swipe) with the line numbers in place"], ["[ ]", "previous / next hunk"], ["c", "this commit ⇄ everything since the base branch (as a PR shows it)"], ["⌘-click  v", "another commit: the diff between the two (older → newer); or v on one, move, v on the other (esc unmarks); c or a plain click ends it"],
        ["h ←", "out: files → graph → review closed"], ["o", "edit the file in the file viewer (the working tree); a PR not checked out, or a deleted file: as v"], ["d", "the change in your diff tool (git difftool); added or deleted: that version in the file viewer"], ["v", "view the file as it was at the commit in the file viewer (esc comes back)"], ["r", "uncommitted changes: reset the file (unstage it, or discard its change; asks first)"], ["- =", "smaller / larger review (or drag its edge; drag between files and diff too)"], ["⏎ ⇥ x", "close the review"]]],
      ["Git", [["f", "fetch"], ["double-click", "a label checks it out here (right-click: in a new worktree); a remote one its local branch (made with its name if there is none), fast-forwarded to it; a folder label (checked out in another worktree) goes there"], ["⇧F", "fast-forward every branch only behind its upstream, except those in other worktrees"], ["⇧P", "push the current branch (asks first)"],
        ["⇧C", "commit (asks for the message)"], ["space", "actions menu for the row"], ["a", "all branches / current"], ["r", "refresh"], ["p", "on a branch pr-flow tracks a PR for: this dialog becomes its PR view (esc comes back); reviewing its head since base shows the PR's notes here too"]]],
      ["Window", [["?", "this help (any key closes it)"], ["esc", "close the dialog"]]],
    ];
    // Local change: the PR view's own keys, first when it is one.
    if (this.prMode()) groups.unshift(["PR view", [["p", "every PR in the queue, under the PR's name (type to filter, ⏎ show, esc close)"], ["⌘↑ ⌘↓", "previous / next PR in the queue's order"],
      ["⇧L", "the queue as a list on the left (for going through many)"], ["n N", "next / previous stop: the findings, the fix plan's items, your draft's comments, the places to look at and the threads, in the files' order"], ["⏎", "on a fix plan's item: its verdicts, f fix · w won't-fix · a answer · u follow-up · s skip, typed into the PR's session (esc closes them)"], ["⌘⏎", "a fix plan: go, typed into its session (the go line above says what it does); your draft review: post the version shown (asks first)"], ["y", "the draft shown copied to the clipboard (pr-flow counts it as handed over)"], ["⇧V", "the draft's next version"], ["m", "the file viewed (on to the next not viewed), or not again; a file changed since comes back"], ["c", "the whole PR ⇄ only what came after your review"], ["t", "the PR's agent tab"], ["z", "a straight PR's graph folded to one line, or shown"], ["⇧R", "the review thread reached: resolved on GitHub (Unresolve under RESOLVED)"], ["esc", "back to the plain graph of the repository when you came from it (p), else closes the PR view"]]]);
    return v_flex().id("graph-help").flex_1().min_h(0).overflow_y_scrollbar().px(18).py(12).gap(14).text_size(12)
      .children(groups.map(([title, rows]) => v_flex().gap(3)
        .child(div().pb(2).text_size(11.5).font_semibold().text_color(t.accent).child(title))
        .children(rows.map(([keys, what]) => h_flex().gap(12).child(div().w(170).flex_none().text_color(t.foreground).child(keys)).child(div().flex_1().min_w(0).text_color(t.muted).child(what))))));
  },

  closeBranches(cx) { this.bp = null; this.handle.focus(); cx.notify(); },

  // Local change: the picker's own keys for the branch under its cursor. ⌃O: to its worktree, or
  // a new one for it; ⌃D: delete it; ⌃X: remove its worktree; ⌃T: worktrees only.
  bpAction(k, cx) {
    const row = this.bpRows()[this.bp?.at ?? 0], ctx = this.ctx;
    if (k === "ctrl-t") { this.bp.only = this.bp.only === true ? false : true; this.bp.at = 0; return true; }
    // Local change: ⌃G only the tags (again: everything).
    if (k === "ctrl-g") { this.bp.only = this.bp.only === "tags" ? false : "tags"; this.bp.at = 0; return true; }
    if (!row || !ctx || !["ctrl-o", "ctrl-d", "ctrl-x"].includes(k)) return false;
    // A tag: ⌃D deletes it (asks first); a worktree is a branch's.
    if (row.kind === "tag") {
      if (k !== "ctrl-d") return notify({ title: "Not for a tag", body: "A worktree is a branch's: ⇧⏎ checks the tag's commit out here (detached).", level: "info", timeout: 3000 }), true;
      this.closeBranches(cx);
      return openDialog({ type: "deleteTag", name: row.name }, ctx), true;
    }
    const local = row.kind === "branch", wt = local ? worktreeOf(ctx, row.name) : null;
    const { remote, branch } = splitRemote(row.name, ctx.remotes);
    const say = (body) => notify({ title: "Not for this branch", body, level: "info", timeout: 3000 });
    if (k === "ctrl-o") {
      if (wt) return this.closeBranches(cx), goToWorktree(wt, row.name, ctx.on, ctx.overlay, ctx.space), true;
      if (local && row.name === ctx.current) return say(`${row.name} is checked out here.`), true;
      const there = local ? null : worktreeOf(ctx, branch);
      if (there) return this.closeBranches(cx), goToWorktree(there, branch, ctx.on, ctx.overlay, ctx.space), true;
      this.closeBranches(cx);
      if (local) return openDialog({ type: "checkout", name: row.name }, ctx), true;
      const tracked = ctx.branches.includes(branch);
      return openDialog(tracked ? { type: "checkout", name: branch } : { type: "checkoutRemote", name: row.name, remote, branch }, ctx), true;
    }
    if (k === "ctrl-d") {
      if (local && (row.name === ctx.current || wt)) return say(wt ? `${row.name} is checked out in ${wt.split("/").pop()}: remove that worktree first (⌃X).` : `${row.name} is checked out here.`), true;
      this.closeBranches(cx);
      return openDialog(local ? { type: "deleteBranch", name: row.name } : { type: "deleteRemoteBranch", name: row.name, remote, branch }, ctx), true;
    }
    if (!wt) return say(`${row.name} isn't checked out in another worktree.`), true;
    if (wt === ctx.mainRoot) return say(`${row.name} is checked out in the main checkout, which isn't removable from here.`), true;
    this.closeBranches(cx);
    return openDialog({ type: "removeWorktree", name: row.name, path: wt }, ctx), true;
  },

  // ⏎ jumps to the branch; ⇧⏎ checks it out too (a remote one as a tracking branch).
  bpChoose(checkout, cx) {
    const row = this.bpRows()[this.bp?.at ?? 0];
    if (!row) return;
    this.closeBranches(cx);
    // A tag: its commit, detached (the dialog says so first).
    if (checkout && row.kind === "tag") openDialog({ type: "checkoutCommit", hash: row.hash, short: row.hash.slice(0, 8) }, this.ctx);
    else if (checkout && row.name !== this.current) this.checkout({ kind: row.kind, name: row.name }, cx);
    this.jumpTo(row.hash, cx);
  },

  // To a commit that may not be loaded yet: load pages until it is.
  jumpTo(hash, cx) {
    const i = this.index.get(hash);
    if (i !== undefined) return this.moveTo(i, cx);
    if (!this.hasMore) return notify({ title: "Not in the graph", body: this.all ? (this.remotes ? "It isn't reachable from what the graph shows." : "Turn Remotes on to see remote branches.") : "Press a to show all branches.", level: "info", timeout: 3500 });
    this.pendingJump = hash; this.jumpRounds = 0; this.loadMore(cx);
  },

  // After a page loads: finish a jump or a search that was waiting for it.
  resolvePending(cx) {
    if (this.pendingJump) {
      const hash = this.pendingJump, i = this.index.get(hash);
      if (i !== undefined) { this.pendingJump = null; return this.moveTo(i, cx); }
      if (!this.hasMore || ++this.jumpRounds > MORE_ROUNDS) { this.pendingJump = null; return notify({ title: "Not found in the history loaded", body: `Looked through ${this.commits.length} commits.`, level: "info", timeout: 3500 }); }
      return this.loadMore(cx);
    }
    if (this.pendingSearch) { const step = this.pendingSearch; this.pendingSearch = null; this.searchStep(step, cx, false); }
  },

  // Local change: `R` switches to another repository on this computer: the code folder's
  // (code_dir in <appHome>/data/workbench.json, else ~/Code; found as New Space finds them),
  // with this one and recent picks first, typed to filter, and Browse… for any folder.
  // The graph then stays on it instead of following the focused terminal, until it closes.
  openRepos(cx) {
    this.rp = { repos: (shared("new-space.repos") ?? []).filter((r) => typeof r === "string"), query: "", at: 0, codeDir: `${home()}/Code` };
    this.rpInput.set_value(""); cx.timer.after(0, () => this.rpInput.focus());
    cx.spawn(async (cx) => {
      // As new-space searches it (lib/repos.js): a code folder of "~" only two levels down.
      const dir = await codeDir();
      const r = await exec("find", codeFindArgs(dir, home()), { timeout: 15000 }).catch(() => null);
      if (!this.rp) return;
      this.rp.codeDir = dir;
      const found = r ? foundRepos(r.stdout).slice(0, 2000) : [];
      if (found.length) this.rp.repos = found;
      cx.notify();
    });
    cx.notify();
  },

  // How a repository reads in the list: under the code folder, relative to it.
  rpLabel(path) {
    const dir = this.rp?.codeDir ?? "";
    return path.startsWith(`${dir}/`) ? path.slice(dir.length + 1) : tilde(path, null);
  },

  rpRows() {
    const q = this.rp?.query.trim() ?? "";
    const recent = (shared("git-graph.recent") ?? []).filter((r) => typeof r === "string");
    const all = [...new Set([this.on ? null : this.root, ...recent, ...(this.rp?.repos ?? [])].filter(Boolean))];
    const repos = !q ? all : all.map((path) => ({ path, s: fuzzy(q, this.rpLabel(path)) })).filter((m) => m.s !== null)
      .sort((a, b) => b.s - a.s).map((m) => m.path);
    return [...repos.map((path) => ({ kind: "repo", path })), { kind: "browse" }];
  },

  closeRepos(cx) { this.rp = null; this.handle.focus(); cx.notify(); },

  // ⏎: show that repository; Browse… asks for a folder (one holding repositories lists them).
  rpChoose(cx) {
    const row = this.rpRows()[this.rp?.at ?? 0];
    if (!row) return;
    if (row.kind === "repo") return this.switchTo(row.path, cx);
    cx.spawn(async (cx) => {
      const path = await pickFolder({ prompt: "Open" });
      if (path) this.switchTo(path, cx); else this.rpInput.focus();
    });
  },

  switchTo(path, cx) {
    setShared("git-graph.recent", [path, ...(shared("git-graph.recent") ?? []).filter((r) => r !== path)].slice(0, 10));
    this.folder = path; this.folderOn = null; this.rp = null; // the list is this computer's
    this.refresh(cx); this.handle.focus(); cx.notify();
  },

  repoPanel(t) {
    const rows = this.rpRows(), id = `${this.listId}-rp`;
    this.rp.at = Math.max(0, Math.min(this.rp.at, rows.length - 1));
    return v_flex().flex_1().min_h(0).px(10).py(8).gap(6)
      .child(h_flex().h(32).flex_none().px(8).gap(6).items_center().rounded(7).border_1().border_color(t.accent).bg(t.background)
        .child(svg(icon("folder")).size(13).flex_none().text_color(t.dim))
        .child(Input.new(this.rpInput).flex_1().h_full().text_size(12.5).text_color(t.foreground)))
      .child(div().flex_none().px(2).text_size(11).text_color(t.dim)
        .child(`${count(rows.length - 1, "repo")} in ${tilde(this.rp.codeDir, null)} · this one and recent first · ↑↓ ⌃J ⌃K move · ⏎ open · esc back`))
      .child(div().relative().flex_1().min_h(0)
        .child(v_virtual_list(id, rows.length, 26, (i) => rows[i].path ?? "browse", (range) => rows.slice(range.start, range.end).map((r, o) => {
          const i = range.start + o, here = r.path === this.root, label = r.kind === "browse" ? "Browse…" : this.rpLabel(r.path);
          const cut = label.lastIndexOf("/");
          return h_flex().h(26).px(8).gap(8).items_center().rounded(6).text_size(12.5).when(i === this.rp.at, (el) => el.bg(t.selected))
            .child(svg(icon("folder")).size(12).flex_none().text_color(r.kind === "browse" ? t.accent : t.muted))
            .child(h_flex().flex_1().min_w(0)
              .child(div().flex_none().text_color(t.dim).child(r.kind === "repo" && cut >= 0 ? label.slice(0, cut + 1) : ""))
              .child(div().min_w(0).truncate().text_color(r.kind === "browse" ? t.accent : here ? t.accent : t.foreground).child(cut >= 0 && r.kind === "repo" ? label.slice(cut + 1) : label)))
            .when(here, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("this one")));
        })).track_scroll(this.rpScroll)
          .on_item_click((key, cx) => { const i = rows.findIndex((r) => (r.path ?? "browse") === key); if (i >= 0) { this.rp.at = i; this.rpChoose(cx); } })
          .size_full())
        .child(Scrollbar.vertical(id).viewport_from_layout().absolute().inset_0()));
  },

  branchPanel(t) {
    const rows = this.bpRows(), loading = !this.bp.refs;
    this.bp.at = Math.max(0, Math.min(this.bp.at, rows.length - 1));
    const id = `${this.listId}-bp`;
    return v_flex().flex_1().min_h(0).px(10).py(8).gap(6)
      .child(h_flex().h(32).flex_none().px(8).gap(6).items_center().rounded(7).border_1().border_color(t.accent).bg(t.background)
        .child(svg(icon("branch")).size(13).flex_none().text_color(t.dim))
        .child(Input.new(this.bpInput).flex_1().h_full().text_size(12.5).text_color(t.foreground)))
      .child(div().flex_none().px(2).text_size(11).text_color(t.dim)
        .child(loading ? "Reading branches and tags…" : `${rows.length} ${this.bp.only === "tags" ? "tags" : this.bp.only ? "in worktrees" : "branches and tags, newest first"} · ⏎ jump · ⇧⏎ checkout · ⌃O worktree · ⌃D delete · ⌃X remove worktree · ⌃T ${this.bp.only === true ? "all" : "worktrees only"} · ⌃G ${this.bp.only === "tags" ? "all" : "tags only"} · esc back`))
      .child(div().relative().flex_1().min_h(0)
        .child(v_virtual_list(id, rows.length, 26, (i) => `${rows[i].kind}:${rows[i].name}`, (range) => rows.slice(range.start, range.end).map((r, o) => {
          const i = range.start + o, local = r.kind === "branch", wt = local ? worktreeOf(this.ctx ?? {}, r.name) : null;
          const tr = local ? this.tracking?.[r.name] : null, pr = this.prs?.by?.[local ? r.name : r.name.slice(r.name.indexOf("/") + 1)];
          return h_flex().h(26).px(8).gap(8).items_center().rounded(6).text_size(12.5).when(i === this.bp.at, (el) => el.bg(t.selected))
            .child(svg(icon(wt ? "folder" : local ? "branch" : r.kind === "tag" ? "tag" : "cloud")).size(12).flex_none().text_color(local ? t.muted : t.dim))
            .child(div().flex_1().min_w(0).truncate().text_color(local && r.name === this.current ? t.accent : local || r.kind === "tag" ? t.foreground : t.muted).child(r.name))
            // Local change: checked out in another worktree (⇧⏎ goes there).
            .when(Boolean(wt), (el) => el.child(div().flex_none().max_w(200).truncate().text_size(11).text_color(t.dim).child(`in ${wt.split("/").pop()}`)))
            // Local change: ahead/behind its upstream, and its open pull request.
            .when(Boolean(tr?.ahead), (el) => el.child(div().flex_none().text_size(11).text_color(t.ansi2).child(`\u2191${tr.ahead}`)))
            .when(Boolean(tr?.behind), (el) => el.child(div().flex_none().text_size(11).text_color(t.ansi1).child(`\u2193${tr.behind}`)))
            .when(Boolean(tr?.gone), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("gone")))
            .when(Boolean(pr), (el) => el.child(div().flex_none().text_size(11).text_color(pr.isDraft ? t.dim : t.accent).child(`#${pr.number}${pr.isDraft ? " draft" : ""}`)))
            .when(Boolean(r.up), (el) => el.child(div().flex_none().max_w(220).truncate().text_size(11).text_color(t.dim).child(`\u2192 ${r.up}`)))
            .child(div().flex_none().w(110).text_right().truncate().text_size(11).text_color(t.dim).child(r.when));
        })).track_scroll(this.bpScroll)
          .on_item_click((key, cx) => { const i = rows.findIndex((r) => `${r.kind}:${r.name}` === key); if (i >= 0) { this.bp.at = i; this.bpChoose(false, cx); } })
          .size_full())
        .child(Scrollbar.vertical(id).viewport_from_layout().absolute().inset_0()));
  },

};
