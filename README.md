# Tower Siege — Agents + Tenki + Coordinator (Shresth's layer)

Five **autonomous, LLM-driven** red-team agents, **one Tenki Sandbox VM each**,
sharing an attack memory so they build on each other's findings, all wired
through a **Coordinator** that broadcasts every event over WebSocket to Kenil's
frontend.

```
5 personas (recon, injection, auth_bypass, dos, logic_abuse)
  each: LLM brain plans → its own Tenki VM executes → oracle judges
        → writes findings to shared memory → emits events
                                     │
                                     ▼
                            Coordinator (this)
                     HTTP /events + /memory   ──ws──▶  frontend (Kenil)
```

**Three layers per agent:** an **LLM brain** decides the next attack (reads
shared memory + its history), the **Tenki VM** executes it, and a deterministic
**oracle** (`judge.mjs`) confirms whether it's a real weakness. Keeping the
verdict deterministic (not LLM self-grading) is what makes findings trustworthy.

## Status — VERIFIED LIVE ✅
All of the following were run and confirmed on 2026-09-13:
- **5 concurrent Tenki VMs** boot + exec + tear down in ~930ms (no-card tier).
- **Full deterministic swarm** on real VMs → 7 weaknesses, tower health → 0.
- **LLM brain** drives all 5 agents (3 fast Nebius models, heterogeneous) —
  genuine reasoning, incl. a live self-correction ("SQLi failed at transport
  level due to unencoded spaces; retry with encoding").
- **Full production config** (LLM brain + real Tenki VMs + exposed target) →
  8 weaknesses end to end.

## Quickstart

```bash
cd tower-siege
npm install                       # deps: ws + @tenkicloud/sandbox
cp .env.example .env              # then fill in TENKI_API_KEY + NEBIUS_API_KEY

# ── unblock Kenil immediately (fake events, no agents, no keys) ──
npm run mock                      # Coordinator on :8080, schema-valid events on a timer
                                  # Kenil builds the frontend against ws://localhost:8080

# ── the swarm against a local vulnerable target (mock Tenki, real brain) ──
npm run target                    # terminal A: intentionally-vulnerable stand-in on :9090
npm run swarm                     # terminal B: Coordinator + 5 LLM-driven agents
LOOP=1 npm run swarm              # continuous waves — good for the live demo

# ── verify ──
npm run smoke                     # in-process end-to-end; asserts weaknesses + damage
npm run e2e                       # REAL: hosts target on a Tenki VM, runs the swarm on real VMs
npm run clean                     # close any leaked Tenki VMs (if you hit the 5-session cap)
```
Brain auto-activates when `NEBIUS_API_KEY` is set; without it the agents run
their deterministic scripts (`LLM_BRAIN=off` forces that even with a key).

## The LLM brain (`src/brain.mjs`)
Provider: **Nebius AI Studio** (OpenAI-compatible, `api.studio.nebius.com/v1`).
Heterogeneous per-persona models — chosen for speed + reliable JSON + creativity:

| persona | model | why |
|---|---|---|
| recon | `deepseek-ai/DeepSeek-V4-Flash-0731` | fast/cheap, lots of probing (~1.5s) |
| injection, auth_bypass | `zai-org/GLM-5.3` | most creative payloads/bypasses |
| dos, logic_abuse | `nvidia/Nemotron-3-Ultra-550b-a55b` | fastest clean JSON (~1.4s) |

Loop: `planNextAction()` → VM executes → `judge()` confirms → shared memory →
event. Max `BRAIN_STEPS` per agent (default 5). Falls back to the deterministic
persona if a planning call fails, so the swarm never stalls.

## Real mode (the actual demo config)
```bash
# target = Pranay's public Wasmer app; all 5 Tenki slots are attackers
TENKI_MODE=real TARGET_BASE_URL=https://<pranay-app>.wasmer.app npm run swarm:real
```
Tenki details handled for you: `sticky:true` (no idle-pause mid-judging),
always tear down (a failed create still bills), 1 vCPU/1 GiB per VM (keeps all 5
under the no-card cap), `createVM` retries on the concurrent-jobs cap, and the
attack runs via `python3` inside the VM (Python 3.12 ships in the base image).

## What Kenil receives (WebSocket contract)
Connect to `ws://localhost:8080`. Two message kinds:
```jsonc
// on connect — the current world, so the UI renders immediately
{ "kind": "snapshot", "tower_health": 100, "events": [ ...enriched events ], "briefing": {...} }

// then, one per event, live
{ "kind": "event",
  "event_type": "weakness_found",     // attack_started | attack_result | weakness_found | target_health
  "agent_id": "agent-2", "agent_persona": "injection",
  "target_component": "/api/search", "severity": "critical",
  "description": "SQLi: ' OR 1=1 -- returned unauthorized rows",
  "health_delta": -30, "timestamp": "…",
  "tower_health": 55,                 // added by Coordinator — the live number to render
  "seq": 12 }
```
Animation mapping: `attack_started` → jet flies in · `weakness_found` → jet hits, tower
takes `health_delta` damage (bigger for higher severity) · `attack_result` → jet peels off ·
`target_health` → heartbeat. `tower_health` on every event is the authoritative health bar.

## HTTP API (agents + Pranay's target use this)
- `POST /events`  — ingest one schema event (Pranay posts `target_health` here too)
- `GET  /memory`  — read shared findings + briefing (agents read before acting)
- `POST /memory`  — write a finding
- `GET  /state`   — full snapshot (health, event log, memory) — handy for debugging
- `GET  /health`  — liveness

## Files
| file | role |
|---|---|
| `src/contract.mjs`   | the event schema in code (factory + validator) — shared truth |
| `src/coordinator.mjs`| http ingest + shared memory + **ws broadcast** + health tracking |
| `src/memory.mjs`     | shared attack memory (swap for Redis/Postgres later, same interface) |
| `src/brain.mjs`      | the **LLM brain** — per-persona Nebius models, plans next attack |
| `src/judge.mjs`      | the **oracle** — deterministic verdict on whether an attack worked |
| `src/tenki-driver.mjs`| one VM per agent — **mock** (runs today) + **real** (SDK, verified) |
| `src/agents/base-agent.mjs` | agent lifecycle: boot VM → brain loop (or script) → teardown |
| `src/personas.mjs`   | the 5 personas: LLM system-briefs + deterministic fallback scripts |
| `src/run-swarm.mjs`  | orchestrator: Coordinator + recon-first then 4-in-parallel |
| `src/mock-events.mjs`| fake event source → unblocks Kenil (build-order step 1) |
| `src/mock-target.mjs`| intentionally-vulnerable dev stand-in for Pranay's target |
| `src/coord-client.mjs`| how agents talk to the Coordinator (HTTP) |
| `src/cleanup-vms.mjs`| close every live Tenki session (reset the 5-session cap) |
| `test/smoke.mjs`     | in-process end-to-end assertion (mock Tenki) |
| `test/real-e2e.mjs`  | REAL end-to-end: hosts target on a VM, runs the swarm on real VMs |

## Authorized target
The bundled `mock-target` is yours, built for this event, holds only fake data —
authorized by construction. In the demo, attack **only** Pranay's own
Wasmer-sandboxed target or this stand-in. Never a third-party system. Say so in
the BuilderBase free-text field.

Built for the AI Security Hackathon, SF, 2026-09-13.
