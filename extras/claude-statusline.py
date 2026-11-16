#!/usr/bin/python3 -I
"""Claude Code status line, one line:

  acme-web ⎇ csv-export  main* ↑2↓5  Opus 5.5·high ⚡  ▰▰▰▱▱ 58% ↻180k/call  7d 100% on credits

repo (⎇ linked worktree), branch (* uncommitted, ↑ahead ↓behind), model
with effort (⚡ fast mode), context used as a bar (yellow from 60%, red
from 80%), and subscription usage only when a window is at 80% or more
(herdr-app's status bar shows it always).

Inside herdr-app (HC_TERMINAL_SOCKET is set) the repository, worktree and
branch name are left out: the space, tab and status bar show them. Only
what they don't show stays: "uncommitted" and ↑ahead ↓behind.

The burn hint `↻180k/call` shows, from 150k, how many tokens the last API
call read: every call (each tool step of a turn) re-reads the whole
context, so a large one uses the 5-hour and weekly limits fast, even when
the bar looks low on a 1M-token model. Time for /compact or a fresh session.

Also saves the rate limits for herdr-app's status bar (its usage-status mod
reads ~/.local/state/claude-usage.json).

Inside herdr-app it also labels its terminal with the context used
(claude.context=<percent>, only when the whole percent changes), which the
space-agents sidebar shows on each agent's row.

Inside herdr-app it also labels its terminal with the session (claude.session,
claude.folder), which herdr-core keeps across a reboot, so `claude-resume` can
bring the sessions back afterwards. Run with --session-end (a SessionEnd hook)
it drops the label, so a session you quit isn't resumed.

Set it as Claude Code's status line in ~/.claude/settings.json:

  "statusLine": {"type": "command", "command": "python3 -I ~/.claude/claude-statusline.py"}

and, for claude-resume, the hook:

  "hooks": {"SessionEnd": [{"hooks": [{"type": "command",
    "command": "python3 -I ~/.claude/claude-statusline.py --session-end"}]}]}
"""
import json
import os
import subprocess
import sys
import time

USAGE = os.path.expanduser("~/.local/state/claude-usage.json")
# The session each herdr terminal last showed, so its label is set only when it changes.
SEEN = os.path.expanduser("~/.local/state/claude-terminals")
BURN_FROM, BURN_HIGH = 150_000, 400_000  # tokens read per call: hint, then red
BLUE, GREEN, YELLOW, RED, GRAY, RESET = "\033[34m", "\033[32m", "\033[33m", "\033[31m", "\033[38;5;245m", "\033[0m"


def freshest(mine, saved):
    """Per window, the newer of this session's limits and the saved ones:
    the later reset, else (same window) the higher share, since usage only
    grows within a window. Each session only knows the limits from its own
    last API call, so an idle one would otherwise show, and save, old numbers."""
    merged = dict(saved or {})
    for key, window in (mine or {}).items():
        other = merged.get(key)
        if not isinstance(window, dict) or not isinstance(other, dict):
            merged[key] = window or other
            continue
        newer = (window.get("resets_at") or 0, window.get("used_percentage") or 0)
        older = (other.get("resets_at") or 0, other.get("used_percentage") or 0)
        merged[key] = window if newer >= older else other
    return merged


def marker(term, suffix=""):
    """This terminal's marker file: per herdr-core session too, so another session's t3 isn't this t3."""
    return os.path.join(SEEN, f"{os.environ.get('HC_SESSION') or 'default'}-{term}{suffix}")


def remember_session(data):
    """Labels this herdr terminal with its session and the folder to resume it from."""
    term, session = os.environ.get("HC_TERMINAL_ID"), data.get("session_id")
    folder = (data.get("workspace") or {}).get("project_dir") or data.get("cwd")
    if not term or not session or not folder or "/" in term:
        return
    mark, key = marker(term), f"{session}\n{folder}"
    try:
        with open(mark) as f:
            if f.read() == key:
                return
    except OSError:
        pass
    try:
        r = subprocess.run(["hc", "label", term, f"claude.session={session}", f"claude.folder={folder}"],
                           capture_output=True, timeout=3)
        if r.returncode == 0:
            os.makedirs(SEEN, exist_ok=True)
            with open(mark, "w") as f:
                f.write(key)
    except (OSError, subprocess.TimeoutExpired):
        pass


def report_context(data):
    """Labels this herdr terminal with the context used, for the agents sidebar."""
    term = os.environ.get("HC_TERMINAL_ID")
    used = (data.get("context_window") or {}).get("used_percentage")
    if not term or "/" in term or used is None:
        return
    mark, key = marker(term, ".context"), str(round(used))
    try:
        with open(mark) as f:
            if f.read() == key:
                return
    except OSError:
        pass
    try:
        r = subprocess.run(["hc", "label", term, f"claude.context={key}"], capture_output=True, timeout=3)
        if r.returncode == 0:
            os.makedirs(SEEN, exist_ok=True)
            with open(mark, "w") as f:
                f.write(key)
    except (OSError, subprocess.TimeoutExpired):
        pass


def forget_session():
    """SessionEnd: the session was quit (or cleared), so it isn't one to resume."""
    term = os.environ.get("HC_TERMINAL_ID")
    if not term or "/" in term:
        return
    try:
        subprocess.run(["hc", "label", term, "claude.session=", "claude.folder=", "claude.context="],
                       capture_output=True, timeout=3)
    except (OSError, subprocess.TimeoutExpired):
        pass
    for path in (marker(term), marker(term, ".context")):
        try:
            os.remove(path)
        except OSError:
            pass


