// ── FULL END-TO-END: Wasmer-sandboxed TowerBank + the swarm ─────────────
// 1. start the Coordinator (:4000)
// 2. boot TowerBank INSIDE a Wasmer sandbox via the tower harness (:8080)
// 3. run the 5-agent swarm against it; both the agents AND the self-
//    instrumenting target report weaknesses to the Coordinator
// 4. summarize coverage, then tear the sandbox down
//
//   node --env-file=.env test/e2e-wasmer.mjs           (LLM brains if key set)
//   LLM_BRAIN=off node --env-file=.env test/e2e-wasmer.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COORD_PORT = 4000, TARGET = "http://127.0.0.1:8080";
process.env.TARGET_BASE_URL = TARGET;
process.env.COORDINATOR_URL = `http://localhost:${COORD_PORT}`;

const { createCoordinator } = await import("../src/coordinator.mjs");
const { CoordClient } = await import("../src/coord-client.mjs");
const { MockTenkiDriver } = await import("../src/tenki-driver.mjs");
const { Agent } = await import("../src/agents/base-agent.mjs");
const { PERSONAS } = await import("../src/personas.mjs");
const { brainAvailable, brainProvider } = await import("../src/brain.mjs");

const coord = createCoordinator({ port: COORD_PORT });
await coord.listen();
console.log(`[e2e] Coordinator up on :${COORD_PORT}`);

// ── boot TowerBank inside Wasmer via the tower harness ──
console.log("[e2e] booting TowerBank inside a Wasmer sandbox (tower/run.py)…");
const py = spawn(join(ROOT, "tower/.venv/bin/python"), ["run.py"], {
  cwd: join(ROOT, "tower"),
  env: { ...process.env, COORDINATOR_URL: `http://127.0.0.1:${COORD_PORT}/events`,
         TARGET_HOST: "127.0.0.1", TARGET_PORT: "8080", CONTROL_PORT: "9100",
         WASMER_CACHE: join(ROOT, "tower/.wasmer") },
});
py.stdout.on("data", d => process.stdout.write(String(d).split("\n").filter(Boolean).map(l => "   │ " + l).join("\n") + "\n"));
py.stderr.on("data", d => process.stderr.write("   │err " + String(d)));

// wait until the sandboxed target accepts requests
async function waitTarget(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(TARGET + "/health", { signal: AbortSignal.timeout(2000) }); if (r.ok) return true; } catch {}
    await sleep(1000);
  }
  return false;
}
const up = await waitTarget(45000);
if (!up) { console.error("[e2e] target never came up — aborting"); py.kill("SIGINT"); await coord.close(); process.exit(1); }
console.log(`\n[e2e] TowerBank is live inside Wasmer at ${TARGET}\n[e2e] brain: ${brainAvailable() ? brainProvider() : "off (deterministic)"}\n`);

// ── run the swarm ──
const driver = new MockTenkiDriver();
const client = new CoordClient(`http://localhost:${COORD_PORT}`);
const [recon, ...rest] = PERSONAS;
await new Agent({ persona: recon, driver, coord: client }).run();
await Promise.all(rest.map(p => new Agent({ persona: p, driver, coord: client }).run()));
await sleep(500);

// ── report ──
const ev = coord.eventLog;
const weak = ev.filter(e => e.event_type === "weakness_found");
const fromTarget = weak.filter(e => (e.agent_id || "").includes("target"));
const fromAgents = weak.filter(e => !(e.agent_id || "").includes("target"));
console.log("\n════════════ END-TO-END RESULT ════════════");
console.log(`Coordinator events: ${ev.length}   tower_health: 100 → ${coord.health}`);
console.log(`Weaknesses — from the Wasmer target's own instrumentation: ${fromTarget.length}`);
console.log(`Weaknesses — confirmed by the attacking agents:            ${fromAgents.length}`);
console.log(`\nTarget self-reported (proof it ran in Wasmer and detected the breach):`);
for (const w of dedupe(fromTarget)) console.log(`   ⚡ [${w.severity}] ${w.target_component} — ${w.description}`);
console.log(`\nAgent-confirmed:`);
for (const w of dedupe(fromAgents)) console.log(`   🎯 [${w.severity}] ${w.agent_persona} → ${w.target_component}`);

console.log("\n[e2e] tearing down the Wasmer sandbox…");
py.kill("SIGINT");
await sleep(2500);
py.kill("SIGKILL");
await coord.close();
process.exit(0);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function dedupe(a) { const s = new Set(), o = []; for (const w of a) { const k = w.severity + w.target_component + w.description; if (!s.has(k)) { s.add(k); o.push(w); } } return o; }
