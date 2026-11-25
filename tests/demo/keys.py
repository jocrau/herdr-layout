#!/usr/bin/env python3
"""Press keys on a board in the demo window and check what it shows (lib/testkeys.js), so keyboard behaviour is
tested without a person at the window. Demo only: it talks to the demo's Herdr home and refuses anything else.

  python3 -I tests/demo/keys.py fleet-board j j enter      # press keys, print the board's state after each
  python3 -I tests/demo/keys.py --run tests/demo/keys/*.keys  # run scenarios, exit 1 on the first failed expect

A scenario is one step per line (# comments):
  open fleet-board            the board as a dialog (mod.open), the keyboard on it
  close fleet-board           mod.open again (it toggles)
  show prs / hide prs         a layout block (a docked board's column)
  press fleet-board j enter   keys, in order
  expect open != null         a field of the last state, compared with a JSON value (== or !=)
  until fleet-board rows != 0 ask for the state until it holds (data still loading), up to 10 s
  still fleet-board enter     press a key; fail when rows of the window moved up or down (a layout shift)
  shot fleet-open             save the window as $KEYS_SHOTS/fleet-open.png (compare a change's before and after)

Start the demo first: sh tests/demo/make-demo.sh build && sh tests/demo/make-demo.sh up.
"""
import json, os, shlex, shutil, subprocess, sys, tempfile, time

D = os.environ.get("HERDR_DEMO", "/tmp/herdr-demo")
HOME = f"{D}/home"
ENV = {k: v for k, v in os.environ.items() if not k.startswith("HC_")} | {"HERDR_APP_HOME": HOME, "HC_SESSION": "herdr-demo"}
APP = os.environ.get("HERDR_APP") or "herdr-app"
SETTLE = float(os.environ.get("KEYS_SETTLE", "0.3"))  # seconds between a key and reading the state


class NotLoaded(Exception):
    pass


def do(cmd, args=None):
    # Output to a file, not a pipe: a process herdr-app starts may keep a pipe open and hang the read.
    with tempfile.TemporaryFile("w+") as out:
        argv = [APP, "do", cmd] + ([json.dumps(args)] if args is not None else [])
        r = subprocess.run(argv, env=ENV, stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT, timeout=20)
        out.seek(0)
        text = out.read()
    if r.returncode != 0:
        if "need the mod loaded" in text:
            raise NotLoaded(cmd)
        raise SystemExit(f"keys: {cmd} failed: {text.strip()}")
    return text


def check_demo():
    if not os.path.exists(f"{D}/.herdr-demo"):
        raise SystemExit(f"keys: no demo at {D} (sh tests/demo/make-demo.sh build)")
    r = subprocess.run([APP, "status"], env=ENV, capture_output=True, text=True, timeout=20)
    if r.returncode != 0:
        raise SystemExit("keys: the demo window isn't running (sh tests/demo/make-demo.sh up)")
    try:
        settings = json.load(open(f"{HOME}/data/workbench.json"))
    except OSError:
        settings = {}
    if settings.get("test_keys") is not True:
        raise SystemExit("keys: test_keys is off in the demo's data/workbench.json (make-demo.sh up turns it on)")


def report(mod):
    try:
        return json.load(open(f"{HOME}/data/test-keys.{mod}.json"))
    except (OSError, ValueError):
        return None


def press(mod, key):
    try:
        answer(mod, f"test.key.{key}", key)
    except NotLoaded:
        raise SystemExit(f"keys: {mod} isn't loaded: open it first (and reload the layout after a mod change)")
    frame()  # draw what the key changed at once: a field only takes focus once it's drawn
    time.sleep(SETTLE)  # what the key starts (focus moves, renders) lands, then the state is read
    try:
        return answer(mod, "test.state", key)
    except NotLoaded:
        return {"shown": False, "loaded": False}  # the key closed it: a closed dialog's mod is unloaded


FRAMES = tempfile.mkdtemp(prefix="herdr-keys-")


def frame(name="frame"):
    """Draw the demo window and save it: a window behind others isn't drawn, and a board fills its rows when drawn."""
    path = f"{FRAMES}/{name}.png"
    with tempfile.TemporaryFile("w+") as out:
        subprocess.run([APP, "shot", path], env=ENV, stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT, timeout=30, check=True)
    return path


def answer(mod, command, key):
    if command == "test.state":
        frame()
    before = (report(mod) or {}).get("at", 0)
    do(f"{mod}.{command}")
    deadline = time.time() + (5 if command == "test.state" else 2)
    while time.time() < deadline:
        r = report(mod)
        if r and r.get("at", 0) > before:
            if r.get("error"):
                raise SystemExit(f"keys: {mod} {key}: {r['error']}")
            return r["state"]
        time.sleep(0.05)
    if command == "test.state":
        raise SystemExit(f"keys: {mod} didn't answer after {key} (reload the layout after a mod change)")
    return None  # no answer to the key itself: it may have closed the board (press then asks for the state)


def overlays():
    r = subprocess.run([APP, "status"], env=ENV, capture_output=True, text=True, timeout=20)
    return json.loads(r.stdout or "{}").get("overlays") or []


def dialog(mod, want_open):
    """Open or close a board's dialog (mod.open toggles, so only when needed); open waits until it answers."""
    if (mod in overlays()) != want_open:
        do("mod.open", {"name": mod})
    if not want_open:
        return {"shown": False, "loaded": False}
    deadline = time.time() + 8
    while time.time() < deadline:
        try:
            time.sleep(0.3)
            return answer(mod, "test.state", "open")
        except NotLoaded:
            pass
    raise SystemExit(f"keys: {mod} didn't load as a dialog")


