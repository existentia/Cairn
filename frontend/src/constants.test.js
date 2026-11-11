// Run with `npm test` (Node's built-in test runner — no extra dependencies).
import test from "node:test";
import assert from "node:assert/strict";
import {
  SCOTLAND_BANDS, RUK_BANDS, STATE_PENSION_AGE,
  personalAllowance, calcIncomeTax, statePensionAge,
  currentTaxYearLabel, monthsLeftInTaxYear, taxYearContribution, sumTaxYearContributions,
} from "./constants.js";

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.01, `${actual} != ${expected}`);

test("personal allowance tapers between £100k and £125,140", () => {
  assert.equal(personalAllowance(100000), 12570);
  assert.equal(personalAllowance(110000), 7570);
  assert.equal(personalAllowance(125140), 0);
  assert.equal(personalAllowance(200000), 0);
});

test("rUK income tax matches known figures", () => {
  near(calcIncomeTax(50270, RUK_BANDS), 7540);
  near(calcIncomeTax(100000, RUK_BANDS), 27432);
  near(calcIncomeTax(125140, RUK_BANDS), 42516);
  near(calcIncomeTax(150000, RUK_BANDS), 53703);
});

test("Scottish income tax matches known figures", () => {
  near(calcIncomeTax(75000, SCOTLAND_BANDS), 19482.05);
  near(calcIncomeTax(125140, SCOTLAND_BANDS), 47701.55);
});

test("marginal rate is 60% (rUK) / 67.5% (Scotland) in the taper zone", () => {
  near(calcIncomeTax(110000, RUK_BANDS) - calcIncomeTax(109000, RUK_BANDS), 600);
  near(calcIncomeTax(110000, SCOTLAND_BANDS) - calcIncomeTax(109000, SCOTLAND_BANDS), 675);
});

test("top rate starts at £125,140, not inside the taper zone", () => {
  near(calcIncomeTax(120000, RUK_BANDS) - calcIncomeTax(119000, RUK_BANDS), 600);
  near(calcIncomeTax(126140, RUK_BANDS) - calcIncomeTax(125140, RUK_BANDS), 450);
});

test("State Pension age follows date of birth", () => {
  assert.equal(statePensionAge("1960-04-05"), 66);
  assert.equal(statePensionAge("1960-04-06"), 67);
  assert.equal(statePensionAge("1977-04-05"), 67);
  assert.equal(statePensionAge("1977-04-06"), 68);
  assert.equal(statePensionAge("1985-09-14"), 68);
  for (const bad of [null, undefined, "", "not-a-date"]) assert.equal(statePensionAge(bad), STATE_PENSION_AGE);
});

test("current tax year follows the calendar, turning over on 6 April", () => {
  assert.equal(currentTaxYearLabel(new Date(2027, 3, 5)), "2026/27");
  assert.equal(currentTaxYearLabel(new Date(2027, 3, 6)), "2027/28");
  assert.equal(currentTaxYearLabel(new Date(2026, 10, 11)), "2026/27");
});

test("tax-year contribution uses the recorded amount plus the months left", () => {
  const now = new Date(2026, 10, 11); // 11 Nov 2026 → 4 whole months to 5 April
  assert.equal(monthsLeftInTaxYear(now), 4);
  const isa = { monthly_contrib: 500, ytd_contrib: 9000, ytd_tax_year: "2026/27" };
  assert.deepEqual(taxYearContribution(isa, now), { projected: 11000, paid: 9000, actual: true });
  // A recorded zero is still a real figure: nothing paid yet.
  assert.equal(taxYearContribution({ monthly_contrib: 500, ytd_contrib: 0, ytd_tax_year: "2026/27" }, now).projected, 2000);
});

test("tax-year contribution falls back to monthly × 12 when nothing current is recorded", () => {
  const now = new Date(2026, 10, 11);
  assert.deepEqual(taxYearContribution({ monthly_contrib: 500 }, now), { projected: 6000, paid: null, actual: false });
  // A figure stamped with last tax year is stale and ignored.
  assert.equal(taxYearContribution({ monthly_contrib: 500, ytd_contrib: 15000, ytd_tax_year: "2025/26" }, now).projected, 6000);
});

test("summing contributions reports whether any figure was recorded", () => {
  const now = new Date(2026, 10, 11);
  const sum = sumTaxYearContributions([
    { monthly_contrib: 100 },
    { monthly_contrib: 200, ytd_contrib: 3000, ytd_tax_year: "2026/27" },
  ], now);
  assert.deepEqual(sum, { projected: 1200 + 3800, paid: 3000, anyActual: true });
  assert.equal(sumTaxYearContributions([{ monthly_contrib: 100 }], now).anyActual, false);
});
