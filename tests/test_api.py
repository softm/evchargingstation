"""Behavioral tests use local fixtures only; no live service key is required."""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen

from server.client import Batch, CallBudget, CollectionError, OpenDataClient, atomic_json, iso, parse_response, read_json
from server.collector import Collector, coordinates, normalize_station, timestamp
from server.http_server import Runtime, make_server


ROOT = Path(__file__).resolve().parents[1]


class Clock:
    def __init__(self):
        self.now = datetime(2026, 10, 19, 0, 0, tzinfo=timezone.utc)

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += timedelta(seconds=seconds)


def row(station="TEST001", charger="02", **overrides):
    # These are test-only records, never shipped as collected or live data.
    return {
        "statNm": "테스트 전용 충전소", "statId": station, "chgerId": charger,
        "chgerType": "10", "stat": "2", "statUpdDt": "20200101120000",
        "addr": "테스트 주소", "addrDetail": "지하 주차장", "location": "입구 옆",
        "lat": "37.5665", "lng": "126.9780", "busiId": "TEST", "busiNm": "시험 운영기관",
        "zcode": "11", "zscode": "11110", "output": "100.5", "method": "단독",
        "useTime": "24시간 이용가능", "parkingFree": "", "limitYn": "", "delYn": "N",
        **overrides,
    }


def payload(items, total=None, page=1):
    return json.dumps({"resultCode": "00", "pageNo": page, "numOfRows": 10, "totalCount": len(items) if total is None else total, "items": {"item": items}}).encode()


class QueueOpener:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def __call__(self, request, timeout):
        self.requests.append(request)
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        return io.BytesIO(response)


class FakeClient:
    def __init__(self, clock):
        self.clock = clock
        self.budget = CallBudget(per_run=100, per_day=1000, clock=clock)
        self.queue = []
        self.operations = []

    def add(self, items=None, error=None):
        self.queue.append(error if error else items)

    def fetch_all(self, operation, **parameters):
        self.operations.append((operation, parameters))
        self.budget.consume()
        result = self.queue.pop(0)
        if isinstance(result, BaseException):
            raise result
        start = self.clock()
        observed = iso(start + timedelta(seconds=1))
        items = [{**item, "_observedAt": observed} for item in result]
        return Batch(items, start, start + timedelta(seconds=2), len(items), 1)


