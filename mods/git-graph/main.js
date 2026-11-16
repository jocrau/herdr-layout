import { View } from "gpui-kit";
import { props, shared, setShared } from "herdr";
import { Graph } from "./graph.js";
import { Menu } from "./menu.js";
import { Dialog } from "./dialog.js";
import { Settings } from "./settings.js";

export const POPUPS = "git-graph.popups";

// One mod, several roles: the graph (a panel or a pane), and over the window the
// right-click menu, the dialogs its actions ask first and the Manygit settings (props.role).
export default class GitGraph extends View {
  init(_props, cx) {
    const role = props()?.role;
    this.part = role === "menu" ? new Menu() : role === "dialog" ? new Dialog() : role === "settings" ? new Settings() : new Graph();
    this.part.init(cx);
    // Local change: menus and dialogs count themselves open, so the graph takes the keyboard
    // back once the last one closes, however it closed (Esc never reaches them: Herdr closes it).
    this.popup = role === "menu" || role === "dialog";
    if (this.popup) setShared(POPUPS, (shared(POPUPS) ?? 0) + 1);
  }

  async close() {
    this.part.prClose?.();
    if (this.popup) setShared(POPUPS, Math.max(0, (shared(POPUPS) ?? 1) - 1));
  }

  render(cx) { return this.part.render(cx); }
}
