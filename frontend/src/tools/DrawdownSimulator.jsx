import { useState, useMemo, useCallback } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { T, Field, fmt, ttStyle, ttItemStyle, ttLabelStyle } from "../ui.jsx";
import { fmtFull } from "../advisor.js";

export default function DrawdownSimulator({ retirementPot, profile, settings, dbAnnualPension = 0 }) {
  const spAnnual = (profile.state_pension_annual || 11500) + dbAnnualPension;
  const realGrowth = Math.max(0, settings.growth_rate - settings.inflation_rate) / 100;
  const defaultMonthly = retirementPot > 0 ? Math.max(500, Math.round(retirementPot * 0.04 / 12)) : 2500;
  const [monthlySpend, setMonthlySpend] = useState(defaultMonthly);

  const simulate = useCallback((monthly) => {
    if (retirementPot <= 0) return [];
    const pts = [];
    let balance = retirementPot;
    const annualSpend = monthly * 12;
    for (let a = profile.retirement_age; a <= 100; a++) {
      const sp = a >= 67 ? spAnnual : 0;
      pts.push({ age: a, balance: Math.max(0, Math.round(balance)) });
      if (balance <= 0) break;
      balance = balance * (1 + realGrowth) - Math.max(0, annualSpend - sp);
    }
    return pts;
  }, [retirementPot, profile.retirement_age, spAnnual, realGrowth]);

  const mainData = useMemo(() => simulate(monthlySpend), [simulate, monthlySpend]);
  const depletes = mainData.find((p) => p.balance === 0);
  const depletionAge = depletes?.age;
  const lastBalance = mainData[mainData.length - 1]?.balance || 0;

  // Three spending scenarios for comparison table
  const scenarios = useMemo(() => {
    const levels = [
      { label: "Lean", monthly: Math.round(monthlySpend * 0.75) },
      { label: "Base", monthly: monthlySpend },
      { label: "Comfortable", monthly: Math.round(monthlySpend * 1.25) },
    ];
    return levels.map(({ label, monthly }) => {
      const data = simulate(monthly);
      const dep = data.find((p) => p.balance === 0);
      const pot100 = data[data.length - 1]?.balance || 0;
      return { label, monthly, depletionAge: dep?.age, potAt100: pot100 };
    });
  }, [simulate, monthlySpend]);

  const spStartsAt = profile.retirement_age < 67 ? 67 : null;

  if (retirementPot <= 0) {
    return (
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 6px" }}>Drawdown Simulator</h3>
        <p style={{ fontSize: 12, color: T.textDim, margin: 0 }}>Add pension and ISA accounts to simulate the withdrawal phase.</p>
      </div>
    );
  }

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 3px" }}>Drawdown Simulator</h3>
      <p style={{ fontSize: 10.5, color: T.textDim, margin: "0 0 16px" }}>
        Pot balance from retirement (age {profile.retirement_age}) · Today's money · {fmtFull(spAnnual)}/yr guaranteed income at 67 reduces pot withdrawals{dbAnnualPension > 0 ? ` (SP + DB pension)` : ""}
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 16, flexWrap: "wrap" }}>
        <Field label="Monthly Spending in Retirement" type="number" value={monthlySpend}
          onChange={(v) => setMonthlySpend(Math.max(0, v))} prefix="£" />
        <div style={{ flex: "1 1 200px", paddingBottom: 2 }}>
          <div style={{ fontSize: 10.5, color: T.textDim }}>
            = {fmtFull(monthlySpend * 12)}/year · {fmtFull(Math.max(0, monthlySpend * 12 - spAnnual))}/year from pot after State Pension
          </div>
        </div>
      </div>

      {/* Pot balance chart */}
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={mainData}>
          <defs>
            <linearGradient id="ddG" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={T.purple} stopOpacity={0.3} />
              <stop offset="100%" stopColor={T.purple} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={T.border} />
          <XAxis dataKey="age" tick={{ fontSize: 10.5, fill: T.textDim }} label={{ value: "Age", position: "insideBottomRight", offset: -4, fill: T.textDim, fontSize: 10.5 }} />
          <YAxis tick={{ fontSize: 10.5, fill: T.textDim }} tickFormatter={fmt} />
          <Tooltip contentStyle={ttStyle()} itemStyle={ttItemStyle()} labelStyle={ttLabelStyle()}
            formatter={(v) => fmtFull(v)} labelFormatter={(v) => `Age ${v}`} />
          <Area isAnimationActive={false} type="monotone" dataKey="balance" name="Pot Balance" stroke={T.purple} fill="url(#ddG)" strokeWidth={2} dot={false} />
          {spStartsAt && (
            <ReferenceLine x={spStartsAt} stroke={T.amber} strokeDasharray="4 3" strokeWidth={1.5}
              label={{ value: `SP age ${spStartsAt}`, fill: T.amber, fontSize: 10.5, position: "insideTopRight" }} />
          )}
          {depletionAge && (
            <ReferenceLine x={depletionAge} stroke={T.red} strokeDasharray="4 3" strokeWidth={1.5}
              label={{ value: `Depletes ${depletionAge}`, fill: T.red, fontSize: 10.5, position: "insideTopLeft" }} />
          )}
        </AreaChart>
      </ResponsiveContainer>

      {/* Key metrics */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "16px 0" }}>
        {[
          depletionAge
            ? { label: "Pot depletes at age", value: depletionAge, color: T.red, sub: `${depletionAge - profile.retirement_age} years of drawdown` }
            : { label: "Pot at age 100", value: fmtFull(lastBalance), color: T.green, sub: "Survives full retirement" },
          { label: "Self-funded years (pre-SP)", value: spStartsAt ? `${67 - profile.retirement_age}y` : "N/A", color: T.amber, sub: `Ages ${profile.retirement_age}–67` },
          { label: "Annual spend from pot (post-SP)", value: fmtFull(Math.max(0, monthlySpend * 12 - spAnnual)), color: T.blue, sub: `After ${fmtFull(spAnnual)}/yr State Pension` },
          { label: "Total monthly income at 67+", value: fmtFull(monthlySpend), color: T.accent, sub: `Pot + SP combined` },
        ].map((m, i) => (
          <div key={i} style={{ flex: "1 1 160px", padding: "10px 12px", background: T.bg, borderRadius: T.radius, border: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 10.5, color: T.textMuted, marginBottom: 3, textTransform: "uppercase", fontWeight: 500 }}>{m.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: m.color, fontFamily: T.mono }}>{m.value}</div>
            <div style={{ fontSize: 10.5, color: T.textDim, marginTop: 2 }}>{m.sub}</div>
          </div>
        ))}
      </div>

      {/* Spending scenarios comparison */}
      <div>
        <div style={{ fontSize: 10.5, color: T.textDim, marginBottom: 8, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Spending scenarios</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {scenarios.map((s) => (
            <div key={s.label} style={{
              flex: "1 1 140px", padding: "10px 12px", background: T.bg, borderRadius: T.radius,
              border: `1px solid ${s.depletionAge ? T.red + "44" : T.green + "44"}`,
            }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: T.textMuted, marginBottom: 2 }}>{s.label}</div>
              <div style={{ fontSize: 13, fontFamily: T.mono, fontWeight: 600 }}>{fmtFull(s.monthly)}/mo</div>
              <div style={{ fontSize: 10.5, color: s.depletionAge ? T.red : T.green, marginTop: 4 }}>
                {s.depletionAge ? `Depletes age ${s.depletionAge}` : `Pot survives to 100+`}
              </div>
              {!s.depletionAge && <div style={{ fontSize: 10.5, color: T.textDim }}>Remaining: {fmtFull(s.potAt100)}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
