# Changelog

## 0.1.0 (unreleased)

First version: the `workbench` layout with `file-browser` (⌘O), `git-graph` (⌘G), `beads` (⌘B),
`fleet-board` (⌘⇧F), `new-space` (⌘N), `worktree-support`/`worktree-actions`, `space-agents`,
`tabs-graph`, `usage-status`, `preview-plus` and `sidebar-footer`, and one keymap across the
dialogs and the fleet pane.

- Side columns (the PR board, the fleet board, the side panel) open one at a time: opening one
  closes the other. Each closes the same three ways: the × at the right of its header, Esc once
  nothing in it is left to clear, and its key (⌘⇧R, ⌘⇧F, ⌘⇧O). Every board has the same 40 px
  header (title, facts, small buttons, ×), its own lines below it; the side panel's has Preview and
  Changes as tabs.
- Tab bar: + right after the last tab; icon links to the file browser, git graph and beads, and to
  the PR and fleet columns (highlighted while open); the wheel switches one tab per notch or short
  swipe, a sideways swipe scrolls the tabs; dragging a tab shows where it lands.
- `fleet-board`: click its title, or press `e`, for every run (each epic of each repository,
  finished ones too) in a dropdown: "Active", then "Finished this week". The run you pick stays
  until you pick another (⌘← ⌘→ step); focusing a terminal elsewhere no longer switches it.
- beads-view: a click selects a bead, a click on the selected one focuses it, a double-click shows
  or hides its details; the detail pane wraps to its width and scrolls row by row; the in-place
  editor shows status and priority in colour instead of escape codes.
- Git graph: removing a worktree from a right-click menu opens its dialog again; a branch that
  merged HEAD in no longer draws the line to HEAD dashed.
- `pr-board` (⌘⇧R): pr-flow's queue of pull requests beside your agents, grouped by your next move,
  each PR with what it is, who's in it and the next step; only the actions possible in its state.
  The PR view (⌘⌥R, `d`) is the git graph on the PR's range with the queue beside it and pr-flow's
  notes and findings on their lines; branches with a tracked PR show its stage. Agent actions go to
  the PR's own Claude tab. The file browser opens at a line (`props.line`).
- `pr-board` with a newer pr-flow: from 0.30.0 it takes each PR's facts from pr-flow's listing and
  reads it with `--no-save`, so its polls no longer move your last listing; from 0.31.0 a new PR
  tab starts from pr-flow's own prompt for the task instead of typed shorthand. Older pr-flow
  versions work as before. `later` hides a PR until the next working day's morning. Cards read
  title, next step, then one quiet line (repo · people · age · size). A queue read that never comes
  back no longer stops the pane reading.

- Safer destructive actions (from a code review): the git graph's file reset takes the name
  literally (`a[1].log` no longer also deletes `a1.log`); ⇧C keeps a partial staging; the main
  checkout is never offered for "Remove worktree". In the spaces list, Rebase and Merge refuse
  to start over a merge or rebase in progress or uncommitted changes (their undo can't throw your
  work away); Clean up counts unpushed commits by the branch's ref, says so when it can't, and
  stops if the branch moved since you were asked, deleting it only at the commit you saw.
- `fleet-board` fixes from the code review: a question in the confirm bar belongs to its run
  (switching runs closes it; it never acts on the run you switched to); commands run as separate
  words without a shell, and a gate command that isn't a plain `fleet …` is offered to copy only;
  one chip per run; a bead asking again is announced again, and a wait announced while hidden
  isn't announced twice; an answer draft belongs to its question; fields take the keyboard once
  drawn; folder watches no longer pile up; older snapshots without some fields still draw.
- More review fixes: Clean up closes only tabs wholly inside the worktree (a space only when all of
  its tabs are) and names each one in its dialog; confirm dialogs ignore ⏎ for their first 0.7 s,
  so a late force-push or clean-up question can't take a keypress meant for a terminal. beads-view
  keeps its list (and your focus) when `bd` fails or times out, and shows control characters in bead
  text as `�` in the editor instead of sending them to the terminal. The demo script stops only
  what it started (by process id, `fleet stop`, terminals inside its folder; never your core),
  removes only a folder it marked, and `up` returns at once.
