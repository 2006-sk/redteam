// ── Tenki driver ────────────────────────────────────────────────────────
// One Tenki Sandbox VM per agent — the judged Tenki integration. All Tenki
// calls live behind this interface so the agents never change:
//
//   const vm = await driver.createVM(agentId)      // boot a disposable Linux VM
//   const r  = await driver.runAttack(vm, req)      // EXECUTE the attack ON the VM
//   await driver.destroyVM(vm)                      // tear it down (ephemeral)
//
// `runAttack(vm, {method, path, headers, body})` performs an HTTP request to
// the target FROM the VM and returns {status, body, elapsed_ms, from}. This is
// the "execution genuinely happens on the Tenki VM" requirement — the payload
// is issued by python running inside the VM, not by this local process.
//
// TENKI_MODE=mock  (default) → MockTenkiDriver, runs today with zero deps.
// TENKI_MODE=real            → RealTenkiDriver, drives the `tenki` CLI.
//
// ⚠️ The real path calls a live product whose exact CLI/SDK shape you MUST
//    confirm against current docs (README says so). Every live call below is
//    marked `// VERIFY`. Do the 3-command sanity check in the README first.
// Read lazily (at call time), not at import — env is often set after imports.
const targetBaseUrl = () => process.env.TARGET_BASE_URL || "http://localhost:9090";

export function getTenkiDriver() {
  const mode = (process.env.TENKI_MODE || "mock").toLowerCase();
  return mode === "real" ? new RealTenkiDriver() : new MockTenkiDriver();
}

// ── MOCK ────────────────────────────────────────────────────────────────
// No Tenki, no VM. The attack is issued locally via fetch so the swarm still
// produces REAL results against the (mock) target. Lets the whole system run
// before you have a Tenki key or Bash.
export class MockTenkiDriver {
  constructor() { this.mode = "mock"; }
  async createVM(agentId) {
    await sleep(150 + Math.random() * 200); // pretend a ~sub-2s boot
    return { id: `mock-vm-${agentId}`, agentId, booted_at: Date.now() };
  }
  async runAttack(vm, req) {
    const t = Date.now();
    try {
      const res = await fetch(targetBaseUrl() + req.path, {
        method: req.method || "GET",
        headers: req.headers || {},
        body: req.body,
        signal: AbortSignal.timeout(req.timeoutMs || 5000),
      });
      const body = await res.text();
      return { status: res.status, body, elapsed_ms: Date.now() - t, from: vm.id };
    } catch (e) {
      return { status: 0, body: "", error: String(e), elapsed_ms: Date.now() - t, from: vm.id };
    }
  }
  async destroyVM() { /* nothing to tear down */ }
}

// ── REAL ────────────────────────────────────────────────────────────────
// Boots one Tenki Sandbox VM per agent via the official @tenkicloud/sandbox
// SDK, and issues each attack by running a python request script INSIDE the VM
// (the base image ships Python 3.12). Verified against SDK v1.0.6.
//
// The VM needs outbound network to reach the target, so it runs with
// allowOutbound:true — the security story is "blast radius contained in a
// disposable VM," not "air-gapped." sticky:true keeps it from idle-pausing
// mid-judging. Small footprint (1 vCPU / 1 GiB) keeps all 5 under the
// no-card cap (2 vCPU / 4 GiB, 5 concurrent) and boots fast.
export class RealTenkiDriver {
  constructor(opts = {}) {
    this.mode = "real";
    this._client = null;
    this._cpuCores = opts.cpuCores ?? Number(process.env.TENKI_CPU || 1);
    this._memoryMb = opts.memoryMb ?? Number(process.env.TENKI_MEM || 1024);
  }

  async _sdk() {
    if (!this._client) {
      const { TenkiSandbox, stdoutText } = await import("@tenkicloud/sandbox");
      this._stdoutText = stdoutText;
      const authToken = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY;
      this._client = new TenkiSandbox(authToken ? { authToken } : {});
    }
    return this._client;
  }

  async createVM(agentId) {
    const sandbox = await this._sdk();
    // create() waits until RUNNING and data-plane-ready by default. Retry on
    // the concurrent-jobs cap: a sibling VM freeing its slot can lag a moment,
    // so back off and retry rather than dropping an agent.
    const opts = {
      name: `siege-${agentId}`,
      cpuCores: this._cpuCores,
      memoryMb: this._memoryMb,
      allowOutbound: true,   // needs to reach the target over the network
      allowInbound: false,
      sticky: true,          // don't idle-pause during the demo
      metadata: { project: "tower-siege", agent: agentId },
    };
    let lastErr;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const session = await sandbox.create(opts);
        return { id: session.id ?? `siege-${agentId}`, session, agentId, booted_at: Date.now() };
      } catch (e) {
        lastErr = e;
        const capped = /concurrent jobs|resource_exhausted|QuotaExceeded/i.test(String(e?.message || e));
        if (!capped) throw e;
        await sleep(1500 * (attempt + 1)); // 1.5s, 3s, 4.5s, 6s
      }
    }
    throw lastErr;
  }

  async runAttack(vm, req) {
    const t = Date.now();
    const script = pyRequestScript(targetBaseUrl(), req);
    try {
      const res = await vm.session.exec(["python3", "-c", script], { timeoutMs: (req.timeoutMs || 5000) + 3000 });
      const stdout = this._stdoutText(res);
      const parsed = lastJson(stdout);
      if (parsed) return { ...parsed, elapsed_ms: parsed.elapsed_ms ?? (Date.now() - t), from: vm.id };
      return { status: 0, body: stdout, error: "could not parse VM output", elapsed_ms: Date.now() - t, from: vm.id };
    } catch (e) {
      return { status: 0, body: "", error: String(e), elapsed_ms: Date.now() - t, from: vm.id };
    }
  }

  async destroyVM(vm) {
    // A failed create still bills until closed, so always tear down.
    try { await vm.session?.close(); } catch {}
  }
}

// python that runs INSIDE the Tenki VM, hits the target, prints one JSON line.
function pyRequestScript(base, req) {
  const url = JSON.stringify(base + req.path);
  const method = JSON.stringify(req.method || "GET");
  const headers = JSON.stringify(req.headers || {});
  const data = req.body != null ? JSON.stringify(String(req.body)) : "None";
  return [
    "import urllib.request, json, time",
    `u=${url}; m=${method}; h=${headers}; d=${data}`,
    "b = d.encode() if isinstance(d,str) else None",
    "req = urllib.request.Request(u, data=b, method=m, headers=h)",
    "t=time.time()",
    "try:",
    "    r=urllib.request.urlopen(req, timeout=5); body=r.read().decode('utf-8','replace'); status=r.status",
    "except urllib.error.HTTPError as e:",
    "    body=e.read().decode('utf-8','replace'); status=e.code",
    "except Exception as e:",
    "    body=str(e); status=0",
    "print(json.dumps({'status':status,'body':body[:4000],'elapsed_ms':int((time.time()-t)*1000)}))",
  ].join("\n");
}

// ── helpers ───────────────────────────────────────────────────────────────
function lastJson(s) {
  const lines = s.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch {}
  }
  return null;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
