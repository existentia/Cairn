"""Generate a realistic but entirely fictional Cairn dataset for screenshots.

Persona: Alex Morgan, 38, Edinburgh, £72k salary. Every figure here is invented
— nothing in this file corresponds to a real person or a real account.

The figures are chosen to exercise features rather than to flatter: there's a
credit card at 22.9%, a workplace match left 2% short, one child and a salary
inside the HICBC range, and a variable mortgage running above base rate. That
makes the advisor produce a full spread of insights instead of an empty tab.

Usage — print the payload:

    python3 docs/demo/seed_demo_data.py > demo.json

Usage — seed a running instance directly (destructive: replaces accounts,
goals and snapshots on the target, so only ever point it at a throwaway one):

    python3 docs/demo/seed_demo_data.py --push http://localhost:8000 \\
        --username demo --password demo-password

Stdlib only, no dependencies. Deterministic: the same seed gives the same
history every run, so regenerated screenshots stay consistent.
"""
import argparse, json, random, sys, urllib.error, urllib.request
from datetime import date

random.seed(20260725)

ACCOUNTS = [
    dict(name="Everyday Current",   type="CURRENT",     balance=4200,   provider="Monzo",         sort_order=0),
    dict(name="Emergency Fund",     type="SAVINGS",     balance=18500,  provider="Chase",         sort_order=1,
         interest_rate=4.5, rate_type="variable"),
    dict(name="1yr Fixed Saver",    type="SAVINGS",     balance=10000,  provider="Shawbrook",     sort_order=2,
         interest_rate=4.9, rate_type="fixed", fixed_until="2026-11-30"),
    dict(name="Cash ISA",           type="ISA_CASH",    balance=12500,  provider="Trading 212",   sort_order=3,
         interest_rate=4.2, rate_type="variable"),
    dict(name="Stocks & Shares ISA",type="ISA_SS",      balance=46800,  provider="Vanguard",      sort_order=4,
         total_contributed=38000, monthly_contrib=500, contributing=1),
    dict(name="Lifetime ISA",       type="ISA_LISA",    balance=14200,  provider="AJ Bell",       sort_order=5,
         total_contributed=11000, monthly_contrib=333, contributing=1),
    dict(name="General Investment", type="GIA",         balance=9400,   provider="InvestEngine",  sort_order=6,
         total_contributed=7200, unrealised_gain=2200),
    dict(name="Workplace Pension",  type="PENSION_DC",  balance=128000, provider="Scottish Widows", sort_order=7,
         total_contributed=74000, monthly_contrib=660, contributing=1),
    dict(name="SIPP",               type="SIPP",        balance=52000,  provider="Interactive Investor", sort_order=8,
         total_contributed=41000, monthly_contrib=200, contributing=1),
    dict(name="Home",               type="PROPERTY",    balance=385000, provider="",              sort_order=9),
    dict(name="Mortgage",           type="MORTGAGE",    balance=-196000, provider="Nationwide",   sort_order=10,
         interest_rate=5.35, rate_type="variable"),
    dict(name="Credit Card",        type="CREDIT_CARD", balance=-1150,  provider="Amex",          sort_order=11,
         interest_rate=22.9),
]

PROFILE = dict(
    name="Alex Morgan", dob="1988-03-14", retirement_age=60, gross_salary=72000,
    pension_contrib_pct=6, employer_contrib_pct=5, employer_match_max_pct=8,
    tax_code="S1257L", state_pension_annual=11500, children_count=1, spouse_income=34000,
)

SETTINGS = dict(
    growth_rate=5.0, inflation_rate=2.5, isa_allowance=20000,
    pension_annual_allowance=60000, tax_year="2025/26", tracker_margin=0.75,
    mortgage_remaining_years=18, net_worth_target=750000,
    net_worth_target_date="2032-04-01", tax_region="scotland",
)

