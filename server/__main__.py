from __future__ import annotations

import argparse
import os
from pathlib import Path

from .http_server import Runtime, make_server, positive_environment


def main() -> int:
    repository = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="충전한눈 지도와 공유 공공데이터 API 서버")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--public-dir", type=Path, default=repository / "public")
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--state-dir", type=Path, default=repository / ".cache" / "evchargingstation")
    parser.add_argument("--no-poll", action="store_true", help="백그라운드 공공데이터 수집을 시작하지 않음")
    arguments = parser.parse_args()
    try:
        runtime = Runtime(
            public_dir=arguments.public_dir,
            data_dir=arguments.data_dir or arguments.public_dir / "data",
            state_dir=arguments.state_dir,
            service_key=os.environ.get("DATA_GO_KR_SERVICE_KEY", ""),
            poll_seconds=positive_environment("STATUS_POLL_INTERVAL_SECONDS", 300),
        )
        server = make_server(runtime, arguments.host, arguments.port)
    except (ValueError, OSError):
        parser.exit(2, "서버 주소, 포트, 환경변수 및 파일 접근 설정을 확인해 주세요.\n")
    if not arguments.no_poll:
        runtime.start()
    print(f"충전한눈: http://{arguments.host}:{server.server_port}", flush=True)
    print("데이터: 서비스키 설정됨" if runtime.configured else "데이터: 서비스키 미설정 — 저장된 정보 또는 빈 초기 화면", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        runtime.stop()
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
