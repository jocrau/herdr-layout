// Modified by Jochen Rau, 2026-11, from Herdr's tabs mod: see NOTICE.md in this folder.
import { View, div, svg, image } from "gpui-kit";
import { h_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, layout, settings, nextCommand } from "herdr";
import { SHORTCUTS } from "./lib/sidecolumn.js";
import { TYPE } from "./lib/type.js";

const SIDE = Object.keys(SHORTCUTS); // the side columns: one open at a time

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    this.over = null; // the tab a dragged one would land beside
    this.swipe = { acc: 0, steps: 0, at: 0, last: 0 };
    this.sideOpen = null; // the side columns open at the last render
    this.scroll = ScrollHandle.new();
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    // Keys open a panel as its button does: "cmd-shift-x": "tabs-graph.files" in keys.json.
    cx.spawn(async (cx) => { for (;;) { this.togglePanel(await nextCommand()); cx.notify(); } });
    this.oneSide();
    cx.timer.every(250, () => this.oneSide());
  }

  // Opens the panel on `id`, switches the open panel to it, or closes it when it's already showing.
  togglePanel(id) {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    if (!panel || !body?.children?.some((c) => c.id === id)) return;
    if (!panel.hidden && body.active === id) run("layout.hide", { id: "panel" });
    else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
  }

  // One tab per wheel notch (from Herdr's tabs mod). A touchpad or smooth-scrolling mouse sends many small
  // events per gesture: a short swipe or one smoothed notch (about 25 px) switches one tab, a longer swipe keeps
  // going a tab per 60 px, at most one every 100 ms so each shows. Local change: a mostly sideways gesture
  // scrolls the tab strip and switches nothing.
  wheel(e) {
    if (e.delta_lines) {
      if (Math.abs(e.delta_lines.x ?? 0) > Math.abs(e.delta_lines.y)) return;
      if (e.delta_lines.y) run(e.delta_lines.y > 0 ? "tab.prev" : "tab.next");
      return;
    }
    if (Math.abs(e.delta.x ?? 0) > Math.abs(e.delta.y)) return;
    const s = this.swipe, now = Date.now();
    // Phases often arrive only as moves (a macOS touchpad included): a pause or a turn starts a new gesture.
    if (e.touch_phase === "started" || now - s.at > 250 || e.delta.y * s.acc < 0) Object.assign(s, { acc: 0, steps: 0 });
    s.at = now;
    s.acc += e.delta.y;
    const need = s.steps ? 60 : 20;
    if (Math.abs(s.acc) < need || now - s.last < 100) return;
    s.acc -= Math.sign(s.acc) * need;
    s.steps++;
    s.last = now;
    run(e.delta.y > 0 ? "tab.prev" : "tab.next");
  }

  // One side column at a time, however it was opened (its link, its key, a command): one that has just
  // opened closes the others. Checked on a timer: the bar isn't drawn again for every layout change.
  oneSide() {
    const root = layout();
    let open = SIDE.filter((id) => { const n = find(root, id); return Boolean(n && !n.hidden); });
    const fresh = this.sideOpen ? open.filter((id) => !this.sideOpen.includes(id)) : [];
    if (fresh.length && open.length > 1) {
      const keep = fresh[fresh.length - 1];
      for (const id of open) if (id !== keep) run("layout.hide", { id });
      open = [keep];
    }
    this.sideOpen = open;
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          // Not over another side column (one at a time): that one stays.
          if (want && this.sideOpen?.some((id) => id !== "panel")) { this.pending = null; return; }
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const ps = panes(); // once per render, not twice per tab (each call copies every pane)
    // The selected tab scrolled into view when it changes (as Herdr's tabs mod does).
    const active = shown.findIndex(tab => tab.active);
    if (shown[active]?.id !== this.selected) { this.selected = shown[active]?.id; if (active >= 0) this.scroll.scroll_to_item(active); }
    const item = (c, i) => {
      const program = ps.find(p => p.tab === c.id && p.program?.agent)?.program ?? ps.find(p => p.tab === c.id)?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(TYPE.body)
        .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        // While dragging (as the spaces list): the dragged tab dimmed, a line where it would land.
        .relative()
        .when(this.pressed === i && this.over !== i, el => el.opacity(0.5))
        .when(this.pressed !== null && this.over === i && this.pressed !== i, el => el.child(
          div().absolute().top(4).bottom(4).w(2).rounded(1).bg(t.accent)
            .when(this.pressed < i, line => line.right(0))
            .when(this.pressed > i, line => line.left(0))))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; this.over = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_move((_e, cx) => { if (this.pressed !== null && this.over !== i) { this.over = i; cx.notify(); } })
        .on_mouse_up("left", (_e, cx) => {
          const from = this.pressed; this.pressed = null; this.over = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
          cx.notify();
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        // A title cut off at 170px shows in full on hover. Text can't be measured from a script, so it goes by length:
        // ~22 characters fit at this size, and a tooltip on a name that just fits does no harm.
        .child(div().max_w(170).truncate().when(name.length > 20, el => el.tooltip(name)).child(c.zoomed ? `${name} Z` : name))
        // Local change: a tab keeps its width as you flip through tabs and its agent works. An agent's tab always has
        // room for its status (spinner, dot, or nothing while idle), and every tab has its close button, dim until
        // the pointer is on it (Herdr's showed it on the active tab only, so the tabs shifted at each switch).
        .when(Boolean(program?.agent) || Boolean(c.status), el => el.child(h_flex().size(12).flex_none().items_center().justify_center()
          .when(c.status === "working", s => s.child(svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(900)))
          .when(c.status === "blocked" || c.status === "done", s => s.child(div().size(6).rounded(3).bg(t[c.status])))))
        .child(div().id(`close-${c.id}`).size(16).flex_none().flex().items_center().justify_center().rounded(4)
          .text_color(c.active ? t.muted : t.dim).hover(s => s.bg(t.hover).text_color(t.foreground)).tooltip("Close tab")
          .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12)));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    this.syncPanel(space, panel, body, enabled);
    // Our mods, as icons (named in their tooltips, with their keys.json shortcuts): the dialogs open (again:
    // close), the side columns show or hide, highlighted while open.
    const link = (id, tip, action, on = false) => div().id(`link-${id}`).size(26).flex_none().flex().items_center().justify_center().rounded(6)
      .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop).tooltip(tip)
      .on_click(action).child(svg(`mods/tabs-graph/icons/${id}.svg`).size(15));
    const visible = (id) => { const n = find(root, id); return Boolean(n && !n.hidden); };
    // No link for the side panel (Preview, Changes): the file browser and the git graph cover them; ⌘⌥O still opens it.
    const sides = [["prs", "prs", "PR board"], ["fleet", "fleet", "Fleet board"]]
      .filter(([, id]) => find(root, id));
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", (_e, cx) => { this.pressed = null; this.over = null; cx.notify(); })
      .on_scroll_wheel(e => this.wheel(e))
      // + right after the last tab, inside the strip (a scroll strip fills the bar, so + beside it would sit at
      // the far right). The strip's empty part and the gap before the links still drag the window.
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().track_scroll(this.scroll)
        .children(shown.map(item))
        .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 }))))
      .child(div().w(8).flex_none())
      .child(link("files", "File browser (⌘⇧O)", () => run("mod.open", { name: "file-browser" })))
      .child(link("git", "Git graph (⌘⇧G)", () => run("mod.open", { name: "git-graph" })))
      .child(link("beads", "Beads (⌘⇧B)", () => run("mod.open", { name: "beads" })))
      .when(sides.length > 0, el => el.child(div().w(1).h(16).mx(4).flex_none().bg(t.border)))
      .children(sides.map(([icon, id, name]) => link(icon, `${name} (${SHORTCUTS[id]})`, () => run("layout.toggle", { id }), visible(id))))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/tabs-graph/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/tabs-graph/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/tabs-graph/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
