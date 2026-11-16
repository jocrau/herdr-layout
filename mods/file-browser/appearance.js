// Modified by Jochen Rau, 2026-11, from linziyanleo/herdr-mods preview-plus: see NOTICE.md in this folder.
import { settings, theme } from "herdr";

// Reuse Herdr values; unexposed control fields use the shipped panel defaults.
export function appearance() {
  return { colors: theme(), font: settings().ui_font_family };
}

// Local change: code in Atom One Dark's syntax colors (its own palette, not the app
// theme's terminal colors): every role the editor colors.
const ONE_DARK = {
  keyword: "#c678dd", string: "#98c379", "string.escape": "#56b6c2", comment: "#7f848e",
  function: "#61afef", type: "#e5c07b", number: "#d19a66", boolean: "#d19a66", constant: "#d19a66",
  variable: "#e06c75", operator: "#56b6c2", punctuation: "#abb2bf",
};

export function sourceStyle() {
  const s = settings();
  return { font_family: s.font_family, font_size: s.font_size, syntax: ONE_DARK };
}
