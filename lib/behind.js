// Keys for the window behind a dialog. Herdr's keys.json lets a `mod:<name>` section win over `global` while that
// mod has the keyboard, so the keys that act on the window (tabs, spaces, agents, panes) are bound there to
// "<mod>.behind.<command>[.<value>]": open as a dialog, the mod keeps them (they'd switch a tab behind it); docked as
// a pane, it runs the command as the global key would. Pure apart from `run`, for tests.

// "behind.tab.select.3" → { name: "tab.select", args: { index: 3 } }; anything else → null.
export function behindCommand(c) {
  const m = /^behind\.([a-z_]+\.[a-z_]+)(?:\.([a-z0-9_]+))?$/.exec(String(c ?? ""));
  if (!m) return null;
  const [, name, value] = m;
  if (value === undefined) return { name, args: {} };
  if (/^\d+$/.test(value)) return { name, args: { index: Number(value) } };
  return { name, args: { direction: value } };
}

// A command from nextCommand(): true when it was one of these (kept in a dialog, run when docked).
export function passBehind(c, inDialog, run) {
  const b = behindCommand(c);
  if (!b) return false;
  if (!inDialog) run(b.name, b.args);
  return true;
}

// What the keys.json sections bind (the window's own keys: tabs, spaces, agents, panes), as chord → command.
export const BEHIND_KEYS = {
  "cmd-left": "tab.prev", "cmd-right": "tab.next", "cmd-up": "space.prev", "cmd-down": "space.next",
  "cmd-shift-up": "agent.prev", "cmd-shift-down": "agent.next", "cmd-[": "agent.prev", "cmd-]": "agent.next",
  "cmd-shift-[": "tab.prev", "cmd-shift-]": "tab.next", "cmd-alt-[": "space.prev", "cmd-alt-]": "space.next",
  "ctrl-tab": "tab.next", "ctrl-shift-tab": "tab.prev",
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => [[`cmd-${n}`, `tab.select.${n}`], [`ctrl-${n}`, `space.select.${n}`]])),
  "cmd-t": "tab.new", "cmd-w": "tab.close", "cmd-alt-w": "tab.close", "cmd-d": "pane.split.right", "cmd-shift-d": "pane.split.down",
  ...Object.fromEntries(["left", "right", "up", "down"].flatMap((d) => [[`cmd-alt-${d}`, `pane.go.${d}`], [`cmd-alt-shift-${d}`, `pane.swap.${d}`]])),
};
