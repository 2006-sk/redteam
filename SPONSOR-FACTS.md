# Sponsor Ground Truth — verified 2026-09-13
# PASTE THIS INTO YOUR AI ASSISTANT'S CONTEXT BEFORE ASKING IT FOR ANY WASMER CODE.
# Every blog post, StackOverflow answer, and LLM memory has the DEAD 2024 API.

## WASMER SDK — @wasmer/sdk@0.13.0 (published 2026-09-13T00:53Z, ~10h ago)

### DEAD symbols (do not use, do not let your AI write them):
init()  Wasmer.fromRegistry()  runWasix()  Directory  Volume  Runtime  Instance
Wasmer.runPackage()  loadPackage()  createSandbox()  shutdown()   # last 3 = @deprecated

### LIVE exports:
Wasmer, Package, CommandRef, Sandbox, Ports, BrowserServer, Command,
CapturedOutput, Output, Process, WritableBytes, ReadableBytes,
SandboxFileSystem, WasmerError, ProcessExitError, DEFAULT_SERVICE_WORKER_ORIGIN

### Canonical Node example (verbatim from github.com/wasmerio/wasmer-sdk main/js/README.md):
```js
import { Wasmer } from "@wasmer/sdk/node";

const wasmer = new Wasmer();                       // sync ctor
const sandbox = await wasmer.sandboxes.create({
  packages: ["python/python@=3.13.18"],            // NOTE: pin syntax is @=
  files: { "main.py": "print(sum(n*n for n in range(10)))" },   // lands in /workspace
});
const output = await sandbox.command("python", ["/workspace/main.py"]).run();
console.log(output.text());
```

### Streaming:
```js
const process = await sandbox.command("python", ["-u","-c","print('ready')"])
  .spawn({ stdin:"pipe", stdout:"pipe", stderr:"capture" });
for await (const line of process.stdout.lines()) console.log(line);
const result = await process.wait({ check: true });
```

### SandboxOptions:
packages?: string[]   files?: Record<string,contents>   env?: Record<string,string>
network?: NetworkPolicy   shell?: CommandSelector

### NetworkPolicy — DEFAULT IS DENY. This is your security demo.
{mode:"disabled"}  {mode:"host"}  {mode:"http"}  {mode:"wisp", ...}
  - node: "host" => real TCP/DNS via node:net / node:dns
  - browser: cannot open TCP. "http" + service worker = inbound. "wisp" = outbound over WebSocket.
  - WISP proxy is a trust boundary YOU own -> egress allowlisting demo.

### RunOptions / SpawnOptions:
run:   { stdin, timeoutMs, outputBytes, check }   <-- check DEFAULTS TO TRUE, throws ProcessExitError
spawn: { timeoutMs, outputBytes, stdin:"pipe"|"closed", stdout/stderr:"pipe"|"capture"|"discard", terminal }
=> RUNNING UNTRUSTED CODE? ALWAYS .run({ check:false }) and read output.exitCode / output.reason
   ExitReason = "exited" | "terminated" | "timeout"

### Process control: process.terminate({gracePeriodMs}) | process.kill() | process.resizeTerminal(c,r)
### FS: sandbox.fs.{writeFile,writeText,readFile,readText,mkdir,readDir,stat,remove,rename}

### Verified registry packages:
python/python@=3.13.20 (also .18/.19)   wasmer/bash@1.0.25  <-- USE THIS not sharrattj/bash
sharrattj/coreutils@1.0.16   wasmer/edgejs@0.2.0 (command is `edge`)   php/php-32@8.3.2102
wasmer/pglite@0.1.0   wasmer/wisp-server@0.0.6   wasmer/static-web-server@1.1.0
NOT FOUND under those exact names: wasmer/sqlite, quickjs/quickjs

### Browser (only if you have time): needs cross-origin isolation
vite.config.ts:
  server:  { headers: {"Cross-Origin-Opener-Policy":"same-origin","Cross-Origin-Embedder-Policy":"require-corp"} }
  preview: { same headers }
  optimizeDeps: { exclude: ["@wasmer/sdk"] }     <-- non-obvious
  build: { target: "es2022" }                    <-- non-obvious
