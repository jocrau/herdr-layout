# worktree-support: origin and changes

**From:** natelandau/herdr-worktree-support @ 711e079 (https://github.com/natelandau/herdr-worktree-support), itself a clone of Herdr's built-in `spaces` mod 0.1.11.

**Licence:** MIT (Nate Landau) and Apache-2.0 (Herdr), in LICENSE (MIT), LICENSE-HERDR (Apache-2.0) in this folder.

**Changed by Jochen Rau, 2026-11:**

- The blocked/done badge on a space's avatar (from the author's my-spaces clone of `spaces`).
- A click on a worktree row with no space only goes to a tab of its repository's space already in it, else does nothing (upstream: opens a new space); opening one is the menu's.
- Runs the menu's git operations (pull, push, fetch, rebase, merge, create pull request) in the worktree and reports each as a toast; a push refused after a rebase asks before force-pushing (`--force-with-lease --force-if-includes`).
- A space whose terminals are in several repositories shows "N repos" instead of the first terminal's git.
- No uncommitted-changes dot and no worktree count; a fixed chevron slot keeps repositories and chevrons aligned.
