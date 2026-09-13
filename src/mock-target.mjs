// ── Mock target ("the Tower") — DEV STAND-IN for Pranay's Wasmer target ──
// An intentionally-vulnerable app so Shresth's swarm produces REAL findings
// before integration. Each vuln maps to one agent persona. When Pranay's
// real Wasmer-sandboxed target is ready, set TARGET_BASE_URL to it and retire
// this. It is authorized-by-construction: you wrote it, you own it, it holds
// only fake data.
//
// Run: npm run target   (listens on :9090)
import { createServer } from "node:http";

const PORT = Number(process.env.TARGET_PORT || 9090);

// fake data only
const USERS = {
  1: { id: 1, name: "you", email: "you@example.invalid", settings: { theme: "dark" } },
  2: { id: 2, name: "someone else", email: "victim@example.invalid", settings: { ssn: "000-00-0000 (FAKE)" } },
};
const COUPONS = { SAVE10: 0.10 };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const send = (code, body, type = "application/json") => {
    res.writeHead(code, { "content-type": type, "access-control-allow-origin": "*" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };

  // recon surface
  if (url.pathname === "/") return send(200, "<h1>TowerBank</h1><!-- TODO: remove /admin before launch -->", "text/html");
  if (url.pathname === "/robots.txt") return send(200, "User-agent: *\nDisallow: /admin\nDisallow: /api/export", "text/plain");

  // auth_bypass: /admin has no auth
  if (url.pathname === "/admin") return send(200, { admin: true, note: "VULN: no authentication on admin panel" });

  // injection: reflects unescaped input
  if (url.pathname === "/api/search") {
    const q = url.searchParams.get("q") ?? "";
    if (/('|--|\bOR\b\s+1=1)/i.test(q)) return send(200, { rows: Object.values(USERS), note: "VULN: SQLi-shaped input returned all rows" });
    return send(200, `<div>results for: ${q}</div>`, "text/html"); // reflected, unescaped
  }

  // auth_bypass / IDOR: no ownership check on user id
  if (url.pathname === "/api/user") {
    const id = url.searchParams.get("id");
    const u = USERS[id];
    if (!u) return send(404, { error: "no such user" });
    return send(200, { ...u, note: id === "2" ? "VULN: IDOR — read another user's record" : undefined });
  }

  // logic_abuse: coupon stacks, negative quantity credits money
  if (url.pathname === "/api/checkout" && req.method === "POST") {
    const b = await body(req);
    const qty = Number(b?.quantity ?? 1);
    const price = 100;
    const codes = Array.isArray(b?.coupons) ? b.coupons : (b?.coupon ? [b.coupon] : []);
    let total = qty * price;
    for (const c of codes) if (COUPONS[c]) total *= (1 - COUPONS[c]); // VULN: stacks
    return send(200, {
      total,
      note: qty < 0 ? "VULN: negative quantity → credit issued"
          : codes.length > 1 ? "VULN: coupons stacked"
          : undefined,
    });
  }

  // dos: no rate limit anywhere; this endpoint is deliberately slow
  if (url.pathname === "/api/report") { await sleep(300); return send(200, { ok: true, note: "VULN: expensive + unthrottled" }); }

  send(404, { error: "not found" });
});

server.listen(PORT, () => console.log(`[mock-target] the Tower is up on http://localhost:${PORT} (intentionally vulnerable, fake data)`));
function body(req) { return new Promise(r => { let b = ""; req.on("data", c => b += c); req.on("end", () => { try { r(JSON.parse(b || "{}")); } catch { r({}); } }); }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
