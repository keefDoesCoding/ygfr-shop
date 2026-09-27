// Minimal Stripe client over the REST API (no SDK needed).
import crypto from "node:crypto";

const API_VERSION = "2024-06-20";

function base() {
  return (process.env.STRIPE_API_BASE || "https://api.stripe.com").replace(/\/$/, "");
}

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

// Stripe expects nested form fields: line_items[0][price_data][currency]=nzd
export function encodeForm(obj, prefix = "", out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const k = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) value.forEach((v, i) => (typeof v === "object" ? encodeForm(v, `${k}[${i}]`, out) : out.append(`${k}[${i}]`, String(v))));
    else if (typeof value === "object") encodeForm(value, k, out);
    else out.append(k, String(value));
  }
  return out;
}

async function call(method, path, params) {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "stripe-version": API_VERSION,
      ...(params ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: params ? encodeForm(params).toString() : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Stripe error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function createCheckoutSession(params) {
  return call("POST", "/v1/checkout/sessions", params);
}

export function retrieveCheckoutSession(sessionId) {
  return call("GET", `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

// Verifies the Stripe-Signature header against the raw request body.
export function verifyWebhook(rawBody, header, secret, toleranceSeconds = 300) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    })
  );
  const signatures = header
    .split(",")
    .filter((kv) => kv.trim().startsWith("v1="))
    .map((kv) => kv.trim().slice(3));
  const t = Number(parts.t);
  if (!t || !signatures.length) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest("hex");
  return signatures.some((sig) => {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

export function signPayload(rawBody, secret, t = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest("hex");
  return `t=${t},v1=${sig}`;
}
