"""
Cairn — Flask Backend
Serves the React SPA and provides a REST API backed by SQLite.
"""

import os
import sys
import json
import sqlite3
import hashlib
import secrets
from datetime import datetime, date
from pathlib import Path

from flask import Flask, request, jsonify, send_from_directory, g
from werkzeug.security import generate_password_hash, check_password_hash

# Make sibling modules importable whether we're launched as `python app.py`
# from backend/, or as `gunicorn backend.app:app` from the project root.
_HERE = str(Path(__file__).resolve().parent)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from uk_tax import (
    ASSET_TYPES, LIABILITY_TYPES,
    INVESTMENT_PENSION_TYPES, ISA_TYPES,
)
from snapshots import take_snapshot
from migrations import run_migrations
from db_auth import get_db, close_db, require_auth, DB_PATH
from routes_tools import tools_bp

# ── Config ────────────────────────────────────────────────────────────────────
# DB_PATH lives in db_auth so blueprints can share it without circular imports.
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = DB_PATH.parent
STATIC_DIR = BASE_DIR / "static"
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "changeme")

# 5 MB cap on request bodies — generous for JSON imports, blocks abuse.
MAX_CONTENT_LENGTH = 5 * 1024 * 1024

DATA_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="")
# Flask wants *a* SECRET_KEY for any session-derived feature. Auth here is
# Bearer-token via the auth_tokens table, so this is just to keep Flask happy —
# a fresh value per process is fine.
app.config["SECRET_KEY"] = secrets.token_hex(32)
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH

# Blueprints — calculator endpoints live in routes_tools (url_prefix /api/tools)
app.register_blueprint(tools_bp)


# ── Security headers ──────────────────────────────────────────────────────────
# Defence-in-depth for the SPA. CSP allows Google Fonts (the only external
# resource the app loads) and inline styles (the React tree uses style props
# heavily — converting to classes would be a large refactor). Connect-src is
# limited to self so the front-end can only talk to /api on the same origin.

CSP = (
    "default-src 'self'; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com; "
    "script-src 'self'; "
    "img-src 'self' data:; "
    "connect-src 'self'; "
    "frame-ancestors 'self'; "
    "base-uri 'self'; "
    "form-action 'self'"
)


@app.after_request
def add_security_headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    resp.headers.setdefault("Content-Security-Policy", CSP)
    resp.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
    return resp


# ── Database ──────────────────────────────────────────────────────────────────
# get_db, close_db, require_auth come from db_auth (shared with blueprints).

app.teardown_appcontext(close_db)


