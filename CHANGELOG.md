# Changelog

## 0.1.0 (unreleased)

First version: the `workbench` layout with `file-browser` (⌘O), `git-graph` (⌘G), `beads` (⌘B),
`fleet-board` (⌘⇧F), `new-space` (⌘N), `worktree-support`/`worktree-actions`, `space-agents`,
`tabs-graph`, `usage-status` and `sidebar-footer`, and one keymap across the
dialogs and the fleet pane.

- The file browser (⌘⇧O) is a window you drive like vim and NERDTree. Source shows in vim's normal mode: the line
  you're on is highlighted, `j k` `⌃D ⌃U` `⌃F ⌃B` `gg G` and counts (`42G`, `5j`) move, `/` finds in the file
  (as you type, smart case) with `n N`, `V` selects lines and `y` copies them, `yy` `3yy` copy lines, `Y` the whole
  file; `i` edits in place and Esc steps back: insert, normal, the tree, the filter, closing the window (`q` too).
  Each file opens on the line you left it at. The tree gains `gg G`, `u` (the folder above, even above the
  repository), `C` (this folder as the tree), `P` (back), `yy Y` (copy the path), `I` (hidden files), `R`, and `l`
  goes into a file. `/` matches names as typed (each term inside one file or folder name; a `/` spans folders),
  finds folders too, and shows the matches as a tree with the matched letters lit; ⏎ on a folder opens the tree
  down to it. A path typed after `/` (`~/Code/x/`, `/tmp/y`, `../z`; `~` is home) lists that folder's names as
  you type: ⇥ completes it as a shell does (a folder gets its `/`), ⏎ opens a folder as the tree or a file in it. The tree's edge drags (`⌃W < > =`), and a status bar across the window shows the mode, the keys that
  matter there, the line and column, the branch.
- The file browser opens JSON and YAML as code (highlighted, vim's normal mode, `i` to edit); `s` (or the Tree
  button) shows their foldable tree instead, and `s` again the code. YAML is read with js-yaml 4.1.0 (MIT, bundled;
  several documents show as a list).
- The file browser shows the file you pick again (its tree loader had replaced the viewer's load), Markdown links
  and `[ ]` follow again in it, and a docked browser that moves to another repository while git is still answering
  no longer gets the old repository's tree or file names.
- Markdown view: picking the heading you're already under, after scrolling, goes back to it.
- Git view: on the base branch itself the review shows the commit (since base stays the choice on other branches),
  and an open review follows a checkout onto or off it.

- The fix round's plan in the PR view (pr-flow 0.45.0, its ENGINE.md "Fix plans"): when a fix session on your own PR shows
  its plan, the notes show it too (FIX PLAN: each item's severity, verdict, place, point, reply or proof; the go
  line) and the items with a code place sit on their lines in the diff, on the reading path (`n N`). ⏎ on an item
  opens its verdicts (`f w a u s`), a text box takes anything else, and ⌘⏎ or Go types `go` (no second question; a
  plan from an older head says `Go anyway: head moved` on the button): all typed into the PR's session as you'd
  type them there, the changed plan replacing the one shown. A finding the plan takes up is said once, by the
  plan: it leaves FINDINGS and the diff's finding marks, and the plan's marks carry the item's id and verdict. The PR board's card says
  "Fix plan ready" as your move (not "agents at work"), with `fix plan ↗` (d); space opens it.
- `preview-plus` is gone: the file browser, which replaced it in the side panel, is the one viewer, so a fix lands
  once. Its Mermaid bundle is the newer build with the elkjs and entities licence notices kept in it.
- Keys mean the same across the boards: on the fleet board each bead action has a fixed letter, shown on its
  button and the PR board's where they match: `a` approve, `f` resume (another fix round), `i` drop, `p` answer,
  `t` its session tab, `v` its gate, `d` its diff, `o` its PR, `b` the beads view. The tail moves from `t` to `w` (as
  on the PR board) and folding Done from `d` to `0`. In the beads view space shows or hides the details, as ⏎ and ⇥
  (folding stays on `l` `h` and the digits). Digits change what is shown, never act on an item: levels in the beads
  view, Board/Lanes and Done on the fleet board.
- Header and footer rows line up across the window: every header is 42 px (the brand row, the tab bar, the side
  panel's and every board's header) and every footer 28 px with 12 px text (Settings, the status bar, the fleet
  board's, the PR board's and the file browser's footer), from one place (`lib/bars.js`).
- Keys: ⌘⇧ and a letter opens what you'd expect for it (the file browser and beads as dialogs, the PR and fleet
  boards as panes), ⌘⌥ and that letter the other form (the side panel, the PR view, the fleet dialog). The file
  browser dialog moves from ⌘O to ⌘⇧O, the side panel from ⌘⇧O to ⌘⌥O, beads from ⌘B to ⌘⇧B, and ⌘B hides or
  shows the sidebar.
- The side panel (⌘⌥O) shows the file browser in place of Preview Plus: one column, the tree or the file it
  shows (⏎ or a click opens it, esc or ← goes back to the tree, esc again closes the panel), following the
  focused terminal to another repository. Its tab is "Files".
- `fleet-board`: a second click on the wave pill takes its question back (stop this wave? / start the next?), as
  Esc does; the pill shows pressed while its question is open.
- `pr-board`: findings made before the last push (pr-flow 0.41's `old_findings`) show dim with the head they were
  made at ("2 findings at 2f684b0"; "Review found 1 high at 2f684b0, head moved"), instead of disappearing; a
  re-review says which still hold. A blocker finding is red and listed first, as a high one.
- `zen` (⌘.): hides the window's chrome (the tab bar, the status bar and the sidebar) and brings it back as it was (the
  sidebar only if it was open). The panes, dialogs and the side columns on the right (the PR and fleet boards, with
  their own headers) stay; Herdr's toast still says when an agent needs you. Best in fullscreen: in a window, macOS's
  buttons sit over the first pane's corner.
- `usage-status`: the focused terminal's repository and branch, ↑ commits to push and ↓ commits behind its upstream
  (or "not pushed", "upstream gone"), and the branch's PR when pr-flow tracks it, with its stage (a click opens the PR
  view).
