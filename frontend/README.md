# Tower Under Siege — Frontend (Kenil's layer)

The visual demo. A **white wireframe target** stands on a black grid while a
**swarm of five jets — one per agent — attacks it from every side**, driven
live by the Coordinator's WebSocket feed. Everything is monochrome white-on-black
line-art; severity reads through motion, brightness and weight, never color. A
`critical` finding detonates a full-screen shockwave — the single biggest
shock-factor moment for the submission video.

Built for maximum legibility at demo pace: gradual integrity descent, punctuated
by deliberate criticals you can fire on demand.

---

## Quickstart

```bash
cd frontend
npm install
npm run dev          # starts the mock backend (:8080) AND the web app (:5173)
```

Open **http://localhost:5173** — the siege begins immediately against the mock
feed. That's it. No keys, no config.

Run the pieces separately if you prefer:

```bash
npm run mock         # just the mock Coordinator on :8080
npm run web          # just the Vite app on :5173
npm run build        # production bundle → dist/
```

---

## Controls

| key | action |
|-----|--------|
| **C** | fire a **critical** strike on demand (the money shot — use it in the recording) |
| **S** | toggle the built-in **simulator** (runs with zero backend, for rehearsal) |
| **R** | reset integrity to 100% |
| **T** | cycle the target object (tower → core → server → reactor → pyramid → citadel) |
| **1–6** | jump straight to a specific target object |
| **H** | hide/show the HUD (clean plate for a screenshot) |
| **drag** | orbit the camera · **scroll** to zoom |

## The target can be any object

The "tower" is just a white wireframe — swap it with **T** or number keys. Six
presets ship (`tower`, `core`, `server`, `reactor`, `pyramid`, `citadel`); add
your own in `src/scene/tower.js` (`build*()` — any Three.js geometry rendered as
`EdgesGeometry` works). Start on a specific one with `?target=` in `config.js`
or by editing `TOWER_PRESETS`.

## URL parameters

| param | effect |
|-------|--------|
| `?demo` or `?sim` | auto-start the built-in simulator — **no backend needed** |
| `?critical` | (with `?demo`) auto-fire a critical a few seconds in |
| `?nobloom` | disable the bloom glow (fallback for weak GPUs / headless) |
| `?ws=ws://host:port` | point at a different feed (default `ws://localhost:8080`) |
| `?api=http://host:port` | base for the critical/reset triggers (default `:8080`) |

Example rehearsal link, zero setup: `http://localhost:5173/?demo&critical`

---

## The live feed it consumes

Inbound only — a WebSocket to the Coordinator on `ws://localhost:8080`, in the
**exact wire format** the real `tower-siege` Coordinator broadcasts:

```jsonc
// on connect — the current world, rendered immediately
{ "kind": "snapshot", "tower_health": 100, "events": [ ...enriched events ], "briefing": {} }

// then one per event, live
{ "kind": "event",
  "event_type": "attack_started | attack_result | weakness_found | target_health",
  "agent_id": "agent-2", "agent_persona": "injection",
  "target_component": "/api/search", "severity": "critical",
  "description": "SQLi: ' OR 1=1 -- returned all rows",
  "health_delta": -30, "timestamp": "…",
  "tower_health": 55,   // Coordinator-authoritative — drives the health bar
  "seq": 12 }
```

Animation mapping:

- `attack_started` → the agent's jet dives in from its orbit, leaves a tracer
- `weakness_found` → the jet **strikes** the surface: shockwave + spark + fracture + shudder, scaled by `severity`; `critical` adds a full-screen flash, camera shake and a big crack
- `attack_result` → the jet **peels off** (held, no weakness) — visibly different from a strike
- `target_health` → a heartbeat pulse of the whole structure

`tower_health` on every event is authoritative, so the health bar stays correct
even if events arrive slightly out of order (real agents run in parallel).
`agent-1..5` map to `recon, injection, auth_bypass, dos, logic_abuse` — each on
its own colored-by-position orbit so you can track who's doing what.

---

## Swapping the mock for the real Coordinator

The mock speaks the identical wire format, so it's a drop-in swap — **the
frontend doesn't change at all**. Just run the real feed on `:8080` instead of
the mock:

```bash
# in ../tower-siege
npm run mock          # schema-valid fake events (Shresth's version)
# — or the real swarm —
npm run target        # terminal A: the vulnerable stand-in
LOOP=1 npm run swarm  # terminal B: Coordinator + 5 LLM-driven agents on :8080
```

Then run only the web app here: `npm run web`. Point elsewhere with
`?ws=ws://host:port` if the Coordinator isn't on localhost.

Keep the **S** (simulator) key handy even on the real feed — it's the rehearsal
mode for shooting takes without live agents.

---

## The mock backend (`mock-server/server.mjs`)

A self-contained stand-in for the Coordinator. Only dependency: `ws`. It mirrors
the real health accounting (severity → damage, clamped 0–100) and wire format,
runs a demo-friendly attack loop (gradual descent, escalations ~every 10 waves),
and adds a few demo conveniences the real Coordinator doesn't need:

| endpoint | does |
|----------|------|
| `GET /trigger/critical` | fire the money-shot critical strike |
| `GET /trigger/wave` | fire one attack wave (`?severity=high` to force) |
| `GET /reset` | restore integrity to 100 |
| `GET /pause` · `/resume` | stop / start the auto loop |
| `GET /health` · `/state` | liveness / full snapshot (parity with the real one) |
| `POST /events` | ingest one event (parity) |

---

## Files

| path | role |
|------|------|
| `src/main.js` | wires the feed → scene + HUD; keyboard; the synced impact handler |
| `src/config.js` | shared truth — mirrors `tower-siege/src/contract.mjs` |
| `src/net/wsClient.js` | WebSocket client: reconnect + tolerant dispatch |
| `src/net/simulator.js` | client-side event source (rehearsal / zero-backend) |
| `src/scene/scene.js` | Three.js stage: camera, orbit controls, bloom, shake |
| `src/scene/tower.js` | the white wireframe target + presets + fracture/health |
| `src/scene/swarm.js` | the 5 jets + orbit/dive/strike/peel state machine |
| `src/scene/effects.js` | shockwaves, sparks, tracers |
| `src/ui/hud.js` | banner ticker, roster, integrity + breakdown charts |
| `mock-server/server.mjs` | self-contained Coordinator-compatible mock |

Stack: Vite + Three.js, vanilla JS. No framework.
