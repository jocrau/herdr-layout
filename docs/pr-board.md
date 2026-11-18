# pr-board: pr-flow in the workbench (plan)

pr-flow keeps the queue of pull requests that need you: the ones you review and your own. pr-board puts that
queue into the workbench and connects it to the git graph. pr-board reads the queue and runs pr-flow's
commands; pr-flow keeps all the state and rules, and agent work stays in Claude sessions.

## What you see

**The side pane (⌘⇧R)**: its own hidden right column, like the fleet board's (⌘⇧F). It's grouped by your next
move, not by pr-flow's stage (mods/pr-board/model.js maps one to the other):

```
┌ PRs  9 need you ──────────────── 34 tracked · synced 1m ┐
│ YOUR MOVE 9                                              │
│ Decide · 1                                               │
│▌#447 Order export service…  Feature  acme-web │  red bar: a real problem
│   fleet-bot → you, carol           pushed 2h   │  who: author → reviewers (✓ ✗, dim: not yet)
│   ⚠ 3 review rounds already: talk to the author · 1 high │  the next step (space does it)
│ Review · 6                                               │
│ ● #506 feat/job-stamp                     acme-api  │  ● its Claude tab
│   alice → you, bob               pushed 2h   │
│   ▶ Re-review what changed since 5a3fd56 · 1 high open   │
│ WAITING ON OTHERS 16                                     │
│   #82 Timezone fix for reports    dave  5d    │  one line: on whom, since when
│ ▸ LATER 4 · DORMANT 5                                    │
└──────────────────────────────────────────────────────────┘
```

- **Your move:** sub-grouped by action, most urgent first: answer its agent (the PR's Claude tab stopped to ask,
  "go?" or a permission, though pr-flow still counts it as at work; space brings the tab forward), decide (a review loop), fix (CI, conflicts), post your
  comments, answer feedback, review, merge, get ready. Each PR is three lines: what (number, title, its tag,
  repo), who (author → reviewers, when it was last pushed), and the next step in one sentence.
- **Waiting on others:** one line each, saying on whom (the author, your reviewers, CI and bots, an agent still
  working) and since when.
- **Later** and **Dormant** start folded.
- **Red** only for real problems: a review loop, failing CI, conflicts. Counts are plain.
- **Details (⏎):** each thing once. Under the row's context line, the PR's own facts (branch → base, GitHub's
  verdict, open threads, conflicts) and "Changes:", pr-flow's summary of what it changes. Then what the last
  pr-flow job did ("Self-check found 2 low findings · 32m ago"; running: its phase with output and stop; cost,
  model and id in its tooltip), pr-flow's reasons the row doesn't already say, and one row of buttons: the next
  step's action, the alternatives that can run now (the one the last job ran says "again"), **draft ↗** when
  pr-flow drafted comments; housekeeping on the right (one quiet word, or ⋯ with several: discard, hand back, …).
  Apart, under them: the PR view, its Claude tab, GitHub. The row counts open findings ("6 findings", red with
  a high one, amber with a medium; the kinds in its tooltip).

**The PR view (`d`, ⏎ on a finding, ⌘⌥R)**: git-graph's review dialog, opened on the PR.

```
┌ acme-api#506 3/17 ▾  Job stamp on every run · alice · ready · CI ✓ ──────── [review] [later] [GitHub ↗] ┐
│ graph: the PR branch over its base, PR head selected                                                      │
│ ───────────────────────────────────────────────────────────────────────────────────────────────────────── │
│ main … 4a09cb1 · 12 commits         │ src/engine/stamp.ts                                                  │
│ ┃ high F1 stamp.ts:42               │  40  const job = …                                                   │
│ ┃ Job stamp is set before the job…  │  41 +  stamp(job)                                                    │
│ ┃ FIX  Set it after emit, …         │  42 +  emit(job)        ◀ F1 high: Job stamp is set before…       │
│ ┃  41 +  stamp(job)                 │                            Fix: Set it after emit, …               │
│ ● M src/engine/stamp.ts   +40 −3    │                                                                      │
└─────────────────────────────────────┴──────────────────────────────────────────────────────────────────────┘
```

