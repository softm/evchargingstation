"""Normalize official charger records and publish immutable regional snapshots."""

from __future__ import annotations

import hashlib
import math
import os
import re
import shutil
import uuid
from contextlib import AbstractContextManager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from .client import Batch, CollectionError, KST, OpenDataClient, atomic_json, iso, read_json, utcnow


SOURCE = {"name": "한국환경공단", "url": "https://www.data.go.kr/data/15076352/openapi.do"}
REGIONS = {
    "11": "서울특별시", "12": "전남광주통합특별시", "26": "부산광역시",
    "27": "대구광역시", "28": "인천광역시", "29": "광주광역시 (이전 코드)",
    "30": "대전광역시", "31": "울산광역시", "36": "세종특별자치시", "41": "경기도",
    "42": "강원도 (이전 코드)", "43": "충청북도", "44": "충청남도",
    "45": "전라북도 (이전 코드)", "46": "전라남도 (이전 코드)",
    "47": "경상북도", "48": "경상남도", "50": "제주특별자치도",
    "51": "강원특별자치도", "52": "전북특별자치도", "00": "지역 미확인",
}
STATUS_FIELDS = {"busiId", "statId", "chgerId", "stat", "statUpdDt", "lastTsdt", "lastTedt", "nowTsdt", "_observedAt"}


def text(value: Any) -> str:
    if value is None or isinstance(value, (dict, list, bool)):
        return ""
    return str(value).strip()


def flag(value: Any) -> bool | None:
    value = text(value).upper()
    return True if value == "Y" else False if value == "N" else None


def timestamp(value: Any) -> str | None:
    value = text(value)
    if not re.fullmatch(r"\d{14}", value):
        return None
    try:
        return iso(datetime.strptime(value, "%Y%m%d%H%M%S").replace(tzinfo=KST))
    except ValueError:
        return None


