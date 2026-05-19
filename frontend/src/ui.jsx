/**
 * Shared UI primitives and design tokens.
 *
 * The theme system uses a mutable `T` object that App mutates on every render
 * via Object.assign(T, isDark ? DARK_THEME : LIGHT_THEME). All importers share
 * the same T reference, so child components automatically pick up theme
 * changes when App re-renders.
 *
 * Functions that depend on T values (ttStyle, makeGlobalStyles) are evaluated
 * at call time so they read the current theme.
 */

import { useState, useEffect, useRef } from "react";

/* ═══════════════════════════════════════════════════════════════════════════
   DESIGN TOKENS
   ═══════════════════════════════════════════════════════════════════════════ */

export const DARK_THEME = {
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

export const LIGHT_THEME = {
  bg: "#f0f2f7",
  surface: "#ffffff",
  surfaceHover: "#f5f7fc",
  border: "#dce1ed",
  borderLight: "#c8d0e0",
  text: "#1c2035",
  textMuted: "#5a6280",
  textDim: "#9aa0b8",
  accent: "#2ea898",
  accentHover: "#34bfad",
  green: "#2ea898",
  red: "#d94f61",
  amber: "#c8900a",
  blue: "#3d6fcc",
  purple: "#7c52cc",
  chartPalette: ["#2ea898", "#3d6fcc", "#7c52cc", "#c8900a", "#d9714e", "#3aaa5c"],
  debtPalette: ["#d94f61", "#d9714e"],
  radius: 8,
  font: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  mono: "'IBM Plex Mono', 'SF Mono', monospace",
};

export const T = { ...DARK_THEME };

export const ACCOUNT_LABELS = {
  PENSION_DC: "DC Pension", SIPP: "SIPP", PENSION_DB: "DB / Final Salary Pension",
  ISA_SS: "Stocks & Shares ISA", ISA_CASH: "Cash ISA", ISA_LISA: "Lifetime ISA",
  GIA: "General Investment Account",
  CURRENT: "Current Account", SAVINGS: "Savings Account", PROPERTY: "Property",
  MORTGAGE: "Mortgage", CREDIT_CARD: "Credit Card", LOAN: "Loan",
};

/* ═══════════════════════════════════════════════════════════════════════════
   FORMATTERS & STYLE HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

export const fmt = (v) => {
  if (v == null) return "£0";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}£${(abs / 1e6).toFixed(1)}m`;
  if (abs >= 1e3) return `${sign}£${(abs / 1e3).toFixed(1)}k`;
  return `${sign}£${abs.toFixed(0)}`;
};

export const makeGlobalStyles = () => `
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

export const ttStyle    = () => ({ backgroundColor: T.surface, border: `1px solid ${T.borderLight}`, borderRadius: T.radius, fontSize: 12, color: T.text, padding: "10px 14px", boxShadow: "0 4px 16px rgba(0,0,0,0.15)" });
export const ttItemStyle = () => ({ color: T.text, fontSize: 12, padding: "2px 0" });
export const ttLabelStyle = () => ({ color: T.textMuted, fontSize: 11, fontWeight: 600, marginBottom: 4 });

/* ═══════════════════════════════════════════════════════════════════════════
   SHARED COMPONENTS
   ═══════════════════════════════════════════════════════════════════════════ */

export function MetricCard({ label, value, sub, color }) {
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

export function InsightCard({ insight }) {
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

export function Tab({ label, active, onClick }) {
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

// Convert a numeric value to the string we want to display in the input.
// `0` and null show as empty (with placeholder), so users can type immediately
// without first clearing the field — the controlled-value-snap-back problem.
function numToDraft(v) {
  if (v == null || v === 0) return "";
  return String(v);
}

export function Field({ label, value, onChange, type = "text", prefix, suffix, small, ...rest }) {
  const isNumeric = type === "number";
  // Keep an internal draft string for numeric inputs so transient/empty states
  // (mid-typing, sole minus sign, decimal point) don't get fought by React's
  // controlled-value rendering. We push the parsed value to the parent on each
  // keystroke, but the draft remains as the user typed it.
  const [draft, setDraft] = useState(() => (isNumeric ? numToDraft(value) : ""));
  // Track the last value we pushed so we only reseed the draft when the parent
  // value changes from something *other* than our own push (e.g. external
  // form reset, reseed-from-account-data).
  const lastPushed = useRef(value);

  useEffect(() => {
    if (!isNumeric) return;
    if (value !== lastPushed.current) {
      setDraft(numToDraft(value));
      lastPushed.current = value;
    }
  }, [value, isNumeric]);

  const handleChange = (e) => {
    const raw = e.target.value;
    if (!isNumeric) {
      onChange(raw);
      return;
    }
    // Allow only digits, single decimal, optional leading minus, or empty.
    // Reject anything else (stray letters, scientific notation, multiple dots).
    if (raw !== "" && !/^-?\d*\.?\d*$/.test(raw)) return;
    setDraft(raw);
    const parsed = parseFloat(raw);
    const next = Number.isNaN(parsed) ? 0 : parsed;
    lastPushed.current = next;
    onChange(next);
  };

  return (
    <div style={{ flex: small ? "0 1 130px" : "1 1 200px" }}>
      <label style={{ display: "block", fontSize: 10.5, color: T.textMuted, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500 }}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, overflow: "hidden" }}>
        {prefix && <span style={{ padding: "0 8px", color: T.textDim, fontSize: 12 }}>{prefix}</span>}
        <input
          value={isNumeric ? draft : value}
          onChange={handleChange}
          // Render numerics as text+inputMode to avoid Safari's controlled
          // type=number quirks (notably "0 you can't delete") while still
          // surfacing the decimal keypad on iOS.
          type={isNumeric ? "text" : type}
          inputMode={isNumeric ? "decimal" : undefined}
          placeholder={isNumeric ? "0" : undefined}
          style={{ flex: 1, background: "transparent", border: "none", color: T.text, padding: "7px 10px", fontSize: 13, outline: "none", fontFamily: T.mono, width: "100%" }}
          {...rest}
        />
        {suffix && <span style={{ padding: "0 8px", color: T.textDim, fontSize: 12 }}>{suffix}</span>}
      </div>
    </div>
  );
}

export function Select({ label, value, onChange, options }) {
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

export function Btn({ children, onClick, variant = "primary", style: extraStyle }) {
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
