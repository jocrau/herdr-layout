// summon-prs: ⌘⇧R on the "prs" side column. Hidden, it shows; shown, the keyboard goes to its board (in the board,
// keys.json binds ⌘⇧R to hiding it). A popup that does that and closes itself (lib/sidecolumn.js: summonColumn).

import { View, div } from "gpui-kit";
import { checking } from "herdr";
import { summonColumn } from "./lib/sidecolumn.js";

export default class Summon extends View {
  init(_props, _cx) {
    if (!checking()) summonColumn("prs");
  }

  render() { return div(); }
}
