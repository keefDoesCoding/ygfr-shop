// Local development server: `npm run dev`, then open http://localhost:3000
// Serves public/ like Vercel does and sends everything else to lib/app.js.
// Without real keys it starts local stand-ins for Redis and Stripe.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { startMockRedis } from "./mock-redis.js";
import { startMockStripe } from "./mock-stripe.js";

// Load .env.local if present (KEY=value lines).
try {
  for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* no .env.local */
}

const PORT = Number(process.env.PORT || 3000);
const APP_URL = `http://localhost:${PORT}`;

if (!process.env.KV_REST_API_URL && !process.env.UPSTASH_REDIS_REST_URL) {
  const r = await startMockRedis({ port: PORT + 79, file: path.resolve(process.env.MOCK_DATA_FILE || "dev/.data/redis.json") });
  process.env.KV_REST_API_URL = r.url;
  process.env.KV_REST_API_TOKEN = r.token;
  console.log(`Using local storage (dev/.data). Set KV_REST_API_URL to use Upstash.`);
}
if (!process.env.STRIPE_SECRET_KEY) {
  process.env.STRIPE_SECRET_KEY = "sk_test_local_mock";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_mock";
  const s = await startMockStripe({ port: PORT + 78, appUrl: APP_URL, webhookSecret: process.env.STRIPE_WEBHOOK_SECRET, secretKey: process.env.STRIPE_SECRET_KEY });
  process.env.STRIPE_API_BASE = s.base;
  console.log(`Using a local mock of Stripe Checkout. Set STRIPE_SECRET_KEY to use real Stripe test mode.`);
}
if (!process.env.ADMIN_PASSWORD) {
  process.env.ADMIN_PASSWORD = "letmein";
  console.log(`Admin password for local dev: letmein`);
}

const { handle } = await import("../lib/app.js");

const TYPES = { ".css": "text/css", ".js": "text/javascript", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff": "font/woff", ".txt": "text/plain", ".ico": "image/x-icon" };
const PUBLIC = path.resolve("public");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, APP_URL);
  const file = path.join(PUBLIC, decodeURIComponent(url.pathname));
  if (file.startsWith(PUBLIC) && url.pathname !== "/" && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    return fs.createReadStream(file).pipe(res);
  }
  const hasBody = !["GET", "HEAD"].includes(req.method);
  const request = new Request(url, {
    method: req.method,
    headers: Object.entries(req.headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]])),
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? "half" : undefined,
  });
  const started = Date.now();
  const response = await handle(request);
  const headers = {};
  response.headers.forEach((v, k) => (headers[k] = v));
  const cookies = response.headers.getSetCookie?.() || [];
  if (cookies.length) headers["set-cookie"] = cookies;
  res.writeHead(response.status, headers);
  if (response.body && req.method !== "HEAD") Readable.fromWeb(response.body).pipe(res);
  else res.end();
  if (process.env.LOG_REQUESTS) console.log(req.method, url.pathname, response.status, `${Date.now() - started}ms`);
});

server.listen(PORT, () => console.log(`Shop running at ${APP_URL}  (admin: ${APP_URL}/admin)`));