- Lighter in the background: the fleet board redraws its clock every 10 s instead of every 2 s and
  works out each run's dependency graph and summary once per read; the spaces list re-reads only the
  worktrees on screen (an unfolded list, or a space working there) on turn ends, watches and its
  fallback, forgets folders no terminal is in, and cancels the watch of a repository it no longer
  shows; the git graph cancels the last repository's watches and watches at most 48 repositories
  in its overview (Herdr allows 64 pending watches a mod).
- Medium review fixes. Git graph: file names like `été.txt` work in the review, `o`, `d` and `v`; a
  `git add` in a terminal updates the staged and untracked marks; double-clicking a remote label whose
  branch is checked out in another worktree only goes there (an agent may work in it) and says when
  it's behind; fetch, pull and push never wait on a credential prompt and get five minutes. Spaces
  list: a fork's pull request no longer marks your branch of the same name; Push and Create pull
  request push a branch made from `origin/main` to its own name, never to main. New space: opening a
  worktree on another machine as a space opens in that worktree, not the machine's home.
  `claude-resume` skips a session already running elsewhere (and one lost in two terminals comes back
  once), checks again that a shell is in front before typing, and works in nu. beads-view runs its
  keys with `sh` whatever your shell; `--select` finds beads under a parent of any id and changes
  your view only when it finds the bead. The context meter shows whole percents.
