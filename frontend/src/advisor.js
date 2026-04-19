/**
 * Advisor Engine — UK-specific financial insights.
 * Rule-based analysis, not regulated advice.
 *
 * Each insight: { type, category, title, detail, priority }
 *   type:     "warning" | "opportunity" | "good" | "info"
 *   category: "isa" | "pension" | "mortgage" | "debt" | "savings" | "retirement" | "general"
 *   priority: 1 (highest) → 5 (lowest)
 */

const ASSET_TYPES = new Set(["PENSION_DC", "SIPP", "ISA_SS", "ISA_CASH", "CURRENT", "SAVINGS", "PROPERTY"]);
const LIABILITY_TYPES = new Set(["MORTGAGE", "CREDIT_CARD", "LOAN"]);

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

export function generateInsights({ profile, accounts, settings, snapshots }) {
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

  // ── Pension headroom ─────────────────────────────────────────────
  const pensionAnnual = profile.gross_salary * ((profile.pension_contrib_pct + profile.employer_contrib_pct) / 100);
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
  const higherRateThreshold = taxRegion === "scotland" ? 43662 : 50270;
  const higherRatePct = taxRegion === "scotland" ? 42 : 40;
  const bandDesc = taxRegion === "scotland" ? "Scottish higher-rate band (42%)" : "higher-rate band (40%)";
  if (profile.gross_salary > higherRateThreshold && profile.pension_contrib_pct < 15) {
    const currentSacrifice = profile.gross_salary * (profile.pension_contrib_pct / 100);
    const toThreshold = profile.gross_salary - higherRateThreshold - currentSacrifice;
    if (toThreshold > 0) {
      const extraContrib = Math.min(toThreshold, 20000);
      // Combined saving: higher-rate income tax + employee NI (8% up to UEL)
      const combinedSavingRate = (higherRatePct + 8) / 100;
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
  if (profile.gross_salary > 100000) {
    const taperAmount = Math.min(profile.gross_salary - 100000, 25140);
    const paLost = Math.round(taperAmount / 2);
    insights.push({
      type: "warning", category: "general", title: "Personal Allowance Taper",
      detail: `Gross salary of ${fmtFull(profile.gross_salary)} triggers the PA taper — you lose £1 of personal allowance for every £2 over £100,000, creating a ~60% effective marginal rate. You've lost ~${fmtFull(paLost)} of your PA. Salary sacrificing down to £100,000 would fully restore it and could be worth ${fmtFull(Math.round(paLost * 0.42))} in additional tax relief.`,
      priority: 1,
    });
  }

  // ── Pension access age approaching ───────────────────────────────
  const pensionAccessAge = 57;
  const yearsToAccess = pensionAccessAge - age;
  if (yearsToAccess > 0 && yearsToAccess <= 5) {
    const totalPensions = accounts.filter((a) => a.type === "PENSION_DC" || a.type === "SIPP").reduce((s, a) => s + a.balance, 0);
    insights.push({
      type: "info", category: "pension", title: `Pension Access in ${yearsToAccess} Year${yearsToAccess === 1 ? "" : "s"}`,
      detail: `Your pensions (${fmtFull(totalPensions)} across all pots) become accessible at age 57 (from 2028). Worth reviewing your drawdown strategy now — consider whether to use a tax-free lump sum, phased drawdown, or annuity, and whether to take benefits before or after State Pension age.`,
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
  if (totalAssets > 0) {
    const pensionPct = (accounts.filter((a) => a.type === "PENSION_DC" || a.type === "SIPP").reduce((s, a) => s + a.balance, 0) / totalAssets) * 100;
    if (pensionPct > 85) {
      insights.push({
        type: "info", category: "pension", title: "Heavy Pension Concentration",
        detail: `${Math.round(pensionPct)}% of assets are in pensions (inaccessible until age 57 from 2028). Building ISA holdings alongside gives flexibility for early retirement, unexpected expenses, or drawing down before pension access age.`,
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

  // ── Fixed mortgage nearing end ───────────────────────────────────
  accounts.filter((a) => a.type === "MORTGAGE" && a.rate_type === "fixed" && a.fixed_until).forEach((m) => {
    const monthsLeft = (new Date(m.fixed_until).getFullYear() - new Date().getFullYear()) * 12 + (new Date(m.fixed_until).getMonth() - new Date().getMonth());
    if (monthsLeft > 0 && monthsLeft <= 6) {
      insights.push({
        type: "warning", category: "mortgage", title: "Mortgage Fix Ending Soon",
        detail: `Your fixed rate ends in ${monthsLeft} month${monthsLeft > 1 ? "s" : ""}. Start shopping for remortgage deals now — most lenders let you lock in a rate up to 6 months ahead, so you can secure today's rate while remaining protected if rates fall further.`,
        priority: 1,
      });
    } else if (monthsLeft > 6 && monthsLeft <= 12) {
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
    const totalPensions = accounts.filter((a) => a.type === "PENSION_DC" || a.type === "SIPP").reduce((s, a) => s + a.balance, 0);
    const realGrowth = (settings.growth_rate - settings.inflation_rate) / 100;
    let projected = totalPensions;
    for (let i = 0; i < yearsToRetirement * 12; i++) projected = projected * (1 + realGrowth / 12) + pensionAnnual / 12;
    let projectedISA = accounts.filter((a) => a.type === "ISA_SS" || a.type === "ISA_CASH").reduce((s, a) => s + a.balance, 0);
    for (let i = 0; i < yearsToRetirement * 12; i++) projectedISA = projectedISA * (1 + realGrowth / 12) + isaMonthly;

    const totalPot = projected + projectedISA;
    const annualDrawdown = totalPot * 0.04;
    insights.push({
      type: "info", category: "retirement", title: "Retirement Projection",
      detail: `At age ${profile.retirement_age} (${yearsToRetirement}y): pensions ~${fmtFull(Math.round(projected))}, ISAs ~${fmtFull(Math.round(projectedISA))} (today's money). 4% drawdown supports ~${fmtFull(Math.round(annualDrawdown))}/year (${fmtFull(Math.round(annualDrawdown / 12))}/month).`,
      priority: 2,
    });

    if (profile.retirement_age < 67) {
      const gapYears = 67 - profile.retirement_age;
      const spAnnual = profile.state_pension_annual || 11500;
      insights.push({
        type: "info", category: "retirement", title: "State Pension Gap",
        detail: `Target retirement (${profile.retirement_age}) is ${gapYears} years before State Pension age (67). You'll need ~${fmtFull(Math.round(spAnnual * gapYears))} to bridge that gap (${fmtFull(spAnnual)}/year from pot). Factor this into drawdown planning — use the Drawdown Simulator in Projections.`,
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

    if (ratio < 0.75) {
      insights.push({
        type: "info", category: "general", title: "Net Worth vs Age Benchmark",
        detail: `Rule of thumb: ${targetMultiple}× salary (${fmtFull(target)}) by age ${bracket + 5 > 60 ? "retirement" : bracket + 5}. Current net worth ${fmtFull(netWorth)} is at ${Math.round(ratio * 100)}% of that target. These are rough guides — your actual number depends on target retirement income, not just age.`,
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
