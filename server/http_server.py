"""A small same-origin HTTP server with shared background collection."""

from __future__ import annotations

import json
import mimetypes
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

from .client import CallBudget, CollectionError, OpenDataClient, read_json
from .collector import Collector, empty_manifest


def positive_environment(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError:
        raise ValueError(f"{name} must be a positive integer") from None
    if value < 1:
        raise ValueError(f"{name} must be a positive integer")
    return value


class Runtime:
    def __init__(
        self,
        *,
        public_dir: Path,
        data_dir: Path,
        state_dir: Path,
        service_key: str = "",
        poll_seconds: int = 300,
    ):
        if not 60 <= poll_seconds <= 600:
            raise ValueError("STATUS_POLL_INTERVAL_SECONDS must be between 60 and 600")
        self.public_dir = public_dir.resolve()
        self.data_dir = data_dir.resolve()
        self.state_dir = state_dir.resolve()
        self.configured = bool(service_key.strip())
        self.poll_seconds = poll_seconds
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None
        self.error: dict[str, str] | None = None
        self.live_ready = False
        self.allowed_origins = {origin.strip().rstrip("/") for origin in os.environ.get("EV_ALLOWED_ORIGINS", "").split(",") if origin.strip()}
        self.collector: Collector | None = None
        if self.configured:
            budget = CallBudget(
                positive_environment("MAX_API_CALLS_PER_RUN", 100),
                positive_environment("MAX_API_CALLS_PER_DAY", 1000),
                ledger=self.state_dir / "budget.json",
            )
            client = OpenDataClient(service_key, budget=budget)
            self.collector = Collector(
                client, output_dir=self.data_dir, state_dir=self.state_dir,
                mode="live", period=10,
                inventory_refresh_seconds=positive_environment("INVENTORY_REFRESH_SECONDS", 86400),
                release_retention=positive_environment("RELEASE_RETENTION", 3),
            )

    def manifest(self) -> dict[str, Any]:
        stored = read_json(self.data_dir / "manifest.json")
        if not isinstance(stored, dict) or stored.get("schemaVersion") != 1:
            return empty_manifest(configured=self.configured, warning=self.error)
        manifest = {**stored, "warnings": list(stored.get("warnings", []))}
        has_inventory = bool(manifest.get("generatedAt"))
        manifest["mode"] = "live" if has_inventory and self.live_ready else "snapshot" if has_inventory else "snapshot" if self.configured else "unconfigured"
        if not self.configured:
            manifest["warnings"].append({"code": "UNCONFIGURED", "message": "서비스키가 설정되지 않아 저장된 정보만 표시합니다." if has_inventory else "공공데이터 서비스키와 수집 환경을 설정하면 충전소가 표시됩니다."})
        elif not self.live_ready and not self.error:
            manifest["warnings"].append({"code": "INITIALIZING", "message": "최신 공공데이터를 수집하고 있습니다."})
        if self.error:
            manifest["warnings"].append(self.error)
        # Existing static defaults can contain the same configuration warning.
        manifest["warnings"] = list({warning.get("code", "UNKNOWN"): warning for warning in manifest["warnings"] if isinstance(warning, dict)}.values())
        return manifest

    def config(self) -> dict[str, Any]:
        return {
            "naverMapClientId": os.environ.get("PUBLIC_NAVER_MAP_CLIENT_ID", ""),
            "apiBaseUrl": "/api",
            "dataBaseUrl": "./data",
            "freshnessThresholdSeconds": 600,
        }

    def refresh(self) -> None:
        if not self.collector:
            return
        try:
            result = self.collector.run("auto")
            self.error = None
            self.live_ready = True
            print(json.dumps(result, ensure_ascii=False), flush=True)
        except CollectionError as error:
            self.error = {"code": error.code, "message": error.message}
            print(json.dumps({"status": "error", **self.error}, ensure_ascii=False), file=sys.stderr, flush=True)
        except (OSError, ValueError):
            self.error = {"code": "LOCAL_DATA_ERROR", "message": "수집 결과를 읽거나 저장하지 못해 이전 정보를 유지합니다."}
            print(json.dumps({"status": "error", **self.error}, ensure_ascii=False), file=sys.stderr, flush=True)

    def start(self) -> None:
        if not self.collector or self.thread:
            return
        def run() -> None:
            while not self.stop_event.is_set():
                self.refresh()
                self.stop_event.wait(self.poll_seconds)
        self.thread = threading.Thread(target=run, name="evcharger-collector", daemon=True)
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()


def make_handler(runtime: Runtime) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "EVChargingStation/1.0"

        def log_message(self, format: str, *args: Any) -> None:
            # Never log the raw request URL, query, header values or upstream bodies.
            return

        def _origin_allowed(self) -> bool:
            origin = self.headers.get("Origin", "").rstrip("/")
            if not origin:
                return True
            host = self.headers.get("Host", "")
            return origin in runtime.allowed_origins or origin in {f"http://{host}", f"https://{host}"}

        def _send(self, payload: bytes, content_type: str, *, code: int = 200, cache: str = "no-cache") -> None:
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", cache)
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
            origin = self.headers.get("Origin", "").rstrip("/")
            if origin and origin in runtime.allowed_origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.end_headers()
            if self.command != "HEAD":
                try:
                    self.wfile.write(payload)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        def _json(self, value: Any, *, code: int = 200) -> None:
            self._send(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8"), "application/json; charset=utf-8", code=code)

        def _file(self, root: Path, relative: str) -> None:
            parts = Path(relative).parts
            if any(part.startswith(".") or part == ".." for part in parts):
                self._json({"error": "not_found"}, code=404)
                return
            candidate = (root / relative).resolve()
            if not candidate.is_relative_to(root.resolve()) or not candidate.is_file():
                self._json({"error": "not_found"}, code=404)
                return
            try:
                payload = candidate.read_bytes()
            except OSError:
                self._json({"error": "file_unavailable"}, code=503)
                return
            content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
            if content_type.startswith("text/") or candidate.suffix in {".json", ".js", ".webmanifest"}:
                content_type += "; charset=utf-8"
            cache = "public, max-age=300, immutable" if "releases/" in relative else "no-cache"
            self._send(payload, content_type, cache=cache)

        def do_GET(self) -> None:
            if not self._origin_allowed():
                self._json({"error": "origin_not_allowed"}, code=403)
                return
            try:
                path = unquote(urlsplit(self.path).path)
            except ValueError:
                self._json({"error": "invalid_path"}, code=400)
                return
            if "\x00" in path or "\\" in path:
                self._json({"error": "invalid_path"}, code=400)
                return
            if path == "/config.js":
                payload = ("window.EV_CONFIG = " + json.dumps(runtime.config(), ensure_ascii=True) + ";\n").encode()
                self._send(payload, "text/javascript; charset=utf-8")
            elif path in {"/api/manifest.json", "/api/manifest"}:
                self._json(runtime.manifest())
            elif path == "/api/regions":
                self._json(runtime.manifest().get("regions", []))
            elif path == "/api/health":
                manifest = runtime.manifest()
                self._json({"mode": manifest["mode"], "configured": runtime.configured, "statusCoverageAt": manifest.get("statusCoverageAt"), "warnings": manifest["warnings"]})
            elif path.startswith("/api/regions/") and path.endswith(".json"):
                code = path.removeprefix("/api/regions/").removesuffix(".json")
                region = next((item for item in runtime.manifest().get("regions", []) if item.get("code") == code), None)
                if region:
                    self._file(runtime.data_dir, region["path"])
                else:
                    self._json({"error": "region_not_found"}, code=404)
            elif path.startswith("/api/releases/"):
                self._file(runtime.data_dir, path.removeprefix("/api/"))
            elif path.startswith("/api/"):
                self._json({"error": "not_found"}, code=404)
            else:
                self._file(runtime.public_dir, "index.html" if path == "/" else path.lstrip("/"))

        def do_HEAD(self) -> None:
            self.do_GET()

        def do_OPTIONS(self) -> None:
            if not self._origin_allowed():
                self._json({"error": "origin_not_allowed"}, code=403)
                return
            self.send_response(204)
            origin = self.headers.get("Origin", "").rstrip("/")
            if origin in runtime.allowed_origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
            self.send_header("Access-Control-Max-Age", "600")
            self.end_headers()

    return Handler


def make_server(runtime: Runtime, host: str = "127.0.0.1", port: int = 8000) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((host, port), make_handler(runtime))
    server.daemon_threads = True
    return server
