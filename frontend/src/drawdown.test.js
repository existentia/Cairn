// Run with `npm test`. Figures are invented.
import test from "node:test";
import assert from "node:assert/strict";
import { RUK_BANDS, LUMP_SUM_ALLOWANCE } from "./constants.js";
import { withdrawForYear, simulateDrawdown, monteCarloDrawdown } from "./drawdown.js";

const near = (actual, expected, tol = 1) => assert.ok(Math.abs(actual - expected) <= tol, `${actual} != ${expected}`);
const year = (o) => withdrawForYear({ guaranteed: 0, pension: 500000, isa: 0, canAccessPension: true, taxFreeUsed: 0, bands: RUK_BANDS, ...o });

test("pension inside the personal allowance is tax-free", () => {
  const w = year({ need: 12000 });
  near(w.fromPension, 12000);
  assert.equal(w.tax, 0);
  assert.equal(w.shortfall, 0);
});

test("ISA is used before taxed pension", () => {
  // £16,760 gross pension is 25% tax-free + £12,570 inside the allowance.
  const w = year({ need: 30000, isa: 100000 });
  near(w.fromPension, 16760);
  near(w.fromIsa, 13240);
  assert.equal(w.tax, 0);
});

test("taxed pension withdrawal nets to the spending target", () => {
  // No ISA: 0.85W + 2,514 = 40,000  →  W ≈ £44,101, tax ≈ £4,101.
  const w = year({ need: 40000 });
  near(w.fromPension, 44101, 2);
  near(w.tax, 4101, 2);
  near(w.fromPension - w.tax, 40000, 1);
});

test("state pension uses up the allowance first", () => {
  // £12,570 guaranteed fills the allowance; the other £10,000 comes from the
  // pension at an effective 15% (75% taxable at 20%): W = 10,000 / 0.85.
  const w = year({ need: 22570, guaranteed: 12570 });
  near(w.fromPension, 11765, 2);
});

test("no tax-free cash once the Lump Sum Allowance is used", () => {
  const w = year({ need: 30000, taxFreeUsed: LUMP_SUM_ALLOWANCE });
  assert.equal(w.taxFreeTaken, 0);
  // Fully taxable: W − 20% × (W − 12,570) = 30,000  →  W = 34,357.50
  near(w.fromPension, 34357.5, 2);
});

test("before pension access only the ISA is available", () => {
  const w = year({ need: 20000, isa: 15000, canAccessPension: false });
  assert.equal(w.fromPension, 0);
  near(w.fromIsa, 15000);
  near(w.shortfall, 5000);
});

test("deterministic path: £100k at zero growth funds ten years of £10k", () => {
  const sim = simulateDrawdown({ retirementAge: 60, pensionPot: 100000, isaPot: 0, annualSpend: 10000, bands: RUK_BANDS, returns: 0 });
  assert.equal(sim.shortfallAge, 70);
  assert.equal(sim.bridgeGapAge, null);
  assert.equal(sim.totalTax, 0);
  assert.equal(sim.years[0].total, 100000);
});

test("early retirement with a thin ISA shows a bridge gap", () => {
  const sim = simulateDrawdown({ retirementAge: 52, pensionPot: 600000, isaPot: 40000, annualSpend: 20000, pensionAccessAge: 57, bands: RUK_BANDS, returns: 0 });
  assert.equal(sim.bridgeGapAge, 54); // ISA lasts two years
  assert.equal(sim.shortfallAge, 54);
});

test("guaranteed income starts at the given age and reduces withdrawals", () => {
  const sim = simulateDrawdown({ retirementAge: 66, endAge: 70, pensionPot: 300000, isaPot: 0, annualSpend: 12000, guaranteedIncome: 12000, guaranteedFromAge: 68, bands: RUK_BANDS, returns: 0 });
  assert.deepEqual(sim.years.map((y) => y.fromPension), [12000, 12000, 0, 0, 0]);
});

test("Monte Carlo is reproducible and agrees with the deterministic path at zero volatility", () => {
  const params = { retirementAge: 60, pensionPot: 400000, isaPot: 100000, annualSpend: 20000, bands: RUK_BANDS };
  const a = monteCarloDrawdown(params, { runs: 200, sigma: 0.12 });
  const b = monteCarloDrawdown(params, { runs: 200, sigma: 0.12 });
  assert.equal(a.successRate, b.successRate);
  assert.ok(a.successRate > 0 && a.successRate <= 1);
  assert.ok(a.bands[10].p10 <= a.bands[10].p50 && a.bands[10].p50 <= a.bands[10].p90);

  const flat = monteCarloDrawdown(params, { runs: 20, sigma: 0, meanReturn: 0.02 });
  const det = simulateDrawdown({ ...params, returns: 0.02 });
  assert.equal(flat.successRate, det.shortfallAge == null || det.shortfallAge > 95 ? 1 : 0);
  assert.equal(flat.bands[5].p50, det.years[5].total);
});
