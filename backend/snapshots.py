"""Snapshot recording and backfill helpers.

Used by both the manual snapshot endpoint (POST /api/snapshots) and the
monthly cron job (cron_snapshot.py). Keeping category logic here means
adding a new account type only touches one place.
"""

import json
from datetime import date

from uk_tax import ASSET_TYPES, LIABILITY_TYPES, ISA_TYPES

# Categories shown on the Asset Mix stacked chart.
_CATEGORY_KEYS = ("pensions", "isas", "investments", "property", "cash", "debts")
_PENSION_TYPES = {"PENSION_DC", "SIPP", "PENSION_DB"}
_CASH_TYPES = {"CURRENT", "SAVINGS"}
_INVESTMENT_TYPES = {"GIA"}  # taxable wrappers — not ISAs, not pensions


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
        elif t in _INVESTMENT_TYPES:
            cats["investments"] += bal
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

    # Update in place when the date already exists, so the row keeps its id
    # (INSERT OR REPLACE would delete and re-create it).
    existing = db.execute("SELECT id FROM snapshots WHERE date = ?", (snapshot_date,)).fetchone()
    if existing:
        snapshot_id = existing[0]
        db.execute(
            "UPDATE snapshots SET net_worth = ?, total_assets = ?, total_liabilities = ?, breakdown = ?"
            " WHERE id = ?",
            (net_worth, total_assets, total_liabilities, json.dumps(breakdown), snapshot_id),
        )
    else:
        snapshot_id = db.execute(
            "INSERT INTO snapshots (date, net_worth, total_assets, total_liabilities, breakdown)"
            " VALUES (?, ?, ?, ?, ?)",
            (snapshot_date, net_worth, total_assets, total_liabilities, json.dumps(breakdown)),
        ).lastrowid
    _write_categories(db, snapshot_id, _categorise(accounts))
    db.commit()

    return snapshot_date, net_worth


def rescale_categories(db, snapshot_id, old_assets, old_liabs, new_assets, new_liabs):
    """Scale a snapshot's stored category rows to match edited totals, so the
    net-worth line and the stacked Asset Mix chart stay consistent. Asset
    categories scale with total assets, `debts` with total liabilities."""
    old_assets, old_liabs = old_assets or 0, old_liabs or 0
    if new_assets == old_assets and new_liabs == old_liabs:
        return
    cats = db.execute(
        "SELECT id, category, value FROM snapshot_categories WHERE snapshot_id = ?", (snapshot_id,)
    ).fetchall()
    for cat_id, category, value in cats:
        if category == "debts":
            new_val = value * (new_liabs / old_liabs) if old_liabs > 0 else -new_liabs
        else:
            new_val = value * (new_assets / old_assets) if old_assets > 0 else value
        db.execute("UPDATE snapshot_categories SET value = ? WHERE id = ?", (new_val, cat_id))


def upsert_snapshot_totals(db, snapshot_date, net_worth, total_assets, total_liabilities):
    """Insert a snapshot's totals, or update them if the date already exists.

    Unlike INSERT OR REPLACE this keeps an existing row's id, breakdown and
    category rows (rescaled if the totals changed) — re-importing a CSV must
    not wipe the Asset Mix history. Does not commit. Returns the snapshot id.
    """
    existing = db.execute(
        "SELECT id, total_assets, total_liabilities FROM snapshots WHERE date = ?", (snapshot_date,)
    ).fetchone()
    if existing:
        snapshot_id, old_assets, old_liabs = existing[0], existing[1], existing[2]
        db.execute(
            "UPDATE snapshots SET net_worth = ?, total_assets = ?, total_liabilities = ? WHERE id = ?",
            (net_worth, total_assets, total_liabilities, snapshot_id),
        )
        rescale_categories(db, snapshot_id, old_assets, old_liabs, total_assets, total_liabilities)
        return snapshot_id
    return db.execute(
        "INSERT INTO snapshots (date, net_worth, total_assets, total_liabilities) VALUES (?, ?, ?, ?)",
        (snapshot_date, net_worth, total_assets, total_liabilities),
    ).lastrowid


def needs_catch_up(db, today=None):
    """True when there are accounts but no snapshot dated in the current
    month — i.e. the container was down when the monthly cron should have run."""
    today = today or date.today()
    first_of_month = today.replace(day=1).isoformat()
    if db.execute("SELECT 1 FROM snapshots WHERE date >= ? LIMIT 1", (first_of_month,)).fetchone():
        return False
    return db.execute("SELECT 1 FROM accounts LIMIT 1").fetchone() is not None


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
