import { useState, useMemo } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import { T, Field, Select, fmt, ttStyle, ttItemStyle, ttLabelStyle } from "../ui.jsx";
import {
  STATE_PENSION_ANNUAL_DEFAULT, PENSION_ACCESS_AGE, SCOTLAND_BANDS, RUK_BANDS, statePensionAge,
} from "../constants.js";
import { fmtFull } from "../advisor.js";
import { simulateDrawdown, monteCarloDrawdown } from "../drawdown.js";

const SUCCESS_AGE = 95;
const VOLATILITY_OPTIONS = [
  { value: "8", label: "Cautious (8%)" },
  { value: "12", label: "Balanced (12%)" },
  { value: "16", label: "Equity-heavy (16%)" },
];

/**
 * Withdrawal-phase model. The maths lives in ../drawdown.js: separate pension
 * and ISA pots, income tax on pension withdrawals (25% tax-free), the pension
 * access age, and a Monte Carlo run over random market returns.
 */
export default function DrawdownSimulator({ pensionPot, isaPot, profile, settings, dbAnnualPension = 0 }) {
  const totalPot = pensionPot + isaPot;
  const spAge = statePensionAge(profile.dob);
  const guaranteedIncome = (profile.state_pension_annual || STATE_PENSION_ANNUAL_DEFAULT) + dbAnnualPension;
  const realGrowth = Math.max(0, settings.growth_rate - settings.inflation_rate) / 100;
  const bands = settings.tax_region === "scotland" ? SCOTLAND_BANDS : RUK_BANDS;
  const retirementAge = profile.retirement_age;

  const defaultMonthly = profile.monthly_spending > 0
    ? Math.round(profile.monthly_spending)
    : totalPot > 0 ? Math.max(500, Math.round(totalPot * 0.04 / 12)) : 2500;
  const [monthlySpend, setMonthlySpend] = useState(defaultMonthly);
  const [volatility, setVolatility] = useState("12");

  const model = useMemo(() => {
    if (totalPot <= 0) return null;
    const params = (monthly) => ({
      retirementAge, pensionPot, isaPot, annualSpend: monthly * 12,
      guaranteedIncome, guaranteedFromAge: spAge, pensionAccessAge: PENSION_ACCESS_AGE, bands,
    });
    const mcOptions = { meanReturn: realGrowth, sigma: Number(volatility) / 100, successAge: SUCCESS_AGE };

    const steady = simulateDrawdown({ ...params(monthlySpend), returns: realGrowth });
    const mc = monteCarloDrawdown(params(monthlySpend), { ...mcOptions, runs: 500 });
    const chart = steady.years.map((y, i) => ({
      age: y.age, pension: y.pension, isa: y.isa, p10: mc.bands[i].p10, p90: mc.bands[i].p90,
    }));

    const scenarios = [["Lean", 0.75], ["Base", 1], ["Comfortable", 1.25]].map(([label, factor]) => {
      const monthly = Math.round(monthlySpend * factor);
      const path = factor === 1 ? steady : simulateDrawdown({ ...params(monthly), returns: realGrowth });
      const success = factor === 1 ? mc.successRate : monteCarloDrawdown(params(monthly), { ...mcOptions, runs: 200 }).successRate;
      return { label, monthly, shortfallAge: path.shortfallAge, success };
    });
    return { steady, mc, chart, scenarios };
  }, [totalPot, pensionPot, isaPot, monthlySpend, volatility, retirementAge, guaranteedIncome, spAge, realGrowth, bands]);

  if (!model) {
    return (
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 6px" }}>Drawdown Simulator</h3>
        <p style={{ fontSize: 12, color: T.textDim, margin: 0 }}>Add pension and ISA accounts to simulate the withdrawal phase.</p>
      </div>
    );
  }

  const { steady, mc, chart, scenarios } = model;
  const successPct = Math.round(mc.successRate * 100);
  const successColor = (pct) => (pct >= 85 ? T.green : pct >= 65 ? T.amber : T.red);
  const lastYear = steady.years[steady.years.length - 1];
  const yearsModelled = steady.years.length;
  const bridgeYears = Math.max(0, PENSION_ACCESS_AGE - retirementAge);
  const spStartsAt = retirementAge < spAge ? spAge : null;

  const metrics = [
    {
      label: `Chance money lasts to ${SUCCESS_AGE}`, value: `${successPct}%`, color: successColor(successPct),
      sub: `${mc.runs} simulated market paths at ${volatility}% volatility`,
    },
    steady.shortfallAge
      ? { label: "Spending first unmet at age", value: steady.shortfallAge, color: T.red, sub: `With steady ${(realGrowth * 100).toFixed(1)}% real growth` }
      : { label: "Pot at age 100", value: fmtFull(lastYear.total), color: T.green, sub: `With steady ${(realGrowth * 100).toFixed(1)}% real growth` },
    {
      label: "Income tax over retirement", value: fmtFull(steady.totalTax), color: T.blue,
      sub: `About ${fmtFull(Math.round(steady.totalTax / yearsModelled))}/yr on pension and State Pension income`,
    },
    bridgeYears > 0
      ? {
        label: `Bridge to pension access (${PENSION_ACCESS_AGE})`, value: `${bridgeYears}y from ISA`,
        color: steady.bridgeGapAge ? T.red : T.amber,
        sub: steady.bridgeGapAge
          ? `ISA runs out at ${steady.bridgeGapAge} — pension still locked`
          : `Needs about ${fmtFull(monthlySpend * 12 * bridgeYears)} outside pensions`,
      }
      : {
        label: `Guaranteed income from ${spAge}`, value: `${fmtFull(guaranteedIncome)}/yr`, color: T.amber,
        sub: dbAnnualPension > 0 ? "State Pension + DB pension" : "State Pension",
      },
  ];

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 3px" }}>Drawdown Simulator</h3>
      <p style={{ fontSize: 10.5, color: T.textDim, margin: "0 0 16px" }}>
        From retirement at {retirementAge} · Today's money · Pension {fmtFull(pensionPot)} + ISAs &amp; GIA {fmtFull(isaPot)} · {fmtFull(guaranteedIncome)}/yr guaranteed income from {spAge}{dbAnnualPension > 0 ? " (SP + DB pension)" : ""}
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 16, flexWrap: "wrap" }}>
        <Field label="Monthly Spending in Retirement (after tax)" type="number" value={monthlySpend}
          onChange={(v) => setMonthlySpend(Math.max(0, v))} prefix="£" />
        <Select label="Investment Volatility" value={volatility} onChange={setVolatility} options={VOLATILITY_OPTIONS} />
        <div style={{ flex: "1 1 200px", paddingBottom: 2 }}>
          <div style={{ fontSize: 10.5, color: T.textDim }}>
            = {fmtFull(monthlySpend * 12)}/year to spend. Tax on withdrawals is added on top.
          </div>
        </div>
      </div>

      {/* Pot balance: steady-growth path by pot, with the Monte Carlo range */}
      {/* ComposedChart, not AreaChart: recharts only draws <Line> inside a composed chart. */}
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={chart}>
          <defs>
            <linearGradient id="ddP" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={T.blue} stopOpacity={0.3} />
              <stop offset="100%" stopColor={T.blue} stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="ddI" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={T.green} stopOpacity={0.3} />
              <stop offset="100%" stopColor={T.green} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={T.border} />
          <XAxis dataKey="age" tick={{ fontSize: 10.5, fill: T.textDim }} label={{ value: "Age", position: "insideBottomRight", offset: -4, fill: T.textDim, fontSize: 10.5 }} />
          <YAxis tick={{ fontSize: 10.5, fill: T.textDim }} tickFormatter={fmt} />
          <Tooltip contentStyle={ttStyle()} itemStyle={ttItemStyle()} labelStyle={ttLabelStyle()}
            formatter={(v) => fmtFull(v)} labelFormatter={(v) => `Age ${v}`} />
          <Area isAnimationActive={false} type="monotone" dataKey="pension" name="Pension" stroke={T.blue} fill="url(#ddP)" strokeWidth={2} stackId="pot" dot={false} />
          <Area isAnimationActive={false} type="monotone" dataKey="isa" name="ISAs & GIA" stroke={T.green} fill="url(#ddI)" strokeWidth={2} stackId="pot" dot={false} />
          <Line isAnimationActive={false} type="monotone" dataKey="p90" name="Good markets (90th pct)" stroke={T.amber} strokeDasharray="4 3" strokeWidth={1.5} dot={false} />
          <Line isAnimationActive={false} type="monotone" dataKey="p10" name="Poor markets (10th pct)" stroke={T.red} strokeDasharray="4 3" strokeWidth={1.5} dot={false} />
          {bridgeYears > 0 && (
            <ReferenceLine x={PENSION_ACCESS_AGE} stroke={T.blue} strokeDasharray="2 4" strokeWidth={1}
              label={{ value: `Pension access ${PENSION_ACCESS_AGE}`, fill: T.blue, fontSize: 10.5, position: "insideTopLeft" }} />
          )}
          {spStartsAt && (
            <ReferenceLine x={spStartsAt} stroke={T.amber} strokeDasharray="2 4" strokeWidth={1}
              label={{ value: `SP age ${spStartsAt}`, fill: T.amber, fontSize: 10.5, position: "insideTopRight" }} />
          )}
          <Legend wrapperStyle={{ fontSize: 10.5 }} />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Key metrics */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "16px 0" }}>
        {metrics.map((m, i) => (
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
          {scenarios.map((s) => {
            const pct = Math.round(s.success * 100);
            return (
              <div key={s.label} style={{
                flex: "1 1 140px", padding: "10px 12px", background: T.bg, borderRadius: T.radius,
                border: `1px solid ${successColor(pct)}44`,
              }}>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: T.textMuted, marginBottom: 2 }}>{s.label}</div>
                <div style={{ fontSize: 13, fontFamily: T.mono, fontWeight: 600 }}>{fmtFull(s.monthly)}/mo</div>
                <div style={{ fontSize: 10.5, color: successColor(pct), marginTop: 4 }}>{pct}% chance of lasting to {SUCCESS_AGE}</div>
                <div style={{ fontSize: 10.5, color: T.textDim }}>
                  {s.shortfallAge ? `Steady growth: short from age ${s.shortfallAge}` : "Steady growth: lasts to 100+"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p style={{ fontSize: 10.5, color: T.textDim, margin: "14px 0 0", lineHeight: 1.6 }}>
        How this works: each year's spending comes first from guaranteed income, then from pension up to the Personal Allowance, then from ISAs, then from more pension with income tax deducted.
        A quarter of every pension withdrawal is tax-free, and pensions can't be touched before {PENSION_ACCESS_AGE}. GIA holdings are treated like ISAs, tax thresholds are assumed to rise with inflation, and spending stays level in today's money.
        The percentage is the share of simulated market paths in which spending is met every year to {SUCCESS_AGE}. It is a planning aid, not a forecast.
      </p>
    </div>
  );
}
