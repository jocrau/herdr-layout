// An action's dialog, opened with props { role: "dialog", action, ctx }: names
// to type, options to tick, a mode to pick. Styled like Herdr's prompt and
// confirm dialogs. Git's error stays in the dialog so the person can fix it.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, theme } from "herdr";
import { dialogFor, initialValues, validate, createdWorktree } from "./git.js";
import { perform, goToWorktree } from "./act.js";
import { icon } from "./menu.js";

export class Dialog {
  init(cx) {
    const { action, ctx } = props();
    this.spec = dialogFor(action, ctx);
    this.values = initialValues(action, ctx);
    // Local change: -1 when there's no field, so ⏎ confirms (it used to wait for a field that wasn't there).
    this.focusedInput = (this.spec.inputs ?? []).length ? 0 : -1;
    this.inputs = (this.spec.inputs ?? []).map((field, i) => {
      const state = InputState.new({ value: field.value ?? "" });
      state.on("change", (_e, cx) => { this.values[field.id] = state.value(); this.error = null; cx.notify(); });
      state.on("submit", (_e, cx) => this.confirm(cx));
      state.on("focus", (_e, cx) => { this.focusedInput = i; cx.notify(); });
      state.on("blur", (_e, cx) => { if (this.focusedInput === i) this.focusedInput = -1; cx.notify(); });
      return { field, state };
    });
    this.handle = cx.focus_handle();
    const first = this.inputs[0]?.state;
    if (first) {
      if (this.inputs[0].field.value) first.set_selected_range({ start: 0, end: this.inputs[0].field.value.length });
      first.focus();
      cx.timer.after(600, () => first.focus());
    } else {
      this.at = Math.max(0, this.rows().findIndex((r) => r.kind === "option" && r.value === this.values[this.spec.choice?.id]));
      this.handle.focus();
      cx.timer.after(150, () => this.handle.focus());
    }
  }

  confirm(cx) {
    if (this.busy) return;
    const { action, ctx, overlay } = props();
    const problem = validate(action, this.values, ctx);
    if (problem) { this.error = problem; cx.notify(); return; }
    this.busy = true; this.error = null;
    cx.spawn(async (cx) => {
      const result = await perform(action, this.values, ctx, { toast: false });
      this.busy = false;
      if (result.ok) {
        closeOverlay(overlay);
        // A new worktree opens in a tab of the space you're in, the graph closing.
        const made = createdWorktree(action, this.values, ctx);
        if (made) goToWorktree(made.path, made.branch, ctx.on, ctx.overlay, ctx.space);
      }
      else { this.error = result.message; cx.notify(); }
    });
    cx.notify();
  }

  // Local change: the keyboard reaches everything. Rows: the choice's options, then the
  // ticks. ↑↓ (and ⇥ ⇧⇥) move between the fields and the rows; a choice row is picked as the
  // cursor lands on it, space ticks a tick row, ⏎ confirms (in a field too).
  rows() {
    const s = this.spec;
    return [...(s.choice?.options ?? []).map((o) => ({ kind: "option", value: o.value })), ...(s.checks ?? []).map((c) => ({ kind: "check", id: c.id }))];
  }

  // Where the cursor is: a field (-1 - its index… kept as focusedInput) or a row (this.at).
  goRow(i, cx) {
    const rows = this.rows();
    if (!rows.length) return;
    this.at = Math.max(0, Math.min(rows.length - 1, i));
    const r = rows[this.at];
    if (r.kind === "option") { this.values[this.spec.choice.id] = r.value; this.error = null; }
    if (this.focusedInput >= 0) this.handle.focus();
    this.focusedInput = -1;
    cx.notify();
  }

  goField(i, cx) {
    const f = this.inputs[i];
    if (!f) return false;
    f.state.focus(); this.focusedInput = i; this.at = null; cx.notify();
    return true;
  }

  navKey(k, cx) {
    const rows = this.rows(), nf = this.inputs.length;
    const inField = this.focusedInput >= 0;
    // Entering the rows from a field lands on the picked option (else the first row).
    const entry = () => Math.max(0, rows.findIndex((r) => r.kind === "option" && r.value === this.values[this.spec.choice?.id]));
    if (k === "down" || k === "tab") {
      if (inField && this.focusedInput < nf - 1) return this.goField(this.focusedInput + 1, cx);
      if (inField) return rows.length ? (this.goRow(entry(), cx), true) : k === "down";
      if (this.at === null || this.at === undefined) return rows.length ? (this.goRow(entry(), cx), true) : false;
      return this.goRow(this.at + 1, cx), true;
    }
    if (k === "up" || k === "shift-tab") {
      if (inField) return this.focusedInput > 0 ? this.goField(this.focusedInput - 1, cx) : true;
      if (this.at === null || this.at === undefined) return nf ? this.goField(nf - 1, cx) : (rows.length ? (this.goRow(entry(), cx), true) : false);
      if (this.at === 0 || k === "shift-tab") return nf ? this.goField(nf - 1, cx) : (this.goRow(this.at - 1, cx), true);
      return this.goRow(this.at - 1, cx), true;
    }
    if (k === "space" && !inField && this.at !== null && this.at !== undefined && rows[this.at]?.kind === "check") {
      const id = rows[this.at].id;
      this.values[id] = !this.values[id]; cx.notify();
      return true;
    }
    return false;
  }

