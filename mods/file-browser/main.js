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
import { focused, panes, spaces, exec, home, props, closeOverlay, setShared, settings } from "herdr";
import { footerBar } from "./lib/bars.js";
import { navIndex, moveHelp, HELP_KEYS, HELP_ROW } from "./lib/keymap.js";
import { closeSide, focusFrame } from "./lib/sidecolumn.js";
import Viewer from "./viewer.js";
import { Tree, directory } from "./tree.js";
import { join, normalize, kind, richText, basename, dirname, typedPath, pathMatches, completion } from "./paths.js";
import { appearance } from "./appearance.js";
import { TYPE } from "./lib/type.js";

const NO_FILES = [];
const ROW = 26, MATCHES = 300, FILES = 20000, PREVIEW_DELAY = 120, TREE_W = 320, LIVE = 3000;
// Vim's normal mode on code: these keys are bound (context FbNormal, the editor's frame) to actions of the browser,
// so the read-only editor keeps the keyboard (its cursor and selection show) and never sees them as typing.
const NORMAL_KEYS = ["j", "k", "h", "l", "g", "shift-g", "y", "shift-y", "shift-v", "i", "/", "n", "shift-n", "o", "s", "shift-j", "shift-k",
  "?", "shift-/", "[", "]", "escape", "tab", "shift-tab", "backspace", "enter", "space", "ctrl-d", "ctrl-u", "ctrl-f", "ctrl-b", "ctrl-w",
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const normalAction = (k) => "file_browser_normal_" + k.replace(/[^a-z0-9]/g, (c) => "_" + c.charCodeAt(0));
let normalBound = false;

// Where the focused terminal is, read once when the dialog opens. Local change: or the
// folder another mod opened it on (the git graph's `v`: props { folder, path, rev }).
function start() {
  const p = props() ?? {};
  if (typeof p.folder === "string" && p.folder) return { cwd: p.folder, on: typeof p.on === "string" && p.on ? p.on : null, spaceId: spaces().find((s) => s.active)?.id ?? null, path: p.path, rev: p.rev, line: p.line };
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
// The file list and every folder on the way to its files ("src/lib/", trailing slash), so / finds folders too.
export function withFolders(names) {
  const dirs = new Set();
  for (const n of names) for (let i = n.indexOf("/"); i > 0; i = n.indexOf("/", i + 1)) dirs.add(n.slice(0, i + 1));
  return [...dirs, ...names];
}

// The best matches (matchFiles' rows, best first) as a tree: each inside its folders, which are open, sorted as the
// tree is (folders first, then by name). `hit`: a match itself, not only on the way to one; `hl`: the letters of its
// name that matched (in a match's path, the letters in a folder's name light up on that folder's row).
export function matchTree(ranked, filter) {
  const terms = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const nodes = new Map([["", { children: [] }]]), hl = new Map();
  const node = (path, dir) => {
    let n = nodes.get(path);
    if (n) { if (dir) n.dir = true; return n; }
    n = { path, name: basename(path), dir, children: [], hit: false };
    nodes.set(path, n);
    node(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "", true).children.push(n);
    return n;
  };
  for (const r of ranked) {
    node(r.path, r.dir).hit = true;
    const lower = r.path.toLowerCase();
    // A term lights up where it is in the name (its last place in the path).
    const where = (t) => { const at = lower.lastIndexOf(t); return at < 0 ? [] : [...t].map((_, k) => at + k); };
    for (const t of terms) for (const pos of where(t)) {
      if (lower[pos] === "/") continue;
      const end = lower.indexOf("/", pos), seg = end < 0 ? r.path : r.path.slice(0, end), from = lower.lastIndexOf("/", pos) + 1;
      if (!hl.has(seg)) hl.set(seg, new Set());
      hl.get(seg).add(pos - from);
    }
  }
  const rows = [];
  const walk = (n, depth) => {
    for (const c of [...n.children].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))) {
      rows.push({ path: c.path, name: c.name, dir: c.dir, depth, open: c.children.length > 0, match: true, hit: c.hit, hl: [...(hl.get(c.path) ?? [])].sort((a, b) => a - b) });
      walk(c, depth + 1);
    }
  };
  walk(nodes.get(""), 0);
  return { rows, best: ranked[0]?.path ?? null, hits: ranked.length };
}

// A term matches as typed (any case) inside one file or folder name, as ripgrep and fd match names, never letters
// spread over the path; a term with a / in it may span folders. Higher: in the file's (or folder's) own name, at the
// start of the name, at the start of a word (after - _ . or a space). null: not there.
// Two lookups at most per path: a letter typed over 40,000 paths must stay well inside the script's time limit.
function nameScore(t, p) {
  const end = p.endsWith("/") ? p.length - 1 : p.length, name = p.lastIndexOf("/", end - 1) + 1;
  const own = p.indexOf(t, name);
  if (own >= 0) return 9 + (own === name ? 8 : "_-. ".includes(p[own - 1]) ? 4 : 0) - p.length * 0.01;
  const at = p.indexOf(t);
  if (at < 0) return null;
  return 1 + (at === 0 || "/_-. ".includes(p[at - 1]) ? 4 : 0) - p.length * 0.01;
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
    for (const t of terms) { const s = nameScore(t, p); if (s === null) { total = null; break; } total += s; }
    if (total === null) continue;
    pool.push(i); // every term is there: a longer filter looks at it again
    // A match needs a term in its own name: a folder's name alone doesn't make all its files matches (they'd
    // bury the folder).
    const end = p.endsWith("/") ? p.length - 1 : p.length, name = p.lastIndexOf("/", end - 1) + 1;
    if (!terms.some((t) => p.lastIndexOf(t) + t.length > name)) continue; // reaching into the name (a/b spans folders)
    const e = [total, p.length, i];
    if (heap.length < MATCHES) {
      heap.push(e);
      for (let c = heap.length - 1; c && worse(heap[c], heap[(c - 1) >> 1]);) { const up = (c - 1) >> 1; [heap[c], heap[up]] = [heap[up], heap[c]]; c = up; }
    } else if (worse(heap[0], e)) { heap[0] = e; down(0); }
  }
  heap.sort((a, b) => (worse(a, b) ? 1 : worse(b, a) ? -1 : 0));
  // A folder is in the list with a trailing slash (see withFolders).
  const rows = heap.map(([, , i]) => {
    const dir = files[i].endsWith("/"), path = dir ? files[i].slice(0, -1) : files[i];
    return { path, name: basename(path), dir, depth: 0, match: true };
  });
  return { rows, pool };
}

