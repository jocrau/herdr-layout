// One set of text sizes for every board and bar, named by what they're for (px at zoom 1). Boards write
// text_size(TYPE.body), never a number: tests/unit/type.test.mjs fails on a literal, so a size changes here, once,
// for every board. Seven sizes, each a visible step from the next (sizes half a pixel apart read as a mistake).
export const TYPE = {
  hint: 10.5, // key hints, column headings, counts in badges: the smallest that stays legible in a monospace font
  label: 11.5, // secondary facts on a row, section labels, a row's meta in the git view
  meta: 12, // a card's meta line, help text
  body: 12.5, // rows, cards, dialog fields and sidebar rows
  title: 13, // a board's header, a card's title (Herdr's own UI size)
  heading: 14, // a dialog's subheading
  dialog: 15, // a dialog's title
};
