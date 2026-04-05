import { useState, useMemo, useEffect, useCallback } from "react";
import {
  PieChart, Pie, Cell, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { api } from "./api.js";
import { generateInsights, ASSET_TYPES, LIABILITY_TYPES, fmtFull, ageFromDob } from "./advisor.js";

/* ═══════════════════════════════════════════════════════════════════════════
   DESIGN TOKENS
   ═══════════════════════════════════════════════════════════════════════════ */

const T = {
  bg: "#0b0e14",
  surface: "#141821",
  surfaceHover: "#1a1f2d",
  border: "#222838",
  borderLight: "#2c3344",
  text: "#dfe2ea",
  textMuted: "#7d839a",
  textDim: "#4d5368",
  accent: "#45c4b0",
  accentHover: "#5ad6c2",
  green: "#45c4b0",
  red: "#e85d6f",
  amber: "#e8b84d",
  blue: "#5b8def",
  purple: "#a477e8",
  chartPalette: ["#45c4b0", "#5b8def", "#a477e8", "#e8b84d", "#e87d5d", "#6dc784"],
  debtPalette: ["#e85d6f", "#e87d5d"],
  radius: 8,
  font: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  mono: "'IBM Plex Mono', 'SF Mono', monospace",
};

const ACCOUNT_LABELS = {
  PENSION_DC: "DC Pension", SIPP: "SIPP", ISA_SS: "Stocks & Shares ISA",
  ISA_CASH: "Cash ISA", CURRENT: "Current Account", SAVINGS: "Savings Account",
  PROPERTY: "Property",
  MORTGAGE: "Mortgage", CREDIT_CARD: "Credit Card", LOAN: "Loan",
};

const fmt = (v) => {
  if (v == null) return "£0";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}£${(abs / 1e6).toFixed(1)}m`;
  if (abs >= 1e3) return `${sign}£${(abs / 1e3).toFixed(1)}k`;
  return `${sign}£${abs.toFixed(0)}`;
};

const globalStyles = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${T.bg}; color: ${T.text}; font-family: ${T.font}; -webkit-font-smoothing: antialiased; }
  input, select, button { font-family: inherit; }
  input[type=number] { -moz-appearance: textfield; }
  input::-webkit-outer-spin-button, input::-webkit-inner-spin-button { -webkit-appearance: none; }
  ::selection { background: ${T.accent}33; }
  ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: ${T.bg}; }
  ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 3px; }
  @keyframes toast-in { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  @keyframes toast-out { from { transform: translateX(0); opacity: 1; } to { transform: translateX(100%); opacity: 0; } }
`;

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
   SHARED COMPONENTS
   ═══════════════════════════════════════════════════════════════════════════ */

function MetricCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius,
      padding: "16px 18px", flex: "1 1 200px", minWidth: 170,
    }}>
      <div style={{ fontSize: 11, color: T.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: color || T.text, fontFamily: T.mono, letterSpacing: "-0.02em" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: T.textDim, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function InsightCard({ insight }) {
  const colours = { warning: T.red, opportunity: T.amber, good: T.green, info: T.blue };
  const icons = { warning: "▲", opportunity: "▲", good: "●", info: "■" };
  const c = colours[insight.type] || T.textMuted;
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`, borderLeft: `3px solid ${c}`,
      borderRadius: T.radius, padding: "13px 16px", marginBottom: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
        <span style={{ color: c, fontSize: 11, fontWeight: 700 }}>{icons[insight.type]}</span>
        <span style={{ fontWeight: 600, color: c, fontSize: 13 }}>{insight.title}</span>
      </div>
      <div style={{ fontSize: 12.5, color: T.textMuted, lineHeight: 1.65 }}>{insight.detail}</div>
    </div>
  );
}

function Tab({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: active ? T.surface : "transparent",
      color: active ? T.accent : T.textMuted,
      border: `1px solid ${active ? T.border : "transparent"}`,
      borderRadius: 6, padding: "7px 15px", fontSize: 13,
      fontWeight: active ? 600 : 400, cursor: "pointer", transition: "all 0.12s",
    }}>{label}</button>
  );
}

function Field({ label, value, onChange, type = "text", prefix, suffix, small, ...rest }) {
  return (
    <div style={{ flex: small ? "0 1 130px" : "1 1 200px" }}>
      <label style={{ display: "block", fontSize: 10.5, color: T.textMuted, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500 }}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, overflow: "hidden" }}>
        {prefix && <span style={{ padding: "0 8px", color: T.textDim, fontSize: 12 }}>{prefix}</span>}
        <input value={value} onChange={(e) => onChange(type === "number" ? parseFloat(e.target.value) || 0 : e.target.value)} type={type}
          style={{ flex: 1, background: "transparent", border: "none", color: T.text, padding: "7px 10px", fontSize: 13, outline: "none", fontFamily: T.mono, width: "100%" }} {...rest} />
        {suffix && <span style={{ padding: "0 8px", color: T.textDim, fontSize: 12 }}>{suffix}</span>}
      </div>
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <div style={{ flex: "1 1 200px" }}>
      <label style={{ display: "block", fontSize: 10.5, color: T.textMuted, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500 }}>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{
        width: "100%", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6,
        color: T.text, padding: "7px 10px", fontSize: 13, outline: "none",
      }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function Btn({ children, onClick, variant = "primary", style: extraStyle }) {
  const styles = {
    primary: { background: T.accent, color: T.bg, border: "none", fontWeight: 600 },
    secondary: { background: "transparent", color: T.textMuted, border: `1px solid ${T.border}` },
    danger: { background: "transparent", color: T.red, border: `1px solid ${T.red}44` },
  };
  return (
    <button onClick={onClick} style={{
      ...styles[variant], borderRadius: 6, padding: "7px 16px", fontSize: 12.5,
      cursor: "pointer", transition: "all 0.12s", ...extraStyle,
    }}>{children}</button>
  );
}

const ttStyle = {
  backgroundColor: "#1a1f2e", border: `1px solid ${T.borderLight}`, borderRadius: T.radius,
  fontSize: 12, color: "#f0f1f5", padding: "10px 14px",
  boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
};
const ttItemStyle = { color: "#f0f1f5", fontSize: 12, padding: "2px 0" };
const ttLabelStyle = { color: "#b0b4c4", fontSize: 11, fontWeight: 600, marginBottom: 4 };

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
      setError("Invalid credentials");
    }
    setLoading(false);
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", padding: 20 }}>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 32, width: "100%", maxWidth: 360 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 28, color: T.accent, fontWeight: 700, marginBottom: 6 }}>▲</div>
          <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Cairn</h1>
          <p style={{ fontSize: 12, color: T.textDim }}>Sign in to continue</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Username" value={username} onChange={setUsername} />
          <Field label="Password" value={password} onChange={setPassword} type="password"
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()} />
          {error && <div style={{ color: T.red, fontSize: 12 }}>{error}</div>}
          <Btn onClick={handleSubmit} style={{ marginTop: 8, padding: "10px 16px" }}>
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

function AccountRow({ account, editing, onToggle, onSave, onDelete }) {
  const [form, setForm] = useState({ ...account });
  const isLiab = LIABILITY_TYPES.has(account.type);
  const display = isLiab ? Math.abs(account.balance) : account.balance;

  useEffect(() => { setForm({ ...account }); }, [account]);

  const upd = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, marginBottom: 6, overflow: "hidden" }}>
      <div onClick={onToggle} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 16px", cursor: "pointer" }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 500 }}>{account.name}</div>
          <div style={{ fontSize: 11, color: T.textMuted }}>{ACCOUNT_LABELS[account.type]} · {account.provider || "—"}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: isLiab ? T.red : T.green, fontFamily: T.mono }}>
            {isLiab ? "-" : ""}{fmtFull(display)}
          </div>
          {account.interest_rate > 0 && <div style={{ fontSize: 10.5, color: T.textDim }}>{account.interest_rate}% {account.rate_type || "APR"}</div>}
        </div>
      </div>
      {editing && (
        <div style={{ padding: "12px 16px", borderTop: `1px solid ${T.border}`, background: T.bg }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <Field label="Name" value={form.name} onChange={(v) => upd("name", v)} />
            <Field label="Provider" value={form.provider || ""} onChange={(v) => upd("provider", v)} />
            <Field label={form.type === "PROPERTY" ? "Estimated Value" : "Balance"} type="number" value={form.balance} onChange={(v) => upd("balance", v)} prefix="£" />
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            {(form.type === "ISA_SS" || form.type === "ISA_CASH" || form.type === "SAVINGS") && (
              <Field label="Monthly Contrib" type="number" value={form.monthly_contrib || 0} onChange={(v) => upd("monthly_contrib", v)} prefix="£" small />
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
    term_end_date: "", notes: "",
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
        <Field label={isLiab ? "Outstanding Balance" : "Current Value"} type="number"
          value={Math.abs(form.balance)} onChange={(v) => upd("balance", isLiab ? -v : v)} prefix="£" />
        <Field label="Monthly Contribution / Payment" type="number" value={Math.abs(form.monthly_contrib)}
          onChange={(v) => upd("monthly_contrib", isLiab ? -v : v)} prefix="£" small />
        {isLiab && <Field label="Interest Rate" type="number" value={form.interest_rate} onChange={(v) => upd("interest_rate", v)} suffix="%" small />}
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

  const takeSnapshot = async () => {
    try {
      await api.takeSnapshot();
      await loadData();
      addToast("Snapshot recorded", "success");
    } catch (e) {
      addToast("Failed to take snapshot", "error");
    }
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
  if (!authed) return <><style>{globalStyles}</style><LoginScreen onLogin={handleLogin} /></>;
  if (!data) return <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", color: T.textDim }}>Loading data...</div>;

  const { profile, accounts, settings, snapshots } = data;
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
  const projData = (() => {
    const pts = [];
    const totalPensions = accounts.filter((a) => a.type === "PENSION_DC" || a.type === "SIPP").reduce((s, a) => s + a.balance, 0);
    const totalISAs = accounts.filter((a) => a.type === "ISA_SS" || a.type === "ISA_CASH").reduce((s, a) => s + a.balance, 0);
    const mpc = profile.gross_salary * ((profile.pension_contrib_pct + profile.employer_contrib_pct) / 100) / 12;
    const mic = accounts.filter((a) => a.type === "ISA_SS" || a.type === "ISA_CASH").reduce((s, a) => s + (a.monthly_contrib || 0), 0);
    const rg = (settings.growth_rate - settings.inflation_rate) / 100 / 12;
    let p = totalPensions, i = totalISAs;
    for (let y = 0; y <= Math.min(ytr + 5, 35); y++) {
      pts.push({ year: new Date().getFullYear() + y, age: age + y, pensions: Math.round(p), isas: Math.round(i), total: Math.round(p + i) });
      for (let m = 0; m < 12; m++) { p = p * (1 + rg) + mpc; i = i * (1 + rg) + mic; }
    }
    return pts;
  })();

  const retirementPot = projData.find((p) => p.age === profile.retirement_age)?.total || 0;

  return (
    <>
      <style>{globalStyles}</style>
      <ToastContainer />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 16px" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 22 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: T.accent, letterSpacing: "-0.02em", margin: 0 }}>▲ Cairn</h1>
            <p style={{ fontSize: 12, color: T.textMuted, marginTop: 3 }}>
              {profile.name ? `${profile.name} · ` : ""}Age {age}{ytr > 0 ? ` · ${ytr}y to retirement` : ""}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
          {[["overview", "Overview"], ["accounts", "Accounts"], ["projections", "Projections"], ["advisor", "Advisor"], ["rates", "Rates & Mortgage"], ["tools", "Tools"], ["ai", "AI Copilot"], ["settings", "Settings"]].map(([id, l]) => (
            <Tab key={id} label={l} active={tab === id} onClick={() => setTab(id)} />
          ))}
        </div>

        {/* ── OVERVIEW ─────────────────────────────────────────── */}
        {tab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 14px" }}>Net Worth Over Time</h3>
              {snapshots.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={snapshots}>
                    <defs><linearGradient id="nwG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={T.accent} stopOpacity={0.3} /><stop offset="100%" stopColor={T.accent} stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: T.textDim }} tickFormatter={(v) => v.slice(0, 7)} />
                    <YAxis tick={{ fontSize: 10, fill: T.textDim }} tickFormatter={fmt} />
                    <Tooltip contentStyle={ttStyle} itemStyle={ttItemStyle} labelStyle={ttLabelStyle} formatter={(v) => fmtFull(v)} />
                    <Area type="monotone" dataKey="net_worth" stroke={T.accent} fill="url(#nwG)" strokeWidth={2} dot={false} name="Net Worth" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ padding: 40, textAlign: "center", color: T.textDim, fontSize: 13 }}>
                  No snapshots yet. Click <strong>📸 Snapshot</strong> to record your current net worth.
                </div>
              )}
            </div>

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
                        <Tooltip contentStyle={ttStyle} itemStyle={ttItemStyle} labelStyle={ttLabelStyle} formatter={(v) => fmtFull(v)} />
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
                  {filteredAssets.map((a) => (
                    <AccountRow key={a.id} account={a} editing={editId === a.id}
                      onToggle={() => setEditId(editId === a.id ? null : a.id)}
                      onSave={saveAccount} onDelete={() => removeAccount(a.id)} />
                  ))}
                </div>
              )}
              {filteredLiabilities.length > 0 && (
                <div>
                  <h4 style={{ fontSize: 12, color: T.red, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>Liabilities</h4>
                  {filteredLiabilities.map((a) => (
                    <AccountRow key={a.id} account={a} editing={editId === a.id}
                      onToggle={() => setEditId(editId === a.id ? null : a.id)}
                      onSave={saveAccount} onDelete={() => removeAccount(a.id)} />
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
        {tab === "projections" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 3px" }}>Investment Growth Projection</h3>
              <p style={{ fontSize: 11, color: T.textDim, margin: "0 0 14px" }}>
                Real returns ({settings.growth_rate}% growth − {settings.inflation_rate}% inflation) · Today's money
              </p>
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={projData}>
                  <defs>
                    <linearGradient id="pG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={T.blue} stopOpacity={0.2} /><stop offset="100%" stopColor={T.blue} stopOpacity={0} /></linearGradient>
                    <linearGradient id="iG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={T.green} stopOpacity={0.2} /><stop offset="100%" stopColor={T.green} stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
                  <XAxis dataKey="year" tick={{ fontSize: 10, fill: T.textDim }} />
                  <YAxis tick={{ fontSize: 10, fill: T.textDim }} tickFormatter={fmt} />
                  <Tooltip contentStyle={ttStyle} itemStyle={ttItemStyle} labelStyle={ttLabelStyle} formatter={(v) => fmtFull(v)} labelFormatter={(v) => `Year ${v}`} />
                  <Area type="monotone" dataKey="pensions" name="Pensions" stroke={T.blue} fill="url(#pG)" strokeWidth={2} stackId="1" />
                  <Area type="monotone" dataKey="isas" name="ISAs" stroke={T.green} fill="url(#iG)" strokeWidth={2} stackId="1" />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 14px" }}>Retirement Readiness</h3>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {[
                  { label: "Projected pot at retirement", value: fmtFull(retirementPot), color: T.accent },
                  { label: "4% drawdown (annual)", value: fmtFull(Math.round(retirementPot * 0.04)), color: T.blue },
                  { label: "4% drawdown (monthly)", value: fmtFull(Math.round(retirementPot * 0.04 / 12)), color: T.green },
                  { label: "State Pension (est.)", value: "~£11,500/yr", color: T.amber },
                ].map((m, i) => (
                  <div key={i} style={{ flex: "1 1 170px", padding: "12px 14px", background: T.bg, borderRadius: T.radius, border: `1px solid ${T.border}` }}>
                    <div style={{ fontSize: 10.5, color: T.textMuted, marginBottom: 4, textTransform: "uppercase", fontWeight: 500 }}>{m.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: m.color, fontFamily: T.mono }}>{m.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── ADVISOR ──────────────────────────────────────────── */}
        {tab === "advisor" && (
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 4px" }}>Financial Insights</h3>
            <p style={{ fontSize: 11.5, color: T.textDim, margin: "0 0 16px" }}>Rule-based analysis · Not regulated financial advice</p>
            {insights.map((ins, i) => <InsightCard key={i} insight={ins} />)}
            {insights.length === 0 && <p style={{ color: T.textMuted, fontSize: 13, padding: 20 }}>Add accounts and profile info to generate insights.</p>}
          </div>
        )}

        {/* ── SETTINGS ─────────────────────────────────────────── */}
        {tab === "settings" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <ProfileSettings profile={profile} onSave={saveProfile} saving={saving} />
            <AssumptionSettings settings={settings} onSave={saveSettings} saving={saving} />
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
          <ToolsTab profile={profile} accounts={accounts} settings={settings} />
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
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Btn onClick={() => onSave(form)}>{saving ? "Saving..." : "Save Settings"}</Btn>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TOOLS TAB — Salary Sacrifice & Debt Payoff
   ═══════════════════════════════════════════════════════════════════════════ */

function ToolsTab({ profile, accounts, settings }) {
  const [activeTool, setActiveTool] = useState("salary-sacrifice");

  return (
    <div>
      <div style={{ display: "flex", gap: 3, marginBottom: 18 }}>
        <Tab label="Salary Sacrifice" active={activeTool === "salary-sacrifice"} onClick={() => setActiveTool("salary-sacrifice")} />
        <Tab label="Debt Payoff" active={activeTool === "debt-payoff"} onClick={() => setActiveTool("debt-payoff")} />
      </div>
      {activeTool === "salary-sacrifice" && <SalarySacrificeTool profile={profile} />}
      {activeTool === "debt-payoff" && <DebtPayoffTool accounts={accounts} />}
    </div>
  );
}

function SalarySacrificeTool({ profile }) {
  const [currentPct, setCurrentPct] = useState(profile.pension_contrib_pct || 5);
  const [proposedPct, setProposedPct] = useState(Math.min((profile.pension_contrib_pct || 5) + 5, 40));
  const [employerPct, setEmployerPct] = useState(profile.employer_contrib_pct || 3);
  const [gross, setGross] = useState(profile.gross_salary || 50000);
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
      });
      setResult(res);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => { calculate(); }, []);

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
        <p style={{ fontSize: 11.5, color: T.textDim, margin: "0 0 16px" }}>
          Uses Scottish income tax bands (2025/26). Shows the true cost of increasing pension contributions via salary sacrifice.
        </p>
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

function DebtPayoffTool({ accounts: allAccounts }) {
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
        <p style={{ fontSize: 11.5, color: T.textDim, margin: "0 0 16px" }}>
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
                  {s.best && <span style={{ fontSize: 10, background: s.color + "22", color: s.color, padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>BEST</span>}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, fontFamily: T.mono, color: s.color }}>
                  {Math.floor(s.months / 12)}y {s.months % 12}m
                </div>
                <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>
                  Total interest: {fmtFull(s.interest)}
                </div>
              </div>
            ))}
          </div>

          {result.savings_vs_minimum.interest_saved > 0 && (
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderLeft: `3px solid ${T.green}`, borderRadius: T.radius, padding: "12px 16px", fontSize: 12.5, color: T.textMuted, lineHeight: 1.6 }}>
              Paying an extra {fmtFull(extraMonthly)}/month saves you <strong style={{ color: T.green }}>{fmtFull(result.savings_vs_minimum.interest_saved)}</strong> in interest and clears your debt <strong style={{ color: T.green }}>{result.savings_vs_minimum.months_saved} months</strong> sooner compared to minimum payments only.
            </div>
          )}
        </>
      )}
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
              <Tooltip contentStyle={ttStyle} itemStyle={ttItemStyle} labelStyle={ttLabelStyle} formatter={v => `${v}%`} />
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
