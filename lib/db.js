// Data layer. Talks to Redis over the Upstash REST API (what Vercel's
// "Upstash for Redis" integration provides), so no database driver is needed.
import { id, slugify } from "./util.js";
import { SEED_PRODUCTS } from "./seed.js";

function config() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "Storage is not configured. Add the Upstash for Redis integration in Vercel (Storage tab) so KV_REST_API_URL and KV_REST_API_TOKEN are set."
    );
  }
  return { url: url.replace(/\/$/, ""), token };
}

export async function redis(...args) {
  const { url, token } = config();
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || data.error) throw new Error(`Redis ${args[0]} failed: ${data.error || res.status}`);
  return data.result;
}

export async function pipeline(commands) {
  if (!commands.length) return [];
  const { url, token } = config();
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(commands),
  });
  const data = await res.json();
  if (!res.ok || !Array.isArray(data)) throw new Error(`Redis pipeline failed: ${res.status}`);
  return data.map((r) => {
    if (r.error) throw new Error(`Redis pipeline error: ${r.error}`);
    return r.result;
  });
}

function hashToObjects(flat) {
  const out = [];
  for (let i = 0; i < (flat?.length || 0); i += 2) {
    try {
      out.push(JSON.parse(flat[i + 1]));
    } catch {
      /* skip corrupt row */
    }
  }
  return out;
}

// ---------- Products ----------

let productCache = { at: 0, list: null };
const CACHE_MS = 3000;

function invalidate() {
  productCache = { at: 0, list: null };
}

async function ensureSeeded() {
  // First run on an empty store: add the demo catalogue so the shop isn't blank.
  const claimed = await redis("SET", "seeded", "1", "NX");
  if (claimed !== "OK") return;
  const now = Date.now();
  const cmds = [];
  SEED_PRODUCTS.forEach((p, i) => {
    const pid = id("p_");
    const product = normalizeProduct({ ...p, id: pid, createdAt: new Date(now - i * 60000).toISOString() });
    cmds.push(["HSET", "products", pid, JSON.stringify(product)]);
    cmds.push(["HSET", "slugs", product.slug, pid]);
  });
  await pipeline(cmds);
}

export async function listProducts({ includeDrafts = false } = {}) {
  if (!productCache.list || Date.now() - productCache.at > CACHE_MS) {
    let flat = await redis("HGETALL", "products");
    if (!flat || flat.length === 0) {
      await ensureSeeded();
      flat = await redis("HGETALL", "products");
    }
    productCache = { at: Date.now(), list: hashToObjects(flat) };
  }
  const list = productCache.list
    .filter((p) => includeDrafts || p.status === "active")
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return list;
}

export async function getProduct(pid) {
  const rawValue = await redis("HGET", "products", pid);
  return rawValue ? JSON.parse(rawValue) : null;
}

export async function getProductBySlug(slug) {
  const pid = await redis("HGET", "slugs", slug);
  if (!pid) return null;
  return getProduct(pid);
}

export function totalStock(p) {
  return (p.sizes || []).reduce((n, s) => n + Math.max(0, Number(s.stock) || 0), 0);
}

