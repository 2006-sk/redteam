// ── Swarm orchestrator ──────────────────────────────────────────────────
// Starts the Coordinator (http + ws) and runs the 5 agents against the target.
// Recon goes first and seeds shared memory; the other four run in parallel and
// build on what Recon found. Kenil connects to ws://localhost:PORT.
//
//   npm run swarm                       # mock Tenki + local mock target
//   TENKI_MODE=real TARGET_BASE_URL=https://<pranay-app> npm run swarm
//   LOOP=1 npm run swarm                # continuous waves (good for the live demo)
import { createCoordinator } from "./coordinator.mjs";
import { getTenkiDriver } from "./tenki-driver.mjs";
import { CoordClient } from "./coord-client.mjs";
import { Agent } from "./agents/base-agent.mjs";
import { PERSONAS } from "./personas.mjs";

const PORT = Number(process.env.PORT || 8080);
const LOOP = process.env.LOOP === "1";
const WAVE_INTERVAL = Number(process.env.WAVE_INTERVAL || 6000);

const coord = createCoordinator({ port: PORT });
await coord.listen();

const driver = getTenkiDriver();
const coordClient = new CoordClient(`http://localhost:${PORT}`);
console.log(`[swarm] tenki=${driver.mode}  target=${process.env.TARGET_BASE_URL || "http://localhost:9090"}`);
console.log(`[swarm] frontend → ws://localhost:${PORT}`);

const [reconPersona, ...rest] = PERSONAS;

async function wave(n) {
  console.log(`\n[swarm] ── wave ${n} ──`);
  // recon first, alone, so its findings are in shared memory before the rest
  await new Agent({ persona: reconPersona, driver, coord: coordClient }).run();
  // the other four in parallel, each with its own VM, all reading recon's memory
  await Promise.all(rest.map(p => new Agent({ persona: p, driver, coord: coordClient }).run()));
  console.log(`[swarm] wave ${n} done — tower_health=${coord.health}`);
}

let n = 1;
await wave(n);
if (LOOP) {
  const t = setInterval(async () => {
    if (coord.health <= 0) { console.log("[swarm] tower down."); }
    await wave(++n);
  }, WAVE_INTERVAL);
  process.on("SIGINT", () => { clearInterval(t); coord.close().then(() => process.exit(0)); });
} else {
  console.log("\n[swarm] single wave complete. Coordinator staying up for the frontend (Ctrl+C to exit).");
  console.log(`[swarm] final tower_health = ${coord.health}, ${coord.eventLog.length} events`);
  process.on("SIGINT", () => coord.close().then(() => process.exit(0)));
}
