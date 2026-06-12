import { useState, useEffect, useMemo } from "react";
import { T, Btn, NumberInput } from "../ui.jsx";
import { fmtFull, ageFromDob } from "../advisor.js";
import {
  ISA_ANNUAL_ALLOWANCE, PENSION_ANNUAL_ALLOWANCE,
  LISA_ANNUAL_ALLOWANCE, LISA_BONUS_PCT, LISA_OPEN_MAX_AGE, LISA_CONTRIB_MAX_AGE,
  CGT_ANNUAL_ALLOWANCE, CGT_BASIC_RATE_PCT, CGT_HIGHER_RATE_PCT,
  PERSONAL_ALLOWANCE, PERSONAL_ALLOWANCE_TAPER_START, PERSONAL_ALLOWANCE_TAPER_END,
  SCOTLAND_HIGHER_RATE_THRESHOLD, RUK_HIGHER_RATE_THRESHOLD,
  AA_TAPER_THRESHOLD_INCOME, AA_TAPER_ADJUSTED_INCOME, AA_TAPER_MIN_ALLOWANCE,
  HICBC_THRESHOLD_START, HICBC_THRESHOLD_END,
  CB_WEEKLY_FIRST_CHILD, CB_WEEKLY_ADDITIONAL_CHILD,
  MARRIAGE_ALLOWANCE_TRANSFER, MARRIAGE_ALLOWANCE_SAVING,
  MARRIAGE_ALLOWANCE_SPOUSE_MAX,
  getPriorTaxYears, daysUntilTaxYearEnd,
} from "../constants.js";

// ── Card primitives ──────────────────────────────────────────────────────────

function ProgressBar({ pct, color }) {
  const p = Math.max(0, Math.min(100, pct || 0));
  return (
    <div style={{
      width: "100%", height: 5, background: T.bg, borderRadius: 3,
      overflow: "hidden", margin: "6px 0 10px",
    }}>
      <div style={{ width: `${p}%`, height: "100%", background: color, transition: "width 0.3s ease" }} />
    </div>
  );
}

function CardShell({ title, color, children }) {
  return (
    <div style={{
      flex: "1 1 300px", minWidth: 280, padding: 16,
      background: T.surface, border: `1px solid ${T.border}`,
      borderLeft: `3px solid ${color}`, borderRadius: T.radius,
      display: "flex", flexDirection: "column",
    }}>
      <div style={{
        fontSize: 10.5, fontWeight: 600, color: T.textMuted,
        textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8,
      }}>{title}</div>
      {children}
    </div>
  );
}

function AllowanceCard({ title, used, allowance, color, sub, cta }) {
  const pct = allowance > 0 ? (used / allowance) * 100 : 0;
  const remaining = Math.max(0, allowance - used);
  return (
    <CardShell title={title} color={color}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: T.mono }}>{fmtFull(Math.round(used))}</div>
        <div style={{ fontSize: 12, color: T.textDim, fontFamily: T.mono }}>/ {fmtFull(Math.round(allowance))}</div>
        <div style={{ marginLeft: "auto", fontSize: 10.5, color: T.textDim, fontFamily: T.mono }}>
          {Math.min(100, pct).toFixed(0)}%
        </div>
      </div>
      <ProgressBar pct={pct} color={color} />
      <div style={{ fontSize: 10.5, color: T.textMuted, fontFamily: T.mono, marginBottom: 8 }}>
        {remaining > 0 ? `${fmtFull(remaining)} remaining` : "Allowance maxed"}
      </div>
      <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.6, flex: 1 }}>{sub}</div>
      {cta && <div style={{ marginTop: 10 }}>{cta}</div>}
    </CardShell>
  );
}

function ExposureCard({ title, lost, total, color, sub, cta }) {
  const pct = total > 0 ? (lost / total) * 100 : 0;
  return (
    <CardShell title={title} color={color}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: T.mono }}>
          -{fmtFull(Math.round(lost))}
        </div>
        <div style={{ fontSize: 12, color: T.textDim, fontFamily: T.mono }}>
          of {fmtFull(Math.round(total))} at risk
        </div>
        <div style={{ marginLeft: "auto", fontSize: 10.5, color: T.textDim, fontFamily: T.mono }}>
          {Math.min(100, pct).toFixed(0)}%
        </div>
      </div>
      <ProgressBar pct={pct} color={color} />
      <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.6, flex: 1 }}>{sub}</div>
      {cta && <div style={{ marginTop: 10 }}>{cta}</div>}
    </CardShell>
  );
}

