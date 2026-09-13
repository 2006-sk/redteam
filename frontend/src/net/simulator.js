// ── Client-side simulator ───────────────────────────────────────────────
// A self-contained event source that produces the SAME wrapped events the
// Coordinator does, so the whole visual system can be rehearsed with zero
// backend (README watch-out: keep a seed/replay mode even after the real feed
// is wired). Toggle with the "S" key. Also powers a client-side critical when
// no mock trigger endpoint is reachable.

import { SEVERITY, AGENTS } from "../config.js";

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

const pick = (a) => a[Math.floor(Math.random() * a.length)];

export function createSimulator(dispatch) {
  let health = 100;
  let seq = 0;
  let running = false;
  let timer = null;
  let beat = null;

  function emit(partial) {
    const evt = {
      kind: "event",
      agent_id: null,
      agent_persona: null,
      target_component: "",
      severity: "info",
      description: "",
      health_delta: 0,
      timestamp: new Date().toISOString(),
      ...partial,
    };
    if (evt.event_type === "weakness_found" && !evt.health_delta) {
      evt.health_delta = SEVERITY[evt.severity]?.damage || 0;
    }
    health = Math.max(0, Math.min(100, Math.round(health + (evt.health_delta || 0))));
    if (evt.event_type === "target_health" && typeof evt.absolute === "number") {
      health = Math.max(0, Math.min(100, Math.round(evt.absolute)));
    }
    evt.tower_health = health;
    evt.seq = ++seq;
    dispatch(evt);
  }

  function wave() {
    const a = pick(AGENTS);
    const comp = pick(COMPONENTS[a.persona]);
    emit({ event_type: "attack_started", agent_id: a.id, agent_persona: a.persona, target_component: comp, description: `${a.persona} probing ${comp}` });
    setTimeout(() => {
      const [desc, sev] = pick(RESULTS[a.persona]);
      if (Math.random() < 0.58) {
        emit({ event_type: "weakness_found", agent_id: a.id, agent_persona: a.persona, target_component: comp, severity: sev, description: desc });
      } else {
        emit({ event_type: "attack_result", agent_id: a.id, agent_persona: a.persona, target_component: comp, severity: "low", description: `${a.persona}: ${comp} held (no weakness)` });
      }
    }, 450);
  }

  // The rehearsable "money shot": a critical strike on demand.
  function critical() {
    const a = pick([AGENTS[1], AGENTS[2], AGENTS[4]]); // injection / auth / logic
    const comp = pick(COMPONENTS[a.persona]);
    emit({ event_type: "attack_started", agent_id: a.id, agent_persona: a.persona, target_component: comp, description: `${a.persona} escalating on ${comp}` });
    setTimeout(() => {
      emit({ event_type: "weakness_found", agent_id: a.id, agent_persona: a.persona, target_component: comp, severity: "critical", description: pick(RESULTS[a.persona].filter(r => r[1] === "critical"))?.[0] || "critical exploit chain confirmed" });
    }, 650);
  }

  return {
    get running() { return running; },
    setHealth(h) { health = h; },
    start() {
      if (running) return;
      running = true;
      timer = setInterval(wave, 1200);
      beat = setInterval(() => emit({ event_type: "target_health", target_component: "tower", description: "heartbeat" }), 3000);
    },
    stop() {
      running = false;
      clearInterval(timer);
      clearInterval(beat);
    },
    critical,
    reset() { health = 100; emit({ event_type: "target_health", target_component: "tower", description: "reset", absolute: 100 }); },
  };
}
