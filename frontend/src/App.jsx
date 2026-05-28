import { useState, useMemo, useEffect, useCallback } from "react";
import {
  PieChart, Pie, Cell, AreaChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
  Sankey, Layer, Rectangle,
} from "recharts";
import { api } from "./api.js";
import { generateInsights, fmtFull, ageFromDob } from "./advisor.js";
import {
  ASSET_TYPES, LIABILITY_TYPES, ISA_TYPES,
  PERSONAL_ALLOWANCE, PERSONAL_ALLOWANCE_TAPER_START,
  ISA_ANNUAL_ALLOWANCE, PENSION_ANNUAL_ALLOWANCE,
  LISA_ANNUAL_ALLOWANCE, LISA_BONUS_PCT, LISA_CONTRIB_MAX_AGE,
} from "./constants.js";

import {
  T, DARK_THEME, LIGHT_THEME, ACCOUNT_LABELS, fmt, makeGlobalStyles,
  ttStyle, ttItemStyle, ttLabelStyle,
  MetricCard, InsightCard, Tab, Field, NumberInput, Select, Btn,
} from "./ui.jsx";
import FIRECalculator from "./tools/FIRECalculator.jsx";
import CarryForwardTool from "./tools/CarryForwardTool.jsx";
import DrawdownSimulator from "./tools/DrawdownSimulator.jsx";
import SalarySacrificeTool from "./tools/SalarySacrificeTool.jsx";
import BonusOptimiser from "./tools/BonusOptimiser.jsx";
import IhtEstimator from "./tools/IhtEstimator.jsx";
import DebtPayoffTool from "./tools/DebtPayoffTool.jsx";
import TaxYearDashboard from "./tools/TaxYearDashboard.jsx";

/* ═══════════════════════════════════════════════════════════════════════════
   TOAST NOTIFICATION SYSTEM
   ═══════════════════════════════════════════════════════════════════════════ */

let toastIdCounter = 0;

function useToast() {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = "success") => {
    const id = ++toastIdCounter;
    setToasts((prev) => [...prev, { id, message, type, exiting: false }]);
    setTimeout(() => {
      setToasts((prev) => prev.map((t) => t.id === id ? { ...t, exiting: true } : t));
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 300);
    }, 3000);
  }, []);

  const ToastContainer = useCallback(() => (
    <div style={{ position: "fixed", top: 16, right: 16, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, maxWidth: 360 }}>
      {toasts.map((t) => {
        const colors = { success: T.green, error: T.red, info: T.blue, warning: T.amber };
        const icons = { success: "✓", error: "✕", info: "ℹ", warning: "▲" };
        return (
          <div key={t.id} style={{
            background: T.surface, border: `1px solid ${colors[t.type] || T.border}`,
            borderLeft: `3px solid ${colors[t.type] || T.accent}`,
            borderRadius: T.radius, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10,
            animation: `${t.exiting ? "toast-out" : "toast-in"} 0.3s ease forwards`,
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
          }}>
            <span style={{ color: colors[t.type], fontSize: 14, fontWeight: 700 }}>{icons[t.type]}</span>
            <span style={{ fontSize: 12.5, color: T.text }}>{t.message}</span>
          </div>
        );
      })}
    </div>
  ), [toasts]);

  return { addToast, ToastContainer };
}