- Git graph: Merge makes a merge commit by default (the dialog's tick can turn it off), and so does the
  spaces list's Merge. A commit's menu can reset another local branch to it, as in Fork ("Reset a branch
  to this commit…": pick the branch, confirm; only that branch moves, never one checked out somewhere).
- Low review fixes and clean-up: fast-forward all goes on past a failing branch and says which moved;
  the review's highlight stays on its file when the list reloads; remote names with a slash; pushes name
  full refs; the spaces list's requests queue up instead of dropping, clean-up re-checks for changes and
  re-lists by the repository's own key, and a logged-out or rate-limited gh says so once; beads-view works
  under a path with spaces, handles wide characters, and ⌘B no longer leaves a stray beads-view; the file
  browser opens at a terminal in a symlinked folder and says when its lists are cut; the status line
  writes its usage file less, can't hang on git, and keys its markers by session; long tooltips wrap.
  Removed: git-graph's update check and dead code in several mods.
- Structure: the fleet board's `main.js` (1,600 lines) and the git graph's `graph.js` (1,850) are split
  by topic into modules, the pure logic apart from the views; unit tests (`tests/unit`) cover that logic,
  beads-view, every mod's modules loading, and names used but never declared. No behaviour changed.
- Faster: the git graph reads a repository with five git calls instead of eight, a further page of
  history with one, and skips git's `--date-order` sort where git's own order already has every child
  before its parents (0.6 s → 0.04 s on a 78,000-commit repository; a repository with a wrong clock in
  its history keeps the exact sort). The spaces list asks GitHub for each pull request's one CI result
  instead of every check (4 s → 1.3 s a minute on a busy repository). The file browser's filter narrows
  from the last matches and keeps only the best 300; the fleet board's idle passes no longer look at the
  layout, and its first search reads four folders at once; beads-view's watcher lists its cache once.
- Shared code: `lib/` holds what several mods use (fuzzy matching, the settings file, the repository
  scan, branch names, worktree removal), copied into each by `node lib/sync.mjs`; the tests fail when a
  copy drifts. With it: the git graph's Remove worktree can delete an unmerged branch when you tick that
  its commits are lost, and the spaces list no longer force-deletes a branch it didn't look at; a branch
  with no words keeps its name as a space name; a code folder of `~` is searched two levels down,
  without Desktop, Documents and the like. `lib/README.md` also lists the shared keys mods talk through.
- Fleet board: Lanes show what each step does and whether an agent works in it (a full bar for
  implement, fix and review, a thin line for a check or the merge; blue, violet, grey, green). Tree
  is gone into Board: a row shows how many beads it unblocks (`⇣3`), and the critical path sits above
  the queued beads. `1 2` switch views. The Lanes time axis and busy row stay put while the lanes
  scroll. It needs agent-fleet 0.37 now, and its support for older versions is gone.
- `preview-plus` (linziyanleo, MIT) as the ⌘⇧O side panel's file view, with Escape going back.
- `sidebar-footer`: the sidebar's footer with Settings only; Add machine is in Settings >
  Machines.
- `fleet-board` (⌘⇧F; ⌘⌥F as a dialog): an agent-fleet epic beside your agents, read from
  `fleet status --json` (agent-fleet 0.37+) and re-read when the run's state changes. Board
  (beads by what needs you, a recap for a finished epic), Lanes (every step over time) and Tree
  (open beads by dependency, the critical path) draw the same one-line row and share one
  selection; `/` filters. A bead's details show where its time went, its life to scale and every
  step under its round with the result in words. Questions are answered in place; a stuck bead
  offers resume; commands that change the run, and starting or stopping a wave from the header,
  ask in a confirm bar first. `t` follows the bead's `fleet tail` at the bottom of the pane, `b`
  opens it in the beads view, **diff** in the git graph. Every run is a click on the title away (⌘← ⌘→
  step); a bead that starts waiting for you posts a notification, also
  while the pane is hidden. Keys as in the git graph and the beads view.
- `space-agents`: each Claude Code agent's row shows its context used (a short bar and the
  percent, yellow from 60 %, red from 80 %), from the `claude.context` terminal label that
  `extras/claude-statusline.py` sets when the whole percent changes; `--session-end` clears it.
  Contributed by Samuel Skinner.
- `space-agents`: right-click an agent row to pin it or mark it unread. A marked idle agent shows
  in Done until you go back to it after leaving it, or it starts working (`agents.unread`, shared).
  Contributed by Samuel Skinner.
- `worktree-actions`/`worktree-support`: a left click on a worktree in the spaces panel only
  goes to a space or tab already open there. Its right-click menu offers "Open as space",
  "Open as tab" and the git a worktree needs: pull, push, fetch, rebase onto or merge the main
  branch when behind, create or open its pull request, open it in the git graph, copy the
  branch name; a space's menu has pull, push and fetch. Each runs with a toast; rebase and
  merge undo themselves on a conflict. When a push is refused after a rebase, a dialog asks
  before force-pushing (with `--force-with-lease --force-if-includes`), saying how many remote
  commits it replaces.
- `new-space`: a new space (⌘N, the spaces list's +, a worktree's "Open as space") first asks
  for a name, used for the space, its first tab and `claude --remote-control <name>`, and a
  folder, picked by keyboard from the git repositories under the code folder (`code_dir` in
  `~/.config/herdr-app/data/workbench.json`, else `~/Code`): the one you're in first, then recent picks,
  with Home folder and Browse… rows. Names read as plain words: a worktree's branch
  `feat/csv-export` becomes "Csv Export". Derived from Herdr's prompt mod (Apache-2.0).
- `file-browser`: opens on a given file and commit (read-only, from `git show`) for other mods;
  `j k ⌃D ⌃U g G` scroll rendered JSON and CSV by row, Markdown by block; code is shown in
  Atom One Dark's syntax colors.
- `git-graph` review: `c` (or the Commit | Since base tabs) switches between the selected
  commit and everything since the branch left its base, as a PR shows it (on the uncommitted
  row up to the working tree, untracked files included). The base is origin/HEAD, then main,
  master, origin/main, origin/master, or the "Review base" setting. ⏎ or ⇥ on the reviewed
  commit and ← / h close the review; with it open, the key hint shows the review keys.
- `git-graph` review: `o` opens the file in git's editor, `d` shows the change in git difftool,
  `v` shows the file as it was at the commit in the file viewer. The line between files and
  diff drags (remembered; double-click resets); added and removed lines have a stronger tint,
  a colored gutter and colored line numbers; full branch, remote and tag names are listed, and
  long branch labels in the graph lose their middle rather than their end.
- `git-graph` review: `r` on a file of the uncommitted changes resets just that file, after a
  dialog: unstage it (when staged) or discard its change; a new or untracked file is deleted.
- `git-graph` worktrees: a branch checked out in another worktree has a folder icon (also in the
  `b` picker). Double-clicking it, ⇧⏎ or ⌃O in `b`, or "Open its worktree here" (first in its
  menu) opens that worktree as a tab in the space the graph was opened in (or shows the one it
  has there), instead of failing with "already used by worktree".
  Its remote label fast-forwards it inside that worktree. ⇧F (Fast-forward N) leaves such
  branches alone, and their menu drops Checkout and Delete. A linked worktree's header names
  the repository and the worktree. Git's common refusals start with a plain sentence saying
  what to do.
- `git-graph` branches and worktrees: checking out a branch (double-click, menu, ⇧⏎ in `b`)
  asks Here or New worktree; a new worktree goes in `.worktrees/<branch>` of the main
  checkout (kept out of git status) and opens in a tab. ⇧B makes a new branch at the cursor:
  just made, here, or in a new worktree. The `b` picker shows ahead/behind and open pull
  requests, and gets keys: ⌃O worktree, ⌃D delete branch, ⌃X remove worktree, ⌃T worktrees
  only. "Remove worktree…" refuses uncommitted changes unless ticked and can delete the
  merged branch too.
- `git-graph` dialogs work from the keyboard alone: ⏎ confirms (also in dialogs without a
  text field, where it did nothing), ↑↓ and ⇥ ⇧⇥ move between the fields, the options (picked
  as the cursor lands) and the ticks, space ticks. When a menu or dialog closes, confirmed or
  not, the graph takes the keyboard back where it was (review, file, cursor).
- `git-graph`: "Remove worktree" uses the repository's `herdr.worktreeRemove` command when it
  sets one (as the spaces list does). With "Delete the branch too" it keeps a branch git won't
  delete and says why, instead of failing after the worktree was already gone. A branch
  checked out in another worktree says "(in its worktree)" on its Fast-forward item. New
  worktrees open as a tab named in words ("Csv Export"), as spaces are.
- `worktree-support`/`worktree-actions`: "Go to tab" shows the tab in its own space; Clean up
  closes only the space or tab its dialog named, and a branch the remove command already
  deleted isn't reported as a failure. "Open as tab" names the tab in words.
- `worktree-support`: a space is never nested under another space; one working in a worktree
  is its own row, with the repository and branch beside its name. Every space of a
  repository lists the worktrees no space is in, folded until you unfold that space's list
  (remembered per space). Its menu offers both "Open as tab in <this space>" and "Go to tab
  in <space>", so a worktree can be open in several spaces.
- `worktree-support`/`worktree-actions`: a finished worktree (PR merged or closed, remote
  branch gone) is dimmed in the spaces list with the reason. "Clean up…" in its menu says
  what would be lost (uncommitted changes, commits on no remote), then removes the worktree,
  deletes the branch and closes its space or tab.
- `git-graph`: ⇧R (or the repository's name in the header) switches to another repository:
  the code folder's, recent ones first, filtered as typed, Browse… for any folder.
- `git-graph`: double-clicking a remote branch checks out its local branch and fast-forwards
  it to the remote when it only lacks the remote's commits (diverged: a toast says so).
- `extras/claude-resume`: after a reboot (Herdr gives every terminal a fresh shell), brings
  back the Claude sessions the terminals had, each from its own folder, after listing them.
  The status line labels each Herdr terminal with its session (`claude.session`,
  `claude.folder`); its `--session-end` hook drops the label when you quit Claude.
- `extras/claude-statusline.py`: a Claude Code status line that saves the subscription usage
  the status bar shows; the README's "Status bar usage" says how to set it up.
- `beads`: the `/` filter needs every typed word to appear, in any order, instead of matching
  scattered letters; `'word` is fuzzy, `!word` excludes, `^word` and `word$` anchor.
- `beads`: `f` shows only beads with chosen labels and priorities (e.g. `owner:bob` and `P1`):
  labels of one namespace (`owner:alice`, `owner:bob`) and the priorities are alternatives,
  everything else must all match; globs (`owner:*`) and `!label` can be typed. Parents of
  matching beads stay, dimmed, so the tree keeps its shape. In this picker and Ctrl-L's label
  picker Enter or Space ticks, Esc applies, Ctrl-C cancels; `F` clears the filter, which is
  remembered per repo.
- `beads`: an edit (or any change bd reports) no longer leaves other levels of the tree stale:
  going up out of a focused bead, or switching between open and all beads, showed the old
  title until the next change. Every cached view is dropped when the beads change, and the
  watcher reloads a view a key brought up from an outdated cache.
