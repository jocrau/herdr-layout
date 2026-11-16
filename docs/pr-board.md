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

- **Your move:** sub-grouped by action, most urgent first: decide (a review loop), fix (CI, conflicts), post your
  comments, answer feedback, review, merge, get ready. Each PR is three lines: what (number, title, its tag,
  repo), who (author → reviewers, when it was last pushed), and the next step in one sentence.
- **Waiting on others:** one line each, saying on whom (the author, your reviewers, CI and bots, an agent) and since
  when.
- **Later** and **Dormant** start folded.
- **Red** only for real problems: a review loop, failing CI, conflicts. Counts are plain.
- **Details (⏎):** pr-flow's reasons and the facts the rows don't show, then the section's suggested actions, the
  PR view, its tab and GitHub; the other actions are under "more…".

**The PR view (`d`, ⏎ on a finding, ⌘⌥R)**: git-graph's review dialog, opened on the PR.

```
┌ PRs ────────┬ acme-api#506  feat/job-stamp · alice · ready · CI ✓ ─ [review] [later] [open] ┐
│ ALARMS      │ graph: the PR branch over its base, PR head selected                                      │
│  #447       │ ──────────────────────────────────────────────────────────────────────────────────────── │
│ TO MERGE    │ main … 4a09cb1 · 12 commits     │ src/engine/stamp.ts                                     │
│  #149       │ F1 high   stamp.ts:42  Job stamp…│  40  const job = …                                      │
│ READY       │ F2 low    README.md:8  …         │  41 +  stamp(job)                                       │
│ ▸#506       │ ● M src/engine/stamp.ts   +40 −3 │  42 +  emit(job)        ◀ F1 high: Job stamp is set…   │
│  …          │   M README.md             +2     │                                                         │
└─────────────┴─────────────────────────────────┴─────────────────────────────────────────────────────────┘
```

- **Narrow queue on the left:** the same rows as the pane. `⌘↑` and `⌘↓`, or a click, move to another PR
  without closing the dialog. The graph switches to that PR's repository.
- **PR bar:** shows the title, author, stage and CI, plus the actions that fit the stage.
- **The rest is git-graph's review view:**
  - It reviews the PR's range (base…head) in your local checkout of the repository. pr-board fetches the PR
    branch first when the head commit isn't there yet.
  - The findings list sits in the review's top-left corner, where a commit's message would go.
  - A file with findings has a severity dot in the file list.
  - The line a finding is on is marked in the diff, with its title.
  - `n` and `N` step from finding to finding.

**In the normal git graph:** a branch with a tracked PR carries a small pr-flow stage label ("review",
"merge", "waiting"). A click on the label opens the PR view.

**From a space:** worktree-support's PR badge on a space or worktree opens the PR view for that branch's PR.

## Acting on a PR

- **Actions pr-flow runs itself** (`later`, `ignore`, `open`, `discard`, `handback`, `show`) run directly
  through `pr-flow act "<verb> <pr>" --json`. The pane then reads the queue again.
- **Outward actions** (`approve`, `merge`, `close`) ask first, in the confirm bar the fleet board uses. pr-flow
  still runs its own readiness checks.
- **Actions that need a model** (`review`, `fix`, `post`, `copy`, `ready`, `ping`, `nudge`, `split`, and
  `merge`'s checklist) go to **the PR's own Claude tab**:
  - The tab is named after the PR (`acme-api#506`). It lives in the "PR Reviews" space, set by `pr_space` in
    the settings, and opens in your local checkout of the repository when there is one.
  - For a new tab, pr-board runs `tab.new {argv: ["claude"], task: "/pr-flow:inbox review 506"}`.
  - If the PR already has a tab, pr-board brings that tab forward and types the command into it with
    `hc send`, so each PR keeps one conversation.
  - When a PR is merged, closed or approved, pr-board offers to close its tab.

## Keys (as in the fleet board and the git graph)

| Key | Pane | PR view |
|---|---|---|
| `j k` `↑ ↓` | move between PRs | files (as in git-graph's review) |
| `⏎` `l` `→` | details open or closed | — |
| `space` | the section's first suggested action (one that changes something on GitHub asks first) | the same, from the PR bar |
| `d` | the PR view (a click only opens or closes details) | — |
| `n` `N` | — | next / previous finding |
| `⌘↑ ⌘↓` | — | previous / next PR in the queue |
| `o` | the PR on GitHub | the PR on GitHub |
| `t` | its Claude tab | its Claude tab |
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
- **One PR:** `show <pr>` gives the branches, head commit and CI; `findings <pr> --json` gives the findings.
  Both are read when a PR is opened.
- **Actions:** `act "<shorthand>" --json`.
- **Shared with the git graph:** lib/prflow.js holds this code and is copied into pr-board, git-graph and
  worktree-support. The last queue read is kept in shared state (`pr-board.queue`), so the git graph's labels
  and the badges cost nothing extra.

Asks for pr-flow (not needed for the prototype):
- A read that leaves `listing.json` alone (`queue --format json --no-save`, say). Each `queue` read saves the
  listing that shorthand like `all waiting` and `queue --changed` refer to, so pr-board's reads move your
  agent sessions' "changed since" baseline.
- `queue --format json` could carry each PR's `headRef`,
`headSha` and `baseRef`, so the git graph's labels wouldn't need one `show` per PR. The launcher setup
writes should find the installed copy (`MARKET` is null in ours, so it falls back to a deleted worktree).

## Prototype scope (this branch)

1. lib/prflow.js: locate pr-flow, read the queue and records, run `act`, map a repository to your local
   checkout, and find or open the PR's tab.
2. mods/pr-board: the side pane, the per-PR tabs, the actions pr-flow runs itself (with the confirm bar),
   and opening the PR view.
3. git-graph `props.pr`: the queue on the left, the PR bar, the findings in the review, the files and the
   diff.
4. The stage label on git-graph branches, and the click from worktree-support's PR badge.
5. The layout block (`prs`), ⌘⇧R and ⌘⌥R, and a demo with its own pr-flow state.

Later: notifications when a PR starts needing you (as the fleet board's alerts do), and sweeps shown in the
pane.
