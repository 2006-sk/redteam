from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_event(raw: dict[str, Any], generation: int) -> dict[str, Any]:
    event = {
        "event_type": raw.get("event_type", "target_health"),
        "agent_id": raw.get("agent_id", "target"),
        "agent_persona": raw.get("agent_persona", "tower"),
        "target_component": raw.get("target_component", "tower"),
        "severity": raw.get("severity", "info"),
        "description": raw.get("description", ""),
        "health_delta": int(raw.get("health_delta") or 0),
        "timestamp": raw.get("timestamp") or utcnow(),
        "health": raw.get("health"),
        "sandbox": "wasmer",
        "generation": generation,
    }
    for key, value in raw.items():
        event.setdefault(key, value)
    return event


def post_event(url: str, event: dict[str, Any], timeout: float = 2.0) -> tuple[bool, str]:
    payload = json.dumps(event).encode("utf-8")
    request = Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            response.read()
            return True, f"HTTP {response.status}"
    except URLError as exc:
        return False, str(exc.reason if getattr(exc, "reason", None) else exc)
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)
