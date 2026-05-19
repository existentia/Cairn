"""Tools blueprint — calculator endpoints under /api/tools/*.

These are pure-compute endpoints (no DB writes, optional auth) extracted
from app.py to keep the top-level module manageable. They share the
require_auth decorator from db_auth, and import tax tables from uk_tax.
"""

from flask import Blueprint, jsonify, request

from db_auth import require_auth
from uk_tax import (
    calc_tax_ni,
    IHT_NRB, IHT_RNRB, IHT_RNRB_TAPER_START,
    IHT_RATE_STANDARD, IHT_RATE_REDUCED, IHT_REDUCED_RATE_CHARITY_PCT,
)

tools_bp = Blueprint("tools", __name__, url_prefix="/api/tools")


# ── Salary Sacrifice Calculator ───────────────────────────────────────────────

@tools_bp.route("/salary-sacrifice", methods=["POST"])
@require_auth
def salary_sacrifice_calc():
    """Calculate the tax/NI savings from salary sacrifice pension contributions."""
    data = request.get_json()
    gross = data.get("gross_salary", 0)
    current_pct = data.get("current_contrib_pct", 0)
    proposed_pct = data.get("proposed_contrib_pct", 0)
    employer_pct = data.get("employer_contrib_pct", 0)
    tax_region = data.get("tax_region", "scotland")

    current_sacrifice = gross * (current_pct / 100)
    proposed_sacrifice = gross * (proposed_pct / 100)
    employer_contrib = gross * (employer_pct / 100)

    current = calc_tax_ni(gross, current_sacrifice, tax_region)
    proposed = calc_tax_ni(gross, proposed_sacrifice, tax_region)

    take_home_reduction = current["take_home"] - proposed["take_home"]
    pension_increase = proposed_sacrifice - current_sacrifice
    employer_ni_saving = current["employer_ni"] - proposed["employer_ni"]

    return jsonify({
        "current": {
            **current,
            "pension_contrib": round(current_sacrifice),
            "employer_contrib": round(employer_contrib),
            "total_pension": round(current_sacrifice + employer_contrib),
        },
        "proposed": {
            **proposed,
            "pension_contrib": round(proposed_sacrifice),
            "employer_contrib": round(employer_contrib),
            "employer_ni_saving": round(employer_ni_saving),
            "total_pension": round(proposed_sacrifice + employer_contrib),
            "total_pension_with_ni": round(proposed_sacrifice + employer_contrib + employer_ni_saving),
        },
        "comparison": {
            "take_home_reduction_monthly": round(take_home_reduction / 12),
            "take_home_reduction_annual": round(take_home_reduction),
            "pension_increase_annual": round(pension_increase),
            "pension_increase_monthly": round(pension_increase / 12),
            "employer_ni_saving": round(employer_ni_saving),
            "effective_cost_ratio": round(take_home_reduction / pension_increase * 100, 1) if pension_increase > 0 else 0,
            "tax_ni_saved": round(pension_increase - take_home_reduction),
        },
    })


# ── Bonus Optimiser ───────────────────────────────────────────────────────────

@tools_bp.route("/bonus-optimiser", methods=["POST"])
@require_auth
def bonus_optimiser_calc():
    """Model receiving an annual bonus as cash vs sacrificing into pension."""
    data = request.get_json()
    gross = data.get("gross_salary", 0)
    bonus = max(0, data.get("bonus", 0))
    sacrifice_pct = max(0, min(100, data.get("sacrifice_pct", 100)))
    tax_region = data.get("tax_region", "scotland")

    sacrifice_amount = bonus * (sacrifice_pct / 100)
    bonus_kept = bonus - sacrifice_amount

    baseline = calc_tax_ni(gross, 0, tax_region)
    cash = calc_tax_ni(gross + bonus, 0, tax_region)
    sacrifice = calc_tax_ni(gross + bonus, sacrifice_amount, tax_region)

    cash_extra_take_home = cash["take_home"] - baseline["take_home"]
    sacrifice_extra_take_home = sacrifice["take_home"] - baseline["take_home"]
    cash_tax_ni_paid = bonus - cash_extra_take_home
    sacrifice_tax_ni_paid = bonus_kept - sacrifice_extra_take_home
    cash_total = cash_extra_take_home
    sacrifice_total = sacrifice_extra_take_home + sacrifice_amount
    marginal_rate = (cash_tax_ni_paid / bonus * 100) if bonus > 0 else 0

    return jsonify({
        "inputs": {
            "gross_salary": gross,
            "bonus": bonus,
            "sacrifice_pct": sacrifice_pct,
            "sacrifice_amount": round(sacrifice_amount),
            "bonus_kept_as_cash": round(bonus_kept),
        },
        "cash_route": {
            "take_home_increase": round(cash_extra_take_home),
            "tax_ni_paid": round(cash_tax_ni_paid),
            "pension_increase": 0,
            "total_value": round(cash_total),
        },
        "sacrifice_route": {
            "take_home_increase": round(sacrifice_extra_take_home),
            "tax_ni_paid": round(sacrifice_tax_ni_paid),
            "pension_increase": round(sacrifice_amount),
            "total_value": round(sacrifice_total),
        },
        "comparison": {
            "extra_in_pocket_today": round(cash_extra_take_home - sacrifice_extra_take_home),
            "extra_to_pension": round(sacrifice_amount),
            "tax_ni_saved": round(cash_tax_ni_paid - sacrifice_tax_ni_paid),
            "total_value_difference": round(sacrifice_total - cash_total),
            "marginal_rate_pct": round(marginal_rate, 1),
        },
    })


