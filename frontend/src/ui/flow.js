// ── Flow controller ─────────────────────────────────────────────────────
// folder-select → loading (poll backend until Wasmer is ready) → command center.
// Real path talks to the orchestrator (/api/prepare, /api/status, /api/run).
// USE_FALLBACK (or a backend that never comes up) drops to the client-side
// simulator so the command center always fills.
import { API_BASE, USE_FALLBACK } from "../config.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function startFlow({ sim, hud }) {
  const folderScreen = document.getElementById("screen-folder");
  const loadingScreen = document.getElementById("screen-loading");
  const input = document.getElementById("folder-input");
  const runBtn = document.getElementById("folder-run");
  const skipBtn = document.getElementById("folder-skip");
  const nameEl = document.getElementById("folder-name");
  const logEl = document.getElementById("boot-log");
  const titleEl = document.getElementById("loading-title");
  let folder = null;

  input.addEventListener("change", () => {
    const f = input.files && input.files[0];
    folder = f && f.webkitRelativePath ? f.webkitRelativePath.split("/")[0] : "project";
    nameEl.textContent = folder ? `▸ ${folder}  (${input.files.length} files)` : "";
    runBtn.disabled = !folder;
  });
  runBtn.addEventListener("click", () => launch(folder || "project"));
  skipBtn.addEventListener("click", () => launch("demo-target"));

  async function launch(folderName) {
    folderScreen.hidden = true;
    loadingScreen.hidden = false;
    boot(`target: ${folderName}`);

    if (USE_FALLBACK) {
      titleEl.textContent = "Rehearsal mode (no backend)";
      await fakeBoot();
      return enter(true);
    }
    // real backend
    try {
      boot("asking backend to prepare the sandbox…");
      const r = await fetch(`${API_BASE}/api/prepare`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ folder: folderName }),
      });
      const d = await r.json();
      boot(`backend mode: ${d.mode || "?"}`);
      titleEl.textContent = d.mode === "wasmer" ? "Booting TowerBank inside Wasmer…" : "Starting target…";
    } catch (e) {
      boot("backend unreachable — falling back to rehearsal");
      await fakeBoot();
      return enter(true);
    }
    const ready = await pollReady(60000);
    if (!ready) { boot("timed out waiting for sandbox — rehearsal fallback"); await fakeBoot(); return enter(true); }
    boot("sandbox ready ✓  launching the swarm…");
    try { await fetch(`${API_BASE}/api/run`, { method: "POST" }); } catch {}
    await sleep(500);
    enter(false);
  }

  async function pollReady(ms) {
    const end = Date.now() + ms;
    let lastPhase = "";
    while (Date.now() < end) {
      try {
        const r = await fetch(`${API_BASE}/api/status`);
        const s = await r.json();
        if (s.phase && s.phase !== lastPhase) { boot(`phase: ${s.phase}`); lastPhase = s.phase; }
        if (s.ready) return true;
        if (s.phase === "error") return false;
      } catch {}
      await sleep(700);
    }
    return false;
  }

  function enter(fallback) {
    loadingScreen.hidden = true;
    if (fallback) { sim.setHealth(100); sim.start(); hud.setConnection("sim"); }
    // real path: events already flow over the live WS feed → the scene animates
  }

  function boot(t) {
    if (!logEl) return;
    const d = document.createElement("div");
    d.textContent = "› " + t;
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
  }
  async function fakeBoot() {
    for (const s of ["initializing runtime…", "creating WASIX sandbox…", "loading TowerBank…", "sandbox ready ✓"]) {
      boot(s); await sleep(480);
    }
  }
}
