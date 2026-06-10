# ▲ Cairn

A private, self-hosted financial dashboard for tracking net worth, modelling retirement, and getting rule-based financial insights. Built for UK users with full Scottish and rUK tax band support.

*One stone at a time.*

## Features

### Net Worth Tracking
- Record monthly snapshots and chart progress over time
- Edit or delete historical snapshots
- **Real vs Nominal toggle** — restate the whole history in today's purchasing power, so a flat line means wealth only kept pace with inflation
- **Estimated contributions overlay** on the main net worth chart — dashed line showing cumulative investment contributions so the gap reveals market growth at a glance
- Stacked area chart showing net worth split by asset category (pensions, ISAs, GIA, property, cash, debts) over time
- **Annual cashflow Sankey** — visualises where your salary goes (tax/NI → sacrifice → take-home → ISA/savings/mortgage/spending), live with Scottish / rUK tax bands
- Net worth target line on the main chart
- **Snapshot reminder banner** — nudges you when the last snapshot is over 35 days old
- Automated monthly snapshot via cron job

### Account Management
- **Account types:** Current Account, Savings, Cash ISA, Stocks & Shares ISA, **Lifetime ISA** (with £4k sub-allowance + 25% bonus tracking), **General Investment Account (GIA)** with unrealised-gain tracking for CGT planning, DC/Workplace Pension, SIPP, Defined Benefit / Final Salary Pension (CETV + guaranteed annual income), Property, Mortgage, Credit Card, Loan, Other
- Search, filter by type, and reorder accounts via drag-and-drop
- Track `total_contributed` for investment accounts to calculate real returns
- Portfolio Performance panel showing gain/loss and return % per account
- **Bulk update screen** — edit every account balance in one place and save them all (plus a snapshot) in one click; the monthly logging workflow

### Retirement & Projections
- Compound growth modelling with real returns (adjustable nominal growth rate and inflation)
- **Forecast fan chart** — ±1σ envelope around the central projection (lognormal model, 15% equity-like volatility) so the range of outcomes is visible at a glance
- Drawdown simulator: project how long your pot lasts in retirement, with adjustable retirement age, spending, and State Pension inputs
- Defined Benefit pension income shown separately and factored into drawdown projections

### FIRE Calculator
- Calculates your FIRE number (target pot = annual expenses ÷ SWR)
- Years-to-FIRE projection using current net worth and monthly savings
- Coast FIRE number: how much you need now to coast to FIRE without further contributions
- Three scenarios: Lean FIRE (5% SWR, 70% expenses), Regular FIRE (4%), Fat FIRE (3.5%, 130% expenses)

### Financial Advisor
Rule-based insights engine (23 rules) covering:
- ISA allowance usage and days remaining in the tax year
- **LISA bonus headroom** — flags missed 25% government bonus when under 50
- **CGT allowance** — bed-and-ISA prompt when GIA unrealised gains exceed £3k
- Pension headroom vs annual allowance
- **Workplace match underused** — flags when your contribution sits below the employer match threshold
- **Annual Allowance taper** — alerts high earners (>£200k) when the pension AA taper may be in play
- **HICBC** — High Income Child Benefit Charge taper warning with sacrifice-to-£60k recommendation
- **Marriage Allowance** — flags £252/yr opportunity when one partner is a non-taxpayer
- Salary sacrifice optimisation (with Scottish / rUK tax band awareness)
- **Salary band cliff alerts** — actionable warnings just above higher-rate and additional-rate thresholds
- Debt prioritisation (high-interest first)
- Emergency fund adequacy
- **Fixed-savings maturity reminder** — heads-up before fixed-rate bonds roll over to dismal rates
- Mortgage alerts and overpayment opportunity
- **Variable mortgage drift vs BoE** — flags tracker/SVR rates running materially above market margin
- Net worth velocity (month-on-month momentum)
- Pension carry-forward opportunity
- Insights are filterable by category (Savings, Debt, Pension, Tax, etc.)

