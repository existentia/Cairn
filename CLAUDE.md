# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Cairn is a private, self-hosted UK financial dashboard (net worth tracking, retirement projections, FIRE, rule-based insights). Single-user, designed to run on a home LAN behind Docker.

**This repo is public** (MIT, `existentia/Cairn`). Never commit real balances, account names, API keys, or anything else from the maintainer's own instance — the app's data lives in `data/cairn.db`, which is gitignored. Use plausible fake figures in examples and docs.

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

**Monorepo, three components, one container.** Multi-stage `Dockerfile` builds the React SPA with Node, then copies `frontend/dist/` into a Python image under `/app/static/`. At runtime `entrypoint.sh` initialises the DB, starts cron, then execs gunicorn (2 workers), which both serves the API under `/api/*` and falls back to `index.html` for SPA routes. Two cron jobs are baked into the image: `0 6 1 * *` → `cron_snapshot.py` (monthly snapshot) and `0 4 * * *` → `cron_backup.py` (daily backup).

**Backend layout:**
- `backend/app.py` (~1.3k lines) — Flask app, all core routes (auth, dashboard, profile, accounts, snapshots, settings, goals, export/import, AI commentary, BoE rate), schema definition in `init_db()`, security headers.
- `backend/db_auth.py` — `get_db` / `close_db` / `require_auth` / `DB_PATH`, split out so blueprints can import them **without circular-importing the app object**. Anything a blueprint needs belongs here, not in `app.py`.
- `backend/routes_tools.py` — `tools_bp` blueprint at `url_prefix="/api/tools"` (salary-sacrifice, bonus-optimiser, iht-estimator, debt-payoff, mortgage-scenarios), registered in `app.py`. **New pure-calculator endpoints go here, not in `app.py`.**
- `backend/uk_tax.py` — tax constants/helpers. `backend/snapshots.py` — snapshot writer + backfill. `backend/migrations.py` — named migrations. `backend/cron_snapshot.py`, `backend/cron_backup.py` — cron entrypoints.

`app.py` includes a small `sys.path` shim near the top so `from uk_tax import …` resolves whether you launch via `cd backend && python app.py` or via `gunicorn backend.app:app` from the project root — keep new sibling modules flat-importable. Database is a single SQLite file at `data/cairn.db` (Docker volume `cairn_data`), opened WAL with foreign keys on. `init_db()` creates the base schema (idempotent `CREATE TABLE IF NOT EXISTS`) and then calls `run_migrations(db)`, which applies any not-yet-applied entries from the ordered `MIGRATIONS` list in `migrations.py` (14 so far) and records them in the `schema_migrations` table. **To add a column or run a data migration, append a new `(name, callable)` entry to `MIGRATIONS` — never rename or reorder existing ones.** Column-add migrations tolerate `duplicate column name` errors so pre-existing databases migrate cleanly into the framework.

**Frontend layout.** `frontend/src/App.jsx` (~2.8k lines) is the shell: auth gate, tab routing, the Overview/Accounts/Advisor/Goals views, and the charts. Around it:
- `ui.jsx` — theme constants, `fmt`, `makeGlobalStyles()`, the recharts tooltip style helpers, the `Ico`/`CairnLogo`/`CairnMeter`/`TopoPattern` SVGs, and the shared primitives (`MetricCard`, `InsightCard`, `Tab`, `Field`, `NumberInput`, `Select`, `Btn`). **Reusable presentational pieces go here.**
- `tools/` — one file per self-contained calculator: `FIRECalculator`, `DrawdownSimulator`, `CarryForwardTool`, `SalarySacrificeTool`, `BonusOptimiser`, `MarginalRateCurve`, `IhtEstimator`, `DebtPayoffTool`, `TaxYearDashboard`. Each takes plain props (`profile`, `accounts`, `settings`, …) and owns its own state. `App.jsx` imports them and switches on `activeTool`. **New calculators go here, not into `App.jsx`.**
- `advisor.js` (insights engine), `api.js` (fetch client), `constants.js` (UK tax + account-type sets).