export default class FileBrowser extends Viewer {
  init(p, cx) {
    const s = start();
    this.opener = props() ?? {};
    // Docked in the side panel (⌘⌥O) rather than opened as a dialog (⌘⇧O): one column, the tree or the file it
    // shows, and it follows the focused terminal to another repository.
    this.docked = !this.opener.overlay;
    this.showing = false; // docked: the file in place of the tree
    this.place = { mode: "browser", spaceId: s.spaceId, cwd: s.cwd, on: s.on };
    this.followKey = `${s.cwd}|${s.on}`;
    this.root = null; this.nav = null;
    this.at = 0; this.atPath = null;
    this.filter = ""; this.filtering = false; this.files = null; this.matchCache = null;
    this.treeFocus = cx.focus_handle(); this.viewFocus = cx.focus_handle();
    this.list = VirtualListScrollHandle.new();
    this.input = InputState.new({ placeholder: "Filter files" });
    this.input.on("focus", (_e, cx) => { this.filtering = true; this.ensureFiles(cx); cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.filtering = false; cx.notify(); });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; this.atPath = null; this.toBest = true; this.ensureFiles(cx); cx.notify(); });
    this.homes = {}; // a remote machine's home, for ~ in a typed path
    this.input.on("submit", (_e, cx) => this.enter(cx));
    if (!normalBound) { normalBound = true; cx.bind_keys(NORMAL_KEYS.map((k) => ({ keystroke: k, action: normalAction(k), context: "FbNormal" }))); }
    // Vim: / finds in the file (incremental, from where it started), ⏎ keeps the match, esc goes back.
    this.findInput = InputState.new({ placeholder: "Find in file" });
    this.findInput.on("change", (_e, cx) => { if (this.finding) this.findStep(1, cx, true); });
    this.findInput.on("submit", (_e, cx) => this.endFind(true, cx));
    try { this.hideDot = localStorage.getItem("file-browser.hidden") === "hide"; } catch { this.hideDot = false; }
    try { this.treeW = Number(localStorage.getItem("file-browser.treeWidth")) || TREE_W; } catch { this.treeW = TREE_W; }
    super.init(p, cx);
    this.treeFocus.focus();
    // The dialog takes the keyboard a moment after it opens; a window (⌘⇧O) not at all, so it is focused here.
    cx.timer.after(300, () => { if (!this.filtering && !this.inView()) this.treeFocus.focus(); });
    // The keyboard came or went (a click in the terminal, say): redraw, so the docked panel's blue line follows it.
    // Herdr sends no blur, so it asks every 50 ms (one check; a redraw only on a change).
    if (this.docked) cx.timer.every(50, (cx) => { const keys = this.treeFocus.is_focused() || this.inView() || this.filtering; if (keys !== this.hadKeys) { this.hadKeys = keys; cx.notify(); } });
    this.openAt(s, cx);
  }

  // The tree of the repository (or folder) `s.cwd` is in, opened down to it; a file from props shown.
  // Only the latest load lands: a docked browser that moves on while git answers keeps the newer repository.
  openAt(s, cx) {
    const load = this.openLoad = {};
    this.homes ??= {};
    if (s.on && this.homes[s.on] === undefined) {
      this.homes[s.on] = null;
      exec("sh", ["-c", 'printf %s "$HOME"'], { on: s.on }).then((r) => { if (r.code === 0 && r.stdout.startsWith("/")) this.homes[s.on] = r.stdout; }).catch(() => {});
    }
    cx.spawn(async (cx) => {
      // The top folder and where the terminal is inside it, as git sees them (symlinks resolved: a terminal in
      // /tmp/x is in /private/tmp/x, so comparing path strings would miss it).
      const top = await exec("git", ["rev-parse", "--show-toplevel", "--show-prefix"], { cwd: s.cwd, on: s.on }).catch(() => null);
      if (this.closed || this.openLoad !== load) return;
      const [topDir, prefix = ""] = top?.code === 0 ? top.stdout.split("\n") : [];
      this.root = this.home = top?.code === 0 ? topDir.trim() : s.cwd;
      this.git = top?.code === 0;
      this.readBranch(cx);
      const nav = this.nav = new Tree({ cwd: this.root, on: s.on }, () => !this.closed && this.nav === nav);
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
        this.focusView();
      }
      cx.notify();
    });
  }

  context() { return this.place ?? { mode: "browser" }; }

  // Docked: the focused terminal moved to another folder. Another repository gets its tree; a folder in the same
  // one keeps the tree as it is. A focus with no folder (the panel itself) changes nothing. Not `follow`: that is
  // the viewer's (a link or heading), which Markdown links and [ ] call on this panel.
  followTerminal(cx) {
    const f = focused();
    if (!f?.cwd && !f?.pane) return;
    const s = start(), key = `${s.cwd}|${s.on}`;
    if (key === this.followKey) return;
    this.followKey = key;
    // A tree still loading for the folder before lands nowhere; below, the new folder's repository loads unless
    // its tree is the one already shown.
    this.openLoad = null;
    cx.spawn(async (cx) => {
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: s.cwd, on: s.on }).catch(() => null);
      const root = top?.code === 0 ? top.stdout.trim() : s.cwd;
      if (this.closed || this.followKey !== key || (root === this.root && s.on === this.place.on)) return;
      this.place = { mode: "browser", spaceId: s.spaceId, cwd: s.cwd, on: s.on };
      this.root = null; this.nav = null; this.files = null; this.filesLoad = null; this.loadingFiles = false;
      this.matchCache = null; this.filter = ""; this.input.set_value("");
      this.at = 0; this.atPath = null; this.showing = false;
      this.openAt(s, cx);
      cx.notify();
    });
  }

  // Docked: the file shown in place of the tree, or the tree again.
  showFile(on, cx) {
    if (!this.docked) return;
    this.showing = on;
    if (on) this.focusView(); else this.treeFocus.focus();
    cx.notify();
  }

  back(cx) {
    if (this.docked && this.showing && !this.history.length) return this.showFile(false, cx);
    return super.back(cx);
  }

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

  // The whole repo's file names, for the filter: git's list, else find. A typed path lists its folder instead.
  ensureFiles(cx) {
    if (this.typed()) return this.loadTyped(cx);
    if (this.git === false) return this.liveSearch(cx);
    if (this.files || this.loadingFiles || !this.root) return;
    this.loadingFiles = true;
    const load = this.filesLoad = {};
    cx.spawn(async (cx) => {
      const opts = { cwd: this.root, on: this.place.on };
      let names = [];
      const git = this.git && await exec("git", ["ls-files", "-co", "--exclude-standard", "-z"], opts).catch(() => null);
      if (git?.code === 0) names = git.stdout.split("\0").filter(Boolean);
      else {
        const r = await exec("sh", ["-c", `find . -type f -not -path '*/.git/*' -not -path '*/node_modules/*' | head -n ${FILES}`], opts).catch(() => null);
        names = (r?.stdout ?? "").split("\n").filter(Boolean).map((n) => n.replace(/^\.\//, ""));
      }
      if (this.closed || this.filesLoad !== load) return; // another repository's list by now
      this.filesCapped = names.length >= FILES; // said in the footer: the filter doesn't see the rest
      this.files = withFolders(names.slice(0, FILES));
      lowerOf(this.files); // now, not on the first letter typed
      this.loadingFiles = false; this.matchCache = null;
      cx.notify();
    });
  }

  rows() {
    if (!this.nav) return [];
    if (this.filter.trim()) return this.typed() ? this.typedRows() : this.matches();
    const out = [];
    this.treeCapped = false;
    const walk = (prefix, depth) => {
      for (const e of this.nav.entries.get(prefix) || []) {
        if (this.hideDot && e.name.startsWith(".")) continue;
        if (out.length >= 5000) { this.treeCapped = true; return; } // said in the footer
        const path = prefix ? `${prefix}/${e.name}` : e.name, open = e.dir && this.nav.folders.has(path);
        out.push({ path, name: e.name, dir: e.dir, depth, open });
        if (open) walk(path, depth + 1);
      }
    };
    walk("", 0);
    return out;
  }

  // The filter's matches as a tree (matchTree); the cursor starts on the best match.
  matches() {
    const key = this.filter, last = this.matchCache, list = this.searchList();
    if (last?.key === key && last.files === list) return last.tree.rows;
    const { rows, pool } = matchFiles(list, key, last?.files === list ? last : null);
    this.matchCache = { key, files: list, rows, pool, tree: matchTree(rows, key) };
    return this.matchCache.tree.rows;
  }

  // Outside a repository (above one with u, ~/Code): no list of every file up front, which would stop after the first
  // FILES and miss the rest. As fd and ripgrep do, the file system is asked for names holding what was typed (the
  // longest term; a term with / against the whole path), each time the filter changes: fd (skips what .gitignore
  // ignores, as node_modules), else find. The answer is ranked with all the terms, as git's list is.
  liveSearch(cx) {
    const filter = this.filter.trim(), root = this.root, on = this.place.on;
    const token = this.liveToken = {};
    if (!filter || !root) { this.liveList = null; this.liveBusy = false; return cx.notify(); }
    cx.timer.after(120, (cx) => {
      if (this.liveToken !== token || this.closed) return;
      const terms = filter.toLowerCase().split(/\s+/);
      const span = terms.find((t) => t.includes("/")), term = span ?? terms.reduce((a, b) => (b.length > a.length ? b : a));
      const script = `if command -v fd >/dev/null 2>&1; then fd -H -i -F --exclude .git --max-results ${LIVE} ${span ? "--full-path " : ""}-- "$1";`
        + ` else find . \\( -name node_modules -o -name .git \\) -prune -o \\( -type d -iname "*$1*" -exec printf '%s/\\n' {} + \\)`
        + ` -o \\( -iname "*$1*" -print \\) 2>/dev/null | head -n ${LIVE}; fi`;
      this.liveBusy = true; cx.notify();
      exec(on ? "sh" : "/bin/zsh", ["-lc", script, "fb", term], { cwd: root, on, timeout: 20000 })
        .catch((error) => ({ code: 1, stdout: "", stderr: String(error.message || error) }))
        .then((r) => {
          if (this.liveToken !== token || this.closed || this.root !== root) return;
          this.liveBusy = false;
          this.liveList = r.stdout.split("\n").filter(Boolean).map((p) => p.replace(/^\.\//, ""));
          this.liveCapped = this.liveList.length >= LIVE;
          this.matchCache = null; this.toBest = true;
          cx.notify();
        });
    });
  }

  // What / searches: git's file list (or find's) with its folders, and everything the tree has listed so far, which
  // git's list leaves out: the top level always, folders git ignores (.worktrees), empty ones, and what's past the
  // first FILES files above a repository. Made again when either changes.
  searchList() {
    if (this.git === false) return this.liveList ?? NO_FILES;
    const nav = this.nav;
    let size = 0;
    for (const entries of nav?.entries.values() ?? []) size += entries.length;
    const sig = `${size}|${nav?.entries.size ?? 0}`;
    if (this.searchCache?.files === this.files && this.searchCache.nav === nav && this.searchCache.sig === sig) return this.searchCache.list;
    const listed = [];
    for (const [prefix, entries] of nav?.entries ?? []) for (const e of entries) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      listed.push(e.dir ? path + "/" : path);
    }
    const files = this.files ?? [], have = new Set(files);
    const list = [...files, ...listed.filter((p) => !have.has(p))];
    this.searchCache = { files: this.files, nav, sig, list };
    return list;
  }

  // ---------- a path typed into the filter (~/Code/x/, /tmp/y, ../z): its folder's entries that begin with the name
  // typed, ⇥ completes as a shell does, ⏎ opens a folder as the tree or a file in it.

  homeDir() { return this.place.on ? this.homes[this.place.on] : home(); }
  typed() { return this.root && this.filter ? typedPath(this.filter, this.homeDir(), this.root) : null; }

  // Lists the typed path's folder (once per folder; the latest folder typed wins).
  loadTyped(cx) {
    const p = this.typed();
    if (!p || this.typedList?.dir === p.dir) return;
    const list = this.typedList = { dir: p.dir, entries: null, error: null };
    directory(p.dir, this.place.on)
      .then((entries) => { if (this.typedList !== list) return; list.entries = entries; this.toBest = true; cx.notify(); })
      .catch(() => { if (this.typedList !== list) return; list.error = "No such folder"; cx.notify(); });
  }

  // The rows: absolute paths (`abs`); with nothing begun after the last /, the folder itself first, as ".".
  typedRows() {
    const p = this.typed(), list = this.typedList;
    if (!p || list?.dir !== p.dir || !list.entries) return [];
    const row = (abs, name, dir, hl = []) => ({ path: abs, abs, name, dir, depth: 0, open: false, match: true, hit: true, hl });
    const hl = [...Array(p.partial.length).keys()];
    return [...(p.partial ? [] : [row(p.dir, ".", true)]),
      ...pathMatches(list.entries, p.partial).map((e) => row(join(p.dir, e.name), e.dir ? e.name + "/" : e.name, e.dir, hl))];
  }

  // The text in the filter, the cursor after it.
  setTyped(text, cx) {
    this.input.set_value(text); this.input.set_selected_range({ start: text.length, end: text.length });
    this.filter = text; this.at = 0; this.atPath = null; this.toBest = true;
    this.loadTyped(cx); cx.notify();
  }

  // ⇥: the name completed (a folder's / added, so the next ⇥ goes on in it); with nothing to add, the row under the
  // cursor (moved there with ↑↓) is taken.
  completeTyped(cx) {
    const t = this.filter.trim(), p = this.typed();
    if (t === "~" || /(^|\/)\.\.?$/.test(t)) return this.setTyped(t + "/", cx);
    const list = this.typedList;
    if (list?.dir !== p.dir || !list.entries) return this.say(list?.error ?? "Listing the folder…", cx);
    const ms = pathMatches(list.entries, p.partial), head = t.slice(0, t.length - p.partial.length);
    const add = completion(ms, p.partial);
    if (add != null) return this.setTyped(head + add, cx);
    const row = this.typedRows()[this.at];
    if (row && row.name !== "." && this.at > 0) return this.setTyped(head + row.name, cx);
    return this.say(ms.length ? `${ms.length} names begin so: type on, or ↑↓ then ⇥` : "No match", cx);
  }

  // ⏎ on a typed path: a folder becomes the tree; a file opens, in the tree it's in (its repository, else its
  // folder; the tree shown when the file is inside it). Typed whole with nothing listed: asked whether it's there.
  openTyped(row, cx) {
    const on = this.place.on;
    const go = (abs, dir) => {
      this.clearFilter(cx);
      if (dir) return this.setRoot(normalize(abs), null, cx);
      const rel = this.relative(abs);
      if (rel) { this.reveal(rel, cx, true); this.atPath = rel; this.revealScroll = rel; this.openFile(rel, cx); this.focusView(); this.showFile(true, cx); return; }
      cx.spawn(async (cx) => {
        const at = await exec("git", ["rev-parse", "--show-toplevel", "--show-prefix"], { cwd: dirname(abs), on }).catch(() => null);
        if (this.closed) return;
        const [top, prefix = ""] = at?.code === 0 ? at.stdout.split("\n") : [];
        const root = at?.code === 0 ? top.trim() : dirname(abs), folder = at?.code === 0 ? prefix.trim().replace(/\/$/, "") : "";
        const rel = folder ? `${folder}/${basename(abs)}` : basename(abs);
        this.setRoot(root, folder || null, cx);
        this.atPath = rel; this.revealScroll = rel;
        this.show({ file: join(root, rel), root, on }, cx);
        this.focusView(); this.showFile(true, cx);
      });
    };
    if (row?.abs) return go(row.abs, row.dir);
    const p = this.typed();
    if (!p) return;
    const abs = normalize(join(p.dir, p.partial));
    exec("sh", ["-c", 'if [ -d "$1" ]; then echo d; elif [ -e "$1" ]; then echo f; fi', "fb", abs], { on })
      .then((r) => { const what = r.stdout.trim(); if (what) go(abs, what === "d"); else this.say(`Not there: ${this.filter.trim()}`, cx); })
      .catch(() => this.say(`Not there: ${this.filter.trim()}`, cx));
  }

  select(i, rows, cx, preview = true) {
    if (!rows.length) return;
    this.at = Math.max(0, Math.min(rows.length - 1, i));
    this.atPath = rows[this.at].path;
    this.list.scroll_to_item(this.at);
    if (preview && !this.docked) this.schedulePreview(rows[this.at], cx);
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
    if (this.typed()) return this.openTyped(row, cx);
    if (!row) return;
    // A folder found with /: the tree opened down to it and the cursor on it (the keyboard stays in the tree).
    if (row.dir && row.match) {
      this.clearFilter(cx); this.reveal(row.path, cx); this.atPath = row.path;
      this.treeFocus.focus(); this.revealScroll = row.path; return cx.notify();
    }
    if (row.dir) { this.nav.toggle(row.path, cx); return; }
    if (row.match) { this.clearFilter(cx); this.reveal(row.path, cx, true); this.atPath = row.path; this.revealScroll = row.path; }
    this.previewToken = null;
    this.openFile(row.path, cx);
    this.focusView();
    this.showFile(true, cx);
    cx.notify();
  }

  clearFilter(cx) {
    this.filter = ""; this.input.set_value(""); this.matchCache = null; this.typedList = null;
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
    if (e.keystroke === "ctrl-[") e = { ...e, key: "escape", keystroke: "escape" }; // ⌃[ is Esc, as in vim
    if (this.helpKey(e, cx)) return;
    const k = e.keystroke, rows = this.rows(), row = rows[this.at];
    const typing = this.filtering;
    const done = () => cx.stop_propagation();
    // lib/keymap.js: the same moves on every board (in the filter field, letters and Home/End are the field's).
    const to = typing && ["j", "k", "g", "shift-g", "home", "end"].includes(k) ? null : navIndex(k, this.at, rows.length, 30);
    if (to !== null) { done(); return this.select(to, rows, cx); }
    // Esc leaves the filter field for the tree, the filter kept (⌫ clears it), then closes the side panel or the
    // window, as every board's Esc (⌘⇧O opens a window, which hears Esc; opened as a dialog, by the git graph, the
    // app closes it before any mod sees Esc).
    if (k === "escape") {
      done();
      if (typing) { this.treeFocus.focus(); return cx.notify(); }
      return this.closeBrowser();
    }
    if (k === "q" && !typing) { done(); return this.closeBrowser(); }
    if (k === "tab" && typing && this.typed()) { done(); return this.completeTyped(cx); }
    if (k === "tab" && typing) { done(); this.treeFocus.focus(); return cx.notify(); }
    if (k === "tab") { done(); if (this.selected) { this.focusView(); this.showFile(true, cx); } return cx.notify(); }
    if (typing) return;
    // Two-key commands (yy, ⌃W l), as vim and NERDTree; g alone is the first row (gg too), as on every board.
    const prev = this.pendingKey; this.pendingKey = null;
    if (prev === "y" && k === "y") { done(); return row && this.copy(row.path, "path", cx); }
    if (prev === "ctrl-w" && (k === "l" || k === "w" || k === "right")) { done(); if (this.selected) { this.focusView(); this.showFile(true, cx); } return cx.notify(); }
    if (prev === "ctrl-w" && this.resizeKey(k, cx)) return done();
    if (k === "y" || k === "ctrl-w") { done(); this.pendingKey = k; return cx.notify(); }
    if (prev) cx.notify();
    if (k === "shift-y") { done(); return row && this.copy(normalize(join(this.root, row.path)), "path", cx); }
    if (k === "u") { done(); return this.upRoot(cx); }
    if (k === "shift-c") { done(); return row?.dir && !row.match && this.setRoot(normalize(join(this.root, row.path)), null, cx); }
    if (k === "shift-p") { done(); return this.home && this.root !== this.home && this.setRoot(this.home, this.root.startsWith(this.home + "/") ? this.root.slice(this.home.length + 1) : null, cx); }
    if (k === "shift-i") {
      done(); this.hideDot = !this.hideDot;
      try { localStorage.setItem("file-browser.hidden", this.hideDot ? "hide" : "show"); } catch {}
      return this.say(this.hideDot ? "Hidden files hidden" : "Hidden files shown", cx);
    }
    if (k === "backspace" && this.filter) { done(); return this.clearFilter(cx); } // Enter arrives as the input's submit; letters are the filter's.
    if (k === "enter") { done(); return this.enter(cx); }
    if (k === "/") { done(); this.input.focus(); return cx.notify(); }
    if (k === "shift-r" || k === "r") { done(); this.files = null; this.nav?.refresh(cx); return; }
    if (k === "o") { done(); return this.open(cx); }
    if (k === "shift-j") { done(); return this.fileStep(1, cx); }
    if (k === "shift-k") { done(); return this.fileStep(-1, cx); }
    if (HELP_KEYS.includes(k)) { done(); this.help = true; return cx.notify(); }
    if (!row || row.match) return;
    if (k === "right" || k === "l") {
      done();
      if (row.dir && !row.open) this.nav.toggle(row.path, cx);
      else if (row.dir) this.select(this.at + 1, rows, cx);
      else { this.previewToken = null; this.openFile(row.path, cx); this.focusView(); this.showFile(true, cx); cx.notify(); }
      return;
    }
    if (k === "left" || k === "h") {
      done();
      if (row.dir && row.open) return this.nav.toggle(row.path, cx);
      const parent = dirname(row.path);
      if (parent !== ".") this.select(rows.findIndex((r) => r.path === parent), rows, cx, false);
    }
  }

  // Test keys (lib/testkeys.js, from viewer.js's command loop): to the pane that has the keyboard, as typed.
  testPress(e, cx) { return this.viewFocus?.is_focused() ? this.keyDown(e, cx) : this.treeKey(e, cx); }
  testState() {
    return {
      shown: this.docked ? true : Boolean(props()?.overlay), docked: this.docked, pane: this.viewFocus?.is_focused() ? "view" : "tree",
      at: this.at ?? null, rows: this.rows?.().length ?? 0, file: this.selected?.file ? basename(this.selected.file) : null,
      filtering: Boolean(this.filtering), help: Boolean(this.help), editing: Boolean(this.editing), finding: Boolean(this.finding),
      visual: this.visual ?? null, history: this.history?.length ?? 0,
      index: this.at ?? -1, atEnd: (this.rows?.().length ?? 0) > 0 && this.at === this.rows().length - 1,
    };
  }
  // Keys a test script may not press: ones that write a file, use the clipboard or open another program.
  testRefuses(k) {
    if (["cmd-s", "ctrl-s", "o"].includes(k)) return "it saves a file or opens another program";
    if (this.viewFocus?.is_focused() && ["y", "i", "a", "e", "x", "p", "shift-p"].includes(k)) return "in the file it edits or copies";
    return null;
  }

  closeBrowser() { return this.docked ? closeSide("file-browser") : closeOverlay(this.opener.overlay); }

  // The tree's width: dragged at its edge, or vim's ⌃W < ⌃W > (narrower, wider) and ⌃W = (as it was); remembered.
  setTreeWidth(w, cx, save = true) {
    this.treeW = Math.round(Math.max(180, Math.min(w, (this.windowW || 1400) - 320)));
    if (save) try { localStorage.setItem("file-browser.treeWidth", String(this.treeW)); } catch {}
    cx.notify();
  }
  resizeKey(k, cx) {
    if (k === "<" || k === "shift-,") return this.setTreeWidth(this.treeW - 40, cx) ?? true;
    if (k === ">" || k === "shift-.") return this.setTreeWidth(this.treeW + 40, cx) ?? true;
    if (k === "=") return this.setTreeWidth(TREE_W, cx) ?? true;
    return false;
  }

  readBranch(cx) {
    const root = this.root;
    exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, on: this.place.on }).then((r) => {
      if (this.closed || this.root !== root) return;
      this.branch = r.code === 0 ? r.stdout.trim() : null; cx.notify();
    }).catch(() => {});
  }

  // The status bar across the window (vim's status line): the mode and a half-typed command or what just happened,
  // the keys that matter where the keyboard is, and where you are.
  statusBar(colors) {
    const file = this.selected?.file, type = file ? kind(file) : null, code = Boolean(type) && this.isCode(type) && Boolean(this.code);
    const inView = this.inView(), tree = !inView && !this.finding;
    const mode = this.finding ? "FIND" : this.filtering || (tree && this.filter) ? "FILTER" : tree ? "TREE"
      : this.editing ? "INSERT" : this.visual != null ? "VISUAL" : code ? "NORMAL" : "VIEW";
    const pending = `${this.count || ""}${this.pendingKey === "ctrl-w" ? "⌃W" : this.pendingKey || ""}`;
    const keys = this.finding ? "⏎ keep · esc back · then n N"
      : this.filtering ? (this.typed() ? "a path · ⇥ complete · ↑↓ move · ⏎ open · esc clear" : "type a name, or a path (~/ /) · ↑↓ ⌃N ⌃P move · ⏎ open · ⇥ to the list · esc clear")
      : tree ? "j k move · l open · / filter · u up · yy path · ⇥ file · q close · ? help"
      : this.editing ? "esc normal mode · ⌘S save"
      : this.visual != null ? `${Math.abs(this.dataAt - this.visual) + 1} lines · j k extend · y copy · esc cancel`
      : code ? `i insert · / find · V lines · yy copy · gg G${type === "json" || type === "yaml" ? " · s tree view" : ""} · ⇥ tree · ? help`
      : "j k scroll · [ ] headings · s source · c contents · h tree · ? help";
    const facts = [];
    if (tree || !file) {
      if (this.root) facts.push(this.root.startsWith(home() + "/") ? "~" + this.root.slice(home().length) : this.root);
      if (this.branch) facts.push(this.branch);
    } else {
      if (code) {
        const t = this.textIndex(), r = this.code.selected_range(), n = this.lineAt(r.start);
        if (t) facts.push(`${n + 1}:${r.start - t.offsets[n] + 1}`, `${t.lines.length.toLocaleString()} lines`);
      }
      if (this.dirty?.()) facts.push("modified");
      else if (this.code && !this.document) facts.push("read-only");
      if (this.truncated) facts.push("first 400 KB");
      facts.push(type === "text" ? (file.split(".").pop() || "text") : type);
    }
    const accent = { NORMAL: colors.accent, INSERT: colors.ansi2, VISUAL: colors.ansi5, FIND: colors.ansi3, FILTER: colors.ansi3, TREE: colors.muted, VIEW: colors.muted }[mode] ?? colors.muted;
    return footerBar(h_flex(), colors).id("fb-status").px(10).gap(10)
      .child(div().flex_none().px(6).rounded(4).bg(accent ?? colors.muted).text_color(colors.background).font_bold().child(mode))
      .when(Boolean(this.flash || pending), (el) => el.child(div().flex_none().text_color(colors.foreground).child(this.flash ? this.flash.text : pending)))
      .child(div().flex_1().min_w(0).truncate().child(keys))
      .child(div().flex_none().max_w(420).truncate().child(facts.join(" · ")));
  }

  // A short word in the footer (what was copied, no match), gone after two seconds.
  say(text, cx) {
    const token = this.flash = { text };
    cx.timer.after(2000, (cx) => { if (this.flash === token) { this.flash = null; cx.notify(); } });
    cx.notify();
  }

  copy(text, what, cx) {
    cx.write_to_clipboard(text);
    const lines = what === "lines" ? text.replace(/\n$/, "").split("\n").length : 0;
    this.say(what === "path" ? `Copied ${text}` : what === "file" ? "Copied the whole file" : `Copied ${lines} line${lines === 1 ? "" : "s"}`, cx);
  }

  // NERDTree's u (the folder above as the tree, even above the repository) and C (this folder as the tree). The tree
  // starts again there; `select` (relative to it) is opened and selected, e.g. the folder just left.
  upRoot(cx) {
    const parent = dirname(this.root);
    if (!parent || parent === this.root || parent === ".") return;
    this.setRoot(parent, basename(this.root), cx);
  }

  setRoot(dir, select, cx) {
    this.openLoad = null;
    this.root = dir; this.files = null; this.filesLoad = null; this.loadingFiles = false; this.matchCache = null;
    this.filter = ""; this.input.set_value(""); this.at = 0; this.atPath = select || null;
    const on = this.place.on;
    cx.spawn(async (cx) => {
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: dir, on }).catch(() => null);
      if (this.closed || this.root !== dir) return;
      this.git = top?.code === 0;
      this.readBranch(cx);
      const nav = this.nav = new Tree({ cwd: dir, on }, () => !this.closed && this.nav === nav);
      nav.refresh(cx); nav.watch(cx);
      if (select) this.reveal(select, cx);
      cx.notify();
    });
    cx.notify();
  }

  // / in code: the find bar; the match follows each letter (from where / was pressed), ⏎ keeps it, esc goes back.
  startFind(cx) {
    this.finding = { origin: (this.code?.selected_range().start ?? 0) + 1, line: this.dataAt }; // as vim: after the cursor
    this.findInput.set_value("");
    this.findInput.focus();
    cx.notify();
  }

  findStep(dir, cx, typing = false) {
    const query = typing ? this.findInput.value() : this.lastFind;
    if (!query) return;
    const cur = this.code?.selected_range().start ?? 0;
    const from = typing ? this.finding.origin : dir > 0 ? cur + 1 : cur - 1;
    const at = this.findText(query, from, dir);
    if (at < 0) { if (typing) { this.dataAt = this.finding.line; this.editorLine(cx); } return this.say(`Not found: ${query}`, cx); }
    this.showMatch(at, query.length, cx);
  }

  endFind(keep, cx) {
    if (!this.finding) return;
    if (keep) this.lastFind = this.findInput.value() || this.lastFind;
    else { this.dataAt = this.finding.line; this.editorLine(cx); }
    this.finding = null;
    this.focusView();
    cx.notify();
  }

  // Vim's normal ⇄ insert mode on code: one editor, which holds the keyboard only in insert mode (normal mode's keys
  // are the viewer's). The line is kept both ways: the cursor starts on normal mode's line, and goes back to it.
  // The editor is made again (read-only ⇄ editable) with the cursor where it was; it keeps the keyboard either way.
  setEditing(on, cx) {
    if (!this.code) return;
    this.visual = null; this.syncCursor();
    this.editing = on;
    this.updateEditor(); this.placeCursor(cx, true);
    cx.notify();
  }

  // The keyboard to the file: its editor for code (normal mode), else the view.
  focusView() {
    const code = this.isCode();
    if (code && this.code) this.code.focus();
    else this.viewFocus.focus();
    if (code) this.refocus = true; // a file still loading: its editor takes it once there
  }
  inView() { return this.viewFocus.is_focused() || Boolean(this.codeFocused); }

  // A normal-mode key may arrive twice, as a bound action and as a key event; the second (same key, same moment) is
  // dropped.
  twice(k) {
    const now = Date.now(), last = this.lastKey;
    this.lastKey = { k, t: now };
    return Boolean(last && last.k === k && now - last.t < 15);
  }

  // The viewer's keys. Letters only when no editor shows, so typing in Source still types.
  keyDown(e, cx) {
    if (e.keystroke === "ctrl-[") e = { ...e, key: "escape", keystroke: "escape" }; // ⌃[ is Esc, as in vim
    if (this.helpKey(e, cx)) return;
    const k = e.keystroke, file = this.selected?.file, type = file ? kind(file) : null;
    if (this.isCode(type) && this.code && !this.finding) {
      if (this.twice(k)) return cx.stop_propagation();
      if (!this.editing) this.syncCursor();
    }
    const toTree = () => { cx.stop_propagation(); this.editing = false; this.visual = null; this.treeFocus.focus(); if (this.docked) this.showing = false; cx.notify(); };
    // The find bar has the keyboard: letters are the search's; esc goes back to where it started.
    if (this.finding) { if (k === "escape") { cx.stop_propagation(); this.endFind(false, cx); } return; }
    // Vim-like: esc leaves insert mode, then goes back to the tree.
    if (k === "escape" && this.editing) { cx.stop_propagation(); return this.setEditing(false, cx); }
    // Esc first drops a half-typed command (42, g, y, ⌃W) or visual mode, as vim does.
    if (k === "escape" && (this.visual != null || this.count || this.pendingKey)) {
      cx.stop_propagation(); this.count = ""; this.pendingKey = null;
      if (this.visual != null) { this.visual = null; this.editorLine(cx); }
      return cx.notify();
    }
    if (k === "escape") { cx.stop_propagation(); return this.docked && this.history.length ? this.back(cx) : toTree(); }
    if (k === "tab" || k === "shift-tab") return toTree();
    if (k === "cmd-s" || k === "ctrl-s") return super.keyDown(e, cx);
    // Code: normal mode's keys here; in insert mode (i) the editor has them, esc comes back.
    const code = this.isCode(type) && Boolean(this.code);
    if (code && !this.editing && k === "i") { cx.stop_propagation(); return this.setEditing(true, cx); }
    const editor = Boolean(this.code) && (this.source || !richText(type)) && type !== "image" && type !== "pdf" && !(code && !this.editing);
    if (editor || !file) return;
    if (k === "left" || k === "h") return toTree();
    if (this.vimKey(k, type, code, toTree, cx)) return;
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
      home: () => this.scrollView("top", cx), "shift-g": () => this.scrollView("end", cx), end: () => this.scrollView("end", cx),
    }[k];
    if (act) { cx.stop_propagation(); act(); }
  }

  // Vim's normal mode in the viewer: a count (42G, 5j), two-key commands (gg, yy, ⌃W h), and on code V (visual
  // lines), y Y (copy), / n N (find), ⌃F ⌃B (a page). True when the key was taken.
  vimKey(k, type, code, toTree, cx) {
    const take = () => { cx.stop_propagation(); return true; };
    if (/^[0-9]$/.test(k) && (k !== "0" || this.count)) { this.count = (this.count || "") + k; cx.notify(); return take(); }
    const count = this.count ? Number(this.count) : 0, prev = this.pendingKey;
    this.count = ""; this.pendingKey = null;
    if (prev === "g" && k === "g") { take(); if (code && count) this.gotoLine(count, cx); else this.scrollView("top", cx); return true; }
    if (prev === "y" && k === "y") { take(); if (code) this.copy(this.linesText(this.dataAt, this.dataAt + Math.max(1, count) - 1), "lines", cx); return true; }
    if (prev === "ctrl-w" && (k === "h" || k === "w" || k === "left")) { toTree(); return true; }
    if (prev === "ctrl-w" && this.resizeKey(k, cx)) return take();
    if (k === "g" || k === "ctrl-w" || (k === "y" && code && this.visual == null)) { this.pendingKey = k; this.count = count ? String(count) : ""; cx.notify(); return take(); }
    if (prev || count) cx.notify();
    if (k === "shift-g" && code) { take(); if (count) this.gotoLine(count, cx); else this.scrollView("end", cx); return true; }
    if ((k === "j" || k === "down") && code) { take(); this.moveLine(Math.max(1, count), cx); return true; }
    if ((k === "k" || k === "up") && code) { take(); this.moveLine(-Math.max(1, count), cx); return true; }
    if ((k === "ctrl-f" || k === "ctrl-b") && code) { take(); this.moveLine((k === "ctrl-f" ? 1 : -1) * this.pageLines(), cx); return true; }
    if (k === "shift-v" && code) { take(); this.visual = this.visual == null ? this.dataAt : null; this.editorLine(cx); cx.notify(); return true; }
    if (k === "y" && code && this.visual != null) {
      take(); const a = this.visual; this.visual = null;
      this.copy(this.linesText(Math.min(a, this.dataAt), Math.max(a, this.dataAt)), "lines", cx); this.editorLine(cx); return true;
    }
    if (k === "shift-y" && typeof this.text === "string" && type !== "image" && type !== "pdf") { take(); this.copy(this.text, "file", cx); return true; }
    if (k === "/" && code) { take(); this.startFind(cx); return true; }
    if ((k === "n" || k === "shift-n") && code) { take(); this.findStep(k === "n" ? 1 : -1, cx); return true; }
    return false;
  }

  // A row's name; filtering, the matched letters stand out and a folder that is only on the way to a match is dim.
  rowName(r, colors) {
    const base = div().flex_none().max_w(260).truncate().text_color(r.match && !r.hit ? colors.muted : colors.foreground).when(r.dir, (el) => el.font_medium());
    if (!r.hl?.length) return base.child(r.name);
    const runs = [];
    for (let i = 0; i < r.name.length; i++) {
      const on = r.hl.includes(i), last = runs[runs.length - 1];
      if (last && last.on === on) last.t += r.name[i]; else runs.push({ t: r.name[i], on });
    }
    return base.flex().children(runs.map((x) => div().flex_none().whitespace_nowrap()
      .when(x.on, (el) => el.text_color(colors.accent ?? colors.ansi3).font_bold()).child(x.t)));
  }

  treePane(colors) {
    const rows = this.rows();
    // Each letter typed into the filter puts the cursor on the best match again.
    const best = !this.filter.trim() ? null : this.typed() ? rows[0]?.path : this.matchCache?.tree?.best;
    if (this.toBest && best != null) { this.toBest = false; this.atPath = best; this.revealScroll = best; }
    const found = rows.findIndex((r) => r.path === this.atPath);
    if (found >= 0) this.at = found;
    else if (rows.length) { this.at = Math.min(this.at, rows.length - 1); this.atPath = rows[this.at].path; }
    // A jump (/ then ⏎, or the best match) scrolls to its row once the folders on the way have loaded.
    if (found >= 0 && this.revealScroll === this.atPath) { this.revealScroll = null; this.list.scroll_to_item(found, "center"); }
    const active = this.treeFocus.is_focused() || this.filtering;
    const marks = this.nav?.marks ?? {};
    const row = (r, i) => {
      const mark = marks[normalize(join(this.root, r.path))];
      return h_flex().h(ROW).pl(8 + r.depth * 16).pr(8).gap(6).items_center().rounded(6).text_size(TYPE.body)
        .when(i === this.at, (el) => el.bg(active ? colors.selected : colors.hover))
        .child(div().w(10).flex_none().text_color(colors.muted).child(r.dir ? (r.open ? "▾" : "▸") : ""))
        .child(this.rowName(r, colors))
        .child(div().flex_1())
        .when(Boolean(mark), (el) => el.child(div().flex_none().text_size(TYPE.label)
          .text_color(mark === "A" ? colors.ansi2 : mark === "D" || mark === "U" ? colors.ansi1 : colors.ansi3).child(mark)));
    };
    const hits = this.matchCache?.tree?.hits ?? 0;
    const tp = this.filter.trim() ? this.typed() : null, tl = tp && this.typedList?.dir === tp.dir ? this.typedList : null;
    const tilde = (d) => (d.startsWith(home() + "/") && !this.place.on ? "~" + d.slice(home().length) : d);
    const status = !this.nav ? "Loading…" : tp ? (tl?.error ? `${tl.error}: ${tilde(tp.dir)}` : !tl?.entries ? `Listing ${tilde(tp.dir)}…`
        : `${rows.length - (tp.partial ? 0 : 1)} in ${tilde(tp.dir)} · ⇥ completes · ⏎ opens`)
      : this.filter.trim()
      ? (this.git === false ? (this.liveBusy ? "Searching…" : `${hits}${hits === MATCHES || this.liveCapped ? "+" : ""} matches`)
        : this.files ? `${hits}${hits === MATCHES ? "+" : ""} matches` : "Listing files…")
      : this.nav.error || (this.nav.loading && !rows.length ? "Loading…" : !rows.length ? "No files" : null);
    return v_flex().id("fb-tree-pane").track_focus(this.treeFocus).min_h(0)
      .on_key_down((e, cx) => this.treeKey(e, cx))
      .on_mouse_down("left", () => { if (!this.filtering) this.treeFocus.focus(); })
      .child(h_flex().h(42).flex_none().px(12).gap(8).items_center().border_b(0.5).border_color(colors.border)
        .child(svg("mods/workspace-chrome/folder.svg").size(14).text_color(colors.muted))
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(this.root ? basename(this.root) : "Files")))
      .child(h_flex().h(32).flex_none().mx(8).my(6).px(8).gap(6).items_center().rounded(7).border_1()
        .border_color(this.filtering ? colors.accent ?? colors.border : colors.border)
        // A press anywhere in the box (the input, its padding, the /) types into it: the pane's own press below would
        // put the keyboard back on the tree. The input's own press (the cursor's place) comes first.
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); if (!this.filtering) this.input.focus(); cx.notify(); })
        .child(div().text_size(TYPE.meta).text_color(colors.dim).child("/"))
        .child(Input.new(this.input).flex_1().h_full().text_size(TYPE.body).text_color(colors.foreground)))
      .when(Boolean(status), (el) => el.child(div().px(14).py(4).text_size(TYPE.label).text_color(colors.dim).child(status)))
      .child(div().relative().flex_1().min_h(0).px(6)
        .child(v_virtual_list("fb-tree", rows.length, ROW, (i) => rows[i].path, (range) => rows.slice(range.start, range.end).map((r, o) => row(r, range.start + o)))
          .track_scroll(this.list).size_full()
          .on_item_click((path, cx) => {
            const i = rows.findIndex((r) => r.path === path), r = rows[i];
            if (!r) return;
            if (r.abs) { this.select(i, rows, cx, false); return this.openTyped(r, cx); }
            this.treeFocus.focus();
            if (r.dir) { this.select(i, rows, cx, false); this.nav.toggle(r.path, cx); }
            else if (this.docked) { this.select(i, rows, cx, false); this.openFile(r.path, cx); this.showFile(true, cx); }
            else this.select(i, rows, cx);
          }))
        .child(Scrollbar.vertical("fb-tree").absolute().right(0).top(0).bottom(0)))
      .when(this.docked, (el) => el.child(footerBar(h_flex(), colors).px(12).child(div().min_w(0).truncate().child(this.flash ? this.flash.text
        : this.count || this.pendingKey ? `${this.count || ""}${this.pendingKey === "ctrl-w" ? "⌃W" : this.pendingKey || ""}`
        : this.visual != null ? `-- VISUAL LINE -- ${Math.abs(this.dataAt - this.visual) + 1} lines · y copy · esc`
        : this.editing ? "-- INSERT -- · esc normal mode"
        : this.inView()
          ? (this.isCode() ? "i insert · / find · V lines · yy copy · ⌃W h tree · ? help" : "h ← ⇥ tree · J K files · [ ] headings · s source · ? help")
          : (this.filter ? `${this.filesCapped ? `first ${FILES.toLocaleString()} files only · ` : ""}↑↓ move · ⏎ open · ⇥ list · ⌫ clear · ? help`
            : `${this.treeCapped ? "first 5,000 rows only · " : ""}j k move · h l fold · ⏎ open · / filter · u up${this.docked ? "" : " · ⇥ viewer"} · ? help`)))));
  }

  findBar(colors) {
    return h_flex().id("fb-find").h(34).flex_none().px(10).gap(6).items_center().border_t(0.5).border_color(colors.border)
      .child(div().text_size(TYPE.body).text_color(colors.dim).child("/"))
      .child(Input.new(this.findInput).flex_1().h_full().text_size(TYPE.body).text_color(colors.foreground))
      .child(div().flex_none().text_size(TYPE.label).text_color(colors.dim).child("⏎ keep · esc back · then n N"));
  }

  helpPanel(colors) {
    const panel = this.docked ? "panel" : "window";
    const groups = [
      ["Tree", [...moveHelp("move (the file under the cursor previews)"),
        ["l →  ⏎", "open a folder, or go into the file"], ["h ←", "close the folder, or go to its parent"], ["J K", "next / previous file"],
        ["u", "the folder above as the tree (even above the repository)"], ["C", "this folder as the tree"], ["P", "back to the repository"],
        ["/  ⌫", "filter the whole tree (names containing what you type), clear it"], ["/~/…  //…", "a path (~ is home): ⇥ completes, ⏎ opens a folder as the tree or a file"], ["yy  Y", "copy the path (in the tree / full)"], ["I", "show / hide hidden files"],
        ["R  o", "reload / open in its app"], ["⇥  ⌃W l", "to the file"]]],
      ["File (normal mode)", [["j k  ↑ ↓", "a line (code), else scroll"], ["⌃D ⌃U  ⌃F ⌃B", "half / whole page"], ["gg G  42G", "top / end / line 42 (5j: five lines)"],
        ["i", "insert mode: edit in place (esc: back to normal mode)"], ["V  then y", "select lines, copy them"], ["yy  3yy  Y", "copy the line / three lines / the whole file"],
        ["/  n N", "find in the file, next / previous"], ["h ←  ⇥  ⌃W h", "back to the tree"], ["J K", "next / previous file"],
        ["[ ]  s  c", "Markdown: headings, source, contents"], ["s", "JSON, YAML: the tree (click to fold), or the code again"], ["⌫", "back after following a link"], ["⌘S", "save"], ["o", "open in its app"]]],
      ["Window", [HELP_ROW, ["esc", `insert → normal → tree (a filter stays: ⌫ clears it) → close the ${panel}`], ["q", `close the ${panel} (from the tree)`],
        ["⌃W <  ⌃W >  ⌃W =", "the tree narrower / wider / as it was (or drag its edge)"]]],
    ];
    return v_flex().id("fb-help").size_full().overflow_y_scrollbar().px(20).py(14).gap(14).text_size(TYPE.body)
      .children(groups.map(([title, rows]) => v_flex().gap(3)
        .child(div().pb(2).text_size(TYPE.meta).font_semibold().text_color(colors.accent ?? colors.foreground).child(title))
        .children(rows.map(([keys, what]) => h_flex().gap(12).child(div().w(170).flex_none().child(keys)).child(div().flex_1().min_w(0).text_color(colors.muted).child(what))))));
  }

  render(cx) {
    const { colors, font } = appearance();
    if (this.docked) this.followTerminal(cx);
    const viewer = super.render(cx);
    const view = () => div().id("fb-view").track_focus(this.viewFocus).on_key_down((e, cx) => this.keyDown(e, cx)).when(true, (el) => NORMAL_KEYS.reduce((el, k) => el.on_action(normalAction(k), (_a, cx) => this.keyDown({ keystroke: k }, cx)), el)).flex_1().min_w(0).h_full().flex().flex_col().child(this.help ? this.helpPanel(colors) : viewer).when(Boolean(this.finding) && !this.help, (el) => el.child(this.findBar(colors)));
    if (this.docked) return focusFrame(v_flex().id("file-browser").size_full().min_h(0).overflow_hidden().bg(colors.background), colors,
      this.treeFocus.is_focused() || this.inView() || this.filtering)
      .text_color(colors.foreground).font_family(font).text_size(TYPE.title)
      .child(this.showing || this.help ? view().w_full() : this.treePane(colors).flex_1().w_full());
    const zoom = settings().zoom || 1;
    return v_flex().id("file-browser").size_full().min_h(0).overflow_hidden().bg(colors.background)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()) // a window: presses select, they don't drag it
      // Dragging the tree's edge.
      .on_mouse_move((e, cx) => {
        this.windowW = e.bounds?.width ? e.bounds.width / zoom : this.windowW;
        if (this.resizing) this.setTreeWidth(this.resizing.w + (e.position.x - this.resizing.x) / zoom, cx, false);
      })
      .on_mouse_up("left", (_e, cx) => { if (this.resizing) { this.resizing = null; this.setTreeWidth(this.treeW, cx); } })
      .text_color(colors.foreground).font_family(font).text_size(TYPE.title)
      .child(h_flex().flex_1().min_h(0).min_w(0)
      .child(this.treePane(colors).w(this.treeW).flex_none().h_full())
      .child(div().id("fb-resize").w(5).h_full().flex_none().cursor_col_resize().border_l(0.5).border_color(colors.border)
        .when(Boolean(this.resizing), (el) => el.bg(colors.accent ?? colors.border))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.resizing = { x: e.position.x, w: this.treeW }; cx.notify(); }))
      .child(div().id("fb-view").track_focus(this.viewFocus).on_key_down((e, cx) => this.keyDown(e, cx)).when(true, (el) => NORMAL_KEYS.reduce((el, k) => el.on_action(normalAction(k), (_a, cx) => this.keyDown({ keystroke: k }, cx)), el)).flex_1().min_w(0).h_full().flex().flex_col().child(this.help ? this.helpPanel(colors) : viewer).when(Boolean(this.finding) && !this.help, (el) => el.child(this.findBar(colors)))))
      .child(this.statusBar(colors));
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
