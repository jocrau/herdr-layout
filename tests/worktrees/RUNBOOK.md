# Runbook: worktrees and branches

Manual test of the git graph's per-file reset, its branch and worktree handling, and the
spaces list's clean-up of finished worktrees. Clean-up and worktree removal delete things,
so everything runs in a throwaway repository.

## 0. Set up a throwaway repository

```sh
sh ~/Code/herdr-layout/tests/worktrees/sandbox.sh
```

This creates `~/Code/wt-sandbox` and its remote `~/Code/wt-sandbox-remote.git`. Run it again
to start over. It contains:

| What | Used for |
|---|---|
| `feature/ready`, a branch nobody has checked out | Checkout here, or in a new worktree |
| `origin/remote-only`, a remote branch with no local copy | Checkout remote branch |
| `in-tree`, checked out in `.claude/worktrees/in-tree`, 1 commit behind its upstream | Folder icon, go there, fast-forward |
| `done-gone`, a worktree whose remote branch was deleted | Dimmed row, Clean up |
| `done-dirty`, the same with an uncommitted file | Clean up warns that the change is lost |
| On `main`: a modified, a staged, a deleted, a new and an untracked file | Per-file reset |

Then open a space in `~/Code/wt-sandbox` (⌘N) and press **⌘G** there.

## 1. Per-file reset (`r`)

- [ ] On **Uncommitted changes (5)**, press ⏎, then `j`/`k` to move through the files.
- [ ] `b.txt` (staged): press `r`. The dialog offers **Unstage** (preselected) and
      **Discard**. Pick Unstage. `b.txt` now shows as modified but not staged.
- [ ] `a.txt`: press `r`. Only **Discard** is offered. After it, `a.txt` is gone from the list.
- [ ] `new.txt`: **Discard** deletes the file.
- [ ] `untracked.txt`: the only choice is **Delete**.
- [ ] Open a normal commit and press `r` on one of its files: the toast says "Nothing to reset".

## 2. Branches checked out in another worktree

- [ ] In the graph, the `in-tree` label has a **folder icon** instead of the branch icon.
- [ ] Double-click it. The graph closes, and a new tab "In Tree" opens in
      `.claude/worktrees/in-tree` in the space you opened the graph from (double-click again
      later: it shows that tab instead of opening another). Go back to the first tab and
      reopen ⌘G.
- [ ] Right-click `in-tree`. The menu starts with **Open its worktree here (in-tree)** and has
      **Copy worktree path**. It has no Checkout and no Delete.
- [ ] In the header, **Fast-forward N** doesn't count `in-tree`. In that same menu,
      **Fast-forward to origin/in-tree** works:
      `git -C ~/Code/wt-sandbox/.claude/worktrees/in-tree log -1 --oneline` shows
      "upstream moved on".
- [ ] Open ⌘G inside the worktree (a terminal in `.claude/worktrees/in-tree`). The header reads
      **wt-sandbox worktree in-tree**, and `main` has a folder icon.

## 3. Here or a new worktree, and the branch picker

- [ ] Double-click `feature/ready`. A dialog offers **Here** (preselected) and **New worktree**.
  - [ ] Pick **New worktree**. The toast says "feature/ready is in .worktrees/feature-ready",
        then a tab named `feature/ready` opens in that folder.
  - [ ] Back in the sandbox, `git status` doesn't list `.worktrees/`, and
        `cat .git/info/exclude` contains `/.worktrees/`.
- [ ] Double-click `feature/ready` again. It now has a folder icon and shows its tab in this space.
- [ ] Press ⇧B on any commit. The **New branch** dialog offers **Just create it**, **Here** and
      **New worktree**.
  - [ ] Type `feature/ready` and choose **Just create it**: "There's already a branch
        feature/ready: pick another name…".
  - [ ] Type `x` and choose **New worktree**: it works.
  - [ ] Do it again with a new name `x2` after creating the folder `.worktrees/x2` by hand
        (`mkdir ~/Code/wt-sandbox/.worktrees/x2`): "The folder x2 already exists…", and
        `git branch` has **no** `x2`.
- [ ] Turn **Remotes** on and double-click `origin/remote-only`. The dialog has the local name
      and Here / New worktree.
- [ ] Press `b` to open the branch picker:
  - [ ] `in-tree` shows "in in-tree" and ↓1. In a repo with open pull requests, their
        `#number` shows (not in the sandbox).
  - [ ] `⌃T` shows only branches in worktrees. `⌃T` again shows all.
  - [ ] On `x`, `⌃X` opens **Remove worktree**. Confirm, and the worktree is gone.
  - [ ] On `x`, `⌃D` deletes the branch. On `in-tree`, `⌃D` refuses: "remove that worktree
        first".
  - [ ] On `feature/ready`, `⌃O` goes to its worktree.
  - [ ] **Risk to watch:** if `⌃D` deletes a character in the search field instead of opening
        the dialog, the key needs to move.
- [ ] Remove a worktree with uncommitted changes:
  - [ ] `echo x > ~/Code/wt-sandbox/.worktrees/feature-ready/y.txt`
  - [ ] Right-click `feature/ready`, **Remove worktree…**, confirm: "The worktree has
        uncommitted changes. Tick…".
  - [ ] Tick the box and confirm again: it's removed. If its space was still open, the dialog
        warned about it.

- [ ] In the sidebar, unfold wt-sandbox's worktrees (its ›). Double-click `done-gone`: a tab
      "Done Gone" opens in the WT Sandbox space. Right-click it: the menu starts with
      **Go to tab in WT Sandbox**. In another space of the repository (if you open one), the
      same row's menu starts with **Open as tab in <that space>**, so it can be open in both.

## 4. Cleaning up finished worktrees

- [ ] In the sidebar, under the wt-sandbox space, `done-gone` and `done-dirty` are **dimmed**
      and say "remote gone". `in-tree` isn't dimmed.
- [ ] Right-click `done-gone`. The menu starts with **Clean up (remote gone)…**. The dialog says:
  - [ ] the worktree is removed and the branch deleted;
  - [ ] "It has no uncommitted changes";
  - [ ] "1 commit is on no remote and not in main";
  - [ ] the Clean up button is **red**.
- [ ] Confirm: the toast says "Cleaned up", the row disappears, and `git branch` no longer has
      `done-gone`.
- [ ] Open `done-dirty` as a space first (right-click, Open as space), go back to the
      wt-sandbox space and choose **Clean up…** on it. The dialog says "It has uncommitted
      changes: they are lost" and "Its space closes". Confirm: the space closes and the
      worktree and branch are gone.
- [ ] **Merged and closed pull requests** can't be faked in the sandbox. In a GitHub repo with a
      merged PR whose worktree still exists (mm-data-platform likely has some), the row is
      dimmed with "merged" before the purple `#number`, and Clean up mentions "a squash merge
      leaves them like that" for the leftover commits.
- [ ] If the repo sets `git config herdr.worktreeRemove '<cmd>'`, Clean up runs that command
      instead of `git worktree remove`, and the dialog says so.

## 5. On a real repo

- [ ] Open ⌘G in `~/Code/mm-data-platform`. `worktree-nats-multiplexer-passthrough` and the
      `.claude/worktrees/*` branches have folder icons, and double-clicking one goes to that
      worktree instead of failing.

## Cleaning up afterwards

Close any sandbox spaces first, then:

```sh
rm -rf ~/Code/wt-sandbox ~/Code/wt-sandbox-remote.git
```