- **Another PR:** the PR's name in the bar (or `p`) opens the queue under it, in the pane's groups; typing
  filters it, ⏎ shows a PR without closing the dialog, and the graph switches to its repository. `⌘↑` and `⌘↓`
  step through the queue without it. `⇧L` shows the queue as a list on the left, for going through many.
- **PR bar:** shows the title, author, stage and CI, plus the actions that fit the stage.
- **The rest is git-graph's review view:**
  - It reviews the PR's range (base…head) in your local checkout of the repository. pr-board fetches the PR
    branch first when the head commit isn't there yet.
  - pr-flow's notes sit in the review's top-left corner, where a commit's message would go, as tall as they
    need (up to about half; drag the line under them for a height of your own). Each finding is a card: its
    severity, id and place, its title, and, opened (a click, or reached with `n N`), its fix and the code at its
    line. Each place under "Where to spend your time" shows its code too: read at the PR's head, a few lines
    around it, the lines the PR changed tinted.
  - A file with findings has a severity dot in the file list.
  - The line a finding or a place to look at is on is marked in the diff, with its title or why; the one
    reached shows whole there (a finding's title and fix).
  - `n` `N` go through one reading path: the findings and the places to look at, in the file list's order and
    then by line; the diff's title bar says which stop is on screen ("stop 3 of 7").
  - Open review threads on GitHub show too: as cards after the findings, under their lines in the diff, and as
    stops of the reading path. A card's Resolve (or `⇧R` on the thread reached) resolves it on GitHub; resolved
    threads are listed folded under RESOLVED, each with Unresolve.
  - What a note says is read in one place: when its line is in the diff, the diff's note shows it whole (a
    finding's fix, a thread's replies) and the card stays short; when it isn't, the card shows it with the code.
  - The files the notes point at come first; deleted, lockfile and generated files fold into one row at the end
    (a click or ⏎ opens it).
  - A straight PR (no merges in it) folds the graph to one line naming the commit reviewed (`J K` step, `z` or
    a click shows the graph).
  - The right side shows the file as it will be once merged: every line, the PR's changed lines tinted, a marker
    where lines were removed, the notes under their lines, and the lines of the note reached highlighted (as a
    GitHub line-range link does). `s` (or "file" in its bar) switches to the diff and back; remembered apart for
    the PR view (the file unless set) and for other reviews (the diff unless set).
  - `w` ignores whitespace in the diff. Long lines scroll sideways (shift-wheel or a sideways swipe) with the
    line numbers kept in place, or wrap to the pane's width (`⇧W`, remembered). A hunk's `@@` header stays at the
    top while its lines scroll under it.
  - A note on a line range ("Look here (lines 494–528)") heads the range, above its first line, and n N bring it
    near the top so the range shows below it; a note on one line goes under that line. The range reached is
    marked by a bar beside the line numbers (changed lines keep their green).
  - `m` marks the selected file viewed (○ becomes ✓) and goes on to the next one not viewed; the
    files' line counts them ("7/18 viewed"). The marks are kept per PR, with the file's version then: a file
    changed by a later push comes back as not viewed.
  - `n` and `N` step from finding to finding.
  - **Your draft review** (pr-flow 0.33.0, the `draft` capability): when pr-flow has stored a comment draft
    (a draft job, or a reword of one), the notes start with it: the summary, then each comment as a card
    ("Draft", its finding, its place; a click goes to its line). In the diff each comment sits on its line as
    findings do, in its own colour and marked "Draft"; one on a removed line (GitHub's LEFT side) sits on that
    line of the diff; a range heads its lines. The comments are stops of `n N` (after a finding on the same
    line). With several versions a chip per version ("v1", "v2 shorter", "v3 softer") switches between them
    (`⇧V` the next); pr-flow's view gives only the current version's text, so an older one shows the text this
    view read while it was current (kept per PR in shared state), or says it can't.
  - Its buttons: **Post…** asks first in the bar (pr-flow's own question, with the version and how many
    comments), then runs `pr-flow post <pr> --draft <v>`: the version shown goes out unchanged (`⌘⏎`).
    **Approve with it…** (when pr-flow offers approve) asks, then `approve <pr> --draft <v>`. **Copy** runs
    `copy <pr> --draft <v> --json` and puts the summary and comments on the clipboard (`y`); pr-flow counts it
    as handed over. **Shorter**, **Softer**, **More** start a reword job (`job start reword <pr> --tone …`) on
    the current version; the panel shows its phase and, when it's done, the new version. **Reword in Claude ↗**
    opens the PR's Claude tab on pr-flow's post flow, to say in your own words what to change (it posts only
    when you say so). **Discard…** asks, then `act "discard <pr>"`. The bar's Post comments and Copy as text
    act on the draft shown too.

**In the normal git graph:** a branch with a tracked PR carries a small pr-flow stage label ("review",
"merge", "waiting"). A click on the label opens the PR view.

**From the git graph (⌘G):** `p` on a branch with a tracked PR turns the dialog into that PR's view, and esc
steps back to the plain graph. Reviewing such a branch's head since base (`c`) in the plain graph shows the PR's
notes, findings, threads and viewed marks as the PR view does, without its bar.

**From a space:** worktree-support's PR badge on a space or worktree opens the PR view for that branch's PR.

## Acting on a PR

- **Actions pr-flow runs itself** (`later`, `ignore`, `open`, `discard`, `handback`, `show`) run directly
  through `pr-flow act "<verb> <pr>" --json`. The pane then reads the queue again. `later` goes as
  `later <pr> tomorrow` (`mon` on Fridays and Saturdays): the PR comes back at the next working day's
  first sweep, in the morning.
- **Outward actions** (`approve`, `merge`, `close`) ask first, in the confirm bar the fleet board uses. pr-flow
  still runs its own readiness checks.
- **Actions that need a model** (`review`, `fix`, `post`, `copy`, `ready`, `ping`, `nudge`, `split`, and
  `merge`'s checklist) go to **the PR's own Claude tab**:
  - The tab is named after the PR (`acme-api#506`). It lives in the "PR Reviews" space, set by `pr_space` in
    the settings, and opens in your local checkout of the repository when there is one.
  - A new tab starts from pr-flow's own opening message for a fresh session (`pr-flow prompt <pr> <verb>
    --json`, pr-flow 0.31.0, the `prompt` capability): `tab.new {argv: ["claude", "<prompt>"]}`. The prompt
    is self-contained: the PR, the task and its skill, the claim under the session's own name, and how to
    close out. For a verb pr-flow has no prompt for, or with an older pr-flow, the tab starts as before:
    `tab.new {argv: ["claude"], task: "/pr-flow:inbox review 506"}`.
  - If the PR already has a tab, pr-board brings that tab forward and types the command into it with
    `hc send`, so each PR keeps one conversation.
  - When a PR is merged, closed or approved, pr-board offers to close its tab.
- **Its tab, to talk about the PR** (**tab ↗** in the details, or `t`): brings the PR's tab forward, or, when it
  has none, opens one with no action, for a conversation about the PR. The tab starts from an opening message pr-board writes itself: the PR's title,
  link, your role, its branches and checkout, then "read it, say in a sentence or two what it does, wait for
  my questions", and to post, push or change nothing unless asked. Actions on the PR later go to the same tab.

## Keys (as in the fleet board and the git graph)

| Key | Pane | PR view |
|---|---|---|
| `j k` `↑ ↓` | move between PRs | files (as in git-graph's review) |
| `⏎` `l` `→` | details open or closed | — |
| `space` | the section's first suggested action (one that changes something on GitHub asks first) | the same, from the PR bar |
| `d` | the PR view (a click only opens or closes details) | — |
| `n` `N` | — | next / previous stop (findings, draft comments, places to look at, threads) |
| `⌘⏎` | — | post the draft shown (asks first) |
| `y` | — | copy the draft shown |
| `⇧V` | — | the draft's next version |
| `m` | — | the selected file viewed (on to the next), or not again |
| `z` | — | a straight PR's graph folded or shown |
| `⇧R` | — | the review thread reached resolved on GitHub |
| `s` | — | the file as it will be once merged ⇄ the diff |
| `w` `⇧W` | — | whitespace ignored; long lines wrapped instead of scrolled sideways |
| `esc` | — | back to the plain graph of the repository (esc again closes) |
| `⌘↑ ⌘↓` | — | previous / next PR in the queue |
| `p` | — | every PR, under the PR's name (type to filter) |
| `⇧L` | — | the queue as a list on the left |
| `o` | the PR on GitHub | the PR on GitHub |
| `t` | its Claude tab, or a new one to talk about the PR | its Claude tab |
| `w` | its pr-flow job's log in the tail panel at the bottom (followed while it runs; the wheel scrolls smoothly (up stops following, "↓ newest" follows again), shift-wheel or a sideways swipe scrolls sideways; **terminal** there: `job show --follow`) | — |
| `-` `=` | the tail three lines shorter / taller (drag its top edge; double-click: 14 lines) | — |
| `esc` | the tail closed, then the details, then the column | — |
| `c` | its running or queued pr-flow job stopped (`job stop`) | — |
| `s` | sync (`pr-flow sync --max-age 1m`) | |
| `/` | filter by number, repo, title, author | |
| `?` | keys | keys |

## How it reads pr-flow

pr-board uses only pr-flow's published interface (ENGINE.md, schema 1):

- **Which pr-flow:** the `pr_flow` setting, or else the newest installed copy
  (`~/.claude/plugins/cache/*/pr-flow/<version>/scripts/pr-flow.mjs`). It runs with `node`, and the
  `pr_flow_state` setting passes `--state` (the demo uses its own copy).
- **The queue:** `queue --format json` reads it without calling GitHub (under 100 ms). pr-board runs it on
  start, after each action, and whenever `events.jsonl` or `listing.json` in the state folder changes (one
  watch). It runs `sync --max-age 10m` every 10 minutes while the pane is shown.
- **Each PR's facts** (branches, head, CI, review state, reviewers, requested, open findings, last push,
  rounds, the summary) and your login come with the listing, in each item's `facts`. pr-board passes
  `--no-save`, so its reads leave `listing.json` alone (the listing that shorthand like `all waiting` and
  `queue --changed` refer to). Both need pr-flow 0.30.0: pr-board asks `version --json` for the `nosave` and
  `facts` capabilities once per pr-flow it finds. With an older pr-flow it reads as before: the plain queue,
  and the facts from the records in `<state>/prs/*.json`.
- **pr-flow's view model** (pr-flow 0.32, the `view` capability): each listing item carries `move` (its
  group, label and order: where the pane puts it), `next_step` (the sentence under it; red when `problem`) and
  `actions` (with role, label, kind, `confirm` and `disabled_reason`). With it, the pane, the PR view's bar and
  the git graph's labels show pr-flow's judgment: its groups and order, its next step (ISO times shown as
  dates), its actions in its labels (Re-review, Ping reviewers), the primary first, alternatives, then
  housekeeping. An outward one asks first with pr-flow's question (a session verb, which goes to the PR's Claude
  tab, asks there instead); one with a `disabled_reason` is drawn dimmed, its tooltip says why, and a click only
  says it. The PR's Claude tab still outranks pr-flow (an agent that stopped to ask is your move). Without the
  capability, the board's own tables (lib/prmodel.js: MOVES, the next-step sentences, the section actions,
  ASK_FIRST) decide, as before. A shim adds the reason ("CI failing", "conflicts") that pr-flow 0.32.1 leaves
  out of some red next steps (fixed in 0.32.2; the shim does nothing once the text names it).
- **Jobs** (the `jobs` capability): each read of the queue also reads `job list --json`, and a PR's job shows on
  its row (◷ review 40% · its phase; a failed one in red with why, for an hour). A job verb (`kind: job`: review,
  check, post, copy, ping, …) runs `job start <verb> <pr>`; while pr-flow has no job definition for it, that
  refuses and changes nothing, and the verb goes to the PR's Claude tab as before. The PR's details show its job
  (the row's, else its latest, ended ones too) on one line that keeps its height: what it's doing (verb, %, the
  current phase, how long), what a finished review or self-check found, a failed one's reason in full; runtime,
  model, effort, cost and id in its tooltip.
  While the details are open the board follows a running job with `job show <id> --json` every 2 s (the queue's
  `job list` comes only when pr-flow records a step); when the job ends the queue is read again. **output ↗** (**log ↗**
  once it ended; `w`) opens the tail panel at the bottom of the pane, the fleet board's (lib/tailpanel.js): TAIL,
  "self-check #42", following or ended, wrap, **terminal** (`job show <id> [--follow]` in a terminal under the
  focused pane, as before), ✕. Its lines come from the job's directory, which ENGINE.md documents ("Jobs":
  `<state>/jobs/<id>/`): the last 256 KB of `work/transcript.jsonl` (Claude's stream-json; the first, cut line
  dropped), read as the agent's words, one line per tool call (`$ <command's first line>`, `read <path>`,
  `grep <pattern>`, other tools by name and main argument), a failed call or a denied permission in red (once), and
  the result ("done · 4m 35s · $2.15"); thinking, token counts, rate limits and init are left out, the last 200
  lines kept (`transcriptLines` in lib/prflow.js). Without a transcript: `runner.log`'s last lines, else the
  job's state and phase. Re-read every 3 s while the job runs and the panel is open, once more when it ended.
  Its height is remembered under `pr-board.tail-height`. **stop** (`c`) runs `job stop <id>`, without asking first: it's local, pr-flow releases the PR, and
  the verb can start again. Without the capability none of this shows.
- **Drafts** (the `draft` capability): the PR view's one `view <pr> --json` read (**One PR** below), when it
  opens a PR, every 20 s while it's open, and after each draft action, gives `draft` (the current version, its summary and comments with
  path, line, side, start_line) and `draft_versions`. A draft without a `version` (findings not drafted yet)
  shows nothing. Post, approve and copy pass `--draft <v>`; reword runs `job start reword`, followed with
  `job show <id> --json` every 2 s. On the pane, a PR at "post your comments" whose last done job stored a
  draft (`job list`: artifact kind `draft`, ref `<key>@<v>`) says "✎ draft v3 ready" and its details offer
  **draft v3 ↗**; post and copy from the pane open the PR view on the draft when there is a stored version
  (one `view` read), else run as before. Without the capability nothing of this shows.
- **One PR:** with pr-flow's view model (the `view` capability) the PR view reads `view <pr> --json` once when it
  opens a PR, beside `show <pr>`: view gives the branches and head (its `facts`), your last review's or self-check's
  head (Since my review), and the bar's stage, next step, actions and job, read with pr-board's own helpers
  (lib/prmodel.js and lib/prflow.js: `viewRow` turns the view into a queue row), so the bar says what the PR's
  card says: the same next step, the same actions in pr-flow's labels (an alternative that can't run now left
  out, "Self-check again" after a done self-check), a job as "self-check" on your own PR. `show` stays for what
  view leaves out: the explainer (where to spend your time, what it changes) and each finding's fix and end line
  (view's findings have only id, place, severity, status and title); its findings replace `findings --json`. The
  same view read is the draft's (above): every 20 s, after each draft action, and whenever the queue was read
  since (an action, pr-board's reads), so the bar follows the card. A PR's job shows from the view's `jobs`
  unless the queue's `job list` is newer. Without the capability: `show` for the branches, head and CI,
  `findings <pr> --json` for the findings, and the bar from the queue's row, as before. The plain graph's notes on
  a tracked PR's branch still read `show` and `findings --json`.
- **Actions:** `act "<shorthand>" --json` (a `job-started` result counts as done).
- **Shared with the git graph:** lib/prflow.js holds this code and is copied into pr-board, git-graph and
  worktree-support. The last queue read is kept in shared state (`pr-board.queue`), so the git graph's labels
  and the badges cost nothing extra.

## Prototype scope (this branch)

1. lib/prflow.js: locate pr-flow, read the queue and records, run `act`, map a repository to your local
   checkout, and find or open the PR's tab.
2. mods/pr-board: the side pane, the per-PR tabs, the actions pr-flow runs itself (with the confirm bar),
   and opening the PR view.
3. git-graph `props.pr`: the PR bar with the queue under its name, the findings in the review, the files and the
   diff.
4. The stage label on git-graph branches, and the click from worktree-support's PR badge.
5. The layout block (`prs`), ⌘⇧R and ⌘⌥R, and a demo with its own pr-flow state.

Later: notifications when a PR starts needing you (as the fleet board's alerts do), and sweeps shown in the
pane.
