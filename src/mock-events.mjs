// ── Mock event source ───────────────────────────────────────────────────
// Fires realistic, schema-valid events on a timer so Kenil can build the
// ENTIRE frontend against a live stream before any real agent exists.
// This is build-order step 1 in the master doc. Run: npm run mock
import { createCoordinator } from "./coordinator.mjs";
import { makeEvent, PERSONAS } from "./contract.mjs";

const PORT = Number(process.env.PORT || 8080);
const coord = createCoordinator({ port: PORT });
await coord.listen();
console.log(`[mock] emitting fake events every ~1.2s — connect the frontend to ws://localhost:${PORT}`);

const COMPONENTS = {
  recon:       ["/", "/api", "/login", "/admin", "/static", "robots.txt"],
  injection:   ["/api/search?q=", "/api/user?id=", "/api/chat (LLM)", "/comment"],
  auth_bypass: ["/admin", "/api/user/2/settings", "/api/export", "JWT cookie"],
  dos:         ["/api/report", "/api/search", "/api/upload", "rate-limiter"],
  logic_abuse: ["/api/checkout", "/api/coupon", "/api/transfer", "/api/refund"],
};
const RESULTS = {
  recon:       [["mapped 6 endpoints", "info", 0], ["found /admin unlinked", "low", -3]],
  injection:   [["reflected input unescaped", "medium", -8], ["SQLi: ' OR 1=1 -- returned all rows", "critical", -30], ["prompt injection leaked system prompt", "high", -15]],
  auth_bypass: [["IDOR: read another user's settings", "high", -15], ["forged JWT accepted (alg:none)", "critical", -30]],
  dos:         [["no rate limit on /api/search", "medium", -8], ["10k req/s → 502s", "high", -15]],
  logic_abuse: [["coupon stacks infinitely → -100% price", "high", -15], ["negative quantity → credit issued", "critical", -30]],
};

let n = 0;
const timer = setInterval(() => {
  const persona = PERSONAS[n % PERSONAS.length];
  const agent_id = `agent-${(n % PERSONAS.length) + 1}`;
  const comp = pick(COMPONENTS[persona]);
  // attack_started
  coord.ingest(makeEvent({
    event_type: "attack_started", agent_id, agent_persona: persona,
    target_component: comp, severity: "info", description: `${persona} probing ${comp}`,
  }));
  // ...then a result shortly after
  setTimeout(() => {
    const [desc, sev, dmg] = pick(RESULTS[persona]);
    const hit = Math.random() < 0.55;
    if (hit) {
      coord.ingest(makeEvent({
        event_type: "weakness_found", agent_id, agent_persona: persona,
        target_component: comp, severity: sev, description: desc, health_delta: dmg,
      }));
    } else {
      coord.ingest(makeEvent({
        event_type: "attack_result", agent_id, agent_persona: persona,
        target_component: comp, severity: "low", description: `${persona}: ${comp} held (no weakness)`,
      }));
    }
  }, 400);
  n++;
}, 1200);

// periodic heartbeat so the frontend always has a live number
setInterval(() => coord.ingest(makeEvent({
  event_type: "target_health", target_component: "tower", severity: "info",
  description: "heartbeat", health_delta: 0,
})), 3000);

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
process.on("SIGINT", () => { clearInterval(timer); coord.close().then(() => process.exit(0)); });
