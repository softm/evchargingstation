"""Official EvCharger client. No credentials or raw upstream errors are logged."""

from __future__ import annotations

import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from http.client import HTTPException
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlencode
from urllib.request import Request, urlopen
from xml.etree import ElementTree


API_BASE = "https://apis.data.go.kr/B552584/EvCharger"
KST = timezone(timedelta(hours=9))
MAX_RESPONSE_BYTES = 32 * 1024 * 1024
MAX_ERROR_RESPONSE_BYTES = 64 * 1024


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def atomic_json(path: Path, value: Any) -> None:
    """Publish a complete file via a same-directory atomic rename."""
    import tempfile

    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


class CollectionError(Exception):
    """Only locally authored messages are safe to print to public logs."""

    def __init__(self, code: str, message: str, *, retryable: bool = False):
        self.code = code
        self.message = message
        self.retryable = retryable
        super().__init__(f"{code}: {message}")


@dataclass
class Page:
    items: list[dict[str, Any]]
    total_count: int
    page_no: int | None = None


@dataclass
class Batch:
    items: list[dict[str, Any]]
    started_at: datetime
    completed_at: datetime
    total_count: int
    pages: int


ERRORS = {
    "01": "공공데이터 제공기관에서 처리 오류가 발생했습니다.",
    "04": "공공데이터 요청 또는 기관 응답 처리에 실패했습니다.",
    "05": "공공데이터 응답 시간이 초과되었습니다.",
    "10": "공공데이터 요청변수 형식을 확인해야 합니다.",
    "12": "공공데이터 API 경로를 확인해야 합니다.",
    "20": "공공데이터 활용신청 승인 및 서비스키 설정을 확인해야 합니다.",
    "22": "공공데이터 일일 호출 허용량을 초과했습니다.",
    "23": "공공데이터 초당 호출 허용량을 초과했습니다.",
    "29": "공공데이터 요청 서버의 접근이 제한되었습니다.",
    "30": "공공데이터 서비스키 등록 및 인코딩 설정을 확인해야 합니다.",
    "31": "공공데이터 서비스키 이용 기간을 확인해야 합니다.",
}


def _code(value: Any) -> str:
    code = str(value).strip()
    if re.fullmatch(r"\d{1,2}", code):
        return code.zfill(2)
    # Do not echo arbitrary upstream response text, which can contain a key.
    return "UPSTREAM_ERROR"


def _check_code(value: Any) -> None:
    code = _code(value)
    if code != "00":
        raise CollectionError(
            code,
            ERRORS.get(code, "공공데이터 API가 정상 결과를 반환하지 않았습니다."),
            retryable=code in {"01", "04", "05", "23"},
        )


def _count(value: Any, label: str) -> int:
    if isinstance(value, bool):
        raise CollectionError("INVALID_RESPONSE", f"공공데이터 {label} 형식이 올바르지 않습니다.")
    text = str(value).strip()
    if not re.fullmatch(r"\d+", text):
        raise CollectionError("INVALID_RESPONSE", f"공공데이터 {label} 형식이 올바르지 않습니다.")
    return int(text)


def _items(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict) and "item" in value:
        value = value["item"]
    if value in (None, "", {}):
        return []
    if isinstance(value, dict):
        value = [value]
    if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
        raise CollectionError("INVALID_RESPONSE", "공공데이터 충전기 목록 형식이 올바르지 않습니다.")
    return value