- `usage-status`: "N need you" is a link: each click goes to the next agent that waits for you; its tooltip names them.
- `recent-panes` (option+tab): the panes you used last, across spaces, as Firefox's ctrl+tab does it. It opens on the
  pane before the one you're in; tab goes further back, shift+tab forward, letting go of option goes there (space and
  tab with it), esc stays. Each row: the space's avatar, the agent's tab name (or a shell's title, else its program and
  folder), where it is, and the agent's state. The status bar keeps the order (`lib/recent.js`). ctrl+tab stays the next tab.
- `pr-board` from the keyboard, in the file browser's and the beads view's scheme: ⌘⇧R takes the keyboard to the first
  PR; j k move over PRs and section headings; → goes in (opens a section, to its first PR, a PR's details, then its
  actions, ← → between them, ⏎ runs one), ← back out the same steps. Each action has its own key on every PR, shown
  on its button (a approve, m merge, v review, p post, y copy, b hand back, n ping, u nudge, f fix, e ready, q
  request, z later, i ignore, X close, D discard); space is the main action; outward ones still ask first. The links
  show their keys (d PR view, t agent tab, o GitHub, w log, c stop). The key list (?) wraps and is grouped.
- `pr-board`: Later and Dormant rows say whose PR it is (not the section's name again), and Later when it comes back
  ("in 10d"); in a folded section, a click on a PR's number opens the section with that PR's details.
- `pr-board`: a card says each thing once. Its second line is its one status: an action of yours in flight
  (Approving…, instead of a note in the footer), else its agent's running or failed job, else the next step. The
  details keep a quiet one-line record of the last job (started 3m ago, output, stop; or last review 8m ago, log),
  so the card keeps its height as a job starts and ends; pr-flow's reasons and GitHub's verdict show only when the
  card doesn't say them already ("approved, CI green" once, not three times), and Re-review no longer says "again".
- `pr-board`: section headings stand out from the cards (Samuel Skinner, PR #3): each group (Your move, Waiting on
  others, …) is in the foreground colour with a rule under it and its count in the accent colour, and Your move's
  action headings (Fix, Review, Merge, …) are a step bolder, in the board's own type sizes.
- `pr-board`: one type scale, three sizes: a card's title 13 px; what to do next, a waiting PR's title, the action
  headings and the details 12.5 px; PR numbers, context lines, who and since, section headings and buttons 12 px
  (were 10–11.5 px). A board header's facts are 12 px, as the footers.
- beads-view: Delete (⌫, or ⌦) closes the selected bead after a y/n asked in the footer; bd's refusal shows
  there. With the filter showing, both keys edit it, and ⌫ on an empty filter still goes up out of a focus.
  In navigate mode ⌫ no longer goes up; ← does.
- beads-view: s syncs the beads with their Dolt remote (`bd sync`: pull, conflict check, push), saying so in the
  footer, then reloads the tree; a conflict or a push race shows there until a key is pressed.
- `fleet-board`: the Epic card says "N wait for your triage" only for the follow-ups `fleet triage` lists (open,
  unassigned; agent-fleet 0.39's `untriaged`); the decided ones show as a quiet "M open follow-ups (decided;
  listed in the PR to main)", and an older agent-fleet gets "N open follow-ups" without a triage claim. The
  status comes from `fleet status --json` (read from the tracker on every read, every minute while the pane
  shows), so a triage or close shows without a wave; the last wave's epic.status event is the fallback.
- `pr-board`: cards stay put when you act. A PR whose agent you started (a review, a self-check) stays in Your
  move where it was, its second line saying what the agent does, instead of moving to Waiting on others. The
  order holds while you work in the pane (the pointer over it, a key or click just now, a question or menu
  open): a card that's handed over fades in place and says where it goes ("→ Waiting on alice", "→ Later"),
  then moves when the pointer leaves and is highlighted in its new place; new PRs wait ("+1 new" in the
  header). An action's question opens under its card, and "review #42…" sits in the footer, so nothing above
  the list moves.
- `pr-board`: every step of reviewing a colleague's PR (review it, post your comments, finish your review) is
  one Review block; in each block PRs keep one order, by repository and number. Waiting on others lists the
  shortest wait first, the longest at the bottom, next to Dormant.
- `pr-board`: **Hand back** is a button on a colleague's PR (no longer under ⋯); with pr-flow 0.35+ the PR then
  waits on its author until they push or CI turns green. A colleague's failing CI or conflicts are said, not
  red: red is for review loops and your own PRs.
- `pr-board`: a card closes after an action that needs no follow-up (hand back, later, ignore, approve, post,
  copy, discard, close).
- `pr-board`, PR view: the PR's tab is its agent tab (**Agent tab ↗**, **Reword in its tab ↗**), not named after
  one tool.

- `pr-board`, `fleet-board`: the tail panel scrolls smoothly (a wrapped line scrolls through as the lines it
  takes): a turn up stops following the newest line, "↓ newest" in its header starts it again; sideways (a
  sideways swipe or shift-wheel) with the labels staying put. An ended job whose log read found nothing (a
  timeout while busy) is read again.
- `pr-board`: calmer details again: no NEXT/OPEN labels; pr-flow's summary sits with the PR's own facts as
  "Changes: …"; later/ignore/hand back fold under ⋯ when there are several; the row counts findings ("6
  findings", the kinds in its tooltip) and the PR view link no longer repeats them; **draft ↗** shows whenever
  pr-flow drafted comments, not only after a job.
- `pr-board`: an open PR's branch → base (and GitHub's verdict, open threads, conflicts) sits under its context
  line, with the PR's own info, instead of at the end of the details.
- `pr-board`: **log ↗** / **output ↗** and `w` open a pr-flow job's log in a tail panel at the bottom of the pane,
  the fleet board's own (now shared in lib/tailpanel.js), instead of a terminal: the agent's words, one line per
  command or file read, failures and denials in red, and the result ("done · 4m 35s · $2.15"), read from the job's
  transcript and followed every 3 s while it runs. `-` `=` and its top edge set its height (remembered on its
  own), esc or ✕ closes it, **terminal** still shows pr-flow's `job show` in a terminal. The fleet board's tail
  looks and works as before.
- `git-graph` PR view: its notes no longer start with a lone stage word ("draft", already in the bar) or
  pr-flow's "job-… working since" line, as on pr-board's card.
- PR view: its bar says what the PR's card on the board says, from one pr-flow read (`view <pr> --json`, pr-flow
  0.32+) instead of the queue's copy: the same stage, next step and actions in pr-flow's labels, alternatives that
  can't run now left out, "Self-check again" after a done self-check, a running job as a self-check on your own
  PR. Opening a PR reads pr-flow twice instead of three times (view and show; the findings come with show); the
  bar follows the board within seconds of an action or a queue read. With an older pr-flow, as before.
