# ── Stage 1: Build React frontend ──────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Python backend + static files ────────────────────
FROM python:3.12-slim
WORKDIR /app

# Install Python deps and cron
RUN apt-get update && apt-get install -y --no-install-recommends cron && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ ./backend/

# Copy built frontend into static dir
COPY --from=frontend-build /build/dist ./static/

# Create data directory
RUN mkdir -p /app/data

# Cron jobs:
#  - Monthly net-worth snapshot (1st of each month, 06:00)
#  - Daily SQLite backup with rotation (04:00 every day)
RUN printf '%s\n%s\n' \
    "0 6 1 * * cd /app && python backend/cron_snapshot.py >> /var/log/cron.log 2>&1" \
    "0 4 * * * cd /app && python backend/cron_backup.py >> /var/log/cron.log 2>&1" \
    | crontab -

# Startup script: start cron then app
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8000

CMD ["/app/entrypoint.sh"]
