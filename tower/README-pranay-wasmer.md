# Pranay — Wasmer: The Target ("The Tower")

**Owns:** the app being attacked, running inside a Wasmer SDK sandbox, plus the instrumentation that turns "something bad just happened" into an event the rest of the system can use.

Read `README-master.md` first for the full architecture and the event schema — this doc is the live interface for Shresth and Kenil.

Status as of this build: **the target boots inside Wasmer, is attackable over HTTP, emits the agreed events, and respawns a clean sandbox on reset.** First sandbox create after cache warm was ~10ms.

---

## What is running

```
python3 run.py
        │
        ▼
 Wasmer SDK (native Python host)
        │  packages=["python/python@=3.13.18"]
        │  network="host"
        ▼
 WASIX sandbox  ──►  /workspace/server.py   ◄── agents attack this
        │              http://127.0.0.1:8080
        │ TOWER_EVENT json lines on stdout
        ▼
 Host control plane              Coordinator (Shresth)
 http://127.0.0.1:9100    POST ►  COORDINATOR_URL
   GET  /status                    (default http://127.0.0.1:4000/events)
   GET  /events
   GET  /attack-surface
   POST /reset   ── respawn a fresh sandbox
```

The guest is **stdlib Python only** (no pip, no threads, no subprocess) so it stays WASIX-safe. Vulnerabilities are real logic bugs in that guest, but contained: no real credentials, no real shell, no outbound reach beyond the sandbox.

---

## Run it

```bash
python3 -m pip install -r requirements.txt
python3 run.py
```

First boot downloads the `python/python` Wasmer package into `.wasmer/` (keep that directory out of git). Later boots reuse the cache.

Then in another terminal:

```bash
python3 scripts/probe.py          # hit every weakness class
curl -s http://127.0.0.1:9100/status
curl -s -X POST http://127.0.0.1:9100/reset
```

| Piece | Default | Env var |
|---|---|---|
| Attack surface (agents → tower) | `http://127.0.0.1:8080` | `TARGET_HOST`, `TARGET_PORT` |
| Control plane (reset / events) | `http://127.0.0.1:9100` | `CONTROL_HOST`, `CONTROL_PORT` |
| Coordinator ingest | `http://127.0.0.1:4000/events` | `COORDINATOR_URL` |
| Heartbeat interval | `2s` | `HEARTBEAT_SECONDS` |

If the coordinator is down, the host keeps serving events at `GET http://127.0.0.1:9100/events` and retries POSTs after it comes up (it warns once, then stays quiet).

---

## Attack surface for Shresth's agents

Base URL: **`http://<reachable-host>:8080`**

`GET /docs` on the target returns this list live. Tokens are `base64(username:role)` and can be forged.

| Persona | How to hit it | What success looks like |
|---|---|---|
| **recon** | `GET /` `GET /docs` `GET /admin/debug` `GET /files?path=/workspace/flag.txt` | Flag `FLAG{the-tower-has-fallen}`, workspace file list |
| **injection** | `GET /search?q=' OR 1=1 --` | `leaked: true` and every citizen row |
| **injection** | `POST /export` `{"job":"report; cat /workspace/flag.txt"}` | `stdout` contains the flag |
| **auth_bypass** | `POST /login` `{"username":"admin","password":"admin"}` or `admin'--` | Admin bearer token |
| **auth_bypass** | `GET /admin/treasury?role=admin` (no auth header) | Treasury + fake vault secrets |
| **auth_bypass** | `Authorization: Bearer YWRtaW46YWRtaW4=` (`admin:admin`) | Forged token accepted |
| **logic_abuse** | `GET /users/1` | Alice's password `wonderland` |
| **logic_abuse** | `POST /withdraw` `{"amount":-500}` | Gold increases |
| **logic_abuse** | `POST /transfer` `{"from":"admin","to":"alice","amount":50}` | No ownership check |
| **dos** | `GET /compute?n=2000000` | Guest event loop stalls; `weakness_found` fires |

The tower starts at **health 100**. Each *first* successful weakness class deducts a chunk; repeats of the same class only deduct 1 so the demo doesn't instantly hit 0 from retries. Health is also on the `X-Tower-Health` response header.

Demo-reliable sequence (use this in the video):

1. `GET /search?q=' OR 1=1 --` → injection, health 85
2. `GET /admin/treasury?role=admin` → auth bypass, critical
3. `GET /files?path=/workspace/flag.txt` → flag leak, critical
4. `GET /compute?n=2000000` → DoS stall
5. `POST http://127.0.0.1:9100/reset` → clean tower in ~10ms

---

## Events this piece emits

Posted as JSON to `COORDINATOR_URL`. Same shape as `README-master.md`.

Heartbeat, even with no attacks (every ~2s):

```json
{
  "event_type": "target_health",
  "agent_id": "wasmer-host",
  "agent_persona": "tower",
  "target_component": "tower",
  "severity": "info",
  "description": "Tower heartbeat health=100 gen=1",
  "health_delta": 0,
  "timestamp": "2026-09-13T21:23:49.439586+00:00",
  "health": 100,
  "sandbox": "wasmer",
  "generation": 1
}
```

When instrumentation itself detects a successful exploit (not just an agent's claim):

```json
{
  "event_type": "weakness_found",
  "agent_id": "target-instrumentation",
  "agent_persona": "injection",
  "target_component": "/search",
  "severity": "high",
  "description": "SQL-style injection dumped citadel records (' OR 1=1 --)",
  "health_delta": -15,
  "timestamp": "...",
  "health": 85,
  "sandbox": "wasmer",
  "generation": 1,
  "weakness_id": "injection.search",
  "first_seen": true
}
```

Extra fields beyond the shared schema: `health`, `sandbox`, `generation`, `weakness_id`, `first_seen`. Safe to ignore; useful for the banner/graph.

`attack_started` / `attack_result` are **Shresth's to emit** when an agent fires. This host does not emit those, so Kenil's jets don't twitch on health checks.

Crashes / unexpected guest exits become `weakness_found` + `target_health` from the host, and the sandbox respawns.

---

## Reset / respawn

`POST http://127.0.0.1:9100/reset` kills the guest, closes the Wasmer sandbox, and creates a new one (the fast-create path judges care about). Health returns to 100. Each generation writes `logs/reset-genN.json` with the health, reason, and weakness events from that life — so a reset does not silently hide a real find.

---

## Layout

```
src/host.py          # process entry
src/runtime.py       # Wasmer create / spawn / teardown / heartbeat
src/control.py       # host-side control plane (works even if the guest is DoS'd)
src/events.py        # schema + coordinator POST
target/server.py     # the vulnerable citadel (runs *inside* the sandbox)
target/flag.txt
target/secrets.json
scripts/probe.py     # demo / agent fixture against a running tower
scripts/smoke.py     # boot a sandbox + one exploit + reset
```
