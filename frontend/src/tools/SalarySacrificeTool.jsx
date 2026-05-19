import { useState, useEffect } from "react";
import { T, Field, Btn } from "../ui.jsx";
import { fmtFull } from "../advisor.js";
import { api } from "../api.js";

export default function SalarySacrificeTool({ profile, settings }) {
  const [currentPct, setCurrentPct] = useState(profile.pension_contrib_pct || 5);
  const [proposedPct, setProposedPct] = useState(Math.min((profile.pension_contrib_pct || 5) + 5, 40));
  const [employerPct, setEmployerPct] = useState(profile.employer_contrib_pct || 3);
  const [gross, setGross] = useState(profile.gross_salary || 50000);
  const [taxRegion, setTaxRegion] = useState(settings?.tax_region || "scotland");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const calculate = async () => {
    setLoading(true);
    try {
      const res = await api.salarySacrifice({
        gross_salary: gross,
        current_contrib_pct: currentPct,
        proposed_contrib_pct: proposedPct,
        employer_contrib_pct: employerPct,
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

  const StatRow = ({ label, current, proposed, highlight }) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${T.border}`, fontSize: 13 }}>
      <span style={{ color: T.textMuted, flex: 1 }}>{label}</span>
      <span style={{ fontFamily: T.mono, width: 100, textAlign: "right" }}>{current}</span>
      <span style={{ fontFamily: T.mono, width: 100, textAlign: "right", color: highlight ? T.accent : T.text }}>{proposed}</span>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 4px" }}>Salary Sacrifice Calculator</h3>
        <p style={{ fontSize: 11.5, color: T.textDim, margin: "0 0 14px" }}>
          Uses {regionLabel} income tax bands. Shows the true cost of increasing pension contributions via salary sacrifice.
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
          <Field label="Gross Salary" type="number" value={gross} onChange={setGross} prefix="£" />
          <Field label="Current Contrib %" type="number" value={currentPct} onChange={setCurrentPct} suffix="%" small />
          <Field label="Proposed Contrib %" type="number" value={proposedPct} onChange={setProposedPct} suffix="%" small />
          <Field label="Employer %" type="number" value={employerPct} onChange={setEmployerPct} suffix="%" small />
        </div>
        <Btn onClick={calculate}>{loading ? "Calculating..." : "Calculate"}</Btn>
      </div>

      {result && (
        <>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "0 0 8px", marginBottom: 8, borderBottom: `2px solid ${T.border}` }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.textMuted }}>Annual Breakdown</span>
              <div style={{ display: "flex" }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, width: 100, textAlign: "right" }}>CURRENT</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: T.accent, width: 100, textAlign: "right" }}>PROPOSED</span>
              </div>
            </div>
            <StatRow label="Gross Salary" current={fmtFull(gross)} proposed={fmtFull(gross)} />
            <StatRow label="Salary Sacrifice" current={fmtFull(result.current.pension_contrib)} proposed={fmtFull(result.proposed.pension_contrib)} highlight />
            <StatRow label="Taxable Income" current={fmtFull(result.current.taxable_income)} proposed={fmtFull(result.proposed.taxable_income)} />
            <StatRow label="Income Tax" current={fmtFull(result.current.income_tax)} proposed={fmtFull(result.proposed.income_tax)} />
            <StatRow label="Employee NI" current={fmtFull(result.current.employee_ni)} proposed={fmtFull(result.proposed.employee_ni)} />
            <StatRow label="Take-Home Pay" current={fmtFull(result.current.take_home)} proposed={fmtFull(result.proposed.take_home)} highlight />
            <StatRow label="Your Pension Contrib" current={fmtFull(result.current.pension_contrib)} proposed={fmtFull(result.proposed.pension_contrib)} highlight />
            <StatRow label="Employer Contrib" current={fmtFull(result.current.employer_contrib)} proposed={fmtFull(result.proposed.employer_contrib)} />
            <StatRow label="Total to Pension" current={fmtFull(result.current.total_pension)} proposed={fmtFull(result.proposed.total_pension)} highlight />
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {[
              { label: "Take-home reduction", value: `${fmtFull(result.comparison.take_home_reduction_monthly)}/mo`, sub: `${fmtFull(result.comparison.take_home_reduction_annual)}/year`, color: T.red },
              { label: "Pension increase", value: `${fmtFull(result.comparison.pension_increase_monthly)}/mo`, sub: `${fmtFull(result.comparison.pension_increase_annual)}/year`, color: T.green },
              { label: "Tax & NI saved", value: fmtFull(result.comparison.tax_ni_saved), sub: "Annual saving", color: T.accent },
              { label: "Effective cost", value: `${result.comparison.effective_cost_ratio}%`, sub: "Pence per £1 to pension", color: T.blue },
            ].map((m, i) => (
              <div key={i} style={{ flex: "1 1 140px", padding: "12px 14px", background: T.surface, borderRadius: T.radius, border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 10.5, color: T.textMuted, marginBottom: 4, textTransform: "uppercase", fontWeight: 500 }}>{m.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: m.color, fontFamily: T.mono }}>{m.value}</div>
                <div style={{ fontSize: 10.5, color: T.textDim, marginTop: 2 }}>{m.sub}</div>
              </div>
            ))}
          </div>

          {result.comparison.employer_ni_saving > 0 && (
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderLeft: `3px solid ${T.amber}`, borderRadius: T.radius, padding: "12px 16px", fontSize: 12.5, color: T.textMuted, lineHeight: 1.6 }}>
              <strong style={{ color: T.amber }}>Employer NI saving:</strong> Your employer saves {fmtFull(result.comparison.employer_ni_saving)}/year in Employer NI. Ask if they'll share this — some employers pass part or all of it into your pension as an additional contribution.
            </div>
          )}
        </>
      )}
    </div>
  );
}
