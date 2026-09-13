from __future__ import annotations

import asyncio
import json
import threading
from collections import deque
from datetime import datetime, timezone
from typing import Any

from wasmer_sdk import Wasmer

from . import config
from .events import normalize_event, post_event, utcnow


class TowerRuntime:
    def __init__(self) -> None:
        self.wasmer: Wasmer | None = None
        self.sandbox = None
        self.process = None
        self.generation = 0
        self.health = 100
        self.running = False
        self.target_url = f"http://{config.TARGET_HOST}:{config.TARGET_PORT}"
        self.events: deque[dict[str, Any]] = deque(maxlen=200)
        self.reset_journal: list[dict[str, Any]] = []
        self._reset_requested = asyncio.Event()
        self._stop = asyncio.Event()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._stdout_task: asyncio.Task | None = None
        self._stderr_task: asyncio.Task | None = None
        self._wait_task: asyncio.Task | None = None
        self._coordinator_warned = False
        self.last_error: str | None = None
        self.boot_started_at: str | None = None
        self.boot_ready_at: str | None = None

    def snapshot(self) -> dict[str, Any]:
        return {
            "name": "The Tower",
            "runtime": "wasmer",
            "package": config.PYTHON_PACKAGE,
            "running": self.running,
            "generation": self.generation,
            "health": self.health,
            "target_url": self.target_url,
            "control_url": f"http://{config.CONTROL_HOST}:{config.CONTROL_PORT}",
            "coordinator_url": config.COORDINATOR_URL,
            "last_error": self.last_error,
            "boot_started_at": self.boot_started_at,
            "boot_ready_at": self.boot_ready_at,
            "resets": len(self.reset_journal),
            "recent_weaknesses": [
                event
                for event in list(self.events)[-12:]
                if event.get("event_type") == "weakness_found"
            ],
        }

    def recent_events(self, limit: int = 100) -> list[dict[str, Any]]:
        return list(self.events)[-limit:]

    def request_reset(self, reason: str) -> dict[str, Any]:
        if self._loop is None:
            return {"ok": False, "error": "runtime_not_started"}
        self._loop.call_soon_threadsafe(self._reset_requested.set)
        return {
            "ok": True,
            "queued": True,
            "reason": reason,
            "generation": self.generation,
        }

    async def run_forever(self) -> None:
        self._loop = asyncio.get_running_loop()
        config.LOG_DIR.mkdir(parents=True, exist_ok=True)
        self.wasmer = Wasmer(cache_root=config.CACHE_ROOT)
        print(f"[tower] Wasmer client ready (cache={config.CACHE_ROOT})", flush=True)
        try:
            while not self._stop.is_set():
                self._reset_requested.clear()
                try:
                    await self._boot()
                except Exception as exc:  # noqa: BLE001
                    self.last_error = str(exc)
                    self.running = False
                    print(f"[tower] boot failed: {exc}", flush=True)
                    await self._teardown(reason=f"boot-failed: {exc}")
                    self._emit_host_event(
                        "weakness_found",
                        severity="critical",
                        description=f"Wasmer sandbox failed to boot: {exc}",
                        health_delta=-20,
                        target_component="sandbox",
                    )
                    try:
                        await asyncio.wait_for(self._reset_requested.wait(), timeout=5)
                    except asyncio.TimeoutError:
                        continue
                    continue

                waiters = [
                    asyncio.create_task(self._reset_requested.wait(), name="reset"),
                    asyncio.create_task(self._stop.wait(), name="stop"),
                ]
                if self._wait_task is not None:
                    waiters.append(self._wait_task)
                done, pending = await asyncio.wait(
                    waiters, return_when=asyncio.FIRST_COMPLETED
                )
                for task in pending:
                    if task is not self._wait_task:
                        task.cancel()
                crashed = self._wait_task is not None and self._wait_task in done
                if self._stop.is_set():
                    await self._teardown(reason="shutdown")
                    break
                reason = "guest-exit" if crashed else "reset"
                await self._teardown(reason=reason)
        finally:
            if self.wasmer is not None:
                await self.wasmer.close()
                self.wasmer = None

    async def stop(self) -> None:
        self._stop.set()
        self._reset_requested.set()

    async def _boot(self) -> None:
        assert self.wasmer is not None
        self.generation += 1
        self.health = 100
        self.last_error = None
        self.boot_started_at = utcnow()
        self.boot_ready_at = None
        files = {
            "server.py": (config.TARGET_DIR / "server.py").read_bytes(),
            "flag.txt": (config.TARGET_DIR / "flag.txt").read_bytes(),
            "secrets.json": (config.TARGET_DIR / "secrets.json").read_bytes(),
        }
        print(
            f"[tower] creating Wasmer sandbox generation={self.generation} "
            f"package={config.PYTHON_PACKAGE}",
            flush=True,
        )
        created = datetime.now(timezone.utc)
        self.sandbox = await self.wasmer.sandboxes.create(
            packages=[config.PYTHON_PACKAGE],
            files=files,
            env={
                "HOST": config.TARGET_HOST,
                "PORT": str(config.TARGET_PORT),
                "TOWER_NAME": "citadel",
            },
            network="host",
        )
        elapsed_ms = (datetime.now(timezone.utc) - created).total_seconds() * 1000
        print(f"[tower] sandbox created in {elapsed_ms:.1f}ms", flush=True)

        self.process = await self.sandbox.command(
            "python",
            ["-u", "/workspace/server.py"],
        ).spawn(stdout="pipe", stderr="pipe")
        assert self.process.stdout is not None
        assert self.process.stderr is not None

        self._stdout_task = asyncio.create_task(
            self._pump_stdout(self.process.stdout.lines()), name="stdout"
        )
        self._stderr_task = asyncio.create_task(
            self._pump_stderr(self.process.stderr.lines()), name="stderr"
        )
        self._wait_task = asyncio.create_task(self.process.wait(), name="wait")
        await self._wait_for_listen(30)
        self.running = True
        self.boot_ready_at = utcnow()
        self._emit_host_event(
            "target_health",
            severity="info",
            description=f"Tower generation {self.generation} listening on {self.target_url}",
            health_delta=0,
            target_component="tower",
        )
        print(f"[tower] guest listening at {self.target_url}", flush=True)

    async def _wait_for_listen(self, timeout: float) -> None:
        deadline = datetime.now(timezone.utc).timestamp() + timeout
        connect_host = "127.0.0.1" if config.TARGET_HOST in {"0.0.0.0", "::"} else config.TARGET_HOST
        while datetime.now(timezone.utc).timestamp() < deadline:
            if self._wait_task and self._wait_task.done():
                result = self._wait_task.result()
                raise RuntimeError(f"guest exited before listen: {result}")
            if self.boot_ready_at:
                return
            try:
                _reader, writer = await asyncio.wait_for(
                    asyncio.open_connection(connect_host, config.TARGET_PORT),
                    timeout=0.4,
                )
                writer.close()
                await writer.wait_closed()
                return
            except (OSError, asyncio.TimeoutError):
                await asyncio.sleep(0.15)
        raise TimeoutError(
            f"Wasmer guest did not accept TCP on {connect_host}:{config.TARGET_PORT} within {timeout}s"
        )

    async def _pump_stdout(self, lines) -> None:
        async for line in lines:
            text = line.rstrip("\n")
            print(f"[guest] {text}", flush=True)
            if "TOWER listening on" in text:
                self.running = True
                self.boot_ready_at = utcnow()
            if text.startswith("TOWER_EVENT "):
                try:
                    payload = json.loads(text[len("TOWER_EVENT ") :])
                except json.JSONDecodeError:
                    continue
                event = normalize_event(payload, self.generation)
                if isinstance(event.get("health"), int):
                    self.health = event["health"]
                self._publish(event)

    async def _pump_stderr(self, lines) -> None:
        async for line in lines:
            print(f"[guest:err] {line.rstrip()}", flush=True)

    async def _teardown(self, reason: str) -> None:
        snapshot = {
            "reason": reason,
            "generation": self.generation,
            "health": self.health,
            "timestamp": utcnow(),
            "events": self.recent_events(50),
            "weaknesses": [
                event
                for event in self.events
                if event.get("event_type") == "weakness_found"
                and event.get("generation") == self.generation
            ],
        }
        self.reset_journal.append(
            {key: snapshot[key] for key in ("reason", "generation", "health", "timestamp")}
        )
        log_path = config.LOG_DIR / f"reset-gen{self.generation}.json"
        log_path.write_text(json.dumps(snapshot, indent=2))
        print(f"[tower] teardown generation={self.generation} reason={reason}", flush=True)
        print(f"[tower] reset journal -> {log_path}", flush=True)

        self.running = False
        self._emit_host_event(
            "target_health",
            severity="info" if reason != "guest-exit" else "high",
            description=f"Tower generation {self.generation} stopping ({reason})",
            health_delta=0 if reason != "guest-exit" else -self.health,
            target_component="sandbox",
        )
        if reason == "guest-exit" and self.health > 0:
            self.health = 0

        for task in (self._stdout_task, self._stderr_task):
            if task:
                task.cancel()
        if self.process is not None:
            try:
                await self.process.terminate(grace_period=2)
            except Exception as exc:  # noqa: BLE001
                print(f"[tower] terminate: {exc}", flush=True)
            try:
                await self.process.wait()
            except Exception:
                pass
            self.process = None
        if self.sandbox is not None:
            try:
                close = getattr(self.sandbox, "close", None)
                if close is not None:
                    await close()
                else:
                    await self.sandbox.__aexit__(None, None, None)
            except Exception as exc:  # noqa: BLE001
                print(f"[tower] sandbox close: {exc}", flush=True)
            self.sandbox = None
        self._stdout_task = None
        self._stderr_task = None
        self._wait_task = None

    def _emit_host_event(self, event_type: str, **kwargs) -> None:
        event = normalize_event(
            {
                "event_type": event_type,
                "agent_id": "wasmer-host",
                "agent_persona": kwargs.get("agent_persona", "tower"),
                "health": self.health,
                **kwargs,
            },
            self.generation,
        )
        self._publish(event)

    def _publish(self, event: dict[str, Any]) -> None:
        self.events.append(event)
        if self._loop is None or self._loop.is_closed():
            return
        self._loop.create_task(self._forward(event), name="forward-event")

    async def _forward(self, event: dict[str, Any]) -> None:
        ok, detail = await asyncio.to_thread(post_event, config.COORDINATOR_URL, event)
        if ok:
            return
        if not self._coordinator_warned:
            print(
                f"[tower] coordinator unreachable at {config.COORDINATOR_URL} ({detail}). "
                "Events stay on the control plane at /events until Shresth's endpoint is up.",
                flush=True,
            )
            self._coordinator_warned = True


async def heartbeat_loop(runtime: TowerRuntime) -> None:
    while not runtime._stop.is_set():
        await asyncio.sleep(config.HEARTBEAT_SECONDS)
        if not runtime.running:
            continue
        runtime._emit_host_event(
            "target_health",
            severity="info",
            description=f"Tower heartbeat health={runtime.health} gen={runtime.generation}",
            health_delta=0,
            target_component="tower",
        )


def spawn_control_thread(runtime: TowerRuntime) -> tuple[threading.Thread, Any]:
    from .control import start_control

    server = start_control(runtime, config.CONTROL_HOST, config.CONTROL_PORT)

    def _serve() -> None:
        print(
            f"[tower] control plane on http://{config.CONTROL_HOST}:{config.CONTROL_PORT}",
            flush=True,
        )
        server.serve_forever()

    thread = threading.Thread(target=_serve, name="tower-control", daemon=True)
    thread.start()
    return thread, server
