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
 *
 * Styling is inline-first; the small class layer emitted by makeGlobalStyles
 * exists only for states inline styles can't express (:hover, :focus-within,
 * media queries). Classes are prefixed c- and paired with the inline styles
 * they modify — the !importants are deliberate, as they must beat inline.
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
  shadow: "0 4px 20px rgba(0,0,0,0.4)",
  shadowLg: "0 12px 48px rgba(0,0,0,0.5)",
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
  shadow: "0 4px 20px rgba(28,32,53,0.10)",
  shadowLg: "0 12px 48px rgba(28,32,53,0.16)",
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
   ICONS — small stroke-style SVGs, coloured via currentColor
   ═══════════════════════════════════════════════════════════════════════════ */

const ICON_PATHS = {
  sun: <><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></>,
  moon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
  camera: <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>,
  signout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></>,
  search: <><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>,
  x: <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
  check: <polyline points="20 6 9 17 4 12" />,
  info: <><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></>,
  warning: <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>,
  zap: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
  chevronUp: <polyline points="18 15 12 9 6 15" />,
  chevronDown: <polyline points="6 9 12 15 18 9" />,
  deltaUp: <path d="M12 5l7 12H5z" fill="currentColor" stroke="none" />,
  deltaDown: <path d="M12 19L5 7h14z" fill="currentColor" stroke="none" />,
};

export function Ico({ name, size = 14, color, strokeWidth = 2, style }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, color, display: "block", ...style }}
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

/* The cairn wordmark — stacked stones, also used as favicon geometry. */
export function CairnLogo({ width = 16, color, style }) {
  return (
    <svg width={width} height={width * 1.25} viewBox="0 0 16 20" fill={color || T.accent} xmlns="http://www.w3.org/2000/svg" style={style}>
      <rect x="5.5" y="0" width="5" height="3.5" rx="0.75" />
      <rect x="3.5" y="5" width="9" height="3.5" rx="0.75" />
      <rect x="1.5" y="10" width="13" height="3.5" rx="0.75" />
      <rect x="0" y="15" width="16" height="4" rx="0.75" />
    </svg>
  );
}

/* Goal-progress meter in the shape of the cairn: stones fill bottom-up as
   progress crosses each quartile. */
export function CairnMeter({ pct = 0, size = 24, color, dimColor, style }) {
  const stones = [
    { x: 0, y: 15, w: 16, h: 4 },
    { x: 1.5, y: 10, w: 13, h: 3.5 },
    { x: 3.5, y: 5, w: 9, h: 3.5 },
    { x: 5.5, y: 0, w: 5, h: 3.5 },
  ];
  const filled = stones.filter((_, i) => pct >= (i + 1) * 25).length;
  return (
    <svg width={size * 0.8} height={size} viewBox="0 0 16 20" role="img" aria-label={`${Math.round(pct)}% complete`} style={style}>
      {stones.map((s, i) => (
        <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx="0.75"
          fill={i < filled ? (color || T.accent) : (dimColor || T.border)}
          style={{ transition: "fill 0.3s ease" }} />
      ))}
    </svg>
  );
}

/* Topographic contour texture — a quiet nod to the waymarker identity.
   Absolutely positioned; parent needs position:relative + overflow:hidden. */
