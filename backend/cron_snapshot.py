#!/usr/bin/env python3
"""Automated monthly snapshot — runs inside the Docker container via cron.

Delegates to backend.snapshots.take_snapshot so that the cron-taken row
includes the same category breakdown as a manual snapshot, keeping the
Asset Mix stacked chart populated.

Scheduled by the Dockerfile crontab:
  0 6 1 * * python /app/backend/cron_snapshot.py

entrypoint.sh also runs it with --catch-up on every container start, which
takes a snapshot only if the current month has none (the container was down
on the 1st).
"""

import os
import sys
import sqlite3
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from snapshots import take_snapshot, needs_catch_up

# Same resolution as db_auth.py, so DATA_DIR is honoured here too.
BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("DATA_DIR", BASE_DIR / "data")) / "cairn.db"


def main():
    if not DB_PATH.exists():
        print(f"Database not found at {DB_PATH}")
        return

    db = sqlite3.connect(str(DB_PATH))
    db.row_factory = sqlite3.Row
    try:
        # --catch-up (run by entrypoint.sh on every start): only take a
        # snapshot if this month doesn't have one yet.
        if "--catch-up" in sys.argv[1:] and not needs_catch_up(db):
            return
        snapshot_date, net_worth = take_snapshot(db)
        print(f"Snapshot taken: {snapshot_date} | Net worth: £{net_worth:,.0f}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
