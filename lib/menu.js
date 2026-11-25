// What every right-click and branch menu says, and in which order: the git view's (git-graph/git.js), the status
// bar's (the same repository menu) and the sidebar's (worktree-actions). One order everywhere, so each item is
// where it was last time: open · in step with the remote · uncommitted changes · the branch's work · links and
// copies · what deletes, removes or closes. tests/unit/menus.test.mjs builds each menu and checks it against this.

export const GROUPS = ["open", "sync", "changes", "work", "links", "remove"];

// The items several menus share: the same words and icon (an icon of git-graph's icons/, by name) in each.
// An ellipsis means the item asks first; `asks` says so for the items that run at once in one menu and ask in
// another (Pull runs at once from the sidebar, asks in the git view).
export const WORDS = {
  gitView: { label: "Open in git view", icon: "graph" },
  fetch: { label: "Fetch", icon: "sync" },
  pull: { label: "Pull", icon: "pull" },
  push: { label: "Push", icon: "push" },
  commit: { label: "Commit…", icon: "commit" },
  stash: { label: "Stash uncommitted changes…", icon: "stash" },
  resetUncommitted: { label: "Reset uncommitted changes…", icon: "reset" },
  showChanges: { label: "Show changes", icon: null }, // the changes mod's own icon, named per mod
  github: { label: "Open on GitHub", icon: "external" },
  branchOnGitHub: { label: "Open branch on GitHub", icon: "external" },
  commitOnGitHub: { label: "Open commit on GitHub", icon: "external" },
  prOnGitHub: { label: "Open pull request on GitHub", icon: "external" },
  reveal: { label: "Reveal in Finder", icon: "folder" },
  copyPath: { label: "Copy path", icon: "copy" },
  copyBranch: { label: "Copy branch name", icon: "copy" },
  deleteBranch: { label: "Delete branch…", icon: "trash" },
  removeWorktree: { label: "Remove worktree…", icon: "trash" },
};

// An item's words: `asks` adds the ellipsis to one that has none.
export function word(key, { asks = false } = {}) {
  const w = WORDS[key];
  if (!w) throw new Error(`no menu word ${key}`);
  return asks && !w.label.endsWith("…") ? { ...w, label: `${w.label}…` } : w;
}

// Which group an item's label belongs to, or null (a label only one menu has, like Rename, stays where its menu
// puts it; so does a finished worktree's "Clean up (merged)…", first after the ways to open it on purpose).
// The first matching rule wins: "Open branch on GitHub" is a link, "Open in VS Code" opens.
const RULES = [
  ["links", /^(Open (.* )?on |Reveal |Copy )/],
  ["work", /^(Open worktree|New worktree|Merge |Rebase |Create pull request|Cherry pick|Revert)/],
  ["open", /^(Open |Go to |New |Checkout)/],
  ["sync", /^(Fetch|Pull|Push|Fast-forward)/],
  ["changes", /^(Commit…|Stash |Reset uncommitted|Show changes)/],
  ["remove", /^(Delete |Remove |Close space)/],
];
export function groupOf(label) {
  for (const [group, re] of RULES) if (re.test(String(label))) return group;
  return null;
}

// The first item out of the order (a group before one it should come after), as [the earlier label, it]; null when
// the menu keeps the order.
export function outOfOrder(labels) {
  let last = -1, lastLabel = null;
  for (const label of labels) {
    const g = groupOf(label);
    if (g === null) continue;
    const at = GROUPS.indexOf(g);
    if (at < last) return [lastLabel, label];
    last = at; lastLabel = label;
  }
  return null;
}