### Tax Year Summary
- Live tax-year panel showing:
  - ISA contributions vs £20,000 annual allowance
  - LISA sub-allowance (£4k) usage + expected government bonus, if you have one
  - Pension contributions (employee + employer) vs annual allowance
  - Personal allowance status with taper warning above £100,000 salary
  - Days remaining in the current tax year

### Tools
- **Salary Sacrifice Calculator** — Scottish and rUK income tax bands, NI savings, effective cost, employer NI saving, take-home impact
- **Bonus Optimiser** — Model a one-off lump sum (annual bonus, RSU vest) as cash vs sacrifice-to-pension; shows marginal rate, take-home impact, and total value gained. Warns when the bonus pushes you into the PA taper or additional-rate band
- **Marginal Rate Curve** — plots your effective marginal tax + NI rate across £0–£200k, making the 60% PA-taper zone and HICBC ramp visible, with markers at your current and after-sacrifice salary
- **IHT Estimator** — Inheritance tax calculator using 2025/26 allowances. NRB + RNRB taper (>£2M), transferable allowances for married couples, reduced 36% rate for 10%+ charitable bequests
- **Debt Payoff Planner** — Avalanche vs snowball comparison with total interest saved
- **Mortgage Scenarios** — Model different rates, terms, and overpayment strategies
- **Carry-Forward Pension Calculator** — Auto-rolls to the current tax year using a built-in pension annual-allowance history (2014/15 onwards). Editable prior-year inputs persist locally per tax year; calculates unused allowance, total carry-forward headroom, and monthly contribution needed to fully utilise it this year
- **Bank of England Base Rate** — Live BoE base rate displayed for context

### Goals Tracker
- Create financial goals with a name, target amount, target date, and emoji icon
- Link goals to auto-tracked values: overall net worth or a specific account type balance
- Progress bar, percentage complete, days remaining, and "ACHIEVED ✓" badge

### AI Copilot
- Claude-powered natural language analysis of your financial position
- Sends only numerical summaries — no personal identifiers

### Theme
- Dark theme (default) and light theme, toggled in the header and persisted in `localStorage`
- **Keyboard shortcuts** — vim-style `g`-prefix navigation (`g s` snapshot, `g u` update balances, `g a` advisor, …); press `?` for the cheatsheet

### Data & Auth
- Full JSON export and import for backup/migration
- **Safe imports** — every JSON import automatically writes a pre-import database backup first, and any failure rolls back atomically
- **CSV snapshot import** — paste historic net-worth data to bootstrap years of pre-Cairn history in one go
- **Automated daily backups** with rotation — SQLite `.backup()` writes to a configurable host path; keeps the last 14 by default
- Token-based authentication with hashed passwords (7-day session, designed for local network use)
- **Login rate-limiting** — 5 failed attempts per IP triggers a 15-minute lockout (SQLite-backed so it holds across gunicorn workers)
- **Security headers** — strict CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy on every response

---

## Quick Start (Docker)

### 1. Clone and configure

```bash
git clone <your-repo-url> cairn
cd cairn
cp .env.example .env
```

Edit `.env`:
```
ADMIN_USERNAME=username
ADMIN_PASSWORD=your-secure-password
ANTHROPIC_API_KEY=sk-ant-...   # Optional: enables AI Copilot
BACKUP_DIR=/app/data/backups   # Optional: where cron writes daily backups (default shown)
BACKUP_RETAIN_DAYS=14          # Optional: how many backups to keep (default 14)
```

Changing `ADMIN_PASSWORD` and restarting the container invalidates all existing browser sessions, forcing re-login.

### 2. Deploy with Docker Compose

```bash
docker compose up -d --build
```

Available at `http://<your-server-ip>:8070`

### 3. Deploy via Portainer

1. **Stacks** → **Add Stack** → **Repository** (point to your repo)
2. Add environment variables: `ADMIN_USERNAME`, `ADMIN_PASSWORD`, optionally `ANTHROPIC_API_KEY`
3. **Deploy the stack**

---

## Architecture

