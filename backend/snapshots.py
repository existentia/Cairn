"""Snapshot recording and backfill helpers.

Used by both the manual snapshot endpoint (POST /api/snapshots) and the
monthly cron job (cron_snapshot.py). Keeping category logic here means
adding a new account type only touches one place.
"""

import json
from datetime import date

from uk_tax import ASSET_TYPES, LIABILITY_TYPES, ISA_TYPES

# Categories shown on the Asset Mix stacked chart.
_CATEGORY_KEYS = ("pensions", "isas", "property", "cash", "debts")
_PENSION_TYPES = {"PENSION_DC", "SIPP", "PENSION_DB"}
_CASH_TYPES = {"CURRENT", "SAVINGS"}


def _categorise(accounts):
    """Sum balances per category for a list of account-like rows."""
    cats = {k: 0 for k in _CATEGORY_KEYS}
    for a in accounts:
        t = a["type"]
        bal = a["balance"]
        if t in _PENSION_TYPES:
            cats["pensions"] += bal
        elif t in ISA_TYPES:
            cats["isas"] += bal
        elif t == "PROPERTY":
            cats["property"] += bal
        elif t in _CASH_TYPES:
            cats["cash"] += bal
        elif t in LIABILITY_TYPES:
            cats["debts"] -= abs(bal)
    return cats


def _write_categories(db, snapshot_id, cats):
    db.execute("DELETE FROM snapshot_categories WHERE snapshot_id = ?", (snapshot_id,))
    for cat, value in cats.items():
        db.execute(
            "INSERT INTO snapshot_categories (snapshot_id, category, value) VALUES (?, ?, ?)",
            (snapshot_id, cat, value),
        )


def take_snapshot(db, snapshot_date=None):
    """Write a snapshot of current account state. Replaces any existing
    row for the same date. Returns (snapshot_date, net_worth)."""
    if snapshot_date is None:
        snapshot_date = date.today().isoformat()

    accounts = db.execute("SELECT * FROM accounts").fetchall()
    total_assets = sum(a["balance"] for a in accounts if a["type"] in ASSET_TYPES)
    total_liabilities = sum(abs(a["balance"]) for a in accounts if a["type"] in LIABILITY_TYPES)
    net_worth = total_assets - total_liabilities
    breakdown = {a["name"]: a["balance"] for a in accounts}

    db.execute(
        "INSERT OR REPLACE INTO snapshots (date, net_worth, total_assets, total_liabilities, breakdown)"
        " VALUES (?, ?, ?, ?, ?)",
        (snapshot_date, net_worth, total_assets, total_liabilities, json.dumps(breakdown)),
    )
    db.commit()

    snap_row = db.execute("SELECT id FROM snapshots WHERE date = ?", (snapshot_date,)).fetchone()
    if snap_row:
        _write_categories(db, snap_row["id"], _categorise(accounts))
        db.commit()

    return snapshot_date, net_worth


def backfill_missing_categories(db):
    """Populate snapshot_categories for any snapshots that have none.

    Idempotent — only touches snapshots with zero category rows, so safe
    to call on every container start. Account types are looked up by name
    from the current accounts table; snapshots whose accounts were since
    renamed or deleted are filled in partially (matched names only) or
    skipped if nothing matches.

    Returns the count of snapshots that received new category rows.
    """
    accounts = db.execute("SELECT name, type FROM accounts").fetchall()
    type_by_name = {a["name"]: a["type"] for a in accounts}
    if not type_by_name:
        return 0

    missing = db.execute(
        "SELECT s.id, s.breakdown FROM snapshots s"
        " WHERE NOT EXISTS (SELECT 1 FROM snapshot_categories c WHERE c.snapshot_id = s.id)"
    ).fetchall()
    if not missing:
        return 0

    fixed = 0
    for snap in missing:
        try:
            breakdown = json.loads(snap["breakdown"] or "{}")
        except (json.JSONDecodeError, TypeError):
            continue

        synth = []
        for name, balance in breakdown.items():
            t = type_by_name.get(name)
            if t is None:
                continue
            synth.append({"name": name, "type": t, "balance": balance})
        if not synth:
            continue

        cats = _categorise(synth)
        _write_categories(db, snap["id"], cats)
        fixed += 1

    if fixed:
        db.commit()
    return fixed
