// Another machine (`hc machine ls`) from a mod: its home folder and its login shell's PATH, asked once each, and
// a path from the settings with ~ as that machine's home. A command run there through herdr-core gets only the
// system's PATH (no Homebrew, no ~/.local/bin), so tools there run with this one. Null `on` is this computer.
import { exec, home } from "herdr";

// The home folder on machine `on` (this computer's for null); null when it can't be asked.
const homes = new Map();
export async function homeOn(on) {
  if (!on) return home();
  if (homes.has(on)) return homes.get(on);
  const r = await exec("/bin/sh", ["-c", 'printf %s "$HOME"'], { timeout: 10000, on }).catch(() => null);
  const h = r?.code === 0 && r.stdout.startsWith("/") ? r.stdout : null;
  if (h) homes.set(on, h);
  return h;
}

// The PATH of machine `on`'s login shell, interactive so its rc files count (zsh on a Mac, often bash on
// Linux); null for this computer, or when it can't be asked.
const paths = new Map();
export async function pathOf(on) {
  if (!on) return null;
  if (paths.has(on)) return paths.get(on);
  const r = await exec("/bin/sh", ["-c", 'exec "${SHELL:-/bin/sh}" -ilc \'printf "\\n%s" "$PATH"\''], { timeout: 15000, on }).catch(() => null);
  const p = r?.code === 0 ? r.stdout.split("\n").pop().trim() : "";
  const got = p.includes("/") ? p : null;
  if (got) paths.set(on, got);
  return got;
}

// A path from the settings on a machine whose home is `h`: ~ expanded, no trailing slash. null when not a
// non-empty string.
export const pathOn = (value, h) => (typeof value !== "string" || !value ? null : value.replace(/^~(?=\/|$)/, h).replace(/(.)\/+$/, "$1"));

// A machine named in the settings: the string, null (this computer) when unset or empty.
export const machineSetting = (value) => (typeof value === "string" && value ? value : null);

// The machine of the space with this id (null: this computer, or no such space).
export const machineOfSpace = (spaces, id) => spaces.find((s) => s.id === id)?.machine ?? null;
