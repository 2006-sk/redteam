// ── Mock Coordinator ────────────────────────────────────────────────────
// A self-contained stand-in for tower-siege's real Coordinator. It speaks the
// EXACT wire format the frontend consumes, so switching mock → real is just
// "run the other server on :8080":
//
//   on connect →  { kind:"snapshot", tower_health, events:[...enriched], briefing, mock:true }
//   per event  →  { kind:"event", ...event, tower_health, seq }
//
// Plus demo conveniences the real Coordinator doesn't need:
//   GET /trigger/critical   fire the money-shot critical strike on demand
//   GET /trigger/wave       fire one attack wave
//   GET /reset              restore integrity to 100
//   GET /pause  /resume     stop / start the auto attack loop
//
// Only dependency: ws.  Run:  node mock-server/server.mjs   (or npm run mock)

import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 8080);

// mirror tower-siege/src/contract.mjs
const SEVERITY_DAMAGE = { info: 0, low: -3, medium: -8, high: -15, critical: -30 };
const clamp = (h) => Math.max(0, Math.min(100, Math.round(h)));

const COMPONENTS = {
  recon:       ["/", "/api", "/login", "/admin", "/static", "robots.txt"],
  injection:   ["/api/search?q=", "/api/user?id=", "/api/chat (LLM)", "/comment"],
  auth_bypass: ["/admin", "/api/user/2/settings", "/api/export", "JWT cookie"],
  dos:         ["/api/report", "/api/search", "/api/upload", "rate-limiter"],
  logic_abuse: ["/api/checkout", "/api/coupon", "/api/transfer", "/api/refund"],
};
const RESULTS = {
  recon:       [["mapped 6 endpoints", "info"], ["found /admin unlinked", "low"]],
  injection:   [["reflected input unescaped", "medium"], ["SQLi: ' OR 1=1 -- returned all rows", "critical"], ["prompt injection leaked system prompt", "high"]],
  auth_bypass: [["IDOR: read another user's settings", "high"], ["forged JWT accepted (alg:none)", "critical"]],
  dos:         [["no rate limit on /api/search", "medium"], ["10k req/s -> 502s", "high"]],
  logic_abuse: [["coupon stacks infinitely -> -100% price", "high"], ["negative quantity -> credit issued", "critical"]],
};
const PERSONAS = Object.keys(COMPONENTS);
const AGENT_OF = { recon: "agent-1", injection: "agent-2", auth_bypass: "agent-3", dos: "agent-4", logic_abuse: "agent-5" };
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ── state ──
let health = 100;
const eventLog = [];
const http = createServer();
const wss = new WebSocketServer({ server: http });

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of wss.clients) if (ws.readyState === 1) { try { ws.send(msg); } catch {} }
}

function emit({ event_type, agent_id = null, agent_persona = null, target_component = "", severity = "info", description = "", health_delta = 0, absolute = null }) {
  const evt = { event_type, agent_id, agent_persona, target_component: String(target_component), severity, description: String(description), health_delta: Number(health_delta) || 0, timestamp: new Date().toISOString() };
  if (event_type === "weakness_found" && evt.health_delta === 0) evt.health_delta = SEVERITY_DAMAGE[severity] || 0;
  if (event_type === "target_health" && typeof absolute === "number") health = clamp(absolute);
  else health = clamp(health + evt.health_delta);
  const enriched = { ...evt, tower_health: health, seq: eventLog.length + 1 };
  eventLog.push(enriched);
  broadcast({ kind: "event", ...enriched });
  return enriched;
}

// ── attack choreography ──
function attackStart(persona, comp) {
  emit({ event_type: "attack_started", agent_id: AGENT_OF[persona], agent_persona: persona, target_component: comp, description: `${persona} probing ${comp}` });
}
function resolve(persona, comp, forceSeverity = null) {
  const options = RESULTS[persona];
  let entry = forceSeverity ? options.find((r) => r[1] === forceSeverity) : null;
  // Non-escalated waves stay mild (no criticals) so the descent is gradual and
  // criticals land only on escalation or a manual /trigger/critical.
  if (!entry) entry = pick(options.filter((r) => r[1] !== "critical")) || pick(options);
  const [desc, sev] = entry;
  const hit = forceSeverity ? true : Math.random() < 0.5;
  if (hit) emit({ event_type: "weakness_found", agent_id: AGENT_OF[persona], agent_persona: persona, target_component: comp, severity: sev, description: desc });
  else emit({ event_type: "attack_result", agent_id: AGENT_OF[persona], agent_persona: persona, target_component: comp, severity: "low", description: `${persona}: ${comp} held (no weakness)` });
}