GOALS = [
    dict(name="Half a million", target_amount=500000, target_date="2027-04-05",
         icon="\U0001F3D4️", link_type="net_worth", sort_order=0,
         description="First big round number."),
    dict(name="Mortgage under £150k", target_amount=150000, target_date="2029-09-01",
         icon="\U0001F3E1", link_type="type:MORTGAGE", sort_order=1,
         description="Overpaying £250/month."),
    dict(name="ISA pot £75k", target_amount=75000, target_date="2027-04-05",
         icon="\U0001F4C8", link_type="type:ISA_SS", sort_order=2,
         description="Filling the allowance each year."),
]

# Final-month category totals, derived from the accounts above.
FINAL = {
    "pensions":    128000 + 52000,
    "isas":        12500 + 46800 + 14200,
    "investments": 9400,
    "property":    385000,
    "cash":        4200 + 18500 + 10000,
    "debts":       -(196000 + 1150),
}

MONTHS = 30
# Monthly reverse-growth factors: divide going backwards through time.
DRIFT = {
    "pensions": 0.0125, "isas": 0.0140, "investments": 0.0105,
    "property": 0.0022, "cash": 0.0035,
}


def month_starts(n):
    """The 1st of each of the last n months, oldest first."""
    y, m = date.today().year, date.today().month
    out = []
    for _ in range(n):
        out.append(date(y, m, 1))
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return list(reversed(out))


def build():
    dates = month_starts(MONTHS)
    series = {k: [0.0] * MONTHS for k in FINAL}

    for key, final in FINAL.items():
        series[key][-1] = float(final)
        for i in range(MONTHS - 2, -1, -1):
            nxt = series[key][i + 1]
            if key == "debts":
                # Mortgage + card balance was larger (more negative) in the past.
                series[key][i] = nxt - 430 - random.uniform(-40, 40)
            else:
                rate = DRIFT[key] * random.uniform(0.45, 1.55)
                # A couple of down months so the chart isn't a straight line.
                if key in ("isas", "investments", "pensions") and i in (9, 10, 19):
                    rate = -abs(rate) * 1.4
                series[key][i] = nxt / (1 + rate)

    snapshots = []
    for i, d in enumerate(dates):
        cats = {k: round(series[k][i], 2) for k in FINAL}
        assets = sum(v for k, v in cats.items() if k != "debts")
        liabilities = abs(cats["debts"])
        snapshots.append(dict(
            date=d.isoformat(),
            net_worth=round(assets - liabilities, 2),
            total_assets=round(assets, 2),
            total_liabilities=round(liabilities, 2),
            breakdown="{}",
            categories=cats,
        ))

    return dict(profile=PROFILE, accounts=ACCOUNTS, settings=SETTINGS,
                snapshots=snapshots, goals=GOALS)


def push(base, username, password, data):
    """Log in and POST the payload to /api/import on a running instance."""
    def call(path, payload, token=None):
        req = urllib.request.Request(
            base.rstrip("/") + path,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json",
                     **({"Authorization": f"Bearer {token}"} if token else {})},
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)

    try:
        token = call("/api/auth/login", {"username": username, "password": password})["token"]
    except urllib.error.HTTPError as e:
        sys.exit(f"Login failed ({e.code}). Check --username / --password.")
    except urllib.error.URLError as e:
        sys.exit(f"Could not reach {base}: {e.reason}")

    result = call("/api/import", data, token)
    print(f"Seeded {base}: {len(data['accounts'])} accounts, "
          f"{len(data['snapshots'])} snapshots, {len(data['goals'])} goals.")
    if result.get("backup"):
        print(f"Pre-import backup written: {result['backup']}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--push", metavar="BASE_URL",
                    help="seed this running instance instead of printing JSON")
    ap.add_argument("--username", default="demo")
    ap.add_argument("--password", default="demo")
    args = ap.parse_args()

    data = build()
    if args.push:
        push(args.push, args.username, args.password, data)
    else:
        print(json.dumps(data, indent=2))