def init_db():
    """Create tables if they don't exist."""
    db = sqlite3.connect(str(DB_PATH))
    db.row_factory = sqlite3.Row
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
            employer_match_max_pct REAL NOT NULL DEFAULT 0,
            children_count INTEGER NOT NULL DEFAULT 0,
            spouse_income REAL NOT NULL DEFAULT 0,
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
            unrealised_gain REAL NOT NULL DEFAULT 0,
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

        -- Track failed login attempts per IP for rate limiting.
        CREATE TABLE IF NOT EXISTS auth_failures (
            ip TEXT PRIMARY KEY,
            count INTEGER NOT NULL DEFAULT 0,
            last_failure TEXT NOT NULL DEFAULT (datetime('now')),
            locked_until TEXT
        );
    """)
    db.commit()

    applied = run_migrations(db)
    if applied:
        print(f"Applied {applied} migration(s).")

    db.close()


def ensure_password_hash():
    """Hash ADMIN_PASSWORD and store it, or update the hash if the password changed.
    When the password changes, all existing Bearer tokens are invalidated so
    rotating the env var actually forces re-login everywhere."""
    db = sqlite3.connect(str(DB_PATH))
    db.row_factory = sqlite3.Row
    row = db.execute("SELECT password_hash FROM auth WHERE id = 1").fetchone()
    password_changed = (
        not row
        or not row["password_hash"]
        or not check_password_hash(row["password_hash"], ADMIN_PASSWORD)
    )
    if password_changed:
        db.execute(
            "INSERT OR REPLACE INTO auth (id, password_hash) VALUES (1, ?)",
            (generate_password_hash(ADMIN_PASSWORD),)
        )
        # Existing sessions are tied to the old credentials — wipe them.
        db.execute("DELETE FROM auth_tokens")
        db.commit()
    db.close()


# ── Auth (SQLite-backed tokens — survives across gunicorn workers) ────────────
# require_auth + get_db live in db_auth and are imported at the top.


# ── API Routes ────────────────────────────────────────────────────────────────

# ── Rate limiting for /api/auth/login ─────────────────────────────────────────
# Tracks failed attempts per IP in SQLite (so the limit holds across gunicorn
# workers and survives restarts). Reset after a quiet hour; lock after 5
# failures in any 10-minute window for 15 minutes.

AUTH_FAILURE_THRESHOLD = 5            # failures before lock
AUTH_FAILURE_WINDOW_MIN = 10          # only count failures within this window
AUTH_LOCKOUT_MIN = 15                 # how long the IP stays locked


def _client_ip():
    """Best-effort client IP. Honour X-Forwarded-For (set by reverse proxies)
    over remote_addr — useful when behind nginx/caddy."""
    fwd = request.headers.get("X-Forwarded-For", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.remote_addr or "unknown"


def _check_auth_lock(db, ip):
    """Returns seconds remaining on lockout, or 0 if not locked."""
    row = db.execute(
        "SELECT locked_until FROM auth_failures WHERE ip = ? AND locked_until > datetime('now')",
        (ip,)
    ).fetchone()
    if not row or not row["locked_until"]:
        return 0
    # Compute remaining seconds
    remaining = db.execute(
        "SELECT CAST((julianday(?) - julianday('now')) * 86400 AS INTEGER) AS s",
        (row["locked_until"],)
    ).fetchone()
    return max(0, remaining["s"] or 0)


def _record_auth_failure(db, ip):
    """Increment failure counter; lock if threshold exceeded inside the window."""
    row = db.execute("SELECT count, last_failure FROM auth_failures WHERE ip = ?", (ip,)).fetchone()
    # Reset counter if last failure was outside the rolling window
    if row:
        within_window = db.execute(
            "SELECT (julianday('now') - julianday(?)) * 24 * 60 < ? AS w",
            (row["last_failure"], AUTH_FAILURE_WINDOW_MIN)
        ).fetchone()["w"]
        count = (row["count"] + 1) if within_window else 1
    else:
        count = 1

    if count >= AUTH_FAILURE_THRESHOLD:
        db.execute(
            "INSERT OR REPLACE INTO auth_failures (ip, count, last_failure, locked_until) "
            "VALUES (?, ?, datetime('now'), datetime('now', ?))",
            (ip, count, f"+{AUTH_LOCKOUT_MIN} minutes")
        )
    else:
        db.execute(
            "INSERT OR REPLACE INTO auth_failures (ip, count, last_failure, locked_until) "
            "VALUES (?, ?, datetime('now'), NULL)",
            (ip, count)
        )
    db.commit()


def _clear_auth_failures(db, ip):
    db.execute("DELETE FROM auth_failures WHERE ip = ?", (ip,))
    db.commit()


@app.route("/api/auth/login", methods=["POST"])
def login():
    data = request.get_json()
    username = data.get("username", "")
    password = data.get("password", "")
    db = get_db()
    ip = _client_ip()

    # Refuse early if this IP is currently locked out
    locked_for = _check_auth_lock(db, ip)
    if locked_for > 0:
        resp = jsonify({
            "error": f"Too many failed attempts. Try again in {locked_for // 60 + 1} minute(s).",
            "retry_after": locked_for,
        })
        resp.status_code = 429
        resp.headers["Retry-After"] = str(locked_for)
        return resp

    auth_row = db.execute("SELECT password_hash FROM auth WHERE id = 1").fetchone()
    if username == ADMIN_USERNAME and auth_row and check_password_hash(auth_row["password_hash"], password):
        _clear_auth_failures(db, ip)
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

    _record_auth_failure(db, ip)
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
            state_pension_annual = ?, employer_match_max_pct = ?,
            children_count = ?, spouse_income = ?,
            updated_at = datetime('now')
        WHERE id = 1
    """, (
        data.get("name", ""), data.get("dob", "1980-01-01"),
        data.get("retirement_age", 57), data.get("gross_salary", 0),
        data.get("pension_contrib_pct", 0), data.get("employer_contrib_pct", 0),
        data.get("tax_code", "1257L"),
        data.get("state_pension_annual", 11500),
        data.get("employer_match_max_pct", 0),
        data.get("children_count", 0), data.get("spouse_income", 0),
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
            term_end_date, notes, sort_order, total_contributed,
            db_annual_pension, unrealised_gain)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data["name"], data["type"], data.get("balance", 0),
        data.get("provider", ""), data.get("contributing", False),
        data.get("monthly_contrib", 0), data.get("interest_rate", 0),
        data.get("rate_type", ""), data.get("fixed_until", ""),
        data.get("term_end_date", ""), data.get("notes", ""),
        data.get("sort_order", 0), data.get("total_contributed", 0),
        data.get("db_annual_pension", 0), data.get("unrealised_gain", 0),
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
        "term_end_date", "notes", "sort_order", "total_contributed",
        "db_annual_pension", "unrealised_gain",
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
    payload = request.get_json(silent=True) or {}
    snapshot_date, net_worth = take_snapshot(get_db(), payload.get("date"))
    return jsonify({"date": snapshot_date, "net_worth": net_worth}), 201


