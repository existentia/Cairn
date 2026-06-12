# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Cairn is a private, self-hosted UK financial dashboard (net worth tracking, retirement projections, FIRE, rule-based insights). Single-user, designed to run on a home LAN behind Docker.

## Commands

```bash
# Backend (Flask, port 8000)
cd backend && pip install -r requirements.txt && FLASK_DEBUG=1 python app.py

# Frontend (Vite dev server, port 3000 — proxies /api → :8000)
cd frontend && npm install && npm run dev

# Production build of the SPA (output: frontend/dist/, served by Flask as static)
cd frontend && npm run build

# Full container build + run (binds host :8070 → container :8000)
docker compose up -d --build
```

There is **no test suite, no linter, and no type checker** configured — don't claim to run them.

## Architecture

**Monorepo, three components, one container.** Multi-stage `Dockerfile` builds the React SPA with Node, then copies `frontend/dist/` into a Python image under `/app/static/`. At runtime `entrypoint.sh` starts cron (for monthly snapshots) and gunicorn, which both serves the API under `/api/*` and falls back to `index.html` for SPA routes.

**Backend = `backend/app.py` (~1.2k lines) + `backend/uk_tax.py` (tax constants/helpers) + `backend/snapshots.py` (snapshot recording & backfill) + `backend/migrations.py` (named, recorded migrations) + `backend/cron_snapshot.py`.** Flask + SQLite + Werkzeug auth; all routes live in `app.py`. `app.py` includes a small `sys.path` shim near the top so `from uk_tax import …` resolves whether you launch via `cd backend && python app.py` or via `gunicorn backend.app:app` from the project root — keep new sibling modules flat-importable. Database is a single SQLite file at `data/cairn.db` (Docker volume `cairn_data`). `init_db()` creates the base schema (idempotent `CREATE TABLE IF NOT EXISTS`) and then calls `run_migrations(db)`, which applies any not-yet-applied entries from the ordered `MIGRATIONS` list in `migrations.py` and records them in the `schema_migrations` table. **To add a column or run a data migration, append a new `(name, callable)` entry to `MIGRATIONS` — never rename or reorder existing ones.** Column-add migrations tolerate `duplicate column name` errors so pre-existing databases migrate cleanly into the framework.

**Frontend = `frontend/src/App.jsx` (~2.7k lines)** plus `advisor.js` (insights engine), `api.js` (fetch client), and `constants.js` (UK tax + account-type sets). Sub-components (`MetricCard`, `AccountRow`, `FIRECalculator`, `DrawdownSimulator`, `CarryForwardTool`, `AdvisorTab`, etc.) all live inside `App.jsx` — keep new sub-components there unless they're large and independently testable. The only chart library is `recharts`.

**Auth.** Single admin user. `ADMIN_USERNAME` / `ADMIN_PASSWORD` come from env; the password is hashed via Werkzeug's default (scrypt on modern Pythons) and stored in the `auth` table. **Rotating `ADMIN_PASSWORD` and restarting the container wipes all rows in `auth_tokens`**, forcing re-login everywhere. Login returns a 64-hex token persisted in the `auth_tokens` table with 7-day expiry. Tokens live in SQLite (not in-memory) specifically so they survive across the 2 gunicorn workers; `require_auth` also samples ~1% of authenticated requests to purge expired rows so the table doesn't grow forever. The frontend stores the token in `localStorage` under `cairn_token` and sends `Authorization: Bearer …`; a 401 from any endpoint triggers `clearToken()` + page reload.

**Dashboard call.** The frontend boots by hitting `GET /api/dashboard`, which returns profile + accounts + settings + snapshots (with per-category breakdowns joined from `snapshot_categories`) + goals in one round trip. Prefer extending this over adding new bulk endpoints.

## Domain rules and gotchas

**Account types live in two mirrored constants modules.** `backend/uk_tax.py` and `frontend/src/constants.js` are the single source of truth for `ASSET_TYPES`, `LIABILITY_TYPES`, `INVESTMENT_PENSION_TYPES`, and `ISA_TYPES`. Both `backend/app.py` and `backend/cron_snapshot.py` import from `uk_tax`; both `frontend/src/App.jsx` and `frontend/src/advisor.js` import from `constants.js`. When you add a new account type, update **both** files — the JS and Python sets are not generated from each other.

