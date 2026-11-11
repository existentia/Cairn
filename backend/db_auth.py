"""Database and auth helpers shared between app.py and blueprints.

Lives in its own module so route blueprints (e.g. routes_tools.py) can pull in
`get_db` and `require_auth` without circular-importing the main app object.
The request-body validators (BadInput, json_body, as_number, as_text, as_date)
live here for the same reason.
"""

import math
import os
import random
import sqlite3
from datetime import datetime
from functools import wraps
from pathlib import Path

from flask import g, jsonify, request

# Match app.py's path resolution so both modules talk to the same DB regardless
# of which working dir/process launched us.
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("DATA_DIR", BASE_DIR / "data"))
DB_PATH = DATA_DIR / "cairn.db"


def get_db():
    """Returns a request-scoped SQLite connection (created on first use)."""
    if "db" not in g:
        g.db = sqlite3.connect(str(DB_PATH))
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db


def close_db(_exc=None):
    """Teardown hook — closes the request-scoped connection."""
    db = g.pop("db", None)
    if db is not None:
        db.close()


def require_auth(f):
    """Decorator: requires a valid Bearer token in the Authorization header.

    Tokens live in the auth_tokens SQLite table (not in-memory) so they survive
    across gunicorn workers. A sampled cleanup (~1% of requests) purges expired
    rows so the table doesn't grow forever.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            db = get_db()
            if random.random() < 0.01:
                db.execute("DELETE FROM auth_tokens WHERE expires_at < datetime('now')")
                db.commit()
            row = db.execute(
                "SELECT token FROM auth_tokens WHERE token = ? AND expires_at > datetime('now')",
                (token,)
            ).fetchone()
            if row:
                return f(*args, **kwargs)
        return jsonify({"error": "Unauthorized"}), 401
    return decorated


# ── Request validation ────────────────────────────────────────────────────────

class BadInput(ValueError):
    """A request body failed validation. app.py turns this into a 400 with a
    JSON {"error": ...} body, so validators can simply raise."""


def json_body():
    """The request's JSON body as a dict; raises BadInput for a missing body,
    malformed JSON, or anything that isn't an object."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise BadInput("Request body must be a JSON object")
    return data


def as_number(value, field, default=0):
    """Coerce a JSON value to a finite number. Blank (None / "") becomes
    `default`; numeric strings are accepted; anything else raises BadInput —
    so text can never land in a REAL column and break the sums later."""
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        number = value
    elif isinstance(value, str):
        try:
            number = float(value)
        except ValueError:
            raise BadInput(f"'{field}' must be a number")
    else:
        raise BadInput(f"'{field}' must be a number")
    if not math.isfinite(number):
        raise BadInput(f"'{field}' must be a finite number")
    return number


def as_text(value, field, default=""):
    """Coerce a JSON value to a string (None becomes `default`). Lists and
    objects raise BadInput."""
    if value is None:
        return default
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    raise BadInput(f"'{field}' must be text")


def as_date(value, field, allow_blank=False):
    """A YYYY-MM-DD date string; raises BadInput otherwise."""
    value = as_text(value, field)
    if value == "" and allow_blank:
        return ""
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        raise BadInput(f"'{field}' must be a date in YYYY-MM-DD format")
    return value