Only view-level composition and cross-cutting dashboard state should stay in `App.jsx`. The only chart library is `recharts`.

**Auth.** Single admin user. `ADMIN_USERNAME` / `ADMIN_PASSWORD` come from env; the password is hashed via Werkzeug's default (scrypt on modern Pythons) and stored in the `auth` table. **Rotating `ADMIN_PASSWORD` and restarting the container wipes all rows in `auth_tokens`**, forcing re-login everywhere. Login returns a 64-hex token persisted in the `auth_tokens` table with 7-day expiry. Tokens live in SQLite (not in-memory) specifically so they survive across the 2 gunicorn workers; `require_auth` also samples ~1% of authenticated requests to purge expired rows so the table doesn't grow forever. The frontend stores the token in `localStorage` under `cairn_token` and sends `Authorization: Bearer …`; a 401 from any endpoint triggers `clearToken()` + page reload.

**Login rate limiting.** Failed logins are counted per IP in SQLite (again, so the limit holds across workers and restarts): `AUTH_FAILURE_THRESHOLD = 5` failures within `AUTH_FAILURE_WINDOW_MIN = 10` minutes locks that IP for `AUTH_LOCKOUT_MIN = 15`. `_client_ip()` honours `X-Forwarded-For` for reverse-proxy deployments.

**Security headers.** An `@app.after_request` hook sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and a strict `CSP` on every response, all via `setdefault`. The CSP keeps `style-src 'unsafe-inline'` deliberately — the UI is inline-styled throughout — but `script-src` is `'self'` only and `connect-src` is `'self'`, so the SPA can only talk to its own `/api`. Don't loosen `script-src` or `connect-src` to add a feature.

**Dashboard call.** The frontend boots by hitting `GET /api/dashboard`, which returns profile + accounts + settings + snapshots (with per-category breakdowns joined from `snapshot_categories`) + goals in one round trip. Prefer extending this over adding new bulk endpoints.

## Domain rules and gotchas

**Account types live in two mirrored constants modules.** `backend/uk_tax.py` and `frontend/src/constants.js` are the single source of truth for `ASSET_TYPES`, `LIABILITY_TYPES`, `INVESTMENT_PENSION_TYPES`, and `ISA_TYPES`. On the Python side `app.py`, `routes_tools.py` and `snapshots.py` import from `uk_tax`; on the JS side `App.jsx`, `advisor.js` and several `tools/*` components import from `constants.js`. When you add a new account type, update **both** modules — the JS and Python sets are not generated from each other, and a mismatch shows up as accounts silently missing from snapshot category totals.

**UK tax logic is hand-coded for 2025/26 in two mirrored modules.** `backend/uk_tax.py` holds Scottish (6-band) and rUK (3-band) income tax tables, NI thresholds, ISA/pension allowances, the pension AA carry-forward history, and a `calc_tax_ni(gross, sacrifice, region)` helper that the salary-sacrifice endpoint calls. `frontend/src/constants.js` mirrors the same numbers and exposes `getPriorTaxYears(currentLabel, count)` for the carry-forward tool. When the tax year rolls over, both files need updating — they are not generated from each other.

**Theme system.** `DARK_THEME` and `LIGHT_THEME` are declared in `ui.jsx`, which also exports the single mutable `T` object (`export const T = { ...DARK_THEME }`). `App.jsx` re-syncs it **on every render** via `Object.assign(T, isDark ? DARK_THEME : LIGHT_THEME)` (`App.jsx:311`), so every importer — including `tools/*` — sees the active theme without prop-drilling. Components read colours via `T.accent`, `T.text`, etc., not via props or context. The active theme is persisted in `localStorage` under `cairn_theme`. Don't introduce a context provider for theming — keep the mutable-T pattern, since helper functions like `ttStyle()` rely on it. Styling is inline-first; `makeGlobalStyles()` in `ui.jsx` additionally emits a small set of `c-`-prefixed utility classes (`c-hover`, `c-field`, `c-tabs`, `c-metrics`, `c-btn-*`, `row-actions`) for states inline styles can't express — :hover, :focus-within, media queries. Their `!important`s are deliberate (they must beat inline styles); add new hover/focus behaviour there rather than via per-component `<style>` tags. SVG icons come from the `Ico` component in `ui.jsx` — don't add emoji to UI chrome.

