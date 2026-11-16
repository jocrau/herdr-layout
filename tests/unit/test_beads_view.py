"""beads-view with a fake bd: run with `python3 -m unittest discover -s tests/unit -p 'test_*.py'`."""
import importlib.machinery
import importlib.util
import json
import os
import pathlib
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve()
SCRIPT = HERE.parents[2] / "mods" / "beads" / "beads-view"

FAKE_BD = """#!/bin/sh
if [ -f "$BV_FAIL" ]; then echo "database is locked" >&2; exit 1; fi
case "$*" in *--json*) echo '[{"id":"x-1","title":"One"}]';; *) echo "○ x-1 One";; esac
"""


class BeadsView(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = pathlib.Path(cls.tmp.name)
        (root / "repo" / ".beads").mkdir(parents=True)
        bd = root / "bd"
        bd.write_text(FAKE_BD)
        bd.chmod(0o755)
        cls.fail = root / "fail"
        os.environ.update(XDG_CACHE_HOME=str(root / "cache"), XDG_STATE_HOME=str(root / "state"), BV_FAIL=str(cls.fail))
        cls.cwd = os.getcwd()
        os.chdir(root / "repo")  # beads-view finds the repo by its .beads folder
        loader = importlib.machinery.SourceFileLoader("beads_view", str(SCRIPT))
        spec = importlib.util.spec_from_loader("beads_view", loader)
        cls.bv = importlib.util.module_from_spec(spec)
        loader.exec_module(cls.bv)
        cls.bv.BD = str(bd)

    @classmethod
    def tearDownClass(cls):
        os.chdir(cls.cwd)
        cls.tmp.cleanup()

    def state(self):
        return {"all": False, "stack": [], "collapsed": ["zz"], "filter": ["owner:alice"]}

    def test_a_failing_bd_keeps_the_last_list(self):
        st = self.state()
        good = self.bv.fetch(st, fresh=True)
        self.assertFalse(self.bv.BD_FAILED)
        self.fail.touch()
        try:
            self.assertEqual(self.bv.fetch(st, fresh=True), good)
            self.assertTrue(self.bv.BD_FAILED)
        finally:
            self.fail.unlink()
        self.bv.fetch(st, fresh=True)
        self.assertFalse(self.bv.BD_FAILED)

    def test_control_characters_are_drawn_visibly(self):
        evil = "hi \x1b]52;c;ZXZpbA==\x07 there \x1b[2J"
        out = self.bv.clip(self.bv.join_runs([(0, evil, self.bv.DIM)]), 40)
        self.assertNotIn("\x1b]", out)
        self.assertNotIn("\x07", out)
        self.assertNotIn("\x1b[2J", out)
        self.assertIn(self.bv.DIM, out, "colour codes stay")
        self.assertEqual(len(self.bv.safe(evil)), len(evil), "one for one, so the editor's columns hold")

    def test_wide_characters_take_two_columns(self):
        t = "日本語のテキスト 👍 ok"
        self.assertEqual(self.bv.cols(t), 22)
        for s, e in self.bv.wrap_segments(t, 10):
            self.assertLessEqual(self.bv.cols(t[s:e]), 10)
        self.assertEqual(self.bv.visible_len(self.bv.clip(t, 9)), 9)

    def test_select_of_a_missing_bead_leaves_the_view_alone(self):
        st = self.state()
        self.bv.save(st)
        self.assertIsNone(self.bv.reveal("nope-9", st))
        self.assertEqual(st, self.state())
        self.assertEqual(json.load(open(self.bv.STATE_FILE)), self.state())

    def test_select_finds_a_bead_and_shows_it(self):
        st = self.state()
        self.assertEqual(self.bv.reveal("x-1", st), 1)


    def test_prefetch_drops_old_panes_and_fills_missing_ones_from_one_listing(self):
        bv = self.bv
        issues = {"x-1": {"id": "x-1", "title": "One"}}
        current = bv.stamp(issues["x-1"], issues)
        os.makedirs(bv.DETAIL_DIR, exist_ok=True)
        keep = [f"x-1@{current}@40", "x-10@oldstamp@80"]  # another width of this version; another bead
        for name in keep + ["x-1@oldstamp@80"]:
            pathlib.Path(bv.DETAIL_DIR, name).write_text("pane")
        made = []
        real = bv.cached_detail
        bv.cached_detail = lambda bead_id, bead_stamp: made.append((bead_id, bead_stamp))
        try:
            bv.prefetch(self.state() | {"filter": []}, budget=1)
        finally:
            bv.cached_detail = real
        self.assertEqual(sorted(os.listdir(bv.DETAIL_DIR)), sorted(keep))
        self.assertEqual(made, [("x-1", current)] if bv.preview_width() != 40 else [])


if __name__ == "__main__":
    unittest.main()
