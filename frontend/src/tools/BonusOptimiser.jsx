import { useState, useEffect } from "react";
import { T, Field, Btn } from "../ui.jsx";
import { fmtFull } from "../advisor.js";
import { api } from "../api.js";

export default function BonusOptimiser({ profile, settings }) {
  const [gross, setGross] = useState(profile.gross_salary || 50000);
  const [bonus, setBonus] = useState(10000);
  const [sacrificePct, setSacrificePct] = useState(50);
  const [taxRegion, setTaxRegion] = useState(settings?.tax_region || "scotland");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const calculate = async () => {
    setLoading(true);
    try {
      const res = await api.bonusOptimiser({
        gross_salary: gross,
        bonus,
        sacrifice_pct: sacrificePct,
        tax_region: taxRegion,
      });
      setResult(res);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => { calculate(); }, []);

  const regionLabel = taxRegion === "scotland" ? "Scotland (2025/26)" : "England / Wales / NI (2025/26)";

  const combinedIncome = gross + bonus;
  const inAATaperZone = combinedIncome > 260000;
  const inPATaperZone = combinedIncome > 100000 && combinedIncome <= 125140;
  const inAddlRateZone = combinedIncome > 125140;
  const inHigherZone = combinedIncome > (taxRegion === "scotland" ? 43662 : 50270);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 4px" }}>Bonus Optimiser</h3>
        <p style={{ fontSize: 11.5, color: T.textDim, margin: "0 0 14px" }}>
          Model a one-off lump sum (annual bonus, RSU vest, etc.) as cash vs salary sacrifice into pension.
          Uses {regionLabel} marginal rates.
        </p>
        <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
          {[["scotland", "🏴󠁧󠁢󠁳󠁣󠁴󠁿 Scotland"], ["ruk", "🏴󠁧󠁢󠁥󠁮󠁧󠁿 Eng / Wales / NI"]].map(([val, lbl]) => (
            <button key={val} onClick={() => setTaxRegion(val)} style={{
              background: taxRegion === val ? T.accent + "22" : "transparent",
              color: taxRegion === val ? T.accent : T.textMuted,
              border: `1px solid ${taxRegion === val ? T.accent + "66" : T.border}`,
              borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer", fontWeight: taxRegion === val ? 600 : 400,
            }}>{lbl}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          <Field label="Base Salary" type="number" value={gross} onChange={setGross} prefix="£" />
          <Field label="Bonus / Lump Sum" type="number" value={bonus} onChange={setBonus} prefix="£" />
          <Field label="% Sacrificed to Pension" type="number" value={sacrificePct} onChange={(v) => setSacrificePct(Math.max(0, Math.min(100, v)))} suffix="%" small />
        </div>
        <Btn onClick={calculate}>{loading ? "Calculating..." : "Recalculate"}</Btn>

        {/* Context warnings about which bands you fall into */}
        {bonus > 0 && (inHigherZone || inPATaperZone || inAddlRateZone || inAATaperZone) && (
          <div style={{ marginTop: 14, padding: "10px 12px", background: T.bg, border: `1px solid ${T.amber}44`, borderLeft: `3px solid ${T.amber}`, borderRadius: T.radius, fontSize: 12, color: T.textMuted, lineHeight: 1.6 }}>
            <strong style={{ color: T.amber }}>Heads up:</strong> Adding {fmtFull(bonus)} to your {fmtFull(gross)} salary takes total income to {fmtFull(combinedIncome)}.
            {inAATaperZone && " Pension Annual Allowance taper applies (income > £260k)."}
            {inAddlRateZone && ` Top of bonus is taxed at the ${taxRegion === "scotland" ? "48% (Scotland top)" : "45% (rUK additional)"} rate.`}
            {inPATaperZone && " You're in the £100k–£125k Personal Allowance taper zone — effective marginal rate ~60%+."}
            {inHigherZone && !inAddlRateZone && !inPATaperZone && ` Bonus pushes into the ${taxRegion === "scotland" ? "Scottish higher (42%)" : "higher (40%)"}-rate band.`}
          </div>
        )}
      </div>

      {result && (
        <>
          {/* Two scenarios side by side */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 240px", padding: 16, background: T.surface, borderRadius: T.radius, border: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Take all as cash</div>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: T.mono, color: T.blue }}>{fmtFull(result.cash_route.take_home_increase)}</div>
              <div style={{ fontSize: 11, color: T.textDim, marginTop: 2, marginBottom: 10 }}>Net to take-home</div>
              <div style={{ fontSize: 12, color: T.textMuted }}>Tax + NI: <strong style={{ color: T.red, fontFamily: T.mono }}>{fmtFull(result.cash_route.tax_ni_paid)}</strong></div>
              <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4 }}>Pension: <strong style={{ fontFamily: T.mono }}>£0</strong></div>
              <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4, paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
                Total value: <strong style={{ color: T.text, fontFamily: T.mono }}>{fmtFull(result.cash_route.total_value)}</strong>
              </div>
            </div>

            <div style={{ flex: "1 1 240px", padding: 16, background: T.surface, borderRadius: T.radius, border: `1px solid ${T.accent}66`, boxShadow: `inset 0 0 0 1px ${T.accent}22` }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.accent, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Sacrifice {sacrificePct}% to pension</div>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: T.mono, color: T.green }}>{fmtFull(result.sacrifice_route.total_value)}</div>
              <div style={{ fontSize: 11, color: T.textDim, marginTop: 2, marginBottom: 10 }}>Total value (take-home + pension)</div>
              <div style={{ fontSize: 12, color: T.textMuted }}>Take-home: <strong style={{ color: T.text, fontFamily: T.mono }}>{fmtFull(result.sacrifice_route.take_home_increase)}</strong></div>
              <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4 }}>Pension: <strong style={{ color: T.accent, fontFamily: T.mono }}>{fmtFull(result.sacrifice_route.pension_increase)}</strong></div>
              <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4, paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
                Tax + NI: <strong style={{ color: T.red, fontFamily: T.mono }}>{fmtFull(result.sacrifice_route.tax_ni_paid)}</strong>
              </div>
            </div>
          </div>

          {/* Headline comparison metrics */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[
              { label: "Marginal Rate", value: `${result.comparison.marginal_rate_pct}%`, color: T.amber, sub: "Effective rate on bonus (cash route)" },
              { label: "Tax & NI Saved", value: fmtFull(result.comparison.tax_ni_saved), color: T.green, sub: "By sacrificing vs taking cash" },
              { label: "Total Value Gained", value: fmtFull(result.comparison.total_value_difference), color: result.comparison.total_value_difference > 0 ? T.green : T.textDim, sub: "Sacrifice vs cash route" },
              { label: "Cost per £1 to Pension", value: result.inputs.sacrifice_amount > 0 ? `${Math.round(result.comparison.extra_in_pocket_today / result.inputs.sacrifice_amount * 100)}p` : "—", color: T.blue, sub: "Net cost in take-home per £ to pension" },
            ].map((m, i) => (
              <div key={i} style={{ flex: "1 1 160px", padding: "12px 14px", background: T.surface, borderRadius: T.radius, border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 10.5, color: T.textMuted, marginBottom: 4, textTransform: "uppercase", fontWeight: 500 }}>{m.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: m.color, fontFamily: T.mono }}>{m.value}</div>
                <div style={{ fontSize: 10.5, color: T.textDim, marginTop: 2 }}>{m.sub}</div>
              </div>
            ))}
          </div>

          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderLeft: `3px solid ${T.blue}`, borderRadius: T.radius, padding: "12px 16px", fontSize: 12, color: T.textMuted, lineHeight: 1.7 }}>
            <strong style={{ color: T.blue }}>The trade-off:</strong> Sacrificing {fmtFull(result.inputs.sacrifice_amount)} costs you {fmtFull(result.comparison.extra_in_pocket_today)} in immediate take-home — that's <strong style={{ color: T.text }}>{result.inputs.sacrifice_amount > 0 ? Math.round(result.comparison.extra_in_pocket_today / result.inputs.sacrifice_amount * 100) : 0}p of net pay per £1 going into your pension</strong>. The remaining {fmtFull(result.comparison.tax_ni_saved)} is the tax + NI you'd otherwise have paid. Your pension grows tax-free until drawdown.
          </div>
        </>
      )}
    </div>
  );
}