let waveCount = 0;
function wave(forceSeverity = null) {
  const persona = pick(PERSONAS);
  const comp = pick(COMPONENTS[persona]);
  attackStart(persona, comp);
  setTimeout(() => resolve(persona, comp, forceSeverity), 400 + Math.random() * 350);
  waveCount++;
}

// the rehearsable critical: a plausible escalation to a critical strike
function criticalStrike() {
  const persona = pick(["injection", "auth_bypass", "logic_abuse"]);
  const comp = pick(COMPONENTS[persona]);
  attackStart(persona, comp);
  setTimeout(() => resolve(persona, comp, "critical"), 600);
}

// ── auto loop ──
let paused = false;
let loopTimer = null;
let beatTimer = null;
function startLoop() {
  stopLoop();
  loopTimer = setInterval(() => {
    if (paused) return;
    // A demo-friendly descent: mostly probes + smaller findings, with an
    // escalation to high/critical roughly every ~10 waves for punctuation.
    // Stops hammering once integrity is already low so the breach reads before
    // the reset, rather than flooring instantly.
    const escalate = waveCount % 10 === 9 && health > 45;
    const forced = escalate ? pick(["high", "critical"]) : null;
    wave(forced);
    if (health <= 0) {
      paused = true;
      setTimeout(() => { emit({ event_type: "target_health", target_component: "tower", description: "reinforcements — integrity restored", absolute: 100 }); paused = false; }, 4500);
    }
  }, 1500);
  beatTimer = setInterval(() => { if (!paused) emit({ event_type: "target_health", target_component: "tower", description: "heartbeat" }); }, 3000);
}
function stopLoop() { clearInterval(loopTimer); clearInterval(beatTimer); }

// ── HTTP ──
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS" };
http.on("request", async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const json = (code, body) => { res.writeHead(code, { "content-type": "application/json", ...CORS }); res.end(JSON.stringify(body)); };
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }

  switch (url.pathname) {
    case "/health": return json(200, { ok: true, tower_health: health, events: eventLog.length, ws_clients: wss.clients.size, mock: true });
    case "/state": return json(200, { tower_health: health, events: eventLog, briefing: {}, mock: true });
    case "/trigger/critical": criticalStrike(); return json(200, { ok: true, fired: "critical" });
    case "/trigger/wave": wave(url.searchParams.get("severity")); return json(200, { ok: true, fired: "wave" });
    case "/reset": emit({ event_type: "target_health", target_component: "tower", description: "manual reset", absolute: 100 }); return json(200, { ok: true, tower_health: health });
    case "/pause": paused = true; return json(200, { ok: true, paused });
    case "/resume": paused = false; return json(200, { ok: true, paused });
    case "/events": {
      if (req.method !== "POST") return json(405, { error: "POST only" });
      const evt = await readBody(req);
      if (!evt) return json(400, { ok: false, error: "invalid JSON" });
      const e = emit(evt);
      return json(200, { ok: true, tower_health: e.tower_health });
    }
    default: return json(404, { error: "not found", routes: ["/health", "/state", "/trigger/critical", "/trigger/wave", "/reset", "/pause", "/resume", "POST /events", "ws://"] });
  }
});

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ kind: "snapshot", tower_health: health, events: eventLog, briefing: {}, mock: true }));
});

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve(null); } });
    req.on("error", () => resolve(null));
  });
}

http.listen(PORT, () => {
  startLoop();
  console.log(`\n  ┌─ MOCK COORDINATOR ────────────────────────────────────────`);
  console.log(`  │  ws + http on  :${PORT}`);
  console.log(`  │  frontend →    ws://localhost:${PORT}   (snapshot + live events)`);
  console.log(`  │  money shot →  http://localhost:${PORT}/trigger/critical`);
  console.log(`  │  reset →       http://localhost:${PORT}/reset`);
  console.log(`  │  auto attack loop running (pause: /pause  resume: /resume)`);
  console.log(`  └────────────────────────────────────────────────────────────\n`);
});

process.on("SIGINT", () => { stopLoop(); wss.close(); http.close(() => process.exit(0)); });