export function TopoPattern({ opacity = 0.05, color, style }) {
  return (
    <svg
      aria-hidden="true" viewBox="0 0 600 400" preserveAspectRatio="xMidYMid slice"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", opacity, ...style }}
    >
      <g fill="none" stroke={color || T.accent} strokeWidth="1">
        {/* main hill */}
        <path d="M430,40 C520,34 590,80 596,142 C602,204 535,250 448,254 C361,258 290,214 287,150 C284,86 340,46 430,40 Z" />
        <path d="M430,62 C502,57 558,93 563,141 C568,189 515,226 447,229 C379,232 325,198 323,150 C321,102 358,67 430,62 Z" />
        <path d="M431,84 C487,80 532,108 536,144 C540,180 498,207 444,209 C390,211 352,184 351,148 C350,112 375,88 431,84 Z" />
        <path d="M432,106 C472,103 504,122 507,147 C510,172 480,190 442,191 C404,192 378,173 378,148 C378,123 392,109 432,106 Z" />
        <path d="M434,128 C458,126 477,137 479,151 C481,165 463,175 440,175 C417,175 403,164 404,150 C405,136 410,130 434,128 Z" />
        {/* small companion hill */}
        <path d="M110,290 C160,286 200,310 203,344 C206,378 168,402 118,404 C68,406 28,382 27,346 C26,310 60,294 110,290 Z" />
        <path d="M111,312 C145,309 172,324 174,346 C176,368 151,384 117,385 C83,386 57,371 57,347 C57,323 77,315 111,312 Z" />
        <path d="M113,334 C131,332 146,340 147,351 C148,362 135,370 117,370 C99,370 88,362 89,351 C90,340 95,336 113,334 Z" />
        {/* drifting open contours */}
        <path d="M-20,80 C60,60 140,95 220,75 C280,60 330,20 400,28" />
        <path d="M-20,120 C70,100 150,135 240,112 C300,97 350,60 420,64" />
        <path d="M180,420 C240,380 320,395 380,360 C440,325 480,330 560,300" />
      </g>
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   FORMATTERS & STYLE HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

const trim1 = (n) => {
  const s = n.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
};

export const fmt = (v) => {
  if (v == null) return "£0";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}£${trim1(abs / 1e6)}m`;
  if (abs >= 1e3) return `${sign}£${trim1(abs / 1e3)}k`;
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

  /* Keyboard focus — inputs handle their own via .c-field, everything else gets a ring */
  button:focus-visible, select:focus-visible, a:focus-visible { outline: 2px solid ${T.accent}88; outline-offset: 2px; }

  /* Hover/focus states inline styles can't express */
  .c-field { transition: border-color 0.15s; }
  .c-field:focus-within { border-color: ${T.accent} !important; }
  .c-hover { transition: border-color 0.15s, background 0.15s; }
  .c-hover:hover { border-color: ${T.borderLight} !important; background: ${T.surfaceHover} !important; }
  .c-btn-primary, .c-btn-secondary, .c-btn-danger { transition: background 0.15s, border-color 0.15s, color 0.15s; }
  .c-btn-primary:hover { background: ${T.accentHover} !important; }
  .c-btn-secondary:hover { border-color: ${T.borderLight} !important; color: ${T.text} !important; background: ${T.surfaceHover} !important; }
  .c-btn-danger:hover { background: ${T.red}1a !important; }
  .c-tab { transition: color 0.12s, border-color 0.12s; }
  .c-tab:hover { color: ${T.text} !important; }

  /* Tab rows — underline indicator sits on the row's bottom hairline */
  .c-tabs { display: flex; gap: 2px; border-bottom: 1px solid ${T.border}; margin-bottom: 18px; flex-wrap: wrap; }
  @media (max-width: 640px) {
    .c-tabs { flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
    .c-tabs::-webkit-scrollbar { display: none; }
    .c-tab { white-space: nowrap; }
  }

  /* Metric cards — 2-up on phones instead of a full-width stack */
  .c-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }

  /* Row actions (reorder arrows) appear on hover where hover exists;
     always visible on touch devices */
  @media (hover: hover) {
    .row-actions { opacity: 0; transition: opacity 0.15s; }
    .c-hover:hover .row-actions, .row-actions:focus-within { opacity: 1; }
  }
`;

export const ttStyle    = () => ({ backgroundColor: T.surface, border: `1px solid ${T.borderLight}`, borderRadius: T.radius, fontSize: 12, color: T.text, padding: "10px 14px", boxShadow: T.shadow });
export const ttItemStyle = () => ({ color: T.text, fontSize: 12, padding: "2px 0" });
export const ttLabelStyle = () => ({ color: T.textMuted, fontSize: 10.5, fontWeight: 600, marginBottom: 4 });

/* ═══════════════════════════════════════════════════════════════════════════
   SHARED COMPONENTS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * delta (optional): { text, good, up, since } — pre-formatted change line,
 * e.g. { text: "+£12,250 (+2.5%)", good: true, up: true, since: "1 Mar" }.
 */
export function MetricCard({ label, value, sub, color, delta }) {
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius,
      padding: "16px 18px", flex: "1 1 200px", minWidth: 0,
    }}>
      <div style={{ fontSize: 10.5, color: T.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: color || T.text, fontFamily: T.mono, letterSpacing: "-0.02em" }}>{value}</div>
      {delta && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 5, fontSize: 10.5 }}>
          <Ico name={delta.up ? "deltaUp" : "deltaDown"} size={8} color={delta.good ? T.green : T.red} />
          <span style={{ color: delta.good ? T.green : T.red, fontFamily: T.mono, fontWeight: 600 }}>{delta.text}</span>
          {delta.since && <span style={{ color: T.textDim }}>since {delta.since}</span>}
        </div>
      )}
      {sub && <div style={{ fontSize: 10.5, color: T.textDim, marginTop: delta ? 3 : 4 }}>{sub}</div>}
    </div>
  );
}