@app.route("/api/snapshots/<int:snapshot_id>", methods=["PUT"])
@require_auth
def update_snapshot(snapshot_id):
    """Edit a snapshot's date or values. If totals change, scale the stored
    category breakdown proportionally so the line chart and stacked chart
    stay consistent."""
    data = request.get_json()
    db = get_db()
    existing = db.execute("SELECT * FROM snapshots WHERE id = ?", (snapshot_id,)).fetchone()
    if not existing:
        return jsonify({"error": "Snapshot not found"}), 404

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

    new_assets = data.get("total_assets", existing["total_assets"])
    new_liabs = data.get("total_liabilities", existing["total_liabilities"])
    old_assets = existing["total_assets"] or 0
    old_liabs = existing["total_liabilities"] or 0
    if new_assets != old_assets or new_liabs != old_liabs:
        cats = db.execute(
            "SELECT id, category, value FROM snapshot_categories WHERE snapshot_id = ?",
            (snapshot_id,)
        ).fetchall()
        for c in cats:
            if c["category"] == "debts":
                if old_liabs > 0:
                    new_val = c["value"] * (new_liabs / old_liabs)
                else:
                    new_val = -new_liabs
            else:
                if old_assets > 0:
                    new_val = c["value"] * (new_assets / old_assets)
                else:
                    new_val = c["value"]
            db.execute(
                "UPDATE snapshot_categories SET value = ? WHERE id = ?",
                (new_val, c["id"])
            )

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


@app.route("/api/snapshots/import-csv", methods=["POST"])
@require_auth
def import_snapshots_csv():
    """Bulk-import historical snapshots from a CSV string.

    Accepts JSON: { "csv": "date,net_worth,total_assets,total_liabilities\\n..." }
    The header row is required. date and net_worth columns are mandatory;
    total_assets and total_liabilities are optional and default to net_worth
    and 0 respectively if absent.

    Uses INSERT OR REPLACE on date, so re-importing overwrites existing rows.
    """
    import csv as csv_lib
    import io
    from datetime import datetime as _dt

    data = request.get_json() or {}
    csv_text = (data.get("csv") or "").strip()
    if not csv_text:
        return jsonify({"error": "Empty CSV"}), 400

    try:
        reader = csv_lib.DictReader(io.StringIO(csv_text))
    except csv_lib.Error as e:
        return jsonify({"error": f"Could not parse CSV: {e}"}), 400

    if not reader.fieldnames or "date" not in reader.fieldnames or "net_worth" not in reader.fieldnames:
        return jsonify({"error": "CSV must have at least 'date' and 'net_worth' columns"}), 400

    db = get_db()
    imported, skipped, errors = 0, 0, []

    for line_no, row in enumerate(reader, start=2):  # line 1 is header
        raw_date = (row.get("date") or "").strip()
        raw_nw = (row.get("net_worth") or "").strip()
        if not raw_date or not raw_nw:
            skipped += 1
            continue
        # Validate date format
        try:
            _dt.strptime(raw_date, "%Y-%m-%d")
        except ValueError:
            errors.append(f"Line {line_no}: invalid date '{raw_date}' (expected YYYY-MM-DD)")
            skipped += 1
            continue
        try:
            net_worth = float(raw_nw.replace(",", "").replace("£", ""))
        except ValueError:
            errors.append(f"Line {line_no}: invalid net_worth '{raw_nw}'")
            skipped += 1
            continue

        # Optional columns
        def _opt(field, default):
            v = (row.get(field) or "").strip()
            if not v:
                return default
            try:
                return float(v.replace(",", "").replace("£", ""))
            except ValueError:
                return default

        total_assets = _opt("total_assets", net_worth if net_worth > 0 else 0)
        total_liabilities = _opt("total_liabilities", 0)

        db.execute(
            "INSERT OR REPLACE INTO snapshots (date, total_assets, total_liabilities, net_worth) "
            "VALUES (?, ?, ?, ?)",
            (raw_date, total_assets, total_liabilities, net_worth)
        )
        imported += 1

    db.commit()

    # Best-effort: fill in per-category breakdowns for any imported rows
    # that match current account data. Old dates won't get categories — fine.
    from snapshots import backfill_missing_categories
    backfill_missing_categories(db)

    return jsonify({
        "imported": imported,
        "skipped": skipped,
        "errors": errors[:20],  # cap so we don't blow up the response
    })


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

    # Best-effort current BoE base rate (used by advisor's mortgage-drift rule).
    # Returns whatever's already cached; if nothing's been fetched yet the rule
    # silently skips. The /api/rates/boe-base-rate endpoint populates the cache
    # when the user visits the Rates tab (and the cron snapshot warms it too).
    boe_rate = None
    if BOE_RATE_CACHE.get("data"):
        boe_rate = BOE_RATE_CACHE["data"].get("current_rate")

    return jsonify({
        "profile": profile,
        "accounts": accounts,
        "boe_rate": boe_rate,
        "settings": settings,
        "snapshots": snapshots,
        "goals": goals,
    })


