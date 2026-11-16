// Modified by Jochen Rau, 2026-11, from Herdr's prompt mod: see NOTICE.md in this folder.
// Asks for a new space's name and folder, then opens the space with its first tab
// named the same and Claude Code in it with Remote Control under that name, so
// the space, the tab and the session read alike. Props (all optional): { value,
// folder, machine }: value prefills the name, folder comes first in the list,
// machine opens the space there (in that folder, else its home: the list is this computer's).
//
// The folder is picked from the git repositories under the code folder (the
// `code_dir` in <appHome>/data/workbench.json, else ~/Code), typed to
// filter as in the file browser and the git graph. With nothing typed: the given
// folder or the repository you're in, then recent picks, then the rest; the
// last two rows are always "Home folder" and "Browse…" (the system's picker).
// All of it works from the keyboard: type the name, Enter opens in the repository
// you're in; Tab (or ⇧Tab) to the folder, type, ↑/↓, Enter. Esc cancels. An empty
// name sends the keyboard back to it instead of opening.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, props, closeOverlay, theme, focused, spaces, exec, home, pickFolder, shared, setShared } from "herdr";
import { fuzzy } from "./lib/fuzzy.js";
import { codeDir } from "./lib/settings.js";
import { codeFindArgs, foundRepos } from "./lib/repos.js";

const SHOWN = 8; // rows in the list
const RECENT = 10; // picks remembered
const tilde = (path) => (path.startsWith(`${home()}/`) ? `~${path.slice(home().length)}` : path);

export default class NewSpace extends View {
  init(_props, cx) {
    const p = props() ?? {};
    const value = p.value ?? "";
    this.name = InputState.new({ value, placeholder: "Login Form" });
    if (value) this.name.set_selected_range({ start: 0, end: value.length });
    this.filter = InputState.new({ placeholder: "Type to filter repositories…" });
    for (const [input, key] of [[this.name, "name"], [this.filter, "filter"]]) {
      input.on("change", (_e, cx) => { if (key === "filter") this.at = 0; cx.notify(); });
      input.on("submit", (_e, cx) => this.submit(cx));
      input.on("focus", (_e, cx) => { this.focus = key; cx.notify(); });
    }
    this.focus = "name";
    this.name.focus();
    // The dialog takes the keyboard a moment after it opens.
    cx.timer.after(600, () => (this.focus === "name" ? this.name : this.filter).focus());
    this.handle = cx.focus_handle();
    this.at = 0;
    this.first = p.folder ?? null; // listed first when nothing is typed
    this.picked = null; // a folder from Browse…, outside the list
    this.codeDir = `${home()}/Code`;
    this.repos = shared("new-space.repos") ?? []; // last scan's, until this one ends
    if (!p.machine) { this.guessFolder(cx); this.scan(cx); }
  }

