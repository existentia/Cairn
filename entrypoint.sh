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

# Start cron daemon for automated monthly snapshots
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
