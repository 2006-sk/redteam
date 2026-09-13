// ── Shared truth: mirrors tower-siege/src/contract.mjs ──────────────────
// The frontend consumes the Coordinator's WebSocket feed. Two message kinds:
//   { kind: "snapshot", tower_health, events:[...enriched], briefing }
//   { kind: "event", event_type, agent_id, agent_persona, target_component,
//     severity, description, health_delta, timestamp, tower_health, seq }
// Keep this file in lockstep with the backend contract.

const params = new URLSearchParams(location.search);

// Where the live feed lives. Same host:8080 for both the mock and the real
// Coordinator, so swapping mock → real is literally "run the other server".
export const WS_URL =
  params.get("ws") || `ws://${location.hostname || "localhost"}:8080`;

// HTTP base for optional demo triggers (the mock exposes /trigger/*; the real
// Coordinator won't, and we fall back to a client-side critical gracefully).
export const API_BASE =
  params.get("api") || `http://${location.hostname || "localhost"}:8080`;

export const EVENT_TYPES = ["attack_started", "attack_result", "weakness_found", "target_health"];

export const SEVERITY = {
  info:     { rank: 0, damage: 0,   label: "INFO" },
  low:      { rank: 1, damage: -3,  label: "LOW" },
  medium:   { rank: 2, damage: -8,  label: "MEDIUM" },
  high:     { rank: 3, damage: -15, label: "HIGH" },
  critical: { rank: 4, damage: -30, label: "CRITICAL" },
};

// agent-N → persona, in the order the Coordinator assigns them.
export const AGENTS = [
  { id: "agent-1", persona: "recon",       label: "RECON",       tag: "MAP" },
  { id: "agent-2", persona: "injection",   label: "INJECTION",   tag: "SQLi/XSS" },
  { id: "agent-3", persona: "auth_bypass", label: "AUTH-BYPASS", tag: "IDOR/JWT" },
  { id: "agent-4", persona: "dos",         label: "DoS",         tag: "FLOOD" },
  { id: "agent-5", persona: "logic_abuse", label: "LOGIC-ABUSE", tag: "BIZ-LOGIC" },
];

export const PERSONA_LABEL = Object.fromEntries(AGENTS.map((a) => [a.persona, a.label]));

// Preset "targets" — the tower can be any object; all render as white line-art.
export const TOWER_PRESETS = ["tower", "core", "server", "reactor", "pyramid", "citadel"];

export const START_URL = params.get("target") || null; // optional named target label

// ── Hardcoded fallback switch ──
// false → real: the folder-select screen talks to the backend orchestrator,
//   which boots TowerBank inside a Wasmer sandbox and runs the real swarm.
// true  → the client-side simulator drives a canned siege with no backend.
// Query override: ?fallback=1 forces it on for a zero-backend rehearsal.
export const USE_FALLBACK = params.get("fallback") === "1" ? true : false;
