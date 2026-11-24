// Fleet board: drawing: the header, the strip, Board, Lanes, a bead's row and details, the tail.
// Mixed into FleetBoard.
import { div } from "gpui-kit";
import { v_flex, h_flex, Textarea } from "gpui-base";
import { theme, run } from "herdr";
import { STEPS, VIEWS, SPANS, fleetTailLines, SECTIONS, ROW, OK, PHASES, phaseOf, dur, spanLabel, AGENT_STEPS, hm, timeline, gateText, asks, fixRounds, fixSessions, natural, mergedAt, tipText, clampWindow, waveRanges } from "./model.js";
import { phaseColor, shaped, swatch } from "./ui.js";
import { followupCounts } from "./snapshot.js";
import { shown } from "./env.js";
import { boardHeader, boardTop } from "./lib/boardheader.js";
import { tailPanel } from "./lib/tailpanel.js";

export const ViewsMethods = {
  // The panel: which bead, whether it still runs, a real terminal (follow), close; then its last lines,
  // each with the session (implement-0, review-1) dimmed in front.
  tailPanel(t, mono, short, now) {
    const b = this.tailBead(), same = b && this.tail.id === b.id;
    const active = b && ["running", "parked", "interrupted", "waiting for CI"].includes(b.state);
    // The lines as the shared panel draws them, converted once per read (not per frame).
    if (same && this.tailLinesOf !== this.tail) { this.tailLinesOf = this.tail; this.tailLines = fleetTailLines(this.tail.lines); }
    const note = !b ? "Select a bead to see its tail." : !b.history.length ? "Nothing has run on it yet." : !same ? "Reading…" : null;
    return tailPanel(t, {
      mono, size: this.tailSize, pane: this.height, title: b ? short(b.id) : "",
      status: b && same ? { text: active ? `following · ${dur(now - this.tail.at)} ago` : "ended", live: active } : null,
      note, error: same ? this.tail.error : null, lines: same ? this.tailLines : [],
      wrap: this.tailWrap, opened: (this.tailOpen ??= new Set()),
      onWrap: b && same && !this.tail.error ? () => { this.tailWrap = !this.tailWrap; } : null,
      onTerminal: b?.history.length ? () => this.inTerminal(["fleet", "tail", b.id, "--follow"], `tail ${b.id}`) : null,
      terminalTip: b ? `fleet tail ${b.id} --follow, in a terminal below` : "",
      onClose: () => { this.tailOn = false; }, closeTip: "Close the tail (w)",
    });
  },

  // One chip per run: a dot (breathing while a wave runs), repository · epic, and a red count of beads
  // waiting for you. The one on screen is outlined; a finished one (nothing open, no wave) is dimmed.
  // Shown when there is more than the one on screen.
  // The run list, a dropdown under the board's title while it's open: "Active", then "Finished this week".
  // A row: a dot (a wave running breathes; ✓ finished), the epic, its repository, a red count of beads waiting
  // for you, the last activity. Click or ⏎ shows that run; esc closes the list.
  runPicker(t, now) {
    const { active, done, flat } = this.runList(now), current = this.runKey();
    this.pickAt = Math.min(this.pickAt, Math.max(0, flat.length - 1));
    const row = (r) => {
      const i = flat.indexOf(r), on = r.key === current, finished = done.includes(r);
      const epic = r.epic.startsWith(r.repoName + "-") ? r.epic.slice(r.repoName.length + 1) : r.epic;
      return h_flex().id(`run-${i}`).h(30).px(10).gap(8).items_center().cursor_pointer()
        .when(i === this.pickAt, (el) => el.bg(t.hover)).hover((el) => el.bg(t.hover))
        .tooltip(`${r.repoName} · ${r.epic}\n${r.running ? "a wave is running" : "no wave running"}; ${r.parked} waiting for you, ${r.busy} running, ${r.open} open\n${r.cwd}`)
        .on_click((_e, cx) => { this.picking = false; this.choose(cx, r); })
        .child(finished
          ? div().w(8).flex_none().text_size(11).text_color(t.dim).child("✓")
          : div().size(7).rounded(4).flex_none().bg(r.running ? t.ansi2 : r.parked ? t.ansi1 : t.dim)
            .when(r.running, (el) => el.loop("opacity", { from: 0.35, to: 1, period: 1400 })))
        .child(div().flex_none().max_w(200).truncate().text_size(12.5).when(on, (el) => el.font_semibold())
          .text_color(on ? t.foreground : finished ? t.muted : t.foreground).child(epic))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(r.repoName))
        .when(r.parked > 0, (el) => el.child(div().flex_none().px(5).rounded(7).bg(t.ansi1).text_size(10.5).text_color(t.background).child(String(r.parked))))
        .child(div().flex_none().w(34).text_size(11).text_color(t.dim).text_right().child(r.running ? "now" : r.last ? dur(now - r.last) : ""));
    };
    const head = (label, n) => div().px(10).pt(6).pb(3).text_size(11).text_color(t.dim).child(`${label.toUpperCase()} ${n}`);
    const out = [];
    if (active.length) out.push(head("Active", active.length), ...active.map(row));
    if (done.length) out.push(head("Finished this week", done.length), ...done.map(row));
    if (!flat.length) out.push(div().p(14).text_size(12).text_color(t.dim).child(this.scanAt ? "No fleet runs." : "Listing the fleet's runs…"));
    out.push(div().px(10).pt(8).pb(4).mt(4).border_t_1().border_color(t.border).text_size(11).text_color(t.dim).child("j k · ⏎ show · e esc close · ⌘← ⌘→ step"));
    return out;
  },

  // The bar that asks.
  // `under`: drawn under its bead (indented like the details), else at the top under the tabs.
  confirmBar(t, mono, under = false) {
    const c = this.confirm;
    const btn = (id, label, primary, go) => div().id(id).px(10).h(22).rounded(5).flex().items_center().text_size(11.5)
      .when(primary, (x) => x.bg(t.accent).text_color(t.background).font_semibold())
      .when(!primary, (x) => x.border_1().border_color(t.border).text_color(t.foreground).hover((y) => y.bg(t.border)))
      .on_click((_e, cx) => { go(cx); cx.notify(); }).child(label);
    return v_flex().px(10).py(6).gap(4).bg(t.hover).when(under, (x) => x.pl(28).border_l_2()).when(!under, (x) => x.border_b_1()).border_color(t.accent)
      .child(div().text_size(12).font_semibold().text_color(t.foreground).child(c.title))
      .when(Boolean(c.detail), (el) => el.child(div().text_size(11.5).text_color(t.muted).child(c.detail)))
      .when(Boolean(c.copy), (el) => el.child(div().font_family(mono).text_size(11).text_color(t.dim).child(c.copy)))
      .child(h_flex().pt(2).gap(6).items_center()
        .when(Boolean(c.run), (el) => el.child(btn("confirm-run", `${c.label} ⏎`, true, (cx) => { this.confirm = null; c.run(cx); })))
        .when(Boolean(c.copy), (el) => el.child(btn("confirm-copy", "Copy", false, () => { this.confirm = null; this.copy(c.copy, c.label); })))
        .child(btn("confirm-cancel", "Cancel esc", false, () => { this.confirm = null; })));
  },

  // A section's beads: done ones newest first, the others in id order.
  // A section's beads: closed ones (merged, dropped) newest first, the others in id order.
  sectionBeads(sec) {
    const list = this.s.beads.filter((b) => b.state === sec.state || b.state === sec.also);
    const closedAt = (b) => mergedAt(b) || Math.max(0, ...b.history.map((h) => h.end ?? h.start));
    return sec.also ? list.sort((a, b) => closedAt(b) - closedAt(a)) : list.sort((a, b) => natural(a.id, b.id));
  },

  match(b) {
    const f = this.filter;
    return !f || b.id.toLowerCase().includes(f) || (b.title ?? "").toLowerCase().includes(f);
  },

  // One row open at a time: opening one closes the other; space on the open one closes it.
  toggle(id) {
    if (this.openId === id) { this.openId = null; return; }
    const b = this.s?.beads.find((x) => x.id === id);
    if (b) this.openOnly(b);
  },

  openOnly(b) {
    this.openId = b.id;
    this.answerOf(b); // its answer field, made now (in the click or key that opened it); a draft stays when it closes
  },

  // One bead in any view: selecting and opening it work the same in Board and Lanes, and its details open
  // right under it, so switching views keeps your place. A bead drawn twice opens once.
  item(t, b, g, now, key, line) {
    const first = !this.ordered.has(b.id); // a Set beside the list: includes() per row made a frame O(n²)
    if (first) { this.order.push(b.id); this.ordered.add(b.id); }
    const el = v_flex()
      .child(line.id(key).when(this.selId === b.id || this.openId === b.id, (el) => el.bg(t.hover)).hover((el) => el.bg(t.hover))
        .on_click((e, cx) => { this.selId = b.id; if (e.click_count >= 2) this.act(b, cx); else this.toggle(b.id); cx.notify(); }))
      .when(first && this.openId === b.id, (x) => x.child(this.details(t, b, g, now)))
      // The question about this bead, right under it (its details, if open): where you clicked, nothing above moves.
      .when(first && this.confirm?.bead === b.id, (x) => { this.confirmDrawn = true; return x.child(this.confirmBar(t, this.mono, true)); });
    if (first) this.drawn.set(b.id, el);
    return el;
  },

  // Select a bead and open its details (from the recap): in the Board, with Done unfolded if it is done.
  focusBead(b) {
    this.selId = b.id; this.openOnly(b); this.reveal = true;
    if (b.state === "done") this.showDone = true;
  },

  // Its steps over its own lifetime, 40 px wide, as in Lanes (a check or merge thin); a failed step is red.
  mini(t, b, now) {
    const box = div().relative().w(40).h(6).flex_none(), hs = b.history;
    if (!hs.length) return box;
    const endOf = (h) => h.end ?? (h.outcome ? h.start : now);
    const from = hs[0].start, span = Math.max(1, Math.max(...hs.map(endOf)) - from);
    return box.rounded(2).bg(t.border).children(hs.map((h) => (phaseOf(h.step).agent ? div().absolute().top(0).h(6) : div().absolute().top(2).h(2))
      .left(`${((h.start - from) / span) * 100}%`).w(`${Math.max(3, ((endOf(h) - h.start) / span) * 100)}%`)
      .bg(h.outcome && !OK.has(h.outcome) ? t.ansi1 : phaseColor(t, phaseOf(h.step)))));
  },

  // A finished epic: what it took, and the beads worth a second look.
  recap(t, mono, short, now) {
    const s = this.s, e = s.epic, c = e.beads;
    const steps = s.beads.flatMap((b) => b.history);
    if (!steps.length) return null;
    const first = Math.min(...steps.map((h) => h.start)), last = Math.max(...steps.map((h) => h.end ?? h.start));
    const agentMs = steps.filter((h) => AGENT_STEPS.has(h.step) && h.end).reduce((n, h) => n + (h.end - h.start), 0);
    const fp = s.gauges.first_pass_review, pw = s.gauges.person_waits;
    const top = (list, val, fmt) => list.map((b) => [b, val(b)]).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([b, v]) => [b, fmt(v)]);
    const lists = [
      ["costliest", top(s.beads, (b) => b.cost ?? 0, (v) => `$${v.toFixed(2)}`)],
      // Agent time, not first step to merge: a bead that sat between waves isn't slow.
      ["longest", top(s.beads, (b) => b.history.filter((h) => AGENT_STEPS.has(h.step) && h.end).reduce((n, h) => n + (h.end - h.start), 0), (v) => dur(v))],
      ["most fixes", top(s.beads, fixRounds, (v) => `↻${v}`)],
    ].filter(([, l]) => l.length);
    const line = (parts) => div().text_size(11.5).text_color(t.muted).child(parts.filter(Boolean).join(" · "));
    return v_flex().mx(10).mt(8).mb(2).p(8).gap(3).rounded(6).bg(t.hover)
      .child(h_flex().gap(6).items_center()
        .child(div().text_size(11).font_semibold().text_color(t.ansi2).child("FINISHED"))
        .child(div().text_size(11).text_color(t.dim).child(`${dur(now - last)} ago`)))
      .child(line([`${c.done} merged`, c.dropped ? `${c.dropped} dropped` : "", `$${(e.cost ?? 0).toFixed(0)}${e.unpriced ? "+?" : ""}`, `${dur(last - first)} start to end`]))
      .child(line([`agents ${dur(agentMs)}`, fp?.of ? `1st-pass ${Math.round((fp.passed / fp.of) * 100)}%` : "",
        pw?.count ? `waited for you ${pw.count}×${pw.median_seconds ? `, ~${dur(pw.median_seconds * 1000)} each` : ""}` : ""]))
      .children(lists.map(([label, l]) => h_flex().pt(2).gap(6).items_center().flex_wrap()
        .child(div().w(70).flex_none().text_size(11).text_color(t.dim).child(label))
        .children(l.map(([b, v], i) => h_flex().id(`recap-${label}-${i}`).gap(4).px(5).h(18).items_center().rounded(4).bg(t.background)
          .hover((x) => x.bg(t.border)).tooltip(b.title ?? b.id)
          .on_click((_e, cx) => { this.focusBead(b); cx.notify(); })
          .child(div().font_family(mono).text_size(11.5).text_color(t.foreground).child(short(b.id)))
          .child(div().text_size(11).text_color(t.muted).child(v))))));
  },

  // The epic past this run's beads (its epic.* events): the epic check on the epic branch, the epic's beads
  // and the follow-ups waiting for triage, and its PR to main, each with what to do about it.
  epicNext(t, mono, now) {
    const s = this.s, e = s.epic, ph = s.epicPhase ?? {}, chk = ph.check, st = ph.status, br = e.epic_branch;
    if (!chk && !st) return null;
    const sha = (h) => String(h ?? "").slice(0, 7);
    const btn = (id, label, tip, go) => div().id(id).flex_none().px(6).h(18).flex().items_center().rounded(4).border_1().border_color(t.border)
      .text_size(11).text_color(t.foreground).hover((x) => x.bg(t.border)).tooltip(tipText(tip))
      .on_click((_e, cx) => { go(cx); cx.notify(); }).child(label);
    const row = (mark, markColor, text, color, ...extra) => h_flex().gap(6).items_center().min_h(20)
      .child(div().w(12).flex_none().text_size(11.5).text_color(markColor).child(mark))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(color).child(text))
      .children(extra.filter(Boolean));
    const rows = [];
    if (chk?.state === "running") rows.push(row("●", t.ansi4, `Checking the epic branch at ${sha(chk.head)} · ${dur(now - (chk.since ?? now))}`, t.foreground));
    else if (chk?.state === "pass") rows.push(row("✓", t.ansi2, `Epic check passed at ${sha(chk.head)} · ${dur(now - (chk.at ?? now))} ago`, t.muted));
    else if (chk?.state === "fail") rows.push(row("✗", t.ansi1, `Epic check failed at ${sha(chk.head)} · ${dur(now - (chk.at ?? now))} ago`, t.ansi1,
      chk.log ? btn("epic-log", "log", chk.log, () => this.inTerminal(["less", "+G", chk.log], `epic check ${e.id}`)) : null));
    else if (chk?.state === "stopped") rows.push(row("○", t.dim, `Epic check stopped at ${sha(chk.head)} · ${dur(now - (chk.at ?? now))} ago, not checked${chk.lastPass ? ` · last passed at ${sha(chk.lastPass.head)}` : ""}`, t.muted));
    if (st) {
      const open = Math.max(0, st.total - st.closed), { triage, rest, known } = followupCounts(st);
      rows.push(row(open ? "○" : "✓", open ? t.dim : t.ansi2, `${st.closed} of ${st.total} epic beads done${open ? ` · ${open} open` : ""}`, t.muted));
      const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
      // Only open, unassigned follow-ups wait for triage (fleet 0.39's untriaged); accepted or deferred ones stay
      // open until they reach main. An agent-fleet that doesn't say which gets no triage claim.
      if (triage.length) rows.push(row("!", t.ansi3, `${n(triage.length, "follow-up waits", "follow-ups wait")} for your triage`, t.foreground,
        btn("epic-triage", "triage", `fleet triage ${e.id}: the follow-ups agents filed, and the changes they proposed. No run takes them before you decide; they don't hold the PR to main.\n${triage.join(" ")}`, () => this.inTerminal(["fleet", "triage", e.id], `triage ${e.id}`))));
      if (rest) rows.push(row("·", t.dim, `${n(rest, "open follow-up", "open follow-ups")}${known ? " (decided; listed in the PR to main)" : ""}`, t.muted));
    }
    const pr = st?.pr;
    if (pr) rows.push(row("↗", t.accent, `PR to main: ${pr.label}`, t.foreground,
      pr.url ? btn("epic-pr", "open", pr.url, (cx) => cx.open_url(pr.url)) : null));
    // No PR to main: agent-fleet opens it once every epic bead is done (follow-ups don't hold it); propose opens it now.
    else if (st || br?.unproposed) rows.push(row("→", t.dim, st && st.closed < st.total
      ? `PR to main opens once the epic's beads are done`
      : `All epic beads done; no PR to main yet`, t.muted,
      btn("epic-propose", "propose", `fleet propose ${e.id}: open the epic branch's PR to main as a draft, as you (never merges; asks first)`,
        () => this.ask(`Open the PR to main for ${e.id}?`, "fleet propose opens the epic branch's PR to main as a draft, as you. It never merges.", "Propose",
          (cx, cwd) => cx.spawn((cx) => this.runFleet(cx, ["fleet", "propose", e.id], `propose ${e.id}`, cwd)), `fleet propose ${e.id}`))));
    return v_flex().mx(10).mt(8).mb(2).p(8).gap(2).rounded(6).border_1().border_color(t.border)
      .child(div().pb(2).text_size(11).font_semibold().text_color(t.muted).child("EPIC"))
      .children(rows);
  },

  spark(t, values) {
    const max = Math.max(1, ...values);
    return h_flex().id("spark").h(14).gap(1).items_end().tooltip(`Beads merged per hour, last ${values.length} h: ${values.join(" ")}`)
      .children(values.map((v) => div().w(4).h(Math.max(1, Math.round((v / max) * 14))).rounded(1).bg(v ? t.ansi2 : t.border)));
  },

  header(t, mono, now) {
    const s = this.s, e = s.epic, wave = e.wave, counts = e.beads;
    const open = counts.total - counts.done - (counts.dropped ?? 0);
    const mph = s.gauges.merged_per_hour.map((m) => m.merged);
    const recent = mph.slice(-3), perHour = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
    const eta = perHour > 0 && open > 0 ? (open / perHour) * 3600000 : null;
    const fp = s.gauges.first_pass_review, wait = s.gauges.parked_waits[0];
    // Every wait for the person (agent-fleet.flow.snapshotgates); before it, only the current ones are known.
    const pw = s.gauges.person_waits;
    const br = e.epic_branch, chk = s.epicPhase?.check;
    // A wave doing only the epic check (no bead at work) says so, instead of looking idle.
    const checking = wave.running && chk?.state === "running" && !counts.running;
    const asking = this.confirm?.from === "wave"; // its question is open: the pill shows pressed, a click takes it back
    const wavePill = wave.running
      ? h_flex().id("wave").flex_none().gap(4).items_center().px(6).h(18).rounded(9).bg(asking ? t.border : t.hover)
        .when(asking, (x) => x.border_1().border_color(t.accent)).hover((x) => x.bg(t.border)).on_click((_e, cx) => { this.waveAction(); cx.notify(); })
        .tooltip(`Wave ${wave.number} running (pid ${wave.pid}) since ${wave.started ? new Date(wave.started).toLocaleTimeString() : "?"}${checking ? `\nChecking the epic branch at ${String(chk.head ?? "").slice(0, 7)} since ${chk.since ? new Date(chk.since).toLocaleTimeString() : "?"}` : ""}\n${asking ? "Click again or esc: don't stop it" : "Click to stop it (asks first)"}`)
        .child(div().size(6).rounded(3).bg(t.ansi2).loop("opacity", { from: 0.35, to: 1, period: 1400 }))
        .child(div().text_size(11.5).text_color(t.foreground).child(checking ? `epic check · ${dur(now - (chk.since ?? now))}`
          : wave.started ? `wave ${wave.number} · ${dur(now - wave.started)}` : `wave ${wave.number ?? ""}`.trim()))
      : h_flex().id("wave").flex_none().gap(4).items_center().px(6).h(18).rounded(9).border_1().border_color(asking ? t.accent : t.border)
        .when(asking, (x) => x.bg(t.hover))
        .hover((x) => x.bg(t.hover)).on_click((_e, cx) => { this.waveAction(); cx.notify(); })
        .tooltip(tipText(`${wave.last_ended ? `Wave ${wave.number} ended${wave.last_ended.reason ? `: ${wave.last_ended.reason}` : ""}, ${new Date(wave.last_ended.at).toLocaleString()}` : "No wave running"}\n${asking ? "Click again or esc: don't start it" : "Click to start the next one (asks first)"}`))
        .child(div().size(6).rounded(3).bg(t.dim))
        .child(div().max_w(150).truncate().text_size(11.5).text_color(t.muted).child(wave.last_ended?.at ? `${wave.last_ended.reason ?? "ended"} · ${dur(now - wave.last_ended.at)} ago` : "no wave"));
    const head = boardHeader(t, {
      mod: "fleet-board", title: e.id, open: this.picking, onTitle: (cx) => { this.togglePicker(); cx.notify(); }, onClose: (cx) => { this.closePicker(); cx.notify(); },
      menu: this.picking ? this.runPicker(t, now) : null,
      titleTip: [`Epic: ${e.id}`, e.link && `Link: ${e.link}`, e.integration && `Integration branch: ${e.integration}`, `Repository: ${this.cwd}`, "Every run: click or e (⌘← ⌘→ step through them)"].filter(Boolean).join("\n"),
      facts: [
        { id: "repo", text: this.summary(s, this.cwd).repoName, tip: this.cwd },
        e.mode && e.mode !== "real" ? { id: "mode", text: e.mode, color: t.ansi3 } : null,
        e.sandbox === false ? { id: "sandbox", text: "SANDBOX OFF", color: t.ansi1 } : null,
      ],
      buttons: [{ id: "fleet-refresh", label: "↻", tip: "Read the run again (r)", color: this.loading ? t.accent : null, pulse: this.loading, onClick: (cx) => this.refresh(cx, true) }],
    });
    return boardTop(t, head,
      h_flex().gap(6).items_center()
        .child(wavePill)
        .child(div().id("progress").flex_1().relative().h(6).rounded(3).bg(t.border)
          .tooltip(Object.entries(counts).filter(([k, v]) => k !== "total" && v).map(([k, v]) => `${k}: ${v}`).join("\n") || "no beads")
          // Dropped beads count as closed, in a dimmer shade after the merged ones.
          .when(Boolean(counts.total && counts.dropped), (el) => el.child(div().absolute().left(0).top(0).h(6).rounded(3).bg(t.muted)
            .w(`${Math.round(((counts.done + counts.dropped) / counts.total) * 100)}%`)))
          .child(div().absolute().left(0).top(0).h(6).rounded(3).bg(t.ansi2).w(`${counts.total ? Math.round((counts.done / counts.total) * 100) : 0}%`)))
        .child(div().text_size(12).text_color(t.foreground).child(`${counts.done}/${counts.total - (counts.dropped ?? 0)}`))
        .when(Boolean(counts.dropped), (el) => el.child(div().id("dropped").text_size(12).text_color(t.dim)
          .tooltip(`${counts.dropped} dropped: taken out of the epic, not counted`).child(`−${counts.dropped}`)))
        .child(div().text_size(12).text_color(t.dim).child(`$${(e.cost ?? 0).toFixed(0)}${e.unpriced ? "+?" : ""}`)),
      // Every gauge on one line (it wraps when the pane is narrow): agents at work while a wave runs, pace, you.
      // (Usage windows are left to the status bar, which reads Claude Code's own, current numbers.)
      h_flex().gap(10).items_center().flex_wrap()
        .when(Boolean(wave.running || e.workers.used), (el) => el.child(h_flex().id("workers").gap(3).items_center().tooltip(`Agents at work (implement, fix, review): ${e.workers.used} of ${e.workers.max ?? "?"}. Checks and merges don't take one.`)
          .child(div().text_size(11.5).text_color(t.dim).child("agents"))
          .children(Array.from({ length: e.workers.max ?? 0 }, (_, i) => div().size(7).rounded(2).bg(i < e.workers.used ? t.ansi4 : t.border)))))
        .when(mph.some((v) => v > 0), (el) => el.child(this.spark(t, mph))
          .child(div().id("rate").text_size(11.5).text_color(t.muted).tooltip("Merged per hour over the last 3 hours").child(`${perHour.toFixed(1)}/h`)))
        .when(eta !== null, (el) => el.child(div().id("eta").text_size(11.5).text_color(t.muted)
          .tooltip(`${open} open bead${open === 1 ? "" : "s"} ÷ ${perHour.toFixed(1)} merged per hour`).child(`ETA ~${dur(eta)}`)))
        .when(Boolean(fp && fp.of), (el) => el.child(div().id("fpr").text_size(11.5).text_color(t.muted)
          .tooltip(`Reviews that approved at the first round: ${fp.passed} of ${fp.of}`).child(`1st-pass ${Math.round((fp.passed / fp.of) * 100)}%`)))
        .when(Boolean(pw && pw.count), (el) => el.child(div().id("waits").text_size(11.5).text_color(pw.open ? t.ansi1 : t.muted)
          .tooltip(`The fleet waited for you ${pw.count} time${pw.count === 1 ? "" : "s"}: ${dur(pw.total_seconds * 1000)} summed over the beads${pw.wall_seconds ? `, ${dur(pw.wall_seconds * 1000)} of clock time` : ""}${pw.median_seconds !== null && pw.median_seconds !== undefined ? `; half your answers took under ${dur(pw.median_seconds * 1000)}` : ""}${pw.open ? `; ${pw.open} waiting now${wait?.since ? `, the longest ${dur(now - wait.since)}` : ""}` : ""}\n${Object.entries(pw.by_kind ?? {}).sort((a, b) => b[1].total_seconds - a[1].total_seconds).map(([k, v]) => `${k}: ${v.count}, ${dur(v.total_seconds * 1000)}`).join("\n")}`)
          .child(`you: ${pw.count} wait${pw.count === 1 ? "" : "s"}${pw.median_seconds !== null && pw.median_seconds !== undefined ? ` · ~${dur(pw.median_seconds * 1000)}` : ""}${pw.open ? ` · ${pw.open} now` : ""}`)))
        .when(!pw && Boolean(wait && wait.since), (el) => el.child(div().id("wait").text_size(11.5).text_color(t.ansi1)
          .tooltip(`The longest a parked bead has waited for you (${wait.bead})`).child(`you: ${dur(now - wait.since)}`)))
        .when(Boolean(br && (br.behind || br.propose || br.conflicts?.length)), (el) => el.child(div().id("branch").text_size(11.5).text_color(br.conflicts?.length ? t.ansi1 : t.dim)
          .tooltip(`Epic branch: ${br.behind ?? "?"} behind main${br.conflicts?.length ? `, would conflict in ${br.conflicts.join(", ")}` : ""}; ${br.unproposed ?? 0} parts not on main${br.propose ? `\nfleet propose ${e.id} opens the PR to main` : ""}`)
          .child([br.behind ? `↓${br.behind} main` : "", br.propose ? `${br.unproposed} to propose` : ""].filter(Boolean).join(" · ")))));
  },

  tabs(t) {
    return h_flex().px(8).pt(6).gap(2).items_center().border_b_1().border_color(t.border)
      .children(VIEWS.map((v) => div().id(`tab-${v.id}`).px(8).pb(5).text_size(12.5)
        .text_color(this.view === v.id ? t.foreground : t.dim)
        .when(this.view === v.id, (el) => el.border_b_2().border_color(t.accent))
        .hover((el) => el.text_color(t.foreground))
        .on_click((_e, cx) => { this.view = v.id; this.reveal = true; cx.notify(); })
        .child(v.label)))
      .child(div().flex_1())
      .when(Boolean(this.busy) && !this.drawn?.has(this.busy.bead), (el) => el.child(div().pb(5).px(4).text_size(11).text_color(t.accent).loop("opacity", { from: 0.4, to: 1, period: 900 }).child(`${this.busy.text}${this.busy.bead ? ` ${this.busy.bead}` : ""}…`)))
      .when(this.loading, (el) => el.child(div().pb(5).px(4).text_size(11).text_color(t.dim).loop("opacity", { from: 0.3, to: 1, period: 900 }).child("●")))
      .when(this.view === "lanes", (el) => {
        // Pinned in the past: the window's times and × (back to now); else the span up to now ([ ] or a click).
        const pinned = this.win?.key === this.runKey() && this.lanesAt;
        return el.child(div().id("span").pb(5).px(4).text_size(11.5).text_color(pinned ? t.accent : t.muted)
          .hover((x) => x.text_color(t.foreground)).tooltip(pinned ? "Back to now: click or esc" : "Time shown: [ ] or click")
          .on_click((_e, cx) => { if (pinned) this.unpin(); else this.zoom(SPANS[(SPANS.indexOf(this.span) + 1) % SPANS.length]); cx.notify(); })
          .child(pinned ? `${this.win.wave !== null && this.win.wave !== undefined ? `w${this.win.wave} · ` : ""}${hm(this.lanesAt.from)}–${hm(this.lanesAt.to)} ×` : spanLabel(this.span)));
      });
  },

  // What the row adds to its section: the step it is at, the gate, what it waits for. Nothing for queued and
  // done beads (the section and the glyph say it).
  tag(b, short, t) {
    const step = `${b.step ?? "?"}${b.round ? ` ${b.round}` : ""}`;
    return {
      running: [step, t.foreground, true],
      parked: [(b.gate?.shown ?? b.gate?.kind) === "other" ? "stuck" : b.gate?.shown ?? b.gate?.kind ?? "waits for you", t.ansi1, true],
      interrupted: [`stopped in ${step}`, t.ansi3],
      "waiting for CI": [b.pr ? `PR #${b.pr}` : "CI", t.ansi2],
      blocked: [`after ${b.blockers.map(short).join(", ") || "?"}`, t.dim],
      dropped: [b.parked || "taken back", t.dim],
      queued: b.went ? [`${b.went} · next wave`, t.accent] : null,
    }[b.state] ?? null;
  },

  // The bead's id as every view draws it: monospace, the critical path in the accent colour.
  idCell(t, b, g, short, mono) {
    return div().min_w(0).truncate().font_family(mono).text_size(ROW.id)
      .text_color(g.critical.has(b.id) ? t.accent : ["done", "dropped"].includes(b.state) ? t.muted : t.foreground).child(short(b.id));
  },

  // A title's colour by state, the same in every view: what's live is bright, what's over is dim.
  titleColor(t, b) {
    return { running: t.foreground, parked: t.foreground, interrupted: t.muted, "waiting for CI": t.muted, queued: t.muted }[b.state] ?? t.dim;
  },

  glyph(t, b) {
    const [g, c] = {
      parked: [b.gate?.kind === "questions" ? "?" : "!", t.ansi1], running: ["●", t.ansi4], interrupted: ["◌", t.ansi3],
      "waiting for CI": ["◷", t.ansi2], queued: ["○", t.muted], blocked: ["⧗", t.dim], dropped: ["–", t.dim], done: ["✓", t.ansi2],
    }[b.state] ?? ["·", t.dim];
    return div().w(12).flex_none().text_size(ROW.id).text_color(c).child(g);
  },

  // A row's time: how long its step has run, how long it has waited for you, or how long ago it merged
  // (the Done heading says "ago").
  timeOf(t, b, now) {
    return b.state === "parked" && b.gate?.since ? [dur(now - b.gate.since), t.ansi1]
      : b.state === "running" && b.step_started ? [dur(now - b.step_started), t.foreground]
      : b.state === "done" && mergedAt(b) ? [dur(now - mergedAt(b)), t.dim] : ["", t.dim];
  },

  // The right-hand columns' widths for the rows on screen: each as wide as its widest value (about 7 px a
  // character), none for a column empty in every row, and no phase bar in a narrow pane, so the title keeps
  // the room. The same widths in every row keep the columns lined up.
  columns(list, now) {
    const t = theme(), w = (texts) => Math.ceil(Math.max(0, ...texts.map((x) => x.length)) * 7);
    const reach = (b) => this.graphMemo?.reach.get(b.id) ?? 0;
    this.cols = {
      reach: list.some((b) => reach(b) > 1) ? 30 : 0,
      loops: list.some((b) => fixRounds(b) > 0) ? 24 : 0,
      bar: (this.width ?? 999) >= 480 && list.some((b) => b.history.length) ? 40 : 0,
      time: w(list.map((b) => this.timeOf(t, b, now)[0])),
      cost: w(list.map((b) => (b.cost ? `$${b.cost.toFixed(2)}${b.unpriced ? "+?" : ""}` : ""))),
    };
  },

  // The right-hand columns: what it unblocks, fix rounds, the phase bar, the time, the cost, in the widths columns() set.
  meta(t, b, now) {
    const c = this.cols ?? { reach: 0, loops: 24, bar: 40, time: 48, cost: 48 };
    const col = (w, el) => h_flex().w(w).flex_none().justify_end().items_center().when(Boolean(el), (x) => x.child(el));
    const loops = fixRounds(b), [time, timeColor] = this.timeOf(t, b, now), reach = this.graphMemo?.reach.get(b.id) ?? 0;
    return h_flex().flex_none().gap(6).items_center()
      // What waits on it: worth knowing for a running or queued bead (more than one, or it's just noise).
      .when(Boolean(c.reach), (el) => el.child(col(c.reach, reach > 1 ? div().id(`reach-${b.id}`).px(4).rounded(3).bg(t.border)
        .text_size(10.5).text_color(t.foreground).tooltip(`Unblocks ${reach} open beads`).child(`⇣${reach}`) : null)))
      .when(c.loops > 0, (el) => el.child(col(c.loops, loops > 0 ? div().id(`loops-${b.id}`).text_size(ROW.small).text_color(t.ansi9 ?? t.ansi3)
        .tooltip(`${loops} fix round${loops === 1 ? "" : "s"}${fixSessions(b) > loops ? ` (${fixSessions(b)} sessions)` : ""}: a check, the review or CI sent it back`).child(`↻${loops}`) : null)))
      .when(c.bar > 0, (el) => el.child(this.mini(t, b, now)))
      .when(c.time > 0, (el) => el.child(col(c.time, time ? div().id(`time-${b.id}`).text_size(ROW.small).text_color(timeColor).tooltip(b.state === "parked" ? `Waiting for you for ${time}` : b.state === "running" ? `In this step for ${time}` : `Merged ${time} ago`).child(time) : null)))
      .when(c.cost > 0, (el) => el.child(col(c.cost, b.cost ? div().text_size(ROW.small).text_color(t.dim).child(`$${b.cost.toFixed(2)}${b.unpriced ? "+?" : ""}`) : null)));
  },

  // A running bead's context window (in its details).
  ctx(t, b) {
    if (typeof b.context !== "number" || b.state !== "running") return null;
    const p = b.context <= 1 ? Math.round(b.context * 100) : Math.round(b.context);
    const color = p >= 80 ? t.ansi1 : p >= 60 ? t.ansi3 : t.dim;
    return h_flex().id(`ctx-${b.id}`).gap(3).items_center().tooltip(`Context ${p}% used`)
      .child(div().relative().w(14).h(4).rounded(2).bg(t.border)
        .child(div().absolute().left(0).top(0).h(4).rounded(2).bg(color).w(Math.max(1, Math.round((p / 100) * 14)))))
      .child(div().text_size(11).text_color(color).child(`${p}%`));
  },

  // Under an open row (the row shows the whole title): the bead's facts, its gate, its steps, its waits, actions.
  details(t, b, g, now) {
    const tl = timeline(b, now), acts = this.actions(b);
    const small = (text, color = t.dim) => div().text_size(11.5).text_color(color).child(text);
    // 1. Where the time went: wall time = agents + checks + queued (overlaps aside); then what it changed.
    const fixes = tl ? tl.rounds.filter((r) => r.round > 0).length : 0;
    const summary = h_flex().gap(6).flex_wrap().items_center()
      .when(Boolean(tl), (el) => el
        .child(h_flex().id(`sum-${b.id}`).gap(6).items_center().tooltip(`${hm(tl.from)} to ${tl.live ? "now" : hm(tl.to)}`)
          .child(small(dur(tl.wall), t.foreground)).child(small(b.state === "done" ? `start to merge, merged at ${hm(tl.to)}` : tl.live ? "so far" : "start to last step")))
        .when(tl.agents >= 1000, (x) => x.child(small("·")).child(h_flex().id(`sa-${b.id}`).gap(4).tooltip("Agent steps: implement, fix, review").child(small("agents")).child(small(dur(tl.agents), t.muted))))
        .when(tl.checks >= 1000, (x) => x.child(small("·")).child(h_flex().id(`sc-${b.id}`).gap(4).tooltip("Checks, CI and merges").child(small("checks")).child(small(dur(tl.checks), t.muted))))
        .when(tl.queued >= 60000, (x) => x.child(small("·")).child(h_flex().id(`sq-${b.id}`).gap(4).tooltip("Between steps: waiting for a worker, the next wave or you")
          .child(small("queued")).child(small(dur(tl.queued), tl.queued > tl.wall / 2 ? t.ansi3 ?? t.muted : t.muted))))
        .when(fixes > 0, (x) => x.child(small("·")).child(small(`↻${fixes}`, t.ansi1))))
      .when(Boolean(b.cost), (el) => el.child(small("·")).child(small(`$${(b.cost ?? 0).toFixed(2)}`, t.muted)))
      .when(Boolean(b.diff && (b.diff.added || b.diff.deleted)), (el) => el.child(small("·"))
        .child(small(`+${b.diff.added}`, t.ansi2)).child(small(`−${b.diff.deleted}`, t.ansi1)))
      .when(g.reach.get(b.id) > 0, (el) => el.child(small("·")).child(small(`unblocks ${g.reach.get(b.id)}`, t.accent)))
      .when(Boolean(b.risk), (el) => el.child(small("·")).child(small(`risk:${b.risk}`, b.risk === "high" ? t.ansi1 : t.dim)))
      .when(Boolean(b.kind && b.kind !== "code"), (el) => el.child(small("·")).child(small(b.kind)))
      .when(Boolean(b.link), (el) => el.child(small("·")).child(small(b.link)))
      .when(Boolean(this.ctx(t, b)), (el) => el.child(small("·")).child(h_flex().gap(4).items_center().child(small("context")).child(this.ctx(t, b))));
    return v_flex().pl(28).pr(10).pt(2).pb(8).gap(6).bg(t.hover)
      .child(summary)
      .when(Boolean(b.gate), (el) => el.child(this.gateBlock(t, b)))
      .when(Boolean(tl), (el) => el.child(this.lifeline(t, b, tl)).child(this.stepTable(t, b, tl)))
      // The times it waited for you, and how each ended.
      .when(b.gates.length > (b.gate ? 1 : 0), (el) => el.child(v_flex().pt(4).gap(2)
        .child(div().text_size(11).text_color(t.dim).child("WAITED FOR YOU"))
        .children(b.gates.map((w, i) => h_flex().id(`gw-${b.id}-${i}`).gap(6).items_center().tooltip(tipText(w.reason ?? ""))
          .child(div().w(14).h(2).rounded(1).flex_none().bg(t.ansi1))
          .child(div().w(80).truncate().text_size(11.5).text_color(t.muted).child(w.shown ?? w.kind))
          .child(div().w(44).text_size(11.5).text_color(t.foreground).child(dur((w.resolved ?? now) - w.opened)))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(w.resolved ? t.dim : t.ansi1).child(w.resolved ? (w.how ?? "answered") : "waiting"))))))
      .when(acts.length > 0, (el) => el.child(h_flex().pt(2).gap(4).flex_wrap().children(acts.map((a, i) => div().id(`act-${b.id}-${i}`).px(7).h(20).rounded(5)
        .border_1().border_color(t.border).text_size(11.5).text_color(t.foreground).flex().items_center().gap(4)
        .when(i === 0 && b.state === "parked" && !asks(b) && a.label === "resume", (x) => x.bg(t.accent).border_color(t.accent).text_color(t.background).font_semibold())
        .hover((x) => x.bg(t.border)).tooltip(a.tip)
        .on_click((_e, cx) => { a.go(); cx.notify(); })
        .when(Boolean(a.key), (x) => x.child(div().text_size(10.5).text_color(t.dim).child(a.key)))
        .child(a.label)))));
  },

  // 2. The bead's life to scale: each step as in Lanes (red where it failed, pulsing while it runs),
  // the time between steps as a hairline; start and end times underneath.
  lifeline(t, b, tl) {
    const bar = h_flex().id(`life-${b.id}`).w_full().h(10).items_center().children(tl.parts.map((p, i) => {
      if (p.gap) return div().id(`lg-${b.id}-${i}`).flex_grow(p.ms).flex_basis(0).min_w(4).h(10).flex().items_center()
        .tooltip(`${dur(p.ms)} ${p.waves ? `between waves ${p.waves[0]} and ${p.waves[1]}` : "queued: waiting for a worker"}\n${hm(p.from)} to ${hm(p.to)}`)
        .child(div().w_full().h(1).bg(t.border));
      const h = p.step, bad = !h.live && h.outcome && !OK.has(h.outcome);
      const ph = phaseOf(h.step);
      return div().id(`ls-${b.id}-${i}`).flex_grow(Math.max(p.ms, 1)).flex_basis(0).min_w(3).h(ph.agent ? 8 : 3).rounded(2)
        .bg(bad ? t.ansi1 : phaseColor(t, ph)).border_r_1().border_color(t.hover)
        .when(Boolean(h.live), (el) => el.loop("opacity", { from: 0.45, to: 1, period: 1100 }))
        .tooltip(`${h.step}${h.round ? `, fix ${h.round}` : ""}, wave ${h.wave}: ${dur(p.ms)}, ${h.live ? "running" : h.outcome ?? "stopped"}${h.model ? `\n${h.runtime ?? ""}/${h.model}` : ""}${h.cost ? `  $${h.cost.toFixed(2)}` : ""}\n${hm(h.start)} to ${h.live ? "now" : hm(h.to)}`);
    }));
    return v_flex().gap(1).child(bar)
      .child(h_flex().justify_between().child(div().text_size(10.5).text_color(t.dim).child(hm(tl.from)))
        .child(div().text_size(10.5).text_color(t.dim).child(tl.live ? "now" : hm(tl.to))));
  },

  // 3. Step by step, under a heading per round (the build, then each fix round): when each step started, how
  // long it took and what came of it, in words; a wait of a minute or more between steps gets a row of its own.
  stepTable(t, b, tl) {
    const all = tl.rounds.flatMap((r) => r.steps), keep = tl.rounds.slice(-6), earlier = tl.rounds.length - keep.length;
    const result = (x, i) => {
      if (x.live) return ["running", t.ansi4];
      const o = x.outcome ?? "";
      if (o.startsWith("stopped")) return [o.includes(":") ? `stopped: ${o.split(":").slice(1).join(":").trim()}` : "stopped", t.ansi1];
      if (x.step === "merge") return [o === "merged" || !o ? "merged" : o, OK.has(o) || !o ? t.ansi2 : t.ansi1];
      if (x.step === "review" && o === "done") {
        const next = all[i + 1];
        return next?.step === "fix" ? ["asked for changes", t.ansi3 ?? t.ansi1] : next ? ["approved", t.muted] : ["done", t.muted];
      }
      if (o === "pass") return ["passed", t.muted];
      if (o === "done") return ["done", t.dim];
      const words = { "no-handoff": "gave no handoff file", fail: "failed", error: "failed" };
      return [words[o] ?? (o.replace(/[-_]/g, " ") || "?"), OK.has(o) ? t.muted : t.ansi1];
    };
    const cell = (w, text, color, right = false) => div().w(w).flex_none().text_size(11.5).text_color(color).when(right, (x) => x.text_right()).child(text);
    const rows = [];
    if (earlier > 0) rows.push(div().text_size(11).text_color(t.dim).child(`${earlier} earlier round${earlier > 1 ? "s" : ""}`));
    let prevEnd = null, prevWave = null;
    for (const r of keep) {
      const waves = [...new Set(r.steps.map((x) => x.wave))];
      rows.push(h_flex().pt(rows.length ? 4 : 0).gap(8).items_center()
        .child(div().text_size(10.5).text_color(t.dim).child(r.round ? `FIX ROUND ${r.round}` : "BUILD"))
        .child(div().flex_1().h(1).bg(t.border))
        .child(div().text_size(10.5).text_color(t.dim).child(`wave ${waves.length > 1 ? `${waves[0]}–${waves.at(-1)}` : waves[0]}${r.cost > 0 ? ` · $${r.cost.toFixed(2)}` : ""}`)));
      let seenReview = false;
      for (const x of r.steps) {
        const i = all.indexOf(x);
        if (prevEnd !== null && x.start - prevEnd >= 60000) {
          rows.push(h_flex().gap(8).items_center()
            .child(cell(40, "", t.dim)).child(cell(84, "waited", t.dim)).child(cell(40, dur(x.start - prevEnd), t.dim, true))
            .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(prevWave !== x.wave ? `until wave ${x.wave}` : "for a worker")));
        }
        const recheck = x.step === "check" && seenReview;
        if (x.step === "review") seenReview = true;
        const [text, color] = result(x, i);
        rows.push(h_flex().id(`st-${b.id}-${i}`).gap(8).items_center()
          .tooltip(`${x.step}${recheck ? ": checked again after a rebase onto the newer epic branch" : ""}${x.model ? `\n${x.runtime ?? ""}/${x.model}` : ""}${x.cost ? `  $${x.cost.toFixed(2)}` : ""}`)
          .child(cell(40, hm(x.start), t.dim))
          .child(h_flex().w(84).flex_none().gap(5).items_center().child(swatch(t, phaseOf(x.step)).w(6))
            .child(div().text_size(11.5).text_color(t.foreground).child(recheck ? "re-check" : x.step)))
          .child(cell(40, x.step === "merge" ? "" : dur(x.to - x.start), t.muted, true))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(color).child(text)));
        prevEnd = x.to; prevWave = x.wave;
      }
    }
    return v_flex().gap(2).children(rows);
  },

  // A parked bead's gate in its details: the kind, then each question with the agent's options as choices
  // (its proposal chosen to start with), a field for your own answer or a note, and Send answer.
  gateBlock(t, b) {
    const qs = b.gate.questions ?? [], a = this.draft(b);
    const box = v_flex().gap(4); // the gate's kind is the row's tag already (limit, questions)
    if (!qs.length) box.child(div().id(`why-${b.id}`).text_size(12).text_color(t.foreground).tooltip(tipText(b.gate.reason ?? "")).child(gateText(b.gate)));
    qs.forEach((q, i) => {
      const text = typeof q === "string" ? q : q.text ?? q.question ?? JSON.stringify(q);
      box.child(div().pt(2).text_size(12).text_color(t.foreground).child(`${qs.length > 1 ? `${i + 1}. ` : ""}${text}`));
      (q.options ?? []).forEach((o, j) => {
        const on = a?.picks[i] === j;
        box.child(h_flex().id(`opt-${b.id}-${i}-${j}`).gap(6).items_start().px(6).py(3).rounded(5)
          .when(on, (el) => el.bg(t.border)).hover((el) => el.bg(t.border))
          .on_click((_e, cx) => { const ans = this.answerOf(b); if (ans) ans.picks[i] = ans.picks[i] === j ? null : j; cx.notify(); })
          .child(div().flex_none().w(14).text_size(12).text_color(on ? t.accent : t.dim).child(on ? "●" : "○"))
          .child(div().flex_1().min_w(0).text_size(11.5).text_color(on ? t.foreground : t.muted).child(o))
          .when(o === q.default, (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child("proposed"))));
      });
    });
    if (!this.answerable(b)) return box;
    // Nothing was asked (a step failed): resume is the way on (the first action); a note for the agent is optional.
    if (!qs.length && !a?.noting) return box.child(div().id(`note-${b.id}`).text_size(11.5).text_color(t.dim).hover((x) => x.text_color(t.foreground))
      .tooltip("fleet answer: the agent reads your note when it resumes").on_click((_e, cx) => { const n = this.answerOf(b); if (n) { n.noting = true; this.focusSoon(n.area, cx); } cx.notify(); })
      .child("+ resume with a note for the agent"));
    if (!a) return box.child(div().id(`ans-${b.id}`).px(10).h(24).rounded(5).border_1().border_color(t.border).text_size(11.5).text_color(t.foreground).flex().items_center()
      .gap(4).hover((x) => x.bg(t.border)).on_click((_e, cx) => { this.focusSoon(this.answerOf(b)?.area, cx); cx.notify(); })
      .child(div().text_size(10.5).text_color(t.dim).child("p")).child("Answer here"));
    return box
      .child(Textarea.new(a.area).w_full().px(6).py(4).rounded(5).border_1().border_color(this.typing ? t.accent : t.border).bg(t.background).text_size(12).text_color(t.foreground))
      .child(h_flex().gap(8).items_center()
        .child(div().id(`send-${b.id}`).px(12).h(24).rounded(5).bg(a.sending ? t.border : t.accent).text_size(11.5).font_semibold().text_color(t.background).flex().items_center()
          .tooltip(`fleet answer ${b.id} with:\n${this.answerText(b, a) || "(nothing chosen yet)"}`)
          .when(!a.sending, (el) => el.on_click((_e, cx) => { cx.spawn((cx) => this.sendAnswer(cx, b)); }))
          .child(a.sending ? "Sending…" : qs.length ? "Send answer" : "Resume with this note"))
        .child(div().text_size(10.5).text_color(t.dim).child("the next wave goes on with it")));
  },

  // One line per bead: state, id, title, what the row adds to its section, time and cost. A parked bead adds
  // the gate's reason underneath (that is what you need to act), a bead waiting on GitHub what it waits for; an
  // open bead shows its whole title.
  row(t, b, mono, g, short, now) {
    const open = this.openId === b.id, tag = this.tag(b, short, t);
    const titleColor = this.titleColor(t, b);
    const doing = this.busyOn(b.id); // a command you ran on it: what runs, until the run is read again
    const reason = b.state === "parked" && !open && !doing ? gateText(b.gate) : ""; // open, the details say it
    // Waiting on GitHub: what for (fleet 0.38's waiting_on: checks running, its turn, the epic branch red, ...).
    const waits = b.state === "waiting for CI" ? b.waiting_on ?? "" : "";
    // Every cell sits in a first line of ROW.h, centred, open or not. Open, the title leaves that line for one of
    // its own underneath, from under the id to the right edge, so a long title wraps over the whole width (not the middle column).
    const cell = (el) => h_flex().h(ROW.h).flex_none().items_center().child(el);
    const line = v_flex().px(10)
      .child(h_flex().min_h(ROW.h).gap(6).items_start()
        .child(cell(this.glyph(t, b)))
        .child(cell(this.idCell(t, b, g, short, mono).w(this.idW).flex_none()))
        .child(h_flex().flex_1().min_w(0).h(ROW.h).items_center()
          .when(!open, (el) => el.child(div().flex_1().min_w(0).truncate().text_size(ROW.text).text_color(titleColor).child(b.title))))
        .when(Boolean(tag), (el) => el.child(cell(div().max_w(150).truncate().text_size(ROW.small).text_color(tag[1]).when(Boolean(tag[2]), (x) => x.font_semibold()).child(tag[0]))))
        .child(cell(this.meta(t, b, now))))
      .when(open, (el) => el.child(div().pl(18).pb(4).text_size(ROW.text).text_color(titleColor).child(b.title)))
      .when(Boolean(doing), (el) => el.child(div().pl(18).pb(4).text_size(ROW.small).text_color(t.accent).loop("opacity", { from: 0.4, to: 1, period: 900 }).child(`◷ ${doing}…`)))
      .when(Boolean(reason), (el) => el.child(div().pl(18).pb(4).text_size(ROW.small).text_color(t.ansi1).when(!open, (x) => x.truncate()).child(reason)))
      .when(Boolean(waits), (el) => el.child(div().pl(18).pb(4).text_size(ROW.small).text_color(t.muted).when(!open, (x) => x.truncate()).child(waits)));
    return this.item(t, b, g, now, `row-${b.id}`, line);
  },

  board(t, mono, g, short, now) {
    const out = [], c = this.s.epic.beads, closed = c.total && c.total === c.done + (c.dropped ?? 0);
    if (!this.filter && closed && !this.s.epic.wave.running) {
      const r = this.recap(t, mono, short, now);
      if (r) out.push(r);
    }
    // Every bead of the run closed: what the epic itself is at, and what's left for you.
    if (!this.filter && closed) { const x = this.epicNext(t, mono, now); if (x) out.push(x); }
    // The columns fit the rows drawn: every section's beads, Done only while unfolded.
    this.columns(SECTIONS.flatMap((sec) => (sec.fold && !this.showDone && !this.filter ? [] : this.sectionBeads(sec).filter((b) => this.match(b)))), now);
    // The critical path, once, where the waiting starts: above Queued (else Blocked, else Done).
    let pathShown = Boolean(this.filter) || !g.chain.length;
    for (const sec of SECTIONS) {
      const list = this.sectionBeads(sec).filter((b) => this.match(b));
      const dropped = sec.also ? list.filter((b) => b.state === sec.also).length : 0;
      if (!list.length) continue;
      if (!pathShown && ["queued", "blocked", "done"].includes(sec.state)) { pathShown = true; out.push(this.criticalPath(t, mono, g, short)); }
      out.push(h_flex().id(`sec-${sec.state}`).px(10).pt(8).pb(2).gap(6).items_center()
        .when(Boolean(sec.fold), (el) => el.hover((x) => x.bg(t.hover)).on_click((_e, cx) => { this.showDone = !this.showDone; cx.notify(); }))
        .child(div().text_size(11).font_semibold().text_color(sec.state === "parked" ? t.ansi1 : t.dim).child(sec.label.toUpperCase()))
        .child(div().text_size(11).text_color(t.dim).child(dropped ? `${list.length - dropped} · ${dropped} dropped` : String(list.length)))
        .when(Boolean(sec.fold), (el) => el.child(div().text_size(11).text_color(t.dim).child(this.showDone ? "▾ 0" : "▸ 0"))));
      if (sec.fold && !this.showDone && !this.filter) continue;
      for (const b of list) out.push(this.row(t, b, mono, g, short, now));
    }
    if (!pathShown) out.push(this.criticalPath(t, mono, g, short));
    if (!out.length) out.push(div().p(10).text_size(12).text_color(t.dim).child(this.filter ? `No bead matches “${this.filter}”.` : "The run holds no beads yet."));
    return out;
  },

  // The longest chain of open beads each waiting for the one before: they merge one after another, so it bounds
  // when the epic can finish. One dim line (its ids also show in the accent colour in every row).
  criticalPath(t, mono, g, short) {
    const mph = this.s.gauges.merged_per_hour.map((m) => m.merged).slice(-3);
    const perHour = mph.length ? mph.reduce((a, b) => a + b, 0) / mph.length : 0;
    const n = g.chain.length;
    return h_flex().id("critical-path").px(10).pt(8).pb(2).gap(6).items_center()
      .tooltip(`The longest chain of open beads, each waiting for the one before: ${n} merges in a row${perHour > 0 ? `, at least ~${dur((n / perHour) * 3600000)} at the current pace` : ""}`)
      .child(div().flex_none().text_size(11).font_semibold().text_color(t.accent).child("CRITICAL PATH"))
      .child(div().flex_1().min_w(0).truncate().font_family(mono).text_size(11).text_color(t.dim).child(g.chain.map(short).join(" → ")))
      .when(perHour > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`~${dur((n / perHour) * 3600000)}`)));
  },

  lanes(t, mono, g, short, now) {
    const s = this.s;
    // Live: up to now. Otherwise up to the last thing that happened, so a finished run still shows its end.
    const live = s.epic.wave.running || s.beads.some((b) => b.state === "running");
    const starts = s.beads.flatMap((b) => b.history.map((h) => h.start)).filter((x) => Number.isFinite(x) && x > 0);
    const lastEnd = Math.max(0, ...s.beads.flatMap((b) => b.history.map((h) => h.end ?? h.start)));
    const head = live || !lastEnd ? now : lastEnd;
    const first = starts.length ? Math.min(...starts) : head - 3600000;
    // A window pinned in the past (a drag on the axis, a wave, < > { } or ⌘-scroll), else the last [ ] span up to head.
    const win = this.win?.key === this.runKey() ? clampWindow(this.win, first, head) : null;
    // "fit": from the run's first step, with a little room on the left; at least ten minutes.
    const span = win ? win.to - win.from : this.span === "fit" ? Math.max(600000, starts.length ? (head - first) * 1.02 : 3600000) : this.span;
    const to = win ? win.to : head, from = to - span;
    const ranges = waveRanges(s.beads, head);
    this.lanesAt = { from, to, span, head, first, ranges }; // what the keys and the mouse move from
    const endOf = (h) => h.end ?? (h.outcome ? h.start : head);
    const pos = (ms) => `${Math.max(0, Math.min(100, ((ms - from) / span) * 100))}%`;
    const width = (a, b) => `${Math.max(0.5, ((Math.min(b, to) - Math.max(a, from)) / span) * 100)}%`;
    const inWindow = (h) => endOf(h) > from && h.start < to;
    const shown = s.beads.filter((b) => this.match(b) && b.history.some(inWindow));
    const order = { parked: 0, running: 1, interrupted: 2, "waiting for CI": 3 };
    const firstIn = (b) => Math.min(...b.history.filter(inWindow).map((h) => h.start));
    shown.sort((a, b) => (order[a.state] ?? 4) - (order[b.state] ?? 4) || firstIn(a) - firstIn(b));
    // Where each wave began, inside the window.
    const marks = [...ranges].map(([w, r]) => [w, r.from]).filter(([, at]) => at > from && at < to).sort((a, b) => a[1] - b[1]);
    // Labels only where they don't run into the one before (about 6% of the width apart).
    let lastLabel = -Infinity;
    const labelled = marks.filter(([, at]) => { const x = ((at - from) / span) * 100; if (x - lastLabel < 6) return false; lastLabel = x; return true; });
    // Waves are marked on the axis only (a tick and, where there is room, its number): lines through every
    // row were noise once an epic had run thirty waves.
    const ticks = marks.map(([, at]) => div().absolute().top(26).h(5).w(1).bg(t.muted).left(pos(at)));
    const quarter = span / 4;
    // Pinned: clock times (the window's day on the left); else how long ago, up to now or the run's end.
    // (toLocaleString's options aren't honoured here: the day is spelled out by hand.)
    const day = (ms) => { const d = new Date(ms); return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]} ${d.getDate()}`; };
    const clock = (ms) => (span >= 2 * 86400000 ? `${day(ms)} ${hm(ms)}` : span < 600000 ? new Date(ms).toTimeString().slice(0, 8) : hm(ms));
    const zoomed = this.win?.wave ?? null, zr = zoomed !== null ? ranges.get(zoomed) : null;
    const sel = this.sel ? [Math.min(this.sel.a, this.sel.b), Math.max(this.sel.a, this.sel.b)] : null;
    const axis = h_flex().px(10).pt(8).pb(2).gap(6)
      .child(div().w(this.idW + 18).flex_none().text_size(10.5).text_color(t.dim)
        .child(win ? day(from) : live ? "" : new Date(to).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })))
      // Drag across it to look at that time; a wave's number shows that wave; a double-click goes back to now.
      .child(div().id("axis").flex_1().relative().h(31).cursor_crosshair()
        .tooltip(win ? "Drag to zoom in · < > waves · { } move · [ ] zoom · esc or double-click: back to now" : "Drag to zoom into a time · click a wave · < > waves · ⌘-scroll zooms")
        .on_mouse_down("left", (e, cx) => {
          this.keepKeys();
          if (e.click_count >= 2) { this.unpin(); cx.notify(); return; }
          if (!e.bounds || !e.local_position) return;
          const f = Math.max(0, Math.min(1, e.local_position.x / e.bounds.width));
          this.sel = { a: f, b: f, x: e.bounds.x, w: e.bounds.width }; cx.notify();
        })
        .on_scroll_wheel((e, cx) => this.wheelLanes(e, cx))
        .on_pinch((e, cx) => this.pinchLanes(e, cx))
        .when(Boolean(zr), (el) => el.child(div().absolute().top(12).h(19).rounded(2).bg(t.hover).left(pos(zr.from)).w(width(zr.from, zr.to))))
        .when(Boolean(sel), (el) => el.child(div().absolute().top(0).h(31).rounded(2).bg(t.accent).opacity(0.25)
          .left(`${sel[0] * 100}%`).w(`${Math.max(0.3, (sel[1] - sel[0]) * 100)}%`)))
        .children([4, 3, 2, 1, 0].map((k, i) => (k ? div().absolute().left(`${i * 25}%`) : div().absolute().right(0))
          .top(0).text_size(10.5).text_color(t.dim).child(win ? clock(to - k * quarter) : k ? `-${dur(k * quarter)}` : live ? "now" : "end")))
        .children(ticks)
        .children(labelled.map(([w, at]) => div().id(`wave-${w}`).absolute().top(12).px(2).rounded(2).text_size(10).cursor_pointer()
          .text_color(w === zoomed ? t.foreground : t.dim).hover((x) => x.text_color(t.foreground).bg(t.hover)).left(pos(at))
          .tooltip(`Wave ${w}: ${hm(ranges.get(w).from)}–${hm(ranges.get(w).to)}, ${dur(ranges.get(w).to - ranges.get(w).from)} · click to zoom in`)
          .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.keepKeys(); this.zoomWave(w); cx.notify(); })
          .child(`w${w}`))));
    // How many steps ran at once: the fleet's parallelism.
    const buckets = 48, max = Math.max(1, s.epic.workers.max ?? 1);
    const conc = Array.from({ length: buckets }, (_, k) => {
      const at = from + (k + 0.5) * (span / buckets);
      return shown.reduce((n, b) => n + (b.history.some((h) => AGENT_STEPS.has(h.step) && h.start <= at && endOf(h) > at) ? 1 : 0), 0);
    });
    const concRow = h_flex().id("conc").px(10).pb(4).gap(6).items_end().tooltip(`Agents at work, of ${max}. Checks and merges don't take one.`)
      .child(div().w(this.idW + 18).flex_none().text_size(10.5).text_color(t.dim).child("busy"))
      .child(h_flex().flex_1().h(16).gap(1).items_end()
        .children(conc.map((n) => div().flex_1().h(Math.max(1, Math.min(16, Math.round((n / max) * 16)))).rounded(1).bg(n >= max ? t.ansi4 : n ? t.muted : t.border))));
    const rows = shown.map((b) => this.item(t, b, g, now, `lane-${b.id}`, h_flex().px(10).h(ROW.h).gap(6).items_center()
      .child(this.glyph(t, b))
      .child(this.idCell(t, b, g, short, mono).w(this.idW).flex_none())
      // The bar's row, the full height of the line, so ⌘-scroll and a sideways swipe reach it between the bars.
      .child(div().flex_1().h_full().flex().items_center().on_scroll_wheel((e, cx) => this.wheelLanes(e, cx)).on_pinch((e, cx) => this.pinchLanes(e, cx))
        .child(div().w_full().relative().h(12)
        .children(b.history.filter(inWindow).map((h, i) => {
          const running = h.end === null && !h.outcome, failed = !running && !OK.has(h.outcome);
          const bar = shaped(div().id(`seg-${b.id}-${i}`).absolute().left(pos(h.start)).w(width(h.start, endOf(h))), t, h.step)
            .tooltip(`${h.step}${h.round ? ` ${h.round}` : ""} (wave ${h.wave}): ${running ? "running" : h.outcome}, ${dur(endOf(h) - h.start)}${h.cost ? `, $${h.cost.toFixed(2)}` : ""}`);
          return running && b.state === "running" ? bar.loop("opacity", { from: 0.45, to: 1, period: 1100 }) : bar;
        }))
        // A step that failed or stopped: a red tick at its end, taller than any bar.
        .children(b.history.filter((h) => inWindow(h) && h.outcome && !OK.has(h.outcome) && endOf(h) <= to).map((h) =>
          div().absolute().top(0).h(12).w(2).rounded(1).bg(t.ansi1).left(pos(endOf(h)))))
        .when(b.state === "waiting for CI", (el) => {
          const at = b.history.filter((h) => h.step === "merge").at(-1)?.start ?? b.history.at(-1)?.end;
          return at && at < to ? el.child(shaped(div().absolute().left(pos(at)).w(width(at, head)), t, "merge").loop("opacity", { from: 0.35, to: 1, period: 1400 })) : el;
        })
        // Every wait for you: from the gate opening to your answer (or to now while it waits).
        .children(b.gates.filter((w) => (w.resolved ?? head) > from && w.opened < to).map((w, i) =>
          div().id(`wait-${b.id}-${i}`).absolute().top(5).h(2).rounded(1).bg(t.ansi1).left(pos(w.opened)).w(width(w.opened, w.resolved ?? head))
            .tooltip(tipText(`waited for you: ${w.shown ?? w.kind}, ${dur((w.resolved ?? now) - w.opened)}${w.resolved ? (w.how ? ` (${w.how})` : "") : " so far"}${w.reason ? `\n${w.reason}` : ""}`))))))));
    const legend = h_flex().px(10).py(8).gap(8).flex_wrap()
      .children(PHASES.map((ph) => h_flex().id(`ph-${ph.id}`).gap(4).items_center().h(12)
        .tooltip(`${ph.steps.filter((x) => STEPS.includes(x)).join(", ")}: ${ph.agent ? "an agent at work (a full bar)" : "no agent (a thin line)"}`)
        .child(swatch(t, ph))
        .child(div().text_size(11).text_color(t.dim).child(ph.label))))
      .child(h_flex().gap(4).items_center().h(12).child(div().w(2).h(12).rounded(1).bg(t.ansi1)).child(div().text_size(11).text_color(t.dim).child("sent back")))
      .child(h_flex().gap(4).items_center().h(12).child(div().w(14).h(2).bg(t.ansi1)).child(div().text_size(11).text_color(t.dim).child("waiting for you")));
    if (!rows.length) rows.push(div().px(10).py(6).text_size(12).text_color(t.dim).child(win ? `Nothing ran from ${clock(from)} to ${clock(to)}: [ zooms out, { } move, esc goes back to now.` : `Nothing ran in this ${dur(span)}: ] shows more.`));
    // The time axis and the busy row stay put above the scrolling lanes (render() draws them).
    this.pinned = v_flex().border_b_1().border_color(t.border).child(axis).child(concRow);
    return [...rows, legend];
  },

  // ? : every key, in the git graph's and the beads view's words.
  keyList(t) {
    const rows = [
      ["j k  ↑ ↓", "move (ctrl-d ctrl-u a page, g G top and bottom)"],
      ["⏎ ⇥", "open or close the bead's details"],
      ["l →  h ← x", "open / close the details"],
      ["space", "its first action (answer a question, resume, tail, diff); one that changes the run asks first"],
      ["a f i", "approve, resume (another fix round), drop: the same key on every bead, shown on its button; they ask first"],
      ["p", "answer: the bead's answer field"],
      ["t v", "its agent session tab, its gate (fleet gate show)"],
      ["d o", "its diff in the git graph, its PR on GitHub"],
      ["w", "its fleet tail at the bottom"],
      ["- =", "the tail three lines shorter / taller (or drag its top edge; double-click: back to 14)"],
      ["b", "it in the beads view"],
      ["/", "filter by id or title (backspace clears)"],
      ["1 2", "Board, Lanes (digits change what's shown)"],
      ["e", "every fleet run, in a list under the title (j k, ⏎ shows one, esc closes)"],
      ["⌘← ⌘→", "the previous / next fleet run"],
      ["0", "show or fold Done"],
      ["[ ]", "zoom Lanes (or drag across its time axis, ⌘-scroll)"],
      ["< >", "Lanes: the wave before / after (click a wave's number); after the last, back to now"],
      ["{ }", "Lanes: move back / on in time (or swipe sideways); esc goes back to now"],
      ["r", "read the run again"],
      ["?", "this list (any key closes it)"],
    ];
    return [v_flex().px(10).py(10).gap(3)
      .child(div().pb(4).text_size(11).font_semibold().text_color(t.dim).child("KEYS"))
      .children(rows.map(([keys, what]) => h_flex().gap(10)
        .child(div().w(90).flex_none().text_size(ROW.small).text_color(t.foreground).child(keys))
        .child(div().flex_1().min_w(0).text_size(ROW.small).text_color(t.muted).child(what))))];
  },

  empty(t) {
    const p = this.problem;
    const title = !p ? (this.loading ? "Reading the fleet run…" : "Focus a terminal in a repository with a fleet run") : p.kind === "none" ? "No fleet run here" : p.kind === "old" ? "agent-fleet is too old" : p.kind === "missing" ? "No fleet command" : "Can't read the run";
    const hint = !p ? "" : p.kind === "none" ? "Focus a terminal in a repository where `fleet run <epic>` has run (it has a .fleet.toml)."
      : p.kind === "old" ? "Update the agent-fleet plugin in Claude Code (/plugin), then /reload-plugins."
        : p.kind === "missing" ? "Install agent-fleet and run `fleet install-cli`, or name a fleet in ~/.config/herdr-app/data/workbench.json." : "";
    return v_flex().p(14).gap(6)
      .child(div().text_size(14).font_semibold().text_color(t.foreground).child(title))
      .when(Boolean(p?.message), (el) => el.child(div().text_size(12).text_color(t.muted).child(p.message)))
      .when(Boolean(hint), (el) => el.child(div().text_size(12).text_color(t.dim).child(hint)))
      .when(Boolean(p?.cwd), (el) => el.child(div().text_size(11).text_color(t.dim).child(p.cwd)));
  },

};
