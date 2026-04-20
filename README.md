# ▲ Cairn

A private, self-hosted financial dashboard for tracking net worth, modelling retirement, and getting rule-based financial insights. Built for UK users with full Scottish and rUK tax band support.

*One stone at a time.*

## Features

### Net Worth Tracking
- Record monthly snapshots and chart progress over time
- Edit or delete historical snapshots
- Stacked area chart showing net worth split by asset category (pensions, ISAs, property, cash, debts) over time
- Net worth target line on the main chart
- Automated monthly snapshot via cron job

### Account Management
- **Account types:** Current Account, Savings, Cash ISA, Stocks & Shares ISA, DC/Workplace Pension, SIPP, Defined Benefit / Final Salary Pension (CETV + guaranteed annual income), Property, Mortgage, Credit Card, Loan, Other
- Search, filter by type, and reorder accounts via drag-and-drop
- Track `total_contributed` for investment accounts to calculate real returns
- Portfolio Performance panel showing gain/loss and return % per account

### Retirement & Projections
- Compound growth modelling with real returns (adjustable nominal growth rate and inflation)
- Drawdown simulator: project how long your pot lasts in retirement, with adjustable retirement age, spending, and State Pension inputs
- Defined Benefit pension income shown separately and factored into drawdown projections

### FIRE Calculator
- Calculates your FIRE number (target pot = annual expenses ÷ SWR)
- Years-to-FIRE projection using current net worth and monthly savings
- Coast FIRE number: how much you need now to coast to FIRE without further contributions
- Three scenarios: Lean FIRE (5% SWR, 70% expenses), Regular FIRE (4%), Fat FIRE (3.5%, 130% expenses)

### Financial Advisor
Rule-based insights engine (14 rules) covering:
- ISA allowance usage and days remaining in the tax year
- Pension headroom vs annual allowance
- Salary sacrifice optimisation (with Scottish / rUK tax band awareness)
- Debt prioritisation (high-interest first)
- Emergency fund adequacy
- Mortgage alerts and overpayment opportunity
- Net worth velocity (month-on-month momentum)
- Pension carry-forward opportunity
- Insights are filterable by category (Savings, Debt, Pension, Property, Tax)

### Tax Year Summary
- Live tax-year panel showing:
  - ISA contributions vs £20,000 annual allowance
  - Pension contributions (employee + employer) vs annual allowance
  - Personal allowance status with taper warning above £100,000 salary
  - Days remaining in the current tax year

### Tools
- **Salary Sacrifice Calculator** — Scottish and rUK income tax bands, NI savings, effective cost, employer NI saving, take-home impact
- **Debt Payoff Planner** — Avalanche vs snowball comparison with total interest saved
- **Mortgage Scenarios** — Model different rates, terms, and overpayment strategies
- **Carry-Forward Pension Calculator** — Editable prior-year inputs for the last 3 tax years (historically correct allowances), calculates unused allowance, total carry-forward headroom, and monthly contribution needed to fully utilise it this year
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

### Data & Auth
- Full JSON export and import for backup/migration
- Token-based authentication with hashed passwords (7-day session, designed for local network use)

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
SECRET_KEY=some-random-string-at-least-32-chars
ADMIN_USERNAME=username
ADMIN_PASSWORD=your-secure-password
ANTHROPIC_API_KEY=sk-ant-...   # Optional: enables AI Copilot
```

### 2. Deploy with Docker Compose

```bash
docker compose up -d --build
```

Available at `http://<your-server-ip>:8070`

### 3. Deploy via Portainer

1. **Stacks** → **Add Stack** → **Repository** (point to your repo)
2. Add environment variables: `SECRET_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, optionally `ANTHROPIC_API_KEY`
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
│   ├── cron_snapshot.py    # Automated monthly snapshots
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx         # Main dashboard UI
│   │   ├── api.js          # API client
│   │   ├── advisor.js      # Financial insights engine (14 rules)
│   │   └── main.jsx
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
└── data/                   # SQLite database (Docker volume)
    └── cairn.db
```

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
- Passwords are hashed at rest using Werkzeug's PBKDF2 implementation
- If exposing externally, use a reverse proxy with HTTPS and consider Authelia/Authentik
- AI Copilot sends only numerical summaries to the Claude API — no personal identifiers

## Disclaimer

General financial information only — not regulated advice. Projections use simplified models. Consult an FCA-regulated adviser for personalised recommendations.
