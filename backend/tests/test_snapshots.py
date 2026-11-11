"""Tests for backend/snapshots.py against an in-memory database (no Flask).

    python -m unittest discover -s backend/tests
"""

import sqlite3
import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from snapshots import needs_catch_up, take_snapshot, upsert_snapshot_totals  # noqa: E402

SCHEMA = """
CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT, type TEXT, balance REAL);
CREATE TABLE snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL UNIQUE,
    net_worth REAL NOT NULL, total_assets REAL NOT NULL DEFAULT 0,
    total_liabilities REAL NOT NULL DEFAULT 0, breakdown TEXT DEFAULT '{}');
CREATE TABLE snapshot_categories (id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL, category TEXT NOT NULL, value REAL NOT NULL DEFAULT 0);
"""


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)

    def tearDown(self):
        self.db.close()

    def add_accounts(self):
        self.db.executemany("INSERT INTO accounts (name, type, balance) VALUES (?, ?, ?)", [
            ("Example SIPP", "SIPP", 60000), ("Example ISA", "ISA_SS", 20000),
            ("Example Loan", "LOAN", -5000),
        ])

    def cats(self, snapshot_id):
        return dict(self.db.execute(
            "SELECT category, value FROM snapshot_categories WHERE snapshot_id = ?", (snapshot_id,)))

    def test_take_snapshot_totals_and_categories(self):
        self.add_accounts()
        day, net_worth = take_snapshot(self.db, "2026-10-01")
        self.assertEqual((day, net_worth), ("2026-10-01", 75000))
        sid = self.db.execute("SELECT id FROM snapshots").fetchone()[0]
        cats = self.cats(sid)
        self.assertEqual((cats["pensions"], cats["isas"], cats["debts"]), (60000, 20000, -5000))

    def test_retaking_a_snapshot_keeps_one_row_and_one_set_of_categories(self):
        self.add_accounts()
        take_snapshot(self.db, "2026-10-01")
        first_id = self.db.execute("SELECT id FROM snapshots").fetchone()[0]
        self.db.execute("UPDATE accounts SET balance = 65000 WHERE type = 'SIPP'")
        take_snapshot(self.db, "2026-10-01")
        rows = self.db.execute("SELECT id, net_worth FROM snapshots").fetchall()
        self.assertEqual([tuple(r) for r in rows], [(first_id, 80000)])
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM snapshot_categories").fetchone()[0], 6)
        self.assertEqual(self.cats(first_id)["pensions"], 65000)

    def test_upsert_rescales_existing_categories(self):
        self.add_accounts()
        take_snapshot(self.db, "2026-10-01")
        sid = upsert_snapshot_totals(self.db, "2026-10-01", 85000, 88000, 3000)
        cats = self.cats(sid)
        self.assertAlmostEqual(cats["pensions"], 66000)
        self.assertAlmostEqual(cats["isas"], 22000)
        self.assertAlmostEqual(cats["debts"], -3000)

    def test_upsert_inserts_new_dates(self):
        sid = upsert_snapshot_totals(self.db, "2020-01-01", 1000, 1000, 0)
        self.assertEqual(self.db.execute("SELECT date FROM snapshots WHERE id = ?", (sid,)).fetchone()[0], "2020-01-01")
        self.assertEqual(self.cats(sid), {})

    def test_catch_up_only_when_this_month_is_missing(self):
        today = date(2026, 11, 20)
        self.assertFalse(needs_catch_up(self.db, today))      # no accounts yet
        self.add_accounts()
        self.assertTrue(needs_catch_up(self.db, today))
        take_snapshot(self.db, "2026-10-01")
        self.assertTrue(needs_catch_up(self.db, today))       # last month doesn't count
        take_snapshot(self.db, "2026-11-03")
        self.assertFalse(needs_catch_up(self.db, today))


if __name__ == "__main__":
    unittest.main()
