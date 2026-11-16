#!/bin/sh
# A neutral demo of the workbench layout for screenshots: a second Herdr window with its own home,
# its own herdr-core session and its own agent-fleet state, over made-up repositories in /tmp/herdr-demo.
# Nothing here touches your own Herdr (~/.config/herdr-app), its terminals, or your fleet runs.
#
#   sh tests/demo/make-demo.sh build    # the repositories, their beads and a fleet dry run (no agents, no cost)
#   sh tests/demo/make-demo.sh up       # the demo window with the layout and one space per repository
#   sh tests/demo/make-demo.sh fleet    # the fleet's next wave (fake agents), to move the run along
#   sh tests/demo/make-demo.sh shot F   # save the demo window's frame as F
#   sh tests/demo/make-demo.sh down     # quit the demo window and stop its herdr-core session
#   sh tests/demo/make-demo.sh clean    # down, then delete /tmp/herdr-demo
set -eu
LAYOUT=$(cd "$(dirname "$0")/../.." && pwd)
D=${HERDR_DEMO:-/tmp/herdr-demo}  # a neutral path: it shows in the windows
export HERDR_APP_HOME="$D/home" HC_SESSION=herdr-demo AGENT_FLEET_STATE="$D/state" AGENT_FLEET_CONFIG="$D/agent-fleet.toml"
# Inside a Herdr terminal these point at your own core: only HC_SESSION may decide which core hc reaches.
unset HC_SOCKET HC_TERMINAL_SOCKET HC_TERMINAL_ID HC_SCOPE
MARK="$D/.herdr-demo"  # written by build: clean removes only a folder that has it
APP=${HERDR_APP:-$(command -v herdr-app)}
FLEET=${FLEET:-$(command -v fleet || true)}

# Made-up people; commits never run your hooks or use your identity.
g() { git -c core.hooksPath=/dev/null -c commit.gpgsign=false -c user.name="${AUTHOR:-Alice Example}" -c user.email="${EMAIL:-alice@example.com}" "$@"; }
commit() { # commit <repo> <days ago> <message> [author]
  case ${4:-alice} in bob) AUTHOR="Bob Example" EMAIL=bob@example.com ;; *) AUTHOR="Alice Example" EMAIL=alice@example.com ;; esac
  at=$(date -v-"$2"d +%Y-%m-%dT%H:%M:%S)
  (cd "$1" && g add -A && AUTHOR=$AUTHOR EMAIL=$EMAIL GIT_AUTHOR_DATE=$at GIT_COMMITTER_DATE=$at \
    git -c core.hooksPath=/dev/null -c commit.gpgsign=false -c user.name="$AUTHOR" -c user.email="$EMAIL" commit -qm "$3")
}
put() { mkdir -p "$(dirname "$1")"; cat > "$1"; }
# A new repository with a made-up identity of its own, so tools that commit by themselves (bd init) never use yours.
newrepo() { g init -q -b main "$1"; git -C "$1" config user.name "Alice Example"; git -C "$1" config user.email alice@example.com; git -C "$1" config core.hooksPath /dev/null; }

