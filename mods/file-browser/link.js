// ⌘-click (Ctrl-click elsewhere) on a file path in a terminal opens it in the file browser: the file shown with
// its repository as the tree, at the line the path names (`src/x.rs:42`, `src/x.rs:42:7`, `src/x.rs(42)`).
// A folder opens as the tree. Files the viewer can't show (archives, binaries) and paths that aren't there go on
// to Herdr's own opener ("pass"). Declared in mod.json's link_handlers, turned on by the layout's link_handlers.

import { exec, openOverlay } from "herdr";
import { normalize, absolute, basename, dirname, extension } from "./paths.js";

// What the viewer has nothing for: left to the system's opener.
const OPAQUE = new Set(["zip", "gz", "tgz", "bz2", "xz", "zst", "7z", "rar", "tar", "dmg", "pkg", "app", "exe", "dll", "so",
  "dylib", "a", "o", "class", "jar", "wasm", "bin", "iso", "img", "sqlite", "db", "mp3", "mp4", "mov", "m4a", "wav", "avi",
  "mkv", "webm", "flac", "ogg", "ttf", "otf", "woff", "woff2", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "key", "numbers", "pages"]);

// The line a clicked path names: its `:42` / `:42:7` / `(42)` / `(42,7)` suffix, else none.
export function lineOf(raw) {
  const m = /(?::(\d+)(?::\d+)?|\((\d+)(?:,\s*\d+)?\))\W*$/.exec(String(raw ?? ""));
  return m ? Number(m[1] ?? m[2]) : null;
}

// The clicked path without its line suffix: what Herdr didn't resolve (a remote terminal's), read from raw.
export function pathOf(raw) {
  let s = String(raw ?? "").trim().replace(/^file:\/\/[^/]*/, "");
  s = s.replace(/(?::\d+(?::\d+)?|\(\d+(?:,\s*\d+)?\))\W*$/, "");
  try { s = decodeURIComponent(s); } catch {}
  return s;
}

export async function handleLink({ link, source }) {
  if (link.kind !== "file") return "pass";
  const on = source.machine || null;
  // A remote terminal's path Herdr leaves unresolved: taken from the text, against the terminal's folder.
  let path = link.path;
  if (!path) {
    if (!on) return "pass";
    const raw = pathOf(link.raw);
    if (!raw || raw.startsWith("~")) return "pass";
    path = absolute(raw) ? raw : source.cwd ? `${source.cwd}/${raw}` : null;
    if (!path) return "pass";
  }
  path = normalize(path);
  const probe = await exec("sh", ["-c", 'if [ -d "$1" ]; then echo d; elif [ -f "$1" ]; then echo f; fi', "sh", path], { on, timeout: 5000 })
    .catch(() => null);
  const type = probe?.code === 0 ? probe.stdout.trim() : "";
  if (!type) return "pass";
  if (type === "f" && OPAQUE.has(extension(path))) return "pass";
  const folder = type === "d" ? path : dirname(path);
  const props = { folder, on };
  if (type === "f") {
    // The file browser takes the path inside the repository (git's view: symlinked folders resolved), else the
    // name in its folder.
    const prefix = await exec("git", ["rev-parse", "--show-prefix"], { cwd: folder, on, timeout: 5000 }).catch(() => null);
    props.path = (prefix?.code === 0 ? prefix.stdout.trim() : "") + basename(path);
    const line = lineOf(link.raw);
    if (line > 0) props.line = line;
  }
  openOverlay({ mod: "file-browser", kind: "window", width: 0.92, height: 0.9, props });
  return "handled";
}