# ── Inheritance Tax estimator ─────────────────────────────────────────────────

@tools_bp.route("/iht-estimator", methods=["POST"])
@require_auth
def iht_estimator():
    """Estimate IHT due on an estate. 2025/26 allowances (frozen to 2030)."""
    data = request.get_json() or {}
    estate = max(0, float(data.get("estate_value", 0)))
    married = bool(data.get("married", False))
    has_residence = bool(data.get("has_residence", True))
    charity = max(0, float(data.get("charitable_bequest", 0)))
    charity = min(charity, estate)

    nrb = IHT_NRB * (2 if married else 1)
    rnrb_full = IHT_RNRB * (2 if married else 1)

    if has_residence:
        if estate <= IHT_RNRB_TAPER_START:
            rnrb_effective = rnrb_full
        else:
            taper = (estate - IHT_RNRB_TAPER_START) / 2
            rnrb_effective = max(0, rnrb_full - taper)
    else:
        rnrb_effective = 0

    total_allowance = nrb + rnrb_effective
    net_estate = max(0, estate - charity)
    taxable = max(0, net_estate - total_allowance)

    baseline_for_test = max(0, estate - total_allowance)
    qualifies_reduced = baseline_for_test > 0 and (charity / baseline_for_test) >= IHT_REDUCED_RATE_CHARITY_PCT
    rate = IHT_RATE_REDUCED if qualifies_reduced else IHT_RATE_STANDARD

    iht_due = taxable * rate
    net_to_heirs = max(0, net_estate - iht_due)
    headroom = max(0, total_allowance - net_estate)

    return jsonify({
        "inputs": {
            "estate_value": round(estate),
            "married": married,
            "has_residence": has_residence,
            "charitable_bequest": round(charity),
        },
        "allowances": {
            "nrb": round(nrb),
            "rnrb_full": round(rnrb_full),
            "rnrb_effective": round(rnrb_effective),
            "rnrb_tapered_by": round(max(0, rnrb_full - rnrb_effective)),
            "total_allowance": round(total_allowance),
        },
        "calculation": {
            "net_estate": round(net_estate),
            "taxable": round(taxable),
            "rate_pct": round(rate * 100, 1),
            "iht_due": round(iht_due),
            "net_to_heirs": round(net_to_heirs),
            "qualifies_reduced_rate": qualifies_reduced,
            "headroom": round(headroom),
        },
    })


# ── Debt Payoff Calculator ────────────────────────────────────────────────────

