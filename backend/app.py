"""
Cairn — Flask Backend
Serves the React SPA and provides a REST API backed by SQLite.
"""

import os
import json
import sqlite3
import hashlib
import secrets
from datetime import datetime, date
from pathlib import Path
from functools import wraps

from flask import Flask, request, jsonify, send_from_directory, g
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash

# ── Config ────────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("DATA_DIR", BASE_DIR / "data"))
DB_PATH = DATA_DIR / "cairn.db"
STATIC_DIR = BASE_DIR / "static"
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-key-change-me")
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "changeme")

DATA_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="")
app.config["SECRET_KEY"] = SECRET_KEY
CORS(app)


# ── Database ──────────────────────────────────────────────────────────────────

def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(str(DB_PATH))
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db


@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """Create tables if they don't exist."""
    db = sqlite3.connect(str(DB_PATH))
    db.executescript("""
        CREATE TABLE IF NOT EXISTS profile (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            name TEXT NOT NULL DEFAULT '',
            dob TEXT NOT NULL DEFAULT '1980-01-01',
            retirement_age INTEGER NOT NULL DEFAULT 57,
            gross_salary REAL NOT NULL DEFAULT 0,
            pension_contrib_pct REAL NOT NULL DEFAULT 0,
            employer_contrib_pct REAL NOT NULL DEFAULT 0,
            tax_code TEXT NOT NULL DEFAULT '1257L',
            state_pension_annual REAL NOT NULL DEFAULT 11500,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            balance REAL NOT NULL DEFAULT 0,
            provider TEXT DEFAULT '',
            contributing INTEGER NOT NULL DEFAULT 0,
            monthly_contrib REAL NOT NULL DEFAULT 0,
            interest_rate REAL DEFAULT 0,
            rate_type TEXT DEFAULT '',
            fixed_until TEXT DEFAULT '',
            term_end_date TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            total_contributed REAL NOT NULL DEFAULT 0,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            net_worth REAL NOT NULL,
            total_assets REAL NOT NULL DEFAULT 0,
            total_liabilities REAL NOT NULL DEFAULT 0,
            breakdown TEXT DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(date)
        );

        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            growth_rate REAL NOT NULL DEFAULT 5.0,
            inflation_rate REAL NOT NULL DEFAULT 2.5,
            isa_allowance REAL NOT NULL DEFAULT 20000,
            pension_annual_allowance REAL NOT NULL DEFAULT 60000,
            tax_year TEXT NOT NULL DEFAULT '2025/26',
            tracker_margin REAL NOT NULL DEFAULT 0.5,
            mortgage_remaining_years INTEGER NOT NULL DEFAULT 20,
            net_worth_target REAL NOT NULL DEFAULT 0,
            net_worth_target_date TEXT NOT NULL DEFAULT '',
            tax_region TEXT NOT NULL DEFAULT 'scotland',
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Seed defaults if empty
        INSERT OR IGNORE INTO profile (id) VALUES (1);
        INSERT OR IGNORE INTO settings (id) VALUES (1);

        CREATE TABLE IF NOT EXISTS snapshot_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_id INTEGER NOT NULL,
            category TEXT NOT NULL,
            value REAL NOT NULL DEFAULT 0,
            FOREIGN KEY(snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS goals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            target_amount REAL NOT NULL DEFAULT 0,
            target_date TEXT NOT NULL DEFAULT '',
            icon TEXT NOT NULL DEFAULT '',
            link_type TEXT NOT NULL DEFAULT '',
            link_value TEXT NOT NULL DEFAULT '',
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS auth_tokens (
            token TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            expires_at TEXT NOT NULL DEFAULT (datetime('now', '+7 days'))
        );

        -- Clean expired tokens on init
        DELETE FROM auth_tokens WHERE expires_at < datetime('now');

        CREATE TABLE IF NOT EXISTS auth (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            password_hash TEXT NOT NULL DEFAULT ''
        );
        INSERT OR IGNORE INTO auth (id, password_hash) VALUES (1, '');
    """)
    db.commit()

    # Migrate existing databases — add new columns if missing
    cursor = db.execute("PRAGMA table_info(settings)")
    existing_cols = {row[1] for row in cursor.fetchall()}
    migrations = [
        ("tracker_margin", "REAL NOT NULL DEFAULT 0.5"),
        ("mortgage_remaining_years", "INTEGER NOT NULL DEFAULT 20"),
        ("net_worth_target", "REAL NOT NULL DEFAULT 0"),
        ("net_worth_target_date", "TEXT NOT NULL DEFAULT ''"),
        ("tax_region", "TEXT NOT NULL DEFAULT 'scotland'"),
    ]
    for col_name, col_def in migrations:
        if col_name not in existing_cols:
            db.execute(f"ALTER TABLE settings ADD COLUMN {col_name} {col_def}")

    # Profile migrations
    cursor = db.execute("PRAGMA table_info(profile)")
    profile_cols = {row[1] for row in cursor.fetchall()}
    profile_migrations = [
        ("state_pension_annual", "REAL NOT NULL DEFAULT 11500"),
    ]
    for col_name, col_def in profile_migrations:
        if col_name not in profile_cols:
            db.execute(f"ALTER TABLE profile ADD COLUMN {col_name} {col_def}")

    # Accounts migrations
    cursor = db.execute("PRAGMA table_info(accounts)")
    account_cols = {row[1] for row in cursor.fetchall()}
    account_migrations = [
        ("total_contributed", "REAL NOT NULL DEFAULT 0"),
        ("db_annual_pension", "REAL NOT NULL DEFAULT 0"),
    ]
    for col_name, col_def in account_migrations:
        if col_name not in account_cols:
            db.execute(f"ALTER TABLE accounts ADD COLUMN {col_name} {col_def}")
    db.commit()
    db.close()


