"""UK tax constants and helpers for the current tax year (2026/27).

Centralised so that next year's update touches one file. Mirror of
frontend/src/constants.js — keep in sync.
"""

# ── Account type sets (must match frontend/src/constants.js) ──────────────────

ASSET_TYPES = {
    "PENSION_DC", "SIPP", "PENSION_DB",
    "ISA_SS", "ISA_CASH", "ISA_LISA",
    "GIA",
    "CURRENT", "SAVINGS",
    "PROPERTY",
}
LIABILITY_TYPES = {"MORTGAGE", "CREDIT_CARD", "LOAN"}
INVESTMENT_PENSION_TYPES = {"PENSION_DC", "SIPP"}
# LISA counts toward the £20k overall ISA allowance, so include it here.
# GIA is a taxable wrapper — not an ISA.
ISA_TYPES = {"ISA_SS", "ISA_CASH", "ISA_LISA"}
CASH_TYPES = {"CURRENT", "SAVINGS"}

# Human-readable labels (mirror of ACCOUNT_LABELS in frontend/src/ui.jsx).
ACCOUNT_LABELS = {
    "PENSION_DC": "DC Pension", "SIPP": "SIPP", "PENSION_DB": "DB / Final Salary Pension",
    "ISA_SS": "Stocks & Shares ISA", "ISA_CASH": "Cash ISA", "ISA_LISA": "Lifetime ISA",
    "GIA": "General Investment Account",
    "CURRENT": "Current Account", "SAVINGS": "Savings Account", "PROPERTY": "Property",
    "MORTGAGE": "Mortgage", "CREDIT_CARD": "Credit Card", "LOAN": "Loan",
}

# Tax year the constants below describe. Update alongside the figures.
TAX_YEAR_LABEL = "2026/27"

# ── Income tax — 2026/27 ──────────────────────────────────────────────────────

PERSONAL_ALLOWANCE = 12570
PERSONAL_ALLOWANCE_TAPER_START = 100000
PERSONAL_ALLOWANCE_TAPER_END = 125140

# Bands as (upper_bound, rate) above the personal allowance
SCOTLAND_BANDS = [
    (16537, 0.19),         # Starter  (2026/27: starter/basic thresholds up 7.4%)
    (29526, 0.20),         # Basic
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

# ── National Insurance Class 1 — 2026/27 ──────────────────────────────────────

NI_PRIMARY_THRESHOLD = 12570
NI_UPPER_EARNINGS_LIMIT = 50270
NI_RATE_MAIN = 0.08
NI_RATE_UEL_PLUS = 0.02

# Employer NI 2026/27
NI_SECONDARY_THRESHOLD = 5000
NI_RATE_EMPLOYER = 0.15

# ── Allowances ────────────────────────────────────────────────────────────────

ISA_ANNUAL_ALLOWANCE = 20000
PENSION_ANNUAL_ALLOWANCE = 60000

# Lifetime ISA — £4k/year sub-allowance (counts within overall £20k ISA limit).
# Government adds 25% bonus on contributions. Can open between 18 and 40,
# contribute until 50, access from 60 (or earlier for first home).
# Unauthorised withdrawals incur a 25% penalty.
LISA_ANNUAL_ALLOWANCE = 4000
LISA_BONUS_PCT = 25
LISA_OPEN_MAX_AGE = 40
LISA_CONTRIB_MAX_AGE = 50
LISA_ACCESS_AGE = 60

# Capital Gains Tax annual exempt amount (2024/25 onwards)
CGT_ANNUAL_ALLOWANCE = 3000
CGT_BASIC_RATE_PCT = 18
CGT_HIGHER_RATE_PCT = 24

# High Income Child Benefit Charge (2024/25 onwards)
#   - Triggered above £60k adjusted net income
#   - 1% of CB clawed back per £200 over £60k
#   - Fully tapered at £80k
HICBC_THRESHOLD_START = 60000
HICBC_THRESHOLD_END = 80000
# Child Benefit weekly rates (2026/27)
CB_WEEKLY_FIRST_CHILD = 27.05
CB_WEEKLY_ADDITIONAL_CHILD = 17.90

# Marriage Allowance
#   - Non-taxpayer spouse transfers £1,260 of personal allowance to basic-rate partner
#   - Worth up to £252/year (£1,260 × 20%)
#   - Spouse must be earning under £12,570 (some flexibility down to £11,310 transferable safely)
MARRIAGE_ALLOWANCE_TRANSFER = 1260
MARRIAGE_ALLOWANCE_SAVING = 252
MARRIAGE_ALLOWANCE_SPOUSE_MAX = 11310  # Safe spouse-income ceiling for full benefit

# Inheritance Tax (NRB and RNRB frozen to April 2031)
#   - 40% on estate value over the Nil Rate Band (NRB)
#   - Residence NRB (RNRB) is an extra slice when main residence passes to
#     direct descendants. Tapered by £1 per £2 over £2M, nil at £2.35M.
#   - Married/civil partners can transfer unused NRB + RNRB → up to £1M combined.
#   - Reduced rate of 36% when 10%+ of the net estate goes to charity.
IHT_NRB = 325000
IHT_RNRB = 175000
IHT_RNRB_TAPER_START = 2000000
IHT_RATE_STANDARD = 0.40
IHT_RATE_REDUCED = 0.36
IHT_REDUCED_RATE_CHARITY_PCT = 0.10

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
    "2026/27": 60000,
}

