// UK tax constants and helpers for 2026/27.
// Mirror of backend/uk_tax.py — keep in sync when the tax year rolls over.

export const ASSET_TYPES = new Set([
  "PENSION_DC", "SIPP", "PENSION_DB",
  "ISA_SS", "ISA_CASH", "ISA_LISA",
  "GIA",
  "CURRENT", "SAVINGS",
  "PROPERTY",
]);

export const LIABILITY_TYPES = new Set(["MORTGAGE", "CREDIT_CARD", "LOAN"]);
export const INVESTMENT_PENSION_TYPES = new Set(["PENSION_DC", "SIPP"]);
// LISA counts toward the £20k overall ISA allowance, so include it here.
// GIA is a taxable wrapper — not an ISA.
export const ISA_TYPES = new Set(["ISA_SS", "ISA_CASH", "ISA_LISA"]);
export const CASH_TYPES = new Set(["CURRENT", "SAVINGS"]);

// Tax year the constants below describe (mirror of TAX_YEAR_LABEL in uk_tax.py).
export const TAX_YEAR_LABEL = "2026/27";

// Income tax 2026/27
export const PERSONAL_ALLOWANCE = 12570;
export const PERSONAL_ALLOWANCE_TAPER_START = 100000;
export const PERSONAL_ALLOWANCE_TAPER_END = 125140;
export const SCOTLAND_HIGHER_RATE_THRESHOLD = 43662;
export const RUK_HIGHER_RATE_THRESHOLD = 50270;
export const SCOTLAND_HIGHER_RATE_PCT = 42;
export const RUK_HIGHER_RATE_PCT = 40;

// National Insurance (Class 1, 2026/27)
export const NI_PRIMARY_THRESHOLD = 12570;
export const NI_UPPER_EARNINGS_LIMIT = 50270;
export const NI_RATE_MAIN = 0.08;
export const NI_RATE_UEL_PLUS = 0.02;

// Income tax bands as [upper_bound, rate] — upper bounds are absolute gross
// income assuming the full personal allowance (mirror of uk_tax.py).
export const SCOTLAND_BANDS = [
  [16537, 0.19],     // Starter  (2026/27: starter/basic thresholds up 7.4%)
  [29526, 0.20],     // Basic
  [43662, 0.21],     // Intermediate
  [75000, 0.42],     // Higher
  [125140, 0.45],    // Advanced
  [Infinity, 0.48],  // Top
];
export const RUK_BANDS = [
  [50270, 0.20],     // Basic
  [125140, 0.40],    // Higher
  [Infinity, 0.45],  // Additional
];

// Allowances
export const ISA_ANNUAL_ALLOWANCE = 20000;
export const PENSION_ANNUAL_ALLOWANCE = 60000;

// Lifetime ISA — £4k/year sub-allowance (counts within overall £20k ISA limit).
// Government adds 25% bonus on contributions. Can open between 18 and 40,
// contribute until 50, access from 60 (or earlier for first home).
// Unauthorised withdrawals incur a 25% penalty.
export const LISA_ANNUAL_ALLOWANCE = 4000;
export const LISA_BONUS_PCT = 25;
export const LISA_OPEN_MAX_AGE = 40;
export const LISA_CONTRIB_MAX_AGE = 50;
export const LISA_ACCESS_AGE = 60;

// Capital Gains Tax annual exempt amount (2024/25 onwards)
export const CGT_ANNUAL_ALLOWANCE = 3000;
export const CGT_BASIC_RATE_PCT = 18;
export const CGT_HIGHER_RATE_PCT = 24;

// High Income Child Benefit Charge (2024/25 onwards)
//   - Triggered above £60k adjusted net income
//   - 1% of CB clawed back per £200 over £60k
//   - Fully tapered at £80k
export const HICBC_THRESHOLD_START = 60000;
export const HICBC_THRESHOLD_END = 80000;
// Child Benefit weekly rates (2026/27)
export const CB_WEEKLY_FIRST_CHILD = 27.05;
export const CB_WEEKLY_ADDITIONAL_CHILD = 17.90;

