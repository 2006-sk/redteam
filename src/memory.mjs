// ── Shared attack memory ────────────────────────────────────────────────
// Every agent reads this before acting and writes findings back, so a later
// agent builds on an earlier one's partial success instead of re-discovering
// it. This "swarm intelligence" is a real technical differentiator — call it
// out in the demo video.
//
// Lives inside the Coordinator process; agents read/write it over the
// Coordinator's HTTP API (see coordinator.mjs), so there is ONE source of
// truth and no separate Redis to stand up. Swap the backing store here later
// (Redis/Postgres) without changing the agents.
//
// Record shape (from README-shresth-agents.md):
//   { id, agent_id, timestamp, action_taken, target_component, outcome, notes }

export class SharedMemory {
  constructor() {
    this._records = [];
    this._seq = 0;
  }

  /** Append a finding. Returns the stored record (with id + timestamp). */
  write({ agent_id, action_taken, target_component, outcome, notes = "" }) {
    const rec = {
      id: ++this._seq,
      agent_id: agent_id ?? null,
      timestamp: new Date().toISOString(),
      action_taken: String(action_taken ?? ""),
      target_component: String(target_component ?? ""),
      outcome: String(outcome ?? ""),
      notes: String(notes ?? ""),
    };
    this._records.push(rec);
    return rec;
  }

  /** Read findings, optionally filtered. Newest first when `limit` is set. */
  read({ target_component, agent_id, outcome, since_id } = {}) {
    let out = this._records;
    if (since_id != null) out = out.filter(r => r.id > Number(since_id));
    if (target_component) out = out.filter(r => r.target_component === target_component);
    if (agent_id) out = out.filter(r => r.agent_id === agent_id);
    if (outcome) out = out.filter(r => r.outcome === outcome);
    return out;
  }

  /** A compact briefing another agent can reason over: what's known so far. */
  briefing() {
    const byComponent = {};
    for (const r of this._records) {
      (byComponent[r.target_component] ||= []).push({ agent: r.agent_id, outcome: r.outcome, notes: r.notes });
    }
    return {
      total_findings: this._records.length,
      components_touched: Object.keys(byComponent),
      by_component: byComponent,
      confirmed_weaknesses: this._records.filter(r => r.outcome === "success").length,
    };
  }

  all() { return this._records.slice(); }
  clear() { this._records = []; this._seq = 0; }
}
