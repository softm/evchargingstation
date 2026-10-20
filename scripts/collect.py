#!/usr/bin/env python3
"""Collect official records without placing API credentials in a static build."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY))

from server.client import CallBudget, CollectionError, OpenDataClient, atomic_json
from server.collector import Collector, empty_manifest
from server.http_server import positive_environment


def main() -> int:
    parser = argparse.ArgumentParser(description="한국환경공단 전기차 충전기 전체/변경분 수집")
    parser.add_argument("--mode", choices=("auto", "full", "status"), default="auto")
    parser.add_argument("--output", type=Path, default=REPOSITORY / "public" / "data")
    parser.add_argument("--state-dir", type=Path, default=REPOSITORY / ".cache" / "evchargingstation")
    parser.add_argument("--period", type=int, choices=range(1, 11), default=10, metavar="1..10")
    parser.add_argument("--page-size", type=int, default=9999)
    parser.add_argument("--inventory-workers", type=int, choices=range(1, 5), default=3,
                        help="전국 목록 페이징 병렬 요청 수 (기본 3, 최대 4)")
    parser.add_argument("--max-calls", type=int, help="이번 실행 호출 예산; 기본 MAX_API_CALLS_PER_RUN 또는 100")
    parser.add_argument("--max-daily-calls", type=int, help="KST 기준 일일 호출 예산; 기본 MAX_API_CALLS_PER_DAY 또는 1000")
    arguments = parser.parse_args()
    service_key = os.environ.get("DATA_GO_KR_SERVICE_KEY", "")
    if not service_key.strip():
        if not (arguments.output / "manifest.json").exists():
            try:
                atomic_json(arguments.output / "manifest.json", empty_manifest())
            except OSError:
                print(json.dumps({"status": "error", "code": "WRITE_FAILED", "message": "초기 데이터 안내 파일을 저장하지 못했습니다."}, ensure_ascii=False), file=sys.stderr)
                return 1
        print(json.dumps({"status": "unconfigured", "code": "UNCONFIGURED", "message": "DATA_GO_KR_SERVICE_KEY 설정이 필요합니다. 기존 수집 파일은 변경하지 않았습니다."}, ensure_ascii=False), file=sys.stderr)
        return 2
    try:
        budget = CallBudget(
            arguments.max_calls if arguments.max_calls is not None else positive_environment("MAX_API_CALLS_PER_RUN", 100),
            arguments.max_daily_calls if arguments.max_daily_calls is not None else positive_environment("MAX_API_CALLS_PER_DAY", 1000),
            ledger=arguments.state_dir / "budget.json",
        )
        collector = Collector(
            OpenDataClient(service_key, budget=budget, page_size=arguments.page_size,
                           inventory_workers=arguments.inventory_workers),
            output_dir=arguments.output, state_dir=arguments.state_dir,
            period=arguments.period,
            inventory_refresh_seconds=positive_environment("INVENTORY_REFRESH_SECONDS", 86400),
            release_retention=positive_environment("RELEASE_RETENTION", 3),
        )
        print(json.dumps(collector.run(arguments.mode), ensure_ascii=False))
        return 0
    except CollectionError as error:
        print(json.dumps({"status": "error", "code": error.code, "message": error.message}, ensure_ascii=False), file=sys.stderr)
        return 1
    except (OSError, ValueError):
        print(json.dumps({"status": "error", "code": "LOCAL_CONFIGURATION_ERROR", "message": "수집 환경변수와 파일 저장 경로를 확인해 주세요. 기존 정상 데이터를 유지합니다."}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