# ── Ages ──────────────────────────────────────────────────────────────────────

PENSION_ACCESS_AGE = 57            # Rises from 55 to 57 in April 2028
STATE_PENSION_AGE = 67             # Fallback when no date of birth is known — prefer state_pension_age(dob)
STATE_PENSION_ANNUAL_DEFAULT = 12548  # Full new State Pension 2026/27: £241.30/week


# ── Helpers ───────────────────────────────────────────────────────────────────

def state_pension_age(dob):
    """Legislated State Pension age (whole years) for an ISO date of birth.

    Pensions Acts 2007/2014: 66 for those born before 6 April 1960, 67 up to
    5 April 1977, 68 from 6 April 1978. The two phased cohorts (born
    6 Apr 1960 – 5 Mar 1961, and 6 Apr 1977 – 5 Apr 1978) reach it at an age
    in years and months; they are rounded up to the next whole year so the
    planning figure errs on the cautious side. ISO dates compare correctly
    as strings. Falls back to STATE_PENSION_AGE if the date is unusable.
    Mirror of statePensionAge() in frontend/src/constants.js.
    """
    import re
    if not isinstance(dob, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", dob):
        return STATE_PENSION_AGE
    if dob < "1960-04-06":
        return 66
    if dob < "1977-04-06":
        return 67
    return 68


def personal_allowance(income):
    """Personal Allowance after the taper: £1 lost per £2 of income over
    £100k, gone entirely at £125,140."""
    return max(0, PERSONAL_ALLOWANCE - max(0, income - PERSONAL_ALLOWANCE_TAPER_START) / 2)


def calc_income_tax(income, region="scotland"):
    """Income tax on `income` (after any salary sacrifice), unrounded.

    The band tables give upper bounds as gross income assuming the full
    Personal Allowance. In law the lower thresholds are amounts of *taxable*
    income (so they sit at bound - PA), while the top-rate threshold is
    £125,140 of taxable income outright. Running the tapered-PA taxable
    figure through those limits is what produces the 60% (67.5% in Scotland)
    marginal zone between £100k and £125,140.
    Mirror of calcIncomeTax() in frontend/src/constants.js.
    """
    bands = SCOTLAND_BANDS if region == "scotland" else RUK_BANDS
    taxable = max(0, income - personal_allowance(income))
    tax = 0
    prev = 0
    for limit, rate in bands:
        upper = limit - PERSONAL_ALLOWANCE if limit < PERSONAL_ALLOWANCE_TAPER_END else limit
        if taxable <= prev:
            break
        tax += (min(taxable, upper) - prev) * rate
        prev = upper
    return tax


def calc_tax_ni(gross_salary, sacrifice=0, region="scotland"):
    """Income tax + NI for the current tax year. Returns a dict with
    taxable_income, income_tax, employee_ni, employer_ni, take_home."""
    taxable = gross_salary - sacrifice
    income_tax = calc_income_tax(taxable, region)

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