def pixels(png):
    """A PNG's pixel rows as bytes, through macOS's sips (no Python imaging library needed): (width, rows)."""
    bmp = png[:-4] + ".bmp"
    subprocess.run(["sips", "-s", "format", "bmp", png, "--out", bmp], capture_output=True, check=True)
    data = open(bmp, "rb").read()
    off, w, h, bpp = (int.from_bytes(data[a:b], "little", signed=True) for a, b in ((10, 14), (18, 22), (22, 26), (28, 30)))
    stride = (w * bpp // 8 + 3) & ~3
    rows = [data[off + y * stride: off + y * stride + w * bpp // 8] for y in range(abs(h))]
    return w, rows if h < 0 else rows[::-1]  # bottom-up unless the height is negative


def shifts(before, after, min_run=12):
    """Rows that moved: runs of at least min_run pixel rows, each found exactly once in both frames (so repeated
    things like two identical avatars or blank lines aren't evidence), at another height after the key.
    Returns [(first row, last row, offset)]. Rows that only changed (a selection, a new line) don't count."""
    _, a = pixels(before)
    _, b = pixels(after)
    count_a, where = {}, {}
    for r in a:
        count_a[r] = count_a.get(r, 0) + 1
    for y, r in enumerate(b):
        where.setdefault(r, []).append(y)
    moved, run = [], None
    for y, r in enumerate(a):
        ys = where.get(r)
        d = ys[0] - y if count_a[r] == 1 and ys and len(ys) == 1 and ys[0] != y else None
        if d and run and run[2] == d and y == run[1] + 1:
            run[1] = y
        else:
            if run and run[1] - run[0] + 1 >= min_run:
                moved.append(tuple(run))
            run = [y, y, d] if d else None
    if run and run[1] - run[0] + 1 >= min_run:
        moved.append(tuple(run))
    return moved


def expect(state, line):
    for op in ("!=", "=="):
        if op in line:
            field, want = (s.strip() for s in line.split(op, 1))
            break
    else:
        raise SystemExit(f"keys: expect needs == or !=: {line}")
    got = state
    for part in field.split("."):
        got = got.get(part) if isinstance(got, dict) else None
    want = json.loads(want)
    ok = (got == want) if op == "==" else (got != want)
    return ok, f"{field} {op} {json.dumps(want)} (is {json.dumps(got)})"


def run(path):
    state, n = None, 0
    for raw in open(path):
        line = raw.split(" #", 1)[0].strip()
        if not line or line.startswith("#"):
            continue
        n += 1
        word, rest = line.split(None, 1) if " " in line else (line, "")
        if word in ("open", "close"):
            state = dialog(rest.strip(), word == "open")
        elif word in ("show", "hide"):  # a layout block: show prs (a docked board's column)
            do(f"layout.{word}", {"id": rest.strip()})
            time.sleep(0.5)
        elif word == "press":
            mod, *keys = shlex.split(rest)
            for k in keys:
                state = press(mod, k)
        elif word == "expect":
            if state is None:
                raise SystemExit(f"{path}:{n}: expect before any press")
            ok, text = expect(state, rest)
            print(f"  {'ok  ' if ok else 'FAIL'} {text}")
            if not ok:
                return False
        elif word == "until":  # until <mod> <field> == <json>: poll the state (data loading), up to 10 s
            mod, cond = rest.split(None, 1)
            deadline = time.time() + 10
            while True:
                try:
                    state = answer(mod, "test.state", "until")
                except NotLoaded:
                    if time.time() > deadline:
                        raise SystemExit(f"keys: {mod} didn't load")
                    time.sleep(0.3)
                    continue
                ok, text = expect(state, cond)
                if ok or time.time() > deadline:
                    break
                time.sleep(0.3)
            print(f"  {'ok  ' if ok else 'FAIL'} until {text}")
            if not ok:
                return False
        elif word == "still":  # still <mod> <key>: press it; no row above what it changed may move (layout shift)
            mod, key = shlex.split(rest)
            a = frame("before")
            state = press(mod, key)
            moved = shifts(a, frame("after"))
            text = "nothing moved" if not moved else "moved: " + ", ".join(f"rows {y0}-{y1} by {d:+d}px" for y0, y1, d in moved[:4])
            print(f"  {'ok  ' if not moved else 'FAIL'} still {key}: {text}")
            if moved:
                print(f"       frames: {a} {FRAMES}/after.png")
                return False
        elif word == "shot":  # shot <name>: the window saved as $KEYS_SHOTS/<name>.png (a before/after tour)
            out = os.environ.get("KEYS_SHOTS") or FRAMES
            os.makedirs(out, exist_ok=True)
            shutil.copy(frame(), f"{out}/{rest.strip()}.png")
        elif word == "wait":
            time.sleep(float(rest or 0.5))
        else:
            raise SystemExit(f"{path}:{n}: unknown step {word}")
    return True


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__); return 0
    check_demo()
    if argv[0] == "--run":
        failed = 0
        for path in argv[1:]:
            print(os.path.basename(path))
            if not run(path):
                failed += 1
        print(f"{len(argv) - 1 - failed} passed, {failed} failed")
        if not failed:
            shutil.rmtree(FRAMES, ignore_errors=True)  # a failed run keeps its frames (the FAIL line names them)
        return 1 if failed else 0
    mod, *keys = argv
    for k in keys:
        print(k, json.dumps(press(mod, k)))
    shutil.rmtree(FRAMES, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
