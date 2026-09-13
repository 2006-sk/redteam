// ── WebSocket client ────────────────────────────────────────────────────
// Connects to the Coordinator (mock or real), reconnects with backoff, and
// hands parsed messages to callbacks. It does NOT assume perfect ordering:
// `tower_health` on every event is authoritative for the health bar, and each
// event is dispatched on its own merits (the scene tolerates a weakness_found
// that arrives without its attack_started).

import { WS_URL } from "../config.js";

export function connectFeed({ onSnapshot, onEvent, onStatus }) {
  let ws = null;
  let closedByUs = false;
  let backoff = 500;
  const maxBackoff = 6000;

  function open() {
    onStatus?.("connecting");
    try {
      ws = new WebSocket(WS_URL);
    } catch (err) {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      backoff = 500;
      onStatus?.("live");
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return; // ignore malformed frames rather than crash the demo
      }
      if (msg.kind === "snapshot") {
        onSnapshot?.(msg);
      } else if (msg.kind === "event") {
        onEvent?.(msg);
      } else if (msg.event_type) {
        // Be liberal: a bare (unwrapped) event still animates.
        onEvent?.(msg);
      }
    };

    ws.onclose = () => {
      if (!closedByUs) {
        onStatus?.("down");
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      try { ws.close(); } catch {}
    };
  }

  function scheduleReconnect() {
    setTimeout(open, backoff);
    backoff = Math.min(maxBackoff, backoff * 1.7);
  }

  open();

  return {
    get url() { return WS_URL; },
    close() {
      closedByUs = true;
      try { ws?.close(); } catch {}
    },
  };
}