class ResponseTests(unittest.TestCase):
    def test_json_xml_and_single_item_forms(self):
        flat = parse_response(payload([row()]))
        self.assertEqual(flat.items[0]["chgerId"], "02")
        wrapped = {"response": {"header": {"resultCode": 0}, "body": {"pageNo": "1", "totalCount": "1", "items": {"item": row()}}}}
        self.assertEqual(parse_response(json.dumps(wrapped).encode()).total_count, 1)
        xml = b'<response><header><resultCode>00</resultCode><totalCount>1</totalCount><pageNo>1</pageNo></header><body><items><item><statId>A</statId><chgerId>02</chgerId><stat>6</stat></item></items></body></response>'
        self.assertEqual(parse_response(xml).items[0]["stat"], "6")

    def test_empty_delta_is_valid_but_malformed_response_is_not(self):
        for empty in (None, "", [], {}):
            value = {"resultCode": "00", "totalCount": 0, "items": empty}
            self.assertEqual(parse_response(json.dumps(value).encode()).items, [])
        for malformed in (b"", b"<broken", b"not json", b'[]', b'{"resultCode":"00"}'):
            with self.assertRaises(CollectionError):
                parse_response(malformed)

    def test_xml_error_is_safe_and_entities_are_rejected(self):
        sample_secret = "test-secret-that-must-not-be-echoed"
        error = f'<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>{sample_secret}</errMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>'.encode()
        with self.assertRaises(CollectionError) as caught:
            parse_response(error)
        self.assertEqual(caught.exception.code, "30")
        self.assertNotIn(sample_secret, str(caught.exception))
        with self.assertRaises(CollectionError):
            parse_response(b'<!DOCTYPE response [<!ENTITY x "bad">]><response>&x;</response>')

    def test_encoded_key_is_encoded_once_and_all_pages_are_fetched(self):
        opener = QueueOpener([payload([row(charger=f"{i:02}") for i in range(10)], total=11), payload([row(charger="10")], total=11, page=2)])
        client = OpenDataClient("dummy%2Bkey%2F%3D", page_size=10, opener=opener, retries=0)
        batch = client.fetch_all("getChargerInfo")
        self.assertEqual(len(batch.items), 11)
        self.assertEqual(batch.pages, 2)
        query = parse_qs(urlsplit(opener.requests[0].full_url).query)
        self.assertEqual(query["serviceKey"], ["dummy+key/="])
        self.assertEqual(query["dataType"], ["JSON"])
        self.assertNotIn("zcode", query)
        self.assertTrue(opener.requests[0].full_url.startswith("https://apis.data.go.kr/"))

    def test_incomplete_and_unstable_inventory_pages_fail(self):
        cases = [
            [payload([row()], total=11)],
            [payload([row(charger=str(i)) for i in range(10)], total=11), payload([row()], total=12, page=2)],
        ]
        for responses in cases:
            client = OpenDataClient("dummy", page_size=10, opener=QueueOpener(responses), retries=0)
            with self.assertRaises(CollectionError):
                client.fetch_all("getChargerInfo")

    def test_relative_status_window_can_change_page_count(self):
        opener = QueueOpener([
            payload([row(charger=str(i)) for i in range(10)], total=11),
            payload([row(charger="10"), row(charger="11")], total=12, page=2),
        ])
        client = OpenDataClient("dummy", page_size=10, opener=opener, retries=0)
        result = client.fetch_all("getChargerStatus", period=10)
        self.assertEqual(len(result.items), 12)
        self.assertEqual(result.pages, 2)


class BudgetTests(unittest.TestCase):
    def test_run_and_persisted_daily_limits_include_failed_attempts(self):
        clock = Clock()
        with tempfile.TemporaryDirectory() as directory:
            ledger = Path(directory) / "budget.json"
            budget = CallBudget(per_run=1, per_day=2, ledger=ledger, clock=clock)
            client = OpenDataClient("dummy", budget=budget, opener=QueueOpener([TimeoutError()]), retries=0)
            with self.assertRaises(CollectionError):
                client.fetch_all("getChargerInfo")
            self.assertEqual(budget.used, 1)
            with self.assertRaises(CollectionError) as caught:
                budget.consume()
            self.assertEqual(caught.exception.code, "RUN_BUDGET_EXCEEDED")
            second = CallBudget(per_run=10, per_day=2, ledger=ledger, clock=clock)
            second.consume()
            with self.assertRaises(CollectionError) as caught:
                second.consume()
            self.assertEqual(caught.exception.code, "DAILY_BUDGET_EXCEEDED")
            clock.advance(24 * 3600)
            second.consume()
            self.assertEqual(read_json(ledger)["calls"], 1)


