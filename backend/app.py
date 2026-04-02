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
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Seed defaults if empty
        INSERT OR IGNORE INTO profile (id) VALUES (1);
        INSERT OR IGNORE INTO settings (id) VALUES (1);

        CREATE TABLE IF NOT EXISTS auth_tokens (
            token TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            expires_at TEXT NOT NULL DEFAULT (datetime('now', '+7 days'))
        );

        -- Clean expired tokens on init
        DELETE FROM auth_tokens WHERE expires_at < datetime('now');
    """)
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
    if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
        token = secrets.token_hex(32)
        db = get_db()
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
            updated_at = datetime('now')
        WHERE id = 1
    """, (
        data.get("name", ""), data.get("dob", "1980-01-01"),
        data.get("retirement_age", 57), data.get("gross_salary", 0),
        data.get("pension_contrib_pct", 0), data.get("employer_contrib_pct", 0),
        data.get("tax_code", "1257L"),
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
        "term_end_date", "notes", "sort_order",
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

    asset_types = {"PENSION_DC", "SIPP", "ISA_SS", "ISA_CASH", "CURRENT", "SAVINGS"}
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
    return jsonify({"date": snapshot_date, "net_worth": net_worth}), 201


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
            updated_at = datetime('now')
        WHERE id = 1
    """, (
        data.get("growth_rate", 5.0), data.get("inflation_rate", 2.5),
        data.get("isa_allowance", 20000), data.get("pension_annual_allowance", 60000),
        data.get("tax_year", "2025/26"),
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

    return jsonify({
        "profile": profile,
        "accounts": accounts,
        "settings": settings,
        "snapshots": snapshots,
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
                    term_end_date,notes,sort_order)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            """, (a["name"], a["type"], a.get("balance",0), a.get("provider",""),
                  a.get("contributing",0), a.get("monthly_contrib",0),
                  a.get("interest_rate",0), a.get("rate_type",""),
                  a.get("fixed_until",""), a.get("term_end_date",""),
                  a.get("notes",""), a.get("sort_order",0)))

    if "settings" in data:
        s = data["settings"]
        db.execute("""
            UPDATE settings SET growth_rate=?, inflation_rate=?, isa_allowance=?,
                pension_annual_allowance=?, tax_year=?, updated_at=datetime('now')
            WHERE id = 1
        """, (s.get("growth_rate",5.0), s.get("inflation_rate",2.5),
              s.get("isa_allowance",20000), s.get("pension_annual_allowance",60000),
              s.get("tax_year","2025/26")))

    if "snapshots" in data:
        for snap in data["snapshots"]:
            db.execute("""
                INSERT OR REPLACE INTO snapshots (date, net_worth, total_assets,
                    total_liabilities, breakdown)
                VALUES (?,?,?,?,?)
            """, (snap["date"], snap["net_worth"], snap.get("total_assets",0),
                  snap.get("total_liabilities",0), snap.get("breakdown","{}")))

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
    asset_types = {"PENSION_DC", "SIPP", "ISA_SS", "ISA_CASH", "CURRENT", "SAVINGS"}
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

    # 2025/26 UK tax bands (Scotland)
    def calc_scottish_tax_ni(gross_salary, sacrifice=0):
        taxable = gross_salary - sacrifice
        personal_allowance = 12570

        # Scottish income tax 2025/26
        bands = [
            (14876, 0.19),   # Starter: £12,571 - £14,876
            (26561, 0.20),   # Basic: £14,877 - £26,561
            (43662, 0.21),   # Intermediate: £26,562 - £43,662
            (75000, 0.42),   # Higher: £43,663 - £75,000
            (125140, 0.45),  # Advanced: £75,001 - £125,140
            (float('inf'), 0.48),  # Top: over £125,140
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

        # Employee NI (Class 1) 2025/26
        ni_threshold = 12570
        upper_limit = 50270
        ni_rate_main = 0.08
        ni_rate_upper = 0.02

        ni_earnings = max(0, taxable - ni_threshold)
        if taxable <= upper_limit:
            employee_ni = ni_earnings * ni_rate_main
        else:
            employee_ni = (upper_limit - ni_threshold) * ni_rate_main + (taxable - upper_limit) * ni_rate_upper

        # Employer NI
        er_ni_threshold = 5000  # 2025/26
        er_ni_rate = 0.15
        employer_ni = max(0, taxable - er_ni_threshold) * er_ni_rate

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

    current = calc_scottish_tax_ni(gross, current_sacrifice)
    proposed = calc_scottish_tax_ni(gross, proposed_sacrifice)

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
