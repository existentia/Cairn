"""Route-level tests through Flask's test client, against a throwaway database.

Skipped when the app's dependencies (Flask, anthropic) aren't installed, so
`python -m unittest discover -s backend/tests` still passes on a bare Python.
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

_TMP = tempfile.TemporaryDirectory()
os.environ["DATA_DIR"] = _TMP.name  # must be set before db_auth is imported
os.environ.setdefault("ADMIN_PASSWORD", "test-only-password")

try:
    import app as cairn
    import boe
except ImportError as e:  # pragma: no cover
    cairn = None
    _SKIP = f"app dependencies not installed ({e})"

TOKEN = "t" * 64


@unittest.skipIf(cairn is None, "app dependencies not installed")
class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cairn.init_db()
        cairn.ensure_password_hash()
        import sqlite3
        db = sqlite3.connect(str(cairn.DB_PATH))
        db.execute("INSERT OR REPLACE INTO auth_tokens (token, username) VALUES (?, 'admin')", (TOKEN,))
        db.commit()
        db.close()
        cls.client = cairn.app.test_client()
        cls.auth = {"Authorization": f"Bearer {TOKEN}"}

    def post(self, path, body):
        return self.client.post(path, json=body, headers=self.auth)

    def test_refuses_to_start_with_placeholder_password(self):
        real = cairn.ADMIN_PASSWORD
        try:
            for bad in ("", "changeme", "change-this-to-something-secure"):
                cairn.ADMIN_PASSWORD = bad
                with self.assertRaises(SystemExit):
                    cairn.ensure_password_hash()
        finally:
            cairn.ADMIN_PASSWORD = real

    def test_csp_allows_no_third_party_origins(self):
        csp = self.client.get("/").headers["Content-Security-Policy"]
        self.assertNotIn("http", csp)

    # ── validation ───────────────────────────────────────────────────
    def test_malformed_bodies_are_400_not_500(self):
        for path in ("/api/accounts", "/api/goals", "/api/tools/salary-sacrifice",
                     "/api/tools/mortgage-scenarios", "/api/auth/login"):
            with self.subTest(path=path):
                r = self.client.post(path, data="not json", headers=self.auth,
                                     content_type="application/json")
                self.assertEqual(r.status_code, 400)
                self.assertIn("error", r.get_json())
        self.assertEqual(self.client.put("/api/profile", json=[1, 2], headers=self.auth).status_code, 400)

    def test_account_validation(self):
        bad_type = self.post("/api/accounts", {"name": "Example", "type": "PIGGY_BANK", "balance": 10})
        self.assertEqual(bad_type.status_code, 400)
        self.assertIn("PIGGY_BANK", bad_type.get_json()["error"])
        self.assertEqual(self.post("/api/accounts", {"name": " ", "type": "SAVINGS"}).status_code, 400)
        self.assertEqual(self.post("/api/accounts", {"name": "Example", "type": "SAVINGS", "balance": "lots"}).status_code, 400)

        ok = self.post("/api/accounts", {"name": "Example Saver", "type": "SAVINGS", "balance": "1500", "interest_rate": None})
        self.assertEqual(ok.status_code, 201)
        acct_id = ok.get_json()["id"]
        row = next(a for a in self.client.get("/api/accounts", headers=self.auth).get_json() if a["id"] == acct_id)
        self.assertEqual(row["balance"], 1500)       # numeric string coerced
        self.assertEqual(row["interest_rate"], 0)    # blank → 0
        r = self.client.put(f"/api/accounts/{acct_id}", json={"type": "NOPE"}, headers=self.auth)
        self.assertEqual(r.status_code, 400)
        self.client.delete(f"/api/accounts/{acct_id}", headers=self.auth)

    def test_tool_inputs_are_validated(self):
        self.assertEqual(self.post("/api/tools/salary-sacrifice", {"gross_salary": "abc"}).status_code, 400)
        self.assertEqual(self.post("/api/tools/debt-payoff", {"debts": ["x"]}).status_code, 400)
        ok = self.post("/api/tools/debt-payoff", {"debts": [{"name": "Card", "balance": 2000, "rate": 20, "min_payment": 100}]})
        self.assertEqual(ok.status_code, 200)

    # ── partial updates ──────────────────────────────────────────────
    def test_profile_and_settings_updates_are_partial(self):
        put = lambda path, body: self.client.put(path, json=body, headers=self.auth)
        self.assertEqual(put("/api/profile", {"gross_salary": 52000, "retirement_age": 60, "dob": "1985-06-15"}).status_code, 200)
        self.assertEqual(put("/api/profile", {"name": "Sam Example"}).status_code, 200)
        profile = self.client.get("/api/profile", headers=self.auth).get_json()
        self.assertEqual(profile["gross_salary"], 52000)   # untouched by the second PUT
        self.assertEqual(profile["retirement_age"], 60)
        self.assertEqual(profile["dob"], "1985-06-15")
        self.assertEqual(put("/api/profile", {"dob": "15/06/1985"}).status_code, 400)

        self.assertEqual(put("/api/settings", {"tax_region": "ruk", "growth_rate": 4}).status_code, 200)
        self.assertEqual(put("/api/settings", {"inflation_rate": 3}).status_code, 200)
        settings = self.client.get("/api/settings", headers=self.auth).get_json()
        self.assertEqual((settings["tax_region"], settings["growth_rate"], settings["inflation_rate"]), ("ruk", 4, 3))

    # ── snapshots ────────────────────────────────────────────────────
    def _snapshot(self, date):
        dash = self.client.get("/api/dashboard", headers=self.auth).get_json()
        return next((s for s in dash["snapshots"] if s["date"] == date), None)

    def test_csv_reimport_keeps_and_rescales_categories(self):
        a = self.post("/api/accounts", {"name": "Example Pension", "type": "SIPP", "balance": 80000}).get_json()["id"]
        b = self.post("/api/accounts", {"name": "Example Mortgage", "type": "MORTGAGE", "balance": -50000}).get_json()["id"]
        try:
            self.assertEqual(self.post("/api/snapshots", {"date": "2024-03-01"}).status_code, 201)
            before = self._snapshot("2024-03-01")
            self.assertEqual(before["categories"]["pensions"], 80000)

            csv = "date,net_worth,total_assets,total_liabilities\n2024-03-01,35000,88000,53000\n"
            self.assertEqual(self.post("/api/snapshots/import-csv", {"csv": csv}).get_json()["imported"], 1)
            after = self._snapshot("2024-03-01")
            self.assertEqual(after["id"], before["id"])                 # same row, not replaced
            self.assertEqual(after["net_worth"], 35000)
            self.assertAlmostEqual(after["categories"]["pensions"], 88000)   # scaled with assets
            self.assertAlmostEqual(after["categories"]["debts"], -53000)     # scaled with liabilities

            # Re-taking the same day's snapshot also keeps the row id.
            self.post("/api/snapshots", {"date": "2024-03-01"})
            self.assertEqual(self._snapshot("2024-03-01")["id"], before["id"])
        finally:
            for acct in (a, b):
                self.client.delete(f"/api/accounts/{acct}", headers=self.auth)

    def test_snapshot_date_validation_and_conflict(self):
        self.assertEqual(self.post("/api/snapshots", {"date": "yesterday"}).status_code, 400)
        self.post("/api/snapshots", {"date": "2024-05-01"})
        self.post("/api/snapshots", {"date": "2024-06-01"})
        june = self._snapshot("2024-06-01")
        r = self.client.put(f"/api/snapshots/{june['id']}", json={"date": "2024-05-01"}, headers=self.auth)
        self.assertEqual(r.status_code, 409)

    # ── import ───────────────────────────────────────────────────────
    def test_import_with_bad_account_type_rolls_back(self):
        keep = self.post("/api/accounts", {"name": "Keep Me", "type": "CURRENT", "balance": 1}).get_json()["id"]
        r = self.post("/api/import", {"accounts": [{"name": "Bad", "type": "NOPE"}]})
        self.assertEqual(r.status_code, 400)
        names = [a["name"] for a in self.client.get("/api/accounts", headers=self.auth).get_json()]
        self.assertIn("Keep Me", names)
        self.client.delete(f"/api/accounts/{keep}", headers=self.auth)

    def test_export_import_round_trip(self):
        acct = self.post("/api/accounts", {"name": "Round Trip ISA", "type": "ISA_SS", "balance": 1234}).get_json()["id"]
        exported = self.client.get("/api/export", headers=self.auth).get_json()
        r = self.post("/api/import", exported)
        self.assertEqual(r.status_code, 200, r.get_json())
        accounts = self.client.get("/api/accounts", headers=self.auth).get_json()
        self.assertEqual([a["balance"] for a in accounts if a["name"] == "Round Trip ISA"], [1234])
        for a in accounts:
            if a["name"] == "Round Trip ISA":
                self.client.delete(f"/api/accounts/{a['id']}", headers=self.auth)

    def test_unknown_api_path_is_json_404(self):
        r = self.client.get("/api/does-not-exist", headers=self.auth)
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.get_json(), {"error": "Not found"})

    def test_requires_auth(self):
        self.assertEqual(self.client.get("/api/dashboard").status_code, 401)

    def test_salary_sacrifice_includes_personal_allowance_taper(self):
        r = self.post("/api/tools/salary-sacrifice", {
            "gross_salary": 125140, "current_contrib_pct": 0,
            "proposed_contrib_pct": 25140 / 125140 * 100, "tax_region": "ruk",
        })
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertEqual(body["current"]["income_tax"] - body["proposed"]["income_tax"], 15084)

    def test_mortgage_scenarios_at_zero_percent(self):
        r = self.post("/api/tools/mortgage-scenarios", {
            "balance": 120000, "current_rate": 0, "remaining_years": 10,
        })
        self.assertEqual(r.status_code, 200)
        over = {o["extra_monthly"]: o for o in r.get_json()["overpayments"]}
        self.assertEqual(over[0]["months_to_clear"], 120)
        self.assertEqual(over[0]["total_interest"], 0)
        self.assertEqual(over[500]["months_to_clear"], 80)  # £1,000 + £500 a month

    def test_boe_rate_is_shared_with_the_dashboard(self):
        original = boe.fetch_live
        boe.fetch_live = lambda now_dt: [{"date": "2026-11-05", "rate": 4.0}]
        try:
            r = self.client.get("/api/rates/boe-base-rate", headers=self.auth)
        finally:
            boe.fetch_live = original
        self.assertEqual(r.get_json()["current_rate"], 4.0)
        dash = self.client.get("/api/dashboard", headers=self.auth).get_json()
        self.assertEqual(dash["boe_rate"], 4.0)


if __name__ == "__main__":
    unittest.main()
