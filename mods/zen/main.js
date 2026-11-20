// zen: ⌘. hides the window's chrome (the tab bar, the status bar and the sidebar) and brings it back as it was. What
// stays: the panes, dialogs and popups, and the side columns on the right (the PR board, the fleet board), whose own
// headers keep their facts. Herdr's own toast still says when an agent needs you or finished; ⌥Tab (recent-panes)
// switches panes without the tab bar.
// Keys can run only one command, and a hidden block gets none: this is a popup that flips the blocks and closes itself.
// Zen is on while the tab bar is hidden; the sidebar's state from before is kept in shared "zen.sidebar".

import { View, div } from "gpui-kit";
import { layout, run, props, closeOverlay, shared, setShared, checking } from "herdr";
import { zenPlan } from "./lib/zen.js";

export default class Zen extends View {
  init(_props, _cx) {
    if (checking()) return;
    const plan = zenPlan(layout(), shared("zen.sidebar"));
    if (plan.remember !== undefined) setShared("zen.sidebar", plan.remember);
    for (const [cmd, id] of plan.steps) run(cmd, { id });
    closeOverlay(props()?.overlay);
  }

  render() { return div(); }
}