class NormalizationTests(unittest.TestCase):
    def test_unknown_booleans_connector_and_old_change_time_are_preserved(self):
        source = row(_observedAt="2026-10-19T00:00:00Z", stat="6")
        station = normalize_station("TEST001", [source])
        self.assertIsNone(station["parkingFree"])
        self.assertIsNone(station["restricted"])
        charger = station["chargers"][0]
        self.assertEqual(charger["id"], "02")
        self.assertEqual(charger["type"], "10")
        self.assertEqual(charger["status"], "6")
        self.assertEqual(charger["outputKw"], 100.5)
        self.assertEqual(charger["statusChangedAt"], "2020-01-01T03:00:00Z")
        self.assertEqual(charger["observedAt"], "2026-10-19T00:00:00Z")

    def test_unknown_new_codes_and_invalid_coordinates_do_not_become_available(self):
        station = normalize_station("A", [row(stat="77", chgerType="11", output="50+50", lat="0", lng="0")])
        self.assertEqual(station["chargers"][0]["status"], "77")
        self.assertEqual(station["chargers"][0]["type"], "11")
        self.assertIsNone(station["chargers"][0]["outputKw"])
        self.assertEqual((station["lat"], station["lng"]), (None, None))
        self.assertEqual(coordinates(row(lat="NaN")), (None, None))
        self.assertIsNone(timestamp("20260230120000"))


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.clock = Clock()
        self.client = FakeClient(self.clock)
        self.collector = Collector(self.client, output_dir=self.directory / "public-data", state_dir=self.directory / "private", clock=self.clock)

    def tearDown(self):
        self.temporary.cleanup()

    def manifest(self):
        return read_json(self.collector.output_dir / "manifest.json")

    def region(self, code="11"):
        path = next(region["path"] for region in self.manifest()["regions"] if region["code"] == code)
        return read_json(self.collector.output_dir / path)

    def full(self, rows=None):
        self.client.add(rows if rows is not None else [row()])
        return self.collector.run("full")

    def test_full_national_snapshot_is_sharded_and_deleted_chargers_are_removed(self):
        self.full([row(), row(charger="03", delYn="Y"), row(station="OTHER", zcode="99", lat="35.1")])
        manifest = self.manifest()
        self.assertEqual(manifest["totalStations"], 2)
        self.assertEqual(manifest["totalChargers"], 2)
        self.assertEqual({region["code"] for region in manifest["regions"]}, {"11", "99"})
        self.assertEqual(self.client.operations[0], ("getChargerInfo", {}))
        self.assertEqual(self.region()["stations"][0]["chargers"][0]["id"], "02")
        self.assertTrue(all((self.collector.output_dir / region["path"]).is_file() for region in manifest["regions"]))
        self.assertEqual(manifest["statusCoverageAt"], "2026-10-19T00:00:00Z")
        self.assertEqual(manifest["inventoryUpdatedAt"], "2026-10-19T00:00:02Z")

    def test_empty_delta_preserves_station_and_advances_only_coverage(self):
        self.full()
        old_changed = self.region()["stations"][0]["chargers"][0]["statusChangedAt"]
        self.clock.advance(300)
        self.client.add([])
        result = self.collector.run("status")
        self.assertEqual(result["operation"], "status")
        self.assertEqual(self.manifest()["totalChargers"], 1)
        self.assertEqual(self.manifest()["statusCoverageAt"], "2026-10-19T00:05:00Z")
        self.assertEqual(self.region()["stations"][0]["chargers"][0]["statusChangedAt"], old_changed)

    def test_gap_over_ten_minutes_recovers_from_full_inventory(self):
        self.full()
        self.clock.advance(601)
        self.client.add([row(stat="3")])
        result = self.collector.run("auto")
        self.assertEqual(result["operation"], "full")
        self.assertEqual(self.client.operations[-1][0], "getChargerInfo")

    def test_failed_run_keeps_manifest_and_marks_recovery_needed(self):
        self.full()
        before = (self.collector.output_dir / "manifest.json").read_bytes()
        self.clock.advance(300)
        self.client.add(error=CollectionError("INCOMPLETE_PAGE", "test fixture error"))
        with self.assertRaises(CollectionError):
            self.collector.run("status")
        self.assertEqual((self.collector.output_dir / "manifest.json").read_bytes(), before)
        self.assertTrue(read_json(self.collector.state_path)["needsFullRefresh"])
        self.client.add([row()])
        self.assertEqual(self.collector.run("auto")["operation"], "full")

    def test_duplicates_and_all_deleted_inventory_do_not_replace_good_snapshot(self):
        self.full()
        before = (self.collector.output_dir / "manifest.json").read_bytes()
        for bad_rows in ([row(), row()], [row(delYn="Y")], []):
            self.client.add(bad_rows)
            with self.assertRaises(CollectionError):
                self.collector.run("full")
            self.assertEqual((self.collector.output_dir / "manifest.json").read_bytes(), before)

    def test_out_of_order_change_does_not_overwrite_newer_status(self):
        self.full([row(stat="3", statUpdDt="20261019085900")])
        self.clock.advance(300)
        self.client.add([row(stat="2", statUpdDt="20261019085000")])
        self.collector.run("status")
        self.assertEqual(self.region()["stations"][0]["chargers"][0]["status"], "3")

    def test_new_status_only_charger_triggers_real_full_recovery(self):
        self.full()
        self.clock.advance(300)
        self.client.add([row(station="NEW")])
        self.client.add([row(), row(station="NEW")])
        result = self.collector.run("status")
        self.assertEqual(result["operation"], "full-recovery")
        self.assertEqual(self.manifest()["totalStations"], 2)


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        public = self.directory / "public"
        public.mkdir()
        (public / "index.html").write_text("<!doctype html><title>test</title>")
        (self.directory / "private-secret.txt").write_text("PRIVATE_TEST_CONTENT")
        self.runtime = Runtime(public_dir=public, data_dir=public / "data", state_dir=self.directory / "private", service_key="")
        self.server = make_server(self.runtime, "127.0.0.1", 0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temporary.cleanup()

    def test_unconfigured_manifest_and_public_only_configuration(self):
        with urlopen(self.base + "/api/manifest.json") as response:
            manifest = json.load(response)
        self.assertEqual(manifest["mode"], "unconfigured")
        self.assertEqual(manifest["totalStations"], 0)
        with urlopen(self.base + "/config.js") as response:
            configuration = response.read().decode()
        self.assertIn('"apiBaseUrl": "/api"', configuration)
        self.assertNotIn("DATA_GO_KR_SERVICE_KEY", configuration)

    def test_private_paths_and_external_origins_are_not_served(self):
        for path in ("/../private-secret.txt", "/%2e%2e/private-secret.txt", "/.env", "/api/../private-secret.txt", "/api/releases/../../private-secret.txt"):
            with self.assertRaises(HTTPError) as caught:
                urlopen(self.base + path)
            self.assertEqual(caught.exception.code, 404)
        request = Request(self.base + "/api/manifest.json", headers={"Origin": "https://unapproved.example"})
        with self.assertRaises(HTTPError) as caught:
            urlopen(request)
        self.assertEqual(caught.exception.code, 403)

    def test_manifest_referenced_shard_and_current_region_alias(self):
        relative = "releases/test/regions/11.json"
        atomic_json(self.runtime.data_dir / relative, {"schemaVersion": 1, "regionCode": "11", "stations": []})
        atomic_json(self.runtime.data_dir / "manifest.json", {"schemaVersion": 1, "mode": "snapshot", "generatedAt": "2026-10-19T00:00:00Z", "regions": [{"code": "11", "path": relative}], "warnings": []})
        for path in ("/api/" + relative, "/api/regions/11.json"):
            with urlopen(self.base + path) as response:
                self.assertEqual(json.load(response)["regionCode"], "11")


class CliTests(unittest.TestCase):
    def test_no_key_exit_code_and_existing_snapshot_preservation(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "data"
            command = [sys.executable, str(ROOT / "scripts" / "collect.py"), "--output", str(output)]
            environment = {**os.environ, "DATA_GO_KR_SERVICE_KEY": ""}
            result = subprocess.run(command, env=environment, capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(read_json(output / "manifest.json")["mode"], "unconfigured")
            before = (output / "manifest.json").read_bytes()
            repeated = subprocess.run(command, env=environment, capture_output=True, text=True)
            self.assertEqual(repeated.returncode, 2)
            self.assertEqual((output / "manifest.json").read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
