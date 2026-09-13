#!/usr/bin/env python3
"""The Tower — intentionally vulnerable citadel API.

Stdlib only, single-threaded, WASIX-safe. Do not use this pattern in real apps.
Security events are printed as `TOWER_EVENT {json}` lines for the Wasmer host.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8080"))
WORKSPACE = Path("/workspace")

USERS = {
    "alice": {"password": "wonderland", "role": "citizen", "gold": 120, "id": 1},
    "bob": {"password": "builder", "role": "citizen", "gold": 80, "id": 2},
    "admin": {"password": "admin", "role": "admin", "gold": 9999, "id": 3},
}

STATE = {
    "health": 100,
    "boot_ts": time.time(),
    "request_count": 0,
    "treasury": 100000,
    "seen_weaknesses": {},
}

DAMAGE = {
    "injection.search": ("high", -15, "SQL-style injection dumped citadel records"),
    "injection.export": ("critical", -25, "Command injection leaked a sandbox secret"),
    "auth.login": ("high", -18, "Broken login accepted an injection/default credential"),
    "auth.bypass": ("critical", -22, "Admin treasury opened without a real session"),
    "auth.token": ("high", -16, "Forged bearer token was accepted as an admin session"),
    "logic.withdraw": ("high", -12, "Negative withdraw credited gold out of thin air"),
    "logic.transfer": ("medium", -10, "Transfer skipped ownership checks"),
    "dos.compute": ("high", -10, "Unbounded compute endpoint stalled the tower"),
    "recon.files": ("critical", -25, "Path traversal read the citadel flag"),
    "recon.debug": ("medium", -6, "Debug endpoint leaked sandbox internals"),
    "logic.idor": ("medium", -8, "IDOR read another citizen's record"),
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def emit(event_type: str, **kwargs) -> None:
    payload = {
        "event_type": event_type,
        "agent_id": kwargs.pop("agent_id", "target"),
        "agent_persona": kwargs.pop("agent_persona", "tower"),
        "target_component": kwargs.get("target_component", "tower"),
        "severity": kwargs.get("severity", "info"),
        "description": kwargs.get("description", ""),
        "health_delta": kwargs.get("health_delta", 0),
        "timestamp": now_iso(),
        "health": STATE["health"],
        "sandbox": "wasmer",
    }
    payload.update(kwargs)
    print("TOWER_EVENT " + json.dumps(payload), flush=True)


def apply_weakness(key: str, component: str, extra: str = "") -> dict:
    severity, delta, description = DAMAGE[key]
    first = key not in STATE["seen_weaknesses"]
    STATE["seen_weaknesses"][key] = STATE["seen_weaknesses"].get(key, 0) + 1
    applied = delta if first else -1
    STATE["health"] = max(0, STATE["health"] + applied)
    persona = key.split(".", 1)[0]
    if persona == "auth":
        persona = "auth_bypass"
    elif persona == "logic":
        persona = "logic_abuse"
    elif persona == "recon":
        persona = "recon"
    event = {
        "event_type": "weakness_found",
        "agent_id": "target-instrumentation",
        "agent_persona": persona,
        "target_component": component,
        "severity": severity if first else "low",
        "description": description + (f" ({extra})" if extra else ""),
        "health_delta": applied,
        "weakness_id": key,
        "first_seen": first,
    }
    emit(**event)
    return event


def token_for(username: str, role: str) -> str:
    raw = f"{username}:{role}".encode("utf-8")
    return base64.b64encode(raw).decode("ascii")


def decode_token(token: str) -> dict | None:
    try:
        decoded = base64.b64decode(token.encode("ascii")).decode("utf-8")
        username, role = decoded.split(":", 1)
        return {"username": username, "role": role}
    except Exception:
        return None


def load_json(path: Path, fallback):
    try:
        return json.loads(path.read_text())
    except Exception:
        return fallback


class TowerHandler(BaseHTTPRequestHandler):
    server_version = "Tower/0.1"

    def log_message(self, fmt: str, *args) -> None:
        print(f"TOWER_ACCESS {self.address_string()} {fmt % args}", flush=True)

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("X-Tower-Health", str(STATE["health"]))
        self.send_header("X-Tower-Runtime", "wasmer-wasix")

    def _send(self, code: int, body, headers=None) -> None:
        if not isinstance(body, (bytes, bytearray)):
            body = json.dumps(body).encode("utf-8")
            content_type = "application/json; charset=utf-8"
        else:
            content_type = "text/plain; charset=utf-8"
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        if headers:
            for key, value in headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _query(self) -> dict:
        return parse_qs(urlparse(self.path).query)

    def _route(self) -> str:
        return urlparse(self.path).path.rstrip("/") or "/"

    def _auth(self) -> dict | None:
        header = self.headers.get("Authorization", "")
        if header.lower().startswith("bearer "):
            parsed = decode_token(header.split(" ", 1)[1].strip())
            if parsed and parsed.get("role") == "admin" and parsed.get("username") not in USERS:
                apply_weakness("auth.token", "/whoami", extra=parsed.get("username", ""))
            return parsed
        cookie = self.headers.get("Cookie", "")
        if "session=admin" in cookie:
            apply_weakness("auth.bypass", "cookie", extra="session=admin")
            return {"username": "admin", "role": "admin"}
        return None

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        self._handle("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._handle("POST")

    def _handle(self, method: str) -> None:
        STATE["request_count"] += 1
        route = self._route()
        try:
            if method == "GET" and route == "/":
                return self._send(200, self._index())
            if method == "GET" and route == "/health":
                return self._send(200, self._health())
            if method == "GET" and route == "/status":
                return self._send(200, self._status())
            if method == "GET" and route == "/docs":
                return self._send(200, ATTACK_SURFACE)
            if method == "POST" and route == "/login":
                return self._login()
            if method == "GET" and route == "/whoami":
                return self._whoami()
            if method == "GET" and route == "/search":
                return self._search()
            if method == "GET" and route == "/users":
                return self._users()
            if route.startswith("/users/"):
                return self._user_by_id(route.split("/", 2)[-1])
            if method == "GET" and route == "/admin/treasury":
                return self._treasury()
            if method == "GET" and route == "/admin/debug":
                return self._debug()
            if method == "GET" and route == "/files":
                return self._files()
            if method == "POST" and route == "/withdraw":
                return self._withdraw()
            if method == "POST" and route == "/transfer":
                return self._transfer()
            if method == "POST" and route == "/export":
                return self._export()
            if method == "GET" and route == "/compute":
                return self._compute()
            if method == "GET" and route == "/internal/config":
                return self._internal_config()
            self._send(404, {"error": "unknown_endpoint", "path": route})
        except Exception as exc:
            emit(
                "weakness_found",
                agent_id="target-instrumentation",
                agent_persona="dos",
                target_component=route,
                severity="high",
                description=f"Unhandled crash in {route}: {exc}",
                health_delta=-8,
            )
            STATE["health"] = max(0, STATE["health"] - 8)
            self._send(500, {"error": "crash", "reason": str(exc)})

    def _index(self) -> dict:
        return {
            "name": "The Tower",
            "runtime": "wasmer-wasix",
            "health": STATE["health"],
            "docs": "/docs",
            "message": "A citadel API sandboxed by Wasmer. Authorized training target only.",
        }

    def _health(self) -> dict:
        return {
            "ok": STATE["health"] > 0,
            "health": STATE["health"],
            "uptime_s": int(time.time() - STATE["boot_ts"]),
            "requests": STATE["request_count"],
        }

    def _status(self) -> dict:
        return {
            "health": STATE["health"],
            "treasury": STATE["treasury"],
            "citizens": len(USERS),
            "weaknesses_seen": sorted(STATE["seen_weaknesses"]),
            "runtime": "wasmer",
        }

    def _login(self) -> None:
        body = self._read_json()
        username = str(body.get("username", ""))
        password = str(body.get("password", ""))
        injected = any(marker in username for marker in ("'", "--", " or ", " OR "))
        user = USERS.get(username)
        ok = bool(user and user["password"] == password)
        if injected or (username == "admin" and password in ("admin", "password", "")):
            apply_weakness(
                "auth.login",
                "/login",
                extra="injection" if injected else "default-creds",
            )
            token = token_for("admin", "admin")
            return self._send(
                200,
                {
                    "ok": True,
                    "username": "admin",
                    "role": "admin",
                    "token": token,
                    "note": "welcome back, overseer",
                },
            )
        if not ok:
            return self._send(401, {"ok": False, "error": "invalid_credentials"})
        self._send(
            200,
            {
                "ok": True,
                "username": username,
                "role": user["role"],
                "token": token_for(username, user["role"]),
            },
        )

    def _whoami(self) -> None:
        auth = self._auth()
        if not auth:
            return self._send(401, {"error": "missing_token"})
        self._send(200, auth)

    def _search(self) -> None:
        q = (self._query().get("q") or [""])[0]
        sql = f"SELECT * FROM citizens WHERE name LIKE '%{q}%'"
        injected = any(m in q.lower() for m in ("'", "--", " or ", "1=1", "union"))
        if injected:
            apply_weakness("injection.search", "/search", extra=q[:80])
            return self._send(
                200,
                {
                    "query": sql,
                    "rows": [
                        {"username": name, "role": user["role"], "gold": user["gold"]}
                        for name, user in USERS.items()
                    ],
                    "leaked": True,
                },
            )
        rows = [
            {"username": name, "role": user["role"]}
            for name, user in USERS.items()
            if q.lower() in name.lower()
        ]
        self._send(200, {"query": sql, "rows": rows})

    def _users(self) -> None:
        self._send(
            200,
            {"users": [{"id": u["id"], "username": name} for name, u in USERS.items()]},
        )

    def _user_by_id(self, raw_id: str) -> None:
        try:
            user_id = int(raw_id)
        except ValueError:
            return self._send(400, {"error": "bad_id"})
        auth = self._auth()
        match = next(((n, u) for n, u in USERS.items() if u["id"] == user_id), None)
        if match is None:
            return self._send(404, {"error": "unknown_citizen"})
        name, user = match
        if not auth or (auth.get("username") != name and auth.get("role") != "admin"):
            apply_weakness("logic.idor", f"/users/{user_id}", extra=name)
        self._send(
            200,
            {
                "id": user["id"],
                "username": name,
                "role": user["role"],
                "gold": user["gold"],
                "password": user["password"],
            },
        )

    def _treasury(self) -> None:
        q = self._query()
        role = (q.get("role") or [""])[0]
        auth = self._auth()
        if role == "admin" or (auth and auth.get("role") == "admin"):
            if role == "admin" and not (auth and auth.get("role") == "admin"):
                apply_weakness("auth.bypass", "/admin/treasury", extra="role=admin")
            return self._send(
                200,
                {
                    "treasury": STATE["treasury"],
                    "vault": load_json(WORKSPACE / "secrets.json", {}),
                },
            )
        self._send(403, {"error": "overseer_only"})

    def _debug(self) -> None:
        apply_weakness("recon.debug", "/admin/debug")
        self._send(
            200,
            {
                "cwd": os.getcwd(),
                "workspace": str(WORKSPACE),
                "env": {
                    key: os.environ.get(key, "")
                    for key in ("HOST", "PORT", "TOWER_NAME")
                },
                "files": [p.name for p in WORKSPACE.iterdir()] if WORKSPACE.exists() else [],
                "health": STATE["health"],
            },
        )

    def _files(self) -> None:
        requested = (self._query().get("path") or ["flag.txt"])[0]
        path = Path(requested) if requested.startswith("/") else WORKSPACE / requested
        try:
            data = path.read_text()
        except Exception as exc:
            return self._send(404, {"error": "not_found", "reason": str(exc)})
        lowered = requested.lower() + data.lower()
        if "flag" in lowered or "sk_live" in lowered or "admin_password" in lowered:
            apply_weakness("recon.files", "/files", extra=requested)
        self._send(200, {"path": str(path), "contents": data})

    def _withdraw(self) -> None:
        body = self._read_json()
        try:
            amount = int(body.get("amount", 0))
        except (TypeError, ValueError):
            return self._send(400, {"error": "bad_amount"})
        auth = self._auth() or {"username": "alice", "role": "citizen"}
        username = auth["username"] if auth["username"] in USERS else "alice"
        if amount <= 0:
            apply_weakness("logic.withdraw", "/withdraw", extra=str(amount))
            USERS[username]["gold"] -= amount
            STATE["treasury"] += amount
            return self._send(
                200,
                {
                    "ok": True,
                    "username": username,
                    "gold": USERS[username]["gold"],
                    "treasury": STATE["treasury"],
                },
            )
        if amount > USERS[username]["gold"]:
            return self._send(400, {"error": "insufficient_gold"})
        USERS[username]["gold"] -= amount
        STATE["treasury"] += amount
        self._send(200, {"ok": True, "gold": USERS[username]["gold"]})

    def _transfer(self) -> None:
        body = self._read_json()
        source = str(body.get("from", "alice"))
        dest = str(body.get("to", "bob"))
        try:
            amount = int(body.get("amount", 0))
        except (TypeError, ValueError):
            return self._send(400, {"error": "bad_amount"})
        if source not in USERS or dest not in USERS:
            return self._send(404, {"error": "unknown_citizen"})
        apply_weakness("logic.transfer", "/transfer", extra=f"{source}->{dest}")
        USERS[source]["gold"] -= amount
        USERS[dest]["gold"] += amount
        self._send(
            200,
            {
                "ok": True,
                "from": source,
                "to": dest,
                "amount": amount,
                "balances": {source: USERS[source]["gold"], dest: USERS[dest]["gold"]},
            },
        )

    def _export(self) -> None:
        body = self._read_json()
        job = str(body.get("job", "daily-report"))
        injected = any(m in job for m in (";", "|", "&&", "`", "$("))
        result = {"job": job, "status": "queued"}
        if injected:
            flag = (WORKSPACE / "flag.txt").read_text().strip()
            apply_weakness("injection.export", "/export", extra=job[:80])
            result = {
                "job": job,
                "status": "executed",
                "stdout": flag,
                "note": "shell metacharacters were honored",
            }
        self._send(200, result)

    def _compute(self) -> None:
        raw = (self._query().get("n") or ["1000"])[0]
        try:
            n = int(raw)
        except ValueError:
            n = 1000
        n = max(0, min(n, 2_000_000))
        started = time.time()
        acc = 0
        digest = hashlib.sha256()
        for i in range(n):
            acc += i
            if i % 4096 == 0:
                digest.update(str(acc).encode("ascii"))
        elapsed = time.time() - started
        if n >= 200_000 or elapsed >= 0.25:
            apply_weakness("dos.compute", "/compute", extra=f"n={n} {elapsed:.2f}s")
        self._send(
            200,
            {
                "n": n,
                "elapsed_s": round(elapsed, 4),
                "digest": digest.hexdigest()[:16],
                "health": STATE["health"],
            },
        )

    def _internal_config(self) -> None:
        apply_weakness("recon.debug", "/internal/config")
        self._send(200, load_json(WORKSPACE / "secrets.json", {}))


ATTACK_SURFACE = {
    "name": "The Tower",
    "authorized": True,
    "runtime": "Wasmer WASIX sandbox (python/python)",
    "base": f"http://{HOST}:{PORT}",
    "notes": [
        "This is a team-owned training target. Do not point agents at anything else.",
        "Tokens are base64(username:role) and can be forged.",
        "Successful exploits emit weakness_found events via the Wasmer host.",
    ],
    "endpoints": [
        {"method": "GET", "path": "/", "persona": "recon", "desc": "Banner + health"},
        {"method": "GET", "path": "/health", "persona": "recon", "desc": "Liveness + health number"},
        {"method": "GET", "path": "/docs", "persona": "recon", "desc": "This document"},
        {"method": "GET", "path": "/status", "persona": "recon", "desc": "Treasury + seen weaknesses"},
        {
            "method": "POST",
            "path": "/login",
            "persona": "auth_bypass",
            "desc": "JSON {username,password}. Try admin/admin or admin'--",
        },
        {
            "method": "GET",
            "path": "/whoami",
            "persona": "auth_bypass",
            "desc": "Authorization: Bearer <token>. Forge base64(admin:admin)",
        },
        {
            "method": "GET",
            "path": "/search?q=",
            "persona": "injection",
            "desc": "String-concat search. Try q=' OR 1=1 --",
        },
        {
            "method": "GET",
            "path": "/users/<id>",
            "persona": "logic_abuse",
            "desc": "IDOR — any citizen id returns password + gold",
        },
        {
            "method": "GET",
            "path": "/admin/treasury?role=admin",
            "persona": "auth_bypass",
            "desc": "Role query parameter bypasses auth",
        },
        {
            "method": "GET",
            "path": "/admin/debug",
            "persona": "recon",
            "desc": "Leaks workspace files and env",
        },
        {
            "method": "GET",
            "path": "/files?path=",
            "persona": "recon",
            "desc": "Path traversal. Try path=/workspace/flag.txt",
        },
        {
            "method": "POST",
            "path": "/withdraw",
            "persona": "logic_abuse",
            "desc": "JSON {amount}. Negative amounts print gold",
        },
        {
            "method": "POST",
            "path": "/transfer",
            "persona": "logic_abuse",
            "desc": "JSON {from,to,amount}. No ownership check",
        },
        {
            "method": "POST",
            "path": "/export",
            "persona": "injection",
            "desc": "JSON {job}. Shell metacharacters dump the flag",
        },
        {
            "method": "GET",
            "path": "/compute?n=",
            "persona": "dos",
            "desc": "No rate limit. Large n stalls the guest event loop",
        },
        {
            "method": "GET",
            "path": "/internal/config",
            "persona": "recon",
            "desc": "Accidentally public secrets.json",
        },
    ],
}


def main() -> None:
    server = HTTPServer((HOST, PORT), TowerHandler)
    emit(
        "target_health",
        target_component="tower",
        severity="info",
        description="Tower sandbox booted inside Wasmer",
        health_delta=0,
    )
    print(f"TOWER listening on http://{HOST}:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        emit(
            "target_health",
            target_component="tower",
            severity="info",
            description="Tower process stopping",
            health_delta=0,
        )
        server.server_close()


if __name__ == "__main__":
    main()