build_web() {
  r=$D/code/acme-web; mkdir -p "$r"; newrepo "$r"
  put "$r/README.md" <<'EOF'
# acme-web

The storefront for Acme Supplies: browse the catalogue, fill a cart, check out.

```mermaid
flowchart LR
  Browser --> Web[acme-web]
  Web --> API[acme-api]
  API --> DB[(Postgres)]
  API --> Pay[Payments]
```

## Run it

    npm install
    npm run dev
EOF
  put "$r/package.json" <<'EOF'
{ "name": "acme-web", "version": "1.4.0", "private": true,
  "scripts": { "dev": "vite", "build": "vite build", "test": "vitest run" } }
EOF
  put "$r/src/main.ts" <<'EOF'
import { mountCart } from "./cart";
import { mountCatalogue } from "./catalogue";

mountCatalogue(document.querySelector("#catalogue")!);
mountCart(document.querySelector("#cart")!);
EOF
  commit "$r" 21 "Start the storefront: catalogue and cart"
  put "$r/src/catalogue.ts" <<'EOF'
export type Product = { id: string; name: string; price: number };

export async function loadProducts(): Promise<Product[]> {
  const res = await fetch("/api/products");
  return res.json();
}

export function mountCatalogue(el: Element) {
  loadProducts().then((ps) => { el.innerHTML = ps.map((p) => `<li>${p.name}</li>`).join(""); });
}
EOF
  commit "$r" 19 "Catalogue lists the products from the API" bob
  put "$r/src/cart.ts" <<'EOF'
import type { Product } from "./catalogue";

const items = new Map<string, { product: Product; qty: number }>();

export function add(product: Product) {
  const line = items.get(product.id);
  items.set(product.id, { product, qty: (line?.qty ?? 0) + 1 });
}

export const total = () => [...items.values()].reduce((n, l) => n + l.product.price * l.qty, 0);

export function mountCart(el: Element) { el.textContent = `Total: ${total().toFixed(2)}`; }
EOF
  commit "$r" 16 "Cart keeps quantities and a total"
  put "$r/data/prices.csv" <<'EOF'
sku,name,price,currency
A-100,Desk lamp,39.00,EUR
A-101,Office chair,189.00,EUR
A-102,Notebook (A5),4.50,EUR
A-103,Monitor arm,79.00,EUR
EOF
  commit "$r" 12 "Sample price list for the catalogue" bob
  printf '\n## Checkout\n\nCheckout v2 moves payment to the API and keeps the cart across devices.\n' >> "$r/README.md"
  commit "$r" 6 "Describe Checkout v2"
  sed -i '' 's/toFixed(2)/toFixed(2) + " EUR"/' "$r/src/cart.ts"
  commit "$r" 3 "Show the currency in the cart total" bob

  # A "remote" one commit ahead of main, so the git graph offers Fast-forward 1.
  g init -q --bare -b main "$D/remotes/acme-web.git"
  (cd "$r" && g remote add origin "$D/remotes/acme-web.git" && g push -q -u origin main)
  w=$D/tmp-web; rm -rf "$w"; g clone -q "$D/remotes/acme-web.git" "$w"
  printf 'export const FREE_SHIPPING_FROM = 50;\n' > "$w/src/shipping.ts"; commit "$w" 1 "Free shipping from 50 EUR" bob
  (cd "$w" && g push -q origin main); rm -rf "$w"
  (cd "$r" && g fetch -q origin)

  # Two worktrees, as agents use them.
  (cd "$r" && g worktree add -q -b feat/csv-export .worktrees/feat-csv-export main)
  mkdir -p "$r/.git/info" && printf '/.worktrees/\n' >> "$r/.git/info/exclude"
  printf 'export const toCsv = (rows: string[][]) => rows.map((r) => r.join(",")).join("\\n");\n' > "$r/.worktrees/feat-csv-export/src/csv.ts"
  commit "$r/.worktrees/feat-csv-export" 0 "Export the cart as CSV"
  (cd "$r" && g worktree add -q -b fix/session-timeout .worktrees/fix-session-timeout main)
  printf '// Sessions last 30 minutes of inactivity.\nexport const SESSION_MINUTES = 30;\n' > "$r/.worktrees/fix-session-timeout/src/session.ts"
  # left uncommitted: the worktree shows changes
  printf 'export const draft = true;\n' > "$r/src/draft.ts"

  # Beads: a small Checkout v2 epic.
  if command -v bd >/dev/null; then
    (cd "$r" && bd init --prefix acme --quiet --non-interactive --skip-hooks --skip-agents >/dev/null 2>&1 || true)
    if (cd "$r" && bd list >/dev/null 2>&1); then
      (cd "$r"
       e=$(bd create -q --silent -t epic -p 1 --title "Checkout v2" --description "Payment moves to the API; the cart survives a device change." 2>/dev/null || bd create -t epic -p 1 --title "Checkout v2" --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
       mk() { bd create --parent "$e" -t "$1" -p "$2" -l "$3" --title "$4" --json 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])'; }
       a=$(mk feature 1 owner:alice "Pay through the API instead of the browser")
       mk feature 2 owner:bob "Keep the cart across devices" >/dev/null
       mk task 2 owner:alice "Show the shipping cost before checkout" >/dev/null
       b=$(mk bug 1 owner:bob "Total ignores the quantity after a reload")
       mk chore 3 owner:alice "Remove the old checkout page" >/dev/null
       bd update "$a" --status in_progress >/dev/null 2>&1 || true
       bd close "$b" --reason "Fixed in the cart" >/dev/null 2>&1 || true
       bd create -t feature -p 2 -l owner:bob --title "Gift cards" >/dev/null 2>&1 || true)
    fi
  fi
}

