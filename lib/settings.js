// The layout's settings: <appHome>/data/workbench.json, e.g. {"code_dir": "~/Projects", "fleet": "~/bin/fleet"}.
// Read on each use (a small file), so an edit applies without reloading the layout.
import { readTextFile, appHome, home } from "herdr";

// The settings as an object; {} when the file is missing or unreadable. `file`: another file in data/.
export async function readSettings(file = "workbench.json") {
  try {
    const conf = JSON.parse((await readTextFile(`${appHome()}/data/${file}`)) ?? "{}");
    return conf && typeof conf === "object" && !Array.isArray(conf) ? conf : {};
  } catch { return {}; }
}

// A path from the settings: ~ expanded, no trailing slash. null when not a non-empty string.
export function settingPath(value) {
  if (typeof value !== "string" || !value) return null;
  return value.replace(/^~(?=\/|$)/, home()).replace(/(.)\/+$/, "$1");
}

// The code folder repository lists search: code_dir, else ~/Code.
export async function codeDir() {
  return settingPath((await readSettings()).code_dir) ?? `${home()}/Code`;
}
