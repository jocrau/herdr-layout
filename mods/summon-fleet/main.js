// summon-fleet: ⌘⇧F on the "fleet" side column. Hidden, it shows; shown, the keyboard goes to its board (in the board,
// keys.json binds ⌘⇧F to hiding it). A popup that does that and closes itself (lib/sidecolumn.js: summonColumn).

import { View, div } from "gpui-kit";
import { checking } from "herdr";
import { summonColumn } from "./lib/sidecolumn.js";

export default class Summon extends View {
  init(_props, _cx) {
    if (!checking()) summonColumn("fleet");
  }

  render() { return div(); }
}
