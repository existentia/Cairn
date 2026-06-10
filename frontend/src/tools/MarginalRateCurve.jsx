import { useState, useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { T, fmt, ttStyle, ttLabelStyle } from "../ui.jsx";
import { fmtFull } from "../advisor.js";
import {
  PERSONAL_ALLOWANCE, PERSONAL_ALLOWANCE_TAPER_START,
  SCOTLAND_BANDS, RUK_BANDS,
  NI_PRIMARY_THRESHOLD, NI_UPPER_EARNINGS_LIMIT, NI_RATE_MAIN, NI_RATE_UEL_PLUS,
  HICBC_THRESHOLD_START, HICBC_THRESHOLD_END,
  CB_WEEKLY_FIRST_CHILD, CB_WEEKLY_ADDITIONAL_CHILD,
} from "../constants.js";

/**
 * Total annual deductions (income tax + employee NI + HICBC clawback) at a
 * given gross salary. Models the PA taper, which the headline band tables
 * hide — it's what creates the infamous ~60% zone between £100k and £125k.
 */
function totalDeductions(gross, bands, cbAnnual) {
  // Tapered personal allowance: lose £1 per £2 over £100k
  const pa = Math.max(0, PERSONAL_ALLOWANCE - Math.max(0, gross - PERSONAL_ALLOWANCE_TAPER_START) / 2);
  const taxable = Math.max(0, gross - pa);

  // Band tables give absolute upper bounds assuming the full PA, so convert
  // each to a width in taxable-income space, then run `taxable` through them.
  // (When the PA tapers, taxable grows 1.5× per £ of gross — taxed at the
  // marginal band rate, which is exactly how the 60% zone arises.)
  let tax = 0;
  let remaining = taxable;
  let prevTop = PERSONAL_ALLOWANCE;
  for (const [upper, rate] of bands) {
    const width = upper - prevTop;
    const inBand = Math.min(remaining, width);
    if (inBand <= 0) break;
    tax += inBand * rate;
    remaining -= inBand;
    prevTop = upper;
  }

  // Employee NI — 8% between PT and UEL, 2% above
  let ni = 0;
  if (gross > NI_PRIMARY_THRESHOLD) {
    ni += (Math.min(gross, NI_UPPER_EARNINGS_LIMIT) - NI_PRIMARY_THRESHOLD) * NI_RATE_MAIN;
    if (gross > NI_UPPER_EARNINGS_LIMIT) ni += (gross - NI_UPPER_EARNINGS_LIMIT) * NI_RATE_UEL_PLUS;
  }

  // HICBC — claws back Child Benefit linearly between £60k and £80k
  let hicbc = 0;
  if (cbAnnual > 0 && gross > HICBC_THRESHOLD_START) {
    const frac = Math.min(1, (gross - HICBC_THRESHOLD_START) / (HICBC_THRESHOLD_END - HICBC_THRESHOLD_START));
    hicbc = cbAnnual * frac;
  }

  return tax + ni + hicbc;
}

export default function MarginalRateCurve({ profile, settings }) {
  const [taxRegion, setTaxRegion] = useState(settings?.tax_region || "scotland");
  const [includeHicbc, setIncludeHicbc] = useState((profile.children_count || 0) > 0);

  const childrenCount = profile.children_count || 0;
  const cbAnnual = childrenCount > 0
    ? Math.round(CB_WEEKLY_FIRST_CHILD * 52 + CB_WEEKLY_ADDITIONAL_CHILD * 52 * Math.max(0, childrenCount - 1))
    : 0;
  const effectiveCb = includeHicbc ? cbAnnual : 0;

  const currentSalary = profile.gross_salary || 0;
  const afterSacrifice = currentSalary * (1 - (profile.pension_contrib_pct || 0) / 100);

  const data = useMemo(() => {
    const bands = taxRegion === "scotland" ? SCOTLAND_BANDS : RUK_BANDS;
    const STEP = 500;
    const MAX = 200000;
    const pts = [];
    for (let g = 0; g <= MAX; g += STEP) {
      const d0 = totalDeductions(g, bands, effectiveCb);
      const d1 = totalDeductions(g + STEP, bands, effectiveCb);
      const marginal = ((d1 - d0) / STEP) * 100;
      pts.push({ salary: g, marginal: Math.round(marginal * 10) / 10 });
    }
    return pts;
  }, [taxRegion, effectiveCb]);

  const rateAt = (salary) => {
    if (salary <= 0) return null;
    const idx = Math.min(data.length - 1, Math.round(salary / 500));
    return data[idx]?.marginal;
  };
  const currentRate = rateAt(currentSalary);
  const sacrificeRate = rateAt(afterSacrifice);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 4px" }}>Marginal Rate Curve</h3>
        <p style={{ fontSize: 11.5, color: T.textDim, margin: "0 0 14px", lineHeight: 1.6 }}>
          What the <em>next £1</em> of salary actually costs in income tax + employee NI{effectiveCb > 0 ? " + Child Benefit clawback" : ""}.
          The spike between £100k–£125k is the Personal Allowance taper{effectiveCb > 0 ? "; the £60k–£80k bump is HICBC" : ""}.
          Salary sacrifice works by sliding you left along this curve.
        </p>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {[["scotland", "🏴󠁧󠁢󠁳󠁣󠁴󠁿 Scotland"], ["ruk", "🏴󠁧󠁢󠁥󠁮󠁧󠁿 Eng / Wales / NI"]].map(([val, lbl]) => (
              <button key={val} onClick={() => setTaxRegion(val)} style={{
                background: taxRegion === val ? T.accent + "22" : "transparent",
                color: taxRegion === val ? T.accent : T.textMuted,
                border: `1px solid ${taxRegion === val ? T.accent + "66" : T.border}`,
                borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer", fontWeight: taxRegion === val ? 600 : 400,
              }}>{lbl}</button>
            ))}
          </div>
          {cbAnnual > 0 && (
            <button onClick={() => setIncludeHicbc((v) => !v)} style={{
              background: includeHicbc ? T.amber + "22" : "transparent",
              color: includeHicbc ? T.amber : T.textMuted,
              border: `1px solid ${includeHicbc ? T.amber + "66" : T.border}`,
              borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer", fontWeight: includeHicbc ? 600 : 400,
            }}>
              {includeHicbc ? "✓ " : ""}HICBC ({childrenCount} child{childrenCount !== 1 ? "ren" : ""}, {fmtFull(cbAnnual)}/yr CB)
            </button>
          )}
        </div>
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
        <ResponsiveContainer width="100%" height={340}>
          <AreaChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: -6 }}>
            <defs>
              <linearGradient id="mrG" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={T.accent} stopOpacity={0.35} />
                <stop offset="100%" stopColor={T.accent} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
            <XAxis dataKey="salary" tick={{ fontSize: 10, fill: T.textDim }} tickFormatter={fmt}
              type="number" domain={[0, 200000]} tickCount={9} />
            <YAxis tick={{ fontSize: 10, fill: T.textDim }} tickFormatter={(v) => `${v}%`} domain={[0, "auto"]} />
            <Tooltip
              contentStyle={ttStyle()} labelStyle={ttLabelStyle()}
              itemStyle={{ color: T.accent, fontSize: 12, padding: "2px 0" }}
              formatter={(v) => [`${v}%`, "Marginal rate"]}
              labelFormatter={(v) => `Salary ${fmtFull(v)}`}
            />
            <Area type="stepAfter" dataKey="marginal" name="Marginal rate"
              stroke={T.accent} fill="url(#mrG)" strokeWidth={2} dot={false} />
            {currentSalary > 0 && currentSalary <= 200000 && (
              <ReferenceLine x={currentSalary} stroke={T.red} strokeDasharray="4 3" strokeWidth={1.5}
                label={{ value: `Salary ${fmt(currentSalary)}`, fill: T.red, fontSize: 10, position: "insideTopRight" }} />
            )}
            {afterSacrifice > 0 && Math.abs(afterSacrifice - currentSalary) > 500 && afterSacrifice <= 200000 && (
              <ReferenceLine x={afterSacrifice} stroke={T.green} strokeDasharray="4 3" strokeWidth={1.5}
                label={{ value: `After sacrifice ${fmt(Math.round(afterSacrifice))}`, fill: T.green, fontSize: 10, position: "insideTopLeft" }} />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Where you sit */}
      {currentSalary > 0 && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {[
            { label: "Your marginal rate", value: currentRate != null ? `${currentRate}%` : "—", color: currentRate >= 55 ? T.red : currentRate >= 40 ? T.amber : T.green, sub: `At ${fmtFull(currentSalary)} gross` },
            ...(Math.abs(afterSacrifice - currentSalary) > 500 ? [{
              label: "After salary sacrifice", value: sacrificeRate != null ? `${sacrificeRate}%` : "—",
              color: sacrificeRate >= 55 ? T.red : sacrificeRate >= 40 ? T.amber : T.green,
              sub: `At ${fmtFull(Math.round(afterSacrifice))} (${profile.pension_contrib_pct}% sacrificed)`,
            }] : []),
            { label: "Relief on next £1 sacrificed", value: currentRate != null ? `${currentRate}p` : "—", color: T.accent, sub: "Tax + NI avoided per £1 into pension" },
          ].map((m, i) => (
            <div key={i} style={{ flex: "1 1 180px", padding: "12px 14px", background: T.surface, borderRadius: T.radius, border: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 10.5, color: T.textMuted, marginBottom: 4, textTransform: "uppercase", fontWeight: 500 }}>{m.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: m.color, fontFamily: T.mono }}>{m.value}</div>
              <div style={{ fontSize: 10.5, color: T.textDim, marginTop: 2 }}>{m.sub}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderLeft: `3px solid ${T.blue}`, borderRadius: T.radius, padding: "12px 16px", fontSize: 12, color: T.textMuted, lineHeight: 1.7 }}>
        <strong style={{ color: T.blue }}>Reading the curve:</strong> each step is a tax band boundary. The tall plateau
        between £100k and £125,140 is where the Personal Allowance tapers away — every £2 earned removes £1 of
        allowance, so the effective rate jumps well above the headline band rate. Sacrificing salary into a pension
        moves you left along the curve, and the relief per £1 equals the marginal rate where you currently sit.
      </div>
    </div>
  );
}
