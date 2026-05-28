// UK tax constants and helpers for 2025/26.
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

// Income tax 2025/26
export const PERSONAL_ALLOWANCE = 12570;
export const PERSONAL_ALLOWANCE_TAPER_START = 100000;
export const PERSONAL_ALLOWANCE_TAPER_END = 125140;
export const SCOTLAND_HIGHER_RATE_THRESHOLD = 43662;
export const RUK_HIGHER_RATE_THRESHOLD = 50270;
export const SCOTLAND_HIGHER_RATE_PCT = 42;
export const RUK_HIGHER_RATE_PCT = 40;

// National Insurance (Class 1, 2025/26)
export const NI_PRIMARY_THRESHOLD = 12570;
export const NI_UPPER_EARNINGS_LIMIT = 50270;
export const NI_RATE_MAIN = 0.08;

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
// Child Benefit weekly rates (2025/26)
export const CB_WEEKLY_FIRST_CHILD = 26.05;
export const CB_WEEKLY_ADDITIONAL_CHILD = 17.25;

// Marriage Allowance
//   - Non-taxpayer spouse transfers £1,260 of personal allowance to basic-rate partner
//   - Worth up to £252/year (£1,260 × 20%)
//   - Spouse must be earning under £12,570 (some flexibility down to £11,310 transferable safely)
export const MARRIAGE_ALLOWANCE_TRANSFER = 1260;
export const MARRIAGE_ALLOWANCE_SAVING = 252;
export const MARRIAGE_ALLOWANCE_SPOUSE_MAX = 11310;

// Inheritance Tax (frozen to 2030)
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
};

// Ages
export const PENSION_ACCESS_AGE = 57; // From April 2028
export const STATE_PENSION_AGE = 67;
export const STATE_PENSION_ANNUAL_DEFAULT = 11500;

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

// UK tax year ends on 5 April. Returns whole days until the next 5 April
// (today returns 0; tomorrow 1; 5 April itself 0; 6 April returns ~365).
export function daysUntilTaxYearEnd(now = new Date()) {
  let end = new Date(now.getFullYear(), 3, 5);
  if (now > end) end = new Date(now.getFullYear() + 1, 3, 5);
  return Math.ceil((end - now) / (1000 * 60 * 60 * 24));
}
