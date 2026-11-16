#!/bin/sh
# A throwaway repository for testing the git graph's branch/worktree features and the
# sidebar's clean-up. Everything lives in ~/Code/wt-sandbox (+ wt-sandbox-remote.git).
# Run again to start over.
set -e
# Every git call here without your hooks or commit signing (it's a throwaway).
git() { command git -c core.hooksPath=/dev/null -c commit.gpgsign=false "$@"; }
OTHER=$(mktemp -d)/wt-sandbox-other  # a fresh folder each run: a failed run's leftovers can't stop this one
cd ~/Code
rm -rf wt-sandbox wt-sandbox-remote.git
git init -q --bare wt-sandbox-remote.git
git init -q -b main wt-sandbox
cd wt-sandbox
git remote add origin "$HOME/Code/wt-sandbox-remote.git"
c() { echo "$1" >> notes.txt; git add notes.txt; git commit -qm "$1"; }
for f in a.txt b.txt c.txt; do echo "$f" > "$f"; done
git add . && c "first"
c "second"
git push -q -u origin main

# feature/ready: a local branch nobody has checked out (checkout here / new worktree).
git branch feature/ready
# remote-only: exists on the remote only (checkout remote branch dialog).
git checkout -q -b remote-only && c "remote only" && git push -q -u origin remote-only
git checkout -q main && git branch -D -q remote-only
# in-tree: checked out in another worktree (folder icon, go there, Fast-forward N skips it).
git branch in-tree
git worktree add -q .claude/worktrees/in-tree in-tree
git -C .claude/worktrees/in-tree push -q -u origin in-tree
# The remote moves on, so in-tree is 1 behind origin/in-tree (fast-forward in its worktree).
git clone -q "$HOME/Code/wt-sandbox-remote.git" "$OTHER"
git -C "$OTHER" checkout -q in-tree
echo more >> "$OTHER"/notes.txt
git -C "$OTHER" commit -qam "upstream moved on"
git -C "$OTHER" push -q origin in-tree
rm -rf "$(dirname "$OTHER")"
git fetch -q origin
# done-gone: a worktree whose remote branch was deleted (dimmed "remote gone", Clean up…).
git worktree add -q -b done-gone .claude/worktrees/done-gone main
git -C .claude/worktrees/done-gone commit -q --allow-empty -m "work that was merged"
git -C .claude/worktrees/done-gone push -q -u origin done-gone
git push -q origin --delete done-gone
git fetch -q --prune origin
# done-dirty: like done-gone, with an uncommitted change (Clean up says it's lost, red button).
git worktree add -q -b done-dirty .claude/worktrees/done-dirty main
git -C .claude/worktrees/done-dirty push -q -u origin done-dirty
git push -q origin --delete done-dirty
git fetch -q --prune origin
echo unsaved > .claude/worktrees/done-dirty/scratch.txt
printf '.claude/worktrees/\n' >> .git/info/exclude

# Uncommitted changes on main, one of each (per-file reset with r).
echo changed >> a.txt                      # modified, unstaged
echo staged >> b.txt && git add b.txt      # modified, staged
rm c.txt                                   # deleted
echo new > new.txt && git add new.txt      # new, staged
echo untracked > untracked.txt             # untracked
echo "Sandbox ready: $(pwd)"
git worktree list
