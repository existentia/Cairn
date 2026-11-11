"""Tests for backend/uk_tax.py.

Zero dependencies — run from the project root with either:
    python -m unittest discover -s backend/tests
    pytest backend/tests
"""

import re
import sys
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

import uk_tax  # noqa: E402
from uk_tax import calc_income_tax, calc_tax_ni, personal_allowance, state_pension_age  # noqa: E402

CONSTANTS_JS = BACKEND.parent / "frontend" / "src" / "constants.js"


class PersonalAllowanceTaper(unittest.TestCase):
    def test_allowance_tapers_between_100k_and_125140(self):
        self.assertEqual(personal_allowance(50_000), 12_570)
        self.assertEqual(personal_allowance(100_000), 12_570)
        self.assertEqual(personal_allowance(110_000), 7_570)
        self.assertEqual(personal_allowance(125_140), 0)
        self.assertEqual(personal_allowance(200_000), 0)

    def test_ruk_income_tax_known_figures(self):
        self.assertAlmostEqual(calc_income_tax(12_570, "ruk"), 0)
        self.assertAlmostEqual(calc_income_tax(50_270, "ruk"), 7_540)
        self.assertAlmostEqual(calc_income_tax(100_000, "ruk"), 27_432)
        self.assertAlmostEqual(calc_income_tax(110_000, "ruk"), 33_432)
        self.assertAlmostEqual(calc_income_tax(125_140, "ruk"), 42_516)
        self.assertAlmostEqual(calc_income_tax(150_000, "ruk"), 53_703)

    def test_scotland_income_tax_known_figures(self):
        self.assertAlmostEqual(calc_income_tax(75_000, "scotland"), 19_482.05)
        self.assertAlmostEqual(calc_income_tax(125_140, "scotland"), 47_701.55)

    def test_marginal_rate_in_taper_zone(self):
        # 40% on the extra £1,000 plus 40% on £500 of lost allowance = 60%.
        self.assertAlmostEqual(calc_income_tax(110_000, "ruk") - calc_income_tax(109_000, "ruk"), 600)
        # Scotland: 45% advanced rate x 1.5 = 67.5%.
        self.assertAlmostEqual(calc_income_tax(110_000, "scotland") - calc_income_tax(109_000, "scotland"), 675)

    def test_top_rate_starts_at_125140_not_before(self):
        self.assertAlmostEqual(calc_income_tax(126_140, "ruk") - calc_income_tax(125_140, "ruk"), 450)
        self.assertAlmostEqual(calc_income_tax(126_140, "scotland") - calc_income_tax(125_140, "scotland"), 480)

    def test_sacrificing_out_of_the_taper_restores_the_allowance(self):
        before = calc_tax_ni(125_140, 0, "ruk")
        after = calc_tax_ni(125_140, 25_140, "ruk")
        # £25,140 at 40% plus the restored £12,570 allowance at 40%.
        self.assertEqual(before["income_tax"] - after["income_tax"], 15_084)
        self.assertEqual(after["income_tax"], 27_432)

    def test_take_home_is_consistent(self):
        r = calc_tax_ni(60_000, 3_000, "scotland")
        self.assertEqual(r["taxable_income"], 57_000)
        self.assertAlmostEqual(r["take_home"], 57_000 - r["income_tax"] - r["employee_ni"], delta=1)


class SalarySacrificeNiCap(unittest.TestCase):
    """April 2029 rules: only the first £2,000 sacrificed escapes NI."""

    def test_income_tax_relief_is_unchanged(self):
        today = calc_tax_ni(60_000, 6_000, "ruk")
        capped = calc_tax_ni(60_000, 6_000, "ruk", ni_cap=uk_tax.SALARY_SACRIFICE_NI_CAP)
        self.assertEqual(today["income_tax"], capped["income_tax"])

    def test_ni_is_charged_above_the_cap(self):
        today = calc_tax_ni(60_000, 6_000, "ruk")
        capped = calc_tax_ni(60_000, 6_000, "ruk", ni_cap=2_000)
        # £4,000 more NI-able pay, all above the upper earnings limit: 2%.
        self.assertEqual(capped["employee_ni"] - today["employee_ni"], 80)
        self.assertEqual(capped["employer_ni"] - today["employer_ni"], 600)   # 15%
        self.assertEqual(today["take_home"] - capped["take_home"], 80)

    def test_sacrifice_within_the_cap_is_unaffected(self):
        self.assertEqual(calc_tax_ni(40_000, 1_500, "scotland"),
                         calc_tax_ni(40_000, 1_500, "scotland", ni_cap=2_000))


class StatePensionAge(unittest.TestCase):
    def test_by_date_of_birth(self):
        self.assertEqual(state_pension_age("1955-06-01"), 66)
        self.assertEqual(state_pension_age("1960-04-05"), 66)
        self.assertEqual(state_pension_age("1960-04-06"), 67)
        self.assertEqual(state_pension_age("1970-01-01"), 67)
        self.assertEqual(state_pension_age("1977-04-05"), 67)
        self.assertEqual(state_pension_age("1977-04-06"), 68)
        self.assertEqual(state_pension_age("1985-09-14"), 68)

    def test_unusable_date_falls_back(self):
        for bad in (None, "", "not-a-date", 1980):
            self.assertEqual(state_pension_age(bad), uk_tax.STATE_PENSION_AGE)


class FrontendParity(unittest.TestCase):
    """constants.js is a hand-maintained mirror of uk_tax.py — catch drift."""

    @classmethod
    def setUpClass(cls):
        cls.js = CONSTANTS_JS.read_text(encoding="utf-8")

    def test_scalar_constants_match(self):
        pairs = re.findall(r"^export const ([A-Z][A-Z0-9_]*) = ([0-9][0-9_.]*);", self.js, re.M)
        self.assertGreater(len(pairs), 20)
        for name, raw in pairs:
            with self.subTest(name=name):
                self.assertTrue(hasattr(uk_tax, name), f"{name} is in constants.js but not uk_tax.py")
                self.assertAlmostEqual(float(raw.replace("_", "")), getattr(uk_tax, name))

    def test_tax_year_label_matches(self):
        m = re.search(r'export const TAX_YEAR_LABEL = "([^"]+)"', self.js)
        self.assertEqual(m.group(1), uk_tax.TAX_YEAR_LABEL)

    def _js_bands(self, name):
        block = re.search(rf"export const {name} = \[(.*?)\n\];", self.js, re.S).group(1)
        rows = re.findall(r"\[\s*(Infinity|[0-9]+)\s*,\s*([0-9.]+)\s*\]", block)
        return [(float("inf") if lim == "Infinity" else int(lim), float(rate)) for lim, rate in rows]

    def test_band_tables_match(self):
        self.assertEqual(self._js_bands("SCOTLAND_BANDS"), uk_tax.SCOTLAND_BANDS)
        self.assertEqual(self._js_bands("RUK_BANDS"), uk_tax.RUK_BANDS)

    def test_account_type_sets_match(self):
        for name in ("ASSET_TYPES", "LIABILITY_TYPES", "INVESTMENT_PENSION_TYPES", "ISA_TYPES", "CASH_TYPES"):
            with self.subTest(name=name):
                block = re.search(rf"export const {name} = new Set\(\[(.*?)\]\)", self.js, re.S).group(1)
                self.assertEqual(set(re.findall(r'"([A-Z_]+)"', block)), getattr(uk_tax, name))


if __name__ == "__main__":
    unittest.main()
