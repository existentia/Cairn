/**
 * Retirement drawdown model — pure functions, no React.
 *
 * Works in today's money (real returns), one step per year, with two pots:
 *   - pension: locked until the minimum pension age; each withdrawal is 25%
 *     tax-free (until the Lump Sum Allowance is used up) and 75% taxable.
 *   - ISA (the caller also puts GIA holdings here): accessible at any age,
 *     withdrawals treated as tax-free.
 * Guaranteed income (State Pension, DB pension) is taxable and arrives from
 * State Pension age.
 *
 * Withdrawal order each year, aiming at a net (after-tax) spending figure:
 *   1. guaranteed income
 *   2. pension up to whatever still fits inside the Personal Allowance
 *   3. ISA
 *   4. more pension, paying tax, once the ISA is empty
 * Before pension access only the ISA is available, which is what exposes a
 * "bridge" gap for early retirement.
 *
 * Simplifications: tax thresholds are assumed to keep pace with inflation,
 * there is no separate cash buffer, and spending is flat in real terms.
 */

import {
  PERSONAL_ALLOWANCE, PENSION_TAX_FREE_FRACTION, LUMP_SUM_ALLOWANCE, calcIncomeTax,
} from "./constants.js";

/** Small seeded PRNG so Monte Carlo output is stable between renders. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Taxable part of a gross pension withdrawal, given tax-free cash already used. */
function taxablePart(withdrawal, taxFreeUsed) {
  const taxFree = Math.min(withdrawal * PENSION_TAX_FREE_FRACTION, Math.max(0, LUMP_SUM_ALLOWANCE - taxFreeUsed));
  return withdrawal - taxFree;
}

/**
 * Decide one year's withdrawals. `need` is net spending; `guaranteed` is
 * taxable income already arriving. Returns the gross amounts taken from each
 * pot, total income tax for the year, any unmet spending, and the tax-free
 * cash used by this year's pension withdrawal.
 */
export function withdrawForYear({ need, guaranteed, pension, isa, canAccessPension, taxFreeUsed, bands }) {
  const net = (w) => guaranteed + w - calcIncomeTax(guaranteed + taxablePart(w, taxFreeUsed), bands);
  const available = canAccessPension ? Math.max(0, pension) : 0;
  let fromPension = 0;
  let fromIsa = 0;

  let gap = need - net(0);
  if (gap > 0 && available > 0) {
    // Step 2: pension that still fits inside the Personal Allowance is tax-free
    // in full, so £1 withdrawn is £1 of spending.
    const headroom = Math.max(0, PERSONAL_ALLOWANCE - guaranteed);
    const lsaLeft = Math.max(0, LUMP_SUM_ALLOWANCE - taxFreeUsed);
    const untaxedLimit = lsaLeft > 0 ? headroom / (1 - PENSION_TAX_FREE_FRACTION) : headroom;
    fromPension = Math.min(available, untaxedLimit, gap);
    gap = need - net(fromPension);
  }
  if (gap > 0 && isa > 0) {
    fromIsa = Math.min(isa, gap);
    gap -= fromIsa;
  }
  if (gap > 0.5 && available - fromPension > 0) {
    // Step 4: taxed pension. net() rises with the withdrawal, so bisect for
    // the gross amount that delivers the remaining net spending.
    const base = net(fromPension);
    let lo = 0;
    let hi = available - fromPension;
    if (net(fromPension + hi) - base <= gap) {
      lo = hi; // pot can't cover it — take everything
    } else {
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (net(fromPension + mid) - base < gap) lo = mid; else hi = mid;
      }
      lo = hi;
    }
    gap -= net(fromPension + lo) - base;
    fromPension += lo;
  }

  return {
    fromPension,
    fromIsa,
    tax: calcIncomeTax(guaranteed + taxablePart(fromPension, taxFreeUsed), bands),
    shortfall: gap > 0.5 ? gap : 0,
    taxFreeTaken: fromPension - taxablePart(fromPension, taxFreeUsed),
  };
}

/**
 * Run one drawdown path from retirementAge to endAge.
 * `returns` is either a single real annual return or a function of the year
 * index (0 = first year of retirement).
 */
export function simulateDrawdown({
  retirementAge, endAge = 100, pensionPot, isaPot, annualSpend,
  guaranteedIncome = 0, guaranteedFromAge = 67, pensionAccessAge = 57,
  bands, returns = 0,
}) {
  const returnFor = typeof returns === "function" ? returns : () => returns;
  let pension = Math.max(0, pensionPot);
  let isa = Math.max(0, isaPot);
  let taxFreeUsed = 0;
  let totalTax = 0;
  let shortfallAge = null;   // first year spending isn't fully met
  let bridgeGapAge = null;   // …specifically while the pension is still locked
  const years = [];

  for (let age = retirementAge, i = 0; age <= endAge; age++, i++) {
    const canAccessPension = age >= pensionAccessAge;
    const guaranteed = age >= guaranteedFromAge ? guaranteedIncome : 0;
    const w = withdrawForYear({ need: annualSpend, guaranteed, pension, isa, canAccessPension, taxFreeUsed, bands });

    years.push({
      age,
      pension: Math.round(pension),
      isa: Math.round(isa),
      total: Math.round(pension + isa),
      fromPension: Math.round(w.fromPension),
      fromIsa: Math.round(w.fromIsa),
      tax: Math.round(w.tax),
      shortfall: Math.round(w.shortfall),
    });

    if (w.shortfall > 0) {
      if (shortfallAge == null) shortfallAge = age;
      if (!canAccessPension && pension > 0 && bridgeGapAge == null) bridgeGapAge = age;
    }
    totalTax += w.tax;
    taxFreeUsed += w.taxFreeTaken;
    const growth = 1 + returnFor(i);
    pension = Math.max(0, pension - w.fromPension) * growth;
    isa = Math.max(0, isa - w.fromIsa) * growth;
  }

  return { years, shortfallAge, bridgeGapAge, totalTax: Math.round(totalTax) };
}

/**
 * Monte Carlo over random annual real returns (lognormal, arithmetic mean
 * `meanReturn`, volatility `sigma`). Success = spending met every year up to
 * and including `successAge`. Also returns 10th/50th/90th percentile total
 * pot by age for charting.
 */
export function monteCarloDrawdown(params, { runs = 500, meanReturn = 0.025, sigma = 0.12, seed = 20260406, successAge = 95 } = {}) {
  const rng = mulberry32(seed);
  const mu = Math.log(1 + meanReturn) - (sigma * sigma) / 2;
  const span = (params.endAge ?? 100) - params.retirementAge + 1;
  const totalsByYear = Array.from({ length: span }, () => []);
  let successes = 0;

  for (let r = 0; r < runs; r++) {
    const path = Array.from({ length: span }, () => (sigma > 0 ? Math.exp(mu + sigma * gaussian(rng)) - 1 : meanReturn));
    const sim = simulateDrawdown({ ...params, returns: (i) => path[i] });
    if (sim.shortfallAge == null || sim.shortfallAge > successAge) successes++;
    sim.years.forEach((y, i) => totalsByYear[i].push(y.total));
  }

  const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const bands = totalsByYear.map((totals, i) => {
    const sorted = totals.sort((a, b) => a - b);
    return { age: params.retirementAge + i, p10: pct(sorted, 0.1), p50: pct(sorted, 0.5), p90: pct(sorted, 0.9) };
  });
  return { successRate: successes / runs, bands, runs, successAge };
}