export function normalizeProduct(p) {
  const sizes = (p.sizes || [])
    .map((s) => ({ label: String(s.label || "").trim().slice(0, 24), stock: Math.max(0, parseInt(s.stock, 10) || 0) }))
    .filter((s) => s.label);
  return {
    id: p.id,
    slug: p.slug || slugify(p.title),
    title: String(p.title || "Untitled").trim().slice(0, 120),
    brand: String(p.brand || "").trim().slice(0, 60),
    category: p.category || "tees",
    description: String(p.description || "").trim().slice(0, 4000),
    condition: p.condition || "New",
    price: Math.max(0, parseInt(p.price, 10) || 0),
    compareAt: p.compareAt ? Math.max(0, parseInt(p.compareAt, 10) || 0) : null,
    images: (p.images || []).filter(Boolean).slice(0, 8),
    sizes: sizes.length ? sizes : [{ label: "One size", stock: 1 }],
    status: p.status === "draft" ? "draft" : "active",
    featured: Boolean(p.featured),
    createdAt: p.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function uniqueSlug(base, pid) {
  let slug = slugify(base);
  for (let n = 2; n < 50; n++) {
    const owner = await redis("HGET", "slugs", slug);
    if (!owner || owner === pid) return slug;
    slug = `${slugify(base)}-${n}`;
  }
  return `${slugify(base)}-${id().slice(0, 4)}`;
}

export async function saveProduct(input) {
  const existing = input.id ? await getProduct(input.id) : null;
  const pid = existing?.id || id("p_");
  const slug = await uniqueSlug(input.title, pid);
  const product = normalizeProduct({ ...existing, ...input, id: pid, slug, createdAt: existing?.createdAt });
  const cmds = [["HSET", "products", pid, JSON.stringify(product)], ["HSET", "slugs", slug, pid]];
  if (existing && existing.slug !== slug) cmds.push(["HDEL", "slugs", existing.slug]);
  // Remove uploaded images that were taken off the product.
  for (const img of existing?.images || []) {
    if (!product.images.includes(img) && img.startsWith("img_")) cmds.push(["DEL", `img:${img}`]);
  }
  await pipeline(cmds);
  invalidate();
  return product;
}

export async function deleteProduct(pid) {
  const p = await getProduct(pid);
  if (!p) return;
  const cmds = [["HDEL", "products", pid], ["HDEL", "slugs", p.slug]];
  for (const img of p.images || []) if (img.startsWith("img_")) cmds.push(["DEL", `img:${img}`]);
  await pipeline(cmds);
  invalidate();
}

// ---------- Images (stored in Redis, served through /img/:id with long CDN caching) ----------

export async function saveImage(bytes, type) {
  const imgId = id("img_");
  const b64 = Buffer.from(bytes).toString("base64");
  await redis("SET", `img:${imgId}`, JSON.stringify({ t: type, d: b64 }));
  return imgId;
}

export async function getImage(imgId) {
  const v = await redis("GET", `img:${imgId}`);
  if (!v) return null;
  const { t, d } = JSON.parse(v);
  return { type: t, bytes: Buffer.from(d, "base64") };
}

export function imageUrl(ref) {
  if (!ref) return "/img/placeholder.svg";
  if (ref.startsWith("/") || ref.startsWith("http")) return ref;
  return `/img/${ref}`;
}

// ---------- Orders ----------

export async function saveOrder(order) {
  await redis("HSET", "orders", order.id, JSON.stringify(order));
  return order;
}

export async function getOrder(oid) {
  const v = await redis("HGET", "orders", oid);
  return v ? JSON.parse(v) : null;
}

export async function listOrders() {
  const flat = await redis("HGETALL", "orders");
  return hashToObjects(flat).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

// ---------- Stock holds ----------
// While a customer is on the Stripe payment page, the items in their order are
// held so a one-off piece can't be sold twice. Holds expire with the session.

export async function holdsFor(pids) {
  const unique = [...new Set(pids)];
  const results = await pipeline(unique.map((pid) => ["HGETALL", `holds:${pid}`]));
  const now = Date.now();
  const out = {};
  unique.forEach((pid, i) => {
    const flat = results[i] || [];
    const bySize = {};
    for (let j = 0; j < flat.length; j += 2) {
      const [size] = flat[j].split("|");
      const [qty, exp] = String(flat[j + 1]).split("|").map(Number);
      if (exp > now) bySize[size] = (bySize[size] || 0) + qty;
    }
    out[pid] = bySize;
  });
  return out;
}

export async function placeHolds(order, ttlMs) {
  const exp = Date.now() + ttlMs;
  await pipeline(order.items.map((i) => ["HSET", `holds:${i.productId}`, `${i.size}|${order.id}`, `${i.qty}|${exp}`]));
}

export async function releaseHolds(order) {
  if (!order?.items?.length) return;
  await pipeline(order.items.map((i) => ["HDEL", `holds:${i.productId}`, `${i.size}|${order.id}`]));
}

// Marks an order paid exactly once and takes the sold items out of stock.
export async function finalizeOrder(oid, details) {
  const claimed = await redis("SET", `order-final:${oid}`, "1", "NX");
  if (claimed !== "OK") return { alreadyDone: true, order: await getOrder(oid) };
  const order = await getOrder(oid);
  if (!order) return { order: null };
  const byProduct = {};
  for (const item of order.items) (byProduct[item.productId] ||= []).push(item);
  for (const [pid, items] of Object.entries(byProduct)) {
    const p = await getProduct(pid);
    if (!p) continue;
    for (const item of items) {
      const size = p.sizes.find((s) => s.label === item.size);
      if (size) size.stock = Math.max(0, size.stock - item.qty);
    }
    p.updatedAt = new Date().toISOString();
    await redis("HSET", "products", pid, JSON.stringify(p));
  }
  const updated = { ...order, ...details, status: "paid", paidAt: new Date().toISOString() };
  await saveOrder(updated);
  await releaseHolds(order);
  invalidate();
  return { order: updated };
}

// ---------- Settings ----------

export const DEFAULT_SETTINGS = {
  announcement: "Free NZ shipping on orders over $150",
  shippingCents: 800,
  freeShippingOverCents: 15000,
  contactEmail: "",
  instagram: "",
  tiktok: "",
  shippingPolicy:
    "We ship NZ-wide. Orders are packed and sent within 3 working days, and you'll get tracking by email once your parcel is on its way.\n\nShipping is a flat rate, and free once your order passes the free-shipping amount shown at checkout.",
  returnsPolicy:
    "Most of our pieces are one-offs, so please check sizes and photos before you buy. If something arrives damaged or isn't as described, contact us within 7 days of delivery and we'll sort out a refund or exchange.\n\nThis doesn't affect your rights under the Consumer Guarantees Act.",
};

export async function getSettings() {
  const v = await redis("GET", "settings");
  return { ...DEFAULT_SETTINGS, ...(v ? JSON.parse(v) : {}) };
}

export async function saveSettings(s) {
  const clean = { ...DEFAULT_SETTINGS, ...s };
  await redis("SET", "settings", JSON.stringify(clean));
  return clean;
}

export async function rateLimit(key, limit, windowSeconds) {
  const [count] = await pipeline([
    ["INCR", `rl:${key}`],
    ["EXPIRE", `rl:${key}`, String(windowSeconds), "NX"],
  ]);
  return count <= limit;
}
