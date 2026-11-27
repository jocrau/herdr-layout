// Local change: the git view's Remove worktree dialog, opened from elsewhere (the sidebar's menus) with
// { role: "remove", folder, on }: a small "Looking…" while it reads the repository, then the same
// dialog the graph's menu opens, and this closes.
import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { props, closeOverlay, notify, theme } from "herdr";
import { removeFrom, openDialog } from "./act.js";
import { TYPE } from "./lib/type.js";

export class Remover {
  init(cx) {
    const { folder, on = null, overlay } = props() ?? {};
    cx.spawn(async () => {
      try {
        const { action, ctx } = await removeFrom(folder, on);
        await openDialog(action, ctx);
      } catch (e) {
        notify({ title: "Can't remove that worktree", body: String(e?.message ?? e), level: "error" });
      }
      closeOverlay(overlay);
    });
  }

  render() {
    const t = theme();
    return v_flex().size_full().items_center().justify_center().bg(t.popover).text_size(TYPE.body).text_color(t.muted)
      .child(div().child("Looking at the worktree…"));
  }
}
