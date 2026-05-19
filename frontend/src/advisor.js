/**
 * Advisor Engine — UK-specific financial insights.
 * Rule-based analysis, not regulated advice.
 *
 * Each insight: { type, category, title, detail, priority }
 *   type:     "warning" | "opportunity" | "good" | "info"
 *   category: "isa" | "pension" | "mortgage" | "debt" | "savings" | "retirement" | "general"
 *   priority: 1 (highest) → 5 (lowest)
 */

import {
  ASSET_TYPES, LIABILITY_TYPES, ISA_TYPES, INVESTMENT_PENSION_TYPES,
  PERSONAL_ALLOWANCE_TAPER_START, PERSONAL_ALLOWANCE_TAPER_END,
  SCOTLAND_HIGHER_RATE_THRESHOLD, RUK_HIGHER_RATE_THRESHOLD,
  SCOTLAND_HIGHER_RATE_PCT, RUK_HIGHER_RATE_PCT,
  NI_RATE_MAIN,
  STATE_PENSION_AGE, PENSION_ACCESS_AGE, STATE_PENSION_ANNUAL_DEFAULT,
  AA_TAPER_THRESHOLD_INCOME, AA_TAPER_ADJUSTED_INCOME, AA_TAPER_MIN_ALLOWANCE,
  LISA_ANNUAL_ALLOWANCE, LISA_BONUS_PCT,
  LISA_OPEN_MAX_AGE, LISA_CONTRIB_MAX_AGE,
  CGT_ANNUAL_ALLOWANCE, CGT_BASIC_RATE_PCT, CGT_HIGHER_RATE_PCT,
} from "./constants.js";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const fmtFull = (v) =>
  `${v < 0 ? "-" : ""}£${Math.abs(v).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const ageFromDob = (dob) => {
  const d = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--;
  return age;
};

function daysUntilTaxYearEnd() {
  const now = new Date();
  let taxYearEnd = new Date(now.getFullYear(), 3, 5);
  if (now > taxYearEnd) taxYearEnd = new Date(now.getFullYear() + 1, 3, 5);
  return Math.ceil((taxYearEnd - now) / (1000 * 60 * 60 * 24));
}

export function generateInsights({ profile, accounts, settings, snapshots, boe_rate }) {
  const insights = [];
  if (!profile || !accounts || !settings) return insights;

  const age = ageFromDob(profile.dob);
  const yearsToRetirement = profile.retirement_age - age;
  const totalAssets = accounts.filter((a) => ASSET_TYPES.has(a.type)).reduce((s, a) => s + a.balance, 0);
  const totalLiabilities = accounts.filter((a) => LIABILITY_TYPES.has(a.type)).reduce((s, a) => s + Math.abs(a.balance), 0);
  const netWorth = totalAssets - totalLiabilities;

  // ── ISA allowance ────────────────────────────────────────────────
  const isaMonthly = accounts
    .filter((a) => a.type === "ISA_SS" || a.type === "ISA_CASH")
    .reduce((s, a) => s + (a.monthly_contrib || 0), 0);
  const isaAnnual = isaMonthly * 12;
  const isaRemaining = settings.isa_allowance - isaAnnual;

  if (isaRemaining > 5000) {
    insights.push({
      type: "opportunity", category: "isa", title: "ISA Allowance Headroom",
      detail: `You're using ${fmtFull(isaAnnual)} of your ${fmtFull(settings.isa_allowance)} ISA allowance. That leaves ${fmtFull(isaRemaining)} of tax-free space. Increasing monthly contributions by ${fmtFull(Math.round(isaRemaining / 12))} would max it out.`,
      priority: 2,
    });
  } else if (isaRemaining > 0 && isaRemaining <= 5000) {
    insights.push({ type: "good", category: "isa", title: "ISA Allowance Nearly Maxed", detail: `Only ${fmtFull(isaRemaining)} of your ISA allowance remaining — well done.`, priority: 4 });
  } else if (isaRemaining <= 0) {
    insights.push({ type: "good", category: "isa", title: "ISA Allowance Maxed", detail: `You've maxed your ${fmtFull(settings.isa_allowance)} ISA allowance this tax year.`, priority: 5 });
  }

  // ── ISA tax year countdown ───────────────────────────────────────
  const daysLeft = daysUntilTaxYearEnd();
  if (daysLeft <= 90 && isaRemaining > 1000) {
    const monthsLeft = Math.max(1, Math.floor(daysLeft / 30));
    insights.push({
      type: "warning", category: "isa", title: `ISA Deadline: ${daysLeft} Days Remaining`,
      detail: `Tax year ends 5 April. ${fmtFull(isaRemaining)} unused ISA allowance — use it or lose it. That's ${fmtFull(Math.round(isaRemaining / monthsLeft))}/month for ${monthsLeft} month${monthsLeft > 1 ? "s" : ""}, or a lump sum.`,
      priority: 1,
    });
  }

  // ── Lifetime ISA opportunities ───────────────────────────────────
  // 25% government bonus on contributions up to £4k/year — easily the best
  // guaranteed return available to UK savers under 50.
  const lisaAccounts = accounts.filter((a) => a.type === "ISA_LISA");
  const hasLISA = lisaAccounts.length > 0;
  const lisaMonthly = lisaAccounts.reduce((s, a) => s + (a.monthly_contrib || 0), 0);
  const lisaAnnual = lisaMonthly * 12;
  const lisaRemaining = LISA_ANNUAL_ALLOWANCE - lisaAnnual;

  if (hasLISA && age < LISA_CONTRIB_MAX_AGE && lisaRemaining > 500) {
    const bonusMissed = Math.round(lisaRemaining * (LISA_BONUS_PCT / 100));
    insights.push({
      type: "opportunity", category: "isa", title: "LISA Bonus Headroom",
      detail: `Using ${fmtFull(lisaAnnual)} of your £${LISA_ANNUAL_ALLOWANCE.toLocaleString()} LISA allowance — ${fmtFull(lisaRemaining)} remaining this tax year. Every £1 you add gets a 25p government bonus, so filling this would unlock an extra ${fmtFull(bonusMissed)}/year in free money. Bonus paid monthly into the account, available until age ${LISA_CONTRIB_MAX_AGE}.`,
      priority: 2,
    });
  } else if (!hasLISA && age >= 18 && age < LISA_OPEN_MAX_AGE) {
    insights.push({
      type: "info", category: "isa", title: "LISA Worth Considering",
      detail: `Lifetime ISAs let you contribute up to £${LISA_ANNUAL_ALLOWANCE.toLocaleString()}/year (within your overall £20k ISA limit) for a 25% government bonus — up to £1,000/year free. Designed for first home or retirement (accessible from age 60). You can only open one before age ${LISA_OPEN_MAX_AGE} and contribute until age ${LISA_CONTRIB_MAX_AGE}. Unauthorised withdrawals incur a 25% penalty, so only for genuine long-term/property savings.`,
      priority: 4,
    });
  }

  // ── GIA: CGT allowance opportunity ───────────────────────────────
  // Outside of an ISA wrapper, gains over the annual exempt amount attract CGT.
  // "Bed & ISA" — selling within the GIA and immediately re-buying inside an
  // ISA — uses the allowance and shelters future growth.
  const giaAccounts = accounts.filter((a) => a.type === "GIA");
  const totalGiaGain = giaAccounts.reduce((s, a) => s + (a.unrealised_gain || 0), 0);
  if (totalGiaGain > CGT_ANNUAL_ALLOWANCE) {
    const rate = (settings.tax_region === "scotland"
      ? profile.gross_salary > SCOTLAND_HIGHER_RATE_THRESHOLD
      : profile.gross_salary > RUK_HIGHER_RATE_THRESHOLD)
      ? CGT_HIGHER_RATE_PCT : CGT_BASIC_RATE_PCT;
    const realisable = Math.min(totalGiaGain, CGT_ANNUAL_ALLOWANCE);
    insights.push({
      type: "opportunity", category: "tax", title: "Use Your CGT Allowance",
      detail: `Your GIA holdings show ${fmtFull(totalGiaGain)} in unrealised gains. The 2025/26 CGT annual exempt amount is £${CGT_ANNUAL_ALLOWANCE.toLocaleString()} — gains above that are taxed at ${rate}% at your marginal rate. Consider realising ${fmtFull(realisable)} of gains this tax year (sell, then re-buy inside your S&S ISA — "bed & ISA") to use the allowance and shelter future growth tax-free. Allowance cannot be carried forward.`,
      priority: 2,
    });
  }

  // ── Cash ISA only — no S&S ISA ───────────────────────────────────
  const hasCashISA = accounts.some((a) => a.type === "ISA_CASH" && a.balance > 0);
  const hasSandSISA = accounts.some((a) => a.type === "ISA_SS");
  if (hasCashISA && !hasSandSISA && yearsToRetirement > 5) {
    const cashIsaTotal = accounts.filter((a) => a.type === "ISA_CASH").reduce((s, a) => s + a.balance, 0);
    insights.push({
      type: "opportunity", category: "isa", title: "Cash ISA Only — Consider S&S ISA",
      detail: `${fmtFull(cashIsaTotal)} in Cash ISA but no Stocks & Shares ISA. Over ${yearsToRetirement}+ years, global equities have historically outperformed cash by 4–5% real. A global index tracker in a S&S ISA could significantly grow long-term returns for money you won't need short-term.`,
      priority: 3,
    });
  }

  // ── Credit card / high-interest debt ─────────────────────────────
  accounts.filter((a) => a.type === "CREDIT_CARD").forEach((cc) => {
    if (Math.abs(cc.balance) > 0 && cc.interest_rate > 15) {
      const monthlyInterest = Math.abs(cc.balance) * (cc.interest_rate / 100 / 12);
      insights.push({
        type: "warning", category: "debt", title: `High-Interest Debt: ${cc.name}`,
        detail: `${fmtFull(Math.abs(cc.balance))} at ${cc.interest_rate}% APR costs ~${fmtFull(Math.round(monthlyInterest))}/month (${fmtFull(Math.round(monthlyInterest * 12))}/year) in interest. Clearing this gives a guaranteed ${cc.interest_rate}% return. Consider a 0% balance transfer card to buy time.`,
        priority: 1,
      });
    }
  });

  // ── Debt vs investment priority ──────────────────────────────────
  const highInterestDebt = accounts.filter((a) => LIABILITY_TYPES.has(a.type) && a.type !== "MORTGAGE" && a.interest_rate > 5).reduce((s, a) => s + Math.abs(a.balance), 0);
  if (highInterestDebt > 0 && isaMonthly > 0) {
    insights.push({
      type: "opportunity", category: "debt", title: "Debt vs Investment Priority",
      detail: `${fmtFull(highInterestDebt)} in non-mortgage debt at rates above 5%. Redirecting investment contributions to clear this first delivers a better guaranteed return.`,
      priority: 1,
    });
  }

  // ── Emergency fund ───────────────────────────────────────────────
  const liquidCash = accounts.filter((a) => a.type === "CURRENT" || a.type === "SAVINGS").reduce((s, a) => s + a.balance, 0);
  const monthlyExpenses = profile.gross_salary > 0 ? (profile.gross_salary * 0.65) / 12 : 2500;
  const monthsCover = liquidCash / monthlyExpenses;

  if (monthsCover < 3) {
    insights.push({
      type: "warning", category: "savings", title: "Emergency Fund Below Target",
      detail: `Liquid cash (${fmtFull(liquidCash)}) covers ~${monthsCover.toFixed(1)} months. Target: 3-6 months (${fmtFull(Math.round(monthlyExpenses * 3))} – ${fmtFull(Math.round(monthlyExpenses * 6))}). Consider pausing ISA contributions until this is built up.`,
      priority: 1,
    });
  } else if (monthsCover >= 3 && monthsCover < 6) {
    insights.push({ type: "info", category: "savings", title: "Emergency Fund Adequate", detail: `${fmtFull(liquidCash)} covers ~${monthsCover.toFixed(1)} months. Within the 3-6 month target range.`, priority: 4 });
  } else if (monthsCover >= 12) {
    insights.push({
      type: "opportunity", category: "savings", title: "Excess Cash Holdings",
      detail: `${fmtFull(liquidCash)} covers ${monthsCover.toFixed(0)} months — well beyond the 6-month target. The excess ${fmtFull(Math.round(liquidCash - monthlyExpenses * 6))} could work harder in an ISA or pension.`,
      priority: 3,
    });
  }

  // ── Low savings interest rate ────────────────────────────────────
  accounts.filter((a) => a.type === "SAVINGS" && (!a.interest_rate || a.interest_rate < 2) && a.balance > 5000).forEach((a) => {
    const rate = a.interest_rate || 0;
    insights.push({
      type: "opportunity", category: "savings", title: `Low Interest Rate: ${a.name}`,
      detail: `${fmtFull(a.balance)} earning ${rate}% — well below current easy-access rates of 4%+. Switching to a top easy-access account could earn an extra ~${fmtFull(Math.round(a.balance * 0.04))}/year. Compare at moneysavingexpert.com/savings.`,
      priority: 3,
    });
  });

  // ── Fixed-savings maturity reminder ──────────────────────────────
  // Fixed-rate bonds tend to default to dismal rates on rollover, so the
  // months leading up to maturity are the right time to start shopping.
  accounts.filter((a) => a.type === "SAVINGS" && a.term_end_date && a.balance > 1000).forEach((a) => {
    const days = Math.ceil((new Date(a.term_end_date) - new Date()) / MS_PER_DAY);
    if (days <= 0 || days > 90) return;
    const monthsLeft = Math.max(1, Math.round(days / 30.44));
    const rate = a.interest_rate || 0;
    insights.push({
      type: days <= 30 ? "warning" : "opportunity",
      category: "savings",
      title: `Fixed Savings Maturing: ${a.name}`,
      detail: `${fmtFull(a.balance)} at ${rate}% matures in ${days} day${days === 1 ? "" : "s"} (${monthsLeft} month${monthsLeft === 1 ? "" : "s"}, ${a.term_end_date}). Banks typically roll these over into low-rate easy-access products by default — start comparing fixed bond / easy-access rates now to lock in the best replacement.`,
      priority: days <= 30 ? 1 : 2,
    });
  });

  // ── Workplace pension match underused ────────────────────────────
  // If the employer matches up to N% but the user contributes less, they're
  // leaving free money on the table — the simplest pension win there is.
  const matchMax = profile.employer_match_max_pct || 0;
  if (matchMax > 0 && profile.pension_contrib_pct < matchMax && profile.gross_salary > 0) {
    const gap = matchMax - profile.pension_contrib_pct;
    const employerMissed = profile.gross_salary * (gap / 100);
    const personalCost = employerMissed; // £1 you contribute = £1 they match
    insights.push({
      type: "warning", category: "pension", title: "Workplace Match Not Fully Used",
      detail: `Employer matches up to ${matchMax}% but you're contributing ${profile.pension_contrib_pct}%. Raising your contribution by ${gap}% (${fmtFull(Math.round(personalCost))}/year, ~${fmtFull(Math.round(personalCost / 12))}/month gross) unlocks an extra ${fmtFull(Math.round(employerMissed))}/year of free employer money. Via salary sacrifice the personal cost is significantly less than the headline figure.`,
      priority: 1,
    });
  }

  // ── Pension headroom ─────────────────────────────────────────────
  // Workplace contributions (sal-sac, gross) + per-account monthly contributions
  // to DC and SIPP pots. SIPP contributions are assumed RAS (net of 20% basic-rate
  // relief at source), so we gross up; PENSION_DC monthly_contrib is assumed gross.
  const workplacePensionAnnual = profile.gross_salary * ((profile.pension_contrib_pct + profile.employer_contrib_pct) / 100);
  const dcMonthlyContribs = accounts.filter((a) => a.type === "PENSION_DC").reduce((s, a) => s + (a.monthly_contrib || 0), 0);
  const sippMonthlyContribsGross = accounts.filter((a) => a.type === "SIPP").reduce((s, a) => s + (a.monthly_contrib || 0), 0) / 0.8;
  const pensionAnnual = workplacePensionAnnual + (dcMonthlyContribs + sippMonthlyContribsGross) * 12;
  const pensionHeadroom = settings.pension_annual_allowance - pensionAnnual;

  if (pensionHeadroom > 20000) {
    insights.push({
      type: "info", category: "pension", title: "Pension Contribution Headroom",
      detail: `Total contributions ~${fmtFull(Math.round(pensionAnnual))}/year against ${fmtFull(settings.pension_annual_allowance)} allowance. ${fmtFull(Math.round(pensionHeadroom))} headroom remaining. Salary sacrifice above the higher-rate threshold saves both Income Tax and NI. You can also carry forward unused allowance from the previous 3 tax years.`,
      priority: 3,
    });
  }

  // ── Salary sacrifice opportunity ─────────────────────────────────
  const taxRegion = settings.tax_region || "scotland";
  const higherRateThreshold = taxRegion === "scotland" ? SCOTLAND_HIGHER_RATE_THRESHOLD : RUK_HIGHER_RATE_THRESHOLD;
  const higherRatePct = taxRegion === "scotland" ? SCOTLAND_HIGHER_RATE_PCT : RUK_HIGHER_RATE_PCT;
  const bandDesc = taxRegion === "scotland" ? `Scottish higher-rate band (${SCOTLAND_HIGHER_RATE_PCT}%)` : `higher-rate band (${RUK_HIGHER_RATE_PCT}%)`;
  if (profile.gross_salary > higherRateThreshold && profile.pension_contrib_pct < 15) {
    const currentSacrifice = profile.gross_salary * (profile.pension_contrib_pct / 100);
    const toThreshold = profile.gross_salary - higherRateThreshold - currentSacrifice;
    if (toThreshold > 0) {
      const extraContrib = Math.min(toThreshold, 20000);
      // Combined saving: higher-rate income tax + employee NI within UEL
      const combinedSavingRate = (higherRatePct / 100) + NI_RATE_MAIN;
      const totalSaved = extraContrib * combinedSavingRate;
      const takeHomeReduction = extraContrib - totalSaved;
      insights.push({
        type: "opportunity", category: "pension", title: "Salary Sacrifice Optimisation",
        detail: `You're in the ${bandDesc}. An extra ${fmtFull(Math.round(extraContrib))}/year via salary sacrifice would cost only ${fmtFull(Math.round(takeHomeReduction))}/year in take-home (${fmtFull(Math.round(takeHomeReduction / 12))}/month) while adding ${fmtFull(Math.round(extraContrib))} to your pension. Use the Salary Sacrifice tool to model exact figures.`,
        priority: 2,
      });
    }
  }

  // ── Personal allowance taper ─────────────────────────────────────
  if (profile.gross_salary > PERSONAL_ALLOWANCE_TAPER_START) {
    const taperAmount = Math.min(profile.gross_salary - PERSONAL_ALLOWANCE_TAPER_START, PERSONAL_ALLOWANCE_TAPER_END - PERSONAL_ALLOWANCE_TAPER_START);
    const paLost = Math.round(taperAmount / 2);
    insights.push({
      type: "warning", category: "general", title: "Personal Allowance Taper",
      detail: `Gross salary of ${fmtFull(profile.gross_salary)} triggers the PA taper — you lose £1 of personal allowance for every £2 over £${PERSONAL_ALLOWANCE_TAPER_START.toLocaleString()}, creating a ~60% effective marginal rate. You've lost ~${fmtFull(paLost)} of your PA. Salary sacrificing down to £${PERSONAL_ALLOWANCE_TAPER_START.toLocaleString()} would fully restore it and could be worth ${fmtFull(Math.round(paLost * (SCOTLAND_HIGHER_RATE_PCT / 100)))} in additional tax relief.`,
      priority: 1,
    });
  }

  // ── Annual Allowance taper (high earners) ────────────────────────
  // Approximation: use gross salary as a proxy for both threshold and adjusted
  // income. Threshold income is taxable income minus member pension contribs;
  // adjusted income adds back employer contribs. For a salaried user the
  // approximation triggers correctly when gross_salary > £200k AND
  // gross_salary + employer_contrib > £260k, which is the practically useful
  // band where the user should investigate further.
  if (profile.gross_salary > AA_TAPER_THRESHOLD_INCOME) {
    const employerContrib = profile.gross_salary * ((profile.employer_contrib_pct || 0) / 100);
    const adjustedIncomeProxy = profile.gross_salary + employerContrib;
    if (adjustedIncomeProxy > AA_TAPER_ADJUSTED_INCOME) {
      const excess = adjustedIncomeProxy - AA_TAPER_ADJUSTED_INCOME;
      const reduction = Math.min(Math.floor(excess / 2), settings.pension_annual_allowance - AA_TAPER_MIN_ALLOWANCE);
      const taperedAA = Math.max(AA_TAPER_MIN_ALLOWANCE, settings.pension_annual_allowance - reduction);
      insights.push({
        type: "warning", category: "pension", title: "Annual Allowance Taper",
        detail: `Income above £${AA_TAPER_ADJUSTED_INCOME.toLocaleString()} triggers the Pension AA taper — your £${settings.pension_annual_allowance.toLocaleString()} allowance reduces by £1 for every £2 of adjusted income over the threshold, down to a £${AA_TAPER_MIN_ALLOWANCE.toLocaleString()} floor. Your estimated tapered allowance is ~${fmtFull(taperedAA)}. Over-contributing triggers an Annual Allowance charge at your marginal rate. The exact figure depends on your full adjusted/threshold income calculation — worth checking with an accountant.`,
        priority: 1,
      });
    } else {
      // Threshold income exceeded but adjusted income probably not — still flag as one to watch
      insights.push({
        type: "info", category: "pension", title: "Annual Allowance Taper Threshold",
        detail: `Salary above £${AA_TAPER_THRESHOLD_INCOME.toLocaleString()} is the threshold for the Pension AA taper. The taper only bites once adjusted income (incl. employer pension contributions) exceeds £${AA_TAPER_ADJUSTED_INCOME.toLocaleString()}. Worth checking whether any bonus or RSU vest could push you over.`,
        priority: 3,
      });
    }
  }

  // ── Salary band cliff alerts ─────────────────────────────────────
  // Each rate band introduces a step-change in marginal rate. Salary sacrifice
  // is most valuable when it pulls you below one of these cliffs.
  const isScotland = settings.tax_region === "scotland";
  const higherCliff = isScotland ? SCOTLAND_HIGHER_RATE_THRESHOLD : RUK_HIGHER_RATE_THRESHOLD;
  const additionalCliff = 125140; // Both regions: top rate / additional rate threshold

  // Within £5k OVER the higher-rate cliff: a small sacrifice pulls you back below
  if (profile.gross_salary > higherCliff && profile.gross_salary <= higherCliff + 5000) {
    const sacrificeNeeded = profile.gross_salary - higherCliff;
    const higherPct = isScotland ? SCOTLAND_HIGHER_RATE_PCT : RUK_HIGHER_RATE_PCT;
    const basicPct = isScotland ? 21 : 20; // Scottish intermediate vs rUK basic
    const savedPerPound = (higherPct - basicPct) / 100 + NI_RATE_MAIN;
    insights.push({
      type: "opportunity", category: "tax", title: "Just Over the Higher-Rate Threshold",
      detail: `Salary of ${fmtFull(profile.gross_salary)} sits just above the £${higherCliff.toLocaleString()} ${isScotland ? "Scottish higher" : "higher"}-rate threshold (${higherPct}%). A pension sacrifice of ${fmtFull(sacrificeNeeded)} would drop you back into the lower band, saving ${higherPct - basicPct}p + NI per £1 sacrificed — about ${fmtFull(Math.round(sacrificeNeeded * savedPerPound))}/year in tax relief. Plus the full amount lands in your pension.`,
      priority: 2,
    });
  }

  // Above the additional-rate cliff: top marginal rate sal-sac is gold
  if (profile.gross_salary > additionalCliff) {
    const topPct = isScotland ? 48 : 45; // Scottish top vs rUK additional
    insights.push({
      type: "opportunity", category: "tax", title: "Additional-Rate Taxpayer",
      detail: `Salary above £${additionalCliff.toLocaleString()} means you pay ${topPct}% marginal income tax on every £ over that. Each £1 of pension sacrifice saves ${topPct}p in income tax plus 2% NI — the highest effective relief available. Combined with the £100k Personal Allowance taper and £260k AA taper, very high earners benefit most from carry-forward + maxed pension contributions. Worth modelling in the Salary Sacrifice tool.`,
      priority: 2,
    });
  }

  // ── Pension access age approaching ───────────────────────────────
  const yearsToAccess = PENSION_ACCESS_AGE - age;
  if (yearsToAccess > 0 && yearsToAccess <= 5) {
    const totalPensions = accounts.filter((a) => INVESTMENT_PENSION_TYPES.has(a.type)).reduce((s, a) => s + a.balance, 0);
    insights.push({
      type: "info", category: "pension", title: `Pension Access in ${yearsToAccess} Year${yearsToAccess === 1 ? "" : "s"}`,
      detail: `Your pensions (${fmtFull(totalPensions)} across all pots) become accessible at age ${PENSION_ACCESS_AGE} (from 2028). Worth reviewing your drawdown strategy now — consider whether to use a tax-free lump sum, phased drawdown, or annuity, and whether to take benefits before or after State Pension age.`,
      priority: 3,
    });
  }

  // ── Deferred pensions ────────────────────────────────────────────
  accounts.filter((a) => (a.type === "PENSION_DC" || a.type === "SIPP") && !a.contributing && a.balance > 10000).forEach((p) => {
    insights.push({
      type: "info", category: "pension", title: `Review Deferred Pension: ${p.name}`,
      detail: `Deferred pension with ${p.provider || "unknown provider"} holds ${fmtFull(p.balance)}. Older schemes often carry higher charges — consolidating into a low-cost SIPP could save significantly over time. Check for exit penalties and any guaranteed benefits (e.g. final salary link) before transferring.`,
      priority: 3,
    });
  });

  // ── Asset concentration ─────────────────────────────────────────
  // Compare against *liquid/financial* assets only — property skews this
  // hugely for anyone with a paid-off home, masking real concentration risk.
  const financialAssets = accounts
    .filter((a) => ASSET_TYPES.has(a.type) && a.type !== "PROPERTY")
    .reduce((s, a) => s + a.balance, 0);
  if (financialAssets > 0) {
    const pensionBal = accounts.filter((a) => INVESTMENT_PENSION_TYPES.has(a.type)).reduce((s, a) => s + a.balance, 0);
    const pensionPct = (pensionBal / financialAssets) * 100;
    if (pensionPct > 85) {
      insights.push({
        type: "info", category: "pension", title: "Heavy Pension Concentration",
        detail: `${Math.round(pensionPct)}% of your financial (non-property) assets are in pensions, inaccessible until age ${PENSION_ACCESS_AGE} (from 2028). Building ISA holdings alongside gives flexibility for early retirement, unexpected expenses, or drawing down before pension access age.`,
        priority: 3,
      });
    }
  }

  // ── Tracker mortgage ─────────────────────────────────────────────
  accounts.filter((a) => a.type === "MORTGAGE" && a.rate_type === "tracker").forEach((m) => {
    insights.push({
      type: "info", category: "mortgage", title: "Mortgage: Tracker Rate Exposure",
      detail: `Your mortgage is on a tracker (${m.interest_rate}%). You benefit automatically from BoE rate cuts but are exposed to increases. Monitor MPC decisions — the next scheduled meeting dates are published on bankofengland.co.uk.`,
      priority: 3,
    });
  });

  // ── Variable rate drift vs BoE base rate ─────────────────────────
  // Trackers usually run at BoE + 0.5–1.5%. SVRs are typically much higher
  // (2–4% above base) and are rarely the best deal. Only fires when we have
  // a BoE rate to compare against (populated when the Rates tab is visited
  // or after the cron snapshot warms the cache).
  if (boe_rate != null) {
    accounts.filter((a) => a.type === "MORTGAGE" && a.interest_rate > 0 && (a.rate_type === "tracker" || a.rate_type === "svr")).forEach((m) => {
      const margin = m.interest_rate - boe_rate;
      const expectedMargin = m.rate_type === "tracker" ? 1.5 : 2.5;
      if (margin > expectedMargin) {
        const yearlyExtra = Math.round(Math.abs(m.balance) * ((margin - expectedMargin) / 100));
        insights.push({
          type: "opportunity", category: "mortgage",
          title: `${m.rate_type === "svr" ? "SVR" : "Tracker"} Rate Above Market: ${m.name}`,
          detail: `Your ${m.rate_type === "svr" ? "SVR" : "tracker"} is at ${m.interest_rate}% — that's BoE+${margin.toFixed(2)}% (BoE base rate ${boe_rate}%). Competitive ${m.rate_type === "svr" ? "fixed-rate deals" : "trackers"} typically run at BoE+${expectedMargin}% or below. Switching could save ~${fmtFull(yearlyExtra)}/year in interest. Worth getting a remortgage quote.`,
          priority: 2,
        });
      }
    });
  }

  // ── Fixed mortgage nearing end ───────────────────────────────────
  accounts.filter((a) => a.type === "MORTGAGE" && a.rate_type === "fixed" && a.fixed_until).forEach((m) => {
    const daysLeft = Math.ceil((new Date(m.fixed_until) - new Date()) / MS_PER_DAY);
    if (daysLeft <= 0) return;
    const monthsLeft = Math.max(1, Math.round(daysLeft / 30.44));
    if (daysLeft <= 183) {
      insights.push({
        type: "warning", category: "mortgage", title: "Mortgage Fix Ending Soon",
        detail: `Your fixed rate ends in ${daysLeft} days (${monthsLeft} month${monthsLeft === 1 ? "" : "s"}). Start shopping for remortgage deals now — most lenders let you lock in a rate up to 6 months ahead, so you can secure today's rate while remaining protected if rates fall further.`,
        priority: 1,
      });
    } else if (daysLeft <= 365) {
      insights.push({
        type: "info", category: "mortgage", title: "Mortgage Fix Ending in Under a Year",
        detail: `Fixed rate ends in ${monthsLeft} months (${m.fixed_until}). Worth starting to review remortgage options in the next 2–3 months to give yourself plenty of time.`,
        priority: 3,
      });
    }
  });

  // ── Mortgage overpayment vs investing ────────────────────────────
  accounts.filter((a) => a.type === "MORTGAGE").forEach((m) => {
    if (m.interest_rate > 0 && m.interest_rate < settings.growth_rate && isaRemaining > 0) {
      insights.push({
        type: "info", category: "mortgage", title: "Mortgage Overpayment vs Investing",
        detail: `Mortgage rate (${m.interest_rate}%) is below your assumed growth rate (${settings.growth_rate}%). Mathematically, investing in an ISA may produce better long-term returns — but overpaying is risk-free, reduces monthly exposure, and can improve LTV for remortgaging. Many do a mix.`,
        priority: 4,
      });
    }
  });

  // ── Property equity & LTV ───────────────────────────────────────
  const properties = accounts.filter((a) => a.type === "PROPERTY");
  if (properties.length > 0) {
    const totalPropertyValue = properties.reduce((s, a) => s + a.balance, 0);
    const mortgages = accounts.filter((a) => a.type === "MORTGAGE");
    const totalMortgageBalance = mortgages.reduce((s, a) => s + Math.abs(a.balance), 0);
    const equity = totalPropertyValue - totalMortgageBalance;
    const ltv = totalPropertyValue > 0 ? (totalMortgageBalance / totalPropertyValue) * 100 : 0;
    if (totalMortgageBalance > 0) {
      const ltvBand = ltv <= 60 ? "≤60% LTV — you likely qualify for the best remortgage rates"
        : ltv <= 75 ? "≤75% LTV — good access to competitive rates"
        : ltv <= 85 ? "≤85% LTV — wider product range available as equity grows"
        : "above 85% LTV — equity growth will unlock better rates over time";
      insights.push({
        type: ltv > 90 ? "info" : "good",
        category: "mortgage", title: "Property Equity",
        detail: `Property value ${fmtFull(totalPropertyValue)} vs mortgage ${fmtFull(totalMortgageBalance)} = ${fmtFull(equity)} equity (${Math.round(100 - ltv)}% owned, ${Math.round(ltv)}% LTV). ${ltvBand}.`,
        priority: 4,
      });

      // ── LTV threshold proximity ────────────────────────────────
      const thresholds = [85, 75, 60];
      for (const threshold of thresholds) {
        const gap = ltv - threshold;
        if (gap > 0 && gap <= 5) {
          const overpayment = Math.round((gap / 100) * totalPropertyValue);
          insights.push({
            type: "opportunity", category: "mortgage", title: `${threshold}% LTV Within Reach`,
            detail: `Current LTV is ${ltv.toFixed(1)}%. An overpayment of ~${fmtFull(overpayment)} would push you below ${threshold}% LTV, potentially unlocking a lower remortgage rate. Check your lender's annual overpayment limit (typically 10% of the balance).`,
            priority: 2,
          });
          break;
        }
      }
    }
  }

  // ── Retirement projection ────────────────────────────────────────
  if (yearsToRetirement > 0 && yearsToRetirement < 30) {
    const totalPensions = accounts.filter((a) => INVESTMENT_PENSION_TYPES.has(a.type)).reduce((s, a) => s + a.balance, 0);
    const realGrowth = (settings.growth_rate - settings.inflation_rate) / 100;
    let projected = totalPensions;
    for (let i = 0; i < yearsToRetirement * 12; i++) projected = projected * (1 + realGrowth / 12) + pensionAnnual / 12;
    let projectedISA = accounts.filter((a) => ISA_TYPES.has(a.type)).reduce((s, a) => s + a.balance, 0);
    for (let i = 0; i < yearsToRetirement * 12; i++) projectedISA = projectedISA * (1 + realGrowth / 12) + isaMonthly;

    const dbAnnual = accounts.filter((a) => a.type === "PENSION_DB").reduce((s, a) => s + (a.db_annual_pension || 0), 0);
    const spAnnual = profile.state_pension_annual || STATE_PENSION_ANNUAL_DEFAULT;
    const totalPot = projected + projectedISA;
    const potDrawdown = totalPot * 0.04;
    // Total guaranteed income once State Pension kicks in (and DB if any)
    const guaranteedAt67 = spAnnual + dbAnnual;
    const totalIncomeAt67 = potDrawdown + guaranteedAt67;

    const guarBreakdown = dbAnnual > 0
      ? `${fmtFull(Math.round(spAnnual))}/yr State Pension + ${fmtFull(Math.round(dbAnnual))}/yr DB pension`
      : `${fmtFull(Math.round(spAnnual))}/yr State Pension`;
    const spNote = profile.retirement_age < STATE_PENSION_AGE
      ? `From age ${STATE_PENSION_AGE}: pot drawdown plus ${guarBreakdown} = ~${fmtFull(Math.round(totalIncomeAt67))}/yr (${fmtFull(Math.round(totalIncomeAt67 / 12))}/mo).`
      : `Plus ${guarBreakdown} from day one = ~${fmtFull(Math.round(totalIncomeAt67))}/yr (${fmtFull(Math.round(totalIncomeAt67 / 12))}/mo).`;

    insights.push({
      type: "info", category: "retirement", title: "Retirement Projection",
      detail: `At age ${profile.retirement_age} (${yearsToRetirement}y): pensions ~${fmtFull(Math.round(projected))}, ISAs ~${fmtFull(Math.round(projectedISA))} (today's money). 4% pot drawdown supports ~${fmtFull(Math.round(potDrawdown))}/year. ${spNote}`,
      priority: 2,
    });

    if (profile.retirement_age < STATE_PENSION_AGE) {
      const gapYears = STATE_PENSION_AGE - profile.retirement_age;
      const bridgeNeeded = (spAnnual + dbAnnual) * gapYears;
      insights.push({
        type: "info", category: "retirement", title: "State Pension Gap",
        detail: `Target retirement (${profile.retirement_age}) is ${gapYears} years before State Pension age (${STATE_PENSION_AGE}). You'll need ~${fmtFull(Math.round(bridgeNeeded))} from your pot to bridge that gap. Factor this into drawdown planning — use the Drawdown Simulator in Projections.`,
        priority: 2,
      });
    }
  }

  // ── Overall savings rate ─────────────────────────────────────────
  if (profile.gross_salary > 0) {
    const savingsMonthly = accounts.filter((a) => a.type === "SAVINGS").reduce((s, a) => s + (a.monthly_contrib || 0), 0);
    const totalAnnualSavings = pensionAnnual + isaAnnual + savingsMonthly * 12;
    const savingsRate = (totalAnnualSavings / profile.gross_salary) * 100;

    if (savingsRate < 10) {
      insights.push({
        type: "warning", category: "general", title: "Low Overall Savings Rate",
        detail: `Total pension + ISA + savings contributions = ${fmtFull(Math.round(totalAnnualSavings))}/year (${savingsRate.toFixed(0)}% of gross). Guidelines suggest 15–20% minimum for a comfortable retirement. Prioritise pension first (tax-free growth + employer match), then ISA.`,
        priority: 2,
      });
    } else if (savingsRate >= 20) {
      insights.push({
        type: "good", category: "general", title: "Strong Savings Rate",
        detail: `Saving ${savingsRate.toFixed(0)}% of gross (${fmtFull(Math.round(totalAnnualSavings))}/year) across pension, ISA, and savings — well above the 15–20% benchmark.`,
        priority: 5,
      });
    } else {
      insights.push({
        type: "info", category: "general", title: "Savings Rate on Track",
        detail: `Saving ${savingsRate.toFixed(0)}% of gross (${fmtFull(Math.round(totalAnnualSavings))}/year) across pension and ISA. Targeting 15–20%+ gives the best chance of a comfortable retirement.`,
        priority: 4,
      });
    }
  }

  // ── Net worth vs age-salary benchmark ───────────────────────────
  if (profile.gross_salary > 0 && age >= 25) {
    const targetMultiples = { 25: 0.5, 30: 1, 35: 2, 40: 3, 45: 4, 50: 5, 55: 6, 60: 7 };
    const bracket = [60, 55, 50, 45, 40, 35, 30, 25].find((b) => age >= b);
    const targetMultiple = targetMultiples[bracket] || 1;
    const target = profile.gross_salary * targetMultiple;
    const ratio = netWorth / target;
    const targetAgeLabel = bracket >= 60 ? "retirement" : `${bracket + 5}`;

    if (ratio < 0.75) {
      insights.push({
        type: "info", category: "general", title: "Net Worth vs Age Benchmark",
        detail: `Rule of thumb: ${targetMultiple}× salary (${fmtFull(target)}) by age ${targetAgeLabel}. Current net worth ${fmtFull(netWorth)} is at ${Math.round(ratio * 100)}% of that target. These are rough guides — your actual number depends on target retirement income, not just age.`,
        priority: 4,
      });
    } else if (ratio >= 1.0) {
      insights.push({
        type: "good", category: "general", title: "Ahead of Net Worth Benchmark",
        detail: `Net worth ${fmtFull(netWorth)} meets or exceeds the ${targetMultiple}× salary (${fmtFull(target)}) rule-of-thumb for age ${age}. On track by this measure.`,
        priority: 5,
      });
    }
  }

  // ── Net worth velocity ──────────────────────────────────────────
  if (snapshots && snapshots.length >= 3) {
    const sorted = [...snapshots].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const latest = sorted[sorted.length - 1];
    const earlier = sorted[Math.max(0, sorted.length - 4)];
    const span = Math.max(1, sorted.length - Math.max(0, sorted.length - 4));
    const velocity = (latest.net_worth - earlier.net_worth) / span;

    if (velocity > 0) {
      const months2zero = netWorth < 0 ? Math.ceil(Math.abs(netWorth) / velocity) : null;
      insights.push({
        type: "good", category: "general", title: "Net Worth Trend",
        detail: `Growing at ~${fmtFull(Math.round(velocity))}/month over the last ${span} snapshots.${months2zero ? ` At this rate, you'll be net positive in ~${months2zero} months.` : ""}`,
        priority: 4,
      });
    } else if (velocity < -100) {
      insights.push({
        type: "warning", category: "general", title: "Net Worth Declining",
        detail: `Net worth falling at ~${fmtFull(Math.round(Math.abs(velocity)))}/month. Review spending and contribution levels.`,
        priority: 1,
      });
    }
  }

  return insights.sort((a, b) => a.priority - b.priority);
}

export { ASSET_TYPES, LIABILITY_TYPES, fmtFull, ageFromDob };
