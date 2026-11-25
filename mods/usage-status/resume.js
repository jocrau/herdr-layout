// After a restart: the Claude sessions Herdr's terminals lost (extras/claude-resume --json), offered once in a
// notification. A click opens claude-resume in a new tab, which lists them and asks before resuming any.
// Offered once per set of lost sessions (shared "claude-resume.offered"), so a layout reload doesn't ask again.
import { exec, notify, appHome, shared, setShared } from "herdr";

const OFFERED = "claude-resume.offered";

// What to say about these lost sessions, or null (none, or this set was offered already). Pure, for tests.
export function resumeOffer(rows, offered) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const sig = rows.map((r) => r.session).sort().join(" ");
  if (sig === offered) return null;
  const n = rows.length, names = rows.map((r) => r.title || r.where || r.session.slice(0, 8));
  return {
    sig,
    title: `${n} Claude session${n === 1 ? "" : "s"} lost in a restart`,
    body: `${names.slice(0, 4).join("\n")}${n > 4 ? `\n+${n - 4} more` : ""}\nClick to resume ${n === 1 ? "it" : "them"} (it asks first)`,
  };
}

// The script, through the mod's folder: the layout links mods/<mod> into Herdr's mods folder, and `..` follows that link.
export const resumeScript = () => `${appHome()}/mods/usage-status/../../extras/claude-resume`;

export async function offerResume() {
  const script = resumeScript();
  // A login shell: a mod's exec has no Homebrew or ~/.local/bin on its PATH (hc lives there).
  const r = await exec("/bin/zsh", ["-lc", '[ -f "$0" ] && exec /usr/bin/python3 -I "$0" --json', script], { timeout: 30000 }).catch(() => null);
  let rows = null;
  try { rows = JSON.parse(r?.stdout || "null"); } catch { return; }
  const offer = resumeOffer(rows, shared(OFFERED));
  if (!offer) return;
  setShared(OFFERED, offer.sig);
  notify({
    title: offer.title, body: offer.body, level: "info", timeout: 60000,
    action: { name: "terminal.open", args: { name: "Resume", argv: ["/bin/zsh", "-lc", '/usr/bin/python3 -I "$0"; exec zsh -l', script] } },
  });
}