- `pr-board`: a running pr-flow job no longer reads as "its agent stopped and waits for you" when the PR's Claude
  tab is idle from before; a review of your own PR is called a self-check on the board and in the PR view; an
  agent's commands read as what they're for ("reading GitHub", "reading the code"); job ids in pr-flow's texts
  read as "a job", and its "job-… working since" reason is left out (the NEXT line says it).
- `pr-board`: a PR's details say each thing once, in two zones: NEXT (what the last job found, "Self-check found
  2 low findings · 32m ago", then one row of buttons with later/ignore on the right) and OPEN (the PR view with
  its findings, the Claude tab, GitHub, the branch). One-word reasons that repeat the section ("draft") are gone;
  the row's findings read "2 low".
- `pr-board`: a PR's open findings are on its row ("2 findings · low", red for high, amber for medium), and a
  finished review or self-check says what it found with a **findings ↗** link to the PR view; a review of your
  own PR is called a self-check there too.
- `pr-board`: a PR's details are calmer: its pr-flow job is one line that keeps its height (the current phase,
  not a growing list of them; runtime, model and id in its tooltip), with output/log and stop as quiet links
  beside it; actions that can't run now are left out instead of dimmed; diff, tab and GitHub moved to a quiet
  line of links with later, ignore and hand back.
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
- PR view: the queue moved from a list on the left to a dropdown under the PR's name (`p`, type to
  filter; `⇧L` brings the list back); the notes are as tall as they need; findings are cards (severity,
  place, the whole title, opened: the fix and its code); "Where to spend your time" shows the code
  at each place, read at the PR's head with the PR's changed lines tinted; the finding reached shows
  whole in the diff. `n` `N` go through the findings and the places to look at as one path, in the
  files' order ("stop 3 of 7"); `m` marks a file viewed ("7/18 viewed") until a push changes it. Open
  GitHub review threads show as cards, under their lines and as stops; deleted, lockfile and generated
  files fold into one row; a straight PR's graph folds to one line (`z`). One dialog for both: `p` in
  the git graph turns it into the PR view and esc steps back; a tracked PR's notes show in the plain
  graph when its head is reviewed since base.