@tools_bp.route("/debt-payoff", methods=["POST"])
@require_auth
def debt_payoff_calc():
    """Compare avalanche vs snowball debt repayment strategies."""
    data = request.get_json()
    debts = data.get("debts", [])
    extra_monthly = data.get("extra_monthly", 0)

    if not debts:
        return jsonify({"error": "No debts provided"}), 400

    def simulate(debts_list, extra, strategy="avalanche"):
        active = [{"name": d["name"], "balance": abs(d["balance"]), "rate": d["rate"],
                    "min_payment": abs(d.get("min_payment", 0))} for d in debts_list]
        months = 0
        total_interest = 0
        total_paid = 0
        timeline = []
        max_months = 600

        if strategy == "avalanche":
            active.sort(key=lambda d: -d["rate"])
        else:
            active.sort(key=lambda d: d["balance"])

        while any(d["balance"] > 0.01 for d in active) and months < max_months:
            months += 1
            for d in active:
                if d["balance"] > 0:
                    interest = d["balance"] * (d["rate"] / 100 / 12)
                    d["balance"] += interest
                    total_interest += interest

            for d in active:
                if d["balance"] > 0:
                    payment = min(d["min_payment"], d["balance"])
                    d["balance"] -= payment
                    total_paid += payment

            remaining_extra = extra
            for d in active:
                if d["balance"] > 0 and remaining_extra > 0:
                    payment = min(remaining_extra, d["balance"])
                    d["balance"] -= payment
                    total_paid += payment
                    remaining_extra -= payment

            total_remaining = sum(d["balance"] for d in active)
            if months % 3 == 0 or total_remaining < 0.01:
                timeline.append({"month": months, "remaining": round(total_remaining)})

        return {
            "months": months,
            "total_interest": round(total_interest),
            "total_paid": round(total_paid),
            "timeline": timeline,
        }

    avalanche = simulate(debts, extra_monthly, "avalanche")
    snowball = simulate(debts, extra_monthly, "snowball")
    minimum_only = simulate(debts, 0, "avalanche")

    return jsonify({
        "avalanche": avalanche,
        "snowball": snowball,
        "minimum_only": minimum_only,
        "savings_vs_minimum": {
            "months_saved": minimum_only["months"] - avalanche["months"],
            "interest_saved": minimum_only["total_interest"] - avalanche["total_interest"],
        },
    })


# ── Mortgage Scenarios ────────────────────────────────────────────────────────

@tools_bp.route("/mortgage-scenarios", methods=["POST"])
@require_auth
def mortgage_scenarios():
    """Calculate mortgage payment scenarios at different rates."""
    data = request.get_json()
    balance = data.get("balance", 0)
    current_rate = data.get("current_rate", 5.0)
    remaining_years = data.get("remaining_years", 20)
    margin = data.get("tracker_margin", 0.5)

    def calc_monthly_payment(principal, annual_rate, years):
        if annual_rate <= 0 or years <= 0:
            return principal / max(years * 12, 1)
        r = annual_rate / 100 / 12
        n = years * 12
        return principal * (r * (1 + r) ** n) / ((1 + r) ** n - 1)

    def calc_total_interest(principal, annual_rate, years):
        mp = calc_monthly_payment(principal, annual_rate, years)
        return (mp * years * 12) - principal

    def calc_overpayment(principal, annual_rate, years, extra_monthly):
        if annual_rate <= 0:
            return {"months": int(principal / max(extra_monthly + principal / (years * 12), 1)), "interest": 0, "saved_months": 0}
        r = annual_rate / 100 / 12
        bal = principal
        base_payment = calc_monthly_payment(principal, annual_rate, years)
        total_payment = base_payment + extra_monthly
        months = 0
        total_interest = 0
        while bal > 0.01 and months < years * 12:
            interest = bal * r
            total_interest += interest
            principal_paid = total_payment - interest
            if principal_paid <= 0:
                break
            bal -= principal_paid
            months += 1
            if bal < 0:
                bal = 0
        return {"months": months, "total_interest": round(total_interest), "saved_months": years * 12 - months}

    current_monthly = calc_monthly_payment(balance, current_rate, remaining_years)

    scenarios = []
    for delta in [-1.5, -1.0, -0.5, 0, 0.5, 1.0, 1.5, 2.0]:
        rate = current_rate + delta
        if rate < 0.1:
            continue
        mp = calc_monthly_payment(balance, rate, remaining_years)
        ti = calc_total_interest(balance, rate, remaining_years)
        scenarios.append({
            "rate": round(rate, 2),
            "base_rate": round(rate - margin, 2),
            "monthly_payment": round(mp),
            "total_interest": round(ti),
            "diff_monthly": round(mp - current_monthly),
            "is_current": delta == 0,
        })

    overpayments = []
    for extra in [0, 100, 200, 300, 500]:
        result = calc_overpayment(balance, current_rate, remaining_years, extra)
        no_extra = calc_overpayment(balance, current_rate, remaining_years, 0)
        overpayments.append({
            "extra_monthly": extra,
            "months_to_clear": result["months"],
            "total_interest": result["total_interest"],
            "interest_saved": no_extra["total_interest"] - result["total_interest"],
            "time_saved_months": result["saved_months"] - no_extra["saved_months"] if extra > 0 else 0,
        })

    return jsonify({
        "current": {
            "rate": current_rate,
            "base_rate": round(current_rate - margin, 2),
            "monthly_payment": round(current_monthly),
            "total_interest": round(calc_total_interest(balance, current_rate, remaining_years)),
            "balance": balance,
            "remaining_years": remaining_years,
        },
        "scenarios": scenarios,
        "overpayments": overpayments,
    })
