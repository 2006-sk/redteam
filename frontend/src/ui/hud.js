// ── HUD ─────────────────────────────────────────────────────────────────
// All monochrome DOM + two small canvas charts. Fed by the same event stream
// as the 3D scene. Severity reads through weight/brightness, never color.

import { AGENTS, SEVERITY, PERSONA_LABEL } from "../config.js";

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const el = {
    conn: $("conn"), connText: $("conn-text"),
    health: $("health-num"), healthFill: $("health-fill"),
    weak: $("weak-num"), seq: $("seq-num"),
    target: $("target-name"),
    rosterList: $("roster-list"),
    bannerList: $("banner-list"),
    chartHealth: $("chart-health"), chartBreak: $("chart-breakdown"),
    hud: $("hud"),
  };

  // Build roster rows
  const rows = {};
  const weakByAgent = {};
  for (const a of AGENTS) {
    weakByAgent[a.id] = 0;
    const li = document.createElement("li");
    li.className = "agent-row";
    li.innerHTML = `
      <div class="a-name"><span>${a.label}</span><span class="a-count" data-count>·0</span></div>
      <div class="a-state" data-state>IDLE</div>
      <div class="a-target" data-target>${a.tag}</div>`;
    el.rosterList.appendChild(li);
    rows[a.id] = li;
  }

  const healthHistory = [100];
  const breakdown = Object.fromEntries(AGENTS.map((a) => [a.persona, 0]));
  let weakTotal = 0;

  function setConnection(status) {
    const map = {
      connecting: ["conn-down", "CONNECTING"],
      live: ["conn-live", "● LIVE FEED"],
      mock: ["conn-live", "● MOCK FEED"],
      sim: ["conn-live", "● SIM / REHEARSAL"],
      down: ["conn-down", "RECONNECTING…"],
    };
    const [cls, text] = map[status] || map.down;
    el.conn.className = "conn " + cls;
    el.connText.textContent = text;
  }

  function setTarget(name) { el.target.textContent = name; }

  function setHealth(h) {
    h = Math.max(0, Math.min(100, Math.round(h)));
    el.health.textContent = h;
    el.healthFill.style.width = h + "%";
    healthHistory.push(h);
    if (healthHistory.length > 160) healthHistory.shift();
  }

  function seedHealth(values) {
    if (!values?.length) return;
    healthHistory.length = 0;
    for (const v of values) healthHistory.push(Math.max(0, Math.min(100, Math.round(v))));
  }

  function setSeq(n) { if (typeof n === "number") el.seq.textContent = n; }

  function updateAgent(id, stateLabel, target) {
    const li = rows[id];
    if (!li) return;
    li.querySelector("[data-state]").textContent = stateLabel;
    if (target) li.querySelector("[data-target]").textContent = target;
    const active = stateLabel !== "IDLE";
    li.classList.toggle("active", active);
  }

  function countWeakness(evt) {
    weakTotal++;
    el.weak.textContent = weakTotal;
    if (evt.agent_id && weakByAgent[evt.agent_id] != null) {
      weakByAgent[evt.agent_id]++;
      const c = rows[evt.agent_id]?.querySelector("[data-count]");
      if (c) c.textContent = "·" + weakByAgent[evt.agent_id];
    }
    if (evt.agent_persona && breakdown[evt.agent_persona] != null) breakdown[evt.agent_persona]++;
  }

  function pushWeakness(evt) {
    countWeakness(evt);
    const sev = SEVERITY[evt.severity] || SEVERITY.info;
    const li = document.createElement("li");
    li.className = `wk enter sev-${evt.severity}`;
    li.innerHTML = `
      <div class="wk-head">
        <span>${PERSONA_LABEL[evt.agent_persona] || evt.agent_id || "AGENT"} · ${escapeHtml(evt.target_component || "")}</span>
        <span class="wk-sev">${sev.label}</span>
      </div>
      <div class="wk-desc">${escapeHtml(evt.description || "")}</div>`;
    el.bannerList.prepend(li);
    while (el.bannerList.children.length > 6) el.bannerList.lastChild.remove();
    setTimeout(() => li.classList.remove("enter"), 600);
  }

  // ── charts ──
  const hctx = el.chartHealth.getContext("2d");
  const bctx = el.chartBreak.getContext("2d");

  function drawCharts() {
    drawHealth();
    drawBreakdown();
  }

  function drawHealth() {
    const w = el.chartHealth.width, h = el.chartHealth.height;
    hctx.clearRect(0, 0, w, h);
    // baseline grid
    hctx.strokeStyle = "rgba(255,255,255,0.12)";
    hctx.lineWidth = 1;
    hctx.beginPath(); hctx.moveTo(0, h - 1); hctx.lineTo(w, h - 1); hctx.stroke();
    const n = healthHistory.length;
    if (n < 2) return;
    hctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * w;
      const y = h - (healthHistory[i] / 100) * (h - 4) - 2;
      i ? hctx.lineTo(x, y) : hctx.moveTo(x, y);
    }
    hctx.strokeStyle = "#fff";
    hctx.lineWidth = 1.6;
    hctx.shadowColor = "rgba(255,255,255,0.8)";
    hctx.shadowBlur = 6;
    hctx.stroke();
    hctx.shadowBlur = 0;
    // fill under curve
    hctx.lineTo(w, h); hctx.lineTo(0, h); hctx.closePath();
    hctx.fillStyle = "rgba(255,255,255,0.06)";
    hctx.fill();
  }

  function drawBreakdown() {
    const w = el.chartBreak.width, h = el.chartBreak.height;
    bctx.clearRect(0, 0, w, h);
    const keys = AGENTS.map((a) => a.persona);
    const max = Math.max(1, ...keys.map((k) => breakdown[k]));
    const bw = w / keys.length;
    bctx.textAlign = "center";
    bctx.font = "8px monospace";
    keys.forEach((k, i) => {
      const val = breakdown[k];
      const bh = (val / max) * (h - 18);
      const x = i * bw + 6;
      const y = h - 12 - bh;
      bctx.strokeStyle = "rgba(255,255,255,0.5)";
      bctx.fillStyle = "rgba(255,255,255,0.9)";
      bctx.fillRect(x, y, bw - 12, bh);
      bctx.strokeRect(x + 0.5, y + 0.5, bw - 12, bh);
      bctx.fillStyle = "rgba(255,255,255,0.55)";
      bctx.fillText(String(val), x + (bw - 12) / 2, y - 3);
      bctx.fillStyle = "rgba(255,255,255,0.4)";
      bctx.fillText((AGENTS[i].label || k).slice(0, 5), x + (bw - 12) / 2, h - 2);
    });
  }

  let toastTimer = null;
  function toast(msg) {
    let t = document.getElementById("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 1300);
  }

  function toggleHud() { el.hud.classList.toggle("hidden"); }

  function tick() { drawCharts(); }

  return {
    setConnection, setTarget, setHealth, seedHealth, setSeq,
    updateAgent, pushWeakness, countWeakness, toast, toggleHud, tick,
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
