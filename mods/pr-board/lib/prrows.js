// Copied from lib/prrows.js by lib/sync.mjs: edit it there, then run `node lib/sync.mjs`.
// The PR queue's rows as pr-board's pane and the PR view (the git graph's dialog) both draw them: pr-flow's
// sections, a row per PR, the PR's agent tab as a dot. Pure drawing: the caller says what's selected.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { STAGE, prTab, parseKey, oldFindingsText } from "./prflow.js";
import { nextStep } from "./prmodel.js";
import { tipText } from "./tiptext.js";

// A colour with `hex` alpha added (a theme colour that has its own alpha already stays as it is).
export const alpha = (c, hex) => (/^#[0-9a-f]{6}$/i.test(c ?? "") ? c + hex : c);

// Severity colours, most severe first (pr-flow's order).
export const SEVERITIES = ["blocker", "high", "medium", "low"];
export const sevColor = (t, s) => ({ blocker: t.ansi1, high: t.ansi1, medium: t.ansi3, low: t.dim })[s] ?? t.dim;

// The PR's agent tab, drawn as the Agents pane draws an agent (Herdr's status colours): a spinner while it
// works, a dot when it needs you (blocked) or finished while you weren't looking (done), a ring once seen (idle).
export function tabDot(t, key) {
  const tab = prTab(key), st = tab?.status ?? null;
  const box = div().w(8).flex_none().flex().items_center().justify_center();
  if (!tab) return box;
  if (st === "working") return box.child(svg("mods/workspace-chrome/spinner.svg").size(8).flex_none().text_color(t.working ?? t.ansi4).spin(900));
  if (st === "blocked" || st === "done") return box.child(div().size(6).rounded(3).bg((st === "blocked" ? t.blocked ?? t.ansi1 : t.done ?? t.ansi2)));
  return box.child(div().size(6).rounded(3).border(1.5).border_color(t.idle ?? t.dim));
}

// Open findings as "1 high · 2 med" in their colours (nothing when none).
// `rec`: the PR's record. With none open at the head, findings from an older head show dim, with the head they were
// made at ("2 high @abc1234"): the head moved, a re-review says which still hold.
export function findingsBadge(t, rec) {
  const open = rec?.open, parts = SEVERITIES.filter((s) => open?.[s]).map((s) => [`${open[s]}${s === "medium" ? " med" : ` ${s}`}`, sevColor(t, s)]);
  const old = parts.length ? 0 : SEVERITIES.reduce((n, s) => n + (rec?.old?.[s] ?? 0), 0);
  return h_flex().flex_none().gap(6).children(parts.map(([text, c]) => div().text_size(11).text_color(c).child(text)))
    .when(old > 0, (e) => e.child(div().text_size(11).text_color(t.dim)
      .child(`${old} old${rec.findingsSha ? ` @${String(rec.findingsSha).slice(0, 7)}` : ""}`)));
}

// CI as one glyph.
// CI as "CI ✓" (green), "CI ✗" (red) or "CI ◌" (running): the label says what the mark is about.
export function ciGlyph(t, ci) {
  const [g, c, what] = { SUCCESS: ["✓", t.ansi2, "passed"], FAILURE: ["✗", t.ansi1, "failing"], ERROR: ["✗", t.ansi1, "failing"], PENDING: ["◌", t.ansi3, "running"], EXPECTED: ["◌", t.ansi3, "waiting"] }[ci] ?? ["", t.dim, ""];
  return h_flex().id(`ci-${ci}`).flex_none().gap(2).items_center().tooltip(`CI ${what}`)
    .child(div().text_size(10.5).text_color(t.dim).child("CI")).child(div().text_size(11.5).text_color(c).child(g));
}

// The row's columns, so a caller (the pane's details) can line up under the text: the dot, the number.
export const ROW_PAD = 10, DOT_W = 8, GAP = 6;
export const textIndent = (numW) => ROW_PAD + DOT_W + GAP + numW + GAP;
// Where the title starts (after the repo column): the open row's details line up there.
export const titleIndent = (numW, repoW) => textIndent(numW) + repoW + GAP;

// A section's heading: its title in pr-flow's words, the count; a click folds or unfolds it.
// The sections that need you carry their count in red; the others read normally (not dimmed, which looked
// disabled).
export function sectionHead(t, { id, title, count, open, needsYou, onClick, compact }) {
  return h_flex().id(id).px(compact ? 8 : 10).pt(compact ? 8 : 10).pb(3).gap(6).items_center().cursor_pointer()
    .hover((e) => e.text_color(t.foreground)).on_click(onClick)
    .child(div().text_size(10.5).font_semibold().text_color(needsYou ? t.foreground : t.muted).child(title.replace(/^(Review|Your PRs) · /, (m) => (m.startsWith("Your") ? "Mine · " : "")).toUpperCase()))
    .child(needsYou ? div().px(5).rounded(4).bg(alpha(t.ansi1, "26")).text_size(10.5).font_semibold().text_color(t.ansi1).child(String(count))
      : div().text_size(10.5).text_color(t.dim).child(String(count)))
    .child(div().flex_1())
    .child(div().text_size(10).text_color(t.dim).child(open ? "▾" : "▸"));
}

// One PR. Wide (the pane): number, repo, title on the first line; pr-flow's detail and the open findings
// under it. Compact (the PR view's list): number and repo only, the title as a tooltip.
// The number column's width for these rows: the longest "#1234" (monospace, ~7.3 px a character), so the repo
// names after it line up.
// The repo column's width: the longest repo name (~6.6 px a character at 11.5), at most 150, so titles line up.
export const repoWidth = (rows) => Math.min(150, Math.ceil(Math.max(4, ...rows.map((r) => (r.key.split("/")[1] ?? "").split("#")[0].length)) * 6.6) + 4);

export const numWidth = (rows) => Math.ceil(Math.max(3, ...rows.map((r) => String(r.key.split("#")[1] ?? "").length + 1)) * 7.3) + 2;

export function prRow(t, mono, r, { id, selected, focused, compact, onClick, numW, repoW, open }) {
  const k = parseKey(r.key);
  const [stage, needs] = STAGE[r.stage] ?? [r.stage?.toLowerCase() ?? "", false];
  const base = h_flex().id(id).px(compact ? 8 : 10).gap(6).items_center().cursor_pointer().rounded(compact ? 5 : 0)
    .when(selected, (e) => e.bg(focused ? t.selected : t.hover)).hover((e) => e.bg(t.hover)).on_click(onClick);
  const num = div().flex_none().when(Boolean(numW), (e) => e.w(numW).text_right()).font_family(mono).text_size(12).text_color(needs ? t.foreground : t.muted).child(`#${k?.n ?? "?"}`);
  if (compact) {
    // What needs you: its number in the accent colour (red is for problems). Open findings: their count, in the
    // worst one's colour.
    const open = r.rec?.open ?? {}, worst = SEVERITIES.find((s) => open[s]), nOpen = SEVERITIES.reduce((n, s) => n + (open[s] ?? 0), 0);
    return base.h(22).tooltip(tipText(`${r.short} · ${stage}${needs ? " (needs you)" : ""}\n${r.title}${r.detail ? `\n${r.detail}` : ""}${nOpen ? `\n${SEVERITIES.filter((s) => open[s]).map((s) => `${open[s]} ${s}`).join(", ")} open` : oldFindingsText(r.rec) ? `\n${oldFindingsText(r.rec)}` : ""}`))
      .child(tabDot(t, r.key)).child(num.when(needs, (e) => e.text_color(nextStep(r).problem ? t.ansi1 : t.accent).font_semibold()))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(needs ? t.muted : t.dim).child(k?.repo ?? ""))
      .when(nOpen > 0, (e) => e.child(div().flex_none().px(4).rounded(3).bg(alpha(sevColor(t, worst), "22")).text_size(10.5).text_color(sevColor(t, worst)).child(String(nOpen))));
  }
  const rec = r.rec;
  // Three columns: the tab's dot, the number, and the text (both lines), so the second line starts under the repo.
  return base.py(3).items_start().tooltip(tipText(`${r.short} · ${r.author || "you"} · ${r.size}\n${r.title}`))
    .child(h_flex().h(18).items_center().child(tabDot(t, r.key)))
    .child(h_flex().h(18).items_center().child(num))
    .child(v_flex().flex_1().min_w(0).gap(1)
      // An open row wraps its title and detail instead of cutting them.
      .child(h_flex().min_h(18).gap(6).items_start()
        .child(div().h(18).flex_none().when(Boolean(repoW), (e) => e.w(repoW)).when(!repoW, (e) => e.max_w(130)).truncate().text_size(11.5).text_color(t.dim).child(k?.repo ?? ""))
        .child(div().flex_1().min_w(0).when(!open, (e) => e.truncate()).text_size(12).text_color(needs ? t.foreground : t.muted).child(r.title)))
      .child(h_flex().gap(8).items_start()
        .child(div().flex_1().min_w(0).when(!open, (e) => e.truncate()).text_size(11).text_color(open ? t.muted : t.dim).child(r.detail || stage))
        .child(findingsBadge(t, rec))
        // CI only when it isn't green: a failing or running one stands out, passing is the usual case.
        .when(Boolean(rec?.ci) && rec.ci !== "SUCCESS", (e) => e.child(ciGlyph(t, rec.ci)))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(r.size ?? ""))));
}
