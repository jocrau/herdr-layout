// file-browser (cmd+o, `mod.open:file-browser`; again closes it): the
// focused terminal's repo as a dialog over the tab. A keyboard-driven tree on
// the left, the preview-plus viewer on the right (Markdown with Mermaid, JSON,
// CSV, images, PDF, source with editing). Moving through the tree previews the
// file under the cursor, as fzf's preview does.
//
// Keys (the same scheme as the git graph and beads-view; `?` lists them all):
// move j k ↑↓ ⌃N⌃P ⌃J⌃K · page ⌃D⌃U PgDn PgUp · ends g G Home End · in l → ⏎ · out h ←
// next/previous file J K · sections [ ] · filter / (⌫ clears) · pane ⇥ · help ? · close esc (the app's)
// The viewer is preview-plus's (viewer.js, tree.js and the renderers are copies).

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, InputState, Scrollbar, VirtualListScrollHandle, v_virtual_list } from "gpui-base";
import { focused, panes, spaces, exec, home, props, closeOverlay, setShared } from "herdr";
import Viewer from "./viewer.js";
import { Tree } from "./tree.js";
import { join, normalize, kind, richText, basename, dirname } from "./paths.js";
import { appearance } from "./appearance.js";
import { fuzzyLower } from "./lib/fuzzy.js";

const ROW = 26, MATCHES = 300, FILES = 20000, PREVIEW_DELAY = 120;

// Where the focused terminal is, read once when the dialog opens. Local change: or the
// folder another mod opened it on (the git graph's `v`: props { folder, path, rev }).
function start() {
  const p = props() ?? {};
  if (typeof p.folder === "string" && p.folder) return { cwd: p.folder, on: null, spaceId: spaces().find((s) => s.active)?.id ?? null, path: p.path, rev: p.rev, line: p.line };
  const f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const space = spaces().find((s) => s.id === f?.space) || spaces().find((s) => s.active);
  return { cwd: pane?.cwd || f?.cwd || space?.folder || home(), on: space?.machine || null, spaceId: space?.id || null };
}

// The rows for a filter: the best MATCHES paths, best first. pool: the indexes of every path that matched,
// so a filter that only grows (the next letter typed, another term) looks at those alone, not all 20,000.
const lowered = new WeakMap(); // file list -> its paths lower-cased
function lowerOf(files) {
  let lower = lowered.get(files);
  if (!lower) { lower = files.map((f) => f.toLowerCase()); lowered.set(files, lower); }
  return lower;
}
export function matchFiles(files, filter, last = null) {
  const lower = lowerOf(files);
  const terms = filter.trim().toLowerCase().split(/\s+/), pool = [];
  const from = last?.pool && filter.startsWith(last.key) ? last.pool : null;
  const n = from ? from.length : files.length;
  // Best first: higher score, then the shorter path, then the list's order. The best MATCHES are kept in a
  // heap with the worst of them on top, so one letter matching 15,000 paths doesn't sort all 15,000.
  const worse = (a, b) => a[0] < b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])));
  const heap = [];
  const down = (k) => { for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && worse(heap[l], heap[m])) m = l; if (r < heap.length && worse(heap[r], heap[m])) m = r; if (m === k) return; [heap[k], heap[m]] = [heap[m], heap[k]]; k = m; } };
  for (let k = 0; k < n; k++) {
    const i = from ? from[k] : k, p = lower[i];
    let total = 0;
    for (const t of terms) { const s = fuzzyLower(t, p); if (s === null) { total = null; break; } total += s; }
    if (total === null) continue;
    pool.push(i);
    const e = [total, p.length, i];
    if (heap.length < MATCHES) {
      heap.push(e);
      for (let c = heap.length - 1; c && worse(heap[c], heap[(c - 1) >> 1]);) { const up = (c - 1) >> 1; [heap[c], heap[up]] = [heap[up], heap[c]]; c = up; }
    } else if (worse(heap[0], e)) { heap[0] = e; down(0); }
  }
  heap.sort((a, b) => (worse(a, b) ? 1 : worse(b, a) ? -1 : 0));
  const rows = heap.map(([, , i]) => ({ path: files[i], name: basename(files[i]), dir: false, depth: 0, match: true }));
  return { rows, pool };
}

