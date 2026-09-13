#!/usr/bin/env python3
"""Boot a Wasmer sandbox, prove Python runs, then boot The Tower and hit one exploit."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src import config  # noqa: E402
from src.runtime import TowerRuntime  # noqa: E402


async def trivial_python() -> None:
    from wasmer_sdk import Wasmer

    print("[smoke] creating trivial Python sandbox...", flush=True)
    async with Wasmer(cache_root=config.CACHE_ROOT) as wasmer:
        sandbox = await wasmer.sandboxes.create(
            packages=[config.PYTHON_PACKAGE],
            files={"hello.py": b"print('wasmer-ok', flush=True)\n"},
        )
        async with sandbox:
            output = await sandbox.command("python", ["/workspace/hello.py"]).run()
            text = output.text().strip()
            print(f"[smoke] trivial output: {text}", flush=True)
            if "wasmer-ok" not in text:
                raise SystemExit(f"unexpected output: {text!r}")
    print("[smoke] trivial Python sandbox OK", flush=True)


async def tower_roundtrip() -> None:
    import urllib.request

    runtime = TowerRuntime()
    runner = asyncio.create_task(runtime.run_forever(), name="runtime")
    try:
        for _ in range(1200):
            if runtime.running:
                break
            if runtime.last_error:
                raise RuntimeError(runtime.last_error)
            await asyncio.sleep(0.1)
        else:
            raise TimeoutError("tower did not boot")

        url = runtime.target_url + "/search?q=%27%20OR%201%3D1%20--"
        print(f"[smoke] hitting {url}", flush=True)
        with urllib.request.urlopen(url, timeout=15) as response:
            body = json.loads(response.read().decode("utf-8"))
        print(f"[smoke] search leaked={body.get('leaked')} rows={len(body.get('rows') or [])}")
        if not body.get("leaked"):
            raise SystemExit("injection did not trigger")

        for _ in range(50):
            if any(e.get("event_type") == "weakness_found" for e in runtime.events):
                break
            await asyncio.sleep(0.1)
        else:
            raise SystemExit("no weakness_found event observed")

        print("[smoke] weakness_found observed; requesting reset", flush=True)
        runtime.request_reset("smoke")
        await asyncio.sleep(2)
        print("[smoke] OK", flush=True)
    finally:
        await runtime.stop()
        await asyncio.gather(runner, return_exceptions=True)


async def main() -> None:
    await trivial_python()
    await tower_roundtrip()


if __name__ == "__main__":
    asyncio.run(main())
