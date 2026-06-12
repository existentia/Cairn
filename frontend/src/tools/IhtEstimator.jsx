import { useState, useEffect } from "react";
import { T, Field, Btn } from "../ui.jsx";
import { fmtFull } from "../advisor.js";
import { api } from "../api.js";

export default function IhtEstimator({ netWorth, accounts }) {
  // Pre-fill with current estate value and whether there's a property
  const hasProperty = accounts.some((a) => a.type === "PROPERTY" && a.balance > 0);
  const [estate, setEstate] = useState(Math.max(0, Math.round(netWorth)));
  const [married, setMarried] = useState(true);
  const [hasResidence, setHasResidence] = useState(hasProperty);
  const [charity, setCharity] = useState(0);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const calculate = async () => {
    setLoading(true);
    try {
      const r = await api.ihtEstimator({
        estate_value: estate,
        married,
        has_residence: hasResidence,
        charitable_bequest: charity,
      });
      setResult(r);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => { calculate(); }, []);

  const Toggle = ({ value, onChange, label }) => (
    <div style={{ flex: "0 0 auto" }}>
      <div style={{ fontSize: 10.5, color: T.textDim, marginBottom: 6, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ display: "flex", gap: 4 }}>
        {[[true, "Yes"], [false, "No"]].map(([v, l]) => (
          <button key={String(v)} onClick={() => onChange(v)} style={{
            background: value === v ? T.accent + "22" : "transparent",
            color: value === v ? T.accent : T.textMuted,
            border: `1px solid ${value === v ? T.accent + "66" : T.border}`,
            borderRadius: 6, padding: "5px 14px", fontSize: 12, cursor: "pointer", fontWeight: value === v ? 600 : 400,
          }}>{l}</button>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 4px" }}>Inheritance Tax Estimator</h3>
        <p style={{ fontSize: 12, color: T.textDim, margin: "0 0 14px", lineHeight: 1.6 }}>
          Estimates IHT due on your estate using 2025/26 allowances (frozen to 2030).
          Standard rate 40% above the Nil Rate Band; reduced rate 36% if 10%+ goes to charity.
        </p>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
          <Field label="Estate Value" type="number" value={estate} onChange={setEstate} prefix="£" />
          <Field label="Charitable Bequest" type="number" value={charity} onChange={setCharity} prefix="£" />
          <Toggle value={married} onChange={setMarried} label="Married / civil partner" />
          <Toggle value={hasResidence} onChange={setHasResidence} label="Home to direct descendants" />
        </div>
        <Btn onClick={calculate}>{loading ? "Calculating..." : "Recalculate"}</Btn>
      </div>

      {result && (
        <>
          {/* Headline metrics */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[
              { label: "IHT Due", value: fmtFull(result.calculation.iht_due), color: result.calculation.iht_due > 0 ? T.red : T.green, sub: `${result.calculation.rate_pct}% on ${fmtFull(result.calculation.taxable)} taxable` },
              { label: "Net to Heirs", value: fmtFull(result.calculation.net_to_heirs), color: T.green, sub: `Of ${fmtFull(result.calculation.net_estate)} net estate` },
              { label: "Total Allowance", value: fmtFull(result.allowances.total_allowance), color: T.accent, sub: `NRB ${fmtFull(result.allowances.nrb)} + RNRB ${fmtFull(result.allowances.rnrb_effective)}` },
              { label: result.calculation.headroom > 0 ? "Headroom" : "Above Threshold", value: fmtFull(result.calculation.headroom || (result.calculation.net_estate - result.allowances.total_allowance)), color: result.calculation.headroom > 0 ? T.blue : T.amber, sub: result.calculation.headroom > 0 ? "Room before IHT bites" : "Excess over allowance" },
            ].map((m, i) => (
              <div key={i} style={{ flex: "1 1 180px", padding: "12px 14px", background: T.surface, borderRadius: T.radius, border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 10.5, color: T.textMuted, marginBottom: 4, textTransform: "uppercase", fontWeight: 500 }}>{m.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: m.color, fontFamily: T.mono }}>{m.value}</div>
                <div style={{ fontSize: 10.5, color: T.textDim, marginTop: 2 }}>{m.sub}</div>
              </div>
            ))}
          </div>

          {/* RNRB taper warning */}
          {result.allowances.rnrb_tapered_by > 0 && (
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderLeft: `3px solid ${T.amber}`, borderRadius: T.radius, padding: "12px 16px", fontSize: 13, color: T.textMuted, lineHeight: 1.6 }}>
              <strong style={{ color: T.amber }}>RNRB tapered:</strong> Estate over £2m means you lose £1 of Residence NRB for every £2 of estate. You've lost <strong style={{ color: T.red }}>{fmtFull(result.allowances.rnrb_tapered_by)}</strong> of the £{result.allowances.rnrb_full.toLocaleString()} potential RNRB. Bringing the estate below £2m (e.g. via lifetime gifts or pension contributions) would restore it.
            </div>
          )}

          {/* Reduced rate qualification */}
          {result.calculation.qualifies_reduced_rate && (
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderLeft: `3px solid ${T.green}`, borderRadius: T.radius, padding: "12px 16px", fontSize: 13, color: T.textMuted, lineHeight: 1.6 }}>
              <strong style={{ color: T.green }}>Reduced rate applies:</strong> Leaving 10%+ of the chargeable estate to charity drops the IHT rate from 40% to 36% on the rest.
            </div>
          )}

          {/* Breakdown */}
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
            <h4 style={{ fontSize: 12, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 10px" }}>Calculation Breakdown</h4>
            {[
              ["Estate value", fmtFull(result.inputs.estate_value)],
              ["Less: charitable bequest", `–${fmtFull(result.inputs.charitable_bequest)}`],
              ["Net estate", fmtFull(result.calculation.net_estate)],
              ["Less: Nil Rate Band" + (result.inputs.married ? " (×2, married)" : ""), `–${fmtFull(result.allowances.nrb)}`],
              ["Less: Residence NRB" + (result.allowances.rnrb_tapered_by > 0 ? " (tapered)" : ""), `–${fmtFull(result.allowances.rnrb_effective)}`],
              ["Taxable estate", fmtFull(result.calculation.taxable)],
              [`IHT at ${result.calculation.rate_pct}%`, fmtFull(result.calculation.iht_due)],
            ].map(([label, value], i, arr) => (
              <div key={i} style={{
                display: "flex", justifyContent: "space-between",
                padding: "6px 0",
                borderBottom: i < arr.length - 1 ? `1px solid ${T.border}` : "none",
                fontSize: 13,
                fontWeight: i === arr.length - 1 ? 600 : 400,
              }}>
                <span style={{ color: i === arr.length - 1 ? T.text : T.textMuted }}>{label}</span>
                <span style={{ fontFamily: T.mono, color: i === arr.length - 1 ? T.red : T.text }}>{value}</span>
              </div>
            ))}
          </div>

          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderLeft: `3px solid ${T.blue}`, borderRadius: T.radius, padding: "12px 16px", fontSize: 12, color: T.textMuted, lineHeight: 1.7 }}>
            <strong style={{ color: T.blue }}>Planning notes:</strong> This is a simplified estimate. Real planning involves lifetime gifts (7-year potentially exempt transfers), Business Property Relief, pensions (currently outside the estate but changing from April 2027), and trusts. For estates likely to attract IHT, talking to a STEP-qualified solicitor or chartered tax adviser is well worth it.
          </div>
        </>
      )}
    </div>
  );
}
