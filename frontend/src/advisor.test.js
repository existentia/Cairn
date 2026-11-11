// Run with `npm test`. Fixtures are invented figures, not anyone's real data.
import test from "node:test";
import assert from "node:assert/strict";
import { generateInsights } from "./advisor.js";

const base = (profile = {}, accounts = [], settings = {}) => ({
  profile: {
    dob: "1985-06-15", retirement_age: 60, gross_salary: 60000,
    pension_contrib_pct: 0, employer_contrib_pct: 0, employer_match_max_pct: 0,
    children_count: 0, spouse_income: 0, state_pension_annual: 12548, ...profile,
  },
  accounts,
  settings: {
    tax_region: "ruk", isa_allowance: 20000, pension_annual_allowance: 60000,
    growth_rate: 5, inflation_rate: 2.5, ...settings,
  },
  snapshots: [],
  boe_rate: null,
});
const titles = (data) => generateInsights(data).map((i) => i.title);
const find = (data, title) => generateInsights(data).find((i) => i.title === title);

test("PA taper warning tests income after pension contributions", () => {
  assert.ok(titles(base({ gross_salary: 105000 })).includes("Personal Allowance Taper"));
  // 10% sacrifice brings income to £94,500 — no taper.
  assert.ok(!titles(base({ gross_salary: 105000, pension_contrib_pct: 10 })).includes("Personal Allowance Taper"));
});

test("PA taper quotes the right marginal rate per region", () => {
  const ruk = find(base({ gross_salary: 110000 }), "Personal Allowance Taper");
  assert.match(ruk.detail, /~60% effective/);
  // £10k at 40% + £5k restored allowance at 40% + 2% NI on £10k
  assert.match(ruk.detail, /save about £6,200 /);
  const scot = find(base({ gross_salary: 110000 }, [], { tax_region: "scotland" }), "Personal Allowance Taper");
  assert.match(scot.detail, /~67\.5% effective/);
});

test("HICBC tests income after pension contributions", () => {
  const hasHicbc = (p) => titles(base({ children_count: 1, ...p })).some((t) => t.startsWith("HICBC"));
  assert.ok(hasHicbc({ gross_salary: 62000 }));
  assert.ok(!hasHicbc({ gross_salary: 62000, pension_contrib_pct: 5 })); // £58,900
});

test("rUK higher-rate sacrifice saving uses 2% NI above the upper earnings limit", () => {
  // £5,000 over the £50,270 threshold: 40% tax + 2% NI = £2,100, not 48%.
  const i = find(base({ gross_salary: 55270 }), "Just Over the Higher-Rate Threshold");
  assert.match(i.detail, /about £2,100\/year/);
});

test("LISA contributions count toward the overall ISA allowance", () => {
  const accounts = [
    { type: "ISA_SS", name: "Example S&S ISA", balance: 10000, monthly_contrib: 1000 },
    { type: "ISA_LISA", name: "Example LISA", balance: 5000, monthly_contrib: 333 },
  ];
  // £15,996 of £20,000 used → £4,004 left
  assert.ok(titles(base({}, accounts)).includes("ISA Allowance Nearly Maxed"));
});
