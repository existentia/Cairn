# ▲ Cairn

A private, self-hosted financial dashboard for tracking net worth, modelling retirement projections, and getting rule-based financial insights. Built for UK users with Scottish tax band support.

*One stone at a time.*

## Features

- **Net Worth Tracking** — Record monthly snapshots and chart your progress over time
- **Account Management** — Pensions (DC/SIPP), ISAs (S&S/Cash), savings, current accounts, property, mortgage, credit cards, loans; with search and filter
- **Retirement Projections** — Compound growth modelling with real returns (adjustable growth/inflation)
- **Financial Advisor** — Rule-based insights: ISA allowance usage & tax year countdown, pension headroom, salary sacrifice optimisation, debt prioritisation, emergency fund, mortgage alerts, net worth velocity
- **Salary Sacrifice Calculator** — Scottish income tax bands, NI savings, effective cost modelling
- **Debt Payoff Planner** — Avalanche vs snowball comparison with interest savings
- **Mortgage Scenarios** — Model different mortgage rates, terms, and overpayment strategies
- **Bank of England Base Rate** — Live BoE base rate fetched and displayed for context
- **AI Copilot** — Claude-powered natural language analysis of your financial position
- **Data Export/Import** — Full JSON export for backup
- **Automated Snapshots** — Monthly cron job captures net worth history
- **Authentication** — Token-based auth with hashed passwords (designed for local network use)

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
ADMIN_USERNAME=neil
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
│   │   ├── advisor.js      # Financial insights engine
│   │   └── main.jsx
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
└── data/                   # SQLite database (Docker volume)
    └── cairn.db
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Authenticate |
| GET | `/api/auth/check` | Verify token validity |
| POST | `/api/auth/logout` | Invalidate session |
| GET | `/api/dashboard` | All data in one call |
| GET/PUT | `/api/profile` | User profile |
| GET/POST | `/api/accounts` | List/create accounts |
| PUT/DELETE | `/api/accounts/:id` | Update/delete account |
| GET/POST | `/api/snapshots` | History / take snapshot |
| GET/PUT | `/api/settings` | Projection assumptions |
| POST | `/api/ai/commentary` | AI-powered financial analysis |
| POST | `/api/tools/salary-sacrifice` | Scottish salary sacrifice calculator |
| POST | `/api/tools/debt-payoff` | Avalanche vs snowball debt comparison |
| POST | `/api/tools/mortgage-scenarios` | Mortgage scenario modelling |
| GET | `/api/rates/boe-base-rate` | Bank of England base rate |
| GET | `/api/export` | Full data export |
| POST | `/api/import` | Data import |

## Backup

```bash
docker cp cairn:/app/data/cairn.db ./backups/cairn-$(date +%Y%m%d).db
```

## Development

```bash
# Backend
cd backend && pip install -r requirements.txt && FLASK_DEBUG=1 python app.py

# Frontend (port 3000, proxies API to 8000)
cd frontend && npm install && npm run dev
```

## Security Notes

- Designed for **local network** use behind your home firewall
- Passwords are hashed at rest using Werkzeug's PBKDF2 implementation
- If exposing externally, use a reverse proxy with HTTPS and consider Authelia/Authentik
- AI Copilot sends only numerical summaries to the Claude API — no personal identifiers

## Disclaimer

General financial information only — not regulated advice. Projections use simplified models. Consult an FCA-regulated adviser for personalised recommendations.
