// ── The LLM brain (agent planner) ───────────────────────────────────────
// Turns each scripted persona into a genuinely autonomous agent: an LLM reads
// the shared attack memory + recon's findings + its own attempt history, and
// decides the next attack. The Tenki VM EXECUTES; the LLM only DECIDES; a
// separate oracle (judge.mjs) confirms whether an attempt is a real weakness.
//
// Provider priority: Nebius (OpenAI-compatible) → Anthropic → OpenAI.
// Falls back to the deterministic persona heuristics when no key is set, so the
// swarm always runs and just gets smarter with a brain.
//
//   NEBIUS_API_KEY   → Nebius AI Studio (what we use). Base: api.studio.nebius.com/v1
//   ANTHROPIC_API_KEY / OPENAI_API_KEY → alternatives
//   LLM_BRAIN=off    → force the deterministic path even with a key

const NEBIUS = () => process.env.NEBIUS_API_KEY;
const ANTHROPIC = () => process.env.ANTHROPIC_API_KEY;
const OPENAI = () => process.env.OPENAI_API_KEY;

export function brainAvailable() {
  return process.env.LLM_BRAIN !== "off" && (!!NEBIUS() || !!ANTHROPIC() || !!OPENAI());
}
export function brainProvider() {
  if (process.env.LLM_BRAIN === "off") return "off";
  if (NEBIUS()) return "nebius";
  if (ANTHROPIC()) return "anthropic";
  if (OPENAI()) return "openai";
  return "none";
}

// Heterogeneous brains: 3 fast Nebius models, assigned per persona. Fastest +
// reliable JSON up top; GLM-5.3 is the most creative (it invents novel bypasses).
const NEBIUS_MODELS = {
  recon:       "deepseek-ai/DeepSeek-V4-Flash-0731",     // fast/cheap, lots of probing
  injection:   "zai-org/GLM-5.3",                        // creative payloads
  auth_bypass: "zai-org/GLM-5.3",                        // creative bypasses
  dos:         "nvidia/Nemotron-3-Ultra-550b-a55b",      // fast
  logic_abuse: "nvidia/Nemotron-3-Ultra-550b-a55b",      // fast + good reasoning
  _default:    "nvidia/Nemotron-3-Ultra-550b-a55b",
};
export function modelFor(persona) {
  return process.env.BRAIN_MODEL || NEBIUS_MODELS[persona] || NEBIUS_MODELS._default;
}

const PERSONA_BRIEFS = {
  recon: "You fingerprint the target: enumerate endpoints, files and surface. Prefer GET probes of common/likely paths. You SEED shared memory for the others.",
  injection: "You test input handling: SQL injection, command injection, reflected/stored XSS, and prompt injection on any LLM-facing endpoint.",
  auth_bypass: "You test access control: IDOR (object references you shouldn't reach), missing authorization, and forged/weak tokens.",
  dos: "You test resource handling: missing rate limits and expensive endpoints. Stay bounded and non-destructive — never a real flood.",
  logic_abuse: "You exploit business logic: coupon/discount stacking, negative quantities, price/qty tampering, workflow assumptions — not input validation.",
};

/**
 * Ask the LLM for the next attack action.
 * @returns {Promise<{path,method,headers,body,rationale,severity_if_confirmed,stop} | null>}
 *          null → caller should use its deterministic fallback.
 */
export async function planNextAction({ persona, briefing, history, targetHint }) {
  if (!brainAvailable()) return null;

  const system =
    `You are an autonomous red-team agent on an AUTHORIZED, self-owned target built for a security hackathon. ` +
    `Persona "${persona}": ${PERSONA_BRIEFS[persona] || ""}\n` +
    `You act ONLY by proposing ONE HTTP request against the target. You never touch anything else. ` +
    `Use the shared memory (other agents' findings) to avoid repeats and build on partial success. ` +
    `Respond with ONLY a compact JSON object and NOTHING else — no explanation, no markdown:\n` +
    `{"path":"/api/...","method":"GET|POST","headers":{},"body":"<string, omit if none>",` +
    `"rationale":"one short line","severity_if_confirmed":"low|medium|high|critical","stop":false}\n` +
    `Set "stop":true when you have exhausted useful ideas for your persona.`;

  const user =
    `Target: ${targetHint || "an HTTP web app"}\n` +
    `Shared memory (other agents' findings):\n${JSON.stringify(briefing).slice(0, 2800)}\n\n` +
    `Your attempts so far:\n${JSON.stringify(history).slice(0, 2200)}\n\n` +
    `Give the next single request to try.`;

  try {
    const provider = brainProvider();
    const raw =
      provider === "nebius"    ? await callOpenAICompatible("https://api.studio.nebius.com/v1/chat/completions", NEBIUS(), modelFor(persona), system, user)
      : provider === "openai"  ? await callOpenAICompatible("https://api.openai.com/v1/chat/completions", OPENAI(), process.env.BRAIN_MODEL || "gpt-4.1-mini", system, user)
      : provider === "anthropic" ? await callAnthropic(system, user)
      : "";
    const obj = extractJson(raw);
    if (!obj) return null;
    if (obj.stop) return { stop: true };
    return {
      path: String(obj.path || "/"),
      method: (obj.method || "GET").toUpperCase(),
      headers: obj.headers && typeof obj.headers === "object" ? obj.headers : {},
      body: obj.body,
      rationale: String(obj.rationale || ""),
      severity_if_confirmed: obj.severity_if_confirmed || "medium",
      stop: false,
    };
  } catch (e) {
    console.warn(`[brain:${persona}] planning failed, falling back:`, String(e).slice(0, 120));
    return null;
  }
}

async function callOpenAICompatible(url, key, model, system, user) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model, max_tokens: 800, temperature: 0.3,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(40000),
  });
  if (!r.ok) throw new Error(`${model} ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const j = await r.json();
  return j.choices?.[0]?.message?.content || "";
}

async function callAnthropic(system, user) {
  const model = process.env.BRAIN_MODEL || "claude-sonnet-5";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC(), "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 500, system, messages: [{ role: "user", content: user }] }),
    signal: AbortSignal.timeout(40000),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const j = await r.json();
  return j.content?.map(c => c.text || "").join("") || "";
}

// Robust: models sometimes wrap JSON in prose/markdown; grab the last {...} block.
function extractJson(s) {
  if (!s) return null;
  const fenced = s.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch {} }
  const first = s.indexOf("{"), last = s.lastIndexOf("}");
  if (first === -1 || last <= first) return null;
  try { return JSON.parse(s.slice(first, last + 1)); } catch { return null; }
}
