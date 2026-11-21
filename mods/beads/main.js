import { View, div } from "gpui-kit";
import { focused, terminals, spaces, panes, hc, exec, home, appHome, openOverlay, closeOverlay, props, shared, setShared, notify } from "herdr";

// cmd+shift+b (`mod.open:beads`): toggle beads-view for the focused terminal's repo
// as a dialog over the tab, with the keyboard on it.
// This mod is only a launcher: it starts beads-view, shows it and closes itself.
// Esc / q in beads-view ends the program, which closes the dialog too.
// beads-view ships in this folder (mods/beads/beads-view).
// Opened with props {select: "<bead id>", folder: "<repo>"} (the fleet board's "in beads"), it starts on that
// bead with its details open, replacing a beads view that is already open instead of closing it.
// In a space on another machine (`hc machine`), the view runs there, on that machine's beads: beads-view is copied
// to it once per version (~/.cache/herdr-layout/beads-view-<hash>), as it only needs python3, bd and fzf there.
const VIEW = "/mods/beads/beads-view";
const KEY = "beads.open"; // { overlay, terminal } while a beads view is open

// Nearest folder with a .beads directory, from cwd up (none: "").
const FIND_ROOT = 'd=$1; while [ "$d" != / ] && [ ! -d "$d/.beads" ]; do d=$(dirname "$d"); done; [ -d "$d/.beads" ] && printf %s "$d"';

// Where to look: props {folder, machine} (the fleet board), else the focused terminal and its space's machine
// (as the git graph does; a terminal shown without a pane, `vps/t7`, names its machine).
function location() {
  const p = props() ?? {};
  if (p.folder) return { cwd: p.folder, on: p.machine ?? null };
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((x) => x.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder || (on ? null : home()), on };
}

// A short hash of beads-view's text (FNV-1a), naming the copy on another machine.
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const CHUNK = 60000; // an argument stays under Linux's 128 KiB limit for one argument
// beads-view on machine `on`: its path there, copied when that version isn't there yet (older copies removed).
async function remoteView(on) {
  const text = (await exec("cat", [appHome() + VIEW])).stdout;
  const name = `beads-view-${hash(text)}`;
  const where = await exec("/bin/sh", ["-c", 'd="$HOME/.cache/herdr-layout"; [ -x "$d/$1" ] && printf "ok\t%s/%s" "$d" "$1" || printf "need\t%s/%s" "$d" "$1"', "sh", name], { on });
  const [state, path] = where.stdout.split("\t");
  if (state === "ok") return path;
  const tmp = `${path}.part`;
  for (let i = 0; i < text.length; i += CHUNK) {
    const r = await exec("/bin/sh", ["-c", 'mkdir -p "$(dirname "$1")" && if [ "$3" = 0 ]; then printf %s "$2" > "$1"; else printf %s "$2" >> "$1"; fi', "sh", tmp, text.slice(i, i + CHUNK), String(i)], { on });
    if (r.code !== 0) throw new Error(`couldn't copy beads-view to ${on}: ${r.stderr.trim()}`);
  }
  const r = await exec("/bin/sh", ["-c", 'chmod +x "$1" && mv "$1" "$2" && for f in "$(dirname "$2")"/beads-view-*; do [ "$f" = "$2" ] || rm -f "$f"; done', "sh", tmp, path], { on });
  if (r.code !== 0) throw new Error(`couldn't copy beads-view to ${on}: ${r.stderr.trim()}`);
  return path;
}

async function isLive(address) {
  try {
    const r = await hc(["get", address, "--json"]);
    return r.code === 0 && JSON.parse(r.stdout).state === "live";
  } catch { return false; }
}

// Show it in a dialog over the tab. The app only sees a terminal started
// with `hc run` a moment later, so wait for it first. Closing this launcher
// popup hands the keyboard back to what was under it, so close it first and
// open the dialog in the same tick, which leaves the keyboard on beads-view
// (closing ends this copy's tasks at their next await, not before).
async function showWhenSeen(cx, terminal) {
  for (let i = 0; i < 120; i++) { // up to 6 s: a first start in a fresh repository reads every bead
    if (terminals().some((t) => t.address === terminal)) {
      closeOverlay(props().overlay);
      const overlay = openOverlay({
        kind: "dialog", width: 0.92, height: 0.9,
        layout: { type: "block", content: { terminal } },
      });
      setShared(KEY, { overlay, terminal });
      return;
    }
    await cx.sleep(50);
  }
  // Not seen: end it, so it doesn't run on unseen and the next ⌘⇧B doesn't spend a press closing it.
  await hc(["kill", terminal]).catch(() => {});
  if (shared(KEY)?.terminal === terminal) setShared(KEY, null);
  notify({ title: "Beads", body: `beads-view (${terminal}) didn't show up: try ⌘⇧B again.`, level: "error" });
}

async function toggle() {
  const select = props()?.select;
  const open = shared(KEY);
  if (open && await isLive(open.terminal)) {
    // A view whose dialog never opened (the launcher was cut short) has no overlay to close.
    if (open.overlay) closeOverlay(open.overlay);
    await hc(["kill", open.terminal]);
    setShared(KEY, null);
    if (!select) return; // a bead to show: open a fresh view on it
  }
  setShared(KEY, null);

  const { cwd, on } = location();
  const root = cwd ? (await exec("/bin/sh", ["-c", FIND_ROOT, "sh", cwd], { on })).stdout.trim() : "";
  if (!root) {
    const at = on ? ` on ${on}` : "";
    notify({ title: "No beads here", body: cwd ? `No .beads folder in ${cwd} or above${at}.` : `No folder to look in${at}.`, level: "info", timeout: 4000 });
    return;
  }
  const view = on ? await remoteView(on) : appHome() + VIEW;
  const r = await hc(["run", "--bg", "--json", ...(on ? ["--on", on] : []), "--cwd", root, "--label", "beads.view=1", "--", view, ...(select ? ["--select", select] : [])]);
  if (r.code !== 0) {
    notify({ title: "beads-view didn't start", body: r.stderr.trim(), level: "error" });
    return;
  }
  const terminal = JSON.parse(r.stdout).address;
  setShared(KEY, { terminal });
  return terminal;
}

export default class Beads extends View {
  init(_props, cx) {
    cx.spawn(async (cx) => {
      let terminal;
      try { terminal = await toggle(); }
      catch (e) { notify({ title: "Beads", body: String(e), level: "error" }); }
      if (terminal) await showWhenSeen(cx, terminal);
      closeOverlay(props().overlay); // no-op if showWhenSeen closed it
    });
  }
  render() { return div(); }
}
