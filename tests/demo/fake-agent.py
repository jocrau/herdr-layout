#!/usr/bin/env python3
"""A stand-in agent for the demo window: reports a status to Herdr (OSC 7501), sets its title and shows a short,
made-up session, then stays in the foreground so the status holds. No network, no model, nothing written.

    fake-agent.py <state> <title> <transcript file>     state: working, blocked, done or idle
"""
import sys
import time

state, title, path = sys.argv[1], sys.argv[2], sys.argv[3]
kind = ":kind=question" if state == "blocked" else ""
out = sys.stdout
out.write(f"\033]0;{title}\007")  # the terminal's title: the agents list shows it
out.write(f"\033]7501;state={state}:app=claude-code{kind}\007")
DIM, BOLD, BLUE, GREEN, YELLOW, OFF = "\033[2m", "\033[1m", "\033[34m", "\033[32m", "\033[33m", "\033[0m"
for line in open(path, encoding="utf-8").read().splitlines():
    # a tiny markup: "> " the person, "* " a tool call, "+ " a result, "? " a question, "~ " progress
    tag, text = line[:2], line[2:]
    if tag == "> ":
        out.write(f"{BOLD}> {text}{OFF}\n")
    elif tag == "* ":
        out.write(f"{GREEN}●{OFF} {BOLD}{text}{OFF}\n")
    elif tag == "+ ":
        out.write(f"  {DIM}⎿  {text}{OFF}\n")
    elif tag == "? ":
        out.write(f"\n{YELLOW}{BOLD}{text}{OFF}\n")
    elif tag == "~ ":
        out.write(f"\n{BLUE}✻ {text}…{OFF}\n")
    else:
        out.write(line + "\n")
out.flush()
while True:
    time.sleep(3600)
