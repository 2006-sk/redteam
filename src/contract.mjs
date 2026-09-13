// ── The event contract (from README-master.md) ─────────────────────────
// Every event through the Coordinator uses this shape. Kenil's frontend and
// Pranay's target both build against it. Change it here first, then tell them.
//
//   {
//     event_type, agent_id, agent_persona, target_component,
//     severity, description, health_delta, timestamp
//   }

export const EVENT_TYPES = ["attack_started", "attack_result", "weakness_found", "target_health"];
export const SEVERITIES = ["info", "low", "medium", "high", "critical"];
export const PERSONAS = ["recon", "injection", "auth_bypass", "dos", "logic_abuse"];

// How much each severity hurts the tower when a weakness is confirmed.
export const SEVERITY_DAMAGE = { info: 0, low: -3, medium: -8, high: -15, critical: -30 };

/** Build a schema-valid event. Unknown fields are dropped so the wire format
 *  never surprises the other two teams. */
export function makeEvent({
  event_type, agent_id = null, agent_persona = null, target_component = "",
  severity = "info", description = "", health_delta = 0, timestamp,
}) {
  if (!EVENT_TYPES.includes(event_type)) throw new Error(`bad event_type: ${event_type}`);
  if (!SEVERITIES.includes(severity)) throw new Error(`bad severity: ${severity}`);
  if (agent_persona !== null && !PERSONAS.includes(agent_persona)) throw new Error(`bad persona: ${agent_persona}`);
  return {
    event_type,
    agent_id,
    agent_persona,
    target_component: String(target_component),
    severity,
    description: String(description),
    health_delta: Number(health_delta) || 0,
    timestamp: timestamp || new Date().toISOString(),
  };
}

/** Returns null if valid, else a string describing the first problem.
 *  Lenient on agent_persona: the target emits persona "tower" for its own
 *  health/instrumentation events, so accept any string (or null) here — only
 *  makeEvent (used by our own agents) enforces the known-persona list. */
export function validateEvent(e) {
  if (!e || typeof e !== "object") return "not an object";
  if (!EVENT_TYPES.includes(e.event_type)) return `event_type: ${e.event_type}`;
  if (!SEVERITIES.includes(e.severity)) return `severity: ${e.severity}`;
  if (e.agent_persona != null && typeof e.agent_persona !== "string") return `agent_persona: ${e.agent_persona}`;
  if (typeof e.description !== "string") return "description not a string";
  if (typeof e.health_delta !== "number") return "health_delta not a number";
  return null;
}
