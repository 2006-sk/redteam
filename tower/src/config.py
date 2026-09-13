from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PYTHON_PACKAGE = os.environ.get("WASMER_PYTHON_PACKAGE", "python/python@=3.13.18")
TARGET_HOST = os.environ.get("TARGET_HOST", "127.0.0.1")
TARGET_PORT = int(os.environ.get("TARGET_PORT", "8080"))
CONTROL_HOST = os.environ.get("CONTROL_HOST", "127.0.0.1")
CONTROL_PORT = int(os.environ.get("CONTROL_PORT", "9100"))
COORDINATOR_URL = os.environ.get("COORDINATOR_URL", "http://127.0.0.1:4000/events")
HEARTBEAT_SECONDS = float(os.environ.get("HEARTBEAT_SECONDS", "2"))
CACHE_ROOT = os.environ.get("WASMER_CACHE", str(ROOT / ".wasmer"))
LOG_DIR = Path(os.environ.get("TOWER_LOG_DIR", ROOT / "logs"))
TARGET_DIR = ROOT / "target"
