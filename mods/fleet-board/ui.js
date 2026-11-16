// Fleet board: small drawing helpers shared by the views (colours by phase, the bar shapes).
import { div } from "gpui-kit";
import { phaseOf } from "./model.js";

// a + (b - a) * f for "#rrggbb" colours; anything else comes back as b.
export function mix(a, b, f) {
  const rgb = (c) => (/^#[0-9a-f]{6}/i.test(c ?? "") ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : null);
  const x = rgb(a), y = rgb(b);
  if (!x || !y || f >= 1) return b;
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * f).toString(16).padStart(2, "0")).join("");
}
// "violet": the theme's magenta pulled halfway to its blue, so a review never reads as the red of "sent back".
const MADE = { violet: (t) => mix(t.ansi5, t.ansi4, 0.45) };
export const phaseColor = (t, phase) => MADE[phase.color]?.(t) ?? t[phase.color] ?? t.accent ?? t.ansi4;
// A step's bar in Lanes (rows 12 high): its phase's colour, a full bar for an agent's step and a thin line
// for a check or the merge, with a hairline gap to the next step.
export const shaped = (el, t, step) => {
  const ph = phaseOf(step);
  return (ph.agent ? el.top(2).h(8) : el.top(4.5).h(3)).rounded(2).bg(phaseColor(t, ph)).border_r_1().border_color(t.background);
};
export const swatch = (t, phase) => div().w(14).h(phase.agent ? 8 : 3).rounded(2).flex_none().bg(phaseColor(t, phase));
export const pct = (f) => (f === null || f === undefined ? null : Math.round(f * 100));
