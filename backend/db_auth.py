"""Database and auth helpers shared between app.py and blueprints.

Lives in its own module so route blueprints (e.g. routes_tools.py) can pull in
`get_db` and `require_auth` without circular-importing the main app object.
"""

import os
import random
import sqlite3
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
