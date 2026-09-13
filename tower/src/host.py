#!/usr/bin/env python3
"""Boot The Tower inside a Wasmer sandbox and expose the control plane."""

from __future__ import annotations

import asyncio
import signal

from src import config
from src.runtime import TowerRuntime, heartbeat_loop, spawn_control_thread


async def main() -> None:
    runtime = TowerRuntime()
    _, server = spawn_control_thread(runtime)
    loop = asyncio.get_running_loop()
    stopping = asyncio.Event()

    def _stop(*_args) -> None:
        stopping.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _stop)
        except NotImplementedError:
            signal.signal(sig, lambda *_: _stop())

    runner = asyncio.create_task(runtime.run_forever(), name="runtime")
    heart = asyncio.create_task(heartbeat_loop(runtime), name="heartbeat")
    print(
        f"[tower] attack surface -> {runtime.target_url}\n"
        f"[tower] control plane  -> http://{config.CONTROL_HOST}:{config.CONTROL_PORT}\n"
        f"[tower] coordinator    -> {config.COORDINATOR_URL}\n"
        "[tower] POST /reset on the control plane to respawn a clean sandbox.",
        flush=True,
    )
    await stopping.wait()
    await runtime.stop()
    heart.cancel()
    await asyncio.gather(runner, heart, return_exceptions=True)
    server.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