export function InsightCard({ insight }) {
  const colours = { warning: T.red, opportunity: T.amber, good: T.green, info: T.blue };
  const icons = { warning: "warning", opportunity: "zap", good: "check", info: "info" };
  const c = colours[insight.type] || T.textMuted;
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`, borderLeft: `3px solid ${c}`,
      borderRadius: T.radius, padding: "13px 16px", marginBottom: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
        <Ico name={icons[insight.type] || "info"} size={13} color={c} />
        <span style={{ fontWeight: 600, color: c, fontSize: 13 }}>{insight.title}</span>
      </div>
      <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.65 }}>{insight.detail}</div>
    </div>
  );
}

export function Tab({ label, active, onClick }) {
  return (
    <button className="c-tab" onClick={onClick} style={{
      background: "transparent",
      color: active ? T.text : T.textMuted,
      border: "none",
      borderBottom: `2px solid ${active ? T.accent : "transparent"}`,
      marginBottom: -1,
      borderRadius: 0,
      padding: "8px 13px", fontSize: 13,
      fontWeight: active ? 600 : 400, cursor: "pointer",
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
      <div className="c-field" style={{ display: "flex", alignItems: "center", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, overflow: "hidden" }}>
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

/**
 * Bare numeric input — same draft-state pattern as Field, but without the
 * label/wrapper. For places that need a number input inside their own layout
 * (e.g. table rows). Keeps the displayed string in sync with the user's typing
 * so transient states like "5." or "" don't get reverted to the parsed value.
 */
export function NumberInput({ value, onChange, placeholder = "0", style, ...rest }) {
  const [draft, setDraft] = useState(() => numToDraft(value));
  const lastPushed = useRef(value);

  useEffect(() => {
    if (value !== lastPushed.current) {
      setDraft(numToDraft(value));
      lastPushed.current = value;
    }
  }, [value]);

  const handleChange = (e) => {
    const raw = e.target.value;
    if (raw !== "" && !/^-?\d*\.?\d*$/.test(raw)) return;
    setDraft(raw);
    const parsed = parseFloat(raw);
    const next = Number.isNaN(parsed) ? 0 : parsed;
    lastPushed.current = next;
    onChange(next);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={handleChange}
      placeholder={placeholder}
      style={style}
      {...rest}
    />
  );
}

export function Select({ label, value, onChange, options }) {
  return (
    <div style={{ flex: "1 1 200px" }}>
      <label style={{ display: "block", fontSize: 10.5, color: T.textMuted, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500 }}>{label}</label>
      <select className="c-field" value={value} onChange={(e) => onChange(e.target.value)} style={{
        width: "100%", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6,
        color: T.text, padding: "7px 10px", fontSize: 13, outline: "none",
      }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function Btn({ children, onClick, variant = "primary", style: extraStyle, ...rest }) {
  const styles = {
    primary: { background: T.accent, color: T.bg, border: "none", fontWeight: 600 },
    secondary: { background: "transparent", color: T.textMuted, border: `1px solid ${T.border}` },
    danger: { background: "transparent", color: T.red, border: `1px solid ${T.red}44` },
  };
  return (
    <button className={`c-btn-${variant}`} onClick={onClick} style={{
      ...styles[variant], borderRadius: 6, padding: "7px 16px", fontSize: 13,
      cursor: "pointer", display: "inline-flex", alignItems: "center",
      justifyContent: "center", gap: 6, ...extraStyle,
    }} {...rest}>{children}</button>
  );
}