def ensure_password_hash():
    """Hash ADMIN_PASSWORD and store it, or update the hash if the password changed."""
    db = sqlite3.connect(str(DB_PATH))
    db.row_factory = sqlite3.Row
    row = db.execute("SELECT password_hash FROM auth WHERE id = 1").fetchone()
    if not row or not row["password_hash"] or not check_password_hash(row["password_hash"], ADMIN_PASSWORD):
        db.execute(
            "INSERT OR REPLACE INTO auth (id, password_hash) VALUES (1, ?)",
            (generate_password_hash(ADMIN_PASSWORD),)
        )
        db.commit()
    db.close()


# ── Auth (SQLite-backed tokens — survives across gunicorn workers) ────────────

def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            db = get_db()
            row = db.execute(
                "SELECT token FROM auth_tokens WHERE token = ? AND expires_at > datetime('now')",
                (token,)
            ).fetchone()
            if row:
                return f(*args, **kwargs)
        return jsonify({"error": "Unauthorized"}), 401
    return decorated


# ── API Routes ────────────────────────────────────────────────────────────────

@app.route("/api/auth/login", methods=["POST"])
def login():
    data = request.get_json()
    username = data.get("username", "")
    password = data.get("password", "")
    db = get_db()
    auth_row = db.execute("SELECT password_hash FROM auth WHERE id = 1").fetchone()
    if username == ADMIN_USERNAME and auth_row and check_password_hash(auth_row["password_hash"], password):
        token = secrets.token_hex(32)
        # Clean up expired tokens
        db.execute("DELETE FROM auth_tokens WHERE expires_at < datetime('now')")
        # Insert new token (7-day expiry)
        db.execute(
            "INSERT INTO auth_tokens (token, username, expires_at) VALUES (?, ?, datetime('now', '+7 days'))",
            (token, username)
        )
        db.commit()
        return jsonify({"token": token, "username": username})
    return jsonify({"error": "Invalid credentials"}), 401


@app.route("/api/auth/logout", methods=["POST"])
@require_auth
def logout():
    token = request.headers.get("Authorization", "")[7:]
    db = get_db()
    db.execute("DELETE FROM auth_tokens WHERE token = ?", (token,))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/auth/check", methods=["GET"])
@require_auth
def auth_check():
    return jsonify({"authenticated": True})


# ── Profile ───────────────────────────────────────────────────────────────────

@app.route("/api/profile", methods=["GET"])
@require_auth
def get_profile():
    db = get_db()
    row = db.execute("SELECT * FROM profile WHERE id = 1").fetchone()
    return jsonify(dict(row))


@app.route("/api/profile", methods=["PUT"])
@require_auth
def update_profile():
    data = request.get_json()
    db = get_db()
    db.execute("""
        UPDATE profile SET
            name = ?, dob = ?, retirement_age = ?, gross_salary = ?,
            pension_contrib_pct = ?, employer_contrib_pct = ?, tax_code = ?,
            state_pension_annual = ?,
            updated_at = datetime('now')
        WHERE id = 1
    """, (
        data.get("name", ""), data.get("dob", "1980-01-01"),
        data.get("retirement_age", 57), data.get("gross_salary", 0),
        data.get("pension_contrib_pct", 0), data.get("employer_contrib_pct", 0),
        data.get("tax_code", "1257L"),
        data.get("state_pension_annual", 11500),
    ))
    db.commit()
    return jsonify({"ok": True})


# ── Accounts ──────────────────────────────────────────────────────────────────

@app.route("/api/accounts", methods=["GET"])
@require_auth
def get_accounts():
    db = get_db()
    rows = db.execute("SELECT * FROM accounts ORDER BY sort_order, id").fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/accounts", methods=["POST"])