build_api() {
  r=$D/code/acme-api; mkdir -p "$r"; newrepo "$r"
  put "$r/README.md" <<'EOF'
# acme-api

The API behind the storefront: products, carts, payments.
EOF
  put "$r/app/products.py" <<'EOF'
PRODUCTS = [
    {"id": "A-100", "name": "Desk lamp", "price": 39.0},
    {"id": "A-101", "name": "Office chair", "price": 189.0},
]


def list_products():
    return PRODUCTS
EOF
  commit "$r" 30 "Products endpoint" bob
  put "$r/app/payments.py" <<'EOF'
def charge(cart_id: str, amount: float) -> dict:
    """Charge a cart through the payment provider."""
    return {"cart": cart_id, "amount": amount, "status": "pending"}
EOF
  commit "$r" 9 "Payments: charge a cart"
  (cd "$r" && g checkout -q -b feat/refunds)
  printf '\n\ndef refund(charge_id: str) -> dict:\n    return {"charge": charge_id, "status": "refunded"}\n' >> "$r/app/payments.py"
  commit "$r" 2 "Refund a charge" bob
  (cd "$r" && g checkout -q main)
}

build_handbook() {
  r=$D/code/handbook; mkdir -p "$r"; newrepo "$r"
  put "$r/README.md" <<'EOF'
# Team handbook

How we work: [releases](releases.md), [on call](on-call.md).
EOF
  put "$r/releases.md" <<'EOF'
# Releases

| Step | Who | When |
|---|---|---|
| Cut the release branch | release captain | Monday |
| Smoke test on staging | everyone | Tuesday |
| Ship | release captain | Wednesday |
EOF
  put "$r/on-call.md" <<'EOF'
# On call

One week each, handed over on Monday at 10:00.
EOF
  commit "$r" 40 "Start the handbook"
  sed -i '' 's/10:00/10:00, in the team channel/' "$r/on-call.md"; commit "$r" 5 "Where the hand-over happens" bob
}

build_fleet() {
  [ -n "$FLEET" ] || { echo "no fleet command: skipping the fleet demo"; return; }
  # agent-fleet's own demo (a small app, nine beads, paced fake agents), from the newest installed plugin
  demo=${AGENT_FLEET_DEMO:-$(ls -d "$HOME"/.claude/plugins/cache/*/agent-fleet/*/scripts/fleet-demo 2>/dev/null | sort -V | tail -1)}
  [ -n "$demo" ] && [ -x "$demo" ] || { echo "no agent-fleet fleet-demo found (set AGENT_FLEET_DEMO): skipping the fleet demo"; return; }
  printf 'owner = "alice"\n' > "$AGENT_FLEET_CONFIG"
  "$demo" --dir "$D/code/forklift" --fake-session
}

