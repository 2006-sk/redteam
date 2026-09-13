// Reset: list and close every live Tenki session in the workspace. Run this if
// a crashed test leaked VMs and you hit "max concurrent jobs reached (limit 5)".
//   node --env-file=.env src/cleanup-vms.mjs
import { TenkiSandbox } from "@tenkicloud/sandbox";
const sb = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY });
const sessions = await sb.list();
console.log(`[cleanup] ${sessions.length} live session(s)`);
let closed = 0;
for (const s of sessions) {
  console.log(`   ${s.id}  name=${s.name ?? "?"}  state=${s.state ?? s.runtimeState ?? "?"}`);
  try { await s.close(); closed++; } catch (e) { console.log("   close failed:", String(e).slice(0, 80)); }
}
console.log(`[cleanup] closed ${closed}/${sessions.length}`);
process.exit(0);
