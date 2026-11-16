// Fleet board: notifications for beads that start waiting for you, said once across the pane's copies.
import { notify, shared, setShared, layout } from "herdr";
import { shortener, gateText } from "./model.js";

export const AlertsMethods = {
  // Several copies of the pane (docked, a dialog) see the same wait: only the first to see it says so.
  once(epic, sig) {
    const seen = shared("fleet-board.alerted") ?? {};
    if (seen[epic] === sig) return false;
    setShared("fleet-board.alerted", { ...seen, [epic]: sig });
    return true;
  },

  // A bead of the run on screen started waiting for you since the last read: say so (not at the first read).
  // A wait is a bead and its gate: the same bead asking again (a new gate) is a new wait.
  alertParked(snap) {
    const epic = snap.epic.id, parked = snap.beads.filter((b) => b.state === "parked");
    const wait = (b) => `${b.id}#${b.gate?.id ?? b.gate?.since ?? ""}`;
    const prev = this.parkedIds.get(epic);
    this.parkedIds.set(epic, new Set(parked.map(wait)));
    this.parkedSeen.set(epic, parked.length);
    // Said already while the pane was hidden (alertRuns): this read only takes it as known.
    if (this.saidHidden?.delete(epic)) return;
    const fresh = prev ? parked.filter((b) => !prev.has(wait(b))) : [];
    if (!fresh.length || !this.once(epic, fresh.map(wait).sort().join(" "))) return;
    const short = shortener(epic);
    notify({
      title: fresh.length === 1 ? `${short(fresh[0].id)} waits for you: ${fresh[0].gate?.shown ?? fresh[0].gate?.kind ?? "gate"}` : `${fresh.length} beads wait for you`,
      body: `${epic}\n${fresh.map((b) => `${short(b.id)}: ${gateText(b.gate) || b.title}`).join("\n")}`,
      level: "warning", timeout: 15000, action: { name: "layout.show", args: { id: "fleet" } },
    });
  },

  // Another run on the strip has more beads waiting for you than at the last look.
  alertRuns(all = false) {
    for (const r of this.runs.values()) {
      if (!all && this.s && r.epic === this.s.epic.id) continue; // the reader's alertParked covers it (not while hidden)
      const prev = this.parkedSeen.get(r.epic);
      this.parkedSeen.set(r.epic, r.parked);
      if (prev !== undefined && r.parked > prev && this.once(r.epic, `${r.parked} waiting`)) {
        notify({
          title: `${r.repoName}: ${r.parked - prev === 1 ? "a bead waits" : `${r.parked - prev} beads wait`} for you`,
          body: `${r.epic} · ${r.parked} waiting`, level: "warning", timeout: 15000, action: { name: "layout.show", args: { id: "fleet" } },
        });
        if (all) (this.saidHidden ??= new Set()).add(r.epic); // the shown run's next read doesn't say it again
      }
    }
  },

};