def parse_response(payload: bytes) -> Page:
    """Accept the guide's flat JSON and XML, plus the gateway response wrapper."""
    if len(payload) > MAX_RESPONSE_BYTES:
        raise CollectionError("RESPONSE_TOO_LARGE", "공공데이터 응답이 허용 크기를 초과했습니다.")
    try:
        text = payload.decode("utf-8-sig").strip()
    except UnicodeError as error:
        raise CollectionError("INVALID_RESPONSE", "공공데이터 응답 문자 인코딩을 확인해야 합니다.") from error
    if not text:
        raise CollectionError("INVALID_RESPONSE", "공공데이터 응답이 비어 있습니다.")
    if text.startswith("<"):
        if "<!DOCTYPE" in text.upper() or "<!ENTITY" in text.upper():
            raise CollectionError("INVALID_RESPONSE", "지원하지 않는 XML 선언이 포함되어 있습니다.")
        try:
            root = ElementTree.fromstring(text)
        except ElementTree.ParseError as error:
            raise CollectionError("INVALID_RESPONSE", "공공데이터 XML 응답을 읽을 수 없습니다.") from error
        for element in root.iter():
            element.tag = element.tag.rsplit("}", 1)[-1]
        gateway = root.find(".//returnReasonCode")
        if gateway is not None:
            _check_code(gateway.text)
        header = root.find("header")
        if header is None:
            header = root
        _check_code(header.findtext("resultCode"))
        body = root.find("body")
        if body is None:
            body = root
        total_value = header.findtext("totalCount")
        if total_value is None:
            total_value = body.findtext("totalCount")
        total = _count(total_value, "전체 건수")
        page_value = header.findtext("pageNo") or body.findtext("pageNo")
        result = []
        for element in body.findall(".//items/item"):
            result.append({child.tag: (child.text or "") for child in element})
        return Page(result, total, _count(page_value, "페이지 번호") if page_value is not None else None)
    try:
        document = json.loads(text)
    except (ValueError, TypeError) as error:
        raise CollectionError("INVALID_RESPONSE", "공공데이터 JSON 응답을 읽을 수 없습니다.") from error
    if not isinstance(document, dict):
        raise CollectionError("INVALID_RESPONSE", "공공데이터 JSON 최상위 형식이 올바르지 않습니다.")
    gateway = document.get("OpenAPI_ServiceResponse")
    if isinstance(gateway, dict):
        gateway_header = gateway.get("cmmMsgHeader")
        if isinstance(gateway_header, dict):
            _check_code(gateway_header.get("returnReasonCode"))
    document = document.get("response", document)
    if not isinstance(document, dict):
        raise CollectionError("INVALID_RESPONSE", "공공데이터 응답 구조가 올바르지 않습니다.")
    header = document.get("header", document)
    body = document.get("body", document)
    if not isinstance(header, dict) or not isinstance(body, dict):
        raise CollectionError("INVALID_RESPONSE", "공공데이터 응답 구조가 올바르지 않습니다.")
    _check_code(header.get("resultCode"))
    total = _count(body.get("totalCount", header.get("totalCount")), "전체 건수")
    page_value = body.get("pageNo", header.get("pageNo"))
    return Page(_items(body.get("items")), total, _count(page_value, "페이지 번호") if page_value is not None else None)


class CallBudget:
    """A run limit and persistent KST-day limit, charged before every attempt."""

    def __init__(self, per_run: int = 100, per_day: int = 1000, *, ledger: Path | None = None, clock: Callable[[], datetime] = utcnow):
        if per_run < 1 or per_day < 1:
            raise ValueError("API call budgets must be positive")
        self.per_run = per_run
        self.per_day = per_day
        self.ledger = ledger
        self.clock = clock
        self.used = 0
        self._memory: dict[str, Any] = {}
        self._lock = Lock()

    def reset_run(self) -> None:
        with self._lock:
            self.used = 0

    def consume(self) -> None:
        # A full inventory requests at most a few pages concurrently. Protect
        # the per-run budget AND the on-disk KST ledger under the same lock.
        with self._lock:
            if self.used >= self.per_run:
                raise CollectionError("RUN_BUDGET_EXCEEDED", "이번 수집의 API 호출 예산을 모두 사용했습니다.")
            day = self.clock().astimezone(KST).date().isoformat()
            ledger = read_json(self.ledger, {}) if self.ledger else self._memory
            if not isinstance(ledger, dict):
                ledger = {}
            used = ledger.get("calls", 0) if ledger.get("date") == day else 0
            if not isinstance(used, int) or isinstance(used, bool) or used < 0:
                used = 0
            if used >= self.per_day:
                raise CollectionError("DAILY_BUDGET_EXCEEDED", "오늘 설정한 API 호출 예산을 모두 사용했습니다.")
            updated = {"date": day, "calls": used + 1}
            if self.ledger:
                atomic_json(self.ledger, updated)
            self._memory = updated
            self.used += 1


