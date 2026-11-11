#!/usr/bin/env python3
"""Automated SQLite backup with rotation — runs inside the container via cron.

Uses SQLite's online .backup() API so the DB doesn't need to be locked /
quiesced; safe to run while the web server is serving requests.

Configurable via environment:
  DATA_DIR            Where cairn.db lives (default <project>/data).
  BACKUP_DIR          Where to write backups (default <DATA_DIR>/backups,
                      so they land inside the data volume).
  BACKUP_RETAIN_DAYS  Number of recent backups to keep (default 14).

Files are named cairn-YYYYMMDD-HHMMSS.db. Anything older than the retain
count gets pruned at the end of the run.

Scheduled by the Dockerfile crontab:
  0 4 * * * python /app/backend/cron_backup.py
"""

import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

# Same resolution as db_auth.py, so DATA_DIR is honoured here too.
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("DATA_DIR", BASE_DIR / "data"))
DB_PATH = DATA_DIR / "cairn.db"
DEFAULT_DIR = DATA_DIR / "backups"


def main():
    if not DB_PATH.exists():
        print(f"[backup] Database not found at {DB_PATH}; skipping.")
        return

    backup_dir = Path(os.environ.get("BACKUP_DIR", str(DEFAULT_DIR)))
    backup_dir.mkdir(parents=True, exist_ok=True)
    try:
        retain = max(1, int(os.environ.get("BACKUP_RETAIN_DAYS", "14")))
    except ValueError:
        retain = 14

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = backup_dir / f"cairn-{timestamp}.db"

    src = sqlite3.connect(str(DB_PATH))
    dst = sqlite3.connect(str(target))
    try:
        # Online backup — locks just briefly per page, safe under load
        src.backup(dst)
    finally:
        dst.close()
        src.close()

    size_kb = target.stat().st_size / 1024
    print(f"[backup] Wrote {target} ({size_kb:,.0f} KB)")

    # Rotate: keep the N most recent cairn-*.db files
    backups = sorted(
        backup_dir.glob("cairn-*.db"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for old in backups[retain:]:
        try:
            old.unlink()
            print(f"[backup] Pruned {old.name}")
        except OSError as e:
            print(f"[backup] Failed to prune {old.name}: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