// Marriage Allowance
//   - Non-taxpayer spouse transfers £1,260 of personal allowance to basic-rate partner
//   - Worth up to £252/year (£1,260 × 20%)
//   - Spouse must be earning under £12,570 (some flexibility down to £11,310 transferable safely)
export const MARRIAGE_ALLOWANCE_TRANSFER = 1260;
export const MARRIAGE_ALLOWANCE_SAVING = 252;
export const MARRIAGE_ALLOWANCE_SPOUSE_MAX = 11310;

// Inheritance Tax (NRB and RNRB frozen to April 2031)
//   - 40% on estate value over the Nil Rate Band (NRB)
//   - Residence NRB (RNRB) is an extra slice when main residence passes to
//     direct descendants. Tapered by £1 per £2 over £2M, nil at £2.35M.
//   - Married/civil partners can transfer unused NRB + RNRB — up to £1M combined.
//   - Reduced rate of 36% when 10%+ of the net estate goes to charity.
export const IHT_NRB = 325000;
export const IHT_RNRB = 175000;
export const IHT_RNRB_TAPER_START = 2000000;
export const IHT_RATE_STANDARD = 0.40;
export const IHT_RATE_REDUCED = 0.36;
export const IHT_REDUCED_RATE_CHARITY_PCT = 0.10;

// Pension Annual Allowance taper (2024/25 onwards)
//   - Triggered when threshold income > £200k AND adjusted income > £260k
//   - Allowance reduces by £1 for every £2 of adjusted income above £260k
//   - Minimum tapered allowance: £10k
export const AA_TAPER_THRESHOLD_INCOME = 200000;
export const AA_TAPER_ADJUSTED_INCOME = 260000;
export const AA_TAPER_MIN_ALLOWANCE = 10000;

// Carry-forward pension AA history
export const PENSION_AA_HISTORY = {
  "2014/15": 40000, "2015/16": 40000, "2016/17": 40000, "2017/18": 40000,
  "2018/19": 40000, "2019/20": 40000, "2020/21": 40000, "2021/22": 40000,
  "2022/23": 40000, "2023/24": 60000, "2024/25": 60000, "2025/26": 60000,
  "2026/27": 60000,
};

// Pension tax-free cash: 25% of each withdrawal, capped in total by the
// Lump Sum Allowance.
export const PENSION_TAX_FREE_FRACTION = 0.25;
export const LUMP_SUM_ALLOWANCE = 268275;

// From 6 April 2029 only the first £2,000 a year of salary-sacrificed pension
// contributions is exempt from NI; income tax relief is unchanged.
export const SALARY_SACRIFICE_NI_CAP = 2000;

// Ages
export const PENSION_ACCESS_AGE = 57; // From April 2028
export const STATE_PENSION_AGE = 67; // Fallback when no date of birth is known — prefer statePensionAge(dob)
export const STATE_PENSION_ANNUAL_DEFAULT = 12548; // Full new State Pension 2026/27: £241.30/week

