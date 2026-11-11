"""Tests for backend/boe.py — the SQLite-backed Bank of England rate cache.

No network: the fetch function is injected.
    python -m unittest discover -s backend/tests
"""

import sqlite3
import sys
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import boe  # noqa: E402
from migrations import _m_create_boe_rate_cache  # noqa: E402

T0 = datetime(2026, 11, 11, 12, 0).timestamp()
LIVE = [{"date": "2025-12-18", "rate": 3.75}, {"date": "2026-11-05", "rate": 4.0}]


class Fetcher:
    def __init__(self, result=None, fail=False):
        self.result, self.fail, self.calls = result, fail, 0

    def __call__(self, now_dt):
        self.calls += 1
        if self.fail:
            raise OSError("network down")
        return self.result


class BoeCache(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        _m_create_boe_rate_cache(self.db)

    def tearDown(self):
        self.db.close()

    def test_live_result_is_cached_for_a_day(self):
        f = Fetcher(LIVE)
        r = boe.get_rates(self.db, T0, f)
        self.assertEqual(r["current_rate"], 4.0)
        self.assertNotIn("fallback", r)
        boe.get_rates(self.db, T0 + 3600, f)
        self.assertEqual(f.calls, 1)
        boe.get_rates(self.db, T0 + boe.LIVE_TTL_SECS + 1, f)
        self.assertEqual(f.calls, 2)

    def test_failure_with_nothing_cached_serves_fallback_and_retries_after_an_hour(self):
        bad = Fetcher(fail=True)
        r = boe.get_rates(self.db, T0, bad)
        self.assertTrue(r["fallback"])
        self.assertEqual(r["current_rate"], boe.FALLBACK_CHANGES[-1][1])
        boe.get_rates(self.db, T0 + 600, bad)
        self.assertEqual(bad.calls, 1)  # throttled
        good = Fetcher(LIVE)
        r = boe.get_rates(self.db, T0 + boe.RETRY_SECS + 1, good)
        self.assertEqual(good.calls, 1)  # a fallback is not held for 24h
        self.assertNotIn("fallback", r)

    def test_failure_keeps_earlier_live_data(self):
        boe.get_rates(self.db, T0, Fetcher(LIVE))
        later = T0 + boe.LIVE_TTL_SECS + 1
        bad = Fetcher(fail=True)
        r = boe.get_rates(self.db, later, bad)
        self.assertTrue(r["stale"])
        self.assertNotIn("fallback", r)
        self.assertEqual(r["current_rate"], 4.0)
        self.assertTrue(boe.get_rates(self.db, later + 60, bad)["stale"])
        self.assertEqual(bad.calls, 1)  # throttled

    def test_cached_current_rate_never_fetches(self):
        self.assertIsNone(boe.cached_current_rate(self.db))
        boe.get_rates(self.db, T0, Fetcher(LIVE))
        self.assertEqual(boe.cached_current_rate(self.db), 4.0)

    def test_cached_current_rate_tolerates_missing_table(self):
        empty = sqlite3.connect(":memory:")
        self.assertIsNone(boe.cached_current_rate(empty))
        empty.close()


class Fallback(unittest.TestCase):
    def test_history_is_in_date_order(self):
        dates = [d for d, _ in boe.FALLBACK_CHANGES]
        self.assertEqual(dates, sorted(dates))

    def test_monthly_series_tracks_changes(self):
        r = boe.fallback_result(datetime(2026, 11, 11))
        by_month = {m["date"]: m["rate"] for m in r["history"]}
        self.assertEqual(by_month["2025-06-01"], 4.25)
        self.assertEqual(by_month["2025-09-01"], 4.00)
        self.assertEqual(by_month["2026-01-01"], 3.75)
        self.assertEqual(r["history"][-1]["date"], "2026-11-01")
        self.assertEqual(r["current_date"], "2026-11-05")


if __name__ == "__main__":
    unittest.main()
