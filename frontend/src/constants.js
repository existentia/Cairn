// UK tax constants and helpers for 2025/26.
// Mirror of backend/uk_tax.py — keep in sync when the tax year rolls over.

export const ASSET_TYPES = new Set([
  "PENSION_DC", "SIPP", "PENSION_DB",
  "ISA_SS", "ISA_CASH",
  "CURRENT", "SAVINGS",
  "PROPERTY",
]);

export const LIABILITY_TYPES = new Set(["MORTGAGE", "CREDIT_CARD", "LOAN"]);
export const INVESTMENT_PENSION_TYPES = new Set(["PENSION_DC", "SIPP"]);
export const ISA_TYPES = new Set(["ISA_SS", "ISA_CASH"]);
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
