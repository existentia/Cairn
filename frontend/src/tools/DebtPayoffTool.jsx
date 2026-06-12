import { useState, useEffect } from "react";
import { T, Field, Btn } from "../ui.jsx";
import { fmtFull, LIABILITY_TYPES } from "../advisor.js";
import { api } from "../api.js";

export default function DebtPayoffTool({ accounts: allAccounts }) {
  const debtAccounts = allAccounts.filter(a => LIABILITY_TYPES.has(a.type) && a.type !== "MORTGAGE" && Math.abs(a.balance) > 0);
  const [extraMonthly, setExtraMonthly] = useState(200);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [debts, setDebts] = useState(
    debtAccounts.map(a => ({
      name: a.name,
      balance: Math.abs(a.balance),
      rate: a.interest_rate || 0,
      min_payment: Math.abs(a.monthly_contrib || 50),
    }))
  );

  const calculate = async () => {
    if (debts.length === 0) return;
    setLoading(true);
    try {
      const res = await api.debtPayoff({ debts, extra_monthly: extraMonthly });
      setResult(res);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => { if (debts.length > 0) calculate(); }, []);

  const updDebt = (idx, field, val) => {
    setDebts(prev => prev.map((d, i) => i === idx ? { ...d, [field]: val } : d));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 4px" }}>Debt Payoff Planner</h3>
        <p style={{ fontSize: 12, color: T.textDim, margin: "0 0 16px" }}>
          Compare avalanche (highest rate first) vs snowball (smallest balance first) strategies. Excludes mortgage.
        </p>

        {debts.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: T.textDim, fontSize: 13 }}>
            No non-mortgage debts found. Add credit card or loan accounts to use this tool.
          </div>
        ) : (
          <>
            {debts.map((d, i) => (
              <div key={i} style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8, padding: "8px 0", borderBottom: `1px solid ${T.border}` }}>
                <Field label="Debt" value={d.name} onChange={(v) => updDebt(i, "name", v)} />
                <Field label="Balance" type="number" value={d.balance} onChange={(v) => updDebt(i, "balance", v)} prefix="£" small />
                <Field label="APR" type="number" value={d.rate} onChange={(v) => updDebt(i, "rate", v)} suffix="%" small />
                <Field label="Min Payment" type="number" value={d.min_payment} onChange={(v) => updDebt(i, "min_payment", v)} prefix="£" small />
              </div>
            ))}
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginTop: 10 }}>
              <Field label="Extra Monthly Payment" type="number" value={extraMonthly} onChange={setExtraMonthly} prefix="£" small />
              <Btn onClick={calculate} style={{ marginBottom: 1 }}>{loading ? "Calculating..." : "Calculate"}</Btn>
            </div>
          </>
        )}
      </div>

      {result && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {[
              { label: "Avalanche", sub: "Highest rate first", months: result.avalanche.months, interest: result.avalanche.total_interest, color: T.green, best: result.avalanche.total_interest <= result.snowball.total_interest },
              { label: "Snowball", sub: "Smallest balance first", months: result.snowball.months, interest: result.snowball.total_interest, color: T.blue, best: result.snowball.total_interest < result.avalanche.total_interest },
              { label: "Minimums Only", sub: "No extra payments", months: result.minimum_only.months, interest: result.minimum_only.total_interest, color: T.red, best: false },
            ].map((s, i) => (
              <div key={i} style={{
                flex: "1 1 200px", padding: "14px 16px", background: T.surface, borderRadius: T.radius,
                border: `1px solid ${s.best ? s.color + "66" : T.border}`,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: s.color }}>{s.label}</div>
                    <div style={{ fontSize: 10.5, color: T.textDim }}>{s.sub}</div>
                  </div>
                  {s.best && <span style={{ fontSize: 10.5, background: s.color + "22", color: s.color, padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>BEST</span>}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, fontFamily: T.mono, color: s.color }}>
                  {Math.floor(s.months / 12)}y {s.months % 12}m
                </div>
                <div style={{ fontSize: 10.5, color: T.textMuted, marginTop: 4 }}>
                  Total interest: {fmtFull(s.interest)}
                </div>
              </div>
            ))}
          </div>

          {result.savings_vs_minimum.interest_saved > 0 && (
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderLeft: `3px solid ${T.green}`, borderRadius: T.radius, padding: "12px 16px", fontSize: 13, color: T.textMuted, lineHeight: 1.6 }}>
              Paying an extra {fmtFull(extraMonthly)}/month saves you <strong style={{ color: T.green }}>{fmtFull(result.savings_vs_minimum.interest_saved)}</strong> in interest and clears your debt <strong style={{ color: T.green }}>{result.savings_vs_minimum.months_saved} months</strong> sooner compared to minimum payments only.
            </div>
          )}
        </>
      )}
    </div>
  );
}
