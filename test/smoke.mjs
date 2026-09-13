// End-to-end smoke test (no Tenki, no Bash needed at runtime beyond `node`).
// Starts a Coordinator + the mock target, runs all 5 agents against it, and
// asserts the swarm produced weaknesses and hurt the tower.
//   npm run smoke
import { createCoordinator } from "../src/coordinator.mjs";
import { CoordClient } from "../src/coord-client.mjs";
import { MockTenkiDriver } from "../src/tenki-driver.mjs";
import { Agent } from "../src/agents/base-agent.mjs";
import { PERSONAS } from "../src/personas.mjs";

const PORT = 8099;
process.env.COORDINATOR_URL = `http://localhost:${PORT}`;
process.env.TARGET_BASE_URL = `http://localhost:9099`;
process.env.TARGET_PORT = "9099";

await import("../src/towerbank.mjs"); // self-starts on :9099 (realistic target)
const coord = createCoordinator({ port: PORT });
await coord.listen();
await new Promise(r => setTimeout(r, 300)); // let servers settle

const driver = new MockTenkiDriver();
const client = new CoordClient(`http://localhost:${PORT}`);

const [recon, ...rest] = PERSONAS;
await new Agent({ persona: recon, driver, coord: client }).run();
await Promise.all(rest.map(p => new Agent({ persona: p, driver, coord: client }).run()));
await new Promise(r => setTimeout(r, 200));

const evts = coord.eventLog;
const weaknesses = evts.filter(e => e.event_type === "weakness_found");
const personasThatScored = new Set(weaknesses.map(w => w.agent_persona));
const criticals = weaknesses.filter(w => w.severity === "critical");

const checks = [
  ["coordinator received events", evts.length > 10],
  ["all 5 personas emitted", new Set(evts.map(e => e.agent_persona).filter(Boolean)).size === 5],
  ["weaknesses were found", weaknesses.length >= 3],
  ["at least one critical", criticals.length >= 1],
  ["tower took damage", coord.health < 100],
  ["shared memory populated", coord.memory.all().length > 0],
];

console.log("\n── results ──");
console.log(`events=${evts.length}  weaknesses=${weaknesses.length}  criticals=${criticals.length}  tower_health=${coord.health}`);
console.log(`personas that scored: ${[...personasThatScored].join(", ")}`);
console.log(`memory findings: ${coord.memory.all().length}\n`);
for (const w of weaknesses) console.log(`  [${w.severity}] ${w.agent_persona} → ${w.target_component}: ${w.description}`);

console.log();
let pass = 0;
for (const [name, ok] of checks) { console.log(`${ok ? "✓" : "✗"} ${name}`); if (ok) pass++; }
console.log(`\n${pass}/${checks.length} checks passed`);
await coord.close();
process.exit(pass === checks.length ? 0 : 1);
