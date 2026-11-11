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
import uk_tax
import boe
from snapshots import take_snapshot, rescale_categories, upsert_snapshot_totals
from migrations import run_migrations
from db_auth import (
    get_db, close_db, require_auth, DB_PATH,
    BadInput, json_body, as_number, as_text, as_date,
)
from routes_tools import tools_bp

# ── Config ────────────────────────────────────────────────────────────────────
# DB_PATH lives in db_auth so blueprints can share it without circular imports.
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = DB_PATH.parent
STATIC_DIR = BASE_DIR / "static"
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
# Values the app refuses to start with: unset, the old docker-compose default,
# and the .env.example placeholder. Checked in ensure_password_hash().
INSECURE_PASSWORDS = {"", "changeme", "change-this-to-something-secure"}

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
# Defence-in-depth for the SPA. Everything is same-origin (fonts are bundled
# via @fontsource, so the browser contacts no third party). Inline styles are
# allowed because the React tree uses style props heavily — converting to
# classes would be a large refactor. Connect-src is
# limited to self so the front-end can only talk to /api on the same origin.

CSP = (
    "default-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "font-src 'self'; "
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


# ── Input validation ──────────────────────────────────────────────────────────
# Validators (db_auth.py) raise BadInput; this turns it into a 400 instead of
# letting a malformed body surface as a 500.

@app.errorhandler(BadInput)
def handle_bad_input(e):
    return jsonify({"error": str(e)}), 400


@app.errorhandler(404)
def handle_not_found(e):
    # The API client expects JSON errors; everything else keeps Flask's default.
    if request.path.startswith("/api/"):
        return jsonify({"error": "Not found"}), 404
    return e


VALID_ACCOUNT_TYPES = ASSET_TYPES | LIABILITY_TYPES

# Writable columns per table, by kind. Anything not listed is ignored, and
# these tuples are the only source of column names for the dynamic SQL below.
_ACCOUNT_NUMBERS = ("balance", "monthly_contrib", "interest_rate", "sort_order",
                    "total_contributed", "db_annual_pension", "unrealised_gain", "ytd_contrib")
_ACCOUNT_TEXT = ("provider", "rate_type", "fixed_until", "term_end_date", "notes", "ytd_tax_year")
_PROFILE_NUMBERS = ("retirement_age", "gross_salary", "pension_contrib_pct", "employer_contrib_pct",
                    "state_pension_annual", "employer_match_max_pct", "children_count", "spouse_income",
                    "monthly_spending")
_PROFILE_TEXT = ("name", "tax_code")
_SETTINGS_NUMBERS = ("growth_rate", "inflation_rate", "isa_allowance", "pension_annual_allowance",
                     "tracker_margin", "mortgage_remaining_years", "net_worth_target")
_SETTINGS_TEXT = ("tax_year", "net_worth_target_date", "tax_region")
_GOAL_NUMBERS = ("target_amount", "sort_order")
_GOAL_TEXT = ("name", "description", "target_date", "icon", "link_type", "link_value")


def _clean(data, numbers, text, partial):
    """Whitelist and type-check a request object. With partial=True only the
    keys present are returned (PATCH semantics); otherwise every field is
    returned, blank ones as 0 / ""."""
    if not isinstance(data, dict):
        raise BadInput("Expected a JSON object")
    out = {}
    for key in numbers:
        if key in data or not partial:
            out[key] = as_number(data.get(key), key)
    for key in text:
        if key in data or not partial:
            out[key] = as_text(data.get(key), key)
    return out


def _clean_account(data, partial=False):
    out = _clean(data, _ACCOUNT_NUMBERS, _ACCOUNT_TEXT, partial)
    if "name" in data or not partial:
        out["name"] = as_text(data.get("name"), "name")
        if not out["name"].strip():
            raise BadInput("Account name is required")
    if "type" in data or not partial:
        acct_type = data.get("type")
        # An unknown type would be stored but silently left out of every total.
        if not isinstance(acct_type, str) or acct_type not in VALID_ACCOUNT_TYPES:
            raise BadInput(f"Unknown account type: {acct_type!r}")
        out["type"] = acct_type
    if "contributing" in data or not partial:
        out["contributing"] = 1 if data.get("contributing") else 0
    return out


def _clean_profile(data):
    out = _clean(data, _PROFILE_NUMBERS, _PROFILE_TEXT, partial=True)
    if "dob" in data:
        out["dob"] = as_date(data["dob"], "dob")
    return out


def _clean_settings(data):
    return _clean(data, _SETTINGS_NUMBERS, _SETTINGS_TEXT, partial=True)


def _clean_goal(data, partial=False):
    return _clean(data, _GOAL_NUMBERS, _GOAL_TEXT, partial)


def _insert_row(db, table, values):
    """INSERT a cleaned dict. Column names come from the whitelists above."""
    cols = list(values)
    return db.execute(
        f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
        [values[c] for c in cols],
    )


def _update_row(db, table, row_id, values):
    """UPDATE the given columns of one row (plus updated_at)."""
    assignments = ", ".join(f"{c} = ?" for c in values)
    db.execute(
        f"UPDATE {table} SET {assignments}, updated_at = datetime('now') WHERE id = ?",
        [*values.values(), row_id],
    )


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
            state_pension_annual REAL NOT NULL DEFAULT 12548,
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
            tax_year TEXT NOT NULL DEFAULT '2026/27',
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
    rotating the env var actually forces re-login everywhere.

    Exits rather than start with no password or a known placeholder — this
    app holds someone's finances, and the repo (defaults included) is public."""
    if ADMIN_PASSWORD.strip() in INSECURE_PASSWORDS:
        raise SystemExit(
            "Cairn will not start: ADMIN_PASSWORD is unset or still a placeholder. "
            "Set a real password in .env (or the container's environment) and start again."
        )
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
    data = json_body()
    username = as_text(data.get("username"), "username")
    password = as_text(data.get("password"), "password")
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
    """Update the profile. Only the fields present in the body change — a
    partial payload no longer resets everything else to its default."""
    values = _clean_profile(json_body())
    if not values:
        return jsonify({"error": "No fields to update"}), 400
    db = get_db()
    _update_row(db, "profile", 1, values)
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
    values = _clean_account(json_body())
    db = get_db()
    cursor = _insert_row(db, "accounts", values)
    db.commit()
    return jsonify({"id": cursor.lastrowid}), 201


@app.route("/api/accounts/<int:account_id>", methods=["PUT"])
@require_auth
def update_account(account_id):
    values = _clean_account(json_body(), partial=True)
    if not values:
        return jsonify({"error": "No fields to update"}), 400
    db = get_db()
    _update_row(db, "accounts", account_id, values)
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
    payload = request.get_json(silent=True)
    payload = payload if isinstance(payload, dict) else {}
    requested = as_date(payload.get("date"), "date", allow_blank=True) or None
    snapshot_date, net_worth = take_snapshot(get_db(), requested)
    return jsonify({"date": snapshot_date, "net_worth": net_worth}), 201


@app.route("/api/snapshots/<int:snapshot_id>", methods=["PUT"])
@require_auth
def update_snapshot(snapshot_id):
    """Edit a snapshot's date or values. If totals change, scale the stored
    category breakdown proportionally so the line chart and stacked chart
    stay consistent."""
    data = json_body()
    db = get_db()
    existing = db.execute("SELECT * FROM snapshots WHERE id = ?", (snapshot_id,)).fetchone()
    if not existing:
        return jsonify({"error": "Snapshot not found"}), 404

    values = {}
    if "date" in data:
        values["date"] = as_date(data["date"], "date")
    for key in ("net_worth", "total_assets", "total_liabilities"):
        if key in data:
            values[key] = as_number(data[key], key)
    if not values:
        return jsonify({"error": "No fields to update"}), 400

    assignments = ", ".join(f"{k} = ?" for k in values)
    try:
        db.execute(f"UPDATE snapshots SET {assignments} WHERE id = ?", [*values.values(), snapshot_id])
    except sqlite3.IntegrityError:
        return jsonify({"error": "A snapshot already exists for that date"}), 409

    rescale_categories(
        db, snapshot_id,
        existing["total_assets"], existing["total_liabilities"],
        values.get("total_assets", existing["total_assets"]),
        values.get("total_liabilities", existing["total_liabilities"]),
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

    Rows are upserted by date, so re-importing overwrites the totals of
    existing rows while keeping (and rescaling) their category breakdown.
    """
    import csv as csv_lib
    import io
    from datetime import datetime as _dt

    data = json_body()
    csv_text = as_text(data.get("csv"), "csv").strip()
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

        # Upsert by date: an existing row keeps its id and category breakdown.
        upsert_snapshot_totals(db, raw_date, net_worth, total_assets, total_liabilities)
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
    values = _clean_goal(json_body())
    db = get_db()
    cursor = _insert_row(db, "goals", values)
    db.commit()
    row = db.execute("SELECT * FROM goals WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return jsonify(dict(row)), 201


@app.route("/api/goals/<int:goal_id>", methods=["PUT"])
@require_auth
def update_goal(goal_id):
    values = _clean_goal(json_body(), partial=True)
    if not values:
        return jsonify({"error": "No fields to update"}), 400
    db = get_db()
    _update_row(db, "goals", goal_id, values)
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
    """Update settings. Only the fields present in the body change."""
    values = _clean_settings(json_body())
    if not values:
        return jsonify({"error": "No fields to update"}), 400
    db = get_db()
    _update_row(db, "settings", 1, values)
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

    # Current BoE base rate for the advisor's mortgage-drift rule. Read from the
    # SQLite cache only — no network here, so the dashboard stays fast. It is
    # None until /api/rates/boe-base-rate has run once (the frontend calls it
    # in the background when it sees null).
    boe_rate = boe.cached_current_rate(db)

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
    data = request.get_json(silent=True)
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
    malformed row — the caller rolls back, so partial imports never land.
    Rows go through the same cleaners as the normal CRUD routes."""
    if "profile" in data:
        values = _clean_profile(data["profile"])
        if values:
            _update_row(db, "profile", 1, values)

    if "accounts" in data:
        if not isinstance(data["accounts"], list):
            raise BadInput("'accounts' must be a list")
        cleaned = [_clean_account(a) for a in data["accounts"]]
        db.execute("DELETE FROM accounts")
        for values in cleaned:
            _insert_row(db, "accounts", values)

    if "settings" in data:
        values = _clean_settings(data["settings"])
        if values:
            _update_row(db, "settings", 1, values)

    if "snapshots" in data:
        if not isinstance(data["snapshots"], list):
            raise BadInput("'snapshots' must be a list")
        for snap in data["snapshots"]:
            if not isinstance(snap, dict):
                raise BadInput("Each snapshot must be an object")
            sid = upsert_snapshot_totals(
                db,
                as_date(snap.get("date"), "snapshot date"),
                as_number(snap.get("net_worth"), "net_worth"),
                as_number(snap.get("total_assets"), "total_assets"),
                as_number(snap.get("total_liabilities"), "total_liabilities"),
            )
            if "breakdown" in snap:
                db.execute("UPDATE snapshots SET breakdown = ? WHERE id = ?",
                           (as_text(snap["breakdown"], "breakdown", "{}"), sid))
            cats = snap.get("categories") or {}
            if cats:
                if not isinstance(cats, dict):
                    raise BadInput("Snapshot 'categories' must be an object")
                db.execute("DELETE FROM snapshot_categories WHERE snapshot_id = ?", (sid,))
                for cat, value in cats.items():
                    db.execute(
                        "INSERT INTO snapshot_categories (snapshot_id, category, value) VALUES (?, ?, ?)",
                        (sid, cat, as_number(value, f"category {cat}")),
                    )

    if "goals" in data:
        if not isinstance(data["goals"], list):
            raise BadInput("'goals' must be a list")
        cleaned = [_clean_goal(g) for g in data["goals"]]
        db.execute("DELETE FROM goals")
        for values in cleaned:
            _insert_row(db, "goals", values)


# ── AI Commentary (Claude API) ────────────────────────────────────────────────

import hashlib

import anthropic

CLAUDE_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL = "claude-sonnet-5-5"


def _gbp(n):
    return f"£{n:,.0f}"


# Built once at import from uk_tax so the figures Claude is told about always
# match the ones the rest of the app calculates with. Marked cacheable: today
# it sits below the model's minimum cacheable prefix, so caching is a silent
# no-op, but it costs nothing. Everything per-user lives in the user turn so
# this prefix stays stable.
_COMMENTARY_SYSTEM_PROMPT = f"""You are a UK personal finance commentator built into Cairn, a self-hosted dashboard someone runs for their own finances. When they press a button, you write a short review of their position, which they read alongside the dashboard's own charts and rule-based insights.

Write three or four short paragraphs of plain prose, roughly 250 to 350 words in total. The review appears in a plain-text panel that does not render markdown, so asterisks, hashes or list markers would show up as literal characters. Write it the way you would write a letter.

Be direct and specific to the numbers you are given. Open with the one or two observations that would make the biggest difference, quote the figures behind them, and leave out anything that is simply fine. Where something is going well, say so briefly; where something needs attention, say so plainly. Work only from the data provided: if something you would need is missing, such as an age or any pension data, say what is missing rather than assuming a value. Cairn does not record a target retirement income, and monthly spending appears in the data only if the user has entered it. Where a spending figure is given, use it to judge whether the projected retirement income looks sufficient. Where it is absent, don't list it as missing data; if it matters for judging whether retirement is on track, suggest the user tries their own figures in Cairn's FIRE calculator or drawdown simulator.

The retirement income section lists the guaranteed income Cairn knows about. Use the State Pension figure as given and say whether it is the user's own forecast or Cairn's default, because a default may overstate what someone with gaps in their National Insurance record will get. Bear in mind that it only starts at State Pension age, so any years between the target retirement age and State Pension age have to be bridged from savings.

This is general information, not regulated financial advice. You have not done a fact-find and cannot see their full circumstances, so frame suggestions as things worth considering or checking rather than instructions. Finish with a single sentence saying that this is general information rather than financial advice.

The UK rules below are the ones Cairn uses for its own calculations. Rely on them rather than on figures you remember, so that your commentary agrees with the rest of the dashboard.

<uk_rules tax_year="{uk_tax.TAX_YEAR_LABEL}">
Personal Allowance is {_gbp(uk_tax.PERSONAL_ALLOWANCE)}. It tapers away by £1 for every £2 of income between {_gbp(uk_tax.PERSONAL_ALLOWANCE_TAPER_START)} and {_gbp(uk_tax.PERSONAL_ALLOWANCE_TAPER_END)}, which creates an effective marginal rate of around 60% (higher in Scotland) in that band.
Scotland has six income tax bands; its {uk_tax.SCOTLAND_HIGHER_RATE_PCT}% higher rate starts at {_gbp(uk_tax.SCOTLAND_HIGHER_RATE_THRESHOLD)}. The rest of the UK has three bands; its {uk_tax.RUK_HIGHER_RATE_PCT}% higher rate starts at {_gbp(uk_tax.RUK_HIGHER_RATE_THRESHOLD)}. National Insurance is the same everywhere: {uk_tax.NI_RATE_MAIN:.0%} between {_gbp(uk_tax.NI_PRIMARY_THRESHOLD)} and {_gbp(uk_tax.NI_UPPER_EARNINGS_LIMIT)}, {uk_tax.NI_RATE_UEL_PLUS:.0%} above. Salary sacrifice into a pension saves both income tax and employee NI.
ISA allowance is {_gbp(uk_tax.ISA_ANNUAL_ALLOWANCE)} a year across all ISAs. A Lifetime ISA takes up to {_gbp(uk_tax.LISA_ANNUAL_ALLOWANCE)} of that with a {uk_tax.LISA_BONUS_PCT}% government bonus, can be opened before {uk_tax.LISA_OPEN_MAX_AGE}, and is penalty-free from {uk_tax.LISA_ACCESS_AGE} or for a first home.
Pension annual allowance is {_gbp(uk_tax.PENSION_ANNUAL_ALLOWANCE)}, with unused allowance carried forward from the three previous tax years. It tapers for very high earners (threshold income above {_gbp(uk_tax.AA_TAPER_THRESHOLD_INCOME)} and adjusted income above {_gbp(uk_tax.AA_TAPER_ADJUSTED_INCOME)}) to a minimum of {_gbp(uk_tax.AA_TAPER_MIN_ALLOWANCE)}.
Private pensions can be accessed from 55, rising to {uk_tax.PENSION_ACCESS_AGE} in April 2028. State Pension age is 66, 67 or 68 depending on date of birth (the user's is given in the retirement income section), and the full new State Pension is roughly {_gbp(uk_tax.STATE_PENSION_ANNUAL_DEFAULT)} a year.
Capital gains outside ISAs and pensions have a {_gbp(uk_tax.CGT_ANNUAL_ALLOWANCE)} annual exemption, then {uk_tax.CGT_BASIC_RATE_PCT}% or {uk_tax.CGT_HIGHER_RATE_PCT}%.
For retirement drawdown, 4% is the common benchmark; 3 to 3.5% is more conservative for early retirees with longer horizons.
</uk_rules>"""


def _build_commentary_input(db):
    """Return the per-user data block sent to Claude (without the as-of date).

    Kept separate from the request so the cached analysis can be checked
    against current data: a hash of this block is stored with each cached
    reply, and a mismatch means the figures have changed since.
    """
    profile = dict(db.execute("SELECT * FROM profile WHERE id = 1").fetchone())
    accounts = [dict(r) for r in db.execute("SELECT * FROM accounts ORDER BY sort_order, id").fetchall()]
    settings = dict(db.execute("SELECT * FROM settings WHERE id = 1").fetchone())
    snapshots = [dict(r) for r in db.execute(
        "SELECT date, net_worth FROM snapshots ORDER BY date DESC LIMIT 12"
    ).fetchall()]

    # Numerical summary only — no account names or personal identifiers.
    total_assets = sum(a["balance"] for a in accounts if a["type"] in ASSET_TYPES)
    total_liabilities = sum(abs(a["balance"]) for a in accounts if a["type"] in LIABILITY_TYPES)
    net_worth = total_assets - total_liabilities

    today = date.today()
    try:
        dob = datetime.strptime(profile["dob"], "%Y-%m-%d").date()
        age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
    except Exception:
        age = None  # Tell Claude it's missing rather than inventing one.

    retirement_age = profile.get("retirement_age")
    if age is not None and retirement_age:
        age_line = f"Age: {age}; target retirement age {retirement_age} ({retirement_age - age} years away)"
    elif retirement_age:
        age_line = f"Age: not provided; target retirement age {retirement_age}"
    else:
        age_line = f"Age: {age if age is not None else 'not provided'}; target retirement age not set"

    account_lines = []
    for a in accounts:
        label = uk_tax.ACCOUNT_LABELS.get(a["type"], a["type"])
        kind = "liability" if a["type"] in LIABILITY_TYPES else "asset"
        entry = f"{label} ({kind}): {_gbp(abs(a['balance']))}"
        if a.get("interest_rate"):
            entry += f", {a['interest_rate']}% {a.get('rate_type') or 'APR'}"
        if a.get("monthly_contrib"):
            entry += f", {_gbp(abs(a['monthly_contrib']))}/month contributions"
        if a["type"] == "PENSION_DB" and a.get("db_annual_pension"):
            entry += f", pays {_gbp(a['db_annual_pension'])}/year from scheme pension age"
        account_lines.append(entry)

    gross = profile.get("gross_salary") or 0
    emp_pct = profile.get("pension_contrib_pct") or 0
    er_pct = profile.get("employer_contrib_pct") or 0
    pension_annual = gross * (emp_pct + er_pct) / 100
    isa_monthly = sum((a.get("monthly_contrib") or 0) for a in accounts if a["type"] in ISA_TYPES)
    region = "Scotland" if settings.get("tax_region", "scotland") == "scotland" else "rest of UK"

    # Retirement income Cairn already knows about. The State Pension figure is
    # the user's own forecast (or the full-rate default if they never changed it).
    sp_annual = profile.get("state_pension_annual") or 0
    sp_is_default = round(sp_annual) == uk_tax.STATE_PENSION_ANNUAL_DEFAULT
    db_income = sum((a.get("db_annual_pension") or 0) for a in accounts if a["type"] == "PENSION_DB")
    retirement_lines = [
        f"State Pension: {_gbp(sp_annual)}/year from State Pension age {uk_tax.state_pension_age(profile.get('dob'))}"
        + (" (Cairn's full-rate default; the user hasn't entered their own forecast)" if sp_is_default
           else " (the user's own forecast)"),
        f"Defined benefit pension income: {_gbp(db_income)}/year" if db_income
        else "Defined benefit pension income: none recorded",
    ]
    if settings.get("net_worth_target"):
        target = f"Net worth target: {_gbp(settings['net_worth_target'])}"
        if settings.get("net_worth_target_date"):
            target += f" by {settings['net_worth_target_date']}"
        retirement_lines.append(target)

    # Oldest first, so the trend reads left to right.
    history_lines = [f"{s['date']}: {_gbp(s['net_worth'])}" for s in reversed(snapshots)]

    return (
        f"{age_line}\n"
        f"Tax region: {region}\n"
        f"Gross salary: {_gbp(gross)}\n"
        f"Workplace pension: {emp_pct}% employee + {er_pct}% employer = {_gbp(pension_annual)}/year\n"
        f"ISA contributions: {_gbp(isa_monthly)}/month\n"
        + (f"Monthly spending (entered by the user): {_gbp(profile['monthly_spending'])}\n"
           if profile.get("monthly_spending") else "")
        +
        f"Net worth: {_gbp(net_worth)} (assets {_gbp(total_assets)}, liabilities {_gbp(total_liabilities)})\n"
        f"Planning assumptions: {settings['growth_rate']}% growth, {settings['inflation_rate']}% inflation\n"
        "</financial_snapshot>\n\n"
        "<retirement_income>\n" + "\n".join(retirement_lines) + "\n</retirement_income>\n\n"
        "<accounts>\n" + ("\n".join(account_lines) or "No accounts entered") + "\n</accounts>\n\n"
        "<net_worth_history>\n" + ("\n".join(history_lines) or "No snapshots yet") + "\n</net_worth_history>"
    )


def _input_hash(block):
    return hashlib.sha256(block.encode("utf-8")).hexdigest()


def _cached_commentary(db, current_hash=None):
    row = db.execute(
        "SELECT commentary, model, input_hash, generated_at FROM ai_commentary WHERE id = 1"
    ).fetchone()
    if not row:
        return {"commentary": None}
    out = {
        "commentary": row["commentary"],
        "model": row["model"],
        "generated_at": row["generated_at"],
    }
    if current_hash is not None:
        out["data_changed"] = row["input_hash"] != current_hash
    return out


@app.route("/api/ai/commentary", methods=["GET"])
@require_auth
def get_ai_commentary():
    """Return the last generated analysis (if any) without calling Claude."""
    db = get_db()
    return jsonify(_cached_commentary(db, _input_hash(_build_commentary_input(db))))


@app.route("/api/ai/commentary", methods=["POST"])
@require_auth
def ai_commentary():
    """Generate a fresh analysis with the Claude API and cache it."""
    if not CLAUDE_API_KEY:
        return jsonify({"error": "ANTHROPIC_API_KEY not configured"}), 503

    db = get_db()
    block = _build_commentary_input(db)
    user_message = (
        f'<financial_snapshot as_of="{date.today().isoformat()}">\n'
        + block
        + "\n\nWrite the review."
    )

    client = anthropic.Anthropic(api_key=CLAUDE_API_KEY)
    try:
        response = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=1024,
            # Sonnet 5.5 rejects thinking "disabled". "between_tools" only thinks
            # between tool calls, so with no tools there's no up-front thinking;
            # low effort keeps latency down for plain prose generation.
            thinking={"type": "between_tools"},
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

    text = "".join(b.text for b in response.content if b.type == "text").strip()
    if not text:
        return jsonify({"error": "Claude returned an empty response — try again"}), 502

    current_hash = _input_hash(block)
    db.execute(
        "INSERT OR REPLACE INTO ai_commentary (id, commentary, model, input_hash, generated_at)"
        " VALUES (1, ?, ?, ?, datetime('now'))",
        (text, CLAUDE_MODEL, current_hash),
    )
    db.commit()
    return jsonify(_cached_commentary(db, current_hash))


# ── BoE Base Rate Data ────────────────────────────────────────────────────────

@app.route("/api/rates/boe-base-rate", methods=["GET"])
@require_auth
def boe_base_rate():
    """Bank of England base rate history. Fetching, the SQLite-backed cache
    (shared by both gunicorn workers) and the hard-coded fallback history all
    live in boe.py."""
    return jsonify(boe.get_rates(get_db()))



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
        # The Werkzeug debugger executes arbitrary code, so debug mode only
        # listens on loopback unless HOST is set explicitly.
        app.run(host=os.environ.get("HOST", "127.0.0.1"), port=port, debug=True)
    else:
        # Production: use gunicorn
        import subprocess
        subprocess.run([
            "gunicorn", "backend.app:app",
            "--bind", f"0.0.0.0:{port}",
            "--workers", "2",
            "--timeout", "120",
        ])
