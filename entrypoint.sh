#!/bin/bash
set -e

echo "▲ Cairn — Starting up..."

# Initialise database
python -c "
import sys; sys.path.insert(0, '/app')
from backend.app import init_db, ensure_password_hash
init_db()
ensure_password_hash()
print('Database initialised.')
"

# Cron runs jobs with a minimal environment (no container env vars, and a PATH
# without /usr/local/bin where this image's python lives), so hand it the
# settings the jobs need. The crontab sources this file before each job.
python - <<'PY'
import os, shlex
keys = ("PATH", "TZ", "DATA_DIR", "BACKUP_DIR", "BACKUP_RETAIN_DAYS")
with open("/app/cron.env", "w") as f:
    for key in keys:
        if os.environ.get(key):
            f.write(f"export {key}={shlex.quote(os.environ[key])}\n")
PY

# If the container was down when the monthly snapshot was due, take it now.
python backend/cron_snapshot.py --catch-up || echo "Snapshot catch-up failed; continuing."

# Start cron daemon for the monthly snapshot and daily backup
service cron start
echo "Cron scheduler started."

# Start production server
echo "Starting web server on port 8000..."
exec gunicorn backend.app:app \
    --bind 0.0.0.0:8000 \
    --workers 2 \
    --timeout 120 \
    --access-logfile - \
    --error-logfile -
