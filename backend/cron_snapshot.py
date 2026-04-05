#!/usr/bin/env python3
"""
Automated snapshot script — runs inside the Docker container.
Takes a net worth snapshot by directly accessing the SQLite database.

Add to crontab or use the Docker healthcheck/entrypoint to run monthly:
  0 6 1 * * python /app/backend/cron_snapshot.py
"""

import sqlite3
import json
from datetime import date
from pathlib import Path

DB_PATH = Path("/app/data/cairn.db")

ASSET_TYPES = {"PENSION_DC", "SIPP", "ISA_SS", "ISA_CASH", "CURRENT", "SAVINGS", "PROPERTY"}
LIABILITY_TYPES = {"MORTGAGE", "CREDIT_CARD", "LOAN"}


def take_snapshot():
    if not DB_PATH.exists():
        print(f"Database not found at {DB_PATH}")
        return

    db = sqlite3.connect(str(DB_PATH))
    db.row_factory = sqlite3.Row

    accounts = [dict(r) for r in db.execute("SELECT * FROM accounts").fetchall()]

    total_assets = sum(a["balance"] for a in accounts if a["type"] in ASSET_TYPES)
    total_liabilities = sum(abs(a["balance"]) for a in accounts if a["type"] in LIABILITY_TYPES)
    net_worth = total_assets - total_liabilities

    breakdown = {a["name"]: a["balance"] for a in accounts}
    snapshot_date = date.today().isoformat()

    db.execute("""
        INSERT OR REPLACE INTO snapshots (date, net_worth, total_assets, total_liabilities, breakdown)
        VALUES (?, ?, ?, ?, ?)
    """, (snapshot_date, net_worth, total_assets, total_liabilities, json.dumps(breakdown)))

    db.commit()
    db.close()

    print(f"Snapshot taken: {snapshot_date} | Net worth: £{net_worth:,.0f} "
          f"(Assets: £{total_assets:,.0f}, Liabilities: £{total_liabilities:,.0f})")


if __name__ == "__main__":
    take_snapshot()
