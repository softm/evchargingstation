"""Optional, permission-gated publisher tariff ingestion.

Chargeinfo web endpoints are *not* a documented public redistribution API.
Never fetch or republish them unless the operator has confirmed reuse rights.
No credentials, contact records, or other company profile fields are stored.
"""
from __future__ import annotations

import json
import math
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen

from .client import atomic_json, read_json, utcnow

COMPANY_URL = "https://chargeinfo.ksga.org/ws/organization/company/list?feeShowYn=Y"
TARIFF_URL = "https://chargeinfo.ksga.org/ws/tariff/charger/list"
SOURCE_PAGE = "https://chargeinfo.ksga.org/front/fee/feeTable"
MAX_BYTES = 2_000_000
RATE_LIMIT = timedelta(hours=24)


def _records(value):
    if not isinstance(value, dict) or not isinstance(value.get("result"), list):
        raise ValueError("The tariff source does not have the expected published structure")
    return value["result"]


def _price(value):
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return round(number, 2) if math.isfinite(number) and 1 <= number <= 2000 else None


def _iso_date(value):
    value = str(value or "")
    if not re.fullmatch(r"\d{8}", value):
        return None
    try:
        return datetime.strptime(value, "%Y%m%d").strftime("%Y-%m-%d")
    except ValueError:
        return None


def normalize_chargeinfo(companies, tariffs, *, collected_at=None):
    """Reduce publisher data to operator codes and tariff guidance only."""
    collected_at = collected_at or utcnow()
    company_rows, tariff_rows = _records(companies), _records(tariffs)
    today = collected_at.strftime("%Y%m%d")
    result = {}
    for company in company_rows:
        if not isinstance(company, dict):
            continue
        # kecoBid is the publisher's mapping to the KECO busiId. No name-guessing.
        bid = str(company.get("bid") or "").strip().upper()
        code = str(company.get("kecoBid") or "").strip().upper()
        name = str(company.get("companyName") or "").strip()[:120]
        if not re.fullmatch(r"[A-Z0-9]{2,8}", code) or not re.fullmatch(r"[A-Z0-9]{2,8}", bid) or not name:
            continue
        if company.get("feeShowYn") == "N" or company.get("approveYn") == "N":
            continue
        if code in result:
            # Ambiguous mapping: fail closed instead of assigning another operator's price.
            result[code]["ambiguous"] = True
            continue
        result[code] = {"operatorId": code, "publisherId": bid, "name": name, "rates": []}
    index = {item["publisherId"]: item for item in result.values() if not item.get("ambiguous")}
    for row in tariff_rows:
        if not isinstance(row, dict):
            continue
        company = index.get(str(row.get("bid") or "").strip().upper())
        if company is None or row.get("openType") not in (None, "O"):
            continue
        membership = {"M": "member", "G": "nonmember"}.get(row.get("customerType"))
        kind = {"1": "slow", "2": "fast"}.get(str(row.get("csKindType") or ""))
        price = _price(row.get("averageFee"))
        if membership is None or kind is None or price is None:
            continue
        if row.get("feeType") not in ("FIX_UNIT_PRICE",):
            continue
        start, end = str(row.get("startDt") or ""), str(row.get("endDt") or "")
        if start and start > today or end and end < today:
            continue
        rate = {"kind": kind, "membership": membership, "minPrice": price,
                "maxPrice": price, "basis": "published_tariff_average",
                "label": str(row.get("name") or "")[:80],
                "effectiveFrom": _iso_date(start)}
        if rate not in company["rates"]:
            company["rates"].append(rate)
    operators = [value for value in result.values() if not value.get("ambiguous") and value["rates"]]
    if len(operators) < 10 or sum(len(item["rates"]) for item in operators) < 20:
        raise ValueError("Published tariff sample is too small; previous verified prices retained")
    operators.sort(key=lambda x: x["operatorId"])
    return {"schemaVersion": 1, "mode": "licensed_publisher", "currency": "KRW",
            "unit": "kWh", "collectedAt": collected_at.isoformat(timespec="seconds").replace("+00:00", "Z"),
            "source": {"name": "한국스마트그리드협회 차지인포", "url": SOURCE_PAGE,
                       "notice": "공시 요금제 참고값입니다. 현장가·로밍·프로모션과 다를 수 있습니다."},
            "operators": operators}


def fetch_json(url, *, opener=urlopen):
    req = Request(url, headers={
        "User-Agent": "evchargingstation-fee-import/1.0 (contact through GitHub repository)",
        "Accept": "application/json",
    })
    with opener(req, timeout=25) as response:
        if not str(response.headers.get("Content-Type", "")).lower().startswith("application/json"):
            raise ValueError("Tariff endpoint returned non-JSON content")
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("Tariff response exceeded its safety limit")
    return json.loads(body)


def refresh_chargeinfo(path, *, permission_granted=False, now=None, opener=urlopen, force=False):
    """Do not make a single publisher request unless reuse has been authorized."""
    path = Path(path)
    if not permission_granted:
        return {"status": "permission_required", "preserved": path.exists()}
    now = now or utcnow()
    existing = read_json(path, {})
    if not force and existing.get("mode") == "licensed_publisher":
        try:
            last = datetime.fromisoformat(existing["collectedAt"].replace("Z", "+00:00"))
            if timedelta(0) <= now - last < RATE_LIMIT:
                return {"status": "not_due", "preserved": True}
        except (ValueError, KeyError, TypeError):
            pass
    # Both responses must be valid BEFORE replacing the prior good catalog.
    companies = fetch_json(COMPANY_URL, opener=opener)
    prices = fetch_json(TARIFF_URL, opener=opener)
    verified = normalize_chargeinfo(companies, prices, collected_at=now)
    atomic_json(path, verified)
    return {"status": "updated", "operators": len(verified["operators"]),
            "tariffs": sum(len(entry["rates"]) for entry in verified["operators"])}
