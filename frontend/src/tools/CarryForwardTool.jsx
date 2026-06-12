import { useState, useEffect, useMemo } from "react";
import { T, NumberInput } from "../ui.jsx";
import { fmtFull } from "../advisor.js";
import { getPriorTaxYears, PENSION_ANNUAL_ALLOWANCE } from "../constants.js";

// Top-level so React keeps its identity stable across parent re-renders —
// otherwise the input remounts on every keystroke and loses focus.
function CFRow({ label, allowance, contributed, unused, highlight, currentContrib, onChange }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr 1fr", gap: 10, padding: "8px 0", borderBottom: `1px solid ${T.border}`, alignItems: "center" }}>
      <div style={{ fontSize: 12, fontFamily: T.mono, color: highlight ? T.accent : T.text, fontWeight: highlight ? 600 : 400 }}>{label}</div>
      <div style={{ fontSize: 12, fontFamily: T.mono, color: T.textMuted }}>{fmtFull(allowance)}</div>
      {highlight ? (
        <div style={{ fontSize: 12, fontFamily: T.mono, color: T.textMuted }}>{fmtFull(currentContrib)} <span style={{ fontSize: 10.5, color: T.textDim }}>(est.)</span></div>
      ) : (
        <div>
          <NumberInput
            value={contributed}
            onChange={onChange}
            placeholder="0"
            style={{ width: "100%", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 4, color: T.text,
              padding: "4px 8px", fontSize: 12, fontFamily: T.mono, outline: "none" }} />
        </div>
      )}
      <div style={{ fontSize: 12, fontFamily: T.mono, color: unused > 0 ? T.green : T.textDim, fontWeight: unused > 0 ? 600 : 400 }}>
        {unused > 0 ? `+${fmtFull(unused)}` : "—"}
      </div>
    </div>
  );
}

export default function CarryForwardTool({ profile, settings }) {
  const currentTaxYear = settings.tax_year || "2025/26";
  const priorYears = useMemo(() => getPriorTaxYears(currentTaxYear, 3), [currentTaxYear]);
  const currentAllowance = settings.pension_annual_allowance || PENSION_ANNUAL_ALLOWANCE;
  const currentContrib = Math.round(
    profile.gross_salary * ((profile.pension_contrib_pct + profile.employer_contrib_pct) / 100)
  );

  // Persist user-entered prior-year contributions per tax year so they survive
  // navigation. Keyed by the current tax year so each year starts fresh.
  const storageKey = `cairn_carry_forward_${currentTaxYear}`;
  const [priorContribs, setPriorContribs] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return JSON.parse(saved);
    } catch {}
    return Object.fromEntries(priorYears.map((y) => [y.label, 0]));
  });
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(priorContribs)); } catch {}
  }, [storageKey, priorContribs]);
  // Re-seed when the set of prior years changes (e.g. tax year rollover)
  useEffect(() => {
    setPriorContribs((p) => {
      const next = { ...p };
      priorYears.forEach((y) => { if (!(y.label in next)) next[y.label] = 0; });
      return next;
    });
  }, [priorYears]);

  const upd = (yr, v) => setPriorContribs((p) => ({ ...p, [yr]: Math.max(0, Number(v) || 0) }));

  const rows = priorYears.map((y) => {
    const contributed = priorContribs[y.label] || 0;
    const unused = Math.max(0, y.allowance - contributed);
    return { ...y, contributed, unused };
  });

  const totalCarryForward = rows.reduce((s, r) => s + r.unused, 0);
  const totalAvailable = currentAllowance + totalCarryForward;
  const capacityRemaining = Math.max(0, totalAvailable - currentContrib);

  // Months left in tax year (approx)
  const now = new Date();
  const taxYearEnd = new Date(
    (now.getMonth() > 3 || (now.getMonth() === 3 && now.getDate() >= 6) ? now.getFullYear() + 1 : now.getFullYear()), 3, 5
  );
  const monthsLeft = Math.max(1, Math.round((taxYearEnd - now) / (1000 * 60 * 60 * 24 * 30.5)));
  const monthlyNeeded = capacityRemaining > 0 ? Math.round(capacityRemaining / monthsLeft) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 4px" }}>Pension Carry-Forward Calculator</h3>
        <p style={{ fontSize: 12, color: T.textDim, margin: "0 0 16px", lineHeight: 1.6 }}>
          Unused pension annual allowance from the 3 prior tax years can be carried forward and added to this year's allowance.
          You must exhaust the current year's allowance (£{currentAllowance.toLocaleString()}) first, and must have been a member of a registered pension scheme in each carry-forward year.
        </p>

        {/* Header */}
        <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr 1fr", gap: 10, padding: "6px 0", borderBottom: `1px solid ${T.border}`, marginBottom: 4 }}>
          {["Tax Year", "Allowance", "Contributed", "Unused (CF)"].map((h) => (
            <div key={h} style={{ fontSize: 10.5, color: T.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</div>
          ))}
        </div>

        {rows.map((r) => (
          <CFRow
            key={r.label}
            label={r.label}
            allowance={r.allowance}
            contributed={r.contributed}
            unused={r.unused}
            onChange={(v) => upd(r.label, v)}
          />
        ))}
        <CFRow
          label={currentTaxYear}
          allowance={currentAllowance}
          contributed={currentContrib}
          currentContrib={currentContrib}
          unused={Math.max(0, currentAllowance - currentContrib)}
          highlight
        />
      </div>

      {/* Results */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {[
          { label: "Total carry-forward available", value: fmtFull(totalCarryForward), color: T.green, sub: "From 3 prior years" },
          { label: "Total allowance this year", value: fmtFull(totalAvailable), color: T.accent, sub: `${fmtFull(currentAllowance)} + ${fmtFull(totalCarryForward)} CF` },
          { label: "Remaining capacity", value: fmtFull(capacityRemaining), color: capacityRemaining > 0 ? T.blue : T.textDim, sub: "After estimated current contribs" },
          { label: "Monthly sacrifice needed", value: capacityRemaining > 0 ? `${fmtFull(monthlyNeeded)}/mo` : "None needed", color: capacityRemaining > 0 ? T.amber : T.green, sub: `To use by 5 April (${monthsLeft} months left)` },
        ].map((m, i) => (
          <div key={i} style={{ flex: "1 1 160px", padding: "12px 14px", background: T.surface, borderRadius: T.radius, border: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 10.5, color: T.textMuted, marginBottom: 4, textTransform: "uppercase", fontWeight: 500 }}>{m.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: m.color, fontFamily: T.mono }}>{m.value}</div>
            <div style={{ fontSize: 10.5, color: T.textDim, marginTop: 2 }}>{m.sub}</div>
          </div>
        ))}
      </div>

      {capacityRemaining > 0 && (
        <div style={{ background: T.surface, border: `1px solid ${T.amber}33`, borderLeft: `3px solid ${T.amber}`, borderRadius: T.radius, padding: "12px 16px", fontSize: 12, color: T.textMuted, lineHeight: 1.7 }}>
          <strong style={{ color: T.amber }}>Opportunity:</strong> You have {fmtFull(capacityRemaining)} of carry-forward capacity.
          At your salary (£{profile.gross_salary.toLocaleString()}), a one-off or increased salary sacrifice contribution this tax year
          could use this up — saving significant income tax on the way in. Use the <strong>Salary Sacrifice</strong> tool to model the exact take-home impact.
          Carry-forward cannot be used once the tax year closes on 5 April.
        </div>
      )}
    </div>
  );
}
