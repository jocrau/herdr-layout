// A worktree's menu, opened by `worktree-support` as a popup with props
// { path, branch, tab, base, behind, machine, repoSpace, repoName, space, main, remove, pr, github, editors },
// or a top-level space's with { kind: "space", path, machine, space, editors, git, branch, linked }.
// ↑/↓ move, Enter runs, Esc closes. Nothing here creates a worktree; removing
// one runs the repo's own `herdr.worktreeRemove` command, after asking. Git
// operations run in `worktree-support` (this popup is gone by then), which
// shows how each went as a toast. Opened with { confirm: { title, detail, request } }
// it asks first instead (a force push), and Enter or Confirm sends the request.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, shared, setShared, exec, theme } from "herdr";
import { branchTitle } from "./lib/names.js";
import { customRemove } from "./lib/worktree.js";
import { word } from "./lib/menu.js";
import { TYPE } from "./lib/type.js";
// A shared item's words and icon (lib/menu.js), as [label, icon] for this menu's rows.
const w = (key, opts) => { const x = word(key, opts); return [x.label, `@git-graph/icons/${x.icon}`]; };
// A confirm dialog ignores ⏎ this long after it opens: a force-push or clean-up question can appear seconds
// after the click (after a push or a count), and an ⏎ meant for a terminal must not confirm it.
const ARM_MS = 700;

// Requests to worktree-support (which runs git and closes spaces): a short queue in shared state, so two in a
// row (within its 250 ms look) both arrive; ones older than 5 s are dropped as stale.
const REQUESTS = "worktree-support.request";
function sendRequest(req) {
  const now = Date.now(), q = shared(REQUESTS);
  const kept = (Array.isArray(q) ? q : q ? [q] : []).filter((r) => now - (r?.at ?? 0) < 5000);
  setShared(REQUESTS, [...kept, { ...req, id: req.id ?? `${now}-${Math.random()}`, at: req.at ?? now }]);
}


// A folder on another machine opens over the editor's SSH remote, so it needs the CLI.
function editorItems(p) {
  return (p.editors ?? []).filter((e) => !p.machine || e.cli).map((e) => [`Open in ${e.label}`, "square-pen", () =>
    p.machine ? exec(e.cli, ["--remote", `ssh-remote+${p.machine}`, p.path])
      : e.cli ? exec(e.cli, [p.path]) : exec("open", ["-a", e.app, p.path])]);
}

// Links and copies, as in the git view's menus: Reveal in Finder, Copy path, Copy branch name (set apart).
function folderItems(p) {
  const list = [
    ...(p.machine ? [] : [[...w("reveal"), () => exec("open", ["-R", p.path])]]),
    [...w("copyPath"), (cx) => cx.write_to_clipboard(p.path)],
    ...(p.branch ? [[...w("copyBranch"), (cx) => cx.write_to_clipboard(p.branch)]] : []),
  ];
  list[0].push(true);
  return list;
}

// The repository in the git view (on its machine too).
const gitView = (p) => [...w("gitView"), () =>
  openOverlay({ mod: "git-graph", kind: "dialog", width: 0.92, height: 0.9, props: { folder: p.path, ...(p.machine ? { on: p.machine } : {}) } })];

