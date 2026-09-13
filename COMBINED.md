# Tower Siege — Combined (Wasmer target + Agent swarm)

This branch integrates **Pranay's Wasmer harness** and **Shresth's agent swarm**
into one working end-to-end system, running **our TowerBank app inside a Wasmer
sandbox** and attacking it with the autonomous swarm.

```
   ┌────────────────────────────────────────────┐
   │  tower/  (Pranay's Wasmer harness)          │
   │   run.py → boots a Wasmer WASIX sandbox     │
   │   └─ runs target/server.py  (OUR TowerBank) │  ← the target, INSIDE Wasmer
   │      · attack surface  http://127.0.0.1:8080│
   │      · self-instruments: prints TOWER_EVENT │
   │        lines → host forwards to Coordinator │
   └───────────────┬────────────────────────────┘
                   │ attacks over HTTP          ▲ target_health / weakness_found
                   │                            │
   ┌───────────────┴────────────────────────────┴───┐
   │  src/  (Shresth's swarm)                        │
   │   5 LLM-driven agents → attack :8080            │
   │   Coordinator (:4000) ingests BOTH the agents'  │
   │   events AND the target's self-reported breaches│
   │   → WebSocket broadcast to Kenil's frontend     │
   └─────────────────────────────────────────────────┘
```

**What "combine" means here:** Pranay's harness is the reusable Wasmer
configuration; we dropped **our TowerBank** in as the target
(`tower/target/server.py`, a WASIX-safe Python port of `src/towerbank.mjs`),
and pointed the swarm + Coordinator at it. The target self-instruments (emits
`TOWER_EVENT` on each exploit), so the sandboxed Tower *itself* reports the
breach — and the agents confirm it independently.

## Run the full end-to-end (one command)
```bash
# one-time setup
npm install
python3 -m venv tower/.venv && tower/.venv/bin/pip install -r tower/requirements.txt
cp .env.example .env   # add TENKI_API_KEY + NEBIUS_API_KEY

# the whole chain: Coordinator → boot TowerBank in Wasmer → swarm attacks it
npm run e2e:wasmer                 # LLM brains if NEBIUS_API_KEY set
LLM_BRAIN=off npm run e2e:wasmer   # deterministic (fast, no LLM)
```
`test/e2e-wasmer.mjs` starts the Coordinator (:4000), boots TowerBank inside a
Wasmer sandbox via `tower/run.py` (:8080), waits for it to listen, runs the
5-agent swarm against it, prints which weaknesses the **target** vs the
**agents** reported, then tears the sandbox down.

## Or run the pieces in separate terminals (for the live demo)
```bash
# T1 — Coordinator (frontend connects to ws://localhost:4000)
PORT=4000 node src/run-swarm.mjs        # (or a standalone coordinator)

# T2 — boot TowerBank inside Wasmer, forwarding events to the Coordinator
cd tower && COORDINATOR_URL=http://127.0.0.1:4000/events TARGET_PORT=8080 .venv/bin/python run.py
#   → attack surface http://127.0.0.1:8080  (open it in a browser — it's the bank UI)
#   → control plane  http://127.0.0.1:9100  (POST /reset to respawn a clean sandbox)

# T3 — the swarm
TARGET_BASE_URL=http://127.0.0.1:8080 COORDINATOR_URL=http://localhost:4000 \
  node --env-file=.env src/run-swarm.mjs
```

## Verified end-to-end (2026-09-13)
- TowerBank boots inside Wasmer in ~0.5s (warm) and is reachable from the host.
- Deterministic run: recon maps 7 endpoints; the **target self-reports 11
  distinct breaches**; the **agents confirm 16**; tower_health 100 → 0.
- The target's own instrumentation and the agents both flow into one Coordinator.

## Port / wiring reference
| piece | address | env |
|---|---|---|
| TowerBank target (in Wasmer) | `http://127.0.0.1:8080` | `TARGET_PORT=8080` |
| Tower control plane | `http://127.0.0.1:9100` | `CONTROL_PORT=9100` |
| Coordinator (ours) | `http://localhost:4000`, `ws://localhost:4000` | `PORT=4000` |
| Tower → Coordinator | posts to `:4000/events` | `COORDINATOR_URL=http://127.0.0.1:4000/events` |
| Swarm → target | attacks `TARGET_BASE_URL` | `TARGET_BASE_URL=http://127.0.0.1:8080` |

See `README.md` (swarm) and `README-pranay-wasmer.md` / `README-master.md` (harness).
