// Request router. Takes a Web Request, returns a Web Response.
// Runs as a Vercel Function (api/index.js) and in local dev (dev/server.js).
import * as db from "./db.js";
import * as stripe from "./stripe.js";
import * as auth from "./auth.js";
import { html, json, redirect, readForm, parseMoneyToCents, id, CATEGORIES, CONDITIONS } from "./util.js";
import { notFound } from "./views/layout.js";
import * as store from "./views/store.js";
import * as admin from "./views/admin.js";

const HOLD_MS = 45 * 60 * 1000; // matches the Stripe session lifetime below
const MAX_QTY = 10;

function htmlResponse(body, { status = 200, cache = "no-store", headers = {} } = {}) {
  return new Response(String(body), {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": cache,
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      ...headers,
    },
  });
}

// Short CDN cache for storefront pages so a busy drop doesn't hammer storage.
const PUBLIC_CACHE = "public, max-age=0, s-maxage=15, stale-while-revalidate=60";

function origin(request) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const u = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") || u.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || u.host;
  return `${proto}://${host}`;
}

function routePath(request) {
  const u = new URL(request.url);
  const p = u.searchParams.get("__p");
  return p !== null ? "/" + p.replace(/^\/+/, "") : u.pathname;
}

export async function handle(request) {
  try {
    return await route(request);
  } catch (err) {
    console.error(err);
    const isStorage = /Storage is not configured/.test(err.message);
    if (routePath(request).startsWith("/api/")) {
      return json({ error: isStorage ? "The shop isn't connected to storage yet." : "Something went wrong. Please try again." }, { status: 500 });
    }
    return htmlResponse(
      html`<!doctype html><html lang="en-NZ"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Back soon</title><link rel="stylesheet" href="/css/site.css?v=3"></head>
<body><main class="container narrow empty-page"><h1 class="display-md">${isStorage ? "Setting up shop" : "Something went wrong"}</h1><p class="lede">${isStorage ? "The shop is being set up. Check back soon." : "Please refresh the page or try again in a minute."}</p>${isStorage ? html`<p class="muted small">Owner: connect Upstash for Redis in your Vercel project's Storage tab, then redeploy.</p>` : ""}</main></body></html>`,
      { status: isStorage ? 503 : 500 }
    );
  }
}

async function route(request) {
  const method = request.method.toUpperCase();
  const path = routePath(request).replace(/\/+$/, "") || "/";
  const url = new URL(request.url);
  let m;

  // ---------- Storefront ----------
  if (method === "GET" || method === "HEAD") {
    if (path === "/") {
      const [products, settings] = await Promise.all([db.listProducts(), db.getSettings()]);
      return htmlResponse(store.homePage({ products, settings }), { cache: PUBLIC_CACHE });
    }
    if (path === "/shop") {
      const [products, settings] = await Promise.all([db.listProducts(), db.getSettings()]);
      const category = CATEGORIES.some((c) => c.slug === url.searchParams.get("category")) ? url.searchParams.get("category") : "";
      const sort = ["new", "price-asc", "price-desc"].includes(url.searchParams.get("sort")) ? url.searchParams.get("sort") : "new";
      return htmlResponse(store.shopPage({ products, settings, category, sort }), { cache: PUBLIC_CACHE });
    }
    if ((m = path.match(/^\/p\/([a-z0-9-]+)$/))) {
      const [product, settings] = await Promise.all([db.getProductBySlug(m[1]), db.getSettings()]);
      if (!product || product.status !== "active") return htmlResponse(notFound(settings), { status: 404 });
      const all = await db.listProducts();
      const related = all.filter((p) => p.id !== product.id && p.category === product.category && db.totalStock(p) > 0).slice(0, 4);
      if (related.length < 4) related.push(...all.filter((p) => p.id !== product.id && !related.includes(p) && db.totalStock(p) > 0).slice(0, 4 - related.length));
      return htmlResponse(store.productPage({ product, related, settings }), { cache: PUBLIC_CACHE });
    }
    if (path === "/help") {
      return htmlResponse(store.helpPage({ settings: await db.getSettings() }), { cache: PUBLIC_CACHE });
    }
    if (path === "/checkout/success") return checkoutSuccess(request, url);
    if ((m = path.match(/^\/img\/(img_[a-z0-9]+)$/))) {
      const img = await db.getImage(m[1]);
      if (!img) return new Response("Not found", { status: 404 });
      return new Response(img.bytes, {
        headers: { "content-type": img.type, "cache-control": "public, max-age=31536000, s-maxage=31536000, immutable" },
      });
    }
    if (path === "/robots.txt") {
      return new Response(`User-agent: *\nDisallow: /admin\nDisallow: /api/\nSitemap: ${origin(request)}/sitemap.xml\n`, { headers: { "content-type": "text/plain" } });
    }
    if (path === "/sitemap.xml") {
      const products = await db.listProducts();
      const o = origin(request);
      const urls = ["/", "/shop", "/help", ...products.map((p) => `/p/${p.slug}`)];
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${o}${u}</loc></url>`).join("")}</urlset>`;
      return new Response(xml, { headers: { "content-type": "application/xml", "cache-control": PUBLIC_CACHE } });
    }
  }

  // ---------- Storefront API ----------
  if (method === "POST" && path === "/api/cart") {
    const body = await request.json().catch(() => ({}));
    const result = await validateCart(body.items);
    const settings = await db.getSettings();
    return json({ ...result, shipping: shippingFor(result.subtotal, settings), freeOver: settings.freeShippingOverCents, shippingFlat: settings.shippingCents });
  }
  if (method === "POST" && path === "/api/checkout") return createCheckout(request);
  if (method === "POST" && path === "/api/stripe/webhook") return stripeWebhook(request);

  // ---------- Admin ----------
  if (path === "/admin" || path.startsWith("/admin/") || path.startsWith("/api/admin/")) return adminRoute(request, method, path);

  const settings = await db.getSettings().catch(() => db.DEFAULT_SETTINGS);
  return htmlResponse(notFound(settings), { status: 404 });
}