  // The focused terminal's repository, when nothing was given.
  guessFolder(cx) {
    if (this.first) return;
    const f = focused();
    if (!f?.cwd || spaces().find((s) => s.id === f.space)?.machine) return;
    cx.spawn(async (cx) => {
      const r = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: f.cwd }).catch(() => null);
      if (r?.code === 0 && !this.first) { this.first = r.stdout.trim(); cx.notify(); }
    });
  }

  // Every git repository (and worktree: its .git is a file) under the code folder, in one find.
  scan(cx) {
    cx.spawn(async (cx) => {
      // The layout's settings: <appHome>/data/workbench.json, {"code_dir": "~/Projects"}. A code folder of
      // "~" is searched only two levels down (see lib/repos.js).
      this.codeDir = await codeDir();
      const r = await exec("find", codeFindArgs(this.codeDir, home()), { timeout: 15000 }).catch(() => null);
      if (!r) return;
      const found = foundRepos(r.stdout);
      if (!found.length) return;
      this.repos = found;
      setShared("new-space.repos", found);
      cx.notify();
    });
  }

  // How a folder reads in the list: under the code folder, relative to it.
  label(path) {
    return path.startsWith(`${this.codeDir}/`) ? path.slice(this.codeDir.length + 1) : tilde(path);
  }

  // The list as shown: folders matching what's typed (or the usual order),
  // then always Home folder and Browse….
  rows() {
    const term = this.filter.value().trim();
    const recent = (shared("new-space.recent") ?? []).filter((r) => typeof r === "string");
    const all = [...new Set([this.picked, this.first, ...recent, ...this.repos].filter(Boolean))];
    const paths = !term ? all.slice(0, SHOWN)
      : all.map((path) => ({ path, s: fuzzy(term, this.label(path)) }))
        .filter((m) => m.s !== null).sort((a, b) => b.s - a.s).slice(0, SHOWN).map((m) => m.path);
    return [...paths.map((path) => ({ kind: "repo", path })), { kind: "home" }, { kind: "browse" }];
  }

  selected() { return this.rows()[this.at] ?? { kind: "home" }; }

  // The folder Enter would use: the highlighted row's; none (home) for Home folder. On another machine the
  // list isn't shown (it is this computer's): the folder asked for (a worktree's there), else its home.
  folder() {
    const p = props() ?? {};
    if (p.machine) return typeof p.folder === "string" && p.folder ? p.folder : null;
    const r = this.selected();
    return r?.kind === "repo" ? r.path : null;
  }

  browse(cx) {
    cx.spawn(async (cx) => {
      const path = await pickFolder({ prompt: "Use" });
      if (path) { this.picked = path; this.filter.set_value(""); this.at = 0; cx.notify(); }
      // Back to the name when it's still empty, else ready for Enter.
      (this.name.value().trim() ? this.filter : this.name).focus();
    });
  }

  submit(cx) {
    const p = props() ?? {};
    if (!p.machine && this.selected().kind === "browse") return cx && this.browse(cx);
    const name = this.name.value().trim();
    if (!name) return this.name.focus();
    const folder = this.folder();
    closeOverlay(p.overlay);
    if (folder && !p.machine) setShared("new-space.recent", [folder, ...(shared("new-space.recent") ?? []).filter((r) => r !== folder)].slice(0, RECENT));
    run("space.new", {
      name,
      tab: name,
      // A name starting with "-" would read as a flag: the session's name drops the leading dashes.
      argv: ["claude", "--remote-control", name.replace(/^-+/, "") || "session"],
      ...(folder ? { folder } : {}),
      ...(p.machine ? { machine: p.machine } : {}),
    });
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const rows = p.machine ? [] : this.rows();
    if (this.at >= rows.length) this.at = Math.max(0, rows.length - 1);
    const ready = Boolean(this.name.value().trim());
    const label = (text) => div().pt(14).pb(7).text_size(11.5).text_color(t.dim).child(text);
    const field = (state, key) => Input.new(state).h(36).px(10).rounded(9).border_1()
      .border_color(this.focus === key ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground);
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .when(primary && !ready, (el) => el.opacity(0.5))
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
    // A click picks the row and gives the keyboard back to the filter;
    // on Browse… it opens the picker.
    const row = (r, i) => {
      const base = h_flex().id(`ns-row-${i}`).h(28).px(10).gap(8).items_center().rounded(7).cursor_pointer()
        .when(i === this.at, (el) => el.bg(t.selected))
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.at = i; if (r.kind === "browse") this.browse(cx); else this.filter.focus(); cx.notify(); });
      if (r.kind !== "repo") return base.when(r.kind === "home", (el) => el.mt(4))
        .child(div().flex_1().text_size(12.8).text_color(t.muted).child(r.kind === "home" ? "Home folder" : "Browse…"))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(r.kind === "home" ? "~" : "any folder"));
      const rel = this.label(r.path), cut = rel.lastIndexOf("/");
      return base
        .child(div().flex_none().text_size(12.8).text_color(t.foreground).child(cut < 0 ? rel : rel.slice(cut + 1)))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(cut < 0 ? "" : rel.slice(0, cut)))
        .when(r.path === this.first && !this.filter.value().trim(), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("here")));
    };
    return v_flex().id("new-space").track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "down" && rows.length) this.at = (this.at + 1) % rows.length;
        else if (e.key === "up" && rows.length) this.at = (this.at + rows.length - 1) % rows.length;
        else if (e.key === "tab" && !p.machine) (this.focus === "name" ? this.filter : this.name).focus();
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child("New space"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(label("Name: the space, its first tab and its Claude Remote Control session"))
      .child(field(this.name, "name"))
      .child(label(p.machine ? `Folder: ${p.folder || "home"} on ${p.machine}` : "Folder"))
      .when(!p.machine, (el) => el
        .child(field(this.filter, "filter"))
        .child(v_flex().pt(6).h((SHOWN + 2) * 28 + 10)
          .when(rows.length === 2, (el) => el.child(div().h(28).px(10).flex().items_center().text_size(12).text_color(t.muted)
            .child(this.repos.length ? "No repository matches" : "Looking for repositories…")))
          .children(rows.map(row))))
      .child(h_flex().pt(16).gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim)
          .child(p.machine ? "" : "Tab switches field · ↑↓ picks · ⏎ opens"))
        .child(button("ns-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("ns-open", "Open", true, (_e, cx) => this.submit(cx))));
  }
}
