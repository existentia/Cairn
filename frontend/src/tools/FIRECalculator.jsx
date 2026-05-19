import { useState, useMemo } from "react";
import { T, Field } from "../ui.jsx";
import { ASSET_TYPES, fmtFull, ageFromDob } from "../advisor.js";

export default function FIRECalculator({ profile, accounts, settings, netWorth }) {
  const defaultExpenses = Math.round(Math.max(1500, (profile.gross_salary * 0.55) / 12));
  const [annualExpenses, setAnnualExpenses] = useState(defaultExpenses * 12);
  const [swr, setSwr] = useState(4);

  const realGrowthRate = Math.max(0, (settings.growth_rate - settings.inflation_rate)) / 100;
  const monthlyRealGrowth = realGrowthRate / 12;

  const monthlySavings = accounts
    .filter((a) => ASSET_TYPES.has(a.type))
    .reduce((s, a) => s + (a.monthly_contrib || 0), 0)
    + (profile.gross_salary * ((profile.pension_contrib_pct + profile.employer_contrib_pct) / 100)) / 12;

  const fireNumber = swr > 0 ? Math.round(annualExpenses / (swr / 100)) : 0;
  const progress = fireNumber > 0 ? Math.min(100, (netWorth / fireNumber) * 100) : 0;

  // Years to FIRE (iterative: monthly compound)
  const yearsToFIRE = useMemo(() => {
    if (netWorth >= fireNumber) return 0;
    if (monthlySavings <= 0 && netWorth <= 0) return null;
    let pot = netWorth;
    for (let m = 0; m <= 12 * 60; m++) {
      if (pot >= fireNumber) return m / 12;
      pot = pot * (1 + monthlyRealGrowth) + monthlySavings;
    }
    return null; // > 60 years
  }, [netWorth, fireNumber, monthlySavings, monthlyRealGrowth]);

  const fireDate = yearsToFIRE != null
    ? new Date(Date.now() + yearsToFIRE * 365.25 * 24 * 3600 * 1000).getFullYear()
    : null;

  // Coast FIRE: pot needed now to grow to fireNumber by retirement_age without contributions
  const age = ageFromDob(profile.dob);
  const yearsToRetirement = Math.max(0, profile.retirement_age - age);
  const coastFIRE = yearsToRetirement > 0 && fireNumber > 0
    ? Math.round(fireNumber / Math.pow(1 + realGrowthRate, yearsToRetirement))
    : fireNumber;
  const hasCoasted = netWorth >= coastFIRE;

  // Spending scenarios
  const scenarios = [
    { label: "Lean FIRE", swr: 5, factor: 0.7 },
    { label: "Regular FIRE", swr: 4, factor: 1.0 },
    { label: "Fat FIRE", swr: 3.5, factor: 1.3 },
  ].map(({ label, swr: s, factor }) => {
    const target = Math.round((annualExpenses * factor) / (s / 100));
    const prog = Math.min(100, (netWorth / target) * 100);
    return { label, swr: s, annualSpend: Math.round(annualExpenses * factor), target, progress: prog };
  });

  const ProgressBar = ({ value, color = T.accent }) => (
    <div style={{ height: 6, background: T.border, borderRadius: 3, overflow: "hidden", marginTop: 6 }}>
      <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, value))}%`, background: color, borderRadius: 3, transition: "width 0.4s ease" }} />
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Inputs */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 4px" }}>FIRE Calculator</h3>
        <p style={{ fontSize: 11.5, color: T.textDim, margin: "0 0 16px" }}>
          Financial Independence, Retire Early — find the portfolio size that funds your retirement indefinitely.
          Based on the safe withdrawal rate (SWR) concept: FIRE number = annual expenses ÷ SWR.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Field label="Annual Expenses in Retirement" type="number" value={annualExpenses} onChange={setAnnualExpenses} prefix="£" />
          <Field label="Safe Withdrawal Rate" type="number" value={swr} onChange={setSwr} suffix="%" small />
          <div style={{ flex: "1 1 180px", display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
            <span style={{ fontSize: 11, color: T.textDim, lineHeight: 1.5 }}>
              4% is the classic Trinity Study rate. 3.5% is more conservative; 5% works for shorter retirements.
            </span>
          </div>
        </div>
      </div>

      {/* Key metrics */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {[
          { label: "FIRE Number", value: fmtFull(fireNumber), color: T.accent, sub: `${swr}% SWR on ${fmtFull(annualExpenses)}/yr` },
          { label: "Current Progress", value: `${progress.toFixed(1)}%`, color: progress >= 100 ? T.green : T.blue, sub: `${fmtFull(netWorth)} of ${fmtFull(fireNumber)}` },
          yearsToFIRE === 0
            ? { label: "Status", value: "FIRE! 🔥", color: T.green, sub: "Net worth exceeds FIRE number" }
            : yearsToFIRE != null
              ? { label: "Years to FIRE", value: `${yearsToFIRE.toFixed(1)}y`, color: T.amber, sub: fireDate ? `Estimated ${fireDate}` : "" }
              : { label: "Years to FIRE", value: ">60y", color: T.red, sub: "Increase savings or reduce target" },
          { label: "Coast FIRE", value: fmtFull(coastFIRE), color: hasCoasted ? T.green : T.purple,
            sub: hasCoasted ? "Already coasted — growth alone will do it" : `${yearsToRetirement}y of growth needed` },
        ].map((m, i) => (
          <div key={i} style={{ flex: "1 1 160px", padding: "12px 14px", background: T.surface, borderRadius: T.radius, border: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 10.5, color: T.textMuted, marginBottom: 4, textTransform: "uppercase", fontWeight: 500 }}>{m.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: m.color, fontFamily: T.mono }}>{m.value}</div>
            <div style={{ fontSize: 10.5, color: T.textDim, marginTop: 2 }}>{m.sub}</div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: T.textMuted }}>Progress to FIRE</span>
          <span style={{ fontSize: 12, fontWeight: 600, fontFamily: T.mono, color: T.accent }}>{progress.toFixed(1)}%</span>
        </div>
        <ProgressBar value={progress} color={progress >= 100 ? T.green : T.accent} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
          <span style={{ fontSize: 10.5, color: T.textDim }}>{fmtFull(netWorth)} today</span>
          <span style={{ fontSize: 10.5, color: T.textDim }}>{fmtFull(fireNumber)} target</span>
        </div>

        {/* Coast FIRE marker */}
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: T.textMuted }}>Coast FIRE progress</span>
            <span style={{ fontSize: 12, fontWeight: 600, fontFamily: T.mono, color: hasCoasted ? T.green : T.purple }}>
              {Math.min(100, (netWorth / coastFIRE) * 100).toFixed(1)}%
            </span>
          </div>
          <ProgressBar value={(netWorth / coastFIRE) * 100} color={hasCoasted ? T.green : T.purple} />
          <div style={{ fontSize: 10.5, color: T.textDim, marginTop: 4 }}>
            Coast FIRE means your pot (at {fmtFull(coastFIRE)}) would grow to your FIRE number by retirement age {profile.retirement_age} with no further pension/ISA contributions — assuming you still cover day-to-day living costs from earnings until then.
          </div>
        </div>
      </div>

      {/* Scenarios comparison */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
        <h4 style={{ fontSize: 12, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 14px" }}>Spending Scenarios</h4>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {scenarios.map((s) => (
            <div key={s.label} style={{
              flex: "1 1 180px", padding: "14px 16px", background: T.bg, borderRadius: T.radius,
              border: `1px solid ${s.label === "Regular FIRE" ? T.accent + "44" : T.border}`,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.textMuted, marginBottom: 2 }}>{s.label}</div>
              <div style={{ fontSize: 11, color: T.textDim, marginBottom: 8 }}>{s.swr}% SWR · {fmtFull(s.annualSpend)}/yr</div>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: T.mono, color: T.accent }}>{fmtFull(s.target)}</div>
              <ProgressBar value={s.progress} color={s.progress >= 100 ? T.green : T.accent} />
              <div style={{ fontSize: 10.5, color: T.textDim, marginTop: 4 }}>{s.progress.toFixed(1)}% there</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, fontSize: 11, color: T.textDim, lineHeight: 1.6 }}>
          Monthly savings used in projection: <strong style={{ color: T.textMuted }}>{fmtFull(Math.round(monthlySavings))}/month</strong> ·
          Real growth rate: <strong style={{ color: T.textMuted }}>{(realGrowthRate * 100).toFixed(1)}%</strong> (after {settings.inflation_rate}% inflation)
        </div>
      </div>
    </div>
  );
}
