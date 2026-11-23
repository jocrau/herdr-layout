"""claude-statusline.py's usage merge: run with `python3 -m unittest discover -s tests/unit -p 'test_*.py'`."""
import importlib.util
import json
import os
import pathlib
import tempfile
import time
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "extras" / "claude-statusline.py"
spec = importlib.util.spec_from_file_location("statusline", SCRIPT)
sl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sl)

WEEK = 1_900_000_000


def week(pct, resets=WEEK):
    return {"seven_day": {"used_percentage": pct, "resets_at": resets}}


class Usage(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        sl.USAGE = os.path.join(self.tmp.name, "claude-usage.json")
        self.transcript = os.path.join(self.tmp.name, "t.jsonl")
        open(self.transcript, "w").close()

    def store(self, limits, seen=None, sessions=None):
        with open(sl.USAGE, "w") as f:
            json.dump({"seen_at": seen or int(time.time()), "rate_limits": limits, "sessions": sessions or {}}, f)

    def report(self, sid, limits, transcript_age=0):
        t = time.time() - transcript_age
        os.utime(self.transcript, (t, t))
        return sl.save_usage({"session_id": sid, "transcript_path": self.transcript, "rate_limits": limits})

    def pct(self):
        with open(sl.USAGE) as f:
            return json.load(f)["rate_limits"]["seven_day"]["used_percentage"]

    def test_a_reset_gives_usage_back_in_the_same_window(self):
        self.store(week(84), sessions={"a": {"limits": week(84), "at": int(time.time())}})
        self.report("a", week(11))
        self.assertEqual(self.pct(), 11)

    def test_an_idle_session_does_not_bring_old_numbers_back(self):
        self.store(week(11), sessions={"old": {"limits": week(84), "at": int(time.time())}})
        self.report("old", week(84))
        self.assertEqual(self.pct(), 11)

    def test_a_new_session_counts_when_its_transcript_is_newer(self):
        self.store(week(84), seen=int(time.time()) - 60)
        self.report("new", week(11))
        self.assertEqual(self.pct(), 11)

    def test_a_new_session_with_an_old_transcript_does_not(self):
        self.store(week(11), seen=int(time.time()) - 60)
        self.report("idle", week(84), transcript_age=3600)
        self.assertEqual(self.pct(), 11)

    def test_a_later_window_wins_even_from_an_idle_session(self):
        self.store(week(90), sessions={"old": {"limits": week(3, WEEK + 7 * 86400), "at": int(time.time())}})
        self.report("old", week(3, WEEK + 7 * 86400))
        self.assertEqual(self.pct(), 3)

    def test_news_from_an_older_window_is_ignored(self):
        self.store(week(5, WEEK + 7 * 86400))
        self.report("a", week(80))
        self.assertEqual(self.pct(), 5)

    def test_quiet_sessions_are_forgotten_after_a_week(self):
        self.store(week(10), sessions={"gone": {"limits": week(10), "at": int(time.time()) - 9 * 86400}})
        self.report("a", week(12))
        with open(sl.USAGE) as f:
            self.assertEqual(set(json.load(f)["sessions"]), {"a"})


if __name__ == "__main__":
    unittest.main()