export function items(p) {
  // A top-level space row: where its terminal is now.
  // Every menu's order: open, then Fetch / Pull / Push, then the branch's work, links and copies, and last
  // what closes or removes.
  if (p.kind === "space") return [
    ...(p.git ? [gitView(p)] : []),
    ...editorItems(p),
    ...(p.git ? syncItems(p) : []),
    // Herdr's own worktree dialog, sized as the shipped menu opens it.
    ...(p.git ? [
      ["New worktree", "git-branch", () => openOverlay({ mod: "worktree", kind: "dialog", width: 440, height: 260, props: { space: p.space, action: "new" } }), true],
      ["Open worktree", "git-branch", () => openOverlay({ mod: "worktree", kind: "dialog", width: 560, height: 480, props: { space: p.space, action: "open" } })],
    ] : []),
    ...folderItems(p),
    ["Rename space", "square-pen", () => run("space.rename", { id: p.space }), true],
    ...(p.finishedCount > 0 ? [[`Clean up finished (${p.finishedCount})…`, "@git-graph/icons/trash", () =>
      sendRequest({ action: "askCleanupAll", repoKey: p.repoKey })]] : []),
    ...(p.linked ? [p.branch ? gitRemove(p) : herdrRemove(p.space)] : []),
    ["Close space", "x", () => run("space.close", { id: p.space })],
  ];
  const at = p.machine ? { machine: p.machine } : {};
  // Local change: first, a tab in this space (what a double-click does): open one, or go to
  // the one it has; then a tab another space has; a worktree can be open in several spaces.
  const openHere = [`Open as tab in ${p.repoName}`, "terminal", () => {
    run("space.select", { id: p.repoSpace });
    run("tab.new", { space: p.repoSpace, folder: p.path, name: p.branch ? branchTitle(p.branch) : undefined });
  }];
  const goTab = p.tab && p.tabSpace ? [`Go to tab in ${p.tabSpaceName}`, "terminal", () => {
    run("space.select", { id: p.tabSpace });
    run("tab.select", { id: p.tab });
  }] : null;
  const list = [
    ...(p.tabHere ? [goTab] : [openHere, ...(goTab ? [goTab] : [])]),
    [p.space ? "Go to space" : "Open as space", "folder-plus", () =>
      p.space ? run("space.select", { id: p.space })
        // Asks for its name (see `new-space`), the branch's in words to start with.
        : openOverlay({ mod: "new-space", kind: "dialog", width: 520, height: 560, props: { value: branchTitle(p.branch), folder: p.path, ...at } })],
    gitView(p),
    ...editorItems(p),
    ...gitItems(p),
  ];
  // Local change: finished (merged, PR closed, remote gone): clean it up in one go, after asking.
  // worktree-support works out what it would take away and asks (this popup is gone by then).
  if (p.finished && p.branch) {
    // After the ways to open it, before Fetch (set apart either side).
    const after = list.findIndex((it) => it[0] === word("fetch").label);
    list.splice(after, 0, [`Clean up (${p.finished})…`, "@git-graph/icons/trash", () => sendRequest({
      id: `${Date.now()}-${Math.random()}`, at: Date.now(), action: "askCleanup",
      path: p.path, branch: p.branch, base: p.base ?? null, machine: p.machine ?? null, main: p.main, space: p.space ?? null,
      tab: p.tab ?? null, tabSpaceName: p.tabSpaceName ?? null, repoSpace: p.repoSpace, repoName: p.repoName, remove: p.remove ?? null, dirty: Boolean(p.dirty), finished: p.finished }), true]);
  }
  if (p.pr) list.push([...w("prOnGitHub"), (cx) => cx.open_url(p.pr), true]);
  list.push(...folderItems(p).map((it, i) => (i === 0 && p.pr ? it.slice(0, 3) : it)));
  if (p.space) list.push(["Close space", "x", () => run("space.close", { id: p.space }), true]);
  // The git view's own dialog (it reads the repository, then asks as the graph does); Herdr's without a branch.
  if (p.branch) list.push(gitRemove(p, !p.space));
  else if (p.remove) {
    const cmd = customRemove(p.remove, p.path, "");
    list.push([...w("removeWorktree"), () => openOverlay({
      mod: "confirm", kind: "dialog", width: 420, height: 180,
      props: {
        title: `Remove ${p.path}?`,
        detail: cmd,
        command: { name: "tab.new", args: { space: p.repoSpace, folder: p.main, name: "remove", argv: ["sh", "-c", cmd] } },
      },
    }), !p.space]);
  } else if (p.space) list.push(herdrRemove(p.space));
  return list;
}

// The git a worktree most often needs: in sync with its remote, up to date with
// the main checkout's branch, a pull request, the graph.
// Run by `worktree-support`, in p.path.
const gitOp = (p, op) => () => sendRequest({
  id: `${Date.now()}-${Math.random()}`, at: Date.now(), action: "git", op,
  path: p.path, machine: p.machine, branch: p.branch, base: p.base,
});

// In step with the remote, set apart as a group; pull and push need a branch.
function syncItems(p) {
  const list = [[...w("fetch"), gitOp(p, "fetch")]];
  if (p.branch) list.push(
    [...w("pull"), gitOp(p, "pull")],
    [...w("push"), gitOp(p, "push")],
  );
  list[0].push(true);
  return list;
}

