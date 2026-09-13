import { Wasmer } from "@wasmer/sdk/node";

const t0 = Date.now();
const wasmer = new Wasmer();
const sandbox = await wasmer.sandboxes.create({
  packages: ["python/python@=3.13.20"],
  files: { "main.py": "print('HELLO FROM WASM SANDBOX')" },
});
console.log(`[+] sandbox created in ${Date.now()-t0}ms`);

// 1. normal run
const ok = await sandbox.command("python", ["/workspace/main.py"]).run({ check: false });
console.log("[1] stdout:", JSON.stringify(ok.text().trim()), "exit:", ok.exitCode);

// 2. can it escape /workspace and read host files?
const esc = await sandbox.command("python", ["-c",
  "open('/etc/passwd').read()"]).run({ check: false });
console.log("[2] read /etc/passwd -> exit:", esc.exitCode, "| reason:", esc.reason);
console.log("    stderr:", esc.stderr.text().trim().split("\n").pop());

// 3. can it open a socket with network omitted (default-deny)?
const net = await sandbox.command("python", ["-c",
  "import socket;s=socket.create_connection(('1.1.1.1',80),3);print('CONNECTED')"]).run({ check: false });
console.log("[3] outbound socket -> exit:", net.exitCode, "| reason:", net.reason);
console.log("    stderr:", net.stderr.text().trim().split("\n").pop());

// 4. does timeoutMs actually fire on an infinite loop?
const t1 = Date.now();
const spin = await sandbox.command("python", ["-c", "while True: pass"]).run({ check: false, timeoutMs: 1500 });
console.log(`[4] infinite loop -> reason: ${spin.reason} after ${Date.now()-t1}ms`);

await sandbox.close();
await wasmer.close();
console.log(`[+] total ${Date.now()-t0}ms`);
