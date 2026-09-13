from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import TYPE_CHECKING
from urllib.parse import urlparse

if TYPE_CHECKING:
    from .runtime import TowerRuntime


ATTACK_SURFACE = {
    "name": "The Tower",
    "authorized_target": True,
    "runtime": "Wasmer WASIX sandbox",
    "note": "Agents should attack TARGET_URL, not this control plane.",
    "endpoints": [
        {"method": "GET", "path": "/", "desc": "Banner"},
        {"method": "GET", "path": "/health", "desc": "Health number"},
        {"method": "GET", "path": "/docs", "desc": "Full attack surface (recon)"},
        {"method": "POST", "path": "/login", "desc": "Broken auth — admin/admin or admin'--"},
        {"method": "GET", "path": "/search?q=", "desc": "Injection — q=' OR 1=1 --"},
        {"method": "GET", "path": "/users/<id>", "desc": "IDOR"},
        {"method": "GET", "path": "/admin/treasury?role=admin", "desc": "Auth bypass"},
        {"method": "GET", "path": "/files?path=/workspace/flag.txt", "desc": "Path traversal"},
        {"method": "POST", "path": "/withdraw", "desc": "Logic abuse — negative amount"},
        {"method": "POST", "path": "/transfer", "desc": "Logic abuse — no ownership check"},
        {"method": "POST", "path": "/export", "desc": "Command injection — job with ;"},
        {"method": "GET", "path": "/compute?n=500000", "desc": "DoS — unbounded compute"},
    ],
}


def start_control(runtime: TowerRuntime, host: str, port: int) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args) -> None:
            print(f"[control] {self.address_string()} {fmt % args}", flush=True)

        def _send(self, code: int, body) -> None:
            raw = json.dumps(body).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(raw)

        def do_OPTIONS(self) -> None:  # noqa: N802
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "*")
            self.end_headers()

        def do_GET(self) -> None:  # noqa: N802
            route = urlparse(self.path).path.rstrip("/") or "/"
            if route == "/":
                return self._send(200, runtime.snapshot())
            if route == "/status":
                return self._send(200, runtime.snapshot())
            if route == "/events":
                return self._send(200, {"events": runtime.recent_events()})
            if route == "/attack-surface":
                body = dict(ATTACK_SURFACE)
                body["target_url"] = runtime.target_url
                return self._send(200, body)
            if route == "/health":
                snap = runtime.snapshot()
                return self._send(200, {"ok": snap["running"], "health": snap["health"]})
            self._send(404, {"error": "unknown_control_route"})

        def do_POST(self) -> None:  # noqa: N802
            route = urlparse(self.path).path.rstrip("/") or "/"
            if route == "/reset":
                result = runtime.request_reset("control-plane")
                return self._send(200, result)
            self._send(404, {"error": "unknown_control_route"})

    server = ThreadingHTTPServer((host, port), Handler)
    return server
