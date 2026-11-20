// Zen mode's plan (mods/zen): which layout blocks to hide or show. Pure, for tests.
// Zen is on while the tab bar ("tabs") is hidden. Turning it on hides the tab bar, the status bar and the sidebar,
// and remembers whether the sidebar was hidden already; turning it off shows the bars again and the sidebar only if
// it was open before. Blocks the layout doesn't have are left alone.
// { steps: [[command, id]], remember: boolean | undefined } — `remember`: the sidebar's state to keep (on turning on).
export const ZEN_BLOCKS = ["tabs", "status", "sidebar"];

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) { const f = find(child, id); if (f) return f; }
  return null;
}

export function zenPlan(root, sidebarWasHidden) {
  const has = (id) => Boolean(find(root, id)), on = Boolean(find(root, "tabs")?.hidden);
  if (!on) {
    return { steps: ZEN_BLOCKS.filter(has).map((id) => ["layout.hide", id]), remember: Boolean(find(root, "sidebar")?.hidden) };
  }
  const show = ["tabs", "status", ...(sidebarWasHidden ? [] : ["sidebar"])];
  return { steps: show.filter(has).map((id) => ["layout.show", id]), remember: undefined };
}
