# worktree-actions: origin and changes

**From:** natelandau/herdr-worktree-support @ 711e079 (https://github.com/natelandau/herdr-worktree-support).

**Licence:** MIT (Nate Landau), in LICENSE in this folder.

**Changed by Jochen Rau, 2026-11:**

- A worktree's menu offers both "Open as space" and "Open as tab" (or "Go to" either when already open).
- Git operations: pull, push and fetch (also on a space's menu); rebase onto or merge the main checkout's branch when behind; create or open its pull request; open it in `git-graph`; copy the branch name.
- A confirm dialog of its own (props `confirm`) that `worktree-support` opens before a force push.
