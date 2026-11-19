// Fleet board: acting on a run: commands in a terminal or run directly (asking first when they change the
// run), the gate's answer, the diff and beads views. Mixed into FleetBoard.
import { TextareaState } from "gpui-base";
import { notify, props, run, exec, openOverlay } from "herdr";
import { fleetBin } from "./fleet.js";
import { wordsOf, readOnly, shq, graph, asks } from "./model.js";

export const ActionsMethods = {
  // Runs a command in a terminal under the focused pane, with the fleet this pane uses.
  // `words`: the command as separate words (each quoted here); `cwd`: the folder it was asked about.
  async inTerminal(words, name, cwd = this.cwd) {
    const bin = await fleetBin();
    const line = words.map((w, i) => shq(i === 0 && w === "fleet" ? bin : w)).join(" ");
    const ended = shq(`[${words.slice(0, 2).join(" ")} ended]`);
    run("terminal.open", { argv: ["/bin/zsh", "-ic", `${line}; echo; echo ${ended}; exec zsh -i`], folder: cwd, place: "down", name });
  },

  // Asks before a command that changes the run: a bar under the tabs says what runs and what it does;
  // ⏎ or Run runs it, Esc or Cancel doesn't. `copy` offers the command to paste instead.
  // It remembers the run it was asked about: switching runs closes it (show()), and `run` gets that folder.
  ask(title, detail, label, run, copy = null) {
    const cwd = this.cwd;
    this.confirm = { title, detail, label, run: run && ((cx) => run(cx, cwd)), copy, key: this.runKey() };
  },

  // Runs a fleet command that changes the run (resume, approve, stop) with the fleet this pane uses, then says
  // how it went and reads the run again.
  // `words`: the command as separate words, run without a shell in `cwd`, the folder it was asked about.
  async runFleet(cx, words, what, cwd = this.cwd) {
    const bin = await fleetBin();
    const cmd = words.join(" ");
    this.busy = what; cx.notify();
    let r;
    try { r = await exec(words[0] === "fleet" ? bin : words[0], words.slice(1), { cwd, timeout: 120000 }); }
    catch (e) { r = { code: -1, stdout: "", stderr: String(e?.message ?? e) }; }
    this.busy = null;
    const out = ((r.code === 0 ? r.stdout : r.stderr || r.stdout) || "").trim().split("\n").slice(-4).join("\n");
    notify({ title: r.code === 0 ? `Done: ${what}` : `Failed: ${what}`, body: out || cmd, level: r.code === 0 ? "success" : "error", timeout: r.code === 0 ? 6000 : 15000 });
    this.refresh(cx, true);
    cx.notify();
  },

  // The wave pill's click: stop the running wave, or start the next one in a terminal below the tab. Asked first;
  // a second click on the pill takes the question back (as Esc or Cancel do).
  waveAction() {
    if (this.confirm?.from === "wave") { this.confirm = null; return; }
    const e = this.s.epic, wave = e.wave;
    if (wave.running) {
      this.ask(`Stop wave ${wave.number}?`, "The steps running now are interrupted; the next wave resumes them.", "Stop",
        (cx, cwd) => cx.spawn((cx) => this.runFleet(cx, ["fleet", "stop", "--no-wait"], `stop wave ${wave.number}`, cwd)), "fleet stop");
    } else {
      this.ask(`Start the next wave of ${e.id}?`, "It runs in a terminal below the tab (Ctrl-C there stops it); this pane follows it.", "Start",
        (_cx, cwd) => this.inTerminal(["fleet", "run", e.id], `wave ${e.id}`, cwd), `fleet run ${e.id}`);
    }
    this.confirm.from = "wave";
  },

  async copy(cmd, what) {
    await exec("/bin/sh", ["-c", 'printf %s "$1" | pbcopy', "sh", cmd]);
    notify({ title: `Copied: ${what}`, body: `${cmd}\nPaste it in a terminal in ${this.cwd.split("/").pop()} to run it.`, level: "info", timeout: 6000 });
  },

  // What a bead offers: the gate's own actions while parked, then read-only looks.
  actions(b) {
    const out = [];
    if (b.state === "parked" && b.gate) {
      for (const a of b.gate.actions ?? []) {
        if (a.verb === "answer") continue; // answered right in the details (Send answer), never in an editor
        const words = wordsOf(a.command), verb = String(a.verb ?? "act");
        const look = words && readOnly(words);
        out.push({ label: verb, tip: `${a.means ?? ""}\n${a.command}${look ? "" : words ? "\n(asks first: it changes the run)" : "\n(to copy: not a plain fleet command)"}`,
          go: () => (look ? this.inTerminal(words, `${verb} ${b.id}`)
            : this.ask(`${verb[0].toUpperCase()}${verb.slice(1)} ${b.id}?`, words ? a.means : `${a.means ?? ""} Not a plain fleet command, so it isn't run from here: copy it.`, verb,
              words ? (cx, cwd) => cx.spawn((cx) => this.runFleet(cx, words, `${verb} ${b.id}`, cwd)) : null, a.command)) });
      }
      out.push({ label: "gate", tip: `fleet gate show ${b.id}`, go: () => this.inTerminal(["fleet", "gate", "show", b.id], `gate ${b.id}`) });
    }
    if (["running", "interrupted", "waiting for CI", "parked"].includes(b.state) && b.history.length)
      out.push({ label: "tail", tip: "Its last lines at the bottom of the pane, following it (t)", go: () => { this.tailOn = true; this.selId = b.id; } });
    if (b.pr) out.push({ label: `PR #${b.pr}`, tip: `gh pr view ${b.pr} --web`, go: () => exec("gh", ["pr", "view", String(b.pr), "--web"], { cwd: this.cwd }) });
    const range = this.diffRange(b);
    if (range) out.push({ label: "diff", tip: `${range.title}\nin the git graph: ${range.base}...${range.head}`, go: () => this.openDiff(range) });
    out.push({ label: "beads", tip: "Show it in the beads view (b), with its details", go: () => this.inBeads(b) });
    return out;
  },

  // What `fleet diff` shows, as the two ends the git graph reviews (base...head): the snapshot's
  // `review {base, head}` (once merged, what its merge commit brought in; before, its branch against the epic
  // branch). None for a bead with nothing to show (dropped before it made a branch).
  diffRange(b) {
    return b.review?.base && b.review?.head ? { ...b.review, title: `${b.id}: ${b.merged_ref ? "what merged" : "what merges"}` } : null;
  },

  // The beads view (⌘⇧B) on this bead: its tree unfolded to it, its details open.
  inBeads(b) {
    openOverlay({ mod: "beads", kind: "popup", width: 1, height: 1, frame: "none", props: { select: b.id, folder: this.cwd } });
  },

  // The git graph as a dialog (like ⌘⇧G), reviewing the range: changed files beside their diff.
  openDiff(range) {
    openOverlay({ mod: "git-graph", kind: "dialog", width: 0.92, height: 0.9, props: { folder: this.cwd, review: range } });
  },

  // A field takes the keyboard only once it is drawn: focus it on the next frame (or the worker's next pass).
  focusSoon(state, cx) {
    if (!state) return;
    if (cx?.timer) cx.timer.after(0, () => state.focus()); else this.pendingFocus = state;
  },

  // space: a bead's first action (a question: its answer field), else its details.
  act(b, cx) {
    if (asks(b) && this.answerable(b)) { this.openOnly(b); this.selId = b.id; this.focusSoon(this.answerOf(b)?.area, cx); return; } // ⏎ on a question: answer it
    const a = this.actions(b)[0];
    if (a) a.go(); else this.toggle(b.id);
  },

  answerable(b) { return b.state === "parked" && (b.gate?.actions ?? []).some((a) => a.verb === "answer"); },

  // The answer being written for a bead: each question's chosen option (the agent's proposal to start with)
  // and a free-text field. Made in an event handler (a text field can't be made while drawing).
  // The draft for the bead's gate now: one written for an earlier gate doesn't count.
  draft(b) {
    const a = this.answers.get(b.id);
    return a && b.gate && a.gate === b.gate.id ? a : null;
  },

  answerOf(b) {
    if (!this.answerable(b)) return null;
    let a = this.answers.get(b.id);
    if (a && a.gate === b.gate.id) return a;
    const qs = b.gate.questions ?? [];
    const area = TextareaState.new({ placeholder: qs.some((q) => q.options?.length) ? "Your own answer, or a note to go with the choice (optional)" : "Your answer", rows: 3 });
    area.set_auto_grow(2, 8);
    area.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    area.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    a = { gate: b.gate.id, area, picks: qs.map((q) => (q.options ?? []).indexOf(q.default)).map((i) => (i >= 0 ? i : null)), sending: false };
    this.answers.set(b.id, a);
    return a;
  },

  // The text `fleet answer` gets: each question's choice (numbered when there are several), then the note.
  answerText(b, a) {
    const qs = b.gate.questions ?? [], several = qs.length > 1;
    const lines = qs.map((q, i) => (a.picks[i] !== null && q.options?.[a.picks[i]] ? `${several ? `${i + 1}. ` : ""}${q.options[a.picks[i]]}` : null)).filter(Boolean);
    const note = a.area.value().trim();
    return [...lines, note].filter(Boolean).join("\n");
  },

  // Sends it through a file (`fleet answer <bead> --file`), so the text never meets a shell or an editor.
  async sendAnswer(cx, b) {
    const a = this.draft(b);
    if (!a || a.sending) return;
    const text = this.answerText(b, a);
    if (!text) { notify({ title: `${b.id}`, body: "Pick an option or write an answer first.", level: "warning", timeout: 4000 }); return; }
    a.sending = true;
    cx.notify();
    const bin = await fleetBin();
    let r; // a failed or timed-out exec must not leave the button at "Sending…"
    try { r = await exec("/bin/sh", ["-c", 'f=$(mktemp) || exit 1; printf %s "$2" > "$f"; "$1" answer "$3" --file "$f"; rc=$?; rm -f "$f"; exit $rc', "sh", bin, text, b.id], { cwd: this.cwd, timeout: 60000 }); }
    catch (e) { r = { code: -1, stdout: "", stderr: String(e?.message ?? e) }; }
    a.sending = false;
    if (r.code === 0) {
      this.answers.delete(b.id);
      this.typing = false;
      notify({ title: `Answered ${b.id}`, body: "The next wave goes on with it.", level: "success", timeout: 5000 });
      this.request = "force";
    } else {
      notify({ title: `Couldn't answer ${b.id}`, body: (r.stderr || r.stdout).trim().replace(/^fleet: /, "").slice(0, 400), level: "error", timeout: 8000 });
    }
    cx.notify();
  },

};
