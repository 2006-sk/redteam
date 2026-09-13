// ── The Coordinator ─────────────────────────────────────────────────────
// The one service everyone depends on. It:
//   • accepts events from the 5 agents and from Pranay's target (POST /events)
//   • holds the shared attack memory and exposes it to agents (GET/POST /memory)
//   • tracks the tower's health from health_delta / target_health
//   • broadcasts EVERY event to Kenil's frontend over WebSocket, live
//
// Kenil connects to ws://<host>:<port> and needs to know nothing else.
//
// Requires one dependency for the WebSocket server:  npm install ws
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { validateEvent, SEVERITY_DAMAGE } from "./contract.mjs";
import { SharedMemory } from "./memory.mjs";

export function createCoordinator({ port = 8080, startHealth = 100, extraRoutes = null } = {}) {
  const memory = new SharedMemory();
  const eventLog = [];
  let health = startHealth;

  const http = createServer();
  const wss = new WebSocketServer({ server: http });

  function broadcast(obj) {
    const msg = JSON.stringify(obj);
    for (const ws of wss.clients) {
      if (ws.readyState === 1) { try { ws.send(msg); } catch {} }
    }
  }

  /** Ingest one event: update health, log it, broadcast it. */
  function ingest(evt) {
    const err = validateEvent(evt);
    if (err) return { ok: false, error: err };

    // Health accounting. weakness_found uses severity damage if no explicit
    // delta; target_health may carry an absolute `health` for a hard reset.
    if (evt.event_type === "target_health" && typeof evt.health === "number") {
      health = clamp(evt.health);
    } else {
      let delta = evt.health_delta || 0;
      if (evt.event_type === "weakness_found" && delta === 0) delta = SEVERITY_DAMAGE[evt.severity] || 0;
      health = clamp(health + delta);
    }

    const enriched = { ...evt, tower_health: health, seq: eventLog.length + 1 };
    eventLog.push(enriched);
    broadcast({ kind: "event", ...enriched });
    return { ok: true, tower_health: health };
  }

  function clamp(h) { return Math.max(0, Math.min(100, Math.round(h))); }

  // ── HTTP API ──────────────────────────────────────────────────────────
  http.on("request", async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    };
    const json = (code, body) => { res.writeHead(code, { "content-type": "application/json", ...cors }); res.end(JSON.stringify(body)); };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }

    // Orchestrator hook: lets a wrapper add /api/* + serve the static frontend
    // on the SAME port as the WS feed. Tried before the built-in routes.
    if (extraRoutes) {
      try { if (await extraRoutes(req, res, url)) return; }
      catch (e) { return json(500, { error: String(e) }); }
    }

    if (url.pathname === "/health" && req.method === "GET")
      return json(200, { ok: true, tower_health: health, events: eventLog.length, ws_clients: wss.clients.size });

    if (url.pathname === "/state" && req.method === "GET")
      return json(200, { tower_health: health, events: eventLog, memory: memory.all(), briefing: memory.briefing() });

    if (url.pathname === "/events" && req.method === "POST") {
      const evt = await body(req);
      if (!evt) return json(400, { ok: false, error: "invalid JSON" });
      const r = ingest(evt);
      return json(r.ok ? 200 : 400, r);
    }

    if (url.pathname === "/memory" && req.method === "GET") {
      const q = Object.fromEntries(url.searchParams);
      return json(200, { records: memory.read(q), briefing: memory.briefing() });
    }
    if (url.pathname === "/memory" && req.method === "POST") {
      const rec = await body(req);
      if (!rec) return json(400, { ok: false, error: "invalid JSON" });
      return json(200, { ok: true, record: memory.write(rec) });
    }

    json(404, { error: "not found", routes: ["GET /health", "GET /state", "POST /events", "GET|POST /memory", "ws://"] });
  });

  wss.on("connection", (ws) => {
    // On connect, hand the frontend the current world so it can render
    // immediately without waiting for the next event.
    ws.send(JSON.stringify({ kind: "snapshot", tower_health: health, events: eventLog, briefing: memory.briefing() }));
  });

  return {
    memory,
    ingest,
    broadcast,
    get health() { return health; },
    get eventLog() { return eventLog; },
    listen() {
      return new Promise((resolve) => http.listen(port, () => {
        console.log(`[coordinator] http + ws on :${port}  (POST /events, GET|POST /memory, ws://localhost:${port})`);
        resolve();
      }));
    },
    close() { return new Promise(r => { wss.close(); http.close(r); }); },
  };
}

function body(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", c => { b += c; if (b.length > 1_000_000) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve(null); } });
    req.on("error", () => resolve(null));
  });
}