class OpenDataClient:
    def __init__(
        self,
        service_key: str,
        *,
        budget: CallBudget | None = None,
        page_size: int = 9999,
        timeout: int = 30,
        retries: int = 2,
        opener: Callable[..., Any] = urlopen,
        clock: Callable[[], datetime] = utcnow,
        sleeper: Callable[[float], None] = time.sleep,
        inventory_workers: int = 1,
    ):
        if not service_key.strip():
            raise CollectionError("UNCONFIGURED", "DATA_GO_KR_SERVICE_KEY 설정이 필요합니다.")
        if not 10 <= page_size <= 9999:
            raise ValueError("page_size must be between 10 and 9999")
        if not isinstance(inventory_workers, int) or not 1 <= inventory_workers <= 4:
            raise ValueError("inventory_workers must be between 1 and 4")
        # unquote (not unquote_plus) preserves '+' in a decoded service key.
        self._service_key = unquote(service_key.strip())
        self.budget = budget or CallBudget()
        self.page_size = page_size
        self.timeout = timeout
        self.retries = retries
        self.opener = opener
        self.clock = clock
        self.sleeper = sleeper
        self.inventory_workers = inventory_workers

    def _page(self, operation: str, page_no: int, parameters: dict[str, Any]) -> Page:
        if operation not in {"getChargerInfo", "getChargerStatus"}:
            raise ValueError("Unsupported EvCharger operation")
        if operation == "getChargerStatus" and not 1 <= int(parameters.get("period", 5)) <= 10:
            raise ValueError("period must be between 1 and 10 minutes")
        allowed = {"period", "zcode", "zscode", "kind", "kindDetail", "statId", "chgerId"}
        if set(parameters) - allowed:
            raise ValueError("Unsupported EvCharger parameter")
        query = {
            "serviceKey": self._service_key,
            "pageNo": page_no,
            "numOfRows": self.page_size,
            "dataType": "JSON",
            **{key: value for key, value in parameters.items() if value is not None and value != ""},
        }
        request = Request(f"{API_BASE}/{operation}?{urlencode(query)}", headers={"Accept": "application/json, application/xml", "User-Agent": "evchargingstation/1.0"})
        for attempt in range(self.retries + 1):
            self.budget.consume()
            try:
                with self.opener(request, timeout=self.timeout) as response:
                    payload = response.read(MAX_RESPONSE_BYTES + 1)
                return parse_response(payload)
            except HTTPError as error:
                failure = CollectionError("HTTP_ERROR", f"공공데이터 서버가 HTTP {int(error.code)} 오류를 반환했습니다.", retryable=error.code == 429 or 500 <= error.code < 600)
                try:
                    with error:
                        error_payload = error.read(MAX_ERROR_RESPONSE_BYTES + 1)
                    if len(error_payload) <= MAX_ERROR_RESPONSE_BYTES:
                        try:
                            parse_response(error_payload)
                        except CollectionError as upstream:
                            # Only known provider codes and locally authored
                            # messages may replace the generic HTTP diagnosis.
                            if upstream.code in ERRORS:
                                failure = upstream
                except (OSError, HTTPException, ValueError, RecursionError):
                    # Missing, unreadable or malformed bodies retain HTTP status.
                    pass
            except (URLError, TimeoutError, OSError, HTTPException):
                failure = CollectionError("NETWORK_ERROR", "공공데이터 서버 연결 또는 응답 수신에 실패했습니다.", retryable=True)
            except CollectionError as error:
                failure = error
            if not failure.retryable or attempt >= self.retries:
                raise failure from None
            self.sleeper(min(2 ** attempt, 4))
        raise AssertionError("unreachable")

    def _parallel_inventory(self, **parameters: Any) -> Batch:
        """Bounded parallel full inventory: keep whole-page checks before publication."""
        started = self.clock()
        first = self._page("getChargerInfo", 1, parameters)
        if first.page_no not in (None, 1) or first.total_count < 0:
            raise CollectionError("PAGE_MISMATCH", "전체 목록의 첫 페이지 번호가 올바르지 않습니다.")
        total = first.total_count
        expected_pages = max(1, (total + self.page_size - 1) // self.page_size)
        if len(first.items) != min(self.page_size, total):
            raise CollectionError("INCOMPLETE_PAGE", "전체 목록 첫 페이지의 항목 수가 누락됐습니다.")
        received = [{**item, "_observedAt": iso(self.clock())} for item in first.items]

        def read(number: int) -> list[dict[str, Any]]:
            page = self._page("getChargerInfo", number, parameters)
            if page.page_no not in (None, number) or page.total_count != total:
                raise CollectionError("INCONSISTENT_PAGES", "전국 목록 수집 중 페이지 또는 전체 건수가 달라졌습니다.")
            expected_rows = min(self.page_size, total - (number - 1) * self.page_size)
            if len(page.items) != expected_rows:
                raise CollectionError("INCOMPLETE_PAGE", "전국 목록에 페이지 항목이 누락됐습니다.")
            observed = iso(self.clock())
            return [{**item, "_observedAt": observed} for item in page.items]

        if expected_pages > 1:
            # Only the inventory is parallelized. The rolling 10-minute state
            # window is still fetched sequentially to preserve its semantics.
            with ThreadPoolExecutor(max_workers=self.inventory_workers) as pool:
                for chunk in pool.map(read, range(2, expected_pages + 1)):
                    received.extend(chunk)
        if len(received) != total:
            raise CollectionError("INCOMPLETE_PAGE", "전체 충전기 개수가 제공기관의 건수와 다릅니다.")
        return Batch(received, started, self.clock(), total, expected_pages)

    def fetch_all(self, operation: str, **parameters: Any) -> Batch:
        if operation == "getChargerInfo" and self.inventory_workers > 1:
            return self._parallel_inventory(**parameters)
        started = self.clock()
        result: list[dict[str, Any]] = []
        expected: int | None = None
        maximum_total = 0
        page_no = 1
        while True:
            page = self._page(operation, page_no, parameters)
            observed_at = iso(self.clock())
            if page.page_no is not None and page.page_no != page_no:
                raise CollectionError("PAGE_MISMATCH", "공공데이터가 요청한 페이지와 다른 페이지를 반환했습니다.")
            if expected is None:
                expected = page.total_count
            elif operation == "getChargerInfo" and page.total_count != expected:
                raise CollectionError("INCONSISTENT_PAGES", "수집 중 전체 건수가 변경되어 완전한 목록을 확정하지 못했습니다.")
            maximum_total = max(maximum_total, page.total_count)
            # A status query's relative time window moves while pages are fetched.
            # Validate the current page, then scan the largest observed page range.
            remaining = max(page.total_count - (page_no - 1) * self.page_size, 0)
            expected_rows = min(self.page_size, remaining)
            if len(page.items) != expected_rows:
                raise CollectionError("INCOMPLETE_PAGE", "공공데이터 페이지의 실제 항목 수가 전체 건수와 맞지 않습니다.")
            for item in page.items:
                result.append({**item, "_observedAt": observed_at})
            if page_no * self.page_size >= maximum_total:
                return Batch(result, started, self.clock(), maximum_total, page_no)
            page_no += 1