wrapper() { # the fleet the demo window runs: always the demo's state and config
  mkdir -p "$D/bin"
  cat > "$D/bin/fleet" <<EOF
#!/bin/sh
export AGENT_FLEET_STATE="$AGENT_FLEET_STATE" AGENT_FLEET_CONFIG="$AGENT_FLEET_CONFIG" HC_SESSION=herdr-demo
unset HC_SOCKET HC_TERMINAL_SOCKET HC_TERMINAL_ID HC_SCOPE
exec "$FLEET" "\$@"
EOF
  chmod +x "$D/bin/fleet"
}

home() { # the demo's Herdr home: this repository's layout, mods and keys
  mkdir -p "$HERDR_APP_HOME/mods" "$HERDR_APP_HOME/layouts" "$HERDR_APP_HOME/data"
  for m in "$LAYOUT"/mods/*/; do ln -sfn "${m%/}" "$HERDR_APP_HOME/mods/$(basename "$m")"; done
  cp "$LAYOUT/layouts/workbench.json" "$HERDR_APP_HOME/layouts/workbench.json"
  cp "$LAYOUT/keys.json" "$HERDR_APP_HOME/keys.json"
  printf '{ "code_dir": "%s", "fleet": "%s" }\n' "$D/code" "$D/bin/fleet" > "$HERDR_APP_HOME/data/workbench.json"
  # Your look (theme, fonts), read from your own Herdr home: settings.json and themes/ only.
  own=${HERDR_LOOK_FROM:-$HOME/.config/herdr-app}
  [ -f "$own/settings.json" ] && python3 -c 'import json,sys; s=json.load(open(sys.argv[1])); s["telemetry"]=False; s.pop("machines",None); json.dump(s,open(sys.argv[2],"w"),indent=2)' "$own/settings.json" "$HERDR_APP_HOME/settings.json"
  [ -d "$own/themes" ] && mkdir -p "$HERDR_APP_HOME/themes" && cp "$own"/themes/*.json "$HERDR_APP_HOME/themes/" 2>/dev/null || true
}

do_() { "$APP" do "$@" >/dev/null; }

case ${1:-} in
  build)
    [ -e "$D/code" ] && { echo "$D/code exists: run clean first"; exit 1; }
    mkdir -p "$D/code" "$D/remotes" && : > "$MARK"
    build_web; build_api; build_handbook; wrapper; build_fleet; home
    echo "built $D" ;;
  up)
    home
    if ! "$APP" status >/dev/null 2>&1; then
      # Fully detached (its own session, no inherited pipes): a plain `&` left `up` waiting on the window.
      python3 -I -c 'import subprocess, sys
app, d = sys.argv[1:]
with open(f"{d}/app.log", "ab") as log:
    p = subprocess.Popen([app], cwd=d, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
open(f"{d}/app.pid", "w").write(str(p.pid))' "$APP" "$D"
      i=0; until "$APP" status >/dev/null 2>&1; do i=$((i + 1)); [ $i -gt 30 ] && { echo "the demo window didn't start"; exit 1; }; sleep 1; done
    fi
    do_ layout.switch '{"name":"workbench"}'
    # Spaces with named tabs: plain shells (zsh -f, no personal prompt or rc files) that first show something,
    # and stand-in agents (tests/demo/fake-agent.py) reporting working, blocked and done.
    HERE=$(cd "$(dirname "$0")" && pwd)
    python3 -I - "$APP" "$D" "$HERE" <<'PY'
import json, subprocess, sys, tempfile
app, d, here = sys.argv[1:]
def do(cmd, args):
    # Output to a file, not a pipe: a process herdr-app starts may keep a pipe open and hang the read.
    with tempfile.TemporaryFile("w+") as out:
        subprocess.run([app, "do", cmd, json.dumps(args)], stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.DEVNULL, check=True)
        out.seek(0)
        return json.loads(out.read() or "{}")
def shell(cmd):
    return ["/bin/zsh", "-fc", f'export PROMPT="%F{{blue}}%1~%f %# "; {cmd}; exec zsh -fi']
def agent(state, title, session):
    return ["python3", "-I", f"{here}/fake-agent.py", state, title, f"{here}/sessions/{session}.txt"]
web, api, book, fork = (f"{d}/code/{x}" for x in ("acme-web", "acme-api", "handbook", "forklift/forklift-demo"))
spaces = [
    ("Acme Web", [("Checkout", web, agent("working", "Checkout v2: payment via the API", "checkout")),
                  ("CSV Export", f"{web}/.worktrees/feat-csv-export", agent("blocked", "Export the cart as CSV", "csv-export")),
                  ("Git", web, shell("git log --graph --oneline --decorate --all -12"))]),
    ("Acme API", [("Refunds", api, agent("done", "Refunds for the payments API", "refunds")),
                  ("Shell", api, shell("git status -sb; ls app"))]),
    ("Handbook", [("Docs", book, shell("cat releases.md"))]),
    ("Forklift", [("Fleet Watch", fork, agent("working", "Run the forklift epic", "fleet-watch")),
                  ("Fleet", fork, shell(f"'{d}/bin/fleet' status"))]),
]
first_tabs = []
for name, tabs in spaces:
    (tname, folder, argv), rest = tabs[0], tabs[1:]
    sp = do("space.new", {"name": name, "folder": folder, "tab": tname, "argv": argv})
    first_tabs.append(sp["tab"])
    for tname, folder, argv in rest:
        do("tab.new", {"space": sp["space"], "name": tname, "folder": folder, "argv": argv, "focus": False})
do("tab.select", {"id": first_tabs[-1]})  # Forklift's Fleet Watch: the fleet board beside it shows that run
PY
    echo "up: HERDR_APP_HOME=$HERDR_APP_HOME" ;;
  fleet)
    (cd "$D/code/forklift/forklift-demo" && "$D/bin/fleet" run forklift --dry-run --beads-file "$D/code/forklift/beads.json" --fake-scripts "$D/code/forklift/scripts" --poll 1) ;;
  shot)
    "$APP" shot "${2:?file}" ;;
  down) # only the demo's window, wave and terminals; never anything of yours
    # The demo's core must not be your core: compare with the default session's.
    pid() { python3 -c 'import json,sys; print(json.load(sys.stdin).get("pid") or "")' 2>/dev/null; }
    demo=$(hc server status --json 2>/dev/null | pid); yours=$(env -u HC_SESSION hc server status --json 2>/dev/null | pid)
    if [ -n "$demo" ] && [ "$demo" = "$yours" ]; then echo "the demo's core is your own core: stopping, nothing touched" >&2; exit 1; fi
    "$APP" do app.quit >/dev/null 2>&1 || true
    [ -f "$D/app.pid" ] && { kill "$(cat "$D/app.pid")" 2>/dev/null || true; rm -f "$D/app.pid"; }
    [ -d "$D/code/forklift/forklift-demo" ] && (cd "$D/code/forklift/forklift-demo" && "$D/bin/fleet" stop --no-wait >/dev/null 2>&1 || true)
    # Only terminals whose folder is inside the demo folder.
    for t in $(hc ls --json 2>/dev/null | python3 -c 'import json,os,sys; d=sys.argv[1]; [print(t["address"]) for t in json.load(sys.stdin).get("terminals", []) if os.path.realpath(t.get("cwd") or "/").startswith(os.path.realpath(d) + "/")]' "$D" 2>/dev/null); do
      hc kill "$t" >/dev/null 2>&1 || true; hc rm "$t" >/dev/null 2>&1 || true
    done
    [ -n "$demo" ] && hc server stop >/dev/null 2>&1 || true
    rm -f "$HERDR_APP_HOME/view.json"  # its spaces: the next up starts empty
    echo "down" ;;
  clean)
    [ -f "$MARK" ] || { echo "$D has no demo marker ($MARK): not removing it" >&2; exit 1; }
    sh "$0" down; rm -rf "$D"; echo "removed $D" ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac
