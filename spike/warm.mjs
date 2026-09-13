import { Wasmer } from "@wasmer/sdk/node";
const wasmer = new Wasmer();
// warm the runtime with one throwaway sandbox
const w = await wasmer.sandboxes.create({ packages: ["python/python@=3.13.20"] });
await w.command("python", ["-c", "pass"]).run({ check: false });
console.log("[warm] runtime primed");

const times = [], execs = [];
for (let i = 0; i < 5; i++) {
  const a = performance.now();
  const sb = await wasmer.sandboxes.create({ packages: ["python/python@=3.13.20"] });
  times.push(performance.now() - a);
  const b = performance.now();
  await sb.command("python", ["-c", "print(1)"]).run({ check: false });
  execs.push(performance.now() - b);
  await sb.close();
}
const f = a => a.map(x => x.toFixed(1)).join("ms, ") + "ms";
console.log("[create ] " + f(times));
console.log("[exec   ] " + f(execs));
await w.close(); await wasmer.close();
