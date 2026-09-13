// ── Coordinator client ──────────────────────────────────────────────────
// How an agent talks to the Coordinator: emit events, read/write shared
// memory. Over HTTP so agents are decoupled from the Coordinator's internals
// and could run in a separate process (or on their own VM) unchanged.
import { makeEvent } from "./contract.mjs";

export class CoordClient {
  constructor(baseUrl = process.env.COORDINATOR_URL || "http://localhost:8080") {
    this.base = baseUrl.replace(/\/$/, "");
  }
  async emit(fields) {
    const evt = makeEvent(fields);
    try {
      await fetch(this.base + "/events", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(evt),
      });
    } catch (e) { console.warn("[coord-client] emit failed:", String(e)); }
    return evt;
  }
  async remember(rec) {
    try {
      const r = await fetch(this.base + "/memory", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(rec),
      });
      return (await r.json()).record;
    } catch (e) { console.warn("[coord-client] remember failed:", String(e)); return null; }
  }
  async briefing(query = {}) {
    try {
      const qs = new URLSearchParams(query).toString();
      const r = await fetch(this.base + "/memory" + (qs ? "?" + qs : ""));
      return await r.json(); // { records, briefing }
    } catch (e) { console.warn("[coord-client] briefing failed:", String(e)); return { records: [], briefing: {} }; }
  }
}
