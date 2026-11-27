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
echo "$*" >> "$BV_LOG"
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
        os.environ.update(XDG_CACHE_HOME=str(root / "cache"), XDG_STATE_HOME=str(root / "state"), BV_FAIL=str(cls.fail), BV_LOG=str(root / "bd.log"))
        cls.log = root / "bd.log"
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

    ISSUES = [
        {"id": "x-1", "issue_type": "bug", "status": "open", "priority": 1, "labels": ["owner:alice"]},
        {"id": "x-2", "issue_type": "feature", "status": "open", "priority": 2, "assignee": "Bo Li",
         "dependencies": [{"depends_on_id": "x-1", "type": "blocks"}]},
        {"id": "x-3", "issue_type": "epic", "status": "in_progress", "priority": 1, "labels": ["risk", "type:odd"]},
        {"id": "x-4", "issue_type": "task", "status": "open", "priority": 3,
         "dependencies": [{"depends_on_id": "x-gone", "type": "blocks"}, {"depends_on_id": "x-3", "type": "parent-child"}]},
    ]

    def matching(self, *terms):
        issues = {i["id"]: i for i in self.ISSUES}
        return [i["id"] for i in self.ISSUES if self.bv.selects(i, list(terms), issues)]

    def test_filter_by_type_status_priority_and_assignee(self):
        self.assertEqual(self.matching("type:bug"), ["x-1"])
        self.assertEqual(self.matching("type:bug", "type:feature"), ["x-1", "x-2"])  # one kind: either
        self.assertEqual(self.matching("type:bug", "P2"), [])                       # kinds: all
        self.assertEqual(self.matching("status:in_progress"), ["x-3"])
        self.assertEqual(self.matching("P1", "!type:epic"), ["x-1"])
        self.assertEqual(self.matching("assignee:none"), ["x-1", "x-3", "x-4"])
        self.assertEqual(self.matching("assignee:Bo*"), ["x-2"])

    def test_ready_and_blocked_follow_open_blockers(self):
        # x-2 waits on the open x-1; x-4's blocker isn't listed (closed); x-3 is in progress, so not ready.
        self.assertEqual(self.matching("is:blocked"), ["x-2"])
        self.assertEqual(self.matching("is:ready"), ["x-1", "x-4"])

    def test_labels_keep_working_and_label_escapes_a_field_name(self):
        self.assertEqual(self.matching("owner:alice"), ["x-1"])
        self.assertEqual(self.matching("risk"), ["x-3"])
        self.assertEqual(self.matching("!risk", "P1"), ["x-1"])
        self.assertEqual(self.matching("label:type:odd"), ["x-3"])

    def test_status_closed_lists_closed_beads(self):
        st = self.state() | {"filter": ["status:closed"]}
        self.assertIn("--all", self.bv.list_args(st))
        self.assertNotIn("--all", self.bv.list_args(self.state() | {"filter": ["!status:closed"]}))

    def test_the_picker_offers_every_kind_in_order(self):
        self.assertEqual(self.bv.filter_choices(self.ISSUES), [
            "type:bug", "type:epic", "type:feature", "type:task",
            "status:open", "status:in_progress", "status:closed",
            "P1", "P2", "P3", "is:ready", "is:blocked", "assignee:Bo Li", "assignee:none",
            "risk", "owner:alice", "label:type:odd"])

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

    def test_coloured_runs_keep_their_colours(self):
        # The editor's status, priority and parent cells come coloured: their codes
        # must reach the terminal, not show as stand-ins (�[0m).
        out = self.bv.join_runs([(0, self.bv.status_text("open"), ""), (10, self.bv.priority_text(2), "")])
        self.assertNotIn("�", out)
        self.assertIn(self.bv.RESET, out)
        self.assertEqual(self.bv.visible_len(out), 12)

    def test_wide_characters_take_two_columns(self):
        t = "日本語のテキスト 👍 ok"
        self.assertEqual(self.bv.cols(t), 22)
        for s, e in self.bv.wrap_segments(t, 10):
            self.assertLessEqual(self.bv.cols(t[s:e]), 10)
        self.assertEqual(self.bv.visible_len(self.bv.clip(t, 9)), 9)

    def test_detail_text_is_wrapped_to_the_pane_so_it_scrolls_row_by_row(self):
        bv = self.bv
        line = f"  - a list item {bv.ACCENT}whose coloured text runs{bv.RESET} past the edge 日本語のテキスト ok"
        rows = bv.wrap_ansi(line, 20)
        self.assertGreater(len(rows), 2)
        for row in rows:
            self.assertLessEqual(bv.visible_len(row), 20)
        self.assertTrue(all(r.startswith("    ") for r in rows[1:]), "hanging indent under the item")
        self.assertIn(bv.ACCENT, rows[2], "a colour carries on to the next row")
        self.assertEqual(" ".join(bv.ANSI.sub("", r).strip() for r in rows), bv.ANSI.sub("", line).strip())
        self.assertEqual(bv.wrap_ansi("short", 20), ["short"])

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

    def closes(self, key):
        """Delete on x-1, answering `key`: the bd calls that change beads, and what was shown."""
        bv, shown = self.bv, []

        class FakeTerm:
            def __init__(self, over_fzf): pass
            def start(self): pass
            def stop(self): pass
            def size(self): return 24, 80
            def write(self, text): shown.append(text)
            def key(self): return key

        real, bv.Term = bv.Term, FakeTerm
        self.log.write_text("")
        try:
            bv.close_bead("x-1", self.state())
        finally:
            bv.Term = real
        return [l for l in self.log.read_text().splitlines() if l.startswith("close")], "".join(shown)

    def test_delete_closes_the_bead_on_y(self):
        calls, shown = self.closes("y")
        self.assertEqual(calls, ["close x-1"])
        self.assertIn("Close x-1", shown)
        self.assertIn("y/n", shown)

    def test_delete_closes_nothing_on_any_other_key(self):
        for key in ("n", "esc", "\x03"):
            self.assertEqual(self.closes(key)[0], [], key)


if __name__ == "__main__":
    unittest.main()
