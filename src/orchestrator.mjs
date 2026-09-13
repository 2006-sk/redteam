// ── Orchestrator ────────────────────────────────────────────────────────
// The single backend the command center talks to. On the same port it:
//   • serves the WebSocket event feed + POST /events (the Coordinator)
//   • exposes control REST: /api/prepare, /api/status, /api/run, /api/reset
//   • boots TowerBank INSIDE a Wasmer sandbox on demand (via tower/run.py)
//   • runs the 5-agent swarm against it; agents + the sandboxed target both
//     report here, and every event is broadcast to the frontend
//
// Nothing is hardcoded: real Wasmer boot + real swarm + real events. A
// hardcoded fallback exists (USE_FALLBACK) and is OFF for now — with it on,
// the backend runs the local Node TowerBank instead of the Wasmer sandbox.
//
//   node --env-file=.env src/orchestrator.mjs
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCoordinator } from "./coordinator.mjs";
import { CoordClient } from "./coord-client.mjs";
import { MockTenkiDriver } from "./tenki-driver.mjs";
import { Agent } from "./agents/base-agent.mjs";
import { PERSONAS } from "./personas.mjs";
import { makeEvent } from "./contract.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8080);
const TARGET_PORT = Number(process.env.TARGET_PORT || 7070);
const CONTROL_PORT = Number(process.env.CONTROL_PORT || 9100);
const TARGET_URL = `http://127.0.0.1:${TARGET_PORT}`;
const USE_FALLBACK = process.env.USE_FALLBACK === "true";   // ← false for now
const FRONTEND_DIST = join(ROOT, "frontend/dist");

const state = { phase: "idle", ready: false, folder: null, target_url: TARGET_URL,
                mode: USE_FALLBACK ? "fallback" : "wasmer", started_at: null };
let targetProc = null;
let running = false;

// ── boot the target (Wasmer sandbox, or the local fallback) ──
function bootTarget() {
  if (targetProc) return;
  state.phase = "booting"; state.ready = false;
  if (USE_FALLBACK) {
    // hardcoded fallback: local Node TowerBank, no Wasmer
    targetProc = spawn(process.execPath, [join(ROOT, "src/towerbank.mjs")],
      { env: { ...process.env, TARGET_PORT: String(TARGET_PORT) } });
    log("fallback", "local TowerBank (no Wasmer)");
  } else {
    // real: boot TowerBank INSIDE a Wasmer sandbox via the tower harness
    targetProc = spawn(join(ROOT, "tower/.venv/bin/python"), ["run.py"], {
      cwd: join(ROOT, "tower"),
      env: { ...process.env, COORDINATOR_URL: `http://127.0.0.1:${PORT}/events`,
             TARGET_HOST: "127.0.0.1", TARGET_PORT: String(TARGET_PORT),
             CONTROL_PORT: String(CONTROL_PORT), WASMER_CACHE: join(ROOT, "tower/.wasmer") },
    });
    log("wasmer", "booting TowerBank inside a Wasmer sandbox");
  }
  targetProc.stdout?.on("data", d => process.stdout.write("   │ " + d));
  targetProc.stderr?.on("data", d => process.stderr.write("   │err " + d));
  targetProc.on("exit", (code) => { log("target", "exited " + code); targetProc = null; state.ready = false; state.phase = "idle"; });
  waitReady();
}

async function waitReady() {
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    if (!targetProc) return;
    try { const r = await fetch(TARGET_URL + "/health", { signal: AbortSignal.timeout(2000) }); if (r.ok) { state.ready = true; state.phase = "ready"; log("target", "ready at " + TARGET_URL); return; } } catch {}
    await sleep(800);
  }
  log("target", "did not become ready in time");
  state.phase = "error";
}

// ── run the swarm against the target ──
async function runSwarm() {
  if (running || !state.ready) return;
  running = true; state.phase = "running"; state.started_at = new Date().toISOString();
  // reset the health bar so every run starts a fresh siege at 100
  coord.ingest(makeEvent({ event_type: "target_health", target_component: "tower", severity: "info", description: "siege begins", health_delta: 0, health: 100 }));
  process.env.TARGET_BASE_URL = TARGET_URL;
  const driver = new MockTenkiDriver();
  const client = new CoordClient(`http://localhost:${PORT}`);
  const [recon, ...rest] = PERSONAS;
  log("swarm", "recon wave");
  await new Agent({ persona: recon, driver, coord: client }).run();
  log("swarm", "attack wave (4 agents)");
  await Promise.all(rest.map(p => new Agent({ persona: p, driver, coord: client }).run()));
  state.phase = "ready"; running = false;
  log("swarm", `wave complete — tower_health=${coord.health}`);
}

async function resetTarget() {
  try { await fetch(`http://127.0.0.1:${CONTROL_PORT}/reset`, { method: "POST", signal: AbortSignal.timeout(3000) }); } catch {}
  coord.ingest(makeEvent({ event_type: "target_health", target_component: "tower", severity: "info", description: "reset", health_delta: 0, health: 100 }));
}

// ── static file serving (built frontend), if present ──
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
async function serveStatic(req, res, url) {
  if (!existsSync(FRONTEND_DIST)) return false;
  let p = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = join(FRONTEND_DIST, p);
  if (!file.startsWith(FRONTEND_DIST)) return false;
  try {
    const data = await readFile(existsSync(file) ? file : join(FRONTEND_DIST, "index.html"));
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(data); return true;
  } catch { return false; }
}

// ── REST API ──
function body(req) { return new Promise(r => { let b = ""; req.on("data", c => b += c); req.on("end", () => { try { r(JSON.parse(b || "{}")); } catch { r({}); } }); }); }
function apiJson(res, code, obj) { res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(JSON.stringify(obj)); }

async function extraRoutes(req, res, url) {
  const p = url.pathname;
  if (p === "/api/prepare" && req.method === "POST") {
    const b = await body(req); state.folder = b.folder || "project";
    log("prepare", `folder="${state.folder}" mode=${state.mode}`);
    bootTarget();
    return apiJson(res, 200, { ok: true, phase: state.phase, mode: state.mode }), true;
  }
  if (p === "/api/status" && req.method === "GET") return apiJson(res, 200, { ...state, running }), true;
  if (p === "/api/run" && req.method === "POST") { runSwarm(); return apiJson(res, 200, { ok: true, phase: "running" }), true; }
  if (p === "/api/reset" && (req.method === "POST" || req.method === "GET")) { await resetTarget(); return apiJson(res, 200, { ok: true }), true; }
  if (p === "/reset") { await resetTarget(); return apiJson(res, 200, { ok: true }), true; }
  // static frontend (only if built into frontend/dist)
  if (req.method === "GET") return await serveStatic(req, res, url);
  return false;
}

const coord = createCoordinator({ port: PORT, extraRoutes });
await coord.listen();
console.log(`\n[orchestrator] up on http://localhost:${PORT}  (ws + /events + /api/* ${existsSync(FRONTEND_DIST) ? "+ static UI" : ""})`);
console.log(`[orchestrator] mode=${state.mode}  target→${TARGET_URL}  USE_FALLBACK=${USE_FALLBACK}`);
console.log(`[orchestrator] flow: POST /api/prepare → GET /api/status (poll ready) → POST /api/run\n`);
process.on("SIGINT", () => { try { targetProc?.kill("SIGINT"); } catch {} setTimeout(() => process.exit(0), 800); });

function log(tag, msg) { console.log(`[orchestrator:${tag}] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