**Snapshots.** `UNIQUE(date)` constraint on `snapshots`, so re-taking a snapshot on the same day uses `INSERT OR REPLACE`. Both the manual snapshot endpoint (`POST /api/snapshots`) and the monthly cron (`cron_snapshot.py`) delegate to `snapshots.take_snapshot(db, snapshot_date=None)` so they stay in lockstep — modify category logic in `snapshots._categorise()`, not in the route or the cron script. `POST /api/snapshots/import-csv` bulk-loads historic rows and then best-effort backfills their categories. Editing a snapshot's totals via `PUT /api/snapshots/:id` scales the stored `snapshot_categories` proportionally to keep the line chart and stacked chart consistent. The `init_db()` startup hook runs `backfill_missing_categories(db)`, which idempotently fills `snapshot_categories` for any snapshot lacking them by looking up account types by name from the current `accounts` table (best-effort — renamed/deleted accounts in old snapshots are skipped).

**Insights engine.** `advisor.js` exports `generateInsights({ profile, accounts, settings, snapshots, boe_rate })`, a pure function returning `{ type, category, title, detail, priority }[]`. Categories in use are `savings`, `debt`, `pension`, `tax`, `isa`, `mortgage`, `retirement`, `general`, and they drive the filter chips in `AdvisorTab` — reuse one rather than inventing a category for a single rule. New rules just push into the array. `advisor.js` also re-exports `ASSET_TYPES`, `LIABILITY_TYPES`, `fmtFull` and `ageFromDob`, which is why `App.jsx` imports those two helpers from it rather than from `constants.js`.

**Backups.** `cron_backup.py` uses SQLite's online `.backup()` API (safe against a live WAL connection) to write `BACKUP_DIR`, then prunes to the newest `BACKUP_RETAIN_DAYS`. `POST /api/import` takes a pre-import backup through the same path and rolls back atomically on failure — preserve that ordering if you touch the import route.

## External integrations

- **Claude API** (`/api/ai/commentary`): uses the official `anthropic` Python SDK (pinned in `requirements.txt`), model `claude-sonnet-4-6`, no thinking + `effort: "low"` since commentary is plain text generation. System prompt (UK tax/savings persona) is marked with `cache_control: ephemeral` — currently below Sonnet 4.6's ~2k-token caching minimum so it's a silent no-op, but structurally ready if the persona grows. Only **numerical summaries** are sent — never raw account names or personal identifiers. Gated on `ANTHROPIC_API_KEY` (returns 503 if unset).
- **Bank of England base rate** (`/api/rates/boe-base-rate`): scrapes the BoE statistical CSV API with a cookie-bearing opener (the endpoint requires a real session). Cached 24h in-process in `BOE_RATE_CACHE`. Has a comprehensive hard-coded fallback history if the fetch fails — preserve the fallback when modifying.

## Environment

Env vars (set in `.env` for local, or in `docker-compose.yml` / Portainer for prod):
- `ADMIN_USERNAME`, `ADMIN_PASSWORD` — required. Single-user credentials. Changing `ADMIN_PASSWORD` and restarting wipes all existing browser sessions (see Auth above).
- `ANTHROPIC_API_KEY` — optional, enables AI Copilot tab only
- `BACKUP_DIR` — optional, defaults to `<data>/backups`; where `cron_backup.py` writes
- `BACKUP_RETAIN_DAYS` — optional, defaults to `14`
- `DATA_DIR` — optional, read by `db_auth.py` to relocate `cairn.db`

All of these must be added in **three** places to actually work end to end: `.env.example`, the `environment:` block in `docker-compose.yml`, and the config table in `README.md`.

Request bodies are capped at 5 MB via `MAX_CONTENT_LENGTH`. There is no `SECRET_KEY` env var — Flask is given a fresh random secret per process since auth is Bearer-token via SQLite, not Flask sessions.
