# herdr-layout

A keyboard-first [Herdr](https://herdr.dev) desktop layout for working with coding agents
across many git repositories: a file browser, a git graph you can fetch, fast-forward and push
from, a beads issue tree, a spaces list that shows each repository's worktrees, and a board for
agent-fleet runs.

![The layout](preview.png)

## What you get

| Key | Opens | What it does |
|---|---|---|
| ⌘⇧O | **File browser** (window; ⌘⌥O docks it in the side panel) | The focused terminal's repository as a tree on the left (NERDTree keys: `u` goes up a folder, even above the repository, `C` makes a folder the tree, `P` goes back), the file under the cursor rendered on the right: Markdown with Mermaid diagrams, JSON and YAML as code (`s` shows their tree), CSV tables, images, PDF, and source in vim's normal mode (`j k`, `gg G 42G`, `/` with `n N`, `V` and `yy` to copy lines) with `i` to edit in place and Esc to step back. `/` in the tree filters the whole repository by name, as a reduced tree with the matched letters lit; a path typed there instead (`~/Code/x/`, `/tmp`, `../y`) lists its folder, Tab completes it as a shell does, and Enter opens a folder as the tree or a file in it. Drag the tree's edge (or `⌃W < >`) to resize; the status bar says the mode, the keys that matter there and where you are. `?` lists every key. |
| ⌘⇧G | **Git graph** (dialog) | The history of every branch. Fetch, fast-forward every branch that is only behind its upstream, push, commit. Checking out a branch asks: here, or in a new worktree (`.worktrees/<branch>`, opened as a tab in this space); `⇧B` starts a new branch the same way. A branch checked out in another worktree shows a folder icon, and double-clicking it opens that worktree as a tab in the space you opened the graph from. Merging makes a merge commit by default (untick it to fast-forward). Right-click a commit to reset the current branch to it (soft, mixed or hard) or, as in Fork, to move another branch there ("Reset a branch to this commit…": it asks which, and only that branch moves). A commit's PR chip opens the pull request on GitHub; in its details the hash, origin's branches and `#123` in the message are links, and right-click a commit or branch for "Open … on GitHub". `/` searches commits, `b` (or a click on the branch at the top) picks a branch (with ahead/behind and its pull request; `⌃O` worktree, `⌃D` delete, `⌃X` remove its worktree); right-click the branch at the top, or the status bar's, to pull, push or fetch, `⇧R` switches to another repository (or click its name), ⏎ reviews a commit as changed files beside their diff (`c` switches to everything since the base branch, as a PR shows it; ← goes back out, ⏎ or ⇥ again closes it), `v` views a file as it was at that commit in the file browser, `o` edits it in the file browser, `d` shows the change in your diff tool, and on the uncommitted changes `r` resets a file (unstage it or discard its change, after asking). |
| ⌘⇧B | **Beads** (dialog) | The [beads](https://github.com/steveyegge/beads) issues of the focused repository as a foldable tree, with details, editing and labels. |
| ⌘N | **New space** (dialog) | Asks for a name and a folder: type to filter the git repositories under your code folder (`~/Code`, or `code_dir` in the [settings](#settings)), with the one you're in first, then recent ones; or Home, or Browse… for any folder. Opens a space there with that name, its first tab named the same, and Claude Code running there as the Remote Control session of that name (`claude --remote-control <name>`). All from the keyboard: Enter right after the name opens it in the repository you're in; Tab moves to the folder, ↑↓ pick, Enter opens. The + in the spaces list and a worktree's "Open as space" ask the same way. |
| ⌘⌥O | Side panel | The file browser in one column (the tree, or the file you open: ⏎ or a click opens it, Escape goes back), following the focused terminal's repository, and Herdr's Changes panel. |
| ⌘⇧R | **PR board** (pane on the right; pressed again: the keyboard into it; pressed in it: hidden; ⌘⌥R opens the PR view) | Your [pr-flow](#pr-board) queue of pull requests, grouped by your next move: what each PR is, who's in it, and the next step; the PR view reviews one in the git graph with its findings. See [PR board](#pr-board). |
| ⌘⇧F | **Fleet board** (pane on the right; pressed again: the keyboard into it; pressed in it: hidden; ⌘⌥F as a large dialog) | An [agent-fleet](#fleet-board) run beside your agents: what needs you first, where every bead is, where its time went, and the gate's answer or resume right there. See [Fleet board](#fleet-board). |
| ⌘B | Sidebar | Hides or shows the spaces and agents on the left. |
| ⌥Tab | **Recent panes** (popup) | The panes you used last, across spaces, as a browser's ctrl+tab: it opens on the one before this; Tab goes further back, ⇧Tab forward, letting go of ⌥ goes there (its space and tab with it). Each row shows the space, the agent's tab name (or a shell's program and folder), where it is and the agent's state. ⌃Tab stays the next tab. |
| ⌘. | **Zen mode** | Hides the tab bar, the status bar and the sidebar, and brings them back as they were. The panes, dialogs and the boards on the right (with their own headers) stay; Herdr's toast still says when an agent needs you. Best in fullscreen: in a window, macOS's buttons sit over the first pane's corner. |

⌘⇧ and a letter opens what you would expect for it: the file browser and beads as dialogs, the PR and fleet boards as panes beside the terminals. ⌘⌥ and the same letter opens the other form: the file browser docked in the side panel, the PR view, the fleet board as a large dialog.

![The git graph](docs/git-graph.png)

In the sidebar, every space of a repository lists the repository's git worktrees under it
(folded until you unfold them), with ahead/behind counts, last activity and the branch's pull
request. Clicking a worktree goes to where it is already open (its own space, or a tab in it);
double-clicking opens it as a tab in that space, or shows the tab it has there. A worktree can
be open as a tab in several spaces. Right-click it for its menu, which starts with that tab:

- **Open** it as a tab in this space (first; "Go to" once it has one), go to a tab another
  space has, open it as a space, show its changes, or open it in your editor.
- **Git:** pull, push (setting the upstream the first time) and fetch; rebase onto or merge the
  main checkout's branch when the worktree is behind it; create or open its pull request; open
  it in the git graph; copy the branch name. Each runs in the background and reports as a toast.
  A rebase or merge that hits a conflict is undone rather than left half way. When the remote
  refuses a push after a rebase, you're asked before it force-pushes, and the force push still
  stops rather than overwrite commits someone else pushed that your branch doesn't have.
- **Folder:** copy its path, reveal it in Finder, close its space, or remove the worktree
  (Herdr's own removal when it has a space, or your command after asking if the repository sets
  `git config herdr.worktreeRemove '<cmd>'`, with `{path}` and `{branch}` filled in).

A worktree whose pull request was merged or closed, or whose remote branch is gone, is dimmed
and says so. Its menu starts with **Clean up…**, which shows what would be lost, then removes
the worktree, deletes the branch and closes its space or tab.

A repository space's own menu has pull, push and fetch as well.

⌘-click a file path in a terminal (`src/x.rs:42`, or a folder) to open it in the file browser at that line;
archives and binaries still open the usual way.

The agents list shows each agent with its space's avatar, and a pane you named under that name; the Dock icon
counts the agents that need you. Right-click an agent to pin it to the top or
mark it unread: an idle agent marked unread waits in Done until you go back to it. The status bar can show your Claude
subscription usage (see below).

The dialogs and both boards use the same keys, for vim and arrow users alike: `j k` or `↑ ↓` move,
`l →` go in, `h ←` come out (⏎ ⇥ toggle), `/` searches, `?` lists every key, Esc steps back and
finally closes. In the boards `space` runs the selected item's main action; ⌘← ⌘→ switch fleet runs.
⌘⌥← in a side column (the boards, the side panel's files) hands the keyboard back to the terminal beside it;
a board that has the keyboard shows the same blue line as a focused pane.

The tab bar keeps every tab's width as you switch tabs: each has its close button (dim until the
pointer is on it), and an agent's tab keeps room for its status.

## Fleet board

<img src="docs/fleet-board.png" alt="The fleet board" width="400" align="right">

For repositories that run [beads](https://github.com/steveyegge/beads) epics with
agent-fleet, the coordinator that hands beads to Claude Code agents in waves (implement,
check, review, fix, merge) and stops at gates when it needs a person. agent-fleet isn't public
yet; without it the board stays hidden and does nothing. The board shows one
epic, read from `fleet status --json`: the run you pick from the run list behind its title (or
⌘← ⌘→), kept until you pick another. Focusing a terminal elsewhere doesn't switch it.
It reads again when the run's state changes on disk, so it is live without polling.

**The header** says which epic, whether a wave runs (the wave pill: wave 7 · 2h45), progress
(merged of all, dropped ones counted as closed) and cost. Below that: the agents at work
(implement, fix and review take one; checks and merges don't), beads merged per hour, an ETA,
how often a review passes first time, and, once agent-fleet reports gate history, how often and
how long the fleet waited for you.

**Two views of the same beads**, each bead drawn as the same one-line row (state, id, title,
what its section doesn't already say, fix rounds `↻2`, a small bar of its phases, time,
cost), sharing one selection:

- **Board** groups beads by what needs you: needs you, running, interrupted, waiting on
  GitHub, queued, blocked, done. A bead others wait for shows how many it unblocks (`⇣3`), a blocked
  one what it waits for, and when beads wait on each other the critical path (the longest chain,
  which bounds when the epic can finish) sits above the queued ones, its ids in the accent colour. A
  finished epic opens with a recap: totals, agent time, the costliest, longest and most-fixed beads.
  Once every bead of the run is closed, an Epic card says what the epic itself is at: the epic
  check on the epic branch (running, passed, or failed with its log), how many of the epic's beads
  are done, the follow-ups agents filed that wait for your triage (with agent-fleet 0.39 or newer: the
  open, unassigned ones `fleet triage` lists; the decided ones show as a quiet count, listed in the PR
  to main), and the PR to main or `propose`. The status is the tracker's as of the last read (every
  minute while the pane shows), so a triage or close shows without waiting for a wave.
  While a wave does nothing but the epic check, its pill says `epic check · 3m`.
- **Lanes** draws every bead's steps over time: a full bar where an agent works (blue implement
  and fix, violet review), a thin line for a check (grey) or the merge (green), red only where
  something was sent back or the fleet waited for you, with the agents at work and wave boundaries
  underneath. It opens on the last hour; `]` zooms out to 7 days, `[` in to the whole run fitted to
  the width, and the zoom is remembered.

**A bead's details** (⏎ or click; one row is open at a time, and the details follow `j k`):

- where its time went: start to merge, agent time, check time, time queued between steps
  (waiting for a worker, the next wave or you), fix rounds, cost, lines changed;
- its life to scale, each step in its phase's shade, the waits as a hairline;
- every step under its round (BUILD, FIX ROUND 1, …) with when it started, how long it took
  and what came of it in words: `stopped: time limit`, `asked for changes`, `re-check` (checked
  again after a rebase onto a newer epic branch);
- the times it waited for you and how each ended, and its actions: **diff** opens the git graph
  on what the bead changes, **beads** opens it in the beads view, **tail** follows its log.

**Acting on a run.** A bead that asks you something shows its questions with the agent's
options as choices, its proposal preselected, and a field for your own words; **Send answer**
runs `fleet answer`. A bead stuck without a question (a step failed) offers **resume**, with an
optional note for the agent. Commands that change the run (resume, approve, drop) ask first in
a bar under the tabs that shows the command: ⏎ runs it, **Copy** copies it instead, Esc
cancels; the result arrives as a notification. The wave pill stops the running wave
(`fleet stop`) or starts the next one (`fleet run <epic>` in a terminal below), after the same
question.

**The tail.** `t` shows the open bead's `fleet tail` at the bottom of the pane and follows it
while it runs. Lines stay on one line; hover shows a line whole, a click wraps it, **wrap**
wraps them all. (agent-fleet itself shortens long lines unless it has `fleet tail --full`,
which the board uses when it's there.) Drag its top edge to make it taller or shorter, or press
`-` / `=` for three lines at a time; a double-click on the edge puts it back to 14 lines. The
height is remembered. Every resize handle in the boards (the tail, git-graph's review and PR
splits and its columns) looks and works the same way.

**Runs.** Click the board's title (the epic), or press `e`, for every run, each epic of each repository:
"Active" (a wave running, beads waiting for you, or unfinished with activity in the last two
weeks), then "Finished this week". A row has a dot while its wave runs, a red count of beads
waiting for you and the last activity. Click one or ⏎ to show it (esc or a click outside closes the list), or step
through them with ⌘← ⌘→; it stays until you pick another.

**Notifications.** A bead that starts waiting for you posts a notification, also while the
pane is hidden (it then looks every 2 minutes); clicking it shows the pane.

| Keys | |
|---|---|
| `j k` `↑ ↓` `⌃N ⌃P` | move; `⌃D ⌃U` page, `g G` ends |
| `⏎ ⇥` | open or close the bead's details; `l →` open, `h ← x` close |
| `space` | the bead's first action (answer, resume, tail) |
| `a` `f` `i` | approve, resume (another fix round), drop: the same key on every bead, shown on its button, as on the PR board; they ask first |
| `p` | answer: the bead's answer field |
| `t` `v` `d` `o` | its agent session tab, its gate, its diff in the git graph, its PR on GitHub |
| `/` | filter by id or title; `⌫` clears |
| `w` `b` `0` | tail, beads view, fold the done beads (digits change what's shown) |
| `-` `=` | the tail three lines shorter or taller |
| `[ ]` | zoom the lanes |
| `r` | read again |
| ⌘← ⌘→ | previous or next run |
| `?` | every key |

**Setting it up.** It needs agent-fleet 0.37 or later (`fleet status --json`, `fleet runs --json`
and `fleet tail --full`). The pane is hidden until ⌘⇧F. Another `fleet` than the one on your PATH
(a checkout's `scripts/fleet`, say) goes in the [settings](#settings) as `fleet`. To pin a layout block to one repository instead of following the
focused terminal, give it props `{"repo": "/path/to/repo"}`.

## PR board

For pull requests managed with pr-flow, a Claude Code plugin that keeps one queue of the PRs you
review and the PRs you wrote, and does the review, fix and merge work through agents. pr-flow isn't
public yet; without it the pane says so and the rest of the layout works as before.

**The pane (⌘⇧R)** is grouped by your next move. **Your move** lists the PRs waiting on you, by
what to do (decide, fix, review, answer feedback, merge, get ready; review covers every step of a
review, posting your comments too), in one order by repository and number, each in
three lines: what it is (number, title, repository), who's in it (author → reviewers, ✓ approved,
✗ changes requested, dimmer: not reviewed yet, and when it was last pushed) and the next step in one
sentence. A PR whose agent tab stopped to ask (a "go?", a permission) is your move too, first:
answer its agent (space brings the tab forward). A PR whose agent you started stays in Your move,
where it was, while the agent works. **Waiting on others** is one line per PR: on whom, since when,
the shortest wait first. Later and dormant PRs are folded, one line each when open: whose PR it is,
and when a later one comes back ("in 10d") or how long a dormant one has been idle; a click on a
number in a folded section opens it on that PR. Red means a real problem of yours: a
review loop, failing CI or conflicts on your own PR (on a colleague's they're said, not red). ⏎ opens
a PR's details and the actions possible in its state, as pr-flow lists them: the next step first,
its alternatives (hand back on a colleague's PR), housekeeping as quiet words (later · ignore), then
the PR view, its agent tab and GitHub; an action that needs no follow-up closes them. A card says
each thing once: its second line is its status (an action of yours in flight, its agent's job
running or failed, else the next step), and the details keep a one-line record of the last job. The cards hold still while you work in the pane: one that's handed over says
where it goes ("→ Waiting on alice") and moves when the pointer leaves.

**The PR view** (`d`, ⌘⌥R) is the git graph as a dialog on the PR's range in your local clone (its
branch fetched when needed). The PR's name in its bar (or `p`) opens the queue under it to switch
PRs (type to filter; ⌘↑ ⌘↓ step without it; `⇧L` shows it as a list on the left). Above the changed
files, pr-flow's notes: why it's in the queue, the findings as cards (a click opens one, with its fix
and code, and goes to its line), where to spend your time with the code at each place, what it
changes, and the open review threads. `n` `N` step through all of them in the files' order; `m` marks a
file viewed until a later push changes it. Deleted, lockfile and generated files fold into one row, a
straight PR's graph into one line (`z`); `w` ignores whitespace; long lines scroll sideways under fixed line numbers (or wrap, `⇧W`) and hunk headers stay at the top. Esc steps back
to the plain graph of the repository.
Findings are marked in the file list and shown under their line in the diff. `c` switches between
the whole PR and only what changed since your last review. In every graph, a branch with a tracked
PR carries its stage, and `p` turns the dialog into its PR view; reviewing its head since base shows
the PR's notes in the plain graph too. A PR badge in the sidebar opens the PR view.
When pr-flow has drafted your review (pr-flow 0.33.0), the notes start with it: its summary, and
each comment on its line in the diff, marked Draft. Post it (asks first, `⌘⏎`), approve with it,
copy it (`y`), have it reworded shorter, softer or with more detail (a new version, `⇧V` switches),
reword it in your own words in the PR's agent tab, or discard it, all without leaving the view.

**Acting.** Actions that need a model (review, fix, post, ready, merge…) go to the PR's own Claude
tab, named after it (`api#506`) in the space set as `pr_space` (default "PR Reviews"): a new tab
starts Claude Code in your clone, an existing one gets the command typed in, so each PR keeps one
conversation. The others run through pr-flow directly; approve and hand back ask first.

**A job's log.** A review or self-check pr-flow runs in the background shows on the PR's row and in
its details; **log ↗** (**output ↗** while it runs, or `w`) opens the same tail as the fleet board's
at the bottom of the pane: what the agent said, each command and file it read, what failed or was
denied in red, and how it ended ("done · 4m 35s · $2.15"), followed every few seconds while it runs.
**terminal** there shows pr-flow's own `job show` in a terminal below. Its height is remembered on
its own.

⌘⇧R shows the pane with the keyboard on the first PR; with the pane shown and the keyboard elsewhere, it brings the keyboard back; pressed in the pane, it hides it. Every action has its own key, the same on every PR and
shown on its button, so they become habit:

| Key | |
|---|---|
| `j k` | move over the PRs and the sections' headings |
| `l →` | in: open a section, go to its first PR, open its details, then step into its actions (← → between them, ⏎ runs one) |
| `h ←` | out, the same steps back |
| ⏎ ⇥ | a PR's details open or closed; a section folded or not |
| `space` | the PR's main action, whichever it is (its agent tab when the agent waits for you) |
| `a` `m` `v` | approve, merge, review (a self-check on your own PR) |
| `p` `y` | post, copy your drafted comments |
| `b` `n` `u` | hand back, ping, nudge |
| `f` `e` `q` | fix, ready, request reviewers |
| `z` `i` | later, ignore |
| `X` `D` | close, discard the draft |
| `d` | the PR view |
| `t` | its agent tab |
| `o` | the PR on GitHub |
| `w` | its pr-flow job's log in the tail at the bottom (`-` `=` its height); `c` stops the job |
| `s` | sync with GitHub now |
| `/` | filter |
| `?` | every key |

Actions that change something on GitHub ask first (⏎ yes, Esc no); a key for an action the PR
doesn't offer now says what it does offer.

It reads pr-flow's queue (`queue --format json`) when pr-flow's state changes and every minute
while shown, and syncs with GitHub every 10 minutes while shown. Each read saves pr-flow's last
listing, which its shorthand (`all waiting`) and `queue --changed` refer to.

## Install

Herdr installs layouts through its agent. In a terminal in Herdr, tell Claude Code (or
another agent):

```text
Read ~/.config/herdr-app/AGENTS.md, then add this layout: https://github.com/jocrau/herdr-layout
```

It copies the layout and mods into `~/.config/herdr-app`, renames anything whose name you
already use, merges `keys.json` (asking before it replaces a key you have bound), checks each
mod and switches to the layout. `ctrl-shift-l` switches back to your previous layout; deleting
`layouts/workbench.json` and the mods removes it.

By hand, from a clone of this repository:

```sh
cp -R mods/* ~/.config/herdr-app/mods/      # check for name clashes first
cp layouts/workbench.json ~/.config/herdr-app/layouts/
# merge keys.json into ~/.config/herdr-app/keys.json
for m in mods/*/; do herdr-app check ~/.config/herdr-app/mods/$(basename $m); done
herdr-app do layout.switch '{"name":"workbench"}'
```

## Needs

| For | Install |
|---|---|
| Everything | The [Herdr desktop app](https://herdr.dev) (macOS), `git` |
| Pull requests in the sidebar and the worktree menu | [`gh`](https://cli.github.com), logged in |
| ⌘⇧B beads | [`bd`](https://github.com/steveyegge/beads), [`fzf`](https://github.com/junegunn/fzf) 0.59 or later, `python3` |
| ⌘⇧F fleet board | agent-fleet's `fleet` 0.37 or later (not public yet; see [Fleet board](#fleet-board)) |
| ⌘⇧R PR board | The pr-flow Claude Code plugin (not public yet; see [PR board](#pr-board)), Node 20+ and `gh` |
| `d` in the git graph | Git's diff tool, set in git so Herdr finds it however it was started: `git config --global diff.tool vscode` |
| `claude-resume` after a reboot | Optional: [`extras/claude-resume`](extras/claude-resume) and the status line below (see [Resuming Claude sessions](#resuming-claude-sessions-after-a-reboot)) |
| Usage in the status bar | Optional: a Claude Code status line that writes `~/.local/state/claude-usage.json`, such as [`extras/claude-statusline.py`](extras/claude-statusline.py) (see [Usage](#usage)) |

Everything else is optional: a missing tool hides its feature.

## What it runs and reads

Nothing here talks to a server of its own. The mods run local programs and read files outside
their folders, which is how they get their data:

- **Programs:** `git` (status, log, fetch, pull, push, worktree; fetch, pull and push reach
  your remotes; the status bar runs a read-only `git status` in the focused terminal's folder every
  few seconds), `gh` (pull requests, on GitHub), `bd` and `fzf` (the beads view), `python3`
  (beads-view, the extras), `fleet` (the fleet board), `node` with pr-flow's script (the PR board), `herdr-app` and `hc`, and your editor and
  diff tool when you ask for them.
- **Files read:** your repositories; the layout's settings file (see [Settings](#settings)); agent-fleet's state under `~/.local/state/agent-fleet` (watched for changes);
  pr-flow's state folder (watched; its PR records are read for branches, reviewers and findings);
  `~/.local/state/claude-usage.json` for the status bar; `~/.claude/projects` (only
  `claude-resume`, to find a session's transcript).
- **Files written:** only by your actions (a commit, an edit in the file browser, a beads
  edit), plus the mods' own remembered sizes and settings in Herdr's storage. Two exceptions:
  the git graph adds `/.worktrees/` to a repository's `.git/info/exclude` the first time it
  makes a worktree there, and `extras/claude-statusline.py`, if you set it up, writes the usage
  file and labels its terminal.

## Settings

The layout works without settings. These can be set in `~/.config/herdr-app/data/workbench.json`:

```json
{ "code_dir": "~/Projects", "fleet": "~/src/agent-fleet/scripts/fleet" }
```

- `code_dir`: the folder whose git repositories ⌘N and the git graph's ⇧R offer (default
  `~/Code`, searched 4 levels deep). A home folder (`"~"`) is searched only 2 levels deep, and its
  Desktop, Documents, Downloads, Library and media folders are skipped.
- `fleet`: the `fleet` command the fleet board runs (default: `fleet` on your PATH).
- `pr_space`: the space the PR board opens each PR's agent tab in (default `"PR Reviews"`; without such a
  space, the one shown).
- `pr_flow`: the `pr-flow.mjs` the PR board runs (default: the newest installed pr-flow plugin);
  `pr_flow_state`: another pr-flow state folder (the demo uses its own copy).

### The fleet and pr-flow on another machine

The fleet and pr-flow can run on another machine that Herdr reaches (`hc machine add`), such as an
always-on box, with this window as the place you watch and answer them. Name it, as `hc machine ls`
does:

```json
{ "fleet_machine": "agentbox", "pr_flow_machine": "agentbox" }
```

- `fleet_machine`: the fleet board runs `fleet` there (from that machine's login PATH; `fleet` above
  is this computer's), shows the runs there, and opens its terminals and session tabs there. It reads
  the run on screen every 15 seconds instead of watching its files. Its beads and diff open on that
  machine too.
- `pr_flow_machine`: the PR board runs pr-flow there and reads its state and job logs there; PR tabs
  open in the PR space on that machine (made when missing); the PR view reads the clone there. It
  reads the queue every 15 seconds while shown. `pr_flow` and `pr_flow_state` are then paths on that
  machine (`~` its home).
- `pr_flow_code_dir`: where the PRs' clones are on that machine (default `~/Code` there).

There, the tools have to be on the login shell's PATH: `fleet` (`fleet install-cli`), `node`,
`gh` (logged in), `git`, `claude`, and for the beads view `bd`, `fzf` and `python3`. The beads view
needs no setting: in a space on another machine it shows that machine's beads.

## Status bar

The status bar shows only what the window doesn't show elsewhere: the focused terminal's
repository and branch, `↑` commits to push and `↓` commits behind its upstream (as of the last
fetch; or "not pushed", "upstream gone"), and the branch's pull request with its stage when pr-flow
tracks it (a click opens the PR view); how many agents need you (a click goes to the next one);
the machine, when the space runs on another one; and your Claude usage (below). It also keeps the
order of the panes you used for ⌥Tab.

### Usage

The status bar shows your Claude subscription usage (the 5-hour and 7-day windows: share used,
pace, projection at reset) once `~/.local/state/claude-usage.json` exists. Claude Code only
hands those numbers to its status line, so a status line has to save them.
[`extras/claude-statusline.py`](extras/claude-statusline.py) does that, and shows a compact
line itself: model and effort, context used, a hint when each call reads a lot of tokens, and
usage from 80 %. Inside Herdr it leaves out the repository and branch, which the space and
tabs already show. It needs only `python3` and `git`. The layout install doesn't copy it; from
a clone of this repository (or ask your agent to do both steps):

```sh
cp extras/claude-statusline.py ~/.claude/
```

and in `~/.claude/settings.json`:

```json
"statusLine": {"type": "command", "command": "python3 -I ~/.claude/claude-statusline.py"}
```

Inside Herdr it also labels its terminal with the context used (`claude.context`), and
`space-agents` shows it on each agent's row as a short bar and percent, yellow from 60 % and
red from 80 %, so you can see which agent needs a `/compact` without switching to it. The
`SessionEnd` hook below clears the label.

Already have a status line you like? Keep it, and have it write the file instead: the
`save_usage` function in the script shows the format (`{"seen_at": …, "rate_limits": …}`,
the `rate_limits` Claude Code passes in, merged across sessions).

## Resuming Claude sessions after a reboot

Herdr keeps your terminals through a reboot or logout, but each comes back as a fresh shell:
the Claude Code session that ran there is gone (Herdr never reruns a command). With
[`extras/claude-statusline.py`](extras/claude-statusline.py) as your status line, each
terminal is labelled with its session while Claude runs, and
[`extras/claude-resume`](extras/claude-resume) brings them back: run it in any terminal, check
the list, say yes, and each terminal that lost its session runs `claude --resume` from the
session's own folder. Sessions come back without Remote Control (`/remote-control` turns it
on again).

```sh
cp extras/claude-resume ~/.local/bin/    # or anywhere on your PATH
```

So that a session you quit yourself isn't brought back, add this hook to
`~/.claude/settings.json` (it drops the terminal's label when Claude ends):

```json
"hooks": {"SessionEnd": [{"hooks": [{"type": "command",
  "command": "python3 -I ~/.claude/claude-statusline.py --session-end"}]}]}
```

## Updating

The install copies files, so updates don't arrive by themselves. To update, tell your agent:
"Update the herdr-layout mods from https://github.com/jocrau/herdr-layout, keeping my
changes". The [CHANGELOG](CHANGELOG.md) says what changed.

## Development

`node --test 'tests/unit/*.test.mjs'` and `python3 -m unittest discover -s tests/unit -p 'test_*.py'` run
the unit tests: the fleet board's and the git graph's logic, beads-view with a fake `bd`, every mod's
modules loading and linking (Herdr's own modules stubbed), and, with a global ESLint, no name used without
being declared or imported. `tests/worktrees/RUNBOOK.md` is a manual pass over the git and worktree actions.
`python3 -I tests/demo/keys.py --run tests/demo/keys/*.keys` presses keys on a board in the demo window
(below) and checks what it shows, and that rows don't jump: a board answers `<mod>.test.key.<key>` there
(`lib/testkeys.js`, on only with the demo's `test_keys` setting). Focus moving into a text field still needs a
person: the demo window stays behind yours.
A mod's folder is linked into Herdr, so try changes in the demo window (below) or a worktree first.

## Screenshots

The images here come from [`tests/demo/make-demo.sh`](tests/demo/make-demo.sh): it builds made-up
repositories and a fleet dry run in `/tmp/herdr-demo` and opens them in a second Herdr window with
its own home, terminal session and fleet state, so your own window, terminals and runs are never
touched. Its agents are stand-ins ([`tests/demo/fake-agent.py`](tests/demo/fake-agent.py)) that
report working, blocked or done to Herdr and show a made-up session; the window takes your theme
and fonts from your own `settings.json`. `build`, `up`, `fleet`, `shot <file>`, `down`, `clean`.

## Credits and licences

Built on mods by [Nate Landau](https://github.com/natelandau/herdr-worktree-support),
[Rabeeh T A](https://github.com/rabeeh-ta/herdr-git-graph),
[linziyanleo](https://github.com/linziyanleo/herdr-mods) and Herdr's own. Each keeps its licence;
see [THIRD_PARTY.md](THIRD_PARTY.md). The rest is MIT ([LICENSE](LICENSE)).