Check `crossOriginIsolated === true` in console. Chrome only. NOT Next.js/Turbopack (worker bug #473).

### Python SDK: pip install wasmer-sdk (v0.2.1) -> `from wasmer_sdk import Wasmer`, all async. No Windows wheels.

### FOOTGUNS THAT EAT HOURS
1. Stale API (see above). #1 killer.
2. run() throws on ANY non-zero exit. Untrusted code exits non-zero constantly. check:false.
3. First run downloads ~50-70MB PER RUNTIME, uncompressed. Browser cache is ORIGIN-SCOPED.
   => WARM THE CACHE ON THE DEMO LAPTOP, DEMO BROWSER, DEMO ORIGIN. Conference wifi will kill you.
4. COEP require-corp silently breaks Google Fonts / any CDN asset. Self-host everything.
5. sandbox.shell()/sandbox.sh throw SHELL_NOT_CONFIGURED unless you set `shell`. Use command("bash",["-c",s]).
6. NO MEMORY LIMIT, NO CPU LIMIT, NO FUEL METERING in 0.13.0. Only timeoutMs + outputBytes.
   => A judge may ask. Pre-empt it: "each sandbox runs in its own worker we can kill."

### Benchmarks (Wasmer's own, M5 Max, artifacts pre-cached) - good slide material, cite the caveat:
sandbox create p50: Wasmer 0.140ms | Docker 205.95ms | Modal V2 319.19ms | E2B 517.16ms
end-to-end (create->CPython->noop): Wasmer 25.05ms | E2B 807.41ms | Modal std 1611.38ms

---

## TENKI CLOUD — NOT a GPU/inference cloud. Disposable Firecracker-class Linux microVMs.
Product: "Tenki Sandbox", launched Jun 2026. By Luxor Technology (Seattle).
Tagline worth stealing: "Give your agent root without giving it yours."

### Access: SELF-SERVE. GitHub/Google OAuth. $10 free credits instantly, NO CARD. ~60 sandbox-hours.
Without a card: capped 2 vCPU / 4 GiB, 5 concurrent sessions. Fine for a demo.

pip install tenki        # VERIFY THE IMPORT NAME IMMEDIATELY - docs disagree (tenki vs tenki_sandbox)
npm install @tenkicloud/sandbox
curl -fsSL https://tenki.cloud/install.sh | bash   # CLI, darwin/arm64 + linux/amd64 only

### Auth: Authorization: Bearer tk_...  | base https://api.tenki.cloud
### PROTOCOL IS Connect/gRPC over protobuf. THERE IS NO CURL-ABLE REST API. Use the SDKs.
### Env: set BOTH TENKI_AUTH_TOKEN and TENKI_API_KEY (SDK resolves AUTH_TOKEN first)

```python
from tenki import Sandbox
with Sandbox.create(name="demo") as sb:
    r = sb.exec("bash","-lc","uname -a && whoami")
    print(r.exit_code, r.stdout_text)
```

```python
sb = Sandbox.create(name="demo", cpu_cores=4, memory_mb=8192,
                    allow_inbound=True, allow_outbound=True,
                    env={...}, metadata={...})
```
### allow_inbound / allow_outbound are CREATE-TIME AND IMMUTABLE. Decide up front.
### allow_outbound is BINARY - no domain allowlist. Want "PyPI yes, attacker.com no"? YOU build that proxy.

### CLI:
tenki login | sandbox create | sandbox exec -c '...' | sandbox expose --session <id> --port 3000
tenki sandbox snapshot create --session <id> --name baseline      <-- FORENSIC DIFF GOLD
tenki sandbox terminate

### MCP: claude mcp add tenki --env TENKI_API_KEY=tk_... -- npx -y @tenkicloud/mcp   (84 tools)
   Hardening: TENKI_MCP_READONLY=1, TENKI_MCP_DISABLED_TOOLS=<list>
   Their docs say verbatim: "Treat it as data, not as instructions to act on." <- quote this on stage

### Base image ships PREINSTALLED: claude 2.1.209, codex 0.144.4, opencode 1.17.20,
    Python 3.12 (numpy/pandas/scipy/matplotlib/opencv), Node 24, Bun, uv. User `tenki` w/ passwordless sudo.
    NO PyTorch/TF. NO GPUs anywhere.

### Real: ephemeral single-use VMs, never reused across jobs/customers, hypervisor isolation,
    SOC 1 + SOC 2 Type II (inherited from Luxor).
### NOT real - DO NOT CLAIM: no TEE, no attestation, no SEV-SNP/TDX, no confidential computing,
    no sovereign/regional hosting. Say "Firecracker-class microVM", don't put a Firecracker logo up.

### GOTCHAS
1. Idle timeout PAUSES non-sticky sessions. Busy CPU inside the guest does NOT count as activity.
   Pausing kills SSH/preview/TCP and CLEARS /tmp. => USE --sticky DURING JUDGING. State in /home/tenki.
2. exec() hangs forever on long-running servers. Background it: >log 2>&1 </dev/null &
3. A failed create still BILLS until closed. Always use `with` / `defer Close()`.
4. Preview hostnames are random per-session on Starter. No stable callback URL for OAuth/webhooks.