# ── Data export/import ────────────────────────────────────────────────────────

@app.route("/api/export", methods=["GET"])
@require_auth
def export_data():
    db = get_db()
    snapshots = [dict(r) for r in db.execute("SELECT * FROM snapshots ORDER BY date").fetchall()]
    if snapshots:
        ids = [s["id"] for s in snapshots]
        placeholders = ",".join("?" * len(ids))
        cat_rows = db.execute(
            f"SELECT snapshot_id, category, value FROM snapshot_categories WHERE snapshot_id IN ({placeholders})",
            ids,
        ).fetchall()
        by_snap = {}
        for r in cat_rows:
            by_snap.setdefault(r["snapshot_id"], {})[r["category"]] = r["value"]
        for s in snapshots:
            s["categories"] = by_snap.get(s["id"], {})

    data = {
        "profile": dict(db.execute("SELECT * FROM profile WHERE id = 1").fetchone()),
        "accounts": [dict(r) for r in db.execute("SELECT * FROM accounts").fetchall()],
        "settings": dict(db.execute("SELECT * FROM settings WHERE id = 1").fetchone()),
        "snapshots": snapshots,
        "goals": [dict(r) for r in db.execute("SELECT * FROM goals ORDER BY sort_order, id").fetchall()],
        "exported_at": datetime.now().isoformat(),
    }
    return jsonify(data)


def _backup_database(prefix="preimport"):
    """Write a timestamped copy of the live DB to the backup directory using
    SQLite's online backup API. Returns the backup filename."""
    backup_dir = Path(os.environ.get("BACKUP_DIR", str(DATA_DIR / "backups")))
    backup_dir.mkdir(parents=True, exist_ok=True)
    name = f"cairn-{prefix}-{datetime.now().strftime('%Y%m%d-%H%M%S')}.db"
    dst = sqlite3.connect(str(backup_dir / name))
    try:
        get_db().backup(dst)
    finally:
        dst.close()
    return name


@app.route("/api/import", methods=["POST"])
@require_auth
def import_data():
    data = request.get_json()
    if not isinstance(data, dict) or not data:
        return jsonify({"error": "Import payload must be a JSON object"}), 400

    # The import is destructive (accounts and goals are wiped before
    # re-inserting), so refuse to proceed unless we've safely stashed a copy
    # of the current database first.
    try:
        backup_name = _backup_database("preimport")
    except Exception as e:
        return jsonify({"error": f"Pre-import backup failed — aborting import: {e}"}), 500

    db = get_db()
    try:
        _apply_import(db, data)
        db.commit()
    except Exception as e:
        db.rollback()
        return jsonify({
            "error": f"Import failed and was rolled back: {e}",
            "backup": backup_name,
        }), 400

    return jsonify({"ok": True, "message": "Data imported successfully", "backup": backup_name})


