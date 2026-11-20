# usage-status: origin and changes

**From:** Herdr's built-in `workspace-status` mod, version 0.1.13 (the status bar).

**Licence:** Apache-2.0, in LICENSE-HERDR in this folder.

**Changed by Jochen Rau, 2026-11:**

- Renamed to `usage-status`.
- Adds a Claude subscription usage widget (pace, projection, reset, data age), read from `~/.local/state/claude-usage.json` when that file exists; hidden otherwise.
- Shows only what the window doesn't show elsewhere: the machine only when the space runs on another one, the
  focused terminal's repository and branch with what's to push or pull and the branch's PR (from pr-flow's queue),
  and how many agents need you (when any do); no agent count, no command-palette hint.
- Keeps the recent panes' order for the option+tab switcher (`lib/recent.js`, `recent-panes`).
- "N need you" is a link: each click goes to the next agent that waits for you; its tooltip names them.