// ---------- Cart & checkout ----------

function shippingFor(subtotal, settings) {
  if (!subtotal) return 0;
  if (settings.freeShippingOverCents && subtotal >= settings.freeShippingOverCents) return 0;
  return settings.shippingCents;
}

async function validateCart(items) {
  const input = Array.isArray(items) ? items.slice(0, 50) : [];
  const products = await db.listProducts();
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  const holds = input.length ? await db.holdsFor(input.map((i) => i.id).filter((pid) => byId[pid])) : {};
  const lines = [];
  let subtotal = 0;
  let ok = true;
  for (const item of input) {
    const p = byId[item.id];
    const qty = Math.max(1, Math.min(MAX_QTY, parseInt(item.qty, 10) || 1));
    if (!p) {
      lines.push({ id: item.id, size: item.size, qty, gone: true, warn: "No longer available" });
      ok = false;
      continue;
    }
    const size = p.sizes.find((s) => s.label === item.size);
    const held = holds[p.id]?.[item.size] || 0;
    const available = size ? Math.max(0, size.stock - held) : 0;
    const line = {
      id: p.id,
      slug: p.slug,
      title: p.title,
      size: item.size,
      qty,
      price: p.price,
      image: db.imageUrl(p.images[0]),
      available,
    };
    if (!size || available === 0) {
      line.warn = size && size.stock > 0 ? "Someone is checking out with the last one" : "Sold out";
      ok = false;
    } else if (qty > available) {
      line.warn = `Only ${available} available`;
      ok = false;
    } else {
      subtotal += p.price * qty;
    }
    lines.push(line);
  }
  return { lines, subtotal, ok };
}

async function createCheckout(request) {
  if (!stripe.stripeConfigured()) {
    return json({ error: "Payments aren't switched on yet. Please check back soon." }, { status: 503 });
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (!(await db.rateLimit(`checkout:${ip}`, 20, 600))) return json({ error: "Too many attempts. Please wait a few minutes." }, { status: 429 });

  const body = await request.json().catch(() => ({}));
  const { lines, subtotal, ok } = await validateCart(body.items);
  if (!lines.length) return json({ error: "Your bag is empty." }, { status: 400 });
  if (!ok) return json({ error: "Some items in your bag changed. Please review your bag.", lines }, { status: 409 });

  const settings = await db.getSettings();
  const shipping = shippingFor(subtotal, settings);
  const o = origin(request);
  const order = {
    id: id("ord_"),
    status: "pending",
    createdAt: new Date().toISOString(),
    items: lines.map((l) => ({ productId: l.id, title: l.title, size: l.size, qty: l.qty, price: l.price, image: l.image })),
    subtotalCents: subtotal,
    shippingCents: shipping,
    totalCents: subtotal + shipping,
  };
  await db.saveOrder(order);
  await db.placeHolds(order, HOLD_MS);

  const absolute = (src) => (src.startsWith("http") ? src : `${o}${src}`);
  try {
    const session = await stripe.createCheckoutSession({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lines.map((l) => ({
        quantity: l.qty,
        price_data: {
          currency: "nzd",
          unit_amount: l.price,
          product_data: {
            name: `${l.title} (${l.size})`,
            ...(o.startsWith("https://") ? { images: [absolute(l.image)] } : {}),
          },
        },
      })),
      shipping_address_collection: { allowed_countries: ["NZ"] },
      shipping_options: [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            display_name: shipping === 0 ? "Free NZ shipping" : "NZ shipping",
            fixed_amount: { amount: shipping, currency: "nzd" },
          },
        },
      ],
      phone_number_collection: { enabled: true },
      client_reference_id: order.id,
      metadata: { order_id: order.id },
      payment_intent_data: { metadata: { order_id: order.id } },
      success_url: `${o}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${o}/shop?bag=open`,
      expires_at: Math.floor((Date.now() + HOLD_MS) / 1000),
    });
    await db.saveOrder({ ...order, stripeSessionId: session.id });
    return json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout failed", err.message);
    await db.releaseHolds(order);
    await db.saveOrder({ ...order, status: "failed", error: err.message });
    return json({ error: "We couldn't start checkout. Please try again in a moment." }, { status: 502 });
  }
}

