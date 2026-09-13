// ── Coverage report ─────────────────────────────────────────────────────
// Runs the full swarm against TowerBank and reports, per agent: which
// weaknesses it found, and how the swarm's findings cover the 13 planted vulns.
//   node --env-file=.env test/run-report.mjs        (LLM brain if NEBIUS_API_KEY set)
//   LLM_BRAIN=off node --env-file=.env test/run-report.mjs   (deterministic only)
const PORT = 8097, TPORT = 9097;
process.env.TARGET_PORT = String(TPORT);
process.env.TARGET_BASE_URL = `http://localhost:${TPORT}`;
process.env.COORDINATOR_URL = `http://localhost:${PORT}`;

await import("../src/towerbank.mjs"); // self-starts on TPORT
const { createCoordinator } = await import("../src/coordinator.mjs");
const { CoordClient } = await import("../src/coord-client.mjs");
const { MockTenkiDriver } = await import("../src/tenki-driver.mjs");
const { Agent } = await import("../src/agents/base-agent.mjs");
const { PERSONAS } = await import("../src/personas.mjs");
const { brainAvailable, brainProvider, modelFor } = await import("../src/brain.mjs");

const coord = createCoordinator({ port: PORT });
await coord.listen();
await new Promise(r => setTimeout(r, 300));

const driver = new MockTenkiDriver();
const client = new CoordClient(`http://localhost:${PORT}`);

console.log(`\n=== TOWER SIEGE — swarm run against TowerBank ===`);
console.log(`brain: ${brainAvailable() ? brainProvider() + " (LLM-driven)" : "OFF (deterministic scripts)"}\n`);

const t0 = Date.now();
const [recon, ...rest] = PERSONAS;
await new Agent({ persona: recon, driver, coord: client }).run();
await Promise.all(rest.map(p => new Agent({ persona: p, driver, coord: client }).run()));
await new Promise(r => setTimeout(r, 200));

// ── the 13 planted TowerBank vulns (ground truth) ──
const GROUND_TRUTH = [
  ["SQLi auth bypass (login)",        /auth.*bypass|sql.*login|login.*sql/i],
  ["SQLi data dump (search)",         /sql.*inject|dumped the full user|unauthorized rows/i],
  ["Reflected XSS (search)",          /xss|echoed unescaped/i],
  ["Prompt injection (assistant)",    /prompt injection|system prompt/i],
  ["IDOR (user record)",              /idor/i],
  ["Broken authz (admin)",            /admin.*(without|no).*(auth|authz)|broken access/i],
  ["Info disclosure (internal cfg)",  /info disclosure|credentials\/keys|internal config/i],
  ["Unauth bulk export (PII)",        /bulk export|export of customer/i],
  ["No rate limit (export)",          /rate limit/i],
  ["Coupon stacking (checkout)",      /coupon|discount abuse/i],
  ["Negative quantity credit",        /negative total|money flows/i],
  ["Transfer theft (no ownership)",   /transfer/i],
  ["Secret flag exfiltration",        /secret flag|flag exfiltr/i],
];

const weaknesses = coord.eventLog.filter(e => e.event_type === "weakness_found");

// ── per-agent report ──
console.log("── PER-AGENT FINDINGS ──");
for (const persona of PERSONAS) {
  const mine = weaknesses.filter(w => w.agent_persona === persona.name);
  const model = brainAvailable() ? modelFor(persona.name).split("/").pop() : "deterministic";
  console.log(`\n▸ ${persona.agentId}  [${persona.name}]  brain=${model}`);
  if (!mine.length) { console.log("    (no confirmed weakness)"); continue; }
  for (const m of dedupe(mine)) console.log(`    [${m.severity.toUpperCase()}] ${m.target_component} — ${m.description}`);
}

// ── coverage vs ground truth ──
const allText = weaknesses.map(w => `${w.target_component} ${w.description}`).join(" | ");
let hit = 0;
console.log("\n── COVERAGE vs the 13 planted vulnerabilities ──");
for (const [name, rx] of GROUND_TRUTH) {
  const found = rx.test(allText);
  if (found) hit++;
  console.log(`  ${found ? "✅" : "⬜"} ${name}`);
}

const bySev = weaknesses.reduce((m, w) => (m[w.severity] = (m[w.severity] || 0) + 1, m), {});
console.log(`\n── SUMMARY ──`);
console.log(`  agents: ${PERSONAS.length}   events: ${coord.eventLog.length}   time: ${((Date.now()-t0)/1000).toFixed(1)}s`);
console.log(`  weaknesses confirmed: ${weaknesses.length}  (${JSON.stringify(bySev)})`);
console.log(`  tower_health: 100 → ${coord.health}`);
console.log(`  vuln coverage: ${hit}/${GROUND_TRUTH.length}`);
console.log(`  shared-memory findings: ${coord.memory.all().length}`);

await coord.close();
process.exit(0);

function dedupe(arr) {
  const seen = new Set(), out = [];
  for (const w of arr) { const k = w.severity + w.description; if (!seen.has(k)) { seen.add(k); out.push(w); } }
  return out;
}