/* ═══════════════════════════════════════════════════════════════════════════
   LOGIN SCREEN
   ═══════════════════════════════════════════════════════════════════════════ */

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    setError("");
    try {
      await api.login(username, password);
      onLogin();
    } catch (e) {
      // apiFetch surfaces the server's error message (e.g. rate-limit text)
      setError(e.message || "Invalid credentials");
    }
    setLoading(false);
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", padding: 20 }}>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 32, width: "100%", maxWidth: 360 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <svg width="32" height="40" viewBox="0 0 16 20" fill={T.accent} xmlns="http://www.w3.org/2000/svg" style={{ display: "block", margin: "0 auto 8px" }}>
            <rect x="5.5" y="0"  width="5"  height="3.5" rx="0.75"/>
            <rect x="3.5" y="5"  width="9"  height="3.5" rx="0.75"/>
            <rect x="1.5" y="10" width="13" height="3.5" rx="0.75"/>
            <rect x="0"   y="15" width="16" height="4"   rx="0.75"/>
          </svg>
          <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Cairn</h1>
          <p style={{ fontSize: 12, color: T.textDim }}>Sign in to continue</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Wrap each Field so the column-flex parent doesn't apply the Field's
              `flex: 1 1 200px` to its height and inflate the gap. */}
          <div><Field label="Username" value={username} onChange={setUsername} /></div>
          <div><Field label="Password" value={password} onChange={setPassword} type="password"
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()} /></div>
          {error && <div style={{ color: T.red, fontSize: 12 }}>{error}</div>}
          <Btn onClick={handleSubmit} style={{ marginTop: 6, padding: "10px 16px" }}>
            {loading ? "Signing in..." : "Sign In"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   ACCOUNT ROW & FORM
   ═══════════════════════════════════════════════════════════════════════════ */

function AccountRow({ account, editing, onToggle, onSave, onDelete, onMoveUp, onMoveDown }) {
  const [form, setForm] = useState({ ...account });
  const isLiab = LIABILITY_TYPES.has(account.type);
  const display = isLiab ? Math.abs(account.balance) : account.balance;

  useEffect(() => { setForm({ ...account }); }, [account]);

  const upd = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const reorderBtnStyle = (disabled) => ({
    background: "none", border: "none", color: disabled ? T.textDim : T.textMuted,
    cursor: disabled ? "default" : "pointer", padding: "1px 4px", fontSize: 11, lineHeight: 1,
    opacity: disabled ? 0.3 : 0.7,
  });

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, marginBottom: 6, overflow: "hidden" }}>
      <div onClick={onToggle} style={{ display: "flex", alignItems: "center", padding: "11px 16px", cursor: "pointer", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500 }}>{account.name}</div>
          <div style={{ fontSize: 11, color: T.textMuted }}>{ACCOUNT_LABELS[account.type]} · {account.provider || "—"}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {(onMoveUp || onMoveDown) && (
            <div style={{ display: "flex", gap: 2 }} onClick={(e) => e.stopPropagation()}>
              <button style={reorderBtnStyle(!onMoveUp)} onClick={() => onMoveUp && onMoveUp()} disabled={!onMoveUp}>▲</button>
              <button style={reorderBtnStyle(!onMoveDown)} onClick={() => onMoveDown && onMoveDown()} disabled={!onMoveDown}>▼</button>
            </div>
          )}
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: isLiab ? T.red : T.green, fontFamily: T.mono }}>
              {isLiab ? "-" : ""}{fmtFull(display)}
            </div>
            {account.interest_rate > 0 && <div style={{ fontSize: 10.5, color: T.textDim }}>{account.interest_rate}% {account.rate_type || "APR"}</div>}
          </div>
        </div>
      </div>
      {editing && (
        <div style={{ padding: "12px 16px", borderTop: `1px solid ${T.border}`, background: T.bg }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <Field label="Name" value={form.name} onChange={(v) => upd("name", v)} />
            <Field label="Provider" value={form.provider || ""} onChange={(v) => upd("provider", v)} />
            <Field label={form.type === "PROPERTY" ? "Estimated Value" : form.type === "PENSION_DB" ? "Transfer Value (CETV)" : "Balance"} type="number" value={form.balance} onChange={(v) => upd("balance", v)} prefix="£" />
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            {(form.type === "ISA_SS" || form.type === "ISA_CASH" || form.type === "ISA_LISA" || form.type === "GIA" || form.type === "SAVINGS") && (
              <Field label="Monthly Contrib" type="number" value={form.monthly_contrib || 0} onChange={(v) => upd("monthly_contrib", v)} prefix="£" small />
            )}
            {(form.type === "PENSION_DC" || form.type === "SIPP" || form.type === "ISA_SS" || form.type === "ISA_CASH" || form.type === "ISA_LISA" || form.type === "GIA") && (
              <Field label="Total Contributed" type="number" value={form.total_contributed || 0} onChange={(v) => upd("total_contributed", v)} prefix="£" small />
            )}
            {form.type === "GIA" && (
              <Field label="Unrealised Gain" type="number" value={form.unrealised_gain || 0} onChange={(v) => upd("unrealised_gain", v)} prefix="£" small />
            )}
            {form.type === "PENSION_DB" && (
              <Field label="Annual Pension at Retirement" type="number" value={form.db_annual_pension || 0} onChange={(v) => upd("db_annual_pension", v)} prefix="£" small />
            )}
            {isLiab && (
              <>
                <Field label="Interest Rate" type="number" value={form.interest_rate || 0} onChange={(v) => upd("interest_rate", v)} suffix="%" small />
                <Field label="Monthly Payment" type="number" value={Math.abs(form.monthly_contrib || 0)} onChange={(v) => upd("monthly_contrib", -v)} prefix="£" small />
                {form.type === "MORTGAGE" && (
                  <>
                    <Select label="Rate Type" value={form.rate_type || ""} onChange={(v) => upd("rate_type", v)}
                      options={[{ value: "", label: "—" }, { value: "fixed", label: "Fixed" }, { value: "tracker", label: "Tracker" }, { value: "svr", label: "SVR" }]} />
                    <Field label="Fixed Until" type="date" value={form.fixed_until || ""} onChange={(v) => upd("fixed_until", v)} small />
                    <Field label="Term End" type="date" value={form.term_end_date || ""} onChange={(v) => upd("term_end_date", v)} small />
                  </>
                )}
              </>
            )}
          </div>
          <Field label="Notes" value={form.notes || ""} onChange={(v) => upd("notes", v)} />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
            <Btn variant="danger" onClick={onDelete}>Delete</Btn>
            <Btn onClick={() => onSave(form)}>Save</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function AccountForm({ onSave, onCancel }) {
  const [form, setForm] = useState({
    name: "", type: "PENSION_DC", balance: 0, provider: "", contributing: false,
    monthly_contrib: 0, interest_rate: 0, rate_type: "", fixed_until: "",
    term_end_date: "", notes: "", total_contributed: 0, db_annual_pension: 0,
    unrealised_gain: 0,
  });
  const isLiab = LIABILITY_TYPES.has(form.type);
  const upd = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18, marginBottom: 14 }}>
      <h4 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 12px" }}>Add Account</h4>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <Field label="Account Name" value={form.name} onChange={(v) => upd("name", v)} />
        <Select label="Type" value={form.type} onChange={(v) => upd("type", v)}
          options={Object.entries(ACCOUNT_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
        <Field label="Provider" value={form.provider} onChange={(v) => upd("provider", v)} />
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <Field label={isLiab ? "Outstanding Balance" : form.type === "PENSION_DB" ? "Transfer Value (CETV)" : "Current Value"} type="number"
          value={Math.abs(form.balance)} onChange={(v) => upd("balance", isLiab ? -v : v)} prefix="£" />
        {form.type !== "PENSION_DB" && (
          <Field label="Monthly Contribution / Payment" type="number" value={Math.abs(form.monthly_contrib)}
            onChange={(v) => upd("monthly_contrib", isLiab ? -v : v)} prefix="£" small />
        )}
        {isLiab && <Field label="Interest Rate" type="number" value={form.interest_rate} onChange={(v) => upd("interest_rate", v)} suffix="%" small />}
        {(form.type === "PENSION_DC" || form.type === "SIPP" || form.type === "ISA_SS" || form.type === "ISA_CASH" || form.type === "ISA_LISA" || form.type === "GIA") && (
          <Field label="Total Contributed" type="number" value={form.total_contributed || 0} onChange={(v) => upd("total_contributed", v)} prefix="£" small />
        )}
        {form.type === "GIA" && (
          <Field label="Unrealised Gain" type="number" value={form.unrealised_gain || 0} onChange={(v) => upd("unrealised_gain", v)} prefix="£" small />
        )}
        {form.type === "PENSION_DB" && (
          <Field label="Annual Pension at Retirement" type="number" value={form.db_annual_pension || 0} onChange={(v) => upd("db_annual_pension", v)} prefix="£" small />
        )}
      </div>
      <Field label="Notes" value={form.notes} onChange={(v) => upd("notes", v)} />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <Btn variant="secondary" onClick={onCancel}>Cancel</Btn>
        <Btn onClick={() => form.name && onSave(form)}>Save Account</Btn>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN DASHBOARD
   ═══════════════════════════════════════════════════════════════════════════ */

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("overview");
  const [editId, setEditId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accountSearch, setAccountSearch] = useState("");
  const [accountTypeFilter, setAccountTypeFilter] = useState("all");
  const { addToast, ToastContainer } = useToast();
  const [isDark, setIsDark] = useState(() => localStorage.getItem("cairn_theme") !== "light");

  // Sync mutable T to current theme on every render
  Object.assign(T, isDark ? DARK_THEME : LIGHT_THEME);

  const toggleTheme = () => {
    setIsDark((prev) => {
      const next = !prev;
      localStorage.setItem("cairn_theme", next ? "dark" : "light");
      return next;
    });
  };

  // Check auth on mount
  useEffect(() => {
    (async () => {
      if (api.isLoggedIn() && await api.checkAuth()) {
        setAuthed(true);
        await loadData();
      }
      setLoading(false);
    })();
  }, []);

  const loadData = async () => {
    try {
      const d = await api.getDashboard();
      setData(d);
      // Lazy-fetch BoE rate in the background if dashboard didn't carry one
      // (cache cold). Once it returns we merge into data so the mortgage-drift
      // advisor rule starts firing without needing a manual refresh.
      if (d.boe_rate == null) {
        api.boeBaseRate()
          .then((r) => setData((prev) => prev ? { ...prev, boe_rate: r.current_rate } : prev))
          .catch(() => {});
      }
    } catch (e) {
      console.error("Failed to load data", e);
    }
  };

  const handleLogin = async () => {
    setAuthed(true);
    await loadData();
    addToast("Signed in successfully", "success");
  };

  const handleLogout = async () => {
    await api.logout();
    setAuthed(false);
    setData(null);
  };

  // CRUD helpers — all with toast feedback
  const saveProfile = async (profile) => {
    setSaving(true);
    try {
      await api.updateProfile(profile);
      await loadData();
      addToast("Profile saved", "success");
    } catch (e) {
      addToast("Failed to save profile", "error");
    }
    setSaving(false);
  };

  const saveSettings = async (settings) => {
    setSaving(true);
    try {
      await api.updateSettings(settings);
      await loadData();
      addToast("Settings saved", "success");
    } catch (e) {
      addToast("Failed to save settings", "error");
    }
    setSaving(false);
  };

  const addAccount = async (account) => {
    try {
      await api.createAccount(account);
      setShowAdd(false);
      await loadData();
      addToast(`${account.name} added`, "success");
    } catch (e) {
      addToast("Failed to add account", "error");
    }
  };

  const saveAccount = async (account) => {
    try {
      await api.updateAccount(account.id, account);
      setEditId(null);
      await loadData();
      addToast(`${account.name} updated`, "success");
    } catch (e) {
      addToast("Failed to update account", "error");
    }
  };

  const removeAccount = async (id) => {
    try {
      await api.deleteAccount(id);
      setEditId(null);
      await loadData();
      addToast("Account deleted", "success");
    } catch (e) {
      addToast("Failed to delete account", "error");
    }
  };

  const reorderAccount = async (accountId, direction, groupAccounts) => {
    const sorted = [...groupAccounts].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    const idx = sorted.findIndex((a) => a.id === accountId);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    // Assign clean 10-step sort_orders, then swap the two
    const orders = sorted.map((a, i) => ({ id: a.id, sort_order: i * 10 }));
    const temp = orders[idx].sort_order;
    orders[idx].sort_order = orders[swapIdx].sort_order;
    orders[swapIdx].sort_order = temp;
    try {
      await Promise.all([
        api.updateAccount(orders[idx].id, { sort_order: orders[idx].sort_order }),
        api.updateAccount(orders[swapIdx].id, { sort_order: orders[swapIdx].sort_order }),
      ]);
      await loadData();
    } catch (e) {
      addToast("Failed to reorder accounts", "error");
    }
  };

  const takeSnapshot = async () => {
    try {
      await api.takeSnapshot();
      await loadData();
      addToast("Snapshot recorded", "success");
    } catch (e) {
      addToast("Failed to take snapshot", "error");
    }
  };

  const bulkUpdateBalances = async (changedAccounts) => {
    if (changedAccounts.length === 0) return;
    setSaving(true);
    try {
      // PUT each changed account in parallel — backend's update_account
      // only writes the fields you pass, so balance-only updates are safe
      await Promise.all(changedAccounts.map((a) =>
        api.updateAccount(a.id, { balance: a.balance })
      ));
      // Take a fresh snapshot capturing the new state. INSERT OR REPLACE on
      // date means re-running today is idempotent.
      await api.takeSnapshot();
      await loadData();
      addToast(`Updated ${changedAccounts.length} account${changedAccounts.length !== 1 ? "s" : ""} and recorded snapshot`, "success");
    } catch (e) {
      addToast("Bulk update failed", "error");
    }
    setSaving(false);
  };

  const updateSnapshot = async (id, updates) => {
    try {
      await api.updateSnapshot(id, updates);
      await loadData();
      addToast("Snapshot updated", "success");
    } catch (e) {
      addToast("Failed to update snapshot", "error");
    }
  };

  const deleteSnapshot = async (id) => {
    try {
      await api.deleteSnapshot(id);
      await loadData();
      addToast("Snapshot deleted", "success");
    } catch (e) {
      addToast("Failed to delete snapshot", "error");
    }
  };

  const addGoal = async (goal) => {
    try {
      await api.createGoal(goal);
      await loadData();
      addToast(`Goal "${goal.name}" created`, "success");
    } catch (e) { addToast("Failed to create goal", "error"); }
  };

  const saveGoal = async (goal) => {
    try {
      await api.updateGoal(goal.id, goal);
      await loadData();
      addToast("Goal updated", "success");
    } catch (e) { addToast("Failed to update goal", "error"); }
  };

  const removeGoal = async (id) => {
    try {
      await api.deleteGoal(id);
      await loadData();
      addToast("Goal deleted", "success");
    } catch (e) { addToast("Failed to delete goal", "error"); }
  };

  const exportData = async () => {
    try {
      const d = await api.exportData();
      const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `cairn-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); URL.revokeObjectURL(url);
      addToast("Export downloaded", "success");
    } catch (e) {
      addToast("Export failed", "error");
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) return <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", color: T.textDim }}>Loading...</div>;
  if (!authed) return <><style>{makeGlobalStyles()}</style><LoginScreen onLogin={handleLogin} /></>;
  if (!data) return <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", color: T.textDim }}>Loading data...</div>;

  const { profile, accounts, settings, snapshots, goals = [] } = data;
  const assets = accounts.filter((a) => ASSET_TYPES.has(a.type));
  const liabilities = accounts.filter((a) => LIABILITY_TYPES.has(a.type));
  const totalAssets = assets.reduce((s, a) => s + a.balance, 0);
  const totalLiabilities = liabilities.reduce((s, a) => s + Math.abs(a.balance), 0);
  const netWorth = totalAssets - totalLiabilities;
  const insights = generateInsights(data);
  const age = ageFromDob(profile.dob);
  const ytr = profile.retirement_age - age;

  const monthlySavings = accounts
    .filter((a) => ASSET_TYPES.has(a.type))
    .reduce((s, a) => s + (a.monthly_contrib || 0), 0);

  // Allocation
  const allocationData = (() => {
    const g = {};
    assets.forEach((a) => { const t = ACCOUNT_LABELS[a.type] || a.type; g[t] = (g[t] || 0) + a.balance; });
    return Object.entries(g).map(([name, value]) => ({ name, value }));
  })();

  // Projection
  // Annual real-return volatility used for the ±1σ forecast envelope.
  // Roughly equity-like (a global tracker has run ~13–17% historically).
  // Cumulative σ over t years scales with √t under a lognormal model.
  const FORECAST_SIGMA_ANNUAL = 0.15;

  const projData = (() => {
    const pts = [];
    const totalPensions = accounts.filter((a) => a.type === "PENSION_DC" || a.type === "SIPP").reduce((s, a) => s + a.balance, 0);
    const totalISAs = accounts.filter((a) => a.type === "ISA_SS" || a.type === "ISA_CASH").reduce((s, a) => s + a.balance, 0);
    const mpc = profile.gross_salary * ((profile.pension_contrib_pct + profile.employer_contrib_pct) / 100) / 12;
    const mic = accounts.filter((a) => a.type === "ISA_SS" || a.type === "ISA_CASH").reduce((s, a) => s + (a.monthly_contrib || 0), 0);
    const rg = (settings.growth_rate - settings.inflation_rate) / 100 / 12;
    let p = totalPensions, i = totalISAs;
    for (let y = 0; y <= Math.min(ytr + 5, 35); y++) {
      const total = Math.round(p + i);
      // ±1σ envelope. Year 0 has zero variance; widens with √t.
      const sigmaT = FORECAST_SIGMA_ANNUAL * Math.sqrt(y);
      const upper = Math.round(total * Math.exp(sigmaT));
      const lower = Math.round(total * Math.exp(-sigmaT));
      pts.push({
        year: new Date().getFullYear() + y,
        age: age + y,
        pensions: Math.round(p),
        isas: Math.round(i),
        total,
        upper,
        lower,
      });
      for (let m = 0; m < 12; m++) { p = p * (1 + rg) + mpc; i = i * (1 + rg) + mic; }
    }
    return pts;
  })();

  const retirementPotData = projData.find((p) => p.age === profile.retirement_age);
  const retirementPot = retirementPotData?.total || 0;
  const retirementPotLow = retirementPotData?.lower || 0;
  const retirementPotHigh = retirementPotData?.upper || 0;

  return (
    <>
      <style>{makeGlobalStyles()}</style>
      <ToastContainer />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 16px" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 22 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: T.accent, letterSpacing: "-0.02em", margin: 0, display: "flex", alignItems: "center", gap: 7 }}>
              <svg width="16" height="20" viewBox="0 0 16 20" fill={T.accent} xmlns="http://www.w3.org/2000/svg">
                <rect x="5.5" y="0"  width="5"  height="3.5" rx="0.75"/>
                <rect x="3.5" y="5"  width="9"  height="3.5" rx="0.75"/>
                <rect x="1.5" y="10" width="13" height="3.5" rx="0.75"/>
                <rect x="0"   y="15" width="16" height="4"   rx="0.75"/>
              </svg>
              Cairn
            </h1>
            <p style={{ fontSize: 12, color: T.textMuted, marginTop: 3 }}>
              {profile.name ? `${profile.name} · ` : ""}Age {age}{ytr > 0 ? ` · ${ytr}y to retirement` : ""}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={toggleTheme}
              title={isDark ? "Switch to light theme" : "Switch to dark theme"}
              style={{
                background: "none", border: `1px solid ${T.border}`, borderRadius: T.radius,
                color: T.textMuted, cursor: "pointer", padding: "5px 10px", fontSize: 15,
                lineHeight: 1, transition: "border-color 0.15s",
              }}
            >{isDark ? "☀️" : "🌙"}</button>
            <Btn variant="secondary" onClick={takeSnapshot} style={{ fontSize: 11 }}>📸 Snapshot</Btn>
            <Btn variant="secondary" onClick={exportData} style={{ fontSize: 11 }}>↓ Export</Btn>
            <Btn variant="secondary" onClick={handleLogout} style={{ fontSize: 11 }}>Sign Out</Btn>
          </div>
        </div>

        {/* Metrics */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
          <MetricCard label="Net Worth" value={fmtFull(netWorth)} color={netWorth >= 0 ? T.green : T.red} sub={netWorth >= 0 ? "Assets exceed liabilities" : "Liabilities exceed assets"} />
          <MetricCard label="Total Assets" value={fmtFull(totalAssets)} color={T.green} sub={`${assets.length} accounts`} />
          <MetricCard label="Total Liabilities" value={fmtFull(totalLiabilities)} color={T.red} sub={`${liabilities.length} accounts`} />
          <MetricCard label="Monthly Savings" value={fmtFull(monthlySavings)} color={T.blue} sub="Regular contributions" />
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 3, marginBottom: 18, flexWrap: "wrap" }}>
          {[["overview", "Overview"], ["accounts", "Accounts"], ["update", "Update Balances"], ["goals", "Goals"], ["projections", "Projections"], ["advisor", "Advisor"], ["rates", "Rates & Mortgage"], ["tools", "Tools"], ["ai", "AI Copilot"], ["settings", "Settings"]].map(([id, l]) => (
            <Tab key={id} label={l} active={tab === id} onClick={() => setTab(id)} />
          ))}
        </div>

        {/* ── OVERVIEW ─────────────────────────────────────────── */}
        {tab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {(() => {
              // Enrich snapshots with estimated cumulative contributions across
              // investment accounts (PENSION_DC, SIPP, ISA_*, GIA). Worked
              // backwards from current total_contributed using current monthly
              // contribution rates — an estimate that assumes constant rates
              // historically. Only rendered when ≥1 account has contributions tracked.
              const investTypes = new Set(["PENSION_DC", "SIPP", "ISA_SS", "ISA_CASH", "ISA_LISA", "GIA"]);
              const investAccts = accounts.filter((a) => investTypes.has(a.type));
              const currentContrib = investAccts.reduce((s, a) => s + (a.total_contributed || 0), 0);
              const monthlyContrib = investAccts.reduce((s, a) => s + (a.monthly_contrib || 0), 0);
              const hasContribData = currentContrib > 0;
              const now = Date.now();
              const enriched = !hasContribData ? snapshots : snapshots.map((s) => {
                const monthsBack = Math.max(0, (now - new Date(s.date).getTime()) / (1000 * 60 * 60 * 24 * 30.44));
                const est = Math.max(0, currentContrib - monthsBack * monthlyContrib);
                return { ...s, est_contributions: Math.round(est) };
              });
              return (
                <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                    <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Net Worth Over Time</h3>
                    {hasContribData && (
                      <div style={{ fontSize: 10.5, color: T.textDim }}>
                        Dashed line: estimated cumulative investment contributions ({fmtFull(currentContrib)} to date)
                      </div>
                    )}
                  </div>
                  {snapshots.length > 0 ? (
                    <ResponsiveContainer width="100%" height={260}>
                      <AreaChart data={enriched}>
                        <defs><linearGradient id="nwG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={T.accent} stopOpacity={0.3} /><stop offset="100%" stopColor={T.accent} stopOpacity={0} /></linearGradient></defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: T.textDim }} tickFormatter={(v) => v.slice(0, 7)} />
                        <YAxis tick={{ fontSize: 10, fill: T.textDim }} tickFormatter={fmt} />
                        <Tooltip contentStyle={ttStyle()} itemStyle={ttItemStyle()} labelStyle={ttLabelStyle()} formatter={(v) => fmtFull(v)} />
                        <Area type="monotone" dataKey="net_worth" stroke={T.accent} fill="url(#nwG)" strokeWidth={2} dot={false} name="Net Worth" />
                        {hasContribData && (
                          <Line type="monotone" dataKey="est_contributions" stroke={T.purple} strokeDasharray="4 3" strokeWidth={1.5} dot={false} name="Est. contributions" />
                        )}
                        {settings.net_worth_target > 0 && (
                          <ReferenceLine
                            y={settings.net_worth_target}
                            stroke={T.amber}
                            strokeDasharray="5 4"
                            strokeWidth={1.5}
                            label={{ value: `Target: ${fmt(settings.net_worth_target)}${settings.net_worth_target_date ? ` by ${settings.net_worth_target_date.slice(0, 7)}` : ""}`, fill: T.amber, fontSize: 10, position: "insideTopLeft" }}
                          />
                        )}
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ padding: 40, textAlign: "center", color: T.textDim, fontSize: 13 }}>
                      No snapshots yet. Click <strong>📸 Snapshot</strong> to record your current net worth.
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Stacked history chart — shown once we have snapshots with category data */}
            {(() => {
              const catSnaps = snapshots.filter((s) => s.categories && Object.keys(s.categories).length > 0);
              if (catSnaps.length < 1) return null;
              const CAT_CONFIG = [
                { key: "pensions", label: "Pensions",   color: T.purple },
                { key: "isas",     label: "ISAs",        color: T.accent },
                { key: "property", label: "Property",   color: T.blue },
                { key: "cash",     label: "Cash",        color: T.green },
                { key: "debts",    label: "Debts",       color: T.red },
              ];
              const data = catSnaps.map((s) => ({
                date: s.date,
                ...Object.fromEntries(CAT_CONFIG.map(({ key }) => [key, s.categories[key] || 0])),
              }));
              const activeCats = CAT_CONFIG.filter((c) =>
                data.some((d) => (d[c.key] || 0) !== 0)
              );
              return (
                <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 4px" }}>Asset Mix Over Time</h3>
                  <p style={{ fontSize: 11, color: T.textDim, margin: "0 0 14px" }}>How your asset categories have grown with each snapshot</p>
                  <ResponsiveContainer width="100%" height={240}>
                    <AreaChart data={data}>
                      <defs>
                        {activeCats.map(({ key, color }) => (
                          <linearGradient key={key} id={`sg-${key}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity={0.5} />
                            <stop offset="100%" stopColor={color} stopOpacity={0.05} />
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: T.textDim }} tickFormatter={(v) => v.slice(0, 7)} />
                      <YAxis tick={{ fontSize: 10, fill: T.textDim }} tickFormatter={fmt} />
                      <Tooltip contentStyle={ttStyle()} itemStyle={ttItemStyle()} labelStyle={ttLabelStyle()} formatter={(v, name) => [fmtFull(v), name]} />
                      <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                      {activeCats.map(({ key, label, color }) => (
                        <Area key={key} type="monotone" dataKey={key} name={label}
                          stackId={key === "debts" ? undefined : "assets"}
                          stroke={color} fill={`url(#sg-${key})`} strokeWidth={1.5} dot={false} />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              );
            })()}

            <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 300px", background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 14px" }}>Asset Allocation</h3>
                {allocationData.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={allocationData} cx="50%" cy="50%" innerRadius={50} outerRadius={82} paddingAngle={3} dataKey="value">
                          {allocationData.map((_, i) => <Cell key={i} fill={T.chartPalette[i % T.chartPalette.length]} />)}
                        </Pie>
                        <Tooltip contentStyle={ttStyle()} itemStyle={ttItemStyle()} labelStyle={ttLabelStyle()} formatter={(v) => fmtFull(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "5px 14px", marginTop: 6 }}>
                      {allocationData.map((d, i) => (
                        <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: T.textMuted }}>
                          <div style={{ width: 8, height: 8, borderRadius: 2, background: T.chartPalette[i % T.chartPalette.length] }} />
                          {d.name}: {fmtFull(d.value)}
                        </div>
                      ))}
                    </div>
                  </>
                ) : <div style={{ padding: 40, textAlign: "center", color: T.textDim, fontSize: 13 }}>No assets added yet.</div>}
              </div>

              <div style={{ flex: "1 1 300px", background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 14px" }}>Key Insights</h3>
                {insights.slice(0, 4).map((ins, i) => <InsightCard key={i} insight={ins} />)}
                {insights.length > 4 && (
                  <Btn variant="secondary" onClick={() => setTab("advisor")} style={{ marginTop: 6, fontSize: 11 }}>
                    View all {insights.length} insights →
                  </Btn>
                )}
                {insights.length === 0 && <div style={{ padding: 20, color: T.textDim, fontSize: 13 }}>Add accounts and profile info to generate insights.</div>}
              </div>
            </div>

            {/* Annual cashflow Sankey */}
            <CashflowSankey profile={profile} accounts={accounts} settings={settings} />

            {/* Portfolio Performance — only shown when ≥1 investment account has contributions tracked */}
            {(() => {
              const investTypes = new Set(["PENSION_DC", "SIPP", "ISA_SS", "ISA_CASH", "ISA_LISA", "GIA"]);
              const investAccounts = assets.filter((a) => investTypes.has(a.type) && (a.total_contributed || 0) > 0);
              if (investAccounts.length === 0) return null;
              return (
                <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 3px" }}>Portfolio Performance</h3>
                  <p style={{ fontSize: 11, color: T.textDim, margin: "0 0 14px" }}>Contributions vs current value · Gain calculated as growth above total money invested</p>
                  <div style={{ overflowX: "auto" }}>
                    {/* Header */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 90px 72px", gap: 8, padding: "5px 8px", borderBottom: `1px solid ${T.border}`, marginBottom: 2 }}>
                      {["Account", "Contributed", "Current Value", "Gain / Loss", "Return"].map((h, i) => (
                        <div key={h} style={{ fontSize: 10, color: T.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", textAlign: i > 0 ? "right" : "left" }}>{h}</div>
                      ))}
                    </div>
                    {investAccounts.map((a) => {
                      const gain = a.balance - (a.total_contributed || 0);
                      const returnPct = a.total_contributed > 0 ? (gain / a.total_contributed) * 100 : 0;
                      const gainColor = gain >= 0 ? T.green : T.red;
                      return (
                        <div key={a.id} style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 90px 72px", gap: 8, padding: "7px 8px", borderBottom: `1px solid ${T.border}22`, alignItems: "center" }}>
                          <div>
                            <div style={{ fontSize: 12.5, fontWeight: 500 }}>{a.name}</div>
                            <div style={{ fontSize: 10.5, color: T.textDim }}>{ACCOUNT_LABELS[a.type]}{a.provider ? ` · ${a.provider}` : ""}</div>
                          </div>
                          <div style={{ fontSize: 12, fontFamily: T.mono, textAlign: "right", color: T.textMuted }}>{fmtFull(a.total_contributed)}</div>
                          <div style={{ fontSize: 12, fontFamily: T.mono, textAlign: "right", fontWeight: 600 }}>{fmtFull(a.balance)}</div>
                          <div style={{ fontSize: 12, fontFamily: T.mono, textAlign: "right", color: gainColor, fontWeight: 600 }}>
                            {gain >= 0 ? "+" : ""}{fmtFull(gain)}
                          </div>
                          <div style={{ fontSize: 12, fontFamily: T.mono, textAlign: "right", color: gainColor, fontWeight: 600 }}>
                            {returnPct >= 0 ? "+" : ""}{returnPct.toFixed(1)}%
                          </div>
                        </div>
                      );
                    })}
                    {/* Totals row */}
                    {(() => {
                      const totalContrib = investAccounts.reduce((s, a) => s + (a.total_contributed || 0), 0);
                      const totalValue = investAccounts.reduce((s, a) => s + a.balance, 0);
                      const totalGain = totalValue - totalContrib;
                      const totalReturn = totalContrib > 0 ? (totalGain / totalContrib) * 100 : 0;
                      const gainColor = totalGain >= 0 ? T.green : T.red;
                      return (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 90px 72px", gap: 8, padding: "8px 8px 2px", alignItems: "center", borderTop: `1px solid ${T.border}`, marginTop: 2 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.04em" }}>Total</div>
                          <div style={{ fontSize: 12, fontFamily: T.mono, textAlign: "right", fontWeight: 600, color: T.textMuted }}>{fmtFull(totalContrib)}</div>
                          <div style={{ fontSize: 12, fontFamily: T.mono, textAlign: "right", fontWeight: 600 }}>{fmtFull(totalValue)}</div>
                          <div style={{ fontSize: 12, fontFamily: T.mono, textAlign: "right", fontWeight: 700, color: gainColor }}>
                            {totalGain >= 0 ? "+" : ""}{fmtFull(totalGain)}
                          </div>
                          <div style={{ fontSize: 12, fontFamily: T.mono, textAlign: "right", fontWeight: 700, color: gainColor }}>
                            {totalReturn >= 0 ? "+" : ""}{totalReturn.toFixed(1)}%
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ── ACCOUNTS ─────────────────────────────────────────── */}
        {tab === "accounts" && (() => {
          const q = accountSearch.toLowerCase();
          const filteredAssets = assets.filter((a) =>
            (accountTypeFilter === "all" || accountTypeFilter === "assets") &&
            (a.name.toLowerCase().includes(q) || (a.provider || "").toLowerCase().includes(q) || ACCOUNT_LABELS[a.type]?.toLowerCase().includes(q))
          );
          const filteredLiabilities = liabilities.filter((a) =>
            (accountTypeFilter === "all" || accountTypeFilter === "liabilities") &&
            (a.name.toLowerCase().includes(q) || (a.provider || "").toLowerCase().includes(q) || ACCOUNT_LABELS[a.type]?.toLowerCase().includes(q))
          );
          const totalShown = filteredAssets.length + filteredLiabilities.length;
          return (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Accounts</h3>
                <Btn onClick={() => setShowAdd(!showAdd)}>{showAdd ? "Cancel" : "+ Add Account"}</Btn>
              </div>

              {/* Search & filter bar */}
              <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, flex: "1 1 180px", minWidth: 160 }}>
                  <span style={{ padding: "0 8px", color: T.textDim, fontSize: 13 }}>⌕</span>
                  <input
                    value={accountSearch}
                    onChange={(e) => setAccountSearch(e.target.value)}
                    placeholder="Search accounts…"
                    style={{ flex: 1, background: "transparent", border: "none", color: T.text, padding: "7px 8px 7px 0", fontSize: 13, outline: "none", fontFamily: T.font }}
                  />
                  {accountSearch && (
                    <button onClick={() => setAccountSearch("")} style={{ background: "none", border: "none", color: T.textDim, cursor: "pointer", padding: "0 8px", fontSize: 13 }}>✕</button>
                  )}
                </div>
                {["all", "assets", "liabilities"].map((f) => (
                  <button key={f} onClick={() => setAccountTypeFilter(f)} style={{
                    background: accountTypeFilter === f ? T.surface : "transparent",
                    color: accountTypeFilter === f ? T.accent : T.textMuted,
                    border: `1px solid ${accountTypeFilter === f ? T.border : "transparent"}`,
                    borderRadius: 6, padding: "7px 13px", fontSize: 12.5, cursor: "pointer", fontWeight: accountTypeFilter === f ? 600 : 400,
                    textTransform: "capitalize",
                  }}>{f}</button>
                ))}
              </div>

              {showAdd && <AccountForm onSave={addAccount} onCancel={() => setShowAdd(false)} />}

              {filteredAssets.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <h4 style={{ fontSize: 12, color: T.green, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>Assets</h4>
                  {filteredAssets.map((a, idx) => (
                    <AccountRow key={a.id} account={a} editing={editId === a.id}
                      onToggle={() => setEditId(editId === a.id ? null : a.id)}
                      onSave={saveAccount} onDelete={() => removeAccount(a.id)}
                      onMoveUp={idx > 0 ? () => reorderAccount(a.id, "up", assets) : null}
                      onMoveDown={idx < filteredAssets.length - 1 ? () => reorderAccount(a.id, "down", assets) : null} />
                  ))}
                </div>
              )}
              {filteredLiabilities.length > 0 && (
                <div>
                  <h4 style={{ fontSize: 12, color: T.red, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>Liabilities</h4>
                  {filteredLiabilities.map((a, idx) => (
                    <AccountRow key={a.id} account={a} editing={editId === a.id}
                      onToggle={() => setEditId(editId === a.id ? null : a.id)}
                      onSave={saveAccount} onDelete={() => removeAccount(a.id)}
                      onMoveUp={idx > 0 ? () => reorderAccount(a.id, "up", liabilities) : null}
                      onMoveDown={idx < filteredLiabilities.length - 1 ? () => reorderAccount(a.id, "down", liabilities) : null} />
                  ))}
                </div>
              )}
              {totalShown === 0 && (accountSearch || accountTypeFilter !== "all") && (
                <div style={{ padding: 32, textAlign: "center", color: T.textDim, fontSize: 13 }}>
                  No accounts match your search.
                </div>
              )}
            </div>
          );
        })()}

        {/* ── PROJECTIONS ──────────────────────────────────────── */}
        {tab === "projections" && (() => {
          const dbAnnualPension = accounts
            .filter((a) => a.type === "PENSION_DB")
            .reduce((s, a) => s + (a.db_annual_pension || 0), 0);
          return (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 3px" }}>Investment Growth Projection</h3>
              <p style={{ fontSize: 11, color: T.textDim, margin: "0 0 14px" }}>
                Real returns ({settings.growth_rate}% growth − {settings.inflation_rate}% inflation) · Today's money · ±1σ envelope (≈68% confidence) assumes {Math.round(FORECAST_SIGMA_ANNUAL * 100)}% annual volatility under a lognormal model
              </p>
              <ResponsiveContainer width="100%" height={340}>
                <AreaChart data={projData}>
                  <defs>
                    <linearGradient id="pG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={T.blue} stopOpacity={0.2} /><stop offset="100%" stopColor={T.blue} stopOpacity={0} /></linearGradient>
                    <linearGradient id="iG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={T.green} stopOpacity={0.2} /><stop offset="100%" stopColor={T.green} stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
                  <XAxis dataKey="year" tick={{ fontSize: 10, fill: T.textDim }} />
                  <YAxis tick={{ fontSize: 10, fill: T.textDim }} tickFormatter={fmt} />
                  <Tooltip contentStyle={ttStyle()} itemStyle={ttItemStyle()} labelStyle={ttLabelStyle()} formatter={(v) => fmtFull(v)} labelFormatter={(v) => `Year ${v}`} />
                  <Area type="monotone" dataKey="pensions" name="Pensions" stroke={T.blue} fill="url(#pG)" strokeWidth={2} stackId="1" />
                  <Area type="monotone" dataKey="isas" name="ISAs" stroke={T.green} fill="url(#iG)" strokeWidth={2} stackId="1" />
                  <Line type="monotone" dataKey="upper" name="Upper (+1σ)" stroke={T.amber} strokeDasharray="4 3" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="lower" name="Lower (−1σ)" stroke={T.red} strokeDasharray="4 3" strokeWidth={1.5} dot={false} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 14px" }}>Retirement Readiness</h3>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {[
                  { label: "Projected pot at retirement", value: fmtFull(retirementPot), color: T.accent, sub: retirementPotLow && retirementPotHigh ? `±1σ: ${fmtFull(retirementPotLow)} – ${fmtFull(retirementPotHigh)}` : null },
                  { label: "4% drawdown (annual)", value: fmtFull(Math.round(retirementPot * 0.04)), color: T.blue },
                  { label: "4% drawdown (monthly)", value: fmtFull(Math.round(retirementPot * 0.04 / 12)), color: T.green },
                  { label: "State Pension (est.)", value: `~${fmtFull(profile.state_pension_annual || 11500)}/yr`, color: T.amber },
                  ...(dbAnnualPension > 0 ? [{ label: "DB Pension (annual)", value: `${fmtFull(dbAnnualPension)}/yr`, color: T.purple, sub: "Guaranteed income" }] : []),
                ].map((m, i) => (
                  <div key={i} style={{ flex: "1 1 170px", padding: "12px 14px", background: T.bg, borderRadius: T.radius, border: `1px solid ${T.border}` }}>
                    <div style={{ fontSize: 10.5, color: T.textMuted, marginBottom: 4, textTransform: "uppercase", fontWeight: 500 }}>{m.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: m.color, fontFamily: T.mono }}>{m.value}</div>
                    {m.sub && <div style={{ fontSize: 10.5, color: T.textDim, marginTop: 2 }}>{m.sub}</div>}
                  </div>
                ))}
              </div>
            </div>
            <TaxYearSummary profile={profile} accounts={accounts} settings={settings} />
            <DrawdownSimulator retirementPot={retirementPot} profile={profile} settings={settings} dbAnnualPension={dbAnnualPension} />
          </div>
          );
        })()}

        {/* ── UPDATE BALANCES (bulk) ───────────────────────────── */}
        {tab === "update" && (
          <BulkUpdateTab
            accounts={accounts}
            snapshots={snapshots}
            saving={saving}
            onSave={bulkUpdateBalances}
          />
        )}

        {/* ── GOALS ────────────────────────────────────────────── */}
        {tab === "goals" && (
          <GoalsTab
            goals={goals} accounts={accounts} netWorth={netWorth}
            onAdd={addGoal} onSave={saveGoal} onDelete={removeGoal}
            onGoToProjections={() => setTab("projections")}
          />
        )}

        {/* ── ADVISOR ──────────────────────────────────────────── */}
        {tab === "advisor" && <AdvisorTab insights={insights} />}

        {/* ── SETTINGS ─────────────────────────────────────────── */}
        {tab === "settings" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <ProfileSettings profile={profile} onSave={saveProfile} saving={saving} />
            <AssumptionSettings settings={settings} onSave={saveSettings} saving={saving} />
            <SnapshotHistoryManager snapshots={snapshots} onUpdate={updateSnapshot} onDelete={deleteSnapshot} />
            <SnapshotCsvImport onImported={async () => { await loadData(); addToast("Snapshots imported", "success"); }} addToast={addToast} />
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 14px" }}>Data Management</h3>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Btn variant="secondary" onClick={exportData}>↓ Export All Data</Btn>
                <Btn variant="secondary" onClick={takeSnapshot}>📸 Take Snapshot Now</Btn>
              </div>
            </div>
          </div>
        )}

        {/* ── RATES & MORTGAGE ───────────────────────────────── */}
        {tab === "rates" && (
          <RatesMortgageTab accounts={accounts} settings={settings} onSaveSettings={saveSettings} addToast={addToast} />
        )}

        {/* ── TOOLS ────────────────────────────────────────────── */}
        {tab === "tools" && (
          <ToolsTab profile={profile} accounts={accounts} settings={settings} netWorth={netWorth} />
        )}

        {/* ── AI COPILOT ───────────────────────────────────────── */}
        {tab === "ai" && (
          <AICopilotTab />
        )}

        {/* Footer */}
        <div style={{ marginTop: 36, paddingTop: 14, borderTop: `1px solid ${T.border}`, fontSize: 10.5, color: T.textDim, textAlign: "center" }}>
          General information only — not regulated financial advice. Projections use simplified models. Consult an FCA-regulated adviser for personalised recommendations.
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SETTINGS SUBCOMPONENTS
   ═══════════════════════════════════════════════════════════════════════════ */

function ProfileSettings({ profile, onSave, saving }) {
  const [form, setForm] = useState({ ...profile });
  useEffect(() => { setForm({ ...profile }); }, [profile]);
  const upd = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 14px" }}>Profile & Income</h3>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <Field label="Name" value={form.name} onChange={(v) => upd("name", v)} />
        <Field label="Date of Birth" type="date" value={form.dob} onChange={(v) => upd("dob", v)} />
        <Field label="Retirement Age" type="number" value={form.retirement_age} onChange={(v) => upd("retirement_age", v)} small />
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <Field label="Gross Annual Salary" type="number" value={form.gross_salary} onChange={(v) => upd("gross_salary", v)} prefix="£" />
        <Field label="Your Pension %" type="number" value={form.pension_contrib_pct} onChange={(v) => upd("pension_contrib_pct", v)} suffix="%" small />
        <Field label="Employer %" type="number" value={form.employer_contrib_pct} onChange={(v) => upd("employer_contrib_pct", v)} suffix="%" small />
        <Field label="Tax Code" value={form.tax_code} onChange={(v) => upd("tax_code", v)} small />
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <Field label="Employer Matches Up To" type="number" value={form.employer_match_max_pct ?? 0} onChange={(v) => upd("employer_match_max_pct", v)} suffix="%" small />
        <div style={{ flex: "1 1 200px", display: "flex", alignItems: "flex-end", paddingBottom: 1 }}>
          <span style={{ fontSize: 11, color: T.textDim, lineHeight: 1.5 }}>
            The maximum employee % your employer will match. Leave at 0 if you don't have a match scheme. Advisor will warn if you're contributing below this threshold.
          </span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <Field label="Children Claiming CB For" type="number" value={form.children_count ?? 0} onChange={(v) => upd("children_count", v)} small />
        <Field label="Spouse Income (annual)" type="number" value={form.spouse_income ?? 0} onChange={(v) => upd("spouse_income", v)} prefix="£" />
        <div style={{ flex: "1 1 200px", display: "flex", alignItems: "flex-end", paddingBottom: 1 }}>
          <span style={{ fontSize: 11, color: T.textDim, lineHeight: 1.5 }}>
            Used by the advisor: children for HICBC alerts (£60k–£80k), spouse income for Marriage Allowance opportunities. Leave both at 0 if not applicable.
          </span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <Field label="State Pension (annual est.)" type="number" value={form.state_pension_annual ?? 11500} onChange={(v) => upd("state_pension_annual", v)} prefix="£" />
        <div style={{ flex: "1 1 200px", display: "flex", alignItems: "flex-end", paddingBottom: 1 }}>
          <span style={{ fontSize: 11, color: T.textDim, lineHeight: 1.5 }}>
            Check your forecast at <strong style={{ color: T.textMuted }}>check.gateway.gov.uk/state-pension-forecast</strong>. Default £11,500 is the full new State Pension (2025/26).
          </span>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Btn onClick={() => onSave(form)}>{saving ? "Saving..." : "Save Profile"}</Btn>
      </div>
    </div>
  );
}

function AssumptionSettings({ settings, onSave, saving }) {
  const [form, setForm] = useState({ ...settings });
  useEffect(() => { setForm({ ...settings }); }, [settings]);
  const upd = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 14px" }}>Projection Assumptions</h3>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <Field label="Growth Rate" type="number" value={form.growth_rate} onChange={(v) => upd("growth_rate", v)} suffix="% pa" small />
        <Field label="Inflation Rate" type="number" value={form.inflation_rate} onChange={(v) => upd("inflation_rate", v)} suffix="% pa" small />
        <Field label="ISA Allowance" type="number" value={form.isa_allowance} onChange={(v) => upd("isa_allowance", v)} prefix="£" />
        <Field label="Pension Annual Allowance" type="number" value={form.pension_annual_allowance} onChange={(v) => upd("pension_annual_allowance", v)} prefix="£" />
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <Field label="Net Worth Target" type="number" value={form.net_worth_target ?? 0} onChange={(v) => upd("net_worth_target", v)} prefix="£" />
        <Field label="Target Date" type="month" value={(form.net_worth_target_date || "").slice(0, 7)} onChange={(v) => upd("net_worth_target_date", v ? v + "-01" : "")} />
        <div style={{ flex: "1 1 200px", display: "flex", alignItems: "flex-end", paddingBottom: 1 }}>
          <span style={{ fontSize: 11, color: T.textDim, lineHeight: 1.5 }}>
            Sets a dashed target line on the net worth chart. Leave at 0 to hide.
          </span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ flex: "0 0 auto" }}>
          <div style={{ fontSize: 11, color: T.textDim, marginBottom: 6, fontWeight: 500 }}>Tax Region</div>
          <div style={{ display: "flex", gap: 4 }}>
            {[["scotland", "Scotland"], ["ruk", "England / Wales / NI"]].map(([val, lbl]) => (
              <button key={val} onClick={() => upd("tax_region", val)} style={{
                background: form.tax_region === val ? T.accent + "22" : "transparent",
                color: form.tax_region === val ? T.accent : T.textMuted,
                border: `1px solid ${form.tax_region === val ? T.accent + "66" : T.border}`,
                borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer", fontWeight: form.tax_region === val ? 600 : 400,
              }}>{lbl}</button>
            ))}
          </div>
          <div style={{ fontSize: 10.5, color: T.textDim, marginTop: 5 }}>
            Used by the Salary Sacrifice tool and Advisor insights to apply the correct income tax bands.
          </div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Btn onClick={() => onSave(form)}>{saving ? "Saving..." : "Save Settings"}</Btn>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAX YEAR SUMMARY
   ═══════════════════════════════════════════════════════════════════════════ */

function TaxYearSummary({ profile, accounts, settings }) {
  const now = new Date();
  // UK tax year: 6 April – 5 April
  const taxYearStartYear = now.getMonth() > 3 || (now.getMonth() === 3 && now.getDate() >= 6)
    ? now.getFullYear() : now.getFullYear() - 1;
  const taxYearEnd = new Date(taxYearStartYear + 1, 3, 5); // April 5 next year
  const daysLeft = Math.ceil((taxYearEnd - now) / (1000 * 60 * 60 * 24));
  const taxYearLabel = `${taxYearStartYear}/${String(taxYearStartYear + 1).slice(2)}`;

  // ISA
  const isaMonthly = accounts.filter((a) => ISA_TYPES.has(a.type))
    .reduce((s, a) => s + (a.monthly_contrib || 0), 0);
  const isaAnnualRate = isaMonthly * 12;
  const isaAllowance = settings.isa_allowance || ISA_ANNUAL_ALLOWANCE;
  const isaRemaining = Math.max(0, isaAllowance - isaAnnualRate);
  const isaUsedPct = Math.min(100, (isaAnnualRate / isaAllowance) * 100);

  // LISA sub-allowance (counts within overall ISA limit but has its own £4k cap)
  const lisaAccounts = accounts.filter((a) => a.type === "ISA_LISA");
  const hasLISA = lisaAccounts.length > 0;
  const lisaAnnualRate = lisaAccounts.reduce((s, a) => s + (a.monthly_contrib || 0), 0) * 12;
  const lisaUsedPct = Math.min(100, (lisaAnnualRate / LISA_ANNUAL_ALLOWANCE) * 100);
  const lisaBonus = Math.round(lisaAnnualRate * (LISA_BONUS_PCT / 100));

  // Pension AA usage: workplace (sal-sac, gross) + per-account DC monthly contribs
  // + SIPP monthly contribs grossed up for assumed RAS basic-rate relief.
  const workplacePensionAnnual = profile.gross_salary * ((profile.pension_contrib_pct + profile.employer_contrib_pct) / 100);
  const dcMonthlyContribs = accounts.filter((a) => a.type === "PENSION_DC").reduce((s, a) => s + (a.monthly_contrib || 0), 0);
  const sippMonthlyGross = accounts.filter((a) => a.type === "SIPP").reduce((s, a) => s + (a.monthly_contrib || 0), 0) / 0.8;
  const pensionAnnual = workplacePensionAnnual + (dcMonthlyContribs + sippMonthlyGross) * 12;
  const pensionAllowance = settings.pension_annual_allowance || PENSION_ANNUAL_ALLOWANCE;
  const pensionRemaining = Math.max(0, pensionAllowance - pensionAnnual);
  const pensionUsedPct = Math.min(100, (pensionAnnual / pensionAllowance) * 100);

  // Personal allowance
  const taper = profile.gross_salary > PERSONAL_ALLOWANCE_TAPER_START
    ? Math.min(PERSONAL_ALLOWANCE, Math.floor((profile.gross_salary - PERSONAL_ALLOWANCE_TAPER_START) / 2)) : 0;
  const effectivePA = PERSONAL_ALLOWANCE - taper;

  const Bar = ({ pct, color }) => (
    <div style={{ height: 5, background: T.border, borderRadius: 3, overflow: "hidden", margin: "5px 0" }}>
      <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3 }} />
    </div>
  );

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 2px" }}>Tax Year Summary — {taxYearLabel}</h3>
          <p style={{ fontSize: 11, color: T.textDim, margin: 0 }}>Estimated at current contribution rates</p>
        </div>
        <div style={{ background: daysLeft <= 30 ? T.red + "22" : daysLeft <= 90 ? T.amber + "22" : T.bg,
          border: `1px solid ${daysLeft <= 30 ? T.red : daysLeft <= 90 ? T.amber : T.border}`,
          borderRadius: 6, padding: "6px 12px", textAlign: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 700, fontFamily: T.mono, color: daysLeft <= 30 ? T.red : daysLeft <= 90 ? T.amber : T.accent }}>{daysLeft}</div>
          <div style={{ fontSize: 9, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.05em" }}>days to 5 Apr</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {/* ISA */}
        <div style={{ flex: "1 1 220px", padding: "12px 14px", background: T.bg, borderRadius: T.radius, border: `1px solid ${T.border}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: T.textMuted }}>ISA Allowance</span>
            <span style={{ fontSize: 11, fontFamily: T.mono, color: isaUsedPct >= 100 ? T.green : T.accent }}>{isaUsedPct.toFixed(0)}%</span>
          </div>
          <Bar pct={isaUsedPct} color={isaUsedPct >= 100 ? T.green : T.accent} />
          <div style={{ fontSize: 12, fontWeight: 600, fontFamily: T.mono, marginTop: 4 }}>{fmtFull(isaAnnualRate)} <span style={{ fontSize: 10.5, color: T.textDim, fontWeight: 400 }}>of {fmtFull(isaAllowance)}</span></div>
          <div style={{ fontSize: 11, color: isaRemaining > 0 ? T.textDim : T.green, marginTop: 2 }}>
            {isaRemaining > 0 ? `${fmtFull(isaRemaining)} remaining (${fmtFull(Math.round(isaRemaining / Math.max(1, daysLeft / 30)))}/mo to use it)` : "Allowance maxed ✓"}
          </div>
        </div>

        {/* Pension */}
        <div style={{ flex: "1 1 220px", padding: "12px 14px", background: T.bg, borderRadius: T.radius, border: `1px solid ${T.border}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: T.textMuted }}>Pension Annual Allowance</span>
            <span style={{ fontSize: 11, fontFamily: T.mono, color: pensionUsedPct >= 100 ? T.green : T.blue }}>{pensionUsedPct.toFixed(0)}%</span>
          </div>
          <Bar pct={pensionUsedPct} color={pensionUsedPct >= 100 ? T.green : T.blue} />
          <div style={{ fontSize: 12, fontWeight: 600, fontFamily: T.mono, marginTop: 4 }}>{fmtFull(Math.round(pensionAnnual))} <span style={{ fontSize: 10.5, color: T.textDim, fontWeight: 400 }}>of {fmtFull(pensionAllowance)}</span></div>
          <div style={{ fontSize: 11, color: T.textDim, marginTop: 2 }}>
            {pensionRemaining > 0 ? `${fmtFull(Math.round(pensionRemaining))} remaining · workplace + DC + SIPP` : "Annual allowance reached ✓"}
          </div>
        </div>

        {/* Personal Allowance */}
        <div style={{ flex: "1 1 220px", padding: "12px 14px", background: T.bg, borderRadius: T.radius, border: `1px solid ${taper > 0 ? T.red + "55" : T.border}` }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 6 }}>Personal Allowance</div>
          {taper > 0 ? (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, fontFamily: T.mono, color: T.red }}>{fmtFull(effectivePA)}</div>
              <div style={{ fontSize: 11, color: T.red, marginTop: 2 }}>Tapered — lost {fmtFull(taper)} (salary over £100k)</div>
              <div style={{ fontSize: 10.5, color: T.textDim, marginTop: 3 }}>Sacrifice to £100k via pension to restore full PA</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, fontFamily: T.mono }}>{fmtFull(effectivePA)}</div>
              <div style={{ fontSize: 11, color: T.textDim, marginTop: 2 }}>Full allowance · 2025/26 rate</div>
            </>
          )}
        </div>

        {/* LISA sub-allowance — only shown if user has a LISA */}
        {hasLISA && (
          <div style={{ flex: "1 1 220px", padding: "12px 14px", background: T.bg, borderRadius: T.radius, border: `1px solid ${T.border}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: T.textMuted }}>LISA Sub-Allowance</span>
              <span style={{ fontSize: 11, fontFamily: T.mono, color: lisaUsedPct >= 100 ? T.green : T.purple }}>{lisaUsedPct.toFixed(0)}%</span>
            </div>
            <Bar pct={lisaUsedPct} color={lisaUsedPct >= 100 ? T.green : T.purple} />
            <div style={{ fontSize: 12, fontWeight: 600, fontFamily: T.mono, marginTop: 4 }}>{fmtFull(lisaAnnualRate)} <span style={{ fontSize: 10.5, color: T.textDim, fontWeight: 400 }}>of {fmtFull(LISA_ANNUAL_ALLOWANCE)}</span></div>
            <div style={{ fontSize: 11, color: T.textDim, marginTop: 2 }}>
              {lisaBonus > 0 ? `Expected bonus: ${fmtFull(lisaBonus)}/yr` : "25% gov bonus on contributions"} · until age {LISA_CONTRIB_MAX_AGE}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   ADVISOR TAB — filterable insights
   ═══════════════════════════════════════════════════════════════════════════ */

const TYPE_META = {
  warning:     { label: "Warnings",     icon: "▲", color: () => T.red },
  opportunity: { label: "Opportunities",icon: "◆", color: () => T.amber },
  good:        { label: "Good",         icon: "●", color: () => T.green },
  info:        { label: "Info",         icon: "■", color: () => T.blue },
};

const CAT_LABELS = {
  isa: "ISA", pension: "Pensions", mortgage: "Mortgage",
  debt: "Debt", savings: "Savings", retirement: "Retirement",
  tax: "Tax", general: "General",
};

function AdvisorTab({ insights }) {
  const [typeFilter, setTypeFilter] = useState("all");
  const [catFilter, setCatFilter] = useState("all");

  const countByType = (t) => insights.filter((i) => i.type === t).length;
  const countByCat = (c) => insights.filter((i) => i.category === c).length;

  const filtered = insights.filter((ins) =>
    (typeFilter === "all" || ins.type === typeFilter) &&
    (catFilter === "all" || ins.category === catFilter)
  );

  const activeCats = Object.keys(CAT_LABELS).filter((c) => countByCat(c) > 0);

  const filterBtnStyle = (active, color) => ({
    background: active ? T.surface : "transparent",
    color: active ? (color || T.accent) : T.textMuted,
    border: `1px solid ${active ? (color ? color + "66" : T.border) : "transparent"}`,
    borderRadius: 6, padding: "5px 12px", fontSize: 12,
    cursor: "pointer", fontWeight: active ? 600 : 400, transition: "all 0.1s",
  });

  const catBtnStyle = (active) => ({
    background: active ? T.surfaceHover : "transparent",
    color: active ? T.text : T.textDim,
    border: `1px solid ${active ? T.borderLight : "transparent"}`,
    borderRadius: 6, padding: "4px 10px", fontSize: 11.5,
    cursor: "pointer", fontWeight: active ? 500 : 400,
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 3px" }}>Financial Insights</h3>
          <p style={{ fontSize: 11.5, color: T.textDim, margin: 0 }}>Rule-based analysis · Not regulated financial advice</p>
        </div>
        <div style={{ fontSize: 11, color: T.textDim, paddingTop: 4 }}>
          {filtered.length} of {insights.length} insight{insights.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Type filter */}
      <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
        <button style={filterBtnStyle(typeFilter === "all")} onClick={() => setTypeFilter("all")}>
          All ({insights.length})
        </button>
        {Object.entries(TYPE_META).filter(([t]) => countByType(t) > 0).map(([t, meta]) => (
          <button key={t} style={filterBtnStyle(typeFilter === t, meta.color())} onClick={() => setTypeFilter(typeFilter === t ? "all" : t)}>
            {meta.icon} {meta.label} ({countByType(t)})
          </button>
        ))}
      </div>

      {/* Category filter */}
      {activeCats.length > 1 && (
        <div style={{ display: "flex", gap: 3, marginBottom: 16, flexWrap: "wrap" }}>
          <button style={catBtnStyle(catFilter === "all")} onClick={() => setCatFilter("all")}>All topics</button>
          {activeCats.map((c) => (
            <button key={c} style={catBtnStyle(catFilter === c)} onClick={() => setCatFilter(catFilter === c ? "all" : c)}>
              {CAT_LABELS[c]} ({countByCat(c)})
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        insights.length === 0
          ? <p style={{ color: T.textMuted, fontSize: 13, padding: 20 }}>Add accounts and profile info to generate insights.</p>
          : <div style={{ padding: 32, textAlign: "center", color: T.textDim, fontSize: 13 }}>No insights match these filters.</div>
      ) : (
        filtered.map((ins, i) => <InsightCard key={i} insight={ins} />)
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   CASHFLOW SANKEY — annual salary → tax/NI/pension → take-home → ISA/etc.
   ═══════════════════════════════════════════════════════════════════════════ */

// Themed node renderer — fills with our accent palette and shows a label
const SankeyNode = ({ x, y, width, height, index, payload, containerWidth }) => {
  const isOut = x + width + 6 > containerWidth;
  const palette = [T.accent, T.purple, T.red, T.amber, T.blue, T.green, T.green, T.textMuted];
  const colour = palette[index % palette.length];
  return (
    <Layer key={`SankeyNode-${index}`}>
      <Rectangle x={x} y={y} width={width} height={height} fill={colour} fillOpacity={0.9} />
      <text
        textAnchor={isOut ? "end" : "start"}
        x={isOut ? x - 6 : x + width + 6}
        y={y + height / 2}
        fontSize={11}
        fill={T.text}
        dy="0.355em"
      >
        {payload.name}
      </text>
      <text
        textAnchor={isOut ? "end" : "start"}
        x={isOut ? x - 6 : x + width + 6}
        y={y + height / 2 + 12}
        fontSize={10}
        fill={T.textDim}
        dy="0.355em"
      >
        {fmtFull(payload.value)}/yr
      </text>
    </Layer>
  );
};

function CashflowSankey({ profile, accounts, settings }) {
  const [taxData, setTaxData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!profile.gross_salary || profile.gross_salary <= 0) return;
    setError(false);
    api.salarySacrifice({
      gross_salary: profile.gross_salary,
      current_contrib_pct: profile.pension_contrib_pct || 0,
      proposed_contrib_pct: profile.pension_contrib_pct || 0, // same as current — we only need the figures
      employer_contrib_pct: profile.employer_contrib_pct || 0,
      tax_region: settings.tax_region || "scotland",
    })
      .then((r) => setTaxData(r.current))
      .catch(() => setError(true));
  }, [profile.gross_salary, profile.pension_contrib_pct, profile.employer_contrib_pct, settings.tax_region]);

  if (!profile.gross_salary || profile.gross_salary <= 0) {
    return (
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 6px" }}>Annual Cashflow</h3>
        <p style={{ fontSize: 12, color: T.textDim, margin: 0 }}>
          Set your gross salary in <strong style={{ color: T.textMuted }}>Settings → Profile</strong> to see where it goes.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 6px" }}>Annual Cashflow</h3>
        <p style={{ fontSize: 12, color: T.red, margin: 0 }}>Couldn't compute tax figures.</p>
      </div>
    );
  }

  if (!taxData) {
    return (
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 6px" }}>Annual Cashflow</h3>
        <p style={{ fontSize: 12, color: T.textDim, margin: 0 }}>Loading...</p>
      </div>
    );
  }

  // Annual contributions out of take-home (post-tax/NI savings)
  const annualISA = accounts.filter((a) => ISA_TYPES.has(a.type)).reduce((s, a) => s + (a.monthly_contrib || 0), 0) * 12;
  const annualSavings = accounts.filter((a) => a.type === "SAVINGS").reduce((s, a) => s + (a.monthly_contrib || 0), 0) * 12;
  // Debt repayments (excluding mortgage) — store contrib as negative on liabilities
  const annualDebtPay = accounts.filter((a) => LIABILITY_TYPES.has(a.type) && a.type !== "MORTGAGE")
    .reduce((s, a) => s + Math.abs(a.monthly_contrib || 0), 0) * 12;
  // Mortgage shown separately so it doesn't lump into "Spending"
  const annualMortgage = accounts.filter((a) => a.type === "MORTGAGE")
    .reduce((s, a) => s + Math.abs(a.monthly_contrib || 0), 0) * 12;
  // Whatever's left after savings/debt/mortgage = day-to-day spending
  const spending = Math.max(0, taxData.take_home - annualISA - annualSavings - annualDebtPay - annualMortgage);

  // Build node + link arrays. Node order is referenced by index in links.
  const nodes = [{ name: "Salary" }];
  const links = [];
  const addNode = (name) => { nodes.push({ name }); return nodes.length - 1; };

  // Salary → outflows
  if (taxData.pension_contrib > 0) {
    const i = addNode("Sacrifice");
    links.push({ source: 0, target: i, value: taxData.pension_contrib });
    const p = addNode("Pension Pot");
    links.push({ source: i, target: p, value: taxData.pension_contrib });
  }
  if (taxData.income_tax > 0) {
    links.push({ source: 0, target: addNode("Income Tax"), value: taxData.income_tax });
  }
  if (taxData.employee_ni > 0) {
    links.push({ source: 0, target: addNode("Employee NI"), value: taxData.employee_ni });
  }
  const takeHomeIdx = addNode("Take-home");
  links.push({ source: 0, target: takeHomeIdx, value: taxData.take_home });

  // Take-home → savings/spending
  if (annualISA > 0) links.push({ source: takeHomeIdx, target: addNode("ISA contributions"), value: annualISA });
  if (annualSavings > 0) links.push({ source: takeHomeIdx, target: addNode("Savings"), value: annualSavings });
  if (annualMortgage > 0) links.push({ source: takeHomeIdx, target: addNode("Mortgage"), value: annualMortgage });
  if (annualDebtPay > 0) links.push({ source: takeHomeIdx, target: addNode("Debt repayment"), value: annualDebtPay });
  if (spending > 0) links.push({ source: takeHomeIdx, target: addNode("Spending"), value: spending });

  const data = { nodes, links };

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 2px" }}>Annual Cashflow</h3>
          <p style={{ fontSize: 11, color: T.textDim, margin: 0 }}>
            Where your {fmtFull(profile.gross_salary)} gross salary goes each year · {settings.tax_region === "scotland" ? "Scottish" : "rUK"} tax bands · Spending is residual (take-home minus savings & debt)
          </p>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={360}>
        <Sankey
          data={data}
          node={<SankeyNode />}
          nodePadding={28}
          // Bottom margin holds the value-label line that sits below each
          // node's centre — without ~28-30px of headroom, the lowest node's
          // value gets clipped against the SVG edge.
          margin={{ top: 18, right: 140, bottom: 30, left: 60 }}
          link={{ stroke: T.accent, strokeOpacity: 0.18 }}
        >
          <Tooltip
            contentStyle={ttStyle()}
            itemStyle={ttItemStyle()}
            labelStyle={ttLabelStyle()}
            formatter={(v) => fmtFull(v)}
          />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   BULK BALANCE UPDATE — the monthly "log everything at once" screen
   ═══════════════════════════════════════════════════════════════════════════ */

// Top-level so React keeps the row component identity stable across parent
// re-renders. Defining the row inside BulkUpdateTab caused each keystroke to
// re-create the function, which React saw as a different component type and
// remounted the <input> — losing focus and reverting the cursor every time.
const BULK_GRID = "1.6fr 1fr 1fr 1.2fr 0.8fr";

function BulkUpdateSectionHeader({ title }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: BULK_GRID, gap: 10,
      padding: "0 4px 8px", borderBottom: `1px solid ${T.border}`, marginBottom: 4,
    }}>
      {[title, "Type", "Current", "New balance", "Δ"].map((h, i) => (
        <div key={i} style={{
          fontSize: 10, color: T.textDim, fontWeight: 600, textTransform: "uppercase",
          letterSpacing: "0.04em", textAlign: i === 4 ? "right" : "left",
        }}>{h}</div>
      ))}
    </div>
  );
}

function BulkUpdateRow({ account, currentBalance, onChange }) {
  const changed = currentBalance !== account.balance;
  const rowDelta = currentBalance - account.balance;
  return (
    <div style={{
      display: "grid", gridTemplateColumns: BULK_GRID, gap: 10,
      padding: "8px 4px", borderBottom: `1px solid ${T.border}`, alignItems: "center",
      background: changed ? T.accent + "10" : "transparent", borderRadius: changed ? 4 : 0,
    }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: T.text }}>{account.name}</div>
      <div style={{ fontSize: 11, color: T.textMuted }}>{ACCOUNT_LABELS[account.type] || account.type}</div>
      <div style={{ fontSize: 12, color: T.textMuted, fontFamily: T.mono }}>{fmtFull(account.balance)}</div>
      <NumberInput
        value={currentBalance}
        onChange={onChange}
        style={{
          background: T.bg, border: `1px solid ${changed ? T.accent : T.border}`, borderRadius: 6,
          color: changed ? T.accent : T.text, padding: "6px 10px", fontSize: 13,
          fontFamily: T.mono, outline: "none", fontWeight: changed ? 600 : 400,
        }}
      />
      <div style={{ fontSize: 11.5, fontFamily: T.mono, textAlign: "right",
        color: !changed ? T.textDim : rowDelta > 0 ? T.green : T.red }}>
        {changed ? `${rowDelta >= 0 ? "+" : ""}${fmtFull(rowDelta)}` : "—"}
      </div>
    </div>
  );
}

function BulkUpdateTab({ accounts, snapshots, onSave, saving }) {
  // Initialise from current balances; reset whenever the underlying account
  // list changes (e.g. after a successful save reloads data).
  const initial = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a.balance])),
    [accounts]
  );
  const [balances, setBalances] = useState(initial);
  useEffect(() => { setBalances(initial); }, [initial]);

  // Drafts: only count edits where the new value differs from the original
  const changedIds = accounts.filter((a) => balances[a.id] !== a.balance).map((a) => a.id);
  const changedCount = changedIds.length;

  const assets = accounts.filter((a) => ASSET_TYPES.has(a.type));
  const liabilities = accounts.filter((a) => LIABILITY_TYPES.has(a.type));

  const sumByType = (list, useDraft) => list.reduce((s, a) => {
    const v = useDraft ? (balances[a.id] ?? a.balance) : a.balance;
    return s + (LIABILITY_TYPES.has(a.type) ? Math.abs(v) : v);
  }, 0);

  const currentNetWorth = sumByType(assets, false) - sumByType(liabilities, false);
  const newNetWorth = sumByType(assets, true) - sumByType(liabilities, true);
  const delta = newNetWorth - currentNetWorth;

  const lastSnapshot = snapshots.length > 0
    ? [...snapshots].sort((a, b) => b.date.localeCompare(a.date))[0]
    : null;
  const daysSinceLast = lastSnapshot
    ? Math.floor((Date.now() - new Date(lastSnapshot.date).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const handleSave = () => {
    const changed = accounts
      .filter((a) => balances[a.id] !== a.balance)
      .map((a) => ({ id: a.id, balance: balances[a.id] }));
    onSave(changed);
  };

  const reset = () => setBalances(initial);

  const setBalance = (id, v) => setBalances((p) => ({ ...p, [id]: v }));

  if (accounts.length === 0) {
    return (
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 24, textAlign: "center", color: T.textDim, fontSize: 13 }}>
        No accounts yet. Add a few in the Accounts tab to enable bulk updates.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Intro */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 4px" }}>Update All Balances</h3>
        <p style={{ fontSize: 11.5, color: T.textDim, margin: 0, lineHeight: 1.6 }}>
          Edit every account in one go. When you save, changed balances are written and a snapshot is recorded for today.
          {lastSnapshot && (
            <> Last snapshot was <strong style={{ color: T.textMuted }}>{lastSnapshot.date}</strong>{daysSinceLast != null && ` — ${daysSinceLast} day${daysSinceLast !== 1 ? "s" : ""} ago`}.</>
          )}
        </p>
      </div>

      {/* Live summary */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <MetricCard label="Current Net Worth" value={fmtFull(currentNetWorth)} sub="Before changes" />
        <MetricCard label="After Update" value={fmtFull(newNetWorth)} color={delta >= 0 ? T.green : T.red} sub={changedCount > 0 ? `Preview with ${changedCount} edit${changedCount !== 1 ? "s" : ""}` : "No edits yet"} />
        <MetricCard
          label="Net Change"
          value={`${delta >= 0 ? "+" : ""}${fmtFull(delta)}`}
          color={delta === 0 ? T.textMuted : delta > 0 ? T.green : T.red}
          sub={changedCount > 0 ? `Across ${changedCount} account${changedCount !== 1 ? "s" : ""}` : "—"}
        />
      </div>

      {/* Assets */}
      {assets.length > 0 && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
          <BulkUpdateSectionHeader title="Asset" />
          {assets.map((a) => (
            <BulkUpdateRow
              key={a.id}
              account={a}
              currentBalance={balances[a.id] ?? a.balance}
              onChange={(v) => setBalance(a.id, v)}
            />
          ))}
        </div>
      )}

      {/* Liabilities */}
      {liabilities.length > 0 && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
          <BulkUpdateSectionHeader title="Liability" />
          {liabilities.map((a) => (
            <BulkUpdateRow
              key={a.id}
              account={a}
              currentBalance={balances[a.id] ?? a.balance}
              onChange={(v) => setBalance(a.id, v)}
            />
          ))}
        </div>
      )}

      {/* Sticky action bar */}
      <div style={{
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius,
        padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center",
        flexWrap: "wrap", gap: 10, position: "sticky", bottom: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
      }}>
        <div style={{ fontSize: 12.5, color: T.textMuted }}>
          {changedCount === 0
            ? "No changes yet. Edit any balance to enable saving."
            : <>
                <strong style={{ color: T.text }}>{changedCount}</strong> edit{changedCount !== 1 ? "s" : ""} ready
                · Net change: <strong style={{ color: delta >= 0 ? T.green : T.red }}>{delta >= 0 ? "+" : ""}{fmtFull(delta)}</strong>
              </>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn variant="secondary" onClick={reset}>Reset</Btn>
          <Btn onClick={handleSave} style={{ opacity: changedCount === 0 || saving ? 0.5 : 1, pointerEvents: changedCount === 0 || saving ? "none" : "auto" }}>
            {saving ? "Saving..." : "Save & Snapshot"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SNAPSHOT HISTORY MANAGER
   ═══════════════════════════════════════════════════════════════════════════ */

function SnapshotCsvImport({ onImported, addToast }) {
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  // Quick client-side preview so the user can see what we'll send before
  // committing — just counts non-empty lines beyond the header.
  const preview = (() => {
    const lines = csv.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return null;
    const header = lines[0].split(",").map((c) => c.trim().toLowerCase());
    return {
      rows: lines.length - 1,
      header,
      hasDate: header.includes("date"),
      hasNetWorth: header.includes("net_worth"),
    };
  })();

  const submit = async () => {
    setLoading(true);
    setResult(null);
    try {
      const r = await api.importSnapshotsCsv(csv);
      setResult(r);
      if (r.imported > 0 && onImported) onImported();
    } catch (e) {
      addToast(e.message || "CSV import failed", "error");
    }
    setLoading(false);
  };

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 4px" }}>Import Snapshots (CSV)</h3>
      <p style={{ fontSize: 11.5, color: T.textDim, margin: "0 0 12px", lineHeight: 1.6 }}>
        Bootstrap historic net-worth data from a spreadsheet. CSV must have a header with at minimum <code style={{ background: T.bg, padding: "1px 5px", borderRadius: 3 }}>date</code> and <code style={{ background: T.bg, padding: "1px 5px", borderRadius: 3 }}>net_worth</code> columns; <code style={{ background: T.bg, padding: "1px 5px", borderRadius: 3 }}>total_assets</code> and <code style={{ background: T.bg, padding: "1px 5px", borderRadius: 3 }}>total_liabilities</code> are optional.
        Dates use YYYY-MM-DD. Re-importing a date overwrites the existing row.
      </p>
      <textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        placeholder={`date,net_worth,total_assets,total_liabilities\n2024-01-01,125000,250000,125000\n2024-02-01,128500,253000,124500\n...`}
        rows={8}
        spellCheck={false}
        style={{
          width: "100%", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6,
          color: T.text, padding: 10, fontSize: 12, fontFamily: T.mono, outline: "none", resize: "vertical",
        }}
      />
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
        {preview && (
          <div style={{ fontSize: 11.5, color: preview.hasDate && preview.hasNetWorth ? T.textMuted : T.amber }}>
            {preview.rows} row{preview.rows !== 1 ? "s" : ""} detected · header: <span style={{ fontFamily: T.mono }}>{preview.header.join(", ")}</span>
            {!preview.hasDate && " · missing 'date' column"}
            {!preview.hasNetWorth && " · missing 'net_worth' column"}
          </div>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Btn variant="secondary" onClick={() => { setCsv(""); setResult(null); }}>Clear</Btn>
          <Btn onClick={submit} style={{ opacity: !csv || loading ? 0.5 : 1, pointerEvents: !csv || loading ? "none" : "auto" }}>
            {loading ? "Importing..." : "Import"}
          </Btn>
        </div>
      </div>
      {result && (
        <div style={{
          marginTop: 12, padding: "10px 12px",
          background: T.bg, borderRadius: T.radius,
          border: `1px solid ${result.errors.length > 0 ? T.amber + "55" : T.green + "55"}`,
          borderLeft: `3px solid ${result.errors.length > 0 ? T.amber : T.green}`,
          fontSize: 12, color: T.textMuted, lineHeight: 1.6,
        }}>
          Imported <strong style={{ color: T.green }}>{result.imported}</strong> snapshot{result.imported !== 1 ? "s" : ""}
          {result.skipped > 0 && <> · skipped <strong style={{ color: T.amber }}>{result.skipped}</strong></>}
          {result.errors.length > 0 && (
            <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
              {result.errors.map((err, i) => (
                <li key={i} style={{ color: T.red, fontSize: 11.5 }}>{err}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function SnapshotHistoryManager({ snapshots, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({});

  const sorted = [...snapshots].sort((a, b) => b.date.localeCompare(a.date));

  const startEdit = (snap) => {
    setEditId(snap.id);
    setEditForm({ date: snap.date, net_worth: snap.net_worth, total_assets: snap.total_assets, total_liabilities: snap.total_liabilities });
  };

  const cancelEdit = () => { setEditId(null); setEditForm({}); };

  const saveEdit = () => {
    onUpdate(editId, {
      date: editForm.date,
      net_worth: parseFloat(editForm.net_worth) || 0,
      total_assets: parseFloat(editForm.total_assets) || 0,
      total_liabilities: parseFloat(editForm.total_liabilities) || 0,
    });
    setEditId(null);
    setEditForm({});
  };

  const upd = (k, v) => setEditForm((p) => ({ ...p, [k]: v }));

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: expanded ? 14 : 0 }}>
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Snapshot History</h3>
          {!expanded && <div style={{ fontSize: 11, color: T.textDim, marginTop: 2 }}>{snapshots.length} snapshots recorded</div>}
        </div>
        <Btn variant="secondary" onClick={() => setExpanded(!expanded)} style={{ fontSize: 11 }}>
          {expanded ? "Hide" : "Edit History"}
        </Btn>
      </div>

      {expanded && (
        snapshots.length === 0 ? (
          <div style={{ padding: "20px 0", textAlign: "center", color: T.textDim, fontSize: 13 }}>No snapshots recorded yet.</div>
        ) : (
          <div>
            {/* Header row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: 8, padding: "6px 8px", borderBottom: `1px solid ${T.border}`, marginBottom: 4 }}>
              {["Date", "Net Worth", "Assets", "Liabilities", ""].map((h, i) => (
                <div key={i} style={{ fontSize: 10, color: T.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</div>
              ))}
            </div>

            {sorted.map((snap) => (
              <div key={snap.id}>
                {editId === snap.id ? (
                  <div style={{ background: T.bg, borderRadius: 6, padding: "10px 8px", marginBottom: 4, border: `1px solid ${T.borderLight}` }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                      <Field label="Date" type="date" value={editForm.date || ""} onChange={(v) => upd("date", v)} small />
                      <Field label="Net Worth" type="number" value={editForm.net_worth ?? ""} onChange={(v) => upd("net_worth", v)} prefix="£" small />
                      <Field label="Total Assets" type="number" value={editForm.total_assets ?? ""} onChange={(v) => upd("total_assets", v)} prefix="£" small />
                      <Field label="Total Liabilities" type="number" value={editForm.total_liabilities ?? ""} onChange={(v) => upd("total_liabilities", v)} prefix="£" small />
                    </div>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <Btn variant="secondary" onClick={cancelEdit}>Cancel</Btn>
                      <Btn onClick={saveEdit}>Save</Btn>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: 8, padding: "7px 8px", borderBottom: `1px solid ${T.border}22`, alignItems: "center" }}>
                    <div style={{ fontSize: 12, fontFamily: T.mono }}>{snap.date}</div>
                    <div style={{ fontSize: 12, fontFamily: T.mono, color: snap.net_worth >= 0 ? T.green : T.red, fontWeight: 600 }}>{fmtFull(snap.net_worth)}</div>
                    <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono }}>{fmtFull(snap.total_assets || 0)}</div>
                    <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono }}>{fmtFull(snap.total_liabilities || 0)}</div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button onClick={() => startEdit(snap)} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 4, color: T.textMuted, cursor: "pointer", padding: "2px 8px", fontSize: 11 }}>Edit</button>
                      <button onClick={() => onDelete(snap.id)} style={{ background: "none", border: `1px solid ${T.red}44`, borderRadius: 4, color: T.red, cursor: "pointer", padding: "2px 8px", fontSize: 11 }}>✕</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   GOALS TAB
   ═══════════════════════════════════════════════════════════════════════════ */

const GOAL_LINK_TYPES = [
  { value: "", label: "Manual (no auto-tracking)" },
  { value: "net_worth", label: "Overall Net Worth" },
  { value: "type:PENSION_DC", label: "DC Pensions total" },
  { value: "type:GIA", label: "GIAs total" },
  { value: "type:ISA_LISA", label: "Lifetime ISAs total" },
  { value: "type:SIPP", label: "SIPP total" },
  { value: "type:ISA_SS", label: "Stocks & Shares ISAs total" },
  { value: "type:ISA_CASH", label: "Cash ISAs total" },
  { value: "type:SAVINGS", label: "Savings Accounts total" },
  { value: "type:CURRENT", label: "Current Accounts total" },
  { value: "type:MORTGAGE", label: "Mortgage balance (pay-off goal)" },
  { value: "type:CREDIT_CARD", label: "Credit Card balance (pay-off)" },
];

const GOAL_ICONS = ["🏠", "🚗", "✈️", "🎓", "💍", "🧸", "🌍", "💰", "🏖️", "🔥", "⛵", "🏔️", "🎯", "💼", "🏋️"];

function GoalCard({ goal, currentValue, onEdit, onDelete }) {
  const target = goal.target_amount;
  const isPayoff = goal.link_type?.startsWith("type:MORTGAGE") || goal.link_type?.startsWith("type:CREDIT");
  // For payoff goals: progress = how much has been paid off (higher balance = less progress)
  const progress = target > 0
    ? isPayoff
      ? Math.min(100, Math.max(0, (1 - currentValue / target) * 100))
      : Math.min(100, Math.max(0, (currentValue / target) * 100))
    : 0;
  const done = progress >= 100;
  const color = done ? T.green : progress >= 50 ? T.accent : T.blue;

  const daysLeft = goal.target_date
    ? Math.ceil((new Date(goal.target_date) - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div style={{ background: T.surface, border: `1px solid ${done ? T.green + "55" : T.border}`, borderRadius: T.radius, padding: 18, position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {goal.icon && <span style={{ fontSize: 22 }}>{goal.icon}</span>}
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{goal.name}</div>
            {goal.description && <div style={{ fontSize: 11, color: T.textDim, marginTop: 1 }}>{goal.description}</div>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <button onClick={onEdit} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 4, color: T.textMuted, cursor: "pointer", padding: "3px 9px", fontSize: 11 }}>Edit</button>
          <button onClick={onDelete} style={{ background: "none", border: `1px solid ${T.red}44`, borderRadius: 4, color: T.red, cursor: "pointer", padding: "3px 9px", fontSize: 11 }}>✕</button>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 8, background: T.border, borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
        <div style={{ height: "100%", width: `${progress}%`, background: color, borderRadius: 4, transition: "width 0.4s ease" }} />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 10.5, color: T.textDim, marginBottom: 2 }}>
            {goal.link_type ? `${fmtFull(isPayoff ? target - currentValue : currentValue)} of ${fmtFull(target)}` : `Target: ${fmtFull(target)}`}
          </div>
          {daysLeft != null && (
            <div style={{ fontSize: 10.5, color: daysLeft < 30 ? T.red : daysLeft < 90 ? T.amber : T.textDim }}>
              {daysLeft > 0 ? `${daysLeft}d remaining (${goal.target_date.slice(0, 7)})` : `Target date passed (${goal.target_date.slice(0, 7)})`}
            </div>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: T.mono, color }}>{progress.toFixed(0)}%</div>
          {done && <div style={{ fontSize: 10, color: T.green, fontWeight: 600 }}>ACHIEVED ✓</div>}
        </div>
      </div>
    </div>
  );
}

function GoalForm({ initial, onSave, onCancel, accounts }) {
  const [form, setForm] = useState(initial || {
    name: "", description: "", target_amount: 0, target_date: "",
    icon: "🎯", link_type: "", link_value: "",
  });
  const upd = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18, marginBottom: 14 }}>
      <h4 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 14px" }}>{initial ? "Edit Goal" : "Add Goal"}</h4>
      {/* Icon picker */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: T.textDim, marginBottom: 6, fontWeight: 500 }}>Icon</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {GOAL_ICONS.map((ic) => (
            <button key={ic} onClick={() => upd("icon", ic)} style={{
              fontSize: 18, background: form.icon === ic ? T.accent + "33" : "transparent",
              border: `1px solid ${form.icon === ic ? T.accent : T.border}`, borderRadius: 6,
              padding: "3px 6px", cursor: "pointer",
            }}>{ic}</button>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <Field label="Goal Name" value={form.name} onChange={(v) => upd("name", v)} />
        <Field label="Target Amount" type="number" value={form.target_amount} onChange={(v) => upd("target_amount", v)} prefix="£" />
        <Field label="Target Date (optional)" type="month" value={(form.target_date || "").slice(0, 7)} onChange={(v) => upd("target_date", v ? v + "-01" : "")} small />
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <Select label="Auto-track progress from" value={form.link_type} onChange={(v) => upd("link_type", v)}
          options={GOAL_LINK_TYPES} />
        <Field label="Notes (optional)" value={form.description} onChange={(v) => upd("description", v)} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn variant="secondary" onClick={onCancel}>Cancel</Btn>
        <Btn onClick={() => form.name && form.target_amount > 0 && onSave(form)}>Save Goal</Btn>
      </div>
    </div>
  );
}

function GoalsTab({ goals, accounts, netWorth, onAdd, onSave, onDelete }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState(null);

  // Compute current value for a goal based on link_type
  const currentValueFor = (goal) => {
    if (!goal.link_type) return 0;
    if (goal.link_type === "net_worth") return netWorth;
    if (goal.link_type.startsWith("type:")) {
      const t = goal.link_type.slice(5);
      return accounts.filter((a) => a.type === t).reduce((s, a) => s + Math.abs(a.balance), 0);
    }
    return 0;
  };

  const totalGoals = goals.length;
  const achieved = goals.filter((g) => {
    const cv = currentValueFor(g);
    const isPayoff = g.link_type?.startsWith("type:MORTGAGE") || g.link_type?.startsWith("type:CREDIT");
    const prog = g.target_amount > 0
      ? isPayoff ? (1 - cv / g.target_amount) * 100 : (cv / g.target_amount) * 100
      : 0;
    return prog >= 100;
  }).length;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 3px" }}>Financial Goals</h3>
          <p style={{ fontSize: 11.5, color: T.textDim, margin: 0 }}>
            {totalGoals === 0 ? "Set targets and track your progress automatically." : `${achieved} of ${totalGoals} goal${totalGoals !== 1 ? "s" : ""} achieved`}
          </p>
        </div>
        <Btn onClick={() => { setShowAdd(!showAdd); setEditId(null); }}>{showAdd ? "Cancel" : "+ Add Goal"}</Btn>
      </div>

      {showAdd && (
        <GoalForm accounts={accounts} onCancel={() => setShowAdd(false)} onSave={(g) => { onAdd(g); setShowAdd(false); }} />
      )}

      {editId && (
        <GoalForm
          initial={goals.find((g) => g.id === editId)}
          accounts={accounts}
          onCancel={() => setEditId(null)}
          onSave={(g) => { onSave({ ...g, id: editId }); setEditId(null); }}
        />
      )}

      {goals.length === 0 && !showAdd ? (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>🎯</div>
          <div style={{ fontSize: 14, color: T.textMuted, marginBottom: 6 }}>No goals yet</div>
          <div style={{ fontSize: 12, color: T.textDim, marginBottom: 16 }}>
            Add goals like a house deposit, emergency fund, or FIRE number — and track them automatically against your accounts.
          </div>
          <Btn onClick={() => setShowAdd(true)}>Add Your First Goal</Btn>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
          {goals.filter((g) => g.id !== editId).map((g) => (
            <GoalCard
              key={g.id} goal={g}
              currentValue={currentValueFor(g)}
              onEdit={() => { setEditId(g.id); setShowAdd(false); }}
              onDelete={() => onDelete(g.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TOOLS TAB — Salary Sacrifice & Debt Payoff
   ═══════════════════════════════════════════════════════════════════════════ */

function ToolsTab({ profile, accounts, settings, netWorth }) {
  const [activeTool, setActiveTool] = useState("tax-year");

  return (
    <div>
      <div style={{ display: "flex", gap: 3, marginBottom: 18, flexWrap: "wrap" }}>
        <Tab label="Tax Year" active={activeTool === "tax-year"} onClick={() => setActiveTool("tax-year")} />
        <Tab label="FIRE Calculator" active={activeTool === "fire"} onClick={() => setActiveTool("fire")} />
        <Tab label="Carry-Forward" active={activeTool === "carry-forward"} onClick={() => setActiveTool("carry-forward")} />
        <Tab label="Salary Sacrifice" active={activeTool === "salary-sacrifice"} onClick={() => setActiveTool("salary-sacrifice")} />
        <Tab label="Bonus Optimiser" active={activeTool === "bonus"} onClick={() => setActiveTool("bonus")} />
        <Tab label="IHT Estimator" active={activeTool === "iht"} onClick={() => setActiveTool("iht")} />
        <Tab label="Debt Payoff" active={activeTool === "debt-payoff"} onClick={() => setActiveTool("debt-payoff")} />
      </div>
      {activeTool === "tax-year" && <TaxYearDashboard profile={profile} accounts={accounts} settings={settings} onNavigate={setActiveTool} />}
      {activeTool === "fire" && <FIRECalculator profile={profile} accounts={accounts} settings={settings} netWorth={netWorth} />}
      {activeTool === "carry-forward" && <CarryForwardTool profile={profile} settings={settings} />}
      {activeTool === "salary-sacrifice" && <SalarySacrificeTool profile={profile} settings={settings} />}
      {activeTool === "bonus" && <BonusOptimiser profile={profile} settings={settings} />}
      {activeTool === "iht" && <IhtEstimator netWorth={netWorth} accounts={accounts} />}
      {activeTool === "debt-payoff" && <DebtPayoffTool accounts={accounts} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   AI COPILOT TAB
   ═══════════════════════════════════════════════════════════════════════════ */

function AICopilotTab() {
  const [commentary, setCommentary] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchCommentary = async () => {
    setLoading(true);
    setError("");
    setCommentary("");
    try {
      const res = await api.getCommentary();
      if (res.error) {
        setError(res.error + (res.detail ? ` — ${res.detail}` : ""));
      } else {
        setCommentary(res.commentary);
      }
    } catch (e) {
      setError(e.message || "Failed to fetch commentary");
    }
    setLoading(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 4px" }}>AI Financial Copilot</h3>
            <p style={{ fontSize: 11.5, color: T.textDim, margin: 0 }}>
              Powered by Claude. Analyses your current financial position and provides plain-English commentary.
            </p>
          </div>
          <Btn onClick={fetchCommentary} style={{ flexShrink: 0 }}>
            {loading ? "Analysing..." : commentary ? "Refresh Analysis" : "Generate Analysis"}
          </Btn>
        </div>

        {error && (
          <div style={{ background: T.bg, border: `1px solid ${T.red}33`, borderRadius: T.radius, padding: "12px 16px", fontSize: 12.5, color: T.red, lineHeight: 1.6 }}>
            {error.includes("ANTHROPIC_API_KEY") ? (
              <>
                <strong>API key not configured.</strong> Add your Anthropic API key to the Docker environment:
                <pre style={{ marginTop: 8, padding: "8px 12px", background: T.surface, borderRadius: 4, fontSize: 11.5, color: T.textMuted, overflowX: "auto" }}>
                  ANTHROPIC_API_KEY=sk-ant-...
                </pre>
              </>
            ) : error}
          </div>
        )}

        {loading && (
          <div style={{ padding: "40px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 8 }}>Analysing your financial position...</div>
            <div style={{ width: 40, height: 3, background: T.accent, borderRadius: 2, margin: "0 auto", animation: "pulse 1.5s ease-in-out infinite" }} />
            <style>{`@keyframes pulse { 0%, 100% { opacity: 0.3; width: 40px; } 50% { opacity: 1; width: 80px; } }`}</style>
          </div>
        )}

        {commentary && !loading && (
          <div style={{
            background: T.bg, borderRadius: T.radius, padding: "16px 20px",
            fontSize: 13.5, color: T.text, lineHeight: 1.75, whiteSpace: "pre-wrap",
            borderLeft: `3px solid ${T.accent}`,
          }}>
            {commentary}
          </div>
        )}

        {!commentary && !loading && !error && (
          <div style={{ padding: "40px 20px", textAlign: "center", color: T.textDim, fontSize: 13 }}>
            Click <strong>Generate Analysis</strong> to get an AI-powered review of your financial position.
            <br /><br />
            <span style={{ fontSize: 11 }}>Requires ANTHROPIC_API_KEY in your Docker environment. Your data stays on your server — only a summary is sent to the API.</span>
          </div>
        )}
      </div>

      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderLeft: `3px solid ${T.blue}`, borderRadius: T.radius, padding: "12px 16px", fontSize: 11.5, color: T.textMuted, lineHeight: 1.6 }}>
        <strong style={{ color: T.blue }}>Privacy note:</strong> Only a numerical summary of your accounts is sent to the Claude API — no names, addresses, or identifying information. All data is processed on your server. The AI analysis is general commentary, not regulated financial advice.
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   RATES & MORTGAGE TAB
   ═══════════════════════════════════════════════════════════════════════════ */

function RatesMortgageTab({ accounts, settings, onSaveSettings, addToast }) {
  const [rateData, setRateData] = useState(null);
  const [scenarios, setScenarios] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scenarioLoading, setScenarioLoading] = useState(false);
  const [chartRange, setChartRange] = useState("10y");

  const mortgage = accounts.find(a => a.type === "MORTGAGE") || null;
  const [margin, setMargin] = useState(settings?.tracker_margin ?? 0.5);
  const [remainingYears, setRemainingYears] = useState(settings?.mortgage_remaining_years ?? 20);

  // Initialise from settings, fall back to term_end_date calculation
  useEffect(() => {
    if (settings?.tracker_margin != null) setMargin(settings.tracker_margin);
    if (settings?.mortgage_remaining_years != null && settings.mortgage_remaining_years > 0) {
      setRemainingYears(settings.mortgage_remaining_years);
    } else if (mortgage?.term_end_date) {
      const end = new Date(mortgage.term_end_date);
      const now = new Date();
      const yrs = Math.max(1, Math.round((end - now) / (365.25 * 24 * 60 * 60 * 1000)));
      setRemainingYears(yrs);
    }
  }, [settings, mortgage]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await api.boeBaseRate();
        setRateData(data);
      } catch (e) {
        console.error("Failed to fetch rate data", e);
      }
      setLoading(false);
    })();
  }, []);

  // Fetch scenarios when mortgage data is available
  useEffect(() => {
    if (mortgage && rateData) {
      fetchScenarios();
    }
  }, [mortgage, rateData, margin, remainingYears]);

  const fetchScenarios = async () => {
    if (!mortgage) return;
    setScenarioLoading(true);
    try {
      const res = await api.mortgageScenarios({
        balance: Math.abs(mortgage.balance),
        current_rate: mortgage.interest_rate || (rateData?.current_rate || 4.5) + margin,
        remaining_years: remainingYears,
        monthly_payment: Math.abs(mortgage.monthly_contrib || 0),
        tracker_margin: margin,
      });
      setScenarios(res);
    } catch (e) {
      console.error(e);
    }
    setScenarioLoading(false);
  };

  // Filter chart data by range
  const filteredHistory = useMemo(() => {
    if (!rateData?.history?.length) return [];
    const now = new Date();
    const ranges = {
      "5y": 5, "10y": 10, "15y": 15, "all": 100,
    };
    const years = ranges[chartRange] || 10;
    const cutoff = new Date(now.getFullYear() - years, now.getMonth(), 1).toISOString().slice(0, 10);
    return rateData.history.filter(h => h.date >= cutoff);
  }, [rateData, chartRange]);

  // Add tracker rate line to chart data
  const chartData = useMemo(() => {
    return filteredHistory.map(h => ({
      ...h,
      tracker: +(h.rate + margin).toFixed(2),
    }));
  }, [filteredHistory, margin]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: T.textDim, fontSize: 13 }}>Loading BoE rate data...</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Current Rate Banner */}
      {rateData && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 170px", padding: "14px 16px", background: T.surface, borderRadius: T.radius, border: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 10.5, color: T.textMuted, marginBottom: 4, textTransform: "uppercase", fontWeight: 500 }}>BoE Base Rate</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: T.accent, fontFamily: T.mono }}>{rateData.current_rate}%</div>
            <div style={{ fontSize: 10.5, color: T.textDim, marginTop: 2 }}>Since {rateData.current_date}</div>
          </div>
          {mortgage && (
            <>
              <div style={{ flex: "1 1 170px", padding: "14px 16px", background: T.surface, borderRadius: T.radius, border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 10.5, color: T.textMuted, marginBottom: 4, textTransform: "uppercase", fontWeight: 500 }}>Your Tracker Rate</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: T.blue, fontFamily: T.mono }}>{mortgage.interest_rate}%</div>
                <div style={{ fontSize: 10.5, color: T.textDim, marginTop: 2 }}>BBR + {margin}%</div>
              </div>
              <div style={{ flex: "1 1 170px", padding: "14px 16px", background: T.surface, borderRadius: T.radius, border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 10.5, color: T.textMuted, marginBottom: 4, textTransform: "uppercase", fontWeight: 500 }}>Monthly Payment</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: T.text, fontFamily: T.mono }}>{fmtFull(Math.abs(mortgage.monthly_contrib || 0))}</div>
                <div style={{ fontSize: 10.5, color: T.textDim, marginTop: 2 }}>Balance: {fmtFull(Math.abs(mortgage.balance))}</div>
              </div>
              <div style={{ flex: "1 1 170px", padding: "14px 16px", background: T.surface, borderRadius: T.radius, border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 10.5, color: T.textMuted, marginBottom: 4, textTransform: "uppercase", fontWeight: 500 }}>Remaining Term</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: T.amber, fontFamily: T.mono }}>{remainingYears}y</div>
                <div style={{ fontSize: 10.5, color: T.textDim, marginTop: 2 }}>{mortgage.term_end_date || "—"}</div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Base Rate History Chart */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 3px" }}>BoE Base Rate History</h3>
            <p style={{ fontSize: 11, color: T.textDim, margin: 0 }}>
              {mortgage ? "Your tracker rate (BBR + margin) shown in blue" : "Official Bank Rate over time"}
            </p>
          </div>
          <div style={{ display: "flex", gap: 3 }}>
            {["5y", "10y", "15y", "all"].map(r => (
              <button key={r} onClick={() => setChartRange(r)} style={{
                background: chartRange === r ? T.surfaceHover : "transparent",
                color: chartRange === r ? T.accent : T.textDim,
                border: `1px solid ${chartRange === r ? T.border : "transparent"}`,
                borderRadius: 4, padding: "3px 10px", fontSize: 11, cursor: "pointer", fontWeight: 500,
              }}>{r.toUpperCase()}</button>
            ))}
          </div>
        </div>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="brGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={T.accent} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={T.accent} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: T.textDim }} tickFormatter={v => v.slice(0, 7)} interval={Math.max(1, Math.floor(chartData.length / 12))} />
              <YAxis tick={{ fontSize: 10, fill: T.textDim }} tickFormatter={v => `${v}%`} domain={[0, "auto"]} />
              <Tooltip contentStyle={ttStyle()} itemStyle={ttItemStyle()} labelStyle={ttLabelStyle()} formatter={v => `${v}%`} />
              <Area type="stepAfter" dataKey="rate" name="Base Rate" stroke={T.accent} fill="url(#brGrad)" strokeWidth={2} />
              {mortgage && (
                <Area type="stepAfter" dataKey="tracker" name="Your Tracker" stroke={T.blue} fill="none" strokeWidth={2} strokeDasharray="6 3" />
              )}
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ padding: 40, textAlign: "center", color: T.textDim, fontSize: 13 }}>
            {rateData?.fallback ? "Could not fetch live data from BoE. Check your network configuration." : "No historical data available."}
          </div>
        )}
      </div>

      {/* Recent Rate Changes */}
      {rateData?.changes?.length > 0 && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 12px" }}>Recent Rate Decisions</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {rateData.changes.slice().reverse().map((c, i, arr) => {
              const prev = i < arr.length - 1 ? arr[i + 1].rate : c.rate;
              const diff = c.rate - prev;
              const color = diff > 0 ? T.red : diff < 0 ? T.green : T.textDim;
              const arrow = diff > 0 ? "↑" : diff < 0 ? "↓" : "—";
              return (
                <div key={c.date} style={{
                  padding: "6px 10px", background: T.bg, borderRadius: 4, border: `1px solid ${T.border}`,
                  fontSize: 11, display: "flex", alignItems: "center", gap: 6,
                }}>
                  <span style={{ color: T.textDim }}>{c.date.slice(0, 7)}</span>
                  <span style={{ fontFamily: T.mono, fontWeight: 600 }}>{c.rate}%</span>
                  <span style={{ color, fontWeight: 600 }}>{arrow}{diff !== 0 ? ` ${Math.abs(diff).toFixed(2)}` : ""}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Mortgage config */}
      {mortgage && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 12px" }}>Mortgage Configuration</h3>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <Field label="Tracker Margin (above BBR)" type="number" value={margin} onChange={v => setMargin(v)} suffix="%" small />
            <Field label="Remaining Years" type="number" value={remainingYears} onChange={v => setRemainingYears(v)} small />
            <Btn onClick={async () => {
              await onSaveSettings({ ...settings, tracker_margin: margin, mortgage_remaining_years: remainingYears });
              addToast("Mortgage config saved", "success");
            }} style={{ marginBottom: 1 }}>Save</Btn>
          </div>
        </div>
      )}

      {/* Rate Scenarios */}
      {scenarios && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 4px" }}>Rate Change Scenarios</h3>
          <p style={{ fontSize: 11, color: T.textDim, margin: "0 0 14px" }}>
            How your monthly payment changes if the base rate moves
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${T.border}` }}>
                  <th style={{ textAlign: "left", padding: "8px 10px", color: T.textMuted, fontSize: 11, fontWeight: 600 }}>BASE RATE</th>
                  <th style={{ textAlign: "left", padding: "8px 10px", color: T.textMuted, fontSize: 11, fontWeight: 600 }}>YOUR RATE</th>
                  <th style={{ textAlign: "right", padding: "8px 10px", color: T.textMuted, fontSize: 11, fontWeight: 600 }}>MONTHLY</th>
                  <th style={{ textAlign: "right", padding: "8px 10px", color: T.textMuted, fontSize: 11, fontWeight: 600 }}>DIFFERENCE</th>
                  <th style={{ textAlign: "right", padding: "8px 10px", color: T.textMuted, fontSize: 11, fontWeight: 600 }}>TOTAL INTEREST</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.scenarios.map((s, i) => (
                  <tr key={i} style={{
                    borderBottom: `1px solid ${T.border}`,
                    background: s.is_current ? T.accent + "11" : "transparent",
                  }}>
                    <td style={{ padding: "8px 10px", fontFamily: T.mono, fontWeight: s.is_current ? 700 : 400, color: s.is_current ? T.accent : T.text }}>
                      {s.base_rate}%{s.is_current ? " ◄" : ""}
                    </td>
                    <td style={{ padding: "8px 10px", fontFamily: T.mono }}>{s.rate}%</td>
                    <td style={{ padding: "8px 10px", fontFamily: T.mono, textAlign: "right" }}>{fmtFull(s.monthly_payment)}</td>
                    <td style={{
                      padding: "8px 10px", fontFamily: T.mono, textAlign: "right",
                      color: s.diff_monthly > 0 ? T.red : s.diff_monthly < 0 ? T.green : T.textDim,
                    }}>
                      {s.diff_monthly > 0 ? "+" : ""}{s.diff_monthly !== 0 ? fmtFull(s.diff_monthly) : "—"}
                    </td>
                    <td style={{ padding: "8px 10px", fontFamily: T.mono, textAlign: "right", color: T.textMuted }}>{fmtFull(s.total_interest)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Overpayment Scenarios */}
      {scenarios?.overpayments && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 4px" }}>Overpayment Scenarios</h3>
          <p style={{ fontSize: 11, color: T.textDim, margin: "0 0 14px" }}>
            How much you save by overpaying each month at your current rate ({scenarios.current.rate}%)
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${T.border}` }}>
                  <th style={{ textAlign: "left", padding: "8px 10px", color: T.textMuted, fontSize: 11, fontWeight: 600 }}>EXTRA/MONTH</th>
                  <th style={{ textAlign: "right", padding: "8px 10px", color: T.textMuted, fontSize: 11, fontWeight: 600 }}>PAID OFF IN</th>
                  <th style={{ textAlign: "right", padding: "8px 10px", color: T.textMuted, fontSize: 11, fontWeight: 600 }}>TOTAL INTEREST</th>
                  <th style={{ textAlign: "right", padding: "8px 10px", color: T.textMuted, fontSize: 11, fontWeight: 600 }}>INTEREST SAVED</th>
                  <th style={{ textAlign: "right", padding: "8px 10px", color: T.textMuted, fontSize: 11, fontWeight: 600 }}>TIME SAVED</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.overpayments.map((o, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td style={{ padding: "8px 10px", fontFamily: T.mono, fontWeight: i === 0 ? 400 : 600, color: i === 0 ? T.textDim : T.text }}>
                      {i === 0 ? "No overpayment" : fmtFull(o.extra_monthly)}
                    </td>
                    <td style={{ padding: "8px 10px", fontFamily: T.mono, textAlign: "right" }}>
                      {Math.floor(o.months_to_clear / 12)}y {o.months_to_clear % 12}m
                    </td>
                    <td style={{ padding: "8px 10px", fontFamily: T.mono, textAlign: "right", color: T.textMuted }}>{fmtFull(o.total_interest)}</td>
                    <td style={{ padding: "8px 10px", fontFamily: T.mono, textAlign: "right", color: o.interest_saved > 0 ? T.green : T.textDim }}>
                      {o.interest_saved > 0 ? fmtFull(o.interest_saved) : "—"}
                    </td>
                    <td style={{ padding: "8px 10px", fontFamily: T.mono, textAlign: "right", color: o.time_saved_months > 0 ? T.green : T.textDim }}>
                      {o.time_saved_months > 0 ? `${Math.floor(Math.abs(o.time_saved_months) / 12)}y ${Math.abs(o.time_saved_months) % 12}m` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!mortgage && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderLeft: `3px solid ${T.amber}`, borderRadius: T.radius, padding: "14px 18px", fontSize: 12.5, color: T.textMuted, lineHeight: 1.6 }}>
          <strong style={{ color: T.amber }}>No mortgage found.</strong> Add a mortgage account in the Accounts tab to unlock rate change scenarios and overpayment modelling.
        </div>
      )}

      <div style={{ fontSize: 10.5, color: T.textDim, lineHeight: 1.5 }}>
        Base rate data sourced from the Bank of England Statistical Interactive Database (IUDBEDR series). Cached for 24 hours.
        Scenario calculations use standard annuity formulae and do not account for product fees, ERCs, or lender-specific terms.
      </div>
    </div>
  );
}