export default class FileBrowser extends Viewer {
  init(p, cx) {
    const s = start();
    this.opener = props() ?? {};
    this.place = { mode: "browser", spaceId: s.spaceId, cwd: s.cwd, on: s.on };
    this.root = null; this.nav = null;
    this.at = 0; this.atPath = null;
    this.filter = ""; this.filtering = false; this.files = null; this.matchCache = null;
    this.treeFocus = cx.focus_handle(); this.viewFocus = cx.focus_handle();
    this.list = VirtualListScrollHandle.new();
    this.input = InputState.new({ placeholder: "Filter files" });
    this.input.on("focus", (_e, cx) => { this.filtering = true; this.ensureFiles(cx); cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.filtering = false; cx.notify(); });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; this.atPath = null; this.ensureFiles(cx); cx.notify(); });
    this.input.on("submit", (_e, cx) => this.enter(cx));
    super.init(p, cx);
    this.treeFocus.focus();
    // The dialog takes the keyboard a moment after it opens.
    cx.timer.after(300, () => { if (!this.filtering && !this.viewFocus.is_focused()) this.treeFocus.focus(); });
    cx.spawn(async (cx) => {
      // The top folder and where the terminal is inside it, as git sees them (symlinks resolved: a terminal in
      // /tmp/x is in /private/tmp/x, so comparing path strings would miss it).
      const top = await exec("git", ["rev-parse", "--show-toplevel", "--show-prefix"], { cwd: s.cwd, on: s.on }).catch(() => null);
      const [topDir, prefix = ""] = top?.code === 0 ? top.stdout.split("\n") : [];
      this.root = top?.code === 0 ? topDir.trim() : s.cwd;
      this.git = top?.code === 0;
      this.nav = new Tree({ cwd: this.root, on: s.on }, () => !this.closed);
      this.nav.refresh(cx); this.nav.watch(cx);
      // Open the tree down to where the terminal is.
      const rel = top?.code === 0 ? prefix.trim().replace(/\/$/, "") : this.relative(s.cwd);
      if (rel) { this.reveal(rel, cx); this.atPath = rel; }
      // Opened on a file: shown (at its commit, when given) with the keyboard on it.
      if (typeof s.path === "string" && s.path) {
        this.reveal(s.path, cx, true); this.atPath = s.path;
        // Local change: props.line (the PR view's "where to spend your time"): that line, selected once shown.
        if (Number(s.line) > 0) this.goLine = { file: join(this.root, s.path), line: Number(s.line) };
        this.show({ file: join(this.root, s.path), root: this.root, on: s.on, rev: s.rev }, cx);
        this.viewFocus.focus();
      }
      cx.notify();
    });
  }

  context() { return this.place ?? { mode: "browser" }; }

  relative(path) {
    const root = normalize(this.root), p = normalize(path);
    return p.startsWith(root + "/") ? p.slice(root.length + 1) : "";
  }

  // Opens every folder on the way to `rel` (and `rel` itself when it's a folder).
  reveal(rel, cx, file = false) {
    const parts = rel.split("/");
    for (let i = 1; i <= parts.length - (file ? 1 : 0); i++) {
      const prefix = parts.slice(0, i).join("/");
      if (!this.nav.folders.has(prefix)) this.nav.toggle(prefix, cx);
    }
  }

  // The whole repo's file names, for the filter: git's list, else find.
  ensureFiles(cx) {
    if (this.files || this.loadingFiles || !this.root) return;
    this.loadingFiles = true;
    cx.spawn(async (cx) => {
      const opts = { cwd: this.root, on: this.place.on };
      let names = [];
      const git = this.git && await exec("git", ["ls-files", "-co", "--exclude-standard", "-z"], opts).catch(() => null);
      if (git?.code === 0) names = git.stdout.split("\0").filter(Boolean);
      else {
        const r = await exec("sh", ["-c", `find . -type f -not -path '*/.git/*' -not -path '*/node_modules/*' | head -n ${FILES}`], opts).catch(() => null);
        names = (r?.stdout ?? "").split("\n").filter(Boolean).map((n) => n.replace(/^\.\//, ""));
      }
      this.filesCapped = names.length >= FILES; // said in the footer: the filter doesn't see the rest
      this.files = names.slice(0, FILES);
      lowerOf(this.files); // now, not on the first letter typed
      this.loadingFiles = false; this.matchCache = null;
      cx.notify();
    });
  }

  rows() {
    if (!this.nav) return [];
    if (this.filter.trim()) return this.matches();
    const out = [];
    this.treeCapped = false;
    const walk = (prefix, depth) => {
      for (const e of this.nav.entries.get(prefix) || []) {
        if (out.length >= 5000) { this.treeCapped = true; return; } // said in the footer
        const path = prefix ? `${prefix}/${e.name}` : e.name, open = e.dir && this.nav.folders.has(path);
        out.push({ path, name: e.name, dir: e.dir, depth, open });
        if (open) walk(path, depth + 1);
      }
    };
    walk("", 0);
    return out;
  }

  matches() {
    const key = this.filter, last = this.matchCache;
    if (last?.key === key && last.files === this.files) return last.rows;
    const { rows, pool } = matchFiles(this.files ?? [], key, last?.files === this.files ? last : null);
    this.matchCache = { key, files: this.files, rows, pool };
    return rows;
  }

  select(i, rows, cx, preview = true) {
    if (!rows.length) return;
    this.at = Math.max(0, Math.min(rows.length - 1, i));
    this.atPath = rows[this.at].path;
    this.list.scroll_to_item(this.at);
    if (preview) this.schedulePreview(rows[this.at], cx);
    cx.notify();
  }

  // Previews the file under the cursor once the cursor rests a moment.
  schedulePreview(row, cx) {
    const token = this.previewToken = {};
    if (!row || row.dir) return;
    cx.timer.after(PREVIEW_DELAY, (cx) => { if (this.previewToken === token && !this.closed) this.openFile(row.path, cx); });
  }

  openFile(path, cx) {
    const file = join(this.root, path);
    if (this.selected?.file === file && !this.selected.rev) return;
    this.history = [];
    this.show({ file, root: this.root, on: this.place.on }, cx);
  }

  // Enter: a folder folds, a file opens and takes the keyboard; from the filter
  // the file is also shown in the tree and the filter cleared.
  enter(cx) {
    const rows = this.rows(), row = rows[this.at];
    if (!row) return;
    if (row.dir) { this.nav.toggle(row.path, cx); return; }
    if (row.match) { this.clearFilter(cx); this.reveal(row.path, cx, true); this.atPath = row.path; }
    this.previewToken = null;
    this.openFile(row.path, cx);
    this.viewFocus.focus();
    cx.notify();
  }

  clearFilter(cx) {
    this.filter = ""; this.input.set_value(""); this.matchCache = null;
    this.treeFocus.focus();
    cx.notify();
  }


  // J/K: the next or previous file (folders skipped), shown at once.
  fileStep(d, cx) {
    const rows = this.rows();
    for (let i = this.at + d; i >= 0 && i < rows.length; i += d) {
      if (rows[i].dir) continue;
      this.select(i, rows, cx, false); this.previewToken = null; this.openFile(rows[i].path, cx);
      return;
    }
  }

  // `?` shows every key in place of the viewer; any key closes it.
  helpKey(e, cx) {
    if (!this.help) return false;
    if (!/^(shift|ctrl|alt|cmd|platform|fn)$/.test(e.keystroke)) { this.help = false; cx.notify(); }
    cx.stop_propagation();
    return true;
  }

  treeKey(e, cx) {
    if (this.helpKey(e, cx)) return;
    const k = e.keystroke, rows = this.rows(), row = rows[this.at];
    const typing = this.filtering;
    const done = () => cx.stop_propagation();
    if (k === "down" || k === "ctrl-n" || k === "ctrl-j" || (!typing && k === "j")) { done(); return this.select(this.at + 1, rows, cx); }
    if (k === "up" || k === "ctrl-p" || k === "ctrl-k" || (!typing && k === "k")) { done(); return this.select(this.at - 1, rows, cx); }
    if (k === "pagedown") { done(); return this.select(this.at + 30, rows, cx); }
    if (k === "pageup") { done(); return this.select(this.at - 30, rows, cx); }
    if (k === "ctrl-d") { done(); return this.select(this.at + 15, rows, cx); }
    if (k === "ctrl-u") { done(); return this.select(this.at - 15, rows, cx); }
    // Esc never arrives: the app closes the dialog on it before any mod sees it.
    if (k === "tab" && typing) { done(); this.treeFocus.focus(); return cx.notify(); }
    if (k === "tab") { done(); if (this.selected) this.viewFocus.focus(); return cx.notify(); }
    if (typing) return;
    if (k === "backspace" && this.filter) { done(); return this.clearFilter(cx); } // Enter arrives as the input's submit; letters are the filter's.
    if (k === "enter") { done(); return this.enter(cx); }
    if (k === "/") { done(); this.input.focus(); return cx.notify(); }
    if (k === "g" || k === "home") { done(); return this.select(0, rows, cx); }
    if (k === "shift-g" || k === "end") { done(); return this.select(rows.length - 1, rows, cx); }
    if (k === "r") { done(); this.files = null; this.nav?.refresh(cx); return; }
    if (k === "o") { done(); return this.open(cx); }
    if (k === "shift-j") { done(); return this.fileStep(1, cx); }
    if (k === "shift-k") { done(); return this.fileStep(-1, cx); }
    if (k === "?" || k === "shift-/") { done(); this.help = true; return cx.notify(); }
    if (!row || row.match) return;
    if (k === "right" || k === "l") {
      done();
      if (row.dir && !row.open) this.nav.toggle(row.path, cx);
      else if (row.dir) this.select(this.at + 1, rows, cx);
      else { this.previewToken = null; this.openFile(row.path, cx); }
      return;
    }
    if (k === "left" || k === "h") {
      done();
      if (row.dir && row.open) return this.nav.toggle(row.path, cx);
      const parent = dirname(row.path);
      if (parent !== ".") this.select(rows.findIndex((r) => r.path === parent), rows, cx, false);
    }
  }

  // The viewer's keys. Letters only when no editor shows, so typing in Source still types.
  keyDown(e, cx) {
    if (this.helpKey(e, cx)) return;
    const k = e.keystroke, file = this.selected?.file, type = file ? kind(file) : null;
    const toTree = () => { cx.stop_propagation(); this.treeFocus.focus(); cx.notify(); };
    if (k === "tab" || k === "shift-tab") return toTree();
    if (k === "cmd-s" || k === "ctrl-s") return super.keyDown(e, cx);
    const editor = Boolean(this.code) && (this.source || !richText(type)) && type !== "image" && type !== "pdf";
    if (editor || !file) return;
    if (k === "left" || k === "h") return toTree();
    const headings = this.headings ?? [], i = headings.findIndex((h) => h.slug === this.anchor);
    const act = {
      "]": () => headings.length && i < headings.length - 1 && this.follow("#" + encodeURIComponent(headings[i + 1].slug), cx),
      "[": () => this.anchor && this.follow(i > 0 ? "#" + encodeURIComponent(headings[i - 1].slug) : "#", cx),
      s: () => richText(type) && this.setSource(!this.source, cx),
      c: () => { if (type === "markdown") { this.contents = !this.contents; cx.notify(); } },
      backspace: () => this.history.length && this.back(cx),
      o: () => this.open(cx),
      "shift-j": () => this.fileStep(1, cx), "shift-k": () => this.fileStep(-1, cx),
      "?": () => { this.help = true; cx.notify(); }, "shift-/": () => { this.help = true; cx.notify(); },
      // Local change: scrolling, as in the git and beads viewers.
      j: () => this.scrollView(1, cx), down: () => this.scrollView(1, cx), k: () => this.scrollView(-1, cx), up: () => this.scrollView(-1, cx),
      "ctrl-d": () => this.scrollView(2, cx), pagedown: () => this.scrollView(2, cx), space: () => this.scrollView(2, cx),
      "ctrl-u": () => this.scrollView(-2, cx), pageup: () => this.scrollView(-2, cx), "shift-space": () => this.scrollView(-2, cx),
      g: () => this.scrollView("top", cx), home: () => this.scrollView("top", cx), "shift-g": () => this.scrollView("end", cx), end: () => this.scrollView("end", cx),
    }[k];
    if (act) { cx.stop_propagation(); act(); }
  }

  treePane(colors) {
    const rows = this.rows();
    const found = rows.findIndex((r) => r.path === this.atPath);
    if (found >= 0) this.at = found;
    else if (rows.length) { this.at = Math.min(this.at, rows.length - 1); this.atPath = rows[this.at].path; }
    const active = this.treeFocus.is_focused() || this.filtering;
    const marks = this.nav?.marks ?? {};
    const row = (r, i) => {
      const mark = marks[normalize(join(this.root, r.path))];
      return h_flex().h(ROW).pl(8 + r.depth * 16).pr(8).gap(6).items_center().rounded(6).text_size(12.5)
        .when(i === this.at, (el) => el.bg(active ? colors.selected : colors.hover))
        .child(div().w(10).flex_none().text_color(colors.muted).child(r.dir ? (r.open ? "▾" : "▸") : ""))
        .child(div().flex_none().max_w(260).truncate().text_color(r.dir ? colors.foreground : colors.foreground).when(r.dir, (el) => el.font_medium()).child(r.name))
        .when(Boolean(r.match) && r.path.includes("/"), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(colors.dim).child(dirname(r.path))))
        .when(!r.match, (el) => el.child(div().flex_1()))
        .when(Boolean(mark), (el) => el.child(div().flex_none().text_size(11.5)
          .text_color(mark === "A" ? colors.ansi2 : mark === "D" || mark === "U" ? colors.ansi1 : colors.ansi3).child(mark)));
    };
    const status = !this.nav ? "Loading…" : this.filter.trim() ? (this.files ? `${rows.length}${rows.length === MATCHES ? "+" : ""} matches` : "Listing files…")
      : this.nav.error || (this.nav.loading && !rows.length ? "Loading…" : !rows.length ? "No files" : null);
    return v_flex().id("fb-tree-pane").track_focus(this.treeFocus).min_h(0)
      .on_key_down((e, cx) => this.treeKey(e, cx))
      .on_mouse_down("left", () => { if (!this.filtering) this.treeFocus.focus(); })
      .child(h_flex().h(42).flex_none().px(12).gap(8).items_center().border_b(0.5).border_color(colors.border)
        .child(svg("mods/workspace-chrome/folder.svg").size(14).text_color(colors.muted))
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(this.root ? basename(this.root) : "Files")))
      .child(h_flex().h(32).flex_none().mx(8).my(6).px(8).gap(6).items_center().rounded(7).border_1()
        .border_color(this.filtering ? colors.accent ?? colors.border : colors.border)
        .child(div().text_size(12).text_color(colors.dim).child("/"))
        .child(Input.new(this.input).flex_1().h_full().text_size(12.5).text_color(colors.foreground)))
      .when(Boolean(status), (el) => el.child(div().px(14).py(4).text_size(11.5).text_color(colors.dim).child(status)))
      .child(div().relative().flex_1().min_h(0).px(6)
        .child(v_virtual_list("fb-tree", rows.length, ROW, (i) => rows[i].path, (range) => rows.slice(range.start, range.end).map((r, o) => row(r, range.start + o)))
          .track_scroll(this.list).size_full()
          .on_item_click((path, cx) => {
            const i = rows.findIndex((r) => r.path === path), r = rows[i];
            if (!r) return;
            this.treeFocus.focus();
            if (r.dir) { this.select(i, rows, cx, false); this.nav.toggle(r.path, cx); }
            else this.select(i, rows, cx);
          }))
        .child(Scrollbar.vertical("fb-tree").absolute().right(0).top(0).bottom(0)))
      .child(div().flex_none().px(12).py(7).border_t(0.5).border_color(colors.border).text_size(11).text_color(colors.dim)
        .child(this.viewFocus.is_focused()
          ? "h ← ⇥ tree · J K files · [ ] headings · s source · ? help"
          : (this.filter ? `${this.filesCapped ? `first ${FILES.toLocaleString()} files only · ` : ""}↑↓ move · ⏎ open · ⇥ list · ⌫ clear · ? help`
            : `${this.treeCapped ? "first 5,000 rows only · " : ""}j k move · h l fold · ⏎ open · / filter · ⇥ viewer · ? help`)));
  }

  helpPanel(colors) {
    const groups = [
      ["Tree", [["j k  ↑ ↓  ⌃N ⌃P", "move (the file under the cursor previews)"], ["⌃D ⌃U  PgDn PgUp", "half / whole page"], ["g G  Home End", "first / last"],
        ["l →", "open a folder, step in, or show the file"], ["h ←", "close the folder, or go to its parent"], ["⏎", "open the file (keyboard to the viewer)"],
        ["J K", "next / previous file"], ["/  ⌫", "filter the whole repo (fuzzy), clear it"], ["r  o", "reload / open in its app"]]],
      ["Viewer", [["j k  ↑ ↓", "scroll (Markdown by block, JSON and CSV by row)"], ["⌃D ⌃U  space", "a page down / up (also PgDn PgUp)"], ["g G  Home End", "top / end"],
        ["click the code", "code scrolls with its own keys: arrows, PgUp PgDn"], ["h ← ⇥", "back to the tree"], ["J K", "next / previous file"], ["[ ]", "previous / next heading"], ["s  c", "source ⇄ preview / contents"],
        ["⌫", "back after following a link"], ["⌘S", "save (in Source)"], ["o", "open in its app"]]],
      ["Window", [["?", "this help (any key closes it)"], ["esc", "close the dialog"]]],
    ];
    return v_flex().id("fb-help").size_full().overflow_y_scrollbar().px(20).py(14).gap(14).text_size(12.5)
      .children(groups.map(([title, rows]) => v_flex().gap(3)
        .child(div().pb(2).text_size(12).font_semibold().text_color(colors.accent ?? colors.foreground).child(title))
        .children(rows.map(([keys, what]) => h_flex().gap(12).child(div().w(170).flex_none().child(keys)).child(div().flex_1().min_w(0).text_color(colors.muted).child(what))))));
  }

  render(cx) {
    const { colors, font } = appearance();
    const viewer = super.render(cx);
    return h_flex().id("file-browser").size_full().min_h(0).overflow_hidden().bg(colors.background)
      .text_color(colors.foreground).font_family(font).text_size(13)
      .child(this.treePane(colors).w(320).flex_none().h_full().border_r(0.5).border_color(colors.border))
      .child(div().id("fb-view").track_focus(this.viewFocus).flex_1().min_w(0).h_full().child(this.help ? this.helpPanel(colors) : viewer));
  }

  // Local change: opened by another mod with props { closedKey, closedToken }, it says when it
  // closes (Herdr has no event for that), so that mod can take the keyboard back. The props
  // are kept from when it opened.
  async close(cx) {
    const { closedKey, closedToken } = this.opener ?? {};
    if (typeof closedKey === "string") setShared(closedKey, closedToken ?? true);
    this.list.release();
    return super.close?.(cx);
  }
}