```
cairn/
├── docker-compose.yml
├── Dockerfile              # Multi-stage build (Node → Python)
├── entrypoint.sh           # Starts cron + gunicorn
├── backend/
│   ├── app.py              # Flask API + static serving
│   ├── db_auth.py          # Shared get_db / require_auth (used by blueprints)
│   ├── routes_tools.py     # Calculator endpoints blueprint (/api/tools/*)
│   ├── uk_tax.py           # UK tax constants + calc helpers (2025/26)
│   ├── snapshots.py        # Shared snapshot writer + idempotent backfill
│   ├── migrations.py       # Named schema/data migrations
│   ├── cron_snapshot.py    # Automated monthly snapshots
│   ├── cron_backup.py      # Automated daily SQLite backups with rotation
│   └── requirements.txt    # Flask + Anthropic SDK + Werkzeug + gunicorn
├── frontend/
│   ├── src/
│   │   ├── App.jsx         # Main dashboard UI + tab routing
│   │   ├── api.js          # API client
│   │   ├── advisor.js      # Financial insights engine (16 rules)
│   │   ├── constants.js    # UK tax constants mirror (frontend twin of uk_tax.py)
│   │   ├── ui.jsx          # Shared design tokens (theme), formatters, primitives
│   │   ├── tools/          # Self-contained calculator components
│   │   │   ├── FIRECalculator.jsx
│   │   │   ├── DrawdownSimulator.jsx
│   │   │   ├── CarryForwardTool.jsx
│   │   │   ├── SalarySacrificeTool.jsx
│   │   │   └── DebtPayoffTool.jsx
│   │   └── main.jsx
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
└── data/                   # SQLite database (Docker volume)
    └── cairn.db
```

Database upgrades are handled by a named-migration framework in `backend/migrations.py`. On every container start, `init_db()` applies any not-yet-run migrations (recorded in a `schema_migrations` table) and runs an idempotent backfill that fills in missing per-category snapshot breakdowns. Existing deployments upgrade in place — no manual SQL.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Authenticate |
| GET | `/api/auth/check` | Verify token validity |
| POST | `/api/auth/logout` | Invalidate session |
| GET | `/api/dashboard` | All data in one call |
| GET/PUT | `/api/profile` | User profile (salary, age, etc.) |
| GET/POST | `/api/accounts` | List / create accounts |
| PUT/DELETE | `/api/accounts/:id` | Update / delete account |
| GET/POST | `/api/snapshots` | History / take snapshot |
| PUT/DELETE | `/api/snapshots/:id` | Edit / delete a snapshot |
| GET/PUT | `/api/settings` | Projection & tax assumptions |
| GET/POST | `/api/goals` | List / create goals |
| PUT/DELETE | `/api/goals/:id` | Update / delete a goal |
| POST | `/api/ai/commentary` | AI-powered financial analysis |
| POST | `/api/tools/salary-sacrifice` | Scottish / rUK salary sacrifice calculator |
| POST | `/api/tools/debt-payoff` | Avalanche vs snowball debt comparison |
| POST | `/api/tools/mortgage-scenarios` | Mortgage scenario modelling |
| GET | `/api/rates/boe-base-rate` | Bank of England base rate |
| GET | `/api/export` | Full data export (JSON) |
| POST | `/api/import` | Data import (JSON) |

---

## Backup

```bash
docker cp cairn:/app/data/cairn.db ./backups/cairn-$(date +%Y%m%d).db
```

---

## Development

```bash
# Backend
cd backend && pip install -r requirements.txt && FLASK_DEBUG=1 python app.py

# Frontend (port 3000, proxies API to 8000)
cd frontend && npm install && npm run dev
```

---

## Security Notes

- Designed for **local network** use behind your home firewall
- Passwords are hashed at rest using Werkzeug's default (scrypt on modern Pythons); rotating `ADMIN_PASSWORD` and restarting wipes all existing sessions
- Bearer tokens live in SQLite with a 7-day expiry; expired rows are sample-purged on ~1% of authenticated requests
- Request bodies are capped at 5 MB
- If exposing externally, use a reverse proxy with HTTPS and consider Authelia/Authentik
- AI Copilot sends only numerical summaries to the Claude API — no personal identifiers

## Disclaimer

General financial information only — not regulated advice. Projections use simplified models. Consult an FCA-regulated adviser for personalised recommendations.
