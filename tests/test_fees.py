"""Offline tests; never make web requests to the fee publisher."""
import io
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from server.client import read_json
from server.fees import COMPANY_URL, TARIFF_URL, normalize_chargeinfo, refresh_chargeinfo

DATE = datetime(2026, 10, 20, 12, tzinfo=timezone.utc)


def fixtures():
    companies, tariffs = [], []
    for i in range(12):
        bid = f"A{i:X}"
        companies.append({"bid": bid, "kecoBid": bid, "companyName": f"Example {i}", "approveYn": "Y"})
        tariffs.append({"id": f"{i}M", "bid": bid, "csKindType": "2", "customerType": "M",
                        "openType": "O", "feeType": "FIX_UNIT_PRICE", "averageFee": 350+i,
                        "startDt": "20260101", "endDt": "99991231"})
        tariffs.append({"id": f"{i}G", "bid": bid, "csKindType": "1", "customerType": "G",
                        "openType": "O", "feeType": "FIX_UNIT_PRICE", "averageFee": 450+i,
                        "startDt": "20260101", "endDt": "99991231"})
    return {"result": companies}, {"result": tariffs}


class FeeTests(unittest.TestCase):
    def test_approval_gate_makes_zero_requests(self):
        with tempfile.TemporaryDirectory() as path:
            destination = Path(path) / "fees.json"
            def must_not_call(*_args, **_kwargs):
                raise AssertionError("No publisher network calls without authorization")
            result = refresh_chargeinfo(destination, permission_granted=False, opener=must_not_call)
            self.assertEqual(result["status"], "permission_required")
            self.assertFalse(destination.exists())

    def test_approved_catalog_normalizes_only_fee_fields(self):
        companies, tariffs = fixtures()
        prices = normalize_chargeinfo(companies, tariffs, collected_at=DATE)
        self.assertEqual(prices["schemaVersion"], 1)
        self.assertEqual(len(prices["operators"]), 12)
        self.assertEqual(sum(len(o["rates"]) for o in prices["operators"]), 24)
        sample = prices["operators"][0]
        self.assertEqual(sample["rates"][0]["basis"], "published_tariff_average")
        self.assertNotIn("bizRegNo", str(prices))

    def test_invalid_catalog_never_overwrites_previous_file(self):
        with tempfile.TemporaryDirectory() as path:
            destination = Path(path) / "fees.json"
            destination.write_text('{"schemaVersion":1,"mode":"public_reference"}', encoding="utf8")
            companies, tariffs = fixtures()
            tariffs["result"] = []
            with self.assertRaises(ValueError):
                normalize_chargeinfo(companies, tariffs, collected_at=DATE)
            self.assertEqual(read_json(destination)["mode"], "public_reference")

    def test_duplicate_operator_code_and_unrecognized_tariffs_are_excluded(self):
        companies, tariffs = fixtures()
        companies["result"].append({"bid":"ZZ", "kecoBid":"A0", "companyName":"Collision"})
        tariffs["result"].append({"id":"X", "bid":"A1", "csKindType":"2",
                    "customerType":"M", "feeType":"FIX_UNIT_PRICE", "averageFee":-42})
        result = normalize_chargeinfo(companies, tariffs, collected_at=DATE)
        self.assertNotIn("A0", {o["operatorId"] for o in result["operators"]})
        self.assertEqual(len(result["operators"]), 11)


if __name__ == "__main__":
    unittest.main()
