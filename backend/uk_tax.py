"""UK tax constants and helpers for the current tax year (2025/26).

Centralised so that next year's update touches one file. Mirror of
frontend/src/constants.js — keep in sync.
"""

# ── Account type sets (must match frontend/src/constants.js) ──────────────────

ASSET_TYPES = {
    "PENSION_DC", "SIPP", "PENSION_DB",
    "ISA_SS", "ISA_CASH",
    "CURRENT", "SAVINGS",
    "PROPERTY",
}
LIABILITY_TYPES = {"MORTGAGE", "CREDIT_CARD", "LOAN"}
INVESTMENT_PENSION_TYPES = {"PENSION_DC", "SIPP"}
ISA_TYPES = {"ISA_SS", "ISA_CASH"}
CASH_TYPES = {"CURRENT", "SAVINGS"}

# ── Income tax — 2025/26 ──────────────────────────────────────────────────────

PERSONAL_ALLOWANCE = 12570
PERSONAL_ALLOWANCE_TAPER_START = 100000
PERSONAL_ALLOWANCE_TAPER_END = 125140

# Bands as (upper_bound, rate) above the personal allowance
SCOTLAND_BANDS = [
    (14876, 0.19),         # Starter
    (26561, 0.20),         # Basic
    (43662, 0.21),         # Intermediate
    (75000, 0.42),         # Higher
    (125140, 0.45),        # Advanced
    (float("inf"), 0.48),  # Top
]
RUK_BANDS = [
    (50270, 0.20),         # Basic
    (125140, 0.40),        # Higher
    (float("inf"), 0.45),  # Additional
]

SCOTLAND_HIGHER_RATE_THRESHOLD = 43662
RUK_HIGHER_RATE_THRESHOLD = 50270
SCOTLAND_HIGHER_RATE_PCT = 42  # 42% income tax in the Scottish higher band
RUK_HIGHER_RATE_PCT = 40

# ── National Insurance Class 1 — 2025/26 ──────────────────────────────────────

NI_PRIMARY_THRESHOLD = 12570
NI_UPPER_EARNINGS_LIMIT = 50270
NI_RATE_MAIN = 0.08
NI_RATE_UEL_PLUS = 0.02

# Employer NI 2025/26
NI_SECONDARY_THRESHOLD = 5000
NI_RATE_EMPLOYER = 0.15

# ── Allowances ────────────────────────────────────────────────────────────────

ISA_ANNUAL_ALLOWANCE = 20000
PENSION_ANNUAL_ALLOWANCE = 60000

# Pension Annual Allowance taper (2024/25 onwards)
#   - Triggered when threshold income > £200k AND adjusted income > £260k
#   - Allowance reduces by £1 for every £2 of adjusted income above £260k
#   - Minimum tapered allowance: £10k
AA_TAPER_THRESHOLD_INCOME = 200000
AA_TAPER_ADJUSTED_INCOME = 260000
AA_TAPER_MIN_ALLOWANCE = 10000

# Carry-forward: prior-year pension annual allowances
PENSION_AA_HISTORY = {
    "2014/15": 40000, "2015/16": 40000, "2016/17": 40000, "2017/18": 40000,
    "2018/19": 40000, "2019/20": 40000, "2020/21": 40000, "2021/22": 40000,
    "2022/23": 40000, "2023/24": 60000, "2024/25": 60000, "2025/26": 60000,
}

# ── Ages ──────────────────────────────────────────────────────────────────────

PENSION_ACCESS_AGE = 57            # Rises from 55 to 57 in April 2028
STATE_PENSION_AGE = 67             # Forward-looking; phased rise from 66
STATE_PENSION_ANNUAL_DEFAULT = 11500


# ── Helpers ───────────────────────────────────────────────────────────────────

def calc_tax_ni(gross_salary, sacrifice=0, region="scotland"):
    """Income tax + NI for the current tax year. Returns a dict with
    taxable_income, income_tax, employee_ni, employer_ni, take_home."""
    taxable = gross_salary - sacrifice
    bands = SCOTLAND_BANDS if region == "scotland" else RUK_BANDS

    income_tax = 0
    remaining = max(0, taxable - PERSONAL_ALLOWANCE)
    prev_limit = PERSONAL_ALLOWANCE
    for limit, rate in bands:
        band_width = limit - prev_limit
        taxed = min(remaining, band_width)
        income_tax += taxed * rate
        remaining -= taxed
        prev_limit = limit
        if remaining <= 0:
            break

    ni_earnings = max(0, taxable - NI_PRIMARY_THRESHOLD)
    if taxable <= NI_UPPER_EARNINGS_LIMIT:
        employee_ni = ni_earnings * NI_RATE_MAIN
    else:
        employee_ni = (
            (NI_UPPER_EARNINGS_LIMIT - NI_PRIMARY_THRESHOLD) * NI_RATE_MAIN
            + (taxable - NI_UPPER_EARNINGS_LIMIT) * NI_RATE_UEL_PLUS
        )

    employer_ni = max(0, taxable - NI_SECONDARY_THRESHOLD) * NI_RATE_EMPLOYER

    return {
        "taxable_income": round(taxable),
        "income_tax": round(income_tax),
        "employee_ni": round(employee_ni),
        "employer_ni": round(employer_ni),
        "take_home": round(taxable - income_tax - employee_ni),
    }