def parse_iso(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if result.tzinfo is None:
            return None
        return result.astimezone(timezone.utc)
    except ValueError:
        return None


def output_kw(value: Any) -> float | None:
    value = text(value)
    if not re.fullmatch(r"(?:\d+(?:\.\d+)?|\.\d+)", value):
        return None
    number = float(value)
    return number if math.isfinite(number) and number > 0 else None


def coordinates(row: dict[str, Any]) -> tuple[float | None, float | None]:
    try:
        lat, lng = float(text(row.get("lat"))), float(text(row.get("lng")))
    except ValueError:
        return None, None
    # The API is Korean. Exclude placeholder zeros, swapped axes and outliers.
    if math.isfinite(lat) and math.isfinite(lng) and 32 <= lat <= 40 and 123 <= lng <= 133:
        return lat, lng
    return None, None


def record_key(row: dict[str, Any]) -> str:
    station_id, charger_id = text(row.get("statId")), text(row.get("chgerId"))
    if not station_id or not charger_id or "\x1f" in station_id + charger_id:
        raise CollectionError("INVALID_ID", "공공데이터에 충전소 또는 충전기 식별자가 없는 항목이 있습니다.")
    return f"{station_id}\x1f{charger_id}"


def _is_older(new: dict[str, Any], old: dict[str, Any]) -> bool:
    new_changed, old_changed = timestamp(new.get("statUpdDt")), timestamp(old.get("statUpdDt"))
    return bool(old_changed and (not new_changed or new_changed < old_changed))


def _first(rows: list[dict[str, Any]], field: str) -> str:
    return next((text(row.get(field)) for row in rows if text(row.get(field))), "")


def _combine(rows: list[dict[str, Any]], field: str) -> str:
    return " / ".join(dict.fromkeys(text(row.get(field)) for row in rows if text(row.get(field))))


def normalize_station(station_id: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    rows = sorted(rows, key=lambda row: text(row.get("chgerId")))
    point = next((coordinates(row) for row in rows if coordinates(row)[0] is not None), (None, None))
    restricted_values = [flag(row.get("limitYn")) for row in rows]
    parking_values = [flag(row.get("parkingFree")) for row in rows]
    restricted = True if True in restricted_values else False if all(value is False for value in restricted_values) else None
    parking_free = False if False in parking_values else True if all(value is True for value in parking_values) else None
    chargers = []
    for row in rows:
        chargers.append({
            "id": text(row.get("chgerId")),
            "type": text(row.get("chgerType")).zfill(2) if text(row.get("chgerType")) else "",
            "outputKw": output_kw(row.get("output")),
            "method": text(row.get("method")),
            # Preserve charger-specific metadata without conflating stations.
            "powerType": text(row.get("powerType")),
            "manufacturer": text(row.get("maker")),
            "installationYear": text(row.get("year")),
            "floorNumber": text(row.get("floorNum")),
            "floorType": text(row.get("floorType")),
            "status": text(row.get("stat")) or "0",
            "statusChangedAt": timestamp(row.get("statUpdDt")),
            "observedAt": iso(parse_iso(row.get("_observedAt"))) if parse_iso(row.get("_observedAt")) else None,
            "lastStartedAt": timestamp(row.get("lastTsdt")),
            "lastEndedAt": timestamp(row.get("lastTedt")),
            "currentStartedAt": timestamp(row.get("nowTsdt")),
        })
    return {
        "id": station_id,
        "name": _first(rows, "statNm") or "이름 미제공 충전소",
        "address": _first(rows, "addr"),
        "detailAddress": _combine(rows, "addrDetail"),
        "location": _combine(rows, "location"),
        "lat": point[0], "lng": point[1],
        "regionCode": _first(rows, "zcode") or "00",
        "districtCode": _first(rows, "zscode"),
        "useTime": _combine(rows, "useTime"),
        "facilityKind": _first(rows, "kind"),
        "facilityDetailCode": _first(rows, "kindDetail"),
        # trafficYn is the source's generic convenience-provision flag,
        # not a certified wheelchair-accessibility indicator.
        "convenienceProvided": flag(_first(rows, "trafficYn")),
        "floorNumbers": _combine(rows, "floorNum"),
        "floorTypes": _combine(rows, "floorType"),
        "parkingFree": parking_free,
        "restricted": restricted,
        "restrictionReason": _combine(rows, "limitDetail"),
        "note": _combine(rows, "note"),
        "operatorId": _first(rows, "busiId"),
        "operatorName": _first(rows, "busiNm") or _first(rows, "bnm"),
        "phone": _first(rows, "busiCall"),
        "chargers": chargers,
    }


def empty_manifest(*, configured: bool = False, warning: dict[str, str] | None = None) -> dict[str, Any]:
    return {
        "schemaVersion": 1, "mode": "snapshot" if configured else "unconfigured",
        "generatedAt": None, "inventoryUpdatedAt": None, "statusCoverageAt": None,
        "source": SOURCE, "totalStations": 0, "totalChargers": 0,
        "freshnessThresholdSeconds": 600, "regions": [],
        "warnings": [warning] if warning else [{"code": "INITIALIZING" if configured else "UNCONFIGURED", "message": "공공데이터를 처음 수집하고 있습니다." if configured else "공공데이터 서비스키와 수집 환경을 설정하면 충전소가 표시됩니다."}],
    }


class RunLock(AbstractContextManager):
    """Keep collector processes from publishing or spending the budget concurrently."""

    def __init__(self, path: Path):
        self.path = path
        self.handle: Any = None

    def __enter__(self) -> "RunLock":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.path.open("a+b")
        try:
            if os.name == "nt":
                import msvcrt
                self.handle.seek(0)
                if not self.handle.read(1):
                    self.handle.write(b"0")
                    self.handle.flush()
                self.handle.seek(0)
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (OSError, BlockingIOError):
            self.handle.close()
            self.handle = None
            raise CollectionError("COLLECTION_BUSY", "다른 수집 프로세스가 실행 중입니다.") from None
        return self

    def __exit__(self, *args: Any) -> None:
        if self.handle:
            if os.name == "nt":
                import msvcrt
                self.handle.seek(0)
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
            self.handle.close()


class Collector:
    def __init__(
        self,
        client: OpenDataClient,
        *,
        output_dir: Path,
        state_dir: Path,
        mode: str = "snapshot",
        period: int = 10,
        inventory_refresh_seconds: int = 86400,
        release_retention: int = 3,
        clock: Callable[[], datetime] = utcnow,
    ):
        if mode not in {"snapshot", "live"}:
            raise ValueError("Invalid publication mode")
        if not 1 <= period <= 10:
            raise ValueError("period must be between 1 and 10")
        self.client = client
        self.output_dir = Path(output_dir)
        self.state_dir = Path(state_dir)
        self.state_path = self.state_dir / "state.json"
        self.mode = mode
        self.period = period
        self.inventory_refresh_seconds = inventory_refresh_seconds
        self.release_retention = max(2, release_retention)
        self.clock = clock

    def _load_state(self) -> dict[str, Any]:
        state = read_json(self.state_path, {})
        if not isinstance(state, dict) or state.get("schemaVersion") != 1 or not isinstance(state.get("rows"), dict):
            return {}
        return state

    def _full(self) -> tuple[dict[str, Any], Batch]:
        # No region filter: accept current, legacy and future upstream region codes.
        batch = self.client.fetch_all("getChargerInfo")
        if not batch.items:
            raise CollectionError("EMPTY_INVENTORY", "전국 충전기 목록이 비어 있어 기존 정보를 교체하지 않았습니다.")
        rows: dict[str, dict[str, Any]] = {}
        for incoming in batch.items:
            key = record_key(incoming)
            if key in rows:
                raise CollectionError("DUPLICATE_INVENTORY", "전체 목록에 중복 충전기 식별자가 있어 누락 여부를 확정하지 못했습니다.")
            rows[key] = incoming
        rows = {key: row for key, row in rows.items() if flag(row.get("delYn")) is not True}
        if not rows:
            raise CollectionError("EMPTY_INVENTORY", "전국 목록에서 삭제되지 않은 충전기를 확인하지 못해 기존 정보를 유지합니다.")
        return {
            "schemaVersion": 1,
            "inventoryUpdatedAt": iso(batch.completed_at),
            "inventoryStartedAt": iso(batch.started_at),
            # A late page must not advance confirmation of an early page.
            "statusCoverageAt": iso(batch.started_at),
            "needsFullRefresh": False,
            "rows": rows,
        }, batch

    def _delta(self, old: dict[str, Any]) -> tuple[dict[str, Any], Batch]:
        batch = self.client.fetch_all("getChargerStatus", period=self.period)
        coverage = parse_iso(old.get("statusCoverageAt"))
        # Every page uses a moving relative window. The final page must still
        # reach the previous coverage, even if the first page started in time.
        if not coverage or batch.completed_at - coverage > timedelta(minutes=self.period):
            raise CollectionError("STATUS_GAP", "상태 변경을 조회할 수 있는 기간을 초과해 전체 재동기화가 필요합니다.")
        if batch.completed_at - batch.started_at >= timedelta(minutes=self.period):
            raise CollectionError("STATUS_GAP", "상태 페이지 수집 시간이 조회 범위를 초과해 전체 재동기화가 필요합니다.")
        rows = {key: dict(value) for key, value in old["rows"].items()}
        for incoming in batch.items:
            key = record_key(incoming)
            if not text(incoming.get("stat")) or timestamp(incoming.get("statUpdDt")) is None:
                # Missing fields cannot confirm the previous state as current.
                # Unknown but present status codes remain valid and visible.
                raise CollectionError("INVALID_STATUS", "상태 변경 응답에 상태 또는 유효한 변경 시각이 없어 기존 확인 시각을 유지합니다.")
            previous = rows.get(key)
            if previous is None:
                # Status payloads have no location or connector type; recover a real inventory.
                raise CollectionError("NEW_CHARGER", "새 충전기의 상태를 수신해 위치 및 충전기 정보 재동기화가 필요합니다.")
            incoming_busi, previous_busi = text(incoming.get("busiId")), text(previous.get("busiId"))
            if incoming_busi and previous_busi and incoming_busi != previous_busi:
                raise CollectionError("ID_COLLISION", "같은 충전기 식별자의 운영기관이 변경되어 전체 재동기화가 필요합니다.")
            if _is_older(incoming, previous):
                continue
            rows[key] = {**previous, **{key: value for key, value in incoming.items() if key in STATUS_FIELDS}}
        state = {
            **old,
            "rows": rows,
            "statusCoverageAt": iso(batch.started_at),
            "needsFullRefresh": False,
        }
        return state, batch

    def _publish(self, state: dict[str, Any]) -> dict[str, Any]:
        station_rows: dict[str, list[dict[str, Any]]] = {}
        for row in state["rows"].values():
            if flag(row.get("delYn")) is True:
                continue
            station_rows.setdefault(text(row.get("statId")), []).append(row)
        stations = [normalize_station(station_id, rows) for station_id, rows in station_rows.items()]
        grouped: dict[str, list[dict[str, Any]]] = {}
        for station in stations:
            grouped.setdefault(station["regionCode"], []).append(station)
        # Completeness is recorded so unavailable upstream attributes are not
        # confused with a broken collector or fabricated default values.
        chargers = [charger for station in stations for charger in station["chargers"]]
        completeness = {
            "station": {
                "facilityKind": sum(bool(station["facilityKind"]) for station in stations),
                "facilityDetailCode": sum(bool(station["facilityDetailCode"]) for station in stations),
                "convenienceProvided": sum(station["convenienceProvided"] is not None for station in stations),
                "floorInformation": sum(bool(station["floorNumbers"]) for station in stations),
                "coordinates": sum(station["lat"] is not None and station["lng"] is not None for station in stations),
                "restricted": sum(station["restricted"] is True for station in stations),
            },
            "charger": {
                "manufacturer": sum(bool(charger["manufacturer"]) for charger in chargers),
                "installationYear": sum(bool(charger["installationYear"]) for charger in chargers),
                "floorNumber": sum(bool(charger["floorNumber"]) for charger in chargers),
                "powerType": sum(bool(charger["powerType"]) for charger in chargers),
                "stateObservedAt": sum(bool(charger["observedAt"]) for charger in chargers),
            },
        }
        generated_at = iso(self.clock())
        release_id = self.clock().strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:10]
        release_dir = self.output_dir / "releases" / release_id
        release_dir.mkdir(parents=True, exist_ok=False)
        manifest = {
            "schemaVersion": 1, "mode": self.mode, "generatedAt": generated_at,
            "inventoryUpdatedAt": state["inventoryUpdatedAt"],
            "statusCoverageAt": state["statusCoverageAt"], "source": SOURCE,
            "totalStations": len(stations), "totalChargers": sum(len(station["chargers"]) for station in stations),
            "freshnessThresholdSeconds": 600, "regions": [], "warnings": [],
            "dataCompleteness": completeness,
        }
        invalid_locations = 0
        for code, items in sorted(grouped.items()):
            items.sort(key=lambda item: (item["name"], item["id"]))
            safe_code = code if re.fullmatch(r"[A-Za-z0-9_-]{1,32}", code) else "unknown-" + hashlib.sha256(code.encode()).hexdigest()[:12]
            relative = f"releases/{release_id}/regions/{safe_code}.json"
            region = {
                "schemaVersion": 1, "regionCode": code, "mode": self.mode,
                "generatedAt": generated_at, "inventoryUpdatedAt": state["inventoryUpdatedAt"],
                "statusCoverageAt": state["statusCoverageAt"], "complete": True,
                "stations": items,
            }
            atomic_json(self.output_dir / relative, region)
            points = [(item["lat"], item["lng"]) for item in items if item["lat"] is not None and item["lng"] is not None]
            invalid_locations += len(items) - len(points)
            bounds = {
                "south": min(point[0] for point in points), "north": max(point[0] for point in points),
                "west": min(point[1] for point in points), "east": max(point[1] for point in points),
            } if points else {"south": None, "north": None, "west": None, "east": None}
            manifest["regions"].append({
                "code": code, "name": REGIONS.get(code, f"지역 코드 {code}"), "path": relative,
                "bounds": bounds, "stationCount": len(items), "chargerCount": sum(len(item["chargers"]) for item in items),
            })
        if invalid_locations:
            manifest["warnings"].append({"code": "INVALID_COORDINATES", "message": f"위치가 유효하지 않은 충전소 {invalid_locations}곳은 목록에서만 확인할 수 있습니다."})
        # State is private and complete before the public pointer is advanced.
        atomic_json(self.state_path, {**state, "releaseId": release_id})
        atomic_json(self.output_dir / "manifest.json", manifest)
        try:
            self._prune_releases(release_id)
        except OSError:
            # Retention cleanup is optional after the atomic publication succeeded.
            pass
        return manifest

    def _prune_releases(self, current_id: str) -> None:
        releases = self.output_dir / "releases"
        candidates = sorted((path for path in releases.iterdir() if path.is_dir() and re.fullmatch(r"\d{8}T\d{6}-[a-f0-9]{10}", path.name)), key=lambda path: path.name, reverse=True)
        keep = {current_id, *(path.name for path in candidates[:self.release_retention])}
        for path in candidates:
            if path.name not in keep:
                shutil.rmtree(path, ignore_errors=True)

    def run(self, requested: str = "auto") -> dict[str, Any]:
        if requested not in {"auto", "full", "status"}:
            raise ValueError("mode must be auto, full or status")
        with RunLock(self.state_dir / "collect.lock"):
            self.client.budget.reset_run()
            previous = self._load_state()
            now = self.clock()
            coverage = parse_iso(previous.get("statusCoverageAt"))
            inventory = parse_iso(previous.get("inventoryUpdatedAt"))
            manifest_exists = (self.output_dir / "manifest.json").is_file()
            full = requested == "full" or not previous or not manifest_exists or previous.get("needsFullRefresh", False)
            full = full or coverage is None or now - coverage > timedelta(minutes=self.period) or coverage > now
            if requested == "auto":
                full = full or inventory is None or now - inventory >= timedelta(seconds=self.inventory_refresh_seconds)
            operation = "full" if full else "status"
            try:
                if full:
                    state, batch = self._full()
                else:
                    try:
                        state, batch = self._delta(previous)
                    except CollectionError as error:
                        if error.code not in {"NEW_CHARGER", "ID_COLLISION", "STATUS_GAP"}:
                            raise
                        state, batch = self._full()
                        operation = "full-recovery"
                manifest = self._publish(state)
            except (CollectionError, OSError):
                if previous:
                    # No public files or coverage timestamp change on failure.
                    atomic_json(self.state_path, {**previous, "needsFullRefresh": True})
                raise
            return {"status": "ok", "operation": operation, "calls": self.client.budget.used, "pages": batch.pages, "totalStations": manifest["totalStations"], "totalChargers": manifest["totalChargers"], "generatedAt": manifest["generatedAt"]}
