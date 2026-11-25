#!/usr/bin/env node
// Herdr loads each mod from its own folder, and a mod can't import from another's: the code several mods
// share lives here, in lib/, and this script copies it into each mod that uses it, as mods/<mod>/lib/<file>.
// Edit lib/, then run `node lib/sync.mjs`. `--check` changes nothing and fails when a copy differs or is
// missing (the unit tests run it), so a copy edited in place, or a lib/ edit not yet copied, shows up.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Which mods use which file.
export const USES = {
  "fuzzy.js": ["file-browser", "git-graph", "new-space"],
  "names.js": ["git-graph", "worktree-actions", "worktree-support"],
  "machine.js": ["fleet-board", "git-graph", "pr-board", "usage-status", "worktree-support"],
  "settings.js": ["fleet-board", "git-graph", "new-space", "pr-board", "usage-status", "worktree-support"],
  "repos.js": ["git-graph", "new-space"],
  "worktree.js": ["git-graph", "worktree-actions", "worktree-support"],
  "prflow.js": ["git-graph", "pr-board", "usage-status", "worktree-support"],
  "prrows.js": ["git-graph", "pr-board"],
  "tiptext.js": ["fleet-board", "git-graph", "pr-board"],
  "prmodel.js": ["git-graph", "pr-board"],
  "bars.js": ["file-browser", "fleet-board", "pr-board", "side-header", "sidebar-footer", "usage-status"],
  "boardheader.js": ["fleet-board", "pr-board", "side-header"],
  "splitter.js": ["fleet-board", "git-graph", "pr-board"],
  "tailpanel.js": ["fleet-board", "pr-board"],
  "recent.js": ["recent-panes", "usage-status"],
  "zen.js": ["zen"],
  "gitline.js": ["usage-status"],
  "type.js": ["file-browser", "fleet-board", "git-graph", "new-space", "pr-board", "recent-panes", "side-header", "space-agents", "tabs-graph", "worktree-actions", "worktree-support"],
  "menu.js": ["git-graph", "worktree-actions"],
  "keymap.js": ["file-browser", "fleet-board", "git-graph", "pr-board"],
  "testkeys.js": ["file-browser", "fleet-board", "git-graph", "pr-board"],
  "behind.js": ["file-browser", "fleet-board", "git-graph", "pr-board"],
  "sidecolumn.js": ["file-browser", "fleet-board", "pr-board", "side-header", "summon-fleet", "summon-prs", "tabs-graph"],
};

const HERDR_FILES = new Set(["gpui-kit.d.ts", "jsconfig.json"]);

const header = (file) => `// Copied from lib/${file} by lib/sync.mjs: edit it there, then run \`node lib/sync.mjs\`.\n`;

// Every copy there should be: [path, contents].
export function expected() {
  const out = [];
  for (const [file, mods] of Object.entries(USES)) {
    const text = header(file) + readFileSync(join(ROOT, "lib", file), "utf8");
    for (const mod of mods) out.push([join(ROOT, "mods", mod, "lib", file), text]);
  }
  return out;
}

// Copies no longer wanted (a file a mod stopped using).
function strays() {
  const want = new Set(expected().map(([p]) => p)), out = [];
  for (const mod of readdirSync(join(ROOT, "mods"))) {
    const dir = join(ROOT, "mods", mod, "lib");
    // Herdr writes its typings next to code it checks (gpui-kit.d.ts, jsconfig.json; git ignores them).
    if (existsSync(dir)) for (const f of readdirSync(dir)) if (!want.has(join(dir, f)) && !HERDR_FILES.has(f)) out.push(join(dir, f));
  }
  return out;
}

export function problems() {
  const out = [];
  for (const [path, text] of expected()) {
    if (!existsSync(path)) out.push(`missing: ${path.slice(ROOT.length + 1)}`);
    else if (readFileSync(path, "utf8") !== text) out.push(`differs from lib/: ${path.slice(ROOT.length + 1)}`);
  }
  for (const p of strays()) out.push(`not in lib/sync.mjs: ${p.slice(ROOT.length + 1)}`);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const p = problems();
    if (p.length) { console.error(`${p.join("\n")}\nRun: node lib/sync.mjs`); process.exit(1); }
  } else {
    for (const [path, text] of expected()) {
      mkdirSync(dirname(path), { recursive: true });
      if (!existsSync(path) || readFileSync(path, "utf8") !== text) { writeFileSync(path, text); console.log(`wrote ${path.slice(ROOT.length + 1)}`); }
    }
    for (const p of strays()) { rmSync(p); console.log(`removed ${p.slice(ROOT.length + 1)}`); }
  }
}
