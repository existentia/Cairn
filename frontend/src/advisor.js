/**
 * Advisor Engine — UK-specific financial insights.
 * Rule-based analysis, not regulated advice.
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
      type: "opportunity", title: "ISA Allowance Headroom",
      detail: `You're using ${fmtFull(isaAnnual)} of your ${fmtFull(settings.isa_allowance)} ISA allowance. That leaves ${fmtFull(isaRemaining)} of tax-free space. Increasing monthly contributions by ${fmtFull(Math.round(isaRemaining / 12))} would max it out.`,
      priority: 2,
    });
  } else if (isaRemaining > 0 && isaRemaining <= 5000) {
    insights.push({ type: "good", title: "ISA Allowance Nearly Maxed", detail: `Only ${fmtFull(isaRemaining)} of your ISA allowance remaining — well done.`, priority: 4 });
  } else if (isaRemaining <= 0) {
    insights.push({ type: "good", title: "ISA Allowance Maxed", detail: `You've maxed your ${fmtFull(settings.isa_allowance)} ISA allowance this tax year.`, priority: 5 });
  }

  // ── ISA tax year countdown ───────────────────────────────────────
  const daysLeft = daysUntilTaxYearEnd();
  if (daysLeft <= 90 && isaRemaining > 1000) {
    const monthsLeft = Math.max(1, Math.floor(daysLeft / 30));
    insights.push({
      type: "warning", title: `ISA Deadline: ${daysLeft} Days Remaining`,
      detail: `Tax year ends 5 April. ${fmtFull(isaRemaining)} unused ISA allowance — use it or lose it. That's ${fmtFull(Math.round(isaRemaining / monthsLeft))}/month for ${monthsLeft} month${monthsLeft > 1 ? "s" : ""}, or a lump sum.`,
      priority: 1,
    });
  }

  // ── Credit card / high-interest debt ─────────────────────────────
  accounts.filter((a) => a.type === "CREDIT_CARD").forEach((cc) => {
    if (Math.abs(cc.balance) > 0 && cc.interest_rate > 15) {
      const monthlyInterest = Math.abs(cc.balance) * (cc.interest_rate / 100 / 12);
      insights.push({
        type: "warning", title: `High-Interest Debt: ${cc.name}`,
        detail: `${fmtFull(Math.abs(cc.balance))} at ${cc.interest_rate}% APR costs ~${fmtFull(Math.round(monthlyInterest))}/month (${fmtFull(Math.round(monthlyInterest * 12))}/year) in interest. Clearing this gives a guaranteed ${cc.interest_rate}% return. Consider a 0% balance transfer card to buy time.`,
        priority: 1,
      });
    }
  });

  // ── Emergency fund ───────────────────────────────────────────────
  const liquidCash = accounts.filter((a) => a.type === "CURRENT" || a.type === "SAVINGS").reduce((s, a) => s + a.balance, 0);
  const monthlyExpenses = profile.gross_salary > 0 ? (profile.gross_salary * 0.65) / 12 : 2500;
  const monthsCover = liquidCash / monthlyExpenses;

  if (monthsCover < 3) {
    insights.push({
      type: "warning", title: "Emergency Fund Below Target",
      detail: `Liquid cash (${fmtFull(liquidCash)}) covers ~${monthsCover.toFixed(1)} months. Target: 3-6 months (${fmtFull(Math.round(monthlyExpenses * 3))} – ${fmtFull(Math.round(monthlyExpenses * 6))}). Consider pausing ISA contributions until this is built up.`,
      priority: 1,
    });
  } else if (monthsCover >= 3 && monthsCover < 6) {
    insights.push({ type: "info", title: "Emergency Fund Adequate", detail: `${fmtFull(liquidCash)} covers ~${monthsCover.toFixed(1)} months. Within the 3-6 month target range.`, priority: 4 });
  } else if (monthsCover >= 12) {
    insights.push({
      type: "opportunity", title: "Excess Cash Holdings",
      detail: `${fmtFull(liquidCash)} covers ${monthsCover.toFixed(0)} months — well beyond the 6-month target. The excess ${fmtFull(Math.round(liquidCash - monthlyExpenses * 6))} could work harder in an ISA or pension.`,
      priority: 3,
    });
  }

  // ── Pension headroom ─────────────────────────────────────────────
  const pensionAnnual = profile.gross_salary * ((profile.pension_contrib_pct + profile.employer_contrib_pct) / 100);
  const pensionHeadroom = settings.pension_annual_allowance - pensionAnnual;

  if (pensionHeadroom > 20000) {
    insights.push({
      type: "info", title: "Pension Contribution Headroom",
      detail: `Total contributions ~${fmtFull(Math.round(pensionAnnual))}/year against ${fmtFull(settings.pension_annual_allowance)} allowance. ${fmtFull(Math.round(pensionHeadroom))} headroom. Salary sacrifice above the higher-rate threshold saves both Income Tax and NI.`,
      priority: 3,
    });
  }

  // ── Salary sacrifice opportunity ─────────────────────────────────
  if (profile.gross_salary > 43662 && profile.pension_contrib_pct < 15) {
    const currentSacrifice = profile.gross_salary * (profile.pension_contrib_pct / 100);
    const toThreshold = profile.gross_salary - 43662 - currentSacrifice;
    if (toThreshold > 0) {
      const extraContrib = Math.min(toThreshold, 20000);
      const totalSaved = extraContrib * 0.50; // ~42% tax + 8% NI
      const takeHomeReduction = extraContrib - totalSaved;
      insights.push({
        type: "opportunity", title: "Salary Sacrifice Optimisation",
        detail: `You're in the Scottish higher-rate band (42%). An extra ${fmtFull(Math.round(extraContrib))}/year via salary sacrifice would cost only ${fmtFull(Math.round(takeHomeReduction))}/year in take-home (${fmtFull(Math.round(takeHomeReduction / 12))}/month) while adding ${fmtFull(Math.round(extraContrib))} to your pension. Use the Salary Sacrifice tool to model exact figures.`,
        priority: 2,
      });
    }
  }

  // ── Tracker mortgage ─────────────────────────────────────────────
  accounts.filter((a) => a.type === "MORTGAGE" && a.rate_type === "tracker").forEach((m) => {
    insights.push({
      type: "info", title: "Mortgage: Tracker Rate Exposure",
      detail: `Your mortgage is on a tracker (${m.interest_rate}%). You benefit from rate cuts but are exposed to increases. Monitor BoE base rate decisions.`,
      priority: 3,
    });
  });

  // ── Fixed mortgage nearing end ───────────────────────────────────
  accounts.filter((a) => a.type === "MORTGAGE" && a.rate_type === "fixed" && a.fixed_until).forEach((m) => {
    const monthsLeft = (new Date(m.fixed_until).getFullYear() - new Date().getFullYear()) * 12 + (new Date(m.fixed_until).getMonth() - new Date().getMonth());
    if (monthsLeft > 0 && monthsLeft <= 6) {
      insights.push({
        type: "warning", title: "Mortgage Fix Ending Soon",
        detail: `Your fixed rate ends in ${monthsLeft} month${monthsLeft > 1 ? "s" : ""}. Start shopping for remortgage deals now — lock in a rate 3-6 months ahead.`,
        priority: 1,
      });
    }
  });

  // ── Mortgage overpayment vs investing ────────────────────────────
  accounts.filter((a) => a.type === "MORTGAGE").forEach((m) => {
    if (m.interest_rate > 0 && m.interest_rate < settings.growth_rate && isaRemaining > 0) {
      insights.push({
        type: "info", title: "Mortgage Overpayment vs Investing",
        detail: `Mortgage rate (${m.interest_rate}%) is below your assumed growth rate (${settings.growth_rate}%). Investing in an ISA may produce better long-term returns, though overpaying offers guaranteed savings and reduces risk.`,
        priority: 4,
      });
    }
  });

  // ── Property equity ─────────────────────────────────────────────
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
        title: "Property Equity",
        detail: `Property value ${fmtFull(totalPropertyValue)} vs mortgage ${fmtFull(totalMortgageBalance)} = ${fmtFull(equity)} equity (${Math.round(100 - ltv)}% owned, ${Math.round(ltv)}% LTV). ${ltvBand}.`,
        priority: 4,
      });
    }
  }

  // ── Deferred pensions ────────────────────────────────────────────
  accounts.filter((a) => (a.type === "PENSION_DC" || a.type === "SIPP") && !a.contributing && a.balance > 10000).forEach((p) => {
    insights.push({
      type: "info", title: `Review: ${p.name}`,
      detail: `Deferred pension with ${p.provider || "unknown provider"} holds ${fmtFull(p.balance)}. Older schemes often have higher charges — consolidating could save on fees. Check for exit penalties and guaranteed benefits first.`,
      priority: 3,
    });
  });

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
      type: "info", title: "Retirement Projection",
      detail: `At age ${profile.retirement_age} (${yearsToRetirement}y): pensions ~${fmtFull(Math.round(projected))}, ISAs ~${fmtFull(Math.round(projectedISA))} (today's money). 4% drawdown supports ~${fmtFull(Math.round(annualDrawdown))}/year (${fmtFull(Math.round(annualDrawdown / 12))}/month).`,
      priority: 2,
    });

    if (profile.retirement_age < 67) {
      const gapYears = 67 - profile.retirement_age;
      insights.push({
        type: "info", title: "State Pension Gap",
        detail: `Target retirement (${profile.retirement_age}) is ${gapYears} years before State Pension age (67). You'll need ~${fmtFull(11500 * gapYears)} to bridge that gap (£11,500/year). Factor this into drawdown planning.`,
        priority: 2,
      });
    }
  }

  // ── Debt vs investment priority ──────────────────────────────────
  const highInterestDebt = accounts.filter((a) => LIABILITY_TYPES.has(a.type) && a.type !== "MORTGAGE" && a.interest_rate > 5).reduce((s, a) => s + Math.abs(a.balance), 0);
  if (highInterestDebt > 0 && isaMonthly > 0) {
    insights.push({
      type: "opportunity", title: "Debt vs Investment Priority",
      detail: `${fmtFull(highInterestDebt)} in non-mortgage debt at rates above 5%. Redirecting investment contributions to clear this first delivers a better guaranteed return.`,
      priority: 1,
    });
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
        type: "good", title: "Net Worth Trend",
        detail: `Growing at ~${fmtFull(Math.round(velocity))}/month over the last ${span} snapshots.${months2zero ? ` At this rate, you'll be net positive in ~${months2zero} months.` : ""}`,
        priority: 4,
      });
    } else if (velocity < -100) {
      insights.push({
        type: "warning", title: "Net Worth Declining",
        detail: `Net worth falling at ~${fmtFull(Math.round(Math.abs(velocity)))}/month. Review spending and contribution levels.`,
        priority: 1,
      });
    }
  }

  // ── Asset concentration ─────────────────────────────────────────
  if (totalAssets > 0) {
    const pensionPct = (accounts.filter(a => a.type === "PENSION_DC" || a.type === "SIPP").reduce((s, a) => s + a.balance, 0) / totalAssets) * 100;
    if (pensionPct > 85) {
      insights.push({
        type: "info", title: "Heavy Pension Concentration",
        detail: `${Math.round(pensionPct)}% of assets are in pensions (inaccessible until age 57 from 2028). Building ISA holdings gives flexibility for early retirement or emergencies.`,
        priority: 3,
      });
    }
  }

  return insights.sort((a, b) => a.priority - b.priority);
}

export { ASSET_TYPES, LIABILITY_TYPES, fmtFull, ageFromDob };