  danger() {
    const choice = this.spec.choice;
    return Boolean(this.spec.danger || choice?.options.find((o) => o.value === this.values[choice.id])?.danger);
  }

  render() {
    const t = theme(), s = this.spec, danger = this.danger();
    const label = (text) => div().pt(14).pb(7).text_size(11.5).text_color(t.dim).child(text);
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1()
      .border_color(primary ? (danger ? t.ansi1 : t.solid) : t.input).bg(primary ? (danger ? t.ansi1 : t.solid) : t.raised)
      .text_color(primary ? (danger ? t.background : t.solid_foreground) : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((st) => st.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("git-graph-dialog").track_focus(this.handle).size_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(props().overlay);
        else if (e.key === "enter" && this.focusedInput < 0) this.confirm(cx);
        else if (!this.navKey(e.keystroke ?? e.key, cx)) return;
        cx.stop_propagation();
      })
      .child(h_flex().flex_none().items_center().child(div().flex_1().text_size(15).font_semibold().child(s.title)).child(div().text_size(11).text_color(t.dim).child("Esc")))
      // Local change: the overlay keeps the height it opened with, so what doesn't fit scrolls,
      // and the error and the buttons below stay in view.
      .child(v_flex().id("gd-body").flex_1().min_h(0).overflow_y_scrollbar()
      .when(Boolean(s.detail), (el) => el.child(div().pt(8).text_color(t.muted).child(s.detail)))
      .children(this.inputs.map(({ field, state }, i) => v_flex()
        .child(label(field.label))
        .child(Input.new(state).h(36).px(10).rounded(9).border_1().border_color(this.focusedInput === i ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground))))
      .when(Boolean(s.choice), (el) => el.child(label(s.choice.label)).children(s.choice.options.map((o) => {
        const on = this.values[s.choice.id] === o.value, cursor = this.focusedInput < 0 && this.rows()[this.at]?.value === o.value;
        return h_flex().id(`gd-choice-${o.value}`).h(38).mb(4).px(10).gap(10).items_center().rounded(8).border_1().cursor_pointer()
          .border_color(on ? (o.danger ? t.ansi1 : t.accent) : t.border).when(on, (e) => e.bg(t.selected)).when(cursor, (e) => e.border_2()).hover((st) => st.bg(t.hover))
          .on_click((_e, cx) => { this.values[s.choice.id] = o.value; this.error = null; cx.notify(); })
          .child(div().size(14).flex_none().rounded(7).border_1().border_color(on ? (o.danger ? t.ansi1 : t.accent) : t.input).flex().items_center().justify_center()
            .when(on, (e) => e.child(div().size(6).rounded(3).bg(o.danger ? t.ansi1 : t.accent))))
          .child(div().flex_none().font_medium().child(o.label))
          .when(Boolean(o.detail), (e) => e.child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(o.danger ? t.ansi1 : t.dim).child(o.detail)));
      })))
      .children((s.checks ?? []).map((c) => {
        const on = Boolean(this.values[c.id]), cursor = this.focusedInput < 0 && this.rows()[this.at]?.id === c.id;
        return h_flex().id(`gd-check-${c.id}`).mt(8).px(6).py(4).rounded(6).when(cursor, (e) => e.bg(t.selected)).gap(9).items_center().cursor_pointer()
          .on_click((_e, cx) => { this.values[c.id] = !on; cx.notify(); })
          .child(div().size(15).flex_none().rounded(4).border_1().border_color(on ? t.accent : t.input).when(on, (e) => e.bg(t.accent)).flex().items_center().justify_center()
            .when(on, (e) => e.child(svg(icon("check")).size(11).text_color(t.accent_foreground))))
          .child(div().flex_1().min_w(0).text_color(t.foreground).child(c.label));
      })))
      // The plain sentence when there is one (git's own words only without it), kept short.
      .when(Boolean(this.error), (el) => el.child(div().flex_none().pt(10).max_h(64).overflow_hidden().text_size(12).text_color(t.ansi1)
        .child(this.error.split("\n\n")[0])))
      .child(h_flex().flex_none().pt(14).gap(8).justify_end()
        .child(button("gd-cancel", "Cancel", false, () => closeOverlay(props().overlay)))
        .child(button("gd-ok", this.busy ? "Working…" : s.confirm, true, (_e, cx) => this.confirm(cx))));
  }
}
