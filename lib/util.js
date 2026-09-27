// Small helpers shared by the server: HTML templating, money, ids, forms.

class SafeHtml {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

export function raw(value) {
  return new SafeHtml(String(value ?? ""));
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderValue(value) {
  if (value === null || value === undefined || value === false) return "";
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join("");
  return escapeHtml(value);
}

// Tagged template: interpolations are escaped unless wrapped with raw() or produced by html``.
export function html(strings, ...values) {
  let out = "";
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += renderValue(values[i]);
  });
  return new SafeHtml(out);
}

const nzd = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" });
export function money(cents) {
  return nzd.format((Number(cents) || 0) / 100);
}

export function parseMoneyToCents(input) {
  const n = Number(String(input ?? "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function id(prefix = "") {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const s = Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 14);
  return prefix + s;
}

export function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "item";
}

export async function readForm(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) return await request.json();
  const text = await request.text();
  const params = new URLSearchParams(text);
  const out = {};
  for (const [k, v] of params) {
    if (k.endsWith("[]")) (out[k.slice(0, -2)] ||= []).push(v);
    else out[k] = v;
  }
  return out;
}

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(init.headers || {}) },
  });
}

export function redirect(location, status = 303, headers = {}) {
  return new Response(null, { status, headers: { location, "cache-control": "no-store", ...headers } });
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// Paragraph-only text formatting for owner-written copy (policies, descriptions).
export function paragraphs(text) {
  return String(text || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => html`<p>${raw(escapeHtml(p).replace(/\n/g, "<br>"))}</p>`);
}

export const CATEGORIES = [
  { slug: "tees", label: "Tees" },
  { slug: "tops", label: "Tops" },
  { slug: "bottoms", label: "Bottoms" },
  { slug: "outerwear", label: "Outerwear" },
  { slug: "bags", label: "Bags" },
  { slug: "accessories", label: "Accessories" },
  { slug: "art", label: "Art" },
];

export function categoryLabel(slug) {
  return CATEGORIES.find((c) => c.slug === slug)?.label || "Other";
}

export const CONDITIONS = ["New", "Pre-loved, like new", "Pre-loved, good", "Pre-loved, worn in", "Vintage"];

export function formatDate(iso) {
  try {
    return new Intl.DateTimeFormat("en-NZ", { dateStyle: "medium", timeStyle: "short", timeZone: "Pacific/Auckland" }).format(new Date(iso));
  } catch {
    return iso;
  }
}
