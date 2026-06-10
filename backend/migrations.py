"""Schema and data migrations.

Replaces the ad-hoc `PRAGMA table_info` introspection that lived in
init_db(). Each migration is named, recorded in `schema_migrations` once
applied, and skipped on subsequent runs. Add new migrations to the bottom
of MIGRATIONS — never re-order or rename existing entries.

The list is intentionally tolerant of pre-existing state: ALTER TABLE
migrations that hit "duplicate column" are silently marked applied,
which is what lets databases created before this framework existed
transition into it without manual fixup.
"""

import sqlite3

from snapshots import backfill_missing_categories


def _alter_add_column(table, col_def):
    """Returns a migration callable that adds a column. Tolerates the
    column already existing (pre-existing DBs that match the target shape)."""
    sql = f"ALTER TABLE {table} ADD COLUMN {col_def}"

    def run(db):
        try:
            db.execute(sql)
        except sqlite3.OperationalError as e:
            if "duplicate column name" not in str(e).lower():
                raise

    return run


def _m_backfill_snapshot_categories(db):
    fixed = backfill_missing_categories(db)
    if fixed:
        print(f"Backfilled snapshot_categories for {fixed} snapshot(s).")


def _m_backfill_investments_category(db):
    """Add the `investments` (GIA) category row to snapshots that predate it.

    Snapshots taken before GIA joined _CATEGORY_KEYS have category rows but
    no `investments` entry, so GIA balances were invisible on the stacked
    chart. Fill it in from the stored breakdown JSON where GIA accounts can
    be matched by name (best-effort, same convention as the main backfill).
    """
    import json

    gia_names = {r["name"] for r in db.execute("SELECT name FROM accounts WHERE type = 'GIA'").fetchall()}
    if not gia_names:
        return

    snaps = db.execute(
        "SELECT s.id, s.breakdown FROM snapshots s"
        " WHERE EXISTS (SELECT 1 FROM snapshot_categories c WHERE c.snapshot_id = s.id)"
        " AND NOT EXISTS (SELECT 1 FROM snapshot_categories c"
        "                 WHERE c.snapshot_id = s.id AND c.category = 'investments')"
    ).fetchall()
    for snap in snaps:
        try:
            breakdown = json.loads(snap["breakdown"] or "{}")
        except (json.JSONDecodeError, TypeError):
            continue
        value = sum(bal for name, bal in breakdown.items() if name in gia_names)
        if value:
            db.execute(
                "INSERT INTO snapshot_categories (snapshot_id, category, value) VALUES (?, 'investments', ?)",
                (snap["id"], value),
            )


# Migrations are applied in list order. Names are permanent — they are
# the key in `schema_migrations`. Don't rename or remove past entries.
MIGRATIONS = [
    ("001_settings_add_tracker_margin",
     _alter_add_column("settings", "tracker_margin REAL NOT NULL DEFAULT 0.5")),
    ("002_settings_add_mortgage_remaining_years",
     _alter_add_column("settings", "mortgage_remaining_years INTEGER NOT NULL DEFAULT 20")),
    ("003_settings_add_net_worth_target",
     _alter_add_column("settings", "net_worth_target REAL NOT NULL DEFAULT 0")),
    ("004_settings_add_net_worth_target_date",
     _alter_add_column("settings", "net_worth_target_date TEXT NOT NULL DEFAULT ''")),
    ("005_settings_add_tax_region",
     _alter_add_column("settings", "tax_region TEXT NOT NULL DEFAULT 'scotland'")),
    ("006_profile_add_state_pension_annual",
     _alter_add_column("profile", "state_pension_annual REAL NOT NULL DEFAULT 11500")),
    ("007_accounts_add_total_contributed",
     _alter_add_column("accounts", "total_contributed REAL NOT NULL DEFAULT 0")),
    ("008_accounts_add_db_annual_pension",
     _alter_add_column("accounts", "db_annual_pension REAL NOT NULL DEFAULT 0")),
    ("009_backfill_snapshot_categories", _m_backfill_snapshot_categories),
    ("010_profile_add_employer_match_max_pct",
     _alter_add_column("profile", "employer_match_max_pct REAL NOT NULL DEFAULT 0")),
    ("011_accounts_add_unrealised_gain",
     _alter_add_column("accounts", "unrealised_gain REAL NOT NULL DEFAULT 0")),
    ("012_profile_add_children_count",
     _alter_add_column("profile", "children_count INTEGER NOT NULL DEFAULT 0")),
    ("013_profile_add_spouse_income",
     _alter_add_column("profile", "spouse_income REAL NOT NULL DEFAULT 0")),
    ("014_backfill_investments_category", _m_backfill_investments_category),
]


def run_migrations(db):
    """Apply any not-yet-applied migrations. Returns the count applied."""
    db.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations ("
        " name TEXT PRIMARY KEY,"
        " applied_at TEXT NOT NULL DEFAULT (datetime('now'))"
        ")"
    )
    applied = {r["name"] for r in db.execute("SELECT name FROM schema_migrations").fetchall()}

    count = 0
    for name, fn in MIGRATIONS:
        if name in applied:
            continue
        fn(db)
        db.execute("INSERT INTO schema_migrations (name) VALUES (?)", (name,))
        db.commit()
        count += 1
    return count
