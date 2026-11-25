// Modified by Jochen Rau, 2026-11, from Herdr's workspace-status mod: see NOTICE.md in this folder.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, readTextFile, home, focused, exec, openOverlay } from "herdr";
import { footerBar } from "./lib/bars.js";
import { noteFocus } from "./lib/recent.js";
import { parseStatus, slugOf, repoName, syncMarks, repoMenuProps } from "./lib/gitline.js";
import { lastQueue, prForBranch, openPrView, STAGE } from "./lib/prflow.js";

// Claude subscription usage, saved by the Claude Code status line on each response
// (this repo's extras/claude-statusline.py does it; see the README's "Status bar usage").
const USAGE = "/.local/state/claude-usage.json";
const WINDOWS = [["five_hour", "5h", 5 * 3600], ["seven_day", "7d", 7 * 86400]];
const BAR_W = 40;
const PACE_FROM = 0.1;          // too early in a window for a projection to mean much
const WARN = 90, OVER = 110;    // projected % used at reset
const STALE_AFTER = 30 * 60;    // no Claude response for this long: dim the numbers

const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
function when(epoch, now) {
  const w = new Date(epoch * 1000);
  return w.toDateString() === new Date(now * 1000).toDateString() ? hhmm(w) : `${w.toLocaleDateString("en-US", { weekday: "short" })} ${hhmm(w)}`;
}
function ago(secs) {
  const m = Math.round(secs / 60);
  return m < 60 ? `${m}m ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
}

// Per window: share used, share of the window gone by, and the projected share
// at reset if usage keeps its pace. level: 0 fine, 1 close to the limit, 2 over.
function usage(data) {
  const now = Date.now() / 1000, limits = data?.rate_limits, seen = Number(data?.seen_at || 0);
  const rows = [];
  for (const [key, label, length] of WINDOWS) {
    const w = limits?.[key];
    if (!w) continue;
    const resets = Number(w.resets_at || 0);
    if (resets && resets < now) { rows.push({ label, expired: true, tip: `${label}: reset at ${when(resets, now)}, no Claude response since` }); continue; }
    const pct = Number(w.used_percentage || 0);
    const elapsed = resets ? Math.min(1, Math.max(0, 1 - (resets - now) / length)) : null;
    const proj = elapsed != null && elapsed >= PACE_FROM ? pct / elapsed : null;
    const level = pct >= 100 || (proj != null && proj > OVER) ? 2 : proj != null && proj >= WARN ? 1 : 0;
    const tip = [`${label}: ${pct.toFixed(0)}% used`]
      .concat(elapsed != null ? [`${Math.round(elapsed * 100)}% of window gone`] : [])
      .concat(proj != null ? [`on pace for ~${Math.round(proj)}%`] : elapsed != null ? ["too early to project"] : [])
      .concat(resets ? [`resets ${when(resets, now)}`] : [])
      .join(" · ");
    rows.push({ label, pct, elapsed, level, tip });
  }
  const stale = seen > 0 && now - seen > STALE_AFTER;
  const onCredits = rows.some((r) => r.pct >= 100);
  const tip = rows.map((r) => r.tip).concat(seen ? [`data from ${when(seen, now)} (${ago(now - seen)})${stale ? ", stale" : ""}`] : []).join("\n");
  return { rows, stale, onCredits, tip };
}

// Fill = share used; tick = share of the window gone by. Fill past the tick is over pace.
function paceBar(r, t, color) {
  const fill = Math.round(Math.min(100, r.pct) / 100 * BAR_W);
  return div().relative().w(BAR_W).h(5).rounded(2.5).bg(t.border)
    .child(div().absolute().left(0).top(0).h(5).w(fill).rounded(2.5).bg(color))
    .when(r.elapsed != null, (el) => el.child(div().absolute().top(-2).h(9).w(1.5).left(Math.max(0, Math.round(r.elapsed * BAR_W) - 1)).bg(t.foreground)));
}

function usageView(u, t) {
  const colors = [t.muted, t.ansi3, t.blocked];
  const row = h_flex().gap(10).items_center().text_color(t.muted).when(u.stale, (el) => el.opacity(0.5));
  for (const r of u.rows) {
    const color = colors[r.level ?? 0];
    row.child(h_flex().gap(5).items_center().text_color(color).child(r.label).when(!r.expired, (el) => el.child(paceBar(r, t, color)).child(`${r.pct.toFixed(0)}%`)).when(Boolean(r.expired), (el) => el.child("—")));
  }
  if (u.onCredits) row.child(div().text_color(t.blocked).child("on credits"));
  return div().id("usage").tooltip(u.tip).child(row);
}

export default class WorkspaceStatus extends View {
  init(_props, cx) {
    this.usage = null;
    cx.timer.every(15000, (cx) => this.load(cx));
    // The status bar is always shown: it keeps the recent panes' order for ctrl+tab (lib/recent.js, recent-panes).
    noteFocus();
    cx.timer.every(250, () => noteFocus());
    this.load(cx);
    // The focused terminal's repository, branch and push state: at once when the focus moves to another folder,
    // else every 5 s (a commit, a push, a fetch).
    this.git = null; this.gitKey = null; this.gitAt = 0;
    cx.timer.every(1000, (cx) => this.gitLine(cx));
  }

  gitLine(cx) {
    const f = focused(), space = spaces().find(s => s.active);
    const cwd = f?.cwd ?? space?.folder ?? null, on = space?.machine ?? null;
    const key = JSON.stringify([on, cwd]);
    if (this.gitBusy || (key === this.gitKey && Date.now() - this.gitAt < 5000)) return;
    if (!cwd) { if (this.git) { this.git = null; cx.notify(); } this.gitKey = key; return; }
    this.gitBusy = true;
    cx.spawn(async (cx) => {
      const opt = on ? { cwd, on } : { cwd };
      let g = null;
      try {
        // Writes nothing under .git (no index refresh, no fsmonitor cookie).
        const st = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch", "--untracked-files=no"], opt);
        if (st.code === 0) {
          const top = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"], opt);
          const [common, root] = top.stdout.split("\n");
          const url = await exec("git", ["remote", "get-url", "origin"], opt);
          g = { ...parseStatus(st.stdout), repo: repoName(common), root: root?.trim() || null, on, slug: url.code === 0 ? slugOf(url.stdout) : null };
        }
      } catch { g = this.git; } // couldn't ask (a machine away): keep what it showed
      this.gitBusy = false; this.gitKey = key; this.gitAt = Date.now();
      if (JSON.stringify(g) !== JSON.stringify(this.git)) { this.git = g; cx.notify(); }
    });
  }

  load(cx) {
    cx.spawn(async (cx) => {
      try { this.usage = JSON.parse(await readTextFile(home() + USAGE)); }
      catch { this.usage = null; }
      cx.notify();
    });
  }

  // Right-click on the branch: the git view's repository menu (pull, push, fetch, …) for that repository.
  syncMenu(cx) {
    const g = this.git;
    if (!g?.root) return;
    cx.spawn(async () => {
      const rs = await exec("git", ["remote"], g.on ? { cwd: g.root, on: g.on } : { cwd: g.root }).catch(() => null);
      const m = repoMenuProps(g, (rs?.stdout ?? "").split("\n").map((x) => x.trim()).filter(Boolean), { root: g.root, on: g.on });
      if (m) openOverlay({ mod: "git-graph", kind: "popup", at: "pointer", width: 268, height: m.height, props: { role: "menu", target: m.target, ctx: m.ctx } });
      this.gitAt = 0; // ask git again soon: a pull or push changes the marks
    });
  }

  // The next agent that waits for you, after the one you're in (so clicks go round them all).
  goWaiting(waiting) {
    if (!waiting.length) return;
    const here = waiting.findIndex(a => a.focused);
    run("pane.focus", { pane: waiting[(here + 1) % waiting.length].pane });
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const waiting = list.filter(a => a.status === "blocked"), needs = waiting.length;
    const g = this.git, pr = g ? prForBranch(lastQueue(), g.slug, g.branch) : null;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    return footerBar(h_flex().w_full(), t).px(14).gap(16).bg(t.chrome).text_color(t.muted)
      // Where you are: the machine when it isn't this one; the focused terminal's repository and branch, what's to
      // push (↑) or pull (↓), and the branch's PR when pr-flow tracks it (a click: the PR view); then agents that need
      // you (the sidebar lists them all, but it can be hidden).
      .when(Boolean(space?.machine), el => el.child(label("server", space.machine)))
      .when(Boolean(g?.repo), el => el.child(label("folder", g.repo)))
      // A right-click on the branch and its marks: pull, push, fetch (the git view's menu).
      .when(Boolean(g), el => el.child(h_flex().id("git-branch").gap(6).px(6).py(1).rounded(5).items_center()
        .hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.syncMenu(cx); })
        .child(div().id("git-branch-name").tooltip("Right-click: pull, push, fetch").child(label("branch", g.branch ?? "detached")))
        .children(syncMarks(g).map((m, i) => div().id(`git-mark-${i}`).text_color(m.tone === "push" ? t.ansi2 : m.tone === "pull" ? t.ansi3 : t.dim).tooltip(`${m.tip}\nRight-click: pull, push, fetch`).child(m.text)))))
      .when(Boolean(pr), el => el.child(h_flex().id("branch-pr").gap(6).px(6).py(1).rounded(5).items_center().cursor_pointer()
        .hover(s => s.bg(t.hover).text_color(t.foreground))
        .tooltip(`${pr.short} · ${pr.title}${pr.next_step?.text ? `\n${pr.next_step.text}` : ""}\nClick: the PR view`)
        .on_click(() => openPrView(pr.key))
        .child(div().text_color(t.accent).child(`#${pr.key.split("#")[1]}`))
        .when(Boolean(STAGE[pr.stage]), x => x.child(div().text_color(STAGE[pr.stage][1] ? t.foreground : t.dim).child(STAGE[pr.stage][0])))))
      // A link to them: each click goes to the next agent that waits for you (its space and tab with it).
      .when(needs > 0, el => el.child(h_flex().id("needs-you").gap(6).px(6).py(1).rounded(5).items_center().text_color(t.blocked)
        .cursor_pointer().hover(s => s.bg(t.blocked + "26")).tooltip(waiting.map(a => `${a.tab_name || a.title} · ${a.space_name}`).join("\n"))
        .on_click(() => this.goWaiting(waiting))
        .child(div().size(6).rounded(3).bg(t.blocked)).child(`${needs} need${needs === 1 ? "s" : ""} you`)))
      .child(div().flex_1())
      .when(Boolean(this.usage), el => {
        const u = usage(this.usage);
        return el.when(u.rows.length > 0, el => el.child(usageView(u, t)));
      });
  }
}