@require_auth
def create_account():
    data = request.get_json()
    db = get_db()
    cursor = db.execute("""
        INSERT INTO accounts (name, type, balance, provider, contributing,
            monthly_contrib, interest_rate, rate_type, fixed_until,
            term_end_date, notes, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data["name"], data["type"], data.get("balance", 0),
        data.get("provider", ""), data.get("contributing", False),
        data.get("monthly_contrib", 0), data.get("interest_rate", 0),
        data.get("rate_type", ""), data.get("fixed_until", ""),
        data.get("term_end_date", ""), data.get("notes", ""),
        data.get("sort_order", 0),
    ))
    db.commit()
    return jsonify({"id": cursor.lastrowid}), 201


@app.route("/api/accounts/<int:account_id>", methods=["PUT"])
@require_auth
def update_account(account_id):
    data = request.get_json()
    db = get_db()
    fields = []
    values = []
    allowed = [
        "name", "type", "balance", "provider", "contributing",
        "monthly_contrib", "interest_rate", "rate_type", "fixed_until",
        "term_end_date", "notes", "sort_order", "total_contributed", "db_annual_pension",
    ]
    for key in allowed:
        if key in data:
            fields.append(f"{key} = ?")
            values.append(data[key])
    if not fields:
        return jsonify({"error": "No fields to update"}), 400
    fields.append("updated_at = datetime('now')")
    values.append(account_id)
    db.execute(f"UPDATE accounts SET {', '.join(fields)} WHERE id = ?", values)
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/accounts/<int:account_id>", methods=["DELETE"])
@require_auth
def delete_account(account_id):
    db = get_db()
    db.execute("DELETE FROM accounts WHERE id = ?", (account_id,))
    db.commit()
    return jsonify({"ok": True})


# ── Snapshots ─────────────────────────────────────────────────────────────────

@app.route("/api/snapshots", methods=["GET"])
@require_auth
def get_snapshots():
    db = get_db()
    limit = request.args.get("limit", 120, type=int)
    rows = db.execute(
        "SELECT * FROM snapshots ORDER BY date DESC LIMIT ?", (limit,)
    ).fetchall()
    return jsonify([dict(r) for r in reversed(rows)])


@app.route("/api/snapshots", methods=["POST"])
@require_auth
def create_snapshot():
    """Take a snapshot of current net worth. Can be called manually or via cron."""
    db = get_db()
    accounts = db.execute("SELECT * FROM accounts").fetchall()

    asset_types = {"PENSION_DC", "SIPP", "ISA_SS", "ISA_CASH", "CURRENT", "SAVINGS", "PROPERTY"}
    liability_types = {"MORTGAGE", "CREDIT_CARD", "LOAN"}

    total_assets = sum(a["balance"] for a in accounts if a["type"] in asset_types)
    total_liabilities = sum(abs(a["balance"]) for a in accounts if a["type"] in liability_types)
    net_worth = total_assets - total_liabilities

    breakdown = {}
    for a in accounts:
        breakdown[a["name"]] = a["balance"]

    snapshot_date = request.get_json().get("date", date.today().isoformat()) if request.is_json else date.today().isoformat()

    db.execute("""
        INSERT OR REPLACE INTO snapshots (date, net_worth, total_assets, total_liabilities, breakdown)
        VALUES (?, ?, ?, ?, ?)
    """, (snapshot_date, net_worth, total_assets, total_liabilities, json.dumps(breakdown)))
    db.commit()

    # Record per-category breakdown for the stacked history chart
    snap_row = db.execute("SELECT id FROM snapshots WHERE date = ?", (snapshot_date,)).fetchone()
    if snap_row:
        snapshot_id = snap_row["id"]
        categories = {
            "pensions": sum(a["balance"] for a in accounts if a["type"] in {"PENSION_DC", "SIPP", "PENSION_DB"}),
            "isas":     sum(a["balance"] for a in accounts if a["type"] in {"ISA_SS", "ISA_CASH"}),
            "property": sum(a["balance"] for a in accounts if a["type"] == "PROPERTY"),
            "cash":     sum(a["balance"] for a in accounts if a["type"] in {"CURRENT", "SAVINGS"}),
            "debts":   -sum(abs(a["balance"]) for a in accounts if a["type"] in liability_types),
        }
        db.execute("DELETE FROM snapshot_categories WHERE snapshot_id = ?", (snapshot_id,))
        for cat, value in categories.items():
            db.execute(
                "INSERT INTO snapshot_categories (snapshot_id, category, value) VALUES (?, ?, ?)",
                (snapshot_id, cat, value)
            )
        db.commit()

    return jsonify({"date": snapshot_date, "net_worth": net_worth}), 201


@app.route("/api/snapshots/<int:snapshot_id>", methods=["PUT"])
@require_auth
def update_snapshot(snapshot_id):
    """Edit a snapshot's date or values."""
    data = request.get_json()
    db = get_db()
    fields = []
    values = []
    allowed = ["date", "net_worth", "total_assets", "total_liabilities"]
    for key in allowed:
        if key in data:
            fields.append(f"{key} = ?")
            values.append(data[key])
    if not fields:
        return jsonify({"error": "No fields to update"}), 400
    values.append(snapshot_id)
    db.execute(f"UPDATE snapshots SET {', '.join(fields)} WHERE id = ?", values)
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/snapshots/<int:snapshot_id>", methods=["DELETE"])
@require_auth
def delete_snapshot(snapshot_id):
    """Delete a specific snapshot."""
    db = get_db()
    db.execute("DELETE FROM snapshots WHERE id = ?", (snapshot_id,))
    db.commit()
    return jsonify({"ok": True})


# ── Settings ──────────────────────────────────────────────────────────────────

# ── Goals ─────────────────────────────────────────────────────────────────────

@app.route("/api/goals", methods=["GET"])
@require_auth
def get_goals():
    db = get_db()
    rows = db.execute("SELECT * FROM goals ORDER BY sort_order, id").fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/goals", methods=["POST"])
@require_auth
def create_goal():
    data = request.get_json()
    db = get_db()
    cursor = db.execute("""
        INSERT INTO goals (name, description, target_amount, target_date, icon, link_type, link_value, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data.get("name", ""), data.get("description", ""),
        data.get("target_amount", 0), data.get("target_date", ""),
        data.get("icon", ""), data.get("link_type", ""),
        data.get("link_value", ""), data.get("sort_order", 0),
    ))
    db.commit()
    row = db.execute("SELECT * FROM goals WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return jsonify(dict(row)), 201


@app.route("/api/goals/<int:goal_id>", methods=["PUT"])
@require_auth
def update_goal(goal_id):
    data = request.get_json()
    db = get_db()
    allowed = ["name", "description", "target_amount", "target_date", "icon", "link_type", "link_value", "sort_order"]
    fields, values = [], []
    for key in allowed:
        if key in data:
            fields.append(f"{key} = ?")
            values.append(data[key])
    if not fields:
        return jsonify({"error": "No fields to update"}), 400
    fields.append("updated_at = datetime('now')")
    values.append(goal_id)
    db.execute(f"UPDATE goals SET {', '.join(fields)} WHERE id = ?", values)
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/goals/<int:goal_id>", methods=["DELETE"])
@require_auth
def delete_goal(goal_id):
    db = get_db()
    db.execute("DELETE FROM goals WHERE id = ?", (goal_id,))
    db.commit()
    return jsonify({"ok": True})


# ── Settings ──────────────────────────────────────────────────────────────────

@app.route("/api/settings", methods=["GET"])
@require_auth
def get_settings():
    db = get_db()
    row = db.execute("SELECT * FROM settings WHERE id = 1").fetchone()
    return jsonify(dict(row))


@app.route("/api/settings", methods=["PUT"])
@require_auth
def update_settings():
    data = request.get_json()
    db = get_db()
    db.execute("""
        UPDATE settings SET
            growth_rate = ?, inflation_rate = ?, isa_allowance = ?,
            pension_annual_allowance = ?, tax_year = ?,
            tracker_margin = ?, mortgage_remaining_years = ?,
            net_worth_target = ?, net_worth_target_date = ?,
            tax_region = ?,
            updated_at = datetime('now')
        WHERE id = 1
    """, (
        data.get("growth_rate", 5.0), data.get("inflation_rate", 2.5),
        data.get("isa_allowance", 20000), data.get("pension_annual_allowance", 60000),
        data.get("tax_year", "2025/26"),
        data.get("tracker_margin", 0.5), data.get("mortgage_remaining_years", 20),
        data.get("net_worth_target", 0), data.get("net_worth_target_date", ""),
        data.get("tax_region", "scotland"),
    ))
    db.commit()
    return jsonify({"ok": True})


# ── Dashboard summary (single call for frontend) ─────────────────────────────

@app.route("/api/dashboard", methods=["GET"])
@require_auth
def get_dashboard():
    """Returns everything the frontend needs in one call."""
    db = get_db()
    profile = dict(db.execute("SELECT * FROM profile WHERE id = 1").fetchone())
    accounts = [dict(r) for r in db.execute("SELECT * FROM accounts ORDER BY sort_order, id").fetchall()]
    settings = dict(db.execute("SELECT * FROM settings WHERE id = 1").fetchone())
    snapshots = [dict(r) for r in db.execute(
        "SELECT * FROM snapshots ORDER BY date DESC LIMIT 120"
    ).fetchall()]
    snapshots.reverse()

    # Attach per-category breakdowns to each snapshot (for stacked area chart)
    snapshot_ids = [s["id"] for s in snapshots]
    if snapshot_ids:
        placeholders = ",".join("?" * len(snapshot_ids))
        cat_rows = db.execute(
            f"SELECT * FROM snapshot_categories WHERE snapshot_id IN ({placeholders})",
            snapshot_ids
        ).fetchall()
        cats_by_snap = {}
        for row in cat_rows:
            cats_by_snap.setdefault(row["snapshot_id"], {})[row["category"]] = row["value"]
        for s in snapshots:
            s["categories"] = cats_by_snap.get(s["id"], {})
    else:
        for s in snapshots:
            s["categories"] = {}

    goals = [dict(r) for r in db.execute("SELECT * FROM goals ORDER BY sort_order, id").fetchall()]

    return jsonify({
        "profile": profile,
        "accounts": accounts,
        "settings": settings,
        "snapshots": snapshots,
        "goals": goals,
    })


# ── Data export/import ────────────────────────────────────────────────────────

@app.route("/api/export", methods=["GET"])
@require_auth
def export_data():
    db = get_db()
    data = {
        "profile": dict(db.execute("SELECT * FROM profile WHERE id = 1").fetchone()),
        "accounts": [dict(r) for r in db.execute("SELECT * FROM accounts").fetchall()],
        "settings": dict(db.execute("SELECT * FROM settings WHERE id = 1").fetchone()),
        "snapshots": [dict(r) for r in db.execute("SELECT * FROM snapshots ORDER BY date").fetchall()],
        "goals": [dict(r) for r in db.execute("SELECT * FROM goals ORDER BY sort_order, id").fetchall()],
        "exported_at": datetime.now().isoformat(),
    }
    return jsonify(data)


@app.route("/api/import", methods=["POST"])
@require_auth
def import_data():
    data = request.get_json()
    db = get_db()

    if "profile" in data:
        p = data["profile"]
        db.execute("""
            UPDATE profile SET name=?, dob=?, retirement_age=?, gross_salary=?,
                pension_contrib_pct=?, employer_contrib_pct=?, tax_code=?,
                updated_at=datetime('now')
            WHERE id = 1
        """, (p.get("name",""), p.get("dob","1980-01-01"), p.get("retirement_age",57),
              p.get("gross_salary",0), p.get("pension_contrib_pct",0),
              p.get("employer_contrib_pct",0), p.get("tax_code","1257L")))

    if "accounts" in data:
        db.execute("DELETE FROM accounts")
        for a in data["accounts"]:
            db.execute("""
                INSERT INTO accounts (name,type,balance,provider,contributing,
                    monthly_contrib,interest_rate,rate_type,fixed_until,
                    term_end_date,notes,sort_order,total_contributed,db_annual_pension)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (a["name"], a["type"], a.get("balance",0), a.get("provider",""),
                  a.get("contributing",0), a.get("monthly_contrib",0),
                  a.get("interest_rate",0), a.get("rate_type",""),
                  a.get("fixed_until",""), a.get("term_end_date",""),
                  a.get("notes",""), a.get("sort_order",0),
                  a.get("total_contributed",0), a.get("db_annual_pension",0)))

    if "settings" in data:
        s = data["settings"]
        db.execute("""
            UPDATE settings SET growth_rate=?, inflation_rate=?, isa_allowance=?,
                pension_annual_allowance=?, tax_year=?,
                tracker_margin=?, mortgage_remaining_years=?,
                net_worth_target=?, net_worth_target_date=?,
                tax_region=?, updated_at=datetime('now')
            WHERE id = 1
        """, (s.get("growth_rate",5.0), s.get("inflation_rate",2.5),
              s.get("isa_allowance",20000), s.get("pension_annual_allowance",60000),
              s.get("tax_year","2025/26"),
              s.get("tracker_margin",0.5), s.get("mortgage_remaining_years",20),
              s.get("net_worth_target",0), s.get("net_worth_target_date",""),
              s.get("tax_region","scotland")))

    if "snapshots" in data:
        for snap in data["snapshots"]:
            db.execute("""
                INSERT OR REPLACE INTO snapshots (date, net_worth, total_assets,
                    total_liabilities, breakdown)
                VALUES (?,?,?,?,?)
            """, (snap["date"], snap["net_worth"], snap.get("total_assets",0),
                  snap.get("total_liabilities",0), snap.get("breakdown","{}")))

    if "goals" in data:
        db.execute("DELETE FROM goals")
        for g in data["goals"]:
            db.execute("""
                INSERT INTO goals (name, description, target_amount, target_date,
                    icon, link_type, link_value, sort_order)
                VALUES (?,?,?,?,?,?,?,?)
            """, (g.get("name",""), g.get("description",""), g.get("target_amount",0),
                  g.get("target_date",""), g.get("icon",""), g.get("link_type",""),
                  g.get("link_value",""), g.get("sort_order",0)))

    db.commit()
    return jsonify({"ok": True, "message": "Data imported successfully"})


# ── AI Commentary (Claude API) ────────────────────────────────────────────────

CLAUDE_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

@app.route("/api/ai/commentary", methods=["POST"])
@require_auth
def ai_commentary():
    """Generate natural-language financial commentary using Claude API."""
    if not CLAUDE_API_KEY:
        return jsonify({"error": "ANTHROPIC_API_KEY not configured"}), 503

    db = get_db()
    profile = dict(db.execute("SELECT * FROM profile WHERE id = 1").fetchone())
    accounts = [dict(r) for r in db.execute("SELECT * FROM accounts ORDER BY sort_order, id").fetchall()]
    settings = dict(db.execute("SELECT * FROM settings WHERE id = 1").fetchone())
    snapshots = [dict(r) for r in db.execute(
        "SELECT date, net_worth, total_assets, total_liabilities FROM snapshots ORDER BY date DESC LIMIT 12"
    ).fetchall()]

    # Build a sanitised summary for Claude (no names, just financial data)
    asset_types = {"PENSION_DC", "SIPP", "ISA_SS", "ISA_CASH", "CURRENT", "SAVINGS", "PROPERTY"}
    liability_types = {"MORTGAGE", "CREDIT_CARD", "LOAN"}
    total_assets = sum(a["balance"] for a in accounts if a["type"] in asset_types)
    total_liabilities = sum(abs(a["balance"]) for a in accounts if a["type"] in liability_types)
    net_worth = total_assets - total_liabilities

    age = 0
    try:
        from datetime import date as dt_date
        dob = datetime.strptime(profile["dob"], "%Y-%m-%d").date()
        today = dt_date.today()
        age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
    except:
        age = 45

    account_summary = []
    for a in accounts:
        entry = f"- {a['type']}: £{abs(a['balance']):,.0f}"
        if a.get("interest_rate"):
            entry += f" ({a['interest_rate']}% {'tracker' if a.get('rate_type') == 'tracker' else a.get('rate_type', 'APR')})"
        if a.get("monthly_contrib") and a["monthly_contrib"] != 0:
            entry += f", £{abs(a['monthly_contrib']):,.0f}/month contributions"
        account_summary.append(entry)

    pension_annual = profile["gross_salary"] * ((profile["pension_contrib_pct"] + profile["employer_contrib_pct"]) / 100)
    isa_monthly = sum(a["monthly_contrib"] for a in accounts if a["type"] in ("ISA_SS", "ISA_CASH") and a.get("monthly_contrib"))

    snapshot_trend = ""
    if len(snapshots) >= 2:
        latest = snapshots[0]["net_worth"]
        oldest = snapshots[-1]["net_worth"]
        change = latest - oldest
        months = len(snapshots)
        snapshot_trend = f"Net worth trend over last {months} months: £{oldest:,.0f} → £{latest:,.0f} (change: £{change:+,.0f})"

    prompt = f"""You are a knowledgeable UK personal finance commentator. Provide a concise, plain-English 
analysis of this person's financial position. Be direct, practical, and specific. 
Focus on actionable observations. Do NOT give regulated financial advice — frame as general observations.
Keep it to 3-4 short paragraphs.

FINANCIAL SNAPSHOT:
- Age: {age}, target retirement age: {profile['retirement_age']} ({profile['retirement_age'] - age} years)
- Gross salary: £{profile['gross_salary']:,.0f}
- Pension contributions: {profile['pension_contrib_pct']}% employee + {profile['employer_contrib_pct']}% employer = £{pension_annual:,.0f}/year
- ISA monthly contributions: £{isa_monthly:,.0f}
- Net worth: £{net_worth:,.0f} (assets: £{total_assets:,.0f}, liabilities: £{total_liabilities:,.0f})
{snapshot_trend}

ACCOUNTS:
{chr(10).join(account_summary)}

ASSUMPTIONS: {settings['growth_rate']}% growth, {settings['inflation_rate']}% inflation

Give your analysis now. Be encouraging where appropriate but honest about areas for improvement."""

    import urllib.request
    import urllib.error

    req_data = json.dumps({
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 1000,
        "messages": [{"role": "user", "content": prompt}],
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=req_data,
        headers={
            "Content-Type": "application/json",
            "x-api-key": CLAUDE_API_KEY,
            "anthropic-version": "2023-06-01",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            text = ""
            for block in result.get("content", []):
                if block.get("type") == "text":
                    text += block["text"]
            return jsonify({"commentary": text})
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return jsonify({"error": f"Claude API error: {e.code}", "detail": body}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Salary Sacrifice Calculator ───────────────────────────────────────────────

@app.route("/api/tools/salary-sacrifice", methods=["POST"])
@require_auth
def salary_sacrifice_calc():
    """Calculate the tax/NI savings from salary sacrifice pension contributions."""
    data = request.get_json()
    gross = data.get("gross_salary", 0)
    current_pct = data.get("current_contrib_pct", 0)
    proposed_pct = data.get("proposed_contrib_pct", 0)
    employer_pct = data.get("employer_contrib_pct", 0)
    tax_region = data.get("tax_region", "scotland")

    def calc_tax_ni(gross_salary, sacrifice=0, region="scotland"):
        """2025/26 income tax + NI for Scotland or rUK (England, Wales, NI)."""
        taxable = gross_salary - sacrifice
        personal_allowance = 12570

        if region == "scotland":
            bands = [
                (14876, 0.19),        # Starter:       £12,571 – £14,876
                (26561, 0.20),        # Basic:         £14,877 – £26,561
                (43662, 0.21),        # Intermediate:  £26,562 – £43,662
                (75000, 0.42),        # Higher:        £43,663 – £75,000
                (125140, 0.45),       # Advanced:      £75,001 – £125,140
                (float('inf'), 0.48), # Top:           £125,141+
            ]
        else:  # rUK — England, Wales, Northern Ireland
            bands = [
                (50270, 0.20),        # Basic:         £12,571 – £50,270
                (125140, 0.40),       # Higher:        £50,271 – £125,140
                (float('inf'), 0.45), # Additional:    £125,141+
            ]

        income_tax = 0
        remaining = max(0, taxable - personal_allowance)
        prev_limit = personal_allowance
        for limit, rate in bands:
            band_width = limit - prev_limit
            taxed = min(remaining, band_width)
            income_tax += taxed * rate
            remaining -= taxed
            prev_limit = limit
            if remaining <= 0:
                break

        # Employee NI Class 1 — same across all UK regions
        ni_threshold = 12570
        upper_limit = 50270
        ni_earnings = max(0, taxable - ni_threshold)
        if taxable <= upper_limit:
            employee_ni = ni_earnings * 0.08
        else:
            employee_ni = (upper_limit - ni_threshold) * 0.08 + (taxable - upper_limit) * 0.02

        # Employer NI 2025/26
        employer_ni = max(0, taxable - 5000) * 0.15

        take_home = taxable - income_tax - employee_ni

        return {
            "taxable_income": round(taxable),
            "income_tax": round(income_tax),
            "employee_ni": round(employee_ni),
            "employer_ni": round(employer_ni),
            "take_home": round(take_home),
        }

    current_sacrifice = gross * (current_pct / 100)
    proposed_sacrifice = gross * (proposed_pct / 100)
    employer_contrib = gross * (employer_pct / 100)

    current = calc_tax_ni(gross, current_sacrifice, tax_region)
    proposed = calc_tax_ni(gross, proposed_sacrifice, tax_region)

    # Cost to take-home vs pension gain
    take_home_reduction = current["take_home"] - proposed["take_home"]
    pension_increase = proposed_sacrifice - current_sacrifice
    employer_ni_saving = current["employer_ni"] - proposed["employer_ni"]

    return jsonify({
        "current": {
            **current,
            "pension_contrib": round(current_sacrifice),
            "employer_contrib": round(employer_contrib),
            "total_pension": round(current_sacrifice + employer_contrib),
        },
        "proposed": {
            **proposed,
            "pension_contrib": round(proposed_sacrifice),
            "employer_contrib": round(employer_contrib),
            "employer_ni_saving": round(employer_ni_saving),
            "total_pension": round(proposed_sacrifice + employer_contrib),
            "total_pension_with_ni": round(proposed_sacrifice + employer_contrib + employer_ni_saving),
        },
        "comparison": {
            "take_home_reduction_monthly": round(take_home_reduction / 12),
            "take_home_reduction_annual": round(take_home_reduction),
            "pension_increase_annual": round(pension_increase),
            "pension_increase_monthly": round(pension_increase / 12),
            "employer_ni_saving": round(employer_ni_saving),
            "effective_cost_ratio": round(take_home_reduction / pension_increase * 100, 1) if pension_increase > 0 else 0,
            "tax_ni_saved": round(pension_increase - take_home_reduction),
        },
    })


# ── Debt Payoff Calculator ────────────────────────────────────────────────────

@app.route("/api/tools/debt-payoff", methods=["POST"])
@require_auth
def debt_payoff_calc():
    """Compare avalanche vs snowball debt repayment strategies."""
    data = request.get_json()
    debts = data.get("debts", [])
    extra_monthly = data.get("extra_monthly", 0)

    if not debts:
        return jsonify({"error": "No debts provided"}), 400

    def simulate(debts_list, extra, strategy="avalanche"):
        """Simulate month-by-month debt payoff."""
        active = [{"name": d["name"], "balance": abs(d["balance"]), "rate": d["rate"],
                    "min_payment": abs(d.get("min_payment", 0))} for d in debts_list]
        months = 0
        total_interest = 0
        total_paid = 0
        timeline = []
        max_months = 600  # 50 years cap

        if strategy == "avalanche":
            active.sort(key=lambda d: -d["rate"])
        else:  # snowball
            active.sort(key=lambda d: d["balance"])

        while any(d["balance"] > 0.01 for d in active) and months < max_months:
            months += 1
            month_interest = 0

            # Apply interest
            for d in active:
                if d["balance"] > 0:
                    interest = d["balance"] * (d["rate"] / 100 / 12)
                    d["balance"] += interest
                    month_interest += interest
                    total_interest += interest

            # Pay minimums
            for d in active:
                if d["balance"] > 0:
                    payment = min(d["min_payment"], d["balance"])
                    d["balance"] -= payment
                    total_paid += payment

            # Apply extra to priority debt
            remaining_extra = extra
            for d in active:
                if d["balance"] > 0 and remaining_extra > 0:
                    payment = min(remaining_extra, d["balance"])
                    d["balance"] -= payment
                    total_paid += payment
                    remaining_extra -= payment

            total_remaining = sum(d["balance"] for d in active)
            if months % 3 == 0 or total_remaining < 0.01:
                timeline.append({"month": months, "remaining": round(total_remaining)})

        return {
            "months": months,
            "total_interest": round(total_interest),
            "total_paid": round(total_paid),
            "timeline": timeline,
        }

    avalanche = simulate(debts, extra_monthly, "avalanche")
    snowball = simulate(debts, extra_monthly, "snowball")
    minimum_only = simulate(debts, 0, "avalanche")

    return jsonify({
        "avalanche": avalanche,
        "snowball": snowball,
        "minimum_only": minimum_only,
        "savings_vs_minimum": {
            "months_saved": minimum_only["months"] - avalanche["months"],
            "interest_saved": minimum_only["total_interest"] - avalanche["total_interest"],
        },
    })


# ── BoE Base Rate Data ────────────────────────────────────────────────────────

BOE_RATE_CACHE = {"data": None, "fetched": None}

@app.route("/api/rates/boe-base-rate", methods=["GET"])
@require_auth
def boe_base_rate():
    """Fetch Bank of England base rate history from their public statistical API.
    Caches for 24 hours since it only changes ~8 times a year."""
    import urllib.request
    import http.cookiejar
    import csv
    import io

    now = datetime.now()

    # Return cache if less than 24h old
    if BOE_RATE_CACHE["data"] and BOE_RATE_CACHE["fetched"]:
        age = (now - BOE_RATE_CACHE["fetched"]).total_seconds()
        if age < 86400:
            return jsonify(BOE_RATE_CACHE["data"])

    # BoE requires cookies — use a cookie-enabled opener
    try:
        cj = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "text/html,text/csv,text/plain,*/*",
        }

        # Step 1: Hit the main database page to establish a session and get cookies
        init_req = urllib.request.Request(
            "https://www.bankofengland.co.uk/boeapps/database/",
            headers=headers,
        )
        opener.open(init_req, timeout=10)

        # Step 2: Fetch the CSV data using the documented API endpoint
        from_date = "01/Jan/2000"
        to_date = now.strftime("%d/%b/%Y")
        csv_url = (
            f"https://www.bankofengland.co.uk/boeapps/database/"
            f"_iadb-fromshowcolumns.asp?csv.x=yes"
            f"&Datefrom={from_date}&Dateto={to_date}"
            f"&SeriesCodes=IUDBEDR&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N"
        )

        csv_req = urllib.request.Request(csv_url, headers=headers)
        with opener.open(csv_req, timeout=15) as resp:
            raw = resp.read().decode("utf-8", errors="replace")

        # Check if we got HTML instead of CSV (cookie/redirect issue)
        if "<!DOCTYPE" in raw[:100] or "<html" in raw[:100].lower():
            raise ValueError("BoE returned HTML instead of CSV — cookie session may have failed")

        # Parse CSV — BoE format: DATE, VALUE
        rates = []
        reader = csv.reader(io.StringIO(raw))
        for row in reader:
            if len(row) >= 2:
                date_str = row[0].strip()
                rate_str = row[1].strip()
                try:
                    d = datetime.strptime(date_str, "%d %b %Y")
                    r = float(rate_str)
                    rates.append({"date": d.strftime("%Y-%m-%d"), "rate": r})
                except (ValueError, TypeError):
                    continue

        if not rates:
            raise ValueError("No rate data parsed from BoE CSV response")

        # Sort by date
        rates.sort(key=lambda x: x["date"])

        # Build a monthly series
        monthly = []
        current_rate = rates[0]["rate"]
        rate_idx = 0
        start_year = int(rates[0]["date"][:4])

        for year in range(start_year, now.year + 1):
            for month in range(1, 13):
                if year == now.year and month > now.month:
                    break
                month_start = f"{year}-{month:02d}-01"
                while rate_idx < len(rates) - 1 and rates[rate_idx + 1]["date"] <= month_start:
                    rate_idx += 1
                    current_rate = rates[rate_idx]["rate"]
                monthly.append({"date": month_start, "rate": current_rate})

        result = {
            "current_rate": rates[-1]["rate"],
            "current_date": rates[-1]["date"],
            "history": monthly,
            "changes": rates[-20:],
        }

        BOE_RATE_CACHE["data"] = result
        BOE_RATE_CACHE["fetched"] = now

        return jsonify(result)

    except Exception as e:
        # Comprehensive fallback — BoE base rate history (key change dates)
        fallback_changes = [
            {"date": "2000-02-10", "rate": 6.00}, {"date": "2001-02-08", "rate": 5.75},
            {"date": "2001-04-05", "rate": 5.50}, {"date": "2001-05-10", "rate": 5.25},
            {"date": "2001-08-02", "rate": 5.00}, {"date": "2001-09-18", "rate": 4.75},
            {"date": "2001-10-04", "rate": 4.50}, {"date": "2001-11-08", "rate": 4.00},
            {"date": "2003-02-06", "rate": 3.75}, {"date": "2003-07-10", "rate": 3.50},
            {"date": "2003-11-06", "rate": 3.75}, {"date": "2004-02-05", "rate": 4.00},
            {"date": "2004-05-06", "rate": 4.25}, {"date": "2004-06-10", "rate": 4.50},
            {"date": "2004-08-05", "rate": 4.75}, {"date": "2005-08-04", "rate": 4.50},
            {"date": "2006-08-03", "rate": 4.75}, {"date": "2006-11-09", "rate": 5.00},
            {"date": "2007-01-11", "rate": 5.25}, {"date": "2007-05-10", "rate": 5.50},
            {"date": "2007-07-05", "rate": 5.75}, {"date": "2007-12-06", "rate": 5.50},
            {"date": "2008-02-07", "rate": 5.25}, {"date": "2008-04-10", "rate": 5.00},
            {"date": "2008-10-08", "rate": 4.50}, {"date": "2008-11-06", "rate": 3.00},
            {"date": "2008-12-04", "rate": 2.00}, {"date": "2009-01-08", "rate": 1.50},
            {"date": "2009-02-05", "rate": 1.00}, {"date": "2009-03-05", "rate": 0.50},
            {"date": "2016-08-04", "rate": 0.25}, {"date": "2017-11-02", "rate": 0.50},
            {"date": "2018-08-02", "rate": 0.75}, {"date": "2020-03-11", "rate": 0.25},
            {"date": "2020-03-19", "rate": 0.10}, {"date": "2021-12-16", "rate": 0.25},
            {"date": "2022-02-03", "rate": 0.50}, {"date": "2022-03-17", "rate": 0.75},
            {"date": "2022-05-05", "rate": 1.00}, {"date": "2022-06-16", "rate": 1.25},
            {"date": "2022-08-04", "rate": 1.75}, {"date": "2022-09-22", "rate": 2.25},
            {"date": "2022-11-03", "rate": 3.00}, {"date": "2022-12-15", "rate": 3.50},
            {"date": "2023-02-02", "rate": 4.00}, {"date": "2023-03-23", "rate": 4.25},
            {"date": "2023-05-11", "rate": 4.50}, {"date": "2023-06-22", "rate": 5.00},
            {"date": "2023-08-03", "rate": 5.25}, {"date": "2024-08-01", "rate": 5.00},
            {"date": "2024-11-07", "rate": 4.75}, {"date": "2025-02-06", "rate": 4.50},
            {"date": "2025-03-20", "rate": 4.25}, {"date": "2025-05-08", "rate": 4.00},
        ]

        # Build monthly from fallback
        monthly = []
        fc = fallback_changes
        rate_idx = 0
        current_rate = fc[0]["rate"]
        for year in range(2000, now.year + 1):
            for month in range(1, 13):
                if year == now.year and month > now.month:
                    break
                ms = f"{year}-{month:02d}-01"
                while rate_idx < len(fc) - 1 and fc[rate_idx + 1]["date"] <= ms:
                    rate_idx += 1
                    current_rate = fc[rate_idx]["rate"]
                monthly.append({"date": ms, "rate": current_rate})

        result = {
            "current_rate": fc[-1]["rate"],
            "current_date": fc[-1]["date"],
            "history": monthly,
            "changes": fc[-20:],
            "fallback": True,
            "fetch_error": str(e),
        }

        BOE_RATE_CACHE["data"] = result
        BOE_RATE_CACHE["fetched"] = now

        return jsonify(result)


@app.route("/api/tools/mortgage-scenarios", methods=["POST"])
@require_auth
def mortgage_scenarios():
    """Calculate mortgage payment scenarios at different rates."""
    data = request.get_json()
    balance = data.get("balance", 0)
    current_rate = data.get("current_rate", 5.0)
    remaining_years = data.get("remaining_years", 20)
    monthly_payment = data.get("monthly_payment", 0)
    margin = data.get("tracker_margin", 0.5)

    def calc_monthly_payment(principal, annual_rate, years):
        if annual_rate <= 0 or years <= 0:
            return principal / max(years * 12, 1)
        r = annual_rate / 100 / 12
        n = years * 12
        return principal * (r * (1 + r) ** n) / ((1 + r) ** n - 1)

    def calc_total_interest(principal, annual_rate, years):
        mp = calc_monthly_payment(principal, annual_rate, years)
        return (mp * years * 12) - principal

    def calc_overpayment(principal, annual_rate, years, extra_monthly):
        if annual_rate <= 0:
            return {"months": int(principal / max(extra_monthly + principal / (years * 12), 1)), "interest": 0}
        r = annual_rate / 100 / 12
        balance = principal
        base_payment = calc_monthly_payment(principal, annual_rate, years)
        total_payment = base_payment + extra_monthly
        months = 0
        total_interest = 0
        while balance > 0.01 and months < years * 12:
            interest = balance * r
            total_interest += interest
            principal_paid = total_payment - interest
            if principal_paid <= 0:
                break
            balance -= principal_paid
            months += 1
            if balance < 0:
                balance = 0
        return {"months": months, "total_interest": round(total_interest), "saved_months": remaining_years * 12 - months}

    # Current scenario
    current_monthly = calc_monthly_payment(balance, current_rate, remaining_years)

    # Rate change scenarios
    scenarios = []
    for delta in [-1.5, -1.0, -0.5, 0, 0.5, 1.0, 1.5, 2.0]:
        rate = current_rate + delta
        if rate < 0.1:
            continue
        mp = calc_monthly_payment(balance, rate, remaining_years)
        ti = calc_total_interest(balance, rate, remaining_years)
        scenarios.append({
            "rate": round(rate, 2),
            "base_rate": round(rate - margin, 2),
            "monthly_payment": round(mp),
            "total_interest": round(ti),
            "diff_monthly": round(mp - current_monthly),
            "is_current": delta == 0,
        })

    # Overpayment scenarios
    overpayments = []
    for extra in [0, 100, 200, 300, 500]:
        result = calc_overpayment(balance, current_rate, remaining_years, extra)
        no_extra = calc_overpayment(balance, current_rate, remaining_years, 0)
        overpayments.append({
            "extra_monthly": extra,
            "months_to_clear": result["months"],
            "total_interest": result["total_interest"],
            "interest_saved": no_extra["total_interest"] - result["total_interest"],
            "time_saved_months": result["saved_months"] - no_extra["saved_months"] if extra > 0 else 0,
        })

    return jsonify({
        "current": {
            "rate": current_rate,
            "base_rate": round(current_rate - margin, 2),
            "monthly_payment": round(current_monthly),
            "total_interest": round(calc_total_interest(balance, current_rate, remaining_years)),
            "balance": balance,
            "remaining_years": remaining_years,
        },
        "scenarios": scenarios,
        "overpayments": overpayments,
    })


# ── Serve React SPA ───────────────────────────────────────────────────────────

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_spa(path):
    # Serve static files if they exist, otherwise serve index.html (SPA routing)
    file_path = STATIC_DIR / path
    if path and file_path.exists():
        return send_from_directory(str(STATIC_DIR), path)
    return send_from_directory(str(STATIC_DIR), "index.html")


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    ensure_password_hash()
    port = int(os.environ.get("PORT", 8000))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"

    if debug:
        app.run(host="0.0.0.0", port=port, debug=True)
    else:
        # Production: use gunicorn
        import subprocess
        subprocess.run([
            "gunicorn", "backend.app:app",
            "--bind", f"0.0.0.0:{port}",
            "--workers", "2",
            "--timeout", "120",
        ])