function InfoCard({ title, color, body, cta }) {
  return (
    <CardShell title={title} color={color}>
      <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.7, flex: 1 }}>{body}</div>
      {cta && <div style={{ marginTop: 10 }}>{cta}</div>}
    </CardShell>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function TaxYearDashboard({ profile, accounts, settings, onNavigate }) {
  const taxYear = settings.tax_year || "2025/26";
  const region = settings.tax_region || "scotland";
  const age = ageFromDob(profile.dob);
  const days = daysUntilTaxYearEnd();
  const monthsLeft = Math.max(1, Math.ceil(days / 30.44));

  // ── ISA Allowance (incl. LISA, which counts toward the £20k overall) ──
  const isaMonthly = accounts
    .filter((a) => a.type === "ISA_SS" || a.type === "ISA_CASH" || a.type === "ISA_LISA")
    .reduce((s, a) => s + (a.monthly_contrib || 0), 0);
  const isaAnnual = isaMonthly * 12;
  const isaAllowance = settings.isa_allowance || ISA_ANNUAL_ALLOWANCE;
  const isaRemaining = Math.max(0, isaAllowance - isaAnnual);

  // ── LISA sub-allowance ──
  const lisaAccounts = accounts.filter((a) => a.type === "ISA_LISA");
  const hasLisa = lisaAccounts.length > 0;
  const canStillContribLisa = age < LISA_CONTRIB_MAX_AGE;
  const lisaAnnual = lisaAccounts.reduce((s, a) => s + (a.monthly_contrib || 0), 0) * 12;
  const lisaRemaining = Math.max(0, LISA_ANNUAL_ALLOWANCE - lisaAnnual);
  const lisaBonusMissed = Math.round(lisaRemaining * (LISA_BONUS_PCT / 100));
  const lisaBonusEarned = Math.round(Math.min(lisaAnnual, LISA_ANNUAL_ALLOWANCE) * (LISA_BONUS_PCT / 100));

  // ── Pension Annual Allowance (matches advisor.js logic) ──
  const workplaceAnnual = profile.gross_salary
    * ((profile.pension_contrib_pct + profile.employer_contrib_pct) / 100);
  const dcMonthly = accounts.filter((a) => a.type === "PENSION_DC").reduce((s, a) => s + (a.monthly_contrib || 0), 0);
  // SIPP contribs are assumed RAS (net of 20% basic-rate relief at source) so gross up
  const sippMonthlyGross = accounts.filter((a) => a.type === "SIPP").reduce((s, a) => s + (a.monthly_contrib || 0), 0) / 0.8;
  const pensionAnnual = workplaceAnnual + (dcMonthly + sippMonthlyGross) * 12;

  const baseAA = settings.pension_annual_allowance || PENSION_ANNUAL_ALLOWANCE;
  let pensionAA = baseAA;
  let aaTapered = false;
  if (profile.gross_salary > AA_TAPER_THRESHOLD_INCOME) {
    const employer = profile.gross_salary * ((profile.employer_contrib_pct || 0) / 100);
    const adjProxy = profile.gross_salary + employer;
    if (adjProxy > AA_TAPER_ADJUSTED_INCOME) {
      const excess = adjProxy - AA_TAPER_ADJUSTED_INCOME;
      const reduction = Math.min(Math.floor(excess / 2), baseAA - AA_TAPER_MIN_ALLOWANCE);
      pensionAA = Math.max(AA_TAPER_MIN_ALLOWANCE, baseAA - reduction);
      aaTapered = true;
    }
  }

  // Carry-forward — read the CarryForwardTool's localStorage entry if any.
  // Lets the AA card surface any prior-year unused capacity the user has entered.
  const carryForwardAvailable = useMemo(() => {
    try {
      const raw = localStorage.getItem(`cairn_carry_forward_${taxYear}`);
      if (!raw) return 0;
      const data = JSON.parse(raw);
      return getPriorTaxYears(taxYear, 3).reduce(
        (s, y) => s + Math.max(0, y.allowance - (data[y.label] || 0)), 0
      );
    } catch { return 0; }
  }, [taxYear]);

  // ── CGT Annual Exempt Amount (realised gains are user-entered) ──
  const giaAccounts = accounts.filter((a) => a.type === "GIA");
  const hasGia = giaAccounts.length > 0;
  const unrealisedGain = giaAccounts.reduce((s, a) => s + (a.unrealised_gain || 0), 0);
  const cgtKey = `cairn_cgt_realised_${taxYear}`;
  const [cgtRealised, setCgtRealised] = useState(() => {
    try { return Number(localStorage.getItem(cgtKey)) || 0; } catch { return 0; }
  });
  useEffect(() => {
    try { localStorage.setItem(cgtKey, String(cgtRealised)); } catch {}
  }, [cgtKey, cgtRealised]);
  // Reseed when tax year rolls over
  useEffect(() => {
    try { setCgtRealised(Number(localStorage.getItem(cgtKey)) || 0); } catch {}
  }, [cgtKey]);
  const cgtRate = (region === "scotland"
    ? profile.gross_salary > SCOTLAND_HIGHER_RATE_THRESHOLD
    : profile.gross_salary > RUK_HIGHER_RATE_THRESHOLD)
    ? CGT_HIGHER_RATE_PCT : CGT_BASIC_RATE_PCT;
  const cgtRemaining = Math.max(0, CGT_ANNUAL_ALLOWANCE - cgtRealised);

  // ── Personal Allowance taper (only if > £100k) ──
  const showPA = profile.gross_salary > PERSONAL_ALLOWANCE_TAPER_START;
  const paTaperAmount = showPA
    ? Math.min(profile.gross_salary - PERSONAL_ALLOWANCE_TAPER_START,
               PERSONAL_ALLOWANCE_TAPER_END - PERSONAL_ALLOWANCE_TAPER_START)
    : 0;
  const paLost = Math.round(paTaperAmount / 2);
  const paRestoreSacrifice = Math.min(profile.gross_salary - PERSONAL_ALLOWANCE_TAPER_START, 25140);

  // ── HICBC (only if children + salary > £60k) ──
  const childrenCount = profile.children_count || 0;
  const showHicbc = childrenCount > 0 && profile.gross_salary > HICBC_THRESHOLD_START;
  const cbAnnual = Math.round(
    CB_WEEKLY_FIRST_CHILD * 52
    + CB_WEEKLY_ADDITIONAL_CHILD * 52 * Math.max(0, childrenCount - 1)
  );
  const hicbcPct = showHicbc
    ? Math.min(100, Math.max(0, Math.floor((profile.gross_salary - HICBC_THRESHOLD_START) / 200)))
    : 0;
  const hicbcClawed = Math.round(cbAnnual * hicbcPct / 100);
  const hicbcSacrificeToZero = Math.round(profile.gross_salary - HICBC_THRESHOLD_START);

  // ── Marriage Allowance ──
  const higherRateThreshold = region === "scotland" ? SCOTLAND_HIGHER_RATE_THRESHOLD : RUK_HIGHER_RATE_THRESHOLD;
  const showMA = profile.spouse_income > 0
    && profile.spouse_income <= MARRIAGE_ALLOWANCE_SPOUSE_MAX
    && profile.gross_salary > PERSONAL_ALLOWANCE
    && profile.gross_salary < higherRateThreshold;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header strip */}
      <div style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: T.radius, padding: 18,
        display: "flex", justifyContent: "space-between",
        alignItems: "center", flexWrap: "wrap", gap: 18,
      }}>
        <div>
          <div style={{ fontSize: 10.5, color: T.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Tax Year</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: T.text, fontFamily: T.mono }}>{taxYear}</div>
          <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>
            {region === "scotland" ? "🏴󠁧󠁢󠁳󠁣󠁴󠁿 Scotland" : "🏴󠁧󠁢󠁥󠁮󠁧󠁿 England / Wales / NI"}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10.5, color: T.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Days to 5 April</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: days <= 60 ? T.amber : T.accent, fontFamily: T.mono }}>{days}</div>
          <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>
            ~{monthsLeft} month{monthsLeft !== 1 ? "s" : ""} left
          </div>
        </div>
      </div>

      <p style={{ fontSize: 12, color: T.textDim, margin: "0 2px", lineHeight: 1.6 }}>
        Snapshot of your annual UK tax allowances. Most are <em>use-it-or-lose-it</em> and reset on 6 April —
        only the Pension Annual Allowance allows carry-forward from the prior 3 tax years.
      </p>

      {/* Allowance cards */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>

        {/* ─ ISA Allowance ─ */}
        <AllowanceCard
          title="ISA Allowance"
          used={isaAnnual}
          allowance={isaAllowance}
          color={T.accent}
          sub={
            isaRemaining > 0
              ? <>From monthly contributions across S&amp;S, Cash and Lifetime ISAs. ~{fmtFull(Math.round(isaRemaining / monthsLeft))}/month for {monthsLeft} month{monthsLeft !== 1 ? "s" : ""} would max it out, or a one-off lump sum.</>
              : <>Maxed for {taxYear} — well done. Allowance resets on 6 April.</>
          }
        />

        {/* ─ LISA sub-allowance ─ */}
        {hasLisa && canStillContribLisa && (
          <AllowanceCard
            title="LISA Sub-allowance"
            used={lisaAnnual}
            allowance={LISA_ANNUAL_ALLOWANCE}
            color={T.purple}
            sub={
              lisaRemaining > 0
                ? <>Every £1 you add gets a 25p government bonus. Maxing the headroom would unlock <strong>{fmtFull(lisaBonusMissed)}</strong> of free money. Contribute until age {LISA_CONTRIB_MAX_AGE}.</>
                : <>LISA maxed — earned <strong>{fmtFull(lisaBonusEarned)}</strong> in government bonus this year.</>
            }
          />
        )}
        {!hasLisa && age >= 18 && age < LISA_OPEN_MAX_AGE && (
          <InfoCard
            title="LISA Worth Considering"
            color={T.purple}
            body={<>
              You're eligible to open a Lifetime ISA before age {LISA_OPEN_MAX_AGE}.
              Up to £{LISA_ANNUAL_ALLOWANCE.toLocaleString()}/year contribution attracts a 25% government bonus
              (up to £1,000/year) — usable for a first home or from age 60. Counts within the overall £20k ISA limit.
              Unauthorised withdrawals incur a 25% penalty, so only for genuine long-term/property savings.
            </>}
          />
        )}

        {/* ─ Pension Annual Allowance ─ */}
        <AllowanceCard
          title={aaTapered ? "Pension AA (Tapered)" : "Pension Annual Allowance"}
          used={Math.round(pensionAnnual)}
          allowance={Math.round(pensionAA)}
          color={T.blue}
          sub={
            <>
              Workplace contribs ({fmtFull(Math.round(workplaceAnnual))}/yr) + per-account DC/SIPP contribs.
              {aaTapered && <> Adjusted income above £{AA_TAPER_ADJUSTED_INCOME.toLocaleString()} tapers your allowance to ~{fmtFull(pensionAA)} (£10k floor).</>}
              {carryForwardAvailable > 0 && <> Plus <strong>{fmtFull(carryForwardAvailable)}</strong> carry-forward from prior 3 tax years (entered in the Carry-Forward tool).</>}
              {carryForwardAvailable === 0 && <> Prior-year unused allowance can be carried forward — open the Carry-Forward tool to record it.</>}
            </>
          }
          cta={onNavigate && <Btn variant="secondary" onClick={() => onNavigate("carry-forward")} style={{ fontSize: 10.5 }}>Carry-Forward tool →</Btn>}
        />

        {/* ─ CGT exempt amount ─ */}
        {hasGia && (
          <CardShell title="CGT Annual Exempt Amount" color={T.amber}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: T.amber, fontFamily: T.mono }}>{fmtFull(cgtRealised)}</div>
              <div style={{ fontSize: 12, color: T.textDim, fontFamily: T.mono }}>/ {fmtFull(CGT_ANNUAL_ALLOWANCE)}</div>
              <div style={{ marginLeft: "auto", fontSize: 10.5, color: T.textDim, fontFamily: T.mono }}>
                {Math.min(100, (cgtRealised / CGT_ANNUAL_ALLOWANCE) * 100).toFixed(0)}%
              </div>
            </div>
            <ProgressBar pct={(cgtRealised / CGT_ANNUAL_ALLOWANCE) * 100} color={T.amber} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 10.5, color: T.textMuted, whiteSpace: "nowrap" }}>Realised gains so far:</span>
              <div style={{ flex: "0 0 120px" }}>
                <NumberInput
                  value={cgtRealised}
                  onChange={(v) => setCgtRealised(Math.max(0, Number(v) || 0))}
                  style={{
                    width: "100%", background: T.bg, border: `1px solid ${T.border}`,
                    borderRadius: 4, color: T.text, padding: "4px 8px",
                    fontSize: 12, fontFamily: T.mono, outline: "none",
                  }}
                />
              </div>
            </div>
            <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.6, flex: 1 }}>
              {unrealisedGain > 0 ? (
                <>GIA holdings show <strong>{fmtFull(unrealisedGain)}</strong> of unrealised gain.
                Bed-and-ISA up to {fmtFull(Math.min(unrealisedGain, cgtRemaining))} this year to use the allowance tax-free.
                Gains above £{CGT_ANNUAL_ALLOWANCE.toLocaleString()} taxed at {cgtRate}% at your marginal rate.
                Allowance can't be carried forward.</>
              ) : (
                <>Track realised gains across GIAs (or crypto) here.
                The £{CGT_ANNUAL_ALLOWANCE.toLocaleString()} exempt amount can't be carried forward —
                consider bed-and-ISA before 5 April to use it.</>
              )}
            </div>
          </CardShell>
        )}

        {/* ─ Personal Allowance taper ─ */}
        {showPA && (
          <ExposureCard
            title="Personal Allowance Lost"
            lost={paLost}
            total={PERSONAL_ALLOWANCE}
            color={T.red}
            sub={<>
              Salary of {fmtFull(profile.gross_salary)} triggers the PA taper —
              £1 lost per £2 over £{PERSONAL_ALLOWANCE_TAPER_START.toLocaleString()},
              creating a ~60% effective marginal rate in this band.
              A pension sacrifice of {fmtFull(paRestoreSacrifice)} would drag taxable income to £100k and fully restore the allowance.
            </>}
            cta={onNavigate && <Btn variant="secondary" onClick={() => onNavigate("salary-sacrifice")} style={{ fontSize: 10.5 }}>Salary Sacrifice tool →</Btn>}
          />
        )}

        {/* ─ HICBC ─ */}
        {showHicbc && (
          <ExposureCard
            title="HICBC: Child Benefit Clawed Back"
            lost={hicbcClawed}
            total={cbAnnual}
            color={T.red}
            sub={<>
              {childrenCount} child{childrenCount !== 1 ? "ren" : ""} · {hicbcPct}% of {fmtFull(cbAnnual)}/yr Child Benefit reclaimed via the High Income Child Benefit Charge.
              {profile.gross_salary < HICBC_THRESHOLD_END
                ? <> A pension sacrifice of {fmtFull(hicbcSacrificeToZero)} would drop adjusted net income below £{HICBC_THRESHOLD_START.toLocaleString()} and restore the full benefit.</>
                : <> Fully clawed back above £{HICBC_THRESHOLD_END.toLocaleString()} — sacrifice down to £{HICBC_THRESHOLD_START.toLocaleString()} to recover.</>}
            </>}
            cta={onNavigate && <Btn variant="secondary" onClick={() => onNavigate("salary-sacrifice")} style={{ fontSize: 10.5 }}>Salary Sacrifice tool →</Btn>}
          />
        )}

        {/* ─ Marriage Allowance ─ */}
        {showMA && (
          <InfoCard
            title="Marriage Allowance Available"
            color={T.green}
            body={<>
              Your spouse's income ({fmtFull(profile.spouse_income)}) is below the personal allowance,
              so they can transfer £{MARRIAGE_ALLOWANCE_TRANSFER.toLocaleString()} of unused PA to you —
              worth <strong>£{MARRIAGE_ALLOWANCE_SAVING}/year</strong> in tax saved.
              Apply once at <strong>gov.uk/marriage-allowance</strong> (auto-renews; can backdate up to 4 prior years).
            </>}
          />
        )}
      </div>
    </div>
  );
}