**UK tax logic is hand-coded for 2025/26 in two mirrored modules.** `backend/uk_tax.py` holds Scottish (6-band) and rUK (3-band) income tax tables, NI thresholds, ISA/pension allowances, the pension AA carry-forward history, and a `calc_tax_ni(gross, sacrifice, region)` helper that the salary-sacrifice endpoint calls. `frontend/src/constants.js` mirrors the same numbers and exposes `getPriorTaxYears(currentLabel, count)` for the carry-forward tool. When the tax year rolls over, both files need updating — they are not generated from each other.

**Theme system.** `DARK_THEME` and `LIGHT_THEME` constants are merged into a single mutable `T` object that is re-synced **on every render** (`App.jsx:415`). Components read colours via `T.accent`, `T.text`, etc., not via props or context. The active theme is persisted in `localStorage` under `cairn_theme`. Don't introduce a context provider for theming — keep the mutable-T pattern, since helper functions like `ttStyle()` rely on it. Styling is inline-first; `makeGlobalStyles()` in `ui.jsx` additionally emits a small set of `c-`-prefixed utility classes (`c-hover`, `c-field`, `c-tabs`, `c-metrics`, `c-btn-*`, `row-actions`) for states inline styles can't express — :hover, :focus-within, media queries. Their `!important`s are deliberate (they must beat inline styles); add new hover/focus behaviour there rather than via per-component `<style>` tags. SVG icons come from the `Ico` component in `ui.jsx` — don't add emoji to UI chrome.

**Snapshots.** `UNIQUE(date)` constraint on `snapshots`, so re-taking a snapshot on the same day uses `INSERT OR REPLACE`. Both the manual snapshot endpoint (`POST /api/snapshots`) and the monthly cron (`cron_snapshot.py`, scheduled `0 6 1 * *`) delegate to `snapshots.take_snapshot(db, snapshot_date=None)` so they stay in lockstep — modify category logic there, not in the route or the cron script. Editing a snapshot's totals via `PUT /api/snapshots/:id` scales the stored `snapshot_categories` proportionally to keep the line chart and stacked chart consistent. The `init_db()` startup hook runs `backfill_missing_categories(db)`, which idempotently fills `snapshot_categories` for any snapshot lacking them by looking up account types by name from the current `accounts` table (best-effort — renamed/deleted accounts in old snapshots are skipped).

**Insights engine.** `advisor.js` exports `generateInsights({ profile, accounts, settings, snapshots })`, a pure function returning `{ type, category, title, detail, priority }[]`. Categories drive the filter chips in `AdvisorTab`; new rules just push into the array.

## External integrations

- **Claude API** (`/api/ai/commentary`): uses the official `anthropic` Python SDK (pinned in `requirements.txt`), model `claude-sonnet-4-6`, no thinking + `effort: "low"` since commentary is plain text generation. System prompt (UK tax/savings persona) is marked with `cache_control: ephemeral` — currently below Sonnet 4.6's ~2k-token caching minimum so it's a silent no-op, but structurally ready if the persona grows. Only **numerical summaries** are sent — never raw account names or personal identifiers. Gated on `ANTHROPIC_API_KEY` (returns 503 if unset).
- **Bank of England base rate** (`/api/rates/boe-base-rate`): scrapes the BoE statistical CSV API with a cookie-bearing opener (the endpoint requires a real session). Cached 24h in-process in `BOE_RATE_CACHE`. Has a comprehensive hard-coded fallback history if the fetch fails — preserve the fallback when modifying.

## Environment

Required env vars (set in `.env` for local, or in `docker-compose.yml` / Portainer for prod):
- `ADMIN_USERNAME`, `ADMIN_PASSWORD` — single-user credentials. Changing `ADMIN_PASSWORD` and restarting wipes all existing browser sessions (see Auth above).
- `ANTHROPIC_API_KEY` — optional, enables AI Copilot tab only

Request bodies are capped at 5 MB via `MAX_CONTENT_LENGTH`. There is no `SECRET_KEY` env var — Flask is given a fresh random secret per process since auth is Bearer-token via SQLite, not Flask sessions.
