#!/usr/bin/env python3
"""Automated monthly snapshot — runs inside the Docker container via cron.

Delegates to backend.snapshots.take_snapshot so that the cron-taken row
includes the same category breakdown as a manual snapshot, keeping the
Asset Mix stacked chart populated.

Scheduled by the Dockerfile crontab:
  0 6 1 * * python /app/backend/cron_snapshot.py
"""

import sys
import sqlite3
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from snapshots import take_snapshot

DB_PATH = Path("/app/data/cairn.db")


def main():
    if not DB_PATH.exists():
        print(f"Database not found at {DB_PATH}")
        return

    db = sqlite3.connect(str(DB_PATH))
    db.row_factory = sqlite3.Row
    try:
        snapshot_date, net_worth = take_snapshot(db)
        print(f"Snapshot taken: {snapshot_date} | Net worth: £{net_worth:,.0f}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
