// ── REAL end-to-end ─────────────────────────────────────────────────────
// Proves the whole pipeline with real Tenki VMs:
//   1. host the vulnerable target on ONE Tenki VM, expose it publicly
//   2. run the swarm — recon (1 VM) then 4 attackers (4 VMs) — from REAL VMs
//      against that public URL, all reporting to the Coordinator
//   3. summarize, tear everything down
// Peak concurrency = target(1) + 4 attackers = 5 = the no-card cap.
//
// Run: node --env-file=.env test/real-e2e.mjs
import { readFileSync } from "node:fs";
import { TenkiSandbox, stdoutText } from "@tenkicloud/sandbox";
import { createCoordinator } from "../src/coordinator.mjs";
import { CoordClient } from "../src/coord-client.mjs";
import { RealTenkiDriver } from "../src/tenki-driver.mjs";
import { Agent } from "../src/agents/base-agent.mjs";
import { PERSONAS } from "../src/personas.mjs";

const token = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY;
if (!token) { console.error("no TENKI token — run with --env-file=.env"); process.exit(1); }

const client = new TenkiSandbox({ authToken: token });
let targetVM = null;
const coord = createCoordinator({ port: 8098 });

try {
  // ── 1. host the target on a Tenki VM ──────────────────────────────────
  console.log("[e2e] booting target VM…");
  targetVM = await client.create({ name: "tower-target", cpuCores: 1, memoryMb: 1024, allowInbound: true, allowOutbound: true, sticky: true });
  console.log(`[e2e] target VM up (${targetVM.id}). uploading vulnerable app…`);
  const appSrc = readFileSync(new URL("../src/mock-target.mjs", import.meta.url), "utf8");
  const b64 = Buffer.from(appSrc).toString("base64");
  await targetVM.exec(["bash", "-lc", `echo ${b64} | base64 -d > /home/tenki/target.mjs`]);
  await targetVM.exec(["bash", "-lc", "TARGET_PORT=9090 nohup node /home/tenki/target.mjs > /home/tenki/t.log 2>&1 & sleep 1; cat /home/tenki/t.log"]);
  const exposed = await targetVM.exposePort(9090);
  const url = exposed.previewUrl.replace(/\/$/, "");
  console.log(`[e2e] target exposed at ${url}`);

  // wait until it actually serves
  let live = false;
  for (let i = 0; i < 20 && !live; i++) {
    try { const r = await fetch(url + "/", { signal: AbortSignal.timeout(4000) }); live = r.ok || r.status < 500; } catch {}
    if (!live) await sleep(1000);
  }
  console.log(`[e2e] target serving: ${live}`);
  process.env.TARGET_BASE_URL = url;

  // ── 2. run the swarm from real VMs ────────────────────────────────────
  await coord.listen();
  const driver = new RealTenkiDriver();
  const cc = new CoordClient("http://localhost:8098");
  const [recon, ...rest] = PERSONAS;
  console.log("[e2e] recon wave (1 VM)…");
  await new Agent({ persona: recon, driver, coord: cc }).run();
  await sleep(2500); // let recon's slot fully free before the parallel wave (cap=5)
  console.log("[e2e] attack wave (4 VMs in parallel)…");
  await Promise.all(rest.map(p => new Agent({ persona: p, driver, coord: cc }).run()));

  // ── 3. summarize ──────────────────────────────────────────────────────
  await sleep(300);
  const w = coord.eventLog.filter(e => e.event_type === "weakness_found");
  console.log(`\n[e2e] tower_health=${coord.health}  events=${coord.eventLog.length}  weaknesses=${w.length}`);
  for (const x of w) console.log(`   [${x.severity}] ${x.agent_persona} → ${x.target_component}: ${x.description}`);
  const personas = new Set(coord.eventLog.map(e => e.agent_persona).filter(Boolean));
  console.log(`[e2e] personas that ran on real VMs: ${[...personas].join(", ")}`);
} catch (e) {
  console.error("[e2e] ERROR:", e);
} finally {
  console.log("[e2e] tearing down…");
  try { await targetVM?.close(); } catch {}
  try { await coord.close(); } catch {}
  process.exit(0);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