function gitItems(p) {
  const git = (op) => gitOp(p, op);
  const list = syncItems(p);
  const work = [];
  if (p.branch && p.base && p.behind > 0) work.push(
    [`Rebase onto ${p.base} (\u2193${p.behind})`, "@git-graph/icons/rebase", git("rebase")],
    [`Merge ${p.base} into ${p.branch}`, "@git-graph/icons/merge", git("merge")],
  );
  if (!p.pr && p.branch && p.github) work.push(["Create pull request", "git-branch", git("pr")]);
  if (work.length) work[0].push(true);
  // Its changes (worktree-support opens them: it needs the new space's id), then the branch's work.
  const changes = [word("showChanges").label, "@changes/changes", () =>
    sendRequest({ id: `${Date.now()}-${Math.random()}`, at: Date.now(), action: "changes", path: p.path, machine: p.machine }), true];
  return [...list, changes, ...work];
}

// Removing a worktree as the git view asks: its dialog, opened over the window (git-graph's "remove" role).
const gitRemove = (p, apart) => [...w("removeWorktree"), () => openOverlay({ mod: "git-graph", kind: "dialog", width: 320, height: 90,
  props: { role: "remove", folder: p.path, ...(p.machine ? { on: p.machine } : {}) } }), apart];

// Herdr's own removal of a worktree space, as the shipped menu offers it.
const herdrRemove = (space, apart) => [...w("removeWorktree"),
  () => openOverlay({ mod: "worktree", kind: "dialog", width: 440, height: 260, props: { space, action: "remove" } }), apart];

export default class WorktreeActions extends View {
  init(_props, cx) {
    this.openedAt = Date.now(); // a confirm dialog takes ⏎ only after ARM_MS: it may open late, while you type elsewhere
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  // A confirmed request goes to `worktree-support`, which runs it.
  confirm() {
    const c = props()?.confirm;
    closeOverlay(props()?.overlay);
    if (c) sendRequest({ ...c.request, id: `${Date.now()}-${Math.random()}`, at: Date.now() });
  }

  renderConfirm(c) {
    const t = theme();
    const button = (id, label, bg, fg, border, onClick) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(border).bg(bg).text_color(fg).cursor_pointer().hover((s) => s.opacity(0.88)).on_click(onClick).child(label);
    return v_flex()
      .id("worktree-confirm")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "enter") { if (Date.now() - this.openedAt >= ARM_MS) this.confirm(); }
        else return; // (Esc never arrives: Herdr closes a dialog itself)
        cx.stop_propagation();
      })
      .size_full().min_h(0).p(18).gap(12).rounded(8).bg(t.popover).text_size(TYPE.title)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(TYPE.dialog).font_semibold().text_color(t.foreground).child(c.title))
        .child(div().text_size(TYPE.label).text_color(t.dim).child("⏎ confirms · Esc")))
      .child(v_flex().id("worktree-confirm-detail").flex_1().min_h(0).overflow_y_scrollbar().text_color(t.muted)
        .children(String(c.detail ?? "").split("\n").map((line) => div().child(line))))
      .child(h_flex().justify_end().gap(8).text_size(TYPE.meta)
        .child(button("no", "Cancel", t.raised, t.foreground, t.input, () => closeOverlay(props().overlay)))
        .child(c.danger ? button("yes", c.button ?? "Force push", t.ansi1, t.background, t.ansi1, () => this.confirm())
          : button("yes", c.button ?? "Force push", t.solid, t.solid_foreground, t.solid, () => this.confirm())));
  }

  choose(i, cx) {
    const it = items(props() ?? {})[i];
    if (!it) return;
    closeOverlay(props()?.overlay);
    it[2](cx);
  }

  render() {
    if (props()?.confirm) return this.renderConfirm(props().confirm);
    const t = theme();
    const list = items(props() ?? {});
    return v_flex()
      .id("worktree-actions")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(TYPE.body)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") return this.choose(this.at, cx);
        else if (e.key === "escape") return closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(list.map((it, i) =>
        v_flex()
          // it[3]: the first of a group (git, or the destructive items), set apart.
          .when(Boolean(it[3]) && i > 0, (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
          .child(h_flex()
            .id(`wa-${i}`)
            .h(31)
            .px(8)
            .gap(9)
            .rounded(7)
            .items_center()
            .text_color(t.foreground)
            .when(i === this.at, (el) => el.bg(t.selected))
            .hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.choose(i, cx))
            .child(svg(icon(it[1])).size(14).flex_none().text_color(t.muted))
            .child(div().flex_1().truncate().child(it[0]))),
      ));
  }
}

// "name" is one of workspace-chrome's icons, "@mod/path" another mod's.
const icon = (name) => name.startsWith("@") ? `mods/${name.slice(1)}.svg` : `mods/workspace-chrome/${name}.svg`;
