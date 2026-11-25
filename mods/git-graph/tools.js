// Modified by Jochen Rau, 2026-11, from rabeeh-ta/herdr-git-graph: see NOTICE.md in this folder.
// Opening files in git's editor or the system's app, and running the diff tool (moved out of graph.js).
import { exec, readTextFile, notify, run, hc, window as appWindow } from "herdr";

// Runs fn over items, at most `limit` at a time (manygit's 8).
export async function pool(items, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) await fn(items[next++]); }));
}
// Local change: `o` and `d` hand files to the user's own tools, the same way on every platform.
export const platform = () => appWindow()?.platform;
// A command's result, also when it can't start.
export const attempt = (p) => p.catch((e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) }));
// readTextFile answers null for a missing file; one it can't read (binary, too big) exists.
export const exists = (path) => readTextFile(path).then((t) => t !== null, () => true);
// A program in the background through herdr-core: no time limit, so it can wait on the user
// (`code --wait`, `git difftool`), and it goes when the program ends.
// Herdr's runner starts it with a bare PATH, so Homebrew's and /usr/local's programs (VS Code's `code`, which
// `git difftool` runs) are added in front (not on Windows).
export const WITH_PATH = ["/bin/sh", "-c", 'PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH" exec "$@"', "sh"];
export const background = (cwd, argv, label) =>
  attempt(hc(["run", "--bg", "--rm", "--no-parent", "--cwd", cwd, "--label", `git-graph.${label}=1`, "--", ...(platform() === "windows" ? [] : WITH_PATH), ...argv]));

// Git's editor (`git var GIT_EDITOR`: GIT_EDITOR, core.editor, VISUAL, EDITOR) as words.
// Git runs it through a shell; here it's split at spaces, so a quoted path with spaces in it
// (`"C:/Program Files/…" -w`) needs the folder on PATH instead.
export async function gitEditor(git) {
  const v = await git(["var", "GIT_EDITOR"]);
  return v.code === 0 ? v.stdout.trim().split(/\s+/).filter(Boolean) : [];
}
export const TERMINAL_EDITOR = /^(n?vim?|vi|nano|emacs|hx|helix|micro|kak|joe|ne)$/;
// The system's app for a file type (explorer.exe answers 1 even when it opened the file).
export const OPENER = { macos: "open", windows: "explorer.exe", linux: "xdg-open" };

// In git's editor: a terminal one in a new tab, any other in the background; none set: the
// system's app for the file type.
export async function openInEditor(path, { root, git }) {
  const words = await gitEditor(git);
  if (!words.length) {
    const opener = OPENER[platform()] ?? OPENER.linux;
    const r = await attempt(exec(opener, [platform() === "windows" ? path.replace(/\//g, "\\") : path]));
    if (r.code !== 0 && platform() !== "windows") notify({ title: "Couldn't open the file", body: (r.stderr || opener).trim(), level: "error" });
    return;
  }
  const prog = words[0].split(/[\\/]/).pop().replace(/\.(exe|cmd|bat)$/i, "");
  if (TERMINAL_EDITOR.test(prog)) return run("tab.new", { folder: root, name: path.split("/").pop(), argv: [...words, path] });
  const r = await background(root, [...words, path], "editor");
  if (r.code !== 0) notify({ title: `Couldn't start ${words.join(" ")}`, body: r.stderr.trim(), level: "error" });
}
