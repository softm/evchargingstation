#!/usr/bin/env python3
"""Refresh approved tariff datasets independently from official charger API calls."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server.fees import refresh_chargeinfo

def main() -> int:
    parser = argparse.ArgumentParser(description="요금표 수집 (재배포 권한 확인 필수)")
    parser.add_argument("--output", type=Path, default=ROOT / "public/data/fees.json")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    allowed = os.environ.get("CHARGEINFO_REUSE_APPROVED", "").strip().lower() == "true"
    try:
        result = refresh_chargeinfo(args.output, permission_granted=allowed, force=args.force)
    except (OSError, ValueError, KeyError, TimeoutError) as exc:
        print(json.dumps({"status": "error", "code": type(exc).__name__,
                          "message": "요금 수집에 실패했습니다. 기존 자료를 유지합니다."}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