def _apply_import(db, data):
    """Apply an import payload inside the caller's transaction. Raises on any
    malformed row — the caller rolls back, so partial imports never land."""
    if "profile" in data:
        p = data["profile"]
        db.execute("""
            UPDATE profile SET name=?, dob=?, retirement_age=?, gross_salary=?,
                pension_contrib_pct=?, employer_contrib_pct=?, tax_code=?,
                state_pension_annual=?, employer_match_max_pct=?,
                children_count=?, spouse_income=?,
                updated_at=datetime('now')
            WHERE id = 1
        """, (p.get("name",""), p.get("dob","1980-01-01"), p.get("retirement_age",57),
              p.get("gross_salary",0), p.get("pension_contrib_pct",0),
              p.get("employer_contrib_pct",0), p.get("tax_code","1257L"),
              p.get("state_pension_annual",11500), p.get("employer_match_max_pct",0),
              p.get("children_count",0), p.get("spouse_income",0)))

    if "accounts" in data:
        db.execute("DELETE FROM accounts")
        for a in data["accounts"]:
            db.execute("""
                INSERT INTO accounts (name,type,balance,provider,contributing,
                    monthly_contrib,interest_rate,rate_type,fixed_until,
                    term_end_date,notes,sort_order,total_contributed,
                    db_annual_pension,unrealised_gain)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (a["name"], a["type"], a.get("balance",0), a.get("provider",""),
                  a.get("contributing",0), a.get("monthly_contrib",0),
                  a.get("interest_rate",0), a.get("rate_type",""),
                  a.get("fixed_until",""), a.get("term_end_date",""),
                  a.get("notes",""), a.get("sort_order",0),
                  a.get("total_contributed",0), a.get("db_annual_pension",0),
                  a.get("unrealised_gain",0)))

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
            cats = snap.get("categories") or {}
            if cats:
                sid_row = db.execute("SELECT id FROM snapshots WHERE date = ?", (snap["date"],)).fetchone()
                if sid_row:
                    sid = sid_row["id"]
                    db.execute("DELETE FROM snapshot_categories WHERE snapshot_id = ?", (sid,))
                    for cat, value in cats.items():
                        db.execute(
                            "INSERT INTO snapshot_categories (snapshot_id, category, value) VALUES (?, ?, ?)",
                            (sid, cat, value),
                        )

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


# ── AI Commentary (Claude API) ────────────────────────────────────────────────

import anthropic

CLAUDE_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL = "claude-sonnet-4-6"

# Marked cacheable. Anthropic ignores cache_control on prefixes below ~2k tokens,
# so today this is a no-op — but the structure is in place if the persona grows
# (e.g. richer UK tax context). Volatile per-user data lives in the user turn.
_COMMENTARY_SYSTEM_PROMPT = (
    "You are a knowledgeable UK personal finance commentator. Provide a "
    "concise, plain-English analysis of the person's financial position from "
    "the data they share. Be direct, practical, and specific. Focus on "
    "actionable observations and prioritise the things that would move the "
    "needle most for them.\n\n"
    "UK context to apply when relevant:\n"
    "- ISA allowance £20,000/year; pension annual allowance £60,000, with "
    "carry-forward of unused allowance from the 3 prior tax years.\n"
    "- Scotland and rest-of-UK have different income tax bands; salary "
    "sacrifice saves both income tax and employee NI.\n"
    "- Personal Allowance tapers between £100k and £125,140 of income, "
    "creating a ~60% effective marginal rate in that band.\n"
    "- 4% Trinity-style drawdown is the common FIRE benchmark; 3.0–3.5% is "
    "more conservative for early retirees with longer horizons.\n"
    "- Full new State Pension is roughly £11,500/year from State Pension age "
    "(currently 67). Private pension access age rises from 55 to 57 in "
    "April 2028.\n\n"
    "Do NOT give regulated financial advice — frame everything as general "
    "observations. End with a one-line reminder that this is general "
    "information, not advice.\n\n"
    "Output: 3-4 short paragraphs of plain prose. No bullet lists, no "
    "section headers."
)


@app.route("/api/ai/commentary", methods=["POST"])
@require_auth
def ai_commentary():
    """Generate natural-language financial commentary using the Claude API."""
    if not CLAUDE_API_KEY:
        return jsonify({"error": "ANTHROPIC_API_KEY not configured"}), 503

    db = get_db()
    profile = dict(db.execute("SELECT * FROM profile WHERE id = 1").fetchone())
    accounts = [dict(r) for r in db.execute("SELECT * FROM accounts ORDER BY sort_order, id").fetchall()]
    settings = dict(db.execute("SELECT * FROM settings WHERE id = 1").fetchone())
    snapshots = [dict(r) for r in db.execute(
        "SELECT date, net_worth, total_assets, total_liabilities FROM snapshots ORDER BY date DESC LIMIT 12"
    ).fetchall()]

    # Numerical summary only — no account names or personal identifiers.
    total_assets = sum(a["balance"] for a in accounts if a["type"] in ASSET_TYPES)
    total_liabilities = sum(abs(a["balance"]) for a in accounts if a["type"] in LIABILITY_TYPES)
    net_worth = total_assets - total_liabilities

    try:
        dob = datetime.strptime(profile["dob"], "%Y-%m-%d").date()
        today = date.today()
        age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
    except Exception:
        age = 45

    account_summary = []
    for a in accounts:
        entry = f"- {a['type']}: £{abs(a['balance']):,.0f}"
        if a.get("interest_rate"):
            rt = a.get("rate_type") or "APR"
            entry += f" ({a['interest_rate']}% {rt})"
        if a.get("monthly_contrib"):
            entry += f", £{abs(a['monthly_contrib']):,.0f}/month contributions"
        account_summary.append(entry)

    pension_annual = profile["gross_salary"] * ((profile["pension_contrib_pct"] + profile["employer_contrib_pct"]) / 100)
    isa_monthly = sum((a.get("monthly_contrib") or 0) for a in accounts if a["type"] in ISA_TYPES)

    snapshot_trend = ""
    if len(snapshots) >= 2:
        latest = snapshots[0]["net_worth"]
        oldest = snapshots[-1]["net_worth"]
        snapshot_trend = (
            f"Net worth trend over last {len(snapshots)} months: "
            f"£{oldest:,.0f} → £{latest:,.0f} (change: £{latest - oldest:+,.0f})\n"
        )

    user_message = (
        "FINANCIAL SNAPSHOT:\n"
        f"- Age: {age}, target retirement age: {profile['retirement_age']} "
        f"({profile['retirement_age'] - age} years)\n"
        f"- Gross salary: £{profile['gross_salary']:,.0f}\n"
        f"- Pension contributions: {profile['pension_contrib_pct']}% employee + "
        f"{profile['employer_contrib_pct']}% employer = £{pension_annual:,.0f}/year\n"
        f"- ISA monthly contributions: £{isa_monthly:,.0f}\n"
        f"- Net worth: £{net_worth:,.0f} (assets: £{total_assets:,.0f}, "
        f"liabilities: £{total_liabilities:,.0f})\n"
        f"- Tax region: {settings.get('tax_region', 'scotland')}\n"
        f"- Assumptions: {settings['growth_rate']}% growth, "
        f"{settings['inflation_rate']}% inflation\n"
        f"{snapshot_trend}\n"
        "ACCOUNTS:\n"
        + "\n".join(account_summary)
        + "\n\nGive your analysis now. Be encouraging where appropriate but "
        "honest about areas for improvement."
    )

    client = anthropic.Anthropic(api_key=CLAUDE_API_KEY)
    try:
        response = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=1024,
            # Plain text generation — no reasoning needed, keeps latency low.
            thinking={"type": "disabled"},
            output_config={"effort": "low"},
            system=[{
                "type": "text",
                "text": _COMMENTARY_SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }],
            messages=[{"role": "user", "content": user_message}],
        )
    except anthropic.AuthenticationError:
        return jsonify({"error": "Anthropic API key is invalid"}), 502
    except anthropic.RateLimitError:
        return jsonify({"error": "Anthropic API rate limit reached — try again shortly"}), 503
    except anthropic.APIStatusError as e:
        return jsonify({"error": f"Claude API error: {e.status_code}", "detail": str(e)}), 502
    except anthropic.APIError as e:
        return jsonify({"error": f"Claude API error: {e}"}), 502

    text = "".join(block.text for block in response.content if block.type == "text")
    return jsonify({"commentary": text})


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
