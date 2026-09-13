// ── The oracle ──────────────────────────────────────────────────────────
// The LLM DECIDES what to try; this decides whether it WORKED — deterministically,
// from real response signals (no hint markers in the target). That's what makes
// findings trustworthy and is the language judges/ShipReady speak: the agent's
// action is graded against an invariant, not against its own say-so.
//
// judge(persona, req, res) -> { weakness, severity, description } | { weakness:false }

// Must never appear in a client response (planted in TowerBank internals).
const SECRET_FLAG = "TB{r3d_t34m_pwn3d_the_t0wer}";
const SSN = /SSN-\d{3}-\d{2}-\d{4}/;
const SECRETS = /sk_live_|stripe_secret|db_dsn|signing|password"\s*:/i;

export function judge(persona, req, res) {
  const path = String(req.path || "");
  const body = String(res?.body || "");
  const low = body.toLowerCase();
  const status = res?.status || 0;
  const decoded = safeDecode(path);

  // ── strongest signals: they hold no matter which agent triggered them ──

  // A secret the app should never emit came back → disclosure / prompt injection.
  if (body.includes(SECRET_FLAG)) {
    if (/assistant/.test(path)) return w("critical", "prompt injection: leaked the assistant's hidden system prompt + secret flag");
    if (/internal|config/.test(path)) return w("critical", "sensitive info disclosure: internal config + secret key exposed");
    if (/admin/.test(path)) return w("critical", "broken access control: admin panel + secret served without real authz");
    return w("critical", "secret flag exfiltrated from the target");
  }
  // Someone else's PII (SSN) came back where it shouldn't.
  if (SSN.test(body)) {
    if (/\/api\/user/.test(path) && /id=([2-9]\d*)/.test(decoded)) return w("high", "IDOR: read another user's full record (SSN, balance) with no authorization");
    if (/\/admin/.test(path)) return w("critical", "broken access control: admin user dump (SSNs) without authentication");
    if (/\/api\/export/.test(path)) return w("high", "unauthenticated bulk export of customer PII");
    if (/\/api\/search/.test(path)) return w("critical", "SQL injection: query dumped the full user table (SSNs)");
    return w("high", "PII (SSN) exposed in response");
  }
  // Config secrets (keys, DSN) returned.
  if (SECRETS.test(body) && status === 200) return w("critical", "sensitive info disclosure: credentials/keys returned to the client");

  // ── login auth bypass: injection in the request granted a token ──
  if (/\/api\/login/.test(path) && status === 200 && /"token"/.test(low)) {
    const inj = /'|--|\bor\b/i.test(JSON.stringify(req.body || "") + decoded);
    if (inj) return w("critical", "authentication bypass via SQL-injection-shaped login");
  }

  // ── business logic ──
  if (/checkout|transfer/.test(path)) {
    const reqBody = parseBody(req.body);
    const total = num(body, "total");
    if (total != null && total < 0) return w("critical", `negative total ${total} — money flows toward the attacker`);
    if (total != null && total < 90 && /checkout/.test(path)) return w("high", `discount abuse: total dropped to ${total} via stacked coupons`);
    if (/transfer/.test(path) && status === 200) {
      if (Number(reqBody?.amount) < 0) return w("critical", "transfer logic abuse: negative amount reverses the flow (theft)");
      return w("high", "transfer accepted without ownership check on the source account");
    }
  }

  // ── reflected XSS ──
  if (/\/api\/search/.test(path) && /<script>/i.test(body) && /<script>/i.test(decoded))
    return w("medium", "reflected XSS: user input echoed unescaped into HTML");

  // ── recon: reachable sensitive surface (weak signal, low severity) ──
  if (persona === "recon" && status && status !== 404) {
    if (/\/admin|internal|export|\.env|config/.test(path)) return w("medium", `sensitive path reachable: ${path}`);
    return { weakness: false, reachable: true };
  }

  // ── dos single-request hint (the burst is judged by the deterministic persona) ──
  if (persona === "dos" && status === 200 && (res.elapsed_ms || 0) > 200)
    return w("low", `slow, unthrottled endpoint (${res.elapsed_ms}ms)`);

  return { weakness: false };
}

function w(severity, description) { return { weakness: true, severity, description }; }
function num(body, key) { const m = body.match(new RegExp(`"${key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`)); return m ? Number(m[1]) : null; }
function safeDecode(s) { try { return decodeURIComponent(s); } catch { return s; } }
function parseBody(v) { try { return typeof v === "string" ? JSON.parse(v) : (v || {}); } catch { return {}; } }