- PR view: review threads resolve and unresolve from their cards (or `⇧R`); a note on a line of the
  diff is read there, its card stays short (code and full text only for places outside the diff).
- PR view: the right side shows the file as it will be once merged (changed lines tinted, removed
  lines marked, notes under their lines, the note's line range highlighted); `s` switches to the diff.
- Git graph review: `w` ignores whitespace in the diff; long lines scroll sideways with the line numbers in place, or wrap (`⇧W`); a hunk's header stays at the top while its lines scroll; `s` shows the whole file at the commit instead of the diff. A note on a line range heads it; the range reached is marked beside the line numbers.
- PR view: your draft review (pr-flow 0.33.0's stored drafts): the summary in the notes and each
  comment on its line, marked Draft, as stops of `n N`; a chip per version (`⇧V`); Post… and
  Approve with it… ask first, then send the version shown unchanged (`⌘⏎`); Copy puts it on the
  clipboard (`y`); Shorter, Softer and More reword it in the background and show the new version;
  Reword in Claude opens the PR's tab; Discard… asks. The pane says "✎ draft v3 ready", and its post
  and copy open the PR view on the draft. Without pr-flow's `draft` capability nothing changes.
- pr-board on pr-flow's view model (pr-flow 0.32): groups, next steps and actions come from pr-flow
  (its labels, its confirm questions; an action that can't run now is dimmed and says why), the board's
  own rules only for an older pr-flow. A pr-flow job shows on its PR's row; job verbs start a job when
  pr-flow can run one, else go to the PR's Claude tab as before. The PR's details show its job: what
  it's doing, followed live while open, and why it failed; **output ↗** (`w`) shows pr-flow's output in
  a terminal below (live while it runs), **stop** (`c`) stops it.
- `pr-board` with a newer pr-flow: from 0.30.0 it takes each PR's facts from pr-flow's listing and
  reads it with `--no-save`, so its polls no longer move your last listing; from 0.31.0 a new PR
  tab starts from pr-flow's own prompt for the task instead of typed shorthand. Older pr-flow
  versions work as before. `later` hides a PR until the next working day's morning. Cards read
  title, next step, then one quiet line (repo · people · age · size). A queue read that never comes
  back no longer stops the pane reading.
- `pr-board`: **tab ↗** is in every PR's details (and `t` works on every PR): it brings the PR's Claude tab
  forward, or opens one first just to talk about the PR: the agent reads it, says what it does and waits for
  your questions, taking no action unless asked. Later actions go to the same tab.
- `fleet-board`: Lanes open on the last hour instead of the whole run (`[` still fits the run); the
  zoom is remembered between sessions.
- `fleet-board`: the tail panel is resizable: drag its top edge (`-` `=` three lines at a time,
  double-click back to 14 lines); the height is remembered. One splitter (`lib/splitter.js`) now
  draws every resize handle in the boards (the tail, git-graph's review and PR splits and its
  column edges): a 6 px band, a 1 px line in the accent colour while it drags, the band tinted on
  hover, a double-click back to the default. Column edges now tint on hover like the splits.
- `fleet-board`: once a run's beads are closed, an Epic card shows the epic check on the epic branch,
  the epic's beads done, the follow-ups waiting for triage and the PR to main (or `propose`); a wave
  doing only the epic check says `epic check` instead of looking stalled.
- `fleet-board`: a bead waiting on GitHub says underneath what for (agent-fleet 0.38's `waiting_on`:
  checks running by name, auto-merge on, its turn behind another PR, the epic branch red on GitHub).

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
