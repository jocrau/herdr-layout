// Fleet board: acting on a run: commands in a terminal or run directly (asking first when they change the
// run), the gate's answer, the diff and beads views. Mixed into FleetBoard.
import { TextareaState } from "gpui-base";
import { notify, props, run, exec, openOverlay, spaces } from "herdr";
import { fleetBin, fleetExec, fleetMachine, shellArgv } from "./fleet.js";
import { wordsOf, readOnly, shq, graph, asks } from "./model.js";

// A bead's actions by key, the same on every bead (as pr-board's VERB_KEYS): approve a, resume f (another fix
// round, as fix), drop i (as ignore), session t (its agent tab), tail w, PR o (on GitHub), diff d (as the PR view),
// gate v, beads b; p goes to the answer field. space runs the first action.
export const ACTION_KEYS = { approve: "a", resume: "f", drop: "i", session: "t", gate: "v", tail: "w", pr: "o", diff: "d", beads: "b" };

// What the bead's row says while a gate's command runs, and what the question adds about when it goes on.
const DOING = { resume: "Resuming", approve: "Approving", drop: "Dropping", retry: "Retrying" };
const WHEN = { resume: "It goes on at the next wave.", approve: "It goes on at the next wave." };

export const ActionsMethods = {
  // Runs a command in a terminal under the focused pane, with the fleet this pane uses. With the fleet on another
  // machine, there: under the focused pane when that's on the same machine, else as a tab in the run's space there.
  // `words`: the command as separate words (each quoted here); `cwd`: the folder it was asked about.
  async inTerminal(words, name, cwd = this.cwd) {
    const bin = await fleetBin(), on = await fleetMachine();
    const line = words.map((w, i) => shq(i === 0 && w === "fleet" ? bin : w)).join(" ");
    const ended = shq(`[${words.slice(0, 2).join(" ")} ended]`);
    const argv = await shellArgv(`${line}; echo; echo ${ended}`);
    if ((spaces().find((s) => s.active)?.machine ?? null) === on) run("terminal.open", { argv, folder: cwd, place: "down", name });
    else this.tabThere({ name, folder: cwd, argv, focus: true }, on);
  },

  // A tab where the fleet lives: in the space whose folder is the run's on that machine, else the one shown (this
  // computer), else a new space there named after the repository.
  tabThere(tab, on) {
    const mine = (spaces() ?? []).filter((sp) => (sp.machine ?? null) === (on ?? null));
    const space = mine.find((sp) => sp.folder === tab.folder)?.id;
    if (space || !on) run("tab.new", { ...(space ? { space } : {}), ...tab });
    else { const { name, ...rest } = tab; run("space.new", { name: tab.folder.split("/").pop(), machine: on, tab: name, ...rest }); }
  },

  // `fleet session <bead>`: you work the bead with an agent, so it gets a tab of its own named after the bead (in
  // the space whose folder is the run's, else the one shown). One there already is brought forward instead.
  async sessionTab(words, id) {
    for (const sp of spaces() ?? []) {
      const tab = (sp.tabs ?? []).find((x) => x.name === id);
      if (tab) { run("space.select", { id: sp.id }); run("tab.select", { id: tab.id }); return; }
    }
    const bin = await fleetBin();
    const line = words.map((w, i) => shq(i === 0 && w === "fleet" ? bin : w)).join(" ");
    this.tabThere({ name: id, folder: this.cwd, argv: await shellArgv(`${line}; echo; echo ${shq(`[fleet session ${id} ended]`)}`), focus: true }, await fleetMachine());
  },

  // Asks before a command that changes the run: a bar under the tabs says what runs and what it does;
  // ⏎ or Run runs it, Esc or Cancel doesn't. `copy` offers the command to paste instead.
  // It remembers the run it was asked about: switching runs closes it (show()), and `run` gets that folder.
  // `bead`: the bead it is about; the bar then shows under that bead (as pr-board asks under its PR), else at the top.
  ask(title, detail, label, run, copy = null, bead = null) {
    const cwd = this.cwd;
    this.confirm = { title, detail, label, run: run && ((cx) => run(cx, cwd)), copy, key: this.runKey(), bead };
  },

  // Runs a fleet command that changes the run (resume, approve, stop) with the fleet this pane uses, then says
  // how it went and reads the run again.
  // `words`: the command as separate words, run without a shell in `cwd`, the folder it was asked about.
  // `bead`: the bead it acts on. Its row says what runs (`doing`, pulsing) until the run is read again, so it
  // never shows the old state in between; done, its details close and it shows where it went (queued,
  // "resumed · next wave"), as pr-board closes a card with nothing left to do.
  async runFleet(cx, words, what, cwd = this.cwd, bead = null, doing = null) {
    const cmd = words.join(" ");
    this.busy = { text: doing ?? what, bead, at: Date.now() }; cx.notify();
    let r;
    try { r = await fleetExec(words[0], words.slice(1), { cwd, timeout: 120000 }); }
    catch (e) { r = { code: -1, stdout: "", stderr: String(e?.message ?? e) }; }
    const ok = r.code === 0;
    const out = ((ok ? r.stdout : r.stderr || r.stdout) || "").trim().replace(/^fleet: /, "").split("\n").slice(-4).join("\n");
    if (ok && bead) {
      if (this.openId === bead) this.openId = null;
      this.busy = { ...this.busy, until: "read" }; // its row keeps saying so until the next read shows where it went (scheduler)
    } else this.busy = null;
    notify({ title: ok ? `Done: ${what}` : `Failed: ${what}`, body: out || cmd, level: ok ? "success" : "error", timeout: ok ? 6000 : 15000 });
    this.refresh(cx, true);
    cx.notify();
  },

  // What runs now for this bead (its row says it), if anything; a stale one (a read that never came) ends after 30 s.
  busyOn(id) {
    const b = this.busy;
    return b && b.bead === id && Date.now() - b.at < 30000 ? b.text : null;
  },

  // The wave pill's click: stop the running wave, or start the next one in a terminal below the tab. Asked first;
  // a second click on the pill takes the question back (as Esc or Cancel do).
  waveAction() {
    if (this.confirm?.from === "wave") { this.confirm = null; return; }
    const e = this.s.epic, wave = e.wave;
    if (wave.running) {
      this.ask(`Stop wave ${wave.number}?`, "The steps running now are interrupted; the next wave resumes them.", "Stop",
        (cx, cwd) => cx.spawn((cx) => this.runFleet(cx, ["fleet", "stop", "--no-wait"], `stop wave ${wave.number}`, cwd, null, `Stopping wave ${wave.number}`)), "fleet stop");
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

  // What a bead offers: the gate's own actions while parked, then read-only looks. Each with its key (ACTION_KEYS):
  // the same letter on every bead, and where the PR board has the same action, its letter.
  actions(b) {
    const out = [];
    if (b.state === "parked" && b.gate && !this.busyOn(b.id)) { // while one runs, nothing else to click on its gate
      for (const a of b.gate.actions ?? []) {
        if (a.verb === "answer") continue; // answered right in the details (Send answer), never in an editor
        const words = wordsOf(a.command), verb = String(a.verb ?? "act");
        const look = words && readOnly(words);
        out.push({ label: verb, key: ACTION_KEYS[verb] ?? null, tip: `${a.means ?? ""}\n${a.command}${verb === "session" && words ? `\n(in a tab named ${b.id})` : look ? "" : words ? "\n(asks first: it changes the run)" : "\n(to copy: not a plain fleet command)"}`,
          go: () => (verb === "session" && words ? this.sessionTab(words, b.id)
            : look ? this.inTerminal(words, `${verb} ${b.id}`)
            : this.confirm?.bead === b.id && this.confirm.label === verb ? (this.confirm = null) // a second click takes the question back
            : this.ask(`${verb[0].toUpperCase()}${verb.slice(1)} ${b.id}?`, words ? `${a.means ?? ""}${WHEN[verb] ? ` ${WHEN[verb]}` : ""}`.trim() : `${a.means ?? ""} Not a plain fleet command, so it isn't run from here: copy it.`, verb,
              words ? (cx, cwd) => cx.spawn((cx) => this.runFleet(cx, words, `${verb} ${b.id}`, cwd, b.id, DOING[verb] ?? verb)) : null, a.command, b.id)) });
      }
      out.push({ label: "gate", key: ACTION_KEYS.gate, tip: `fleet gate show ${b.id}`, go: () => this.inTerminal(["fleet", "gate", "show", b.id], `gate ${b.id}`) });
    }
    if (["running", "interrupted", "waiting for CI", "parked"].includes(b.state) && b.history.length)
      out.push({ label: "tail", key: ACTION_KEYS.tail, tip: "Its last lines at the bottom of the pane, following it (w)", go: () => { this.tailOn = true; this.selId = b.id; } });
    if (b.pr) out.push({ label: `PR #${b.pr}`, key: ACTION_KEYS.pr, tip: `gh pr view ${b.pr} --web`, go: () => this.openPr(b.pr) });
    const range = this.diffRange(b);
    if (range) out.push({ label: "diff", key: ACTION_KEYS.diff, tip: `${range.title}\nin the git graph: ${range.base}...${range.head}`, go: () => this.openDiff(range) });
    out.push({ label: "beads", key: ACTION_KEYS.beads, tip: "Show it in the beads view (b), with its details", go: () => this.inBeads(b) });
    return out;
  },

  // What `fleet diff` shows, as the two ends the git graph reviews (base...head): the snapshot's
  // `review {base, head}` (once merged, what its merge commit brought in; before, its branch against the epic
  // branch). None for a bead with nothing to show (dropped before it made a branch).
  diffRange(b) {
    return b.review?.base && b.review?.head ? { ...b.review, title: `${b.id}: ${b.merged_ref ? "what merged" : "what merges"}` } : null;
  },

  // The PR in the browser here: gh asked for its URL where the fleet lives (the repository's clone is there),
  // opened on this computer.
  async openPr(n) {
    if (!(await fleetMachine())) return exec("gh", ["pr", "view", String(n), "--web"], { cwd: this.cwd });
    const r = await fleetExec("gh", ["pr", "view", String(n), "--json", "url", "-q", ".url"], { cwd: this.cwd, timeout: 20000 }).catch(() => null);
    const url = r?.code === 0 ? r.stdout.trim() : "";
    if (url.startsWith("https://")) await exec("open", [url]);
    else notify({ title: `PR #${n}`, body: (r?.stderr || "gh couldn't say where it is").trim().slice(0, 300), level: "error", timeout: 8000 });
  },

  // The beads view (⌘⇧B) on this bead: its tree unfolded to it, its details open (on the fleet's machine).
  async inBeads(b) {
    openOverlay({ mod: "beads", kind: "popup", width: 1, height: 1, frame: "none", props: { select: b.id, folder: this.cwd, machine: await fleetMachine() } });
  },

  // The git graph as a dialog (like ⌘⇧G), reviewing the range: changed files beside their diff (on the fleet's
  // machine).
  async openDiff(range) {
    openOverlay({ mod: "git-graph", kind: "dialog", width: 0.92, height: 0.9, props: { folder: this.cwd, on: await fleetMachine(), review: range } });
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

  // An action's own key on the bead (ACTION_KEYS; p: its answer field): run it, or say it isn't offered now.
  keyAction(b, k, cx) {
    if (k === "p") {
      if (this.answerable(b)) { this.openOnly(b); this.selId = b.id; this.focusSoon(this.answerOf(b)?.area, cx); }
      else notify({ title: `${b.id}: nothing to answer now`, body: "p answers a bead that waits for you with a question.", level: "info", timeout: 4000 });
      return;
    }
    const acts = this.actions(b), a = acts.find((x) => x.key === k);
    if (a) { a.go(); return; }
    const verb = Object.keys(ACTION_KEYS).find((v) => ACTION_KEYS[v] === k);
    notify({ title: `${b.id}: no ${verb === "pr" ? "PR" : verb} now`, body: `What it offers: ${acts.map((x) => x.label).join(", ") || "nothing"}`, level: "info", timeout: 4000 });
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
    try { r = await fleetExec("/bin/sh", ["-c", 'f=$(mktemp) || exit 1; printf %s "$2" > "$f"; "$1" answer "$3" --file "$f"; rc=$?; rm -f "$f"; exit $rc', "sh", bin, text, b.id], { cwd: this.cwd, timeout: 60000 }); }
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