function detailsFromSession(s) {
  const shipping = s.shipping_details || s.collected_information?.shipping_details || null;
  return {
    email: s.customer_details?.email || "",
    customerName: s.customer_details?.name || shipping?.name || "",
    phone: s.customer_details?.phone || "",
    shipping,
    stripeSessionId: s.id,
    paymentIntent: typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id || "",
    totalCents: s.amount_total ?? undefined,
  };
}

async function checkoutSuccess(request, url) {
  const settings = await db.getSettings();
  const sessionId = url.searchParams.get("session_id") || "";
  let order = null;
  let paid = false;
  if (sessionId && stripe.stripeConfigured()) {
    try {
      const s = await stripe.retrieveCheckoutSession(sessionId);
      const oid = s.metadata?.order_id || s.client_reference_id;
      if (oid) {
        if (s.payment_status === "paid") {
          // The webhook normally does this first; finishing here too covers a slow webhook.
          const r = await db.finalizeOrder(oid, detailsFromSession(s));
          order = r.order;
          paid = true;
        } else {
          order = await db.getOrder(oid);
        }
      }
    } catch (err) {
      console.error("Could not load session", err.message);
    }
  }
  return htmlResponse(store.successPage({ settings, order, paid }));
}

async function stripeWebhook(request) {
  const rawBody = await request.text();
  const ok = stripe.verifyWebhook(rawBody, request.headers.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return json({ error: "Invalid signature" }, { status: 400 });
  const event = JSON.parse(rawBody);
  const s = event.data?.object || {};
  const oid = s.metadata?.order_id || s.client_reference_id;
  if (!oid) return json({ received: true });
  if ((event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") && s.payment_status === "paid") {
    await db.finalizeOrder(oid, detailsFromSession(s));
  } else if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
    const order = await db.getOrder(oid);
    if (order && order.status === "pending") {
      await db.releaseHolds(order);
      await db.saveOrder({ ...order, status: event.type.endsWith("expired") ? "expired" : "failed" });
    }
  }
  return json({ received: true });
}

// ---------- Admin ----------

function missingConfig() {
  const missing = [];
  if (!process.env.ADMIN_PASSWORD) missing.push({ name: "ADMIN_PASSWORD", help: "the password you'll use to sign in here." });
  if (!(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL))
    missing.push({ name: "KV_REST_API_URL / KV_REST_API_TOKEN", help: "added automatically when you connect Upstash for Redis in the Storage tab." });
  return missing;
}

async function adminRoute(request, method, path) {
  let m;
  const missing = missingConfig();
  if (missing.length) return htmlResponse(admin.setupNeeded({ missing }), { status: 503 });
  if (method === "POST" && !auth.sameOrigin(request)) return new Response("Forbidden", { status: 403 });

  if (path === "/admin/login") {
    if (method === "POST") {
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
      if (!(await db.rateLimit(`login:${ip}`, 10, 900))) return htmlResponse(admin.loginPage({ error: "Too many attempts. Wait 15 minutes and try again." }), { status: 429 });
      const form = await readForm(request);
      if (auth.checkPassword(form.password)) return redirect("/admin", 303, { "set-cookie": auth.loginCookie(request) });
      return htmlResponse(admin.loginPage({ error: "That password isn't right. Check it and try again." }), { status: 401 });
    }
    if (auth.isAdmin(request)) return redirect("/admin");
    return htmlResponse(admin.loginPage());
  }
  if (!auth.isAdmin(request)) {
    if (path.startsWith("/api/")) return json({ error: "Please sign in again." }, { status: 401 });
    return redirect("/admin/login");
  }
  if (path === "/admin/logout" && method === "POST") return redirect("/admin/login", 303, { "set-cookie": auth.logoutCookie(request) });

  const url = new URL(request.url);
  const flash = { saved: "Saved.", added: "Product added.", deleted: "Product deleted.", settings: "Settings saved." }[url.searchParams.get("done")] || "";

  if (path === "/admin" && method === "GET") {
    const [products, orders] = await Promise.all([db.listProducts({ includeDrafts: true }), db.listOrders()]);
    return htmlResponse(admin.productsList({ products, orders, flash }));
  }

  if (path === "/api/admin/images" && method === "POST") {
    const type = (request.headers.get("content-type") || "").split(";")[0];
    if (!["image/webp", "image/jpeg", "image/png"].includes(type)) return json({ error: "Upload a JPG, PNG or WebP image." }, { status: 415 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > 3 * 1024 * 1024) return json({ error: "That image is too large. Try a smaller photo." }, { status: 413 });
    if (bytes.length < 100) return json({ error: "That file looks empty." }, { status: 400 });
    const imgId = await db.saveImage(bytes, type);
    return json({ id: imgId, url: db.imageUrl(imgId) });
  }

  if (path === "/admin/products/new") {
    if (method === "GET") return htmlResponse(admin.productForm({ product: null }));
    const form = await readForm(request);
    const { product, error } = productFromForm(form);
    if (error) return htmlResponse(admin.productForm({ product, error }), { status: 422 });
    await db.saveProduct(product);
    return redirect("/admin?done=added");
  }

  if ((m = path.match(/^\/admin\/products\/(p_[a-z0-9]+)(\/delete)?$/))) {
    const existing = await db.getProduct(m[1]);
    if (!existing) return redirect("/admin");
    if (m[2] && method === "POST") {
      await db.deleteProduct(existing.id);
      return redirect("/admin?done=deleted");
    }
    if (method === "GET") return htmlResponse(admin.productForm({ product: existing }));
    const form = await readForm(request);
    const { product, error } = productFromForm(form, existing);
    if (error) return htmlResponse(admin.productForm({ product, error }), { status: 422 });
    await db.saveProduct(product);
    return redirect("/admin?done=saved");
  }

  if (path === "/admin/orders" && method === "GET") {
    return htmlResponse(admin.ordersPage({ orders: await db.listOrders(), flash }));
  }
  if ((m = path.match(/^\/admin\/orders\/(ord_[a-z0-9]+)\/ship$/)) && method === "POST") {
    const order = await db.getOrder(m[1]);
    if (order) {
      const form = await readForm(request);
      await db.saveOrder({ ...order, shippedAt: form.shipped === "1" ? new Date().toISOString() : null });
    }
    return redirect("/admin/orders?done=saved");
  }

  if (path === "/admin/settings") {
    if (method === "GET") return htmlResponse(admin.settingsPage({ settings: await db.getSettings(), flash }));
    const f = await readForm(request);
    await db.saveSettings({
      announcement: String(f.announcement || "").slice(0, 120),
      shippingCents: parseMoneyToCents(f.shipping) ?? db.DEFAULT_SETTINGS.shippingCents,
      freeShippingOverCents: parseMoneyToCents(f.freeOver) ?? 0,
      contactEmail: String(f.contactEmail || "").trim().slice(0, 120),
      instagram: String(f.instagram || "").trim().replace(/^@/, "").replace(/[^a-zA-Z0-9._]/g, "").slice(0, 40),
      tiktok: String(f.tiktok || "").trim().replace(/^@/, "").replace(/[^a-zA-Z0-9._]/g, "").slice(0, 40),
      shippingPolicy: String(f.shippingPolicy || "").slice(0, 4000),
      returnsPolicy: String(f.returnsPolicy || "").slice(0, 4000),
    });
    return redirect("/admin/settings?done=settings");
  }

  return redirect("/admin");
}

function productFromForm(f, existing = null) {
  const labels = [].concat(f.sizeLabel || []);
  const stocks = [].concat(f.sizeStock || []);
  const sizes = labels.map((label, i) => ({ label: String(label).trim(), stock: parseInt(stocks[i], 10) || 0 })).filter((s) => s.label);
  const images = String(f.images || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^img_[a-z0-9]+$/.test(s) || /^\/seed\/[a-z0-9-]+\.webp$/.test(s));
  const price = parseMoneyToCents(f.price);
  const compareAt = f.compareAt ? parseMoneyToCents(f.compareAt) : null;
  const product = {
    ...(existing || {}),
    title: String(f.title || "").trim(),
    brand: String(f.brand || "").trim(),
    category: CATEGORIES.some((c) => c.slug === f.category) ? f.category : "tees",
    condition: CONDITIONS.includes(f.condition) ? f.condition : "New",
    description: String(f.description || ""),
    price: price ?? 0,
    compareAt,
    images,
    sizes: sizes.length ? sizes : [{ label: "One size", stock: 1 }],
    status: f.status === "draft" ? "draft" : "active",
  };
  let error = "";
  if (!product.title) error = "Add a title so customers know what it is.";
  else if (price === null || price < 50) error = "Add a price of at least $0.50 (Stripe's minimum).";
  else if (!images.length && product.status === "active") error = "Add at least one photo before making this product live, or save it as a draft.";
  return { product, error };
}