def save_usage(data):
    """The rate limits merged with the saved ones (shown here and in herdr-app's
    status bar); written atomically. Returns the merged limits."""
    try:
        with open(USAGE, encoding="utf-8") as f:
            stored = json.load(f)
        saved, seen = stored.get("rate_limits"), stored.get("seen_at") or 0
    except (OSError, ValueError, AttributeError):
        saved, seen = None, 0
    limits = freshest(data.get("rate_limits"), saved)
    # Written only when Claude Code handed us limits (seen_at says when they were seen, so stale ones must not
    # look fresh), and then when they changed or a minute passed: not on every render.
    if not data.get("rate_limits") or (limits == saved and time.time() - seen < 60):
        return limits
    try:
        os.makedirs(os.path.dirname(USAGE), exist_ok=True)
        tmp = f"{USAGE}.{os.getpid()}"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"seen_at": int(time.time()), "rate_limits": limits or None}, f)
        os.replace(tmp, USAGE)
    except OSError:
        pass
    return limits


def git_state(cwd):
    """(branch, dirty, ahead, behind) from one quick git call;
    None outside a repo."""
    try:
        out = subprocess.run(["git", "-C", cwd, "--no-optional-locks", "status",
                              "--porcelain=v2", "--branch", "--untracked-files=normal"],
                             capture_output=True, text=True, timeout=1)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if out.returncode != 0:
        return None
    branch, ahead, behind, dirty = "", 0, 0, False
    for line in out.stdout.splitlines():
        if line.startswith("# branch.head "):
            branch = line.split(" ", 2)[2]
        elif line.startswith("# branch.oid ") and not branch:
            branch = line.split(" ", 2)[2][:7]
        elif line.startswith("# branch.ab "):
            a, b = line.split()[2:4]
            ahead, behind = int(a), -int(b)
        elif not line.startswith("#"):
            dirty = True
    if branch == "(detached)":
        branch = ""
    return branch, dirty, ahead, behind


def bar(percent, steps=5):
    filled = min(steps, round(percent / 100 * steps))
    return "▰" * filled + "▱" * (steps - filled)


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        data = {}
    limits = save_usage(data)
    remember_session(data)
    report_context(data)
    workspace = data.get("workspace") or {}
    cwd = workspace.get("current_dir") or data.get("cwd") or os.getcwd()
    parts = []

    repo = (workspace.get("repo") or {}).get("name")
    git = git_state(cwd)
    in_herdr = bool(os.environ.get("HC_TERMINAL_SOCKET"))
    if in_herdr:
        if git:
            _, dirty, ahead, behind = git
            sync = (f"↑{ahead}" if ahead else "") + (f"↓{behind}" if behind else "")
            if dirty:
                parts.append(f"{YELLOW}uncommitted{RESET}")
            if sync:
                parts.append(f"{GRAY}{sync}{RESET}")
    elif git and not repo:  # no origin remote: the checkout's top folder
        try:  # a stalled network folder mustn't hang the status line
            top = subprocess.run(["git", "-C", cwd, "rev-parse", "--show-toplevel"],
                                 capture_output=True, text=True, timeout=2).stdout.strip()
        except (OSError, subprocess.TimeoutExpired):
            top = ""
        repo = os.path.basename(top) if top else ""
    if not in_herdr:
        where = f"{BLUE}{repo or os.path.basename(cwd)}{RESET}"
        if workspace.get("git_worktree"):
            where += f" {GRAY}⎇{RESET} {BLUE}{workspace['git_worktree']}{RESET}"
        parts.append(where)

        if git:
            branch, dirty, ahead, behind = git
            text = f"{GREEN}{branch}{RESET}" + (f"{YELLOW}*{RESET}" if dirty else "")
            sync = (f"↑{ahead}" if ahead else "") + (f"↓{behind}" if behind else "")
            parts.append(text + (f" {GRAY}{sync}{RESET}" if sync else ""))

    model = (data.get("model") or {}).get("display_name")
    if model:
        effort = (data.get("effort") or {}).get("level")
        text = f"{GRAY}{model}{'·' + effort if effort else ''}{RESET}"
        if data.get("fast_mode"):
            text += f" {YELLOW}⚡{RESET}"
        parts.append(text)

    context = data.get("context_window") or {}
    used = context.get("used_percentage")
    if used is not None:
        color = RED if used >= 80 else YELLOW if used >= 60 else GRAY
        text = f"{color}{bar(used)} {used:.0f}%{RESET}"
        read = context.get("total_input_tokens") or 0
        if read >= BURN_FROM:
            text += f" {RED if read >= BURN_HIGH else YELLOW}↻{read / 1000:.0f}k/call{RESET}"
        parts.append(text)

    alerts, used_up, now = [], False, time.time()
    for key, label in (("five_hour", "5h"), ("seven_day", "7d")):
        window = limits.get(key) or {}
        percent = window.get("used_percentage")
        if percent is None or (window.get("resets_at") or now + 1) < now:
            continue
        if percent >= 80:
            alerts.append(f"{RED if percent >= 100 else YELLOW}{label} {percent:.0f}%{RESET}")
        used_up = used_up or percent >= 100
    if alerts:
        parts.append(" ".join(alerts) + (f" {RED}on credits{RESET}" if used_up else ""))

    print("  ".join(parts))


if __name__ == "__main__":
    if "--session-end" in sys.argv:
        forget_session()
        sys.exit(0)
    try:
        main()
    except Exception:
        print(os.path.basename(os.getcwd()))  # never leave the footer empty