// Legislated State Pension age (whole years) for an ISO date of birth.
// 66 if born before 6 April 1960, 67 up to 5 April 1977, 68 from 6 April 1978.
// The two phased cohorts (born 6 Apr 1960 – 5 Mar 1961 and 6 Apr 1977 –
// 5 Apr 1978) are rounded up to the next whole year, erring on the cautious
// side. ISO dates compare correctly as strings. Mirror of state_pension_age()
// in uk_tax.py.
export function statePensionAge(dob) {
  if (typeof dob !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return STATE_PENSION_AGE;
  if (dob < "1960-04-06") return 66;
  if (dob < "1977-04-06") return 67;
  return 68;
}

// Personal Allowance after the taper: £1 lost per £2 of income over £100k.
export function personalAllowance(income) {
  return Math.max(0, PERSONAL_ALLOWANCE - Math.max(0, income - PERSONAL_ALLOWANCE_TAPER_START) / 2);
}

// Income tax on `income` (after any salary sacrifice) for a band table.
// Band upper bounds are gross income assuming the full PA; in law the lower
// thresholds are amounts of *taxable* income (bound - PA) while the top-rate
// threshold is £125,140 of taxable income outright. Mirror of
// calc_income_tax() in uk_tax.py.
export function calcIncomeTax(income, bands) {
  const taxable = Math.max(0, income - personalAllowance(income));
  let tax = 0;
  let prev = 0;
  for (const [limit, rate] of bands) {
    const upper = limit < PERSONAL_ALLOWANCE_TAPER_END ? limit - PERSONAL_ALLOWANCE : limit;
    if (taxable <= prev) break;
    tax += (Math.min(taxable, upper) - prev) * rate;
    prev = upper;
  }
  return tax;
}

// Employee Class 1 NI on `income` (after any salary sacrifice): main rate
// between the primary threshold and the upper earnings limit, 2% above.
export function calcEmployeeNi(income) {
  if (income <= NI_PRIMARY_THRESHOLD) return 0;
  return (Math.min(income, NI_UPPER_EARNINGS_LIMIT) - NI_PRIMARY_THRESHOLD) * NI_RATE_MAIN
    + Math.max(0, income - NI_UPPER_EARNINGS_LIMIT) * NI_RATE_UEL_PLUS;
}

// Tax-year helpers
const TAX_YEAR_RE = /^(\d{4})\/(\d{2})$/;

export function parseTaxYear(label) {
  const m = TAX_YEAR_RE.exec(label || "");
  return m ? parseInt(m[1], 10) : null;
}

export function formatTaxYear(startYear) {
  return `${startYear}/${String(startYear + 1).slice(2)}`;
}

// Returns the prior `count` tax years (oldest first) with their AA values.
export function getPriorTaxYears(currentLabel, count = 3) {
  const startYear = parseTaxYear(currentLabel);
  if (startYear == null) return [];
  const out = [];
  for (let i = count; i >= 1; i--) {
    const label = formatTaxYear(startYear - i);
    out.push({ label, allowance: PENSION_AA_HISTORY[label] ?? PENSION_ANNUAL_ALLOWANCE });
  }
  return out;
}

// The tax year the calendar says we are in ("2026/27"), independent of which
// year's constants this file holds. Tax years start on 6 April.
export function currentTaxYearLabel(now = new Date()) {
  const afterStart = now.getMonth() > 3 || (now.getMonth() === 3 && now.getDate() >= 6);
  return formatTaxYear(afterStart ? now.getFullYear() : now.getFullYear() - 1);
}

// Whole monthly payments still to come before 5 April.
export function monthsLeftInTaxYear(now = new Date()) {
  return Math.max(0, Math.floor(daysUntilTaxYearEnd(now) / 30.44));
}

// What one account will have had paid in by the end of this tax year.
// If the user has recorded the amount paid so far this tax year (ytd_contrib,
// stamped with ytd_tax_year) that figure is used and the regular contribution
// is only added for the months remaining. Otherwise — nothing recorded, or
// the stamp is from an earlier year — it falls back to monthly × 12.
// Returns { projected, paid, actual }; `paid` is null when estimating.
export function taxYearContribution(account, now = new Date()) {
  const monthly = account.monthly_contrib || 0;
  if (account.ytd_tax_year && account.ytd_tax_year === currentTaxYearLabel(now)) {
    const paid = account.ytd_contrib || 0;
    return { projected: paid + monthly * monthsLeftInTaxYear(now), paid, actual: true };
  }
  return { projected: monthly * 12, paid: null, actual: false };
}

// Totals across a list of accounts. `anyActual` says whether any figure came
// from a recorded amount rather than the monthly × 12 estimate.
export function sumTaxYearContributions(accounts, now = new Date()) {
  let projected = 0, paid = 0, anyActual = false;
  for (const a of accounts) {
    const c = taxYearContribution(a, now);
    projected += c.projected;
    if (c.actual) { paid += c.paid; anyActual = true; }
  }
  return { projected, paid, anyActual };
}

// UK tax year ends on 5 April. Returns whole days until the next 5 April
// (today returns 0; tomorrow 1; 5 April itself 0; 6 April returns ~365).
export function daysUntilTaxYearEnd(now = new Date()) {
  let end = new Date(now.getFullYear(), 3, 5);
  if (now > end) end = new Date(now.getFullYear() + 1, 3, 5);
  return Math.ceil((end - now) / (1000 * 60 * 60 * 24));
}
