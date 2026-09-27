// End-to-end test: `npm test` (needs Playwright: npm i -D playwright && npx playwright install chromium)
// Starts the shop with fresh local storage and the Stripe mock, then walks through
// buying, paying, admin order view, product upload and security checks.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  ({ chromium } = await import(process.env.PLAYWRIGHT_PATH || "/home/claude/.npm-global/lib/node_modules/playwright/index.mjs"));
}

const PORT = 3100;
const B = `http://localhost:${PORT}`;
const DATA = path.resolve("dev/.data/e2e.json");
fs.rmSync(DATA, { force: true });
const server = spawn("node", ["dev/server.js"], { env: { ...process.env, PORT: String(PORT), MOCK_DATA_FILE: DATA, ADMIN_PASSWORD: "test-pass" }, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));
for (let i = 0; i < 50 && !log.includes("Shop running"); i++) await new Promise((r) => setTimeout(r, 100));

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (e) {
    results.push(["FAIL", name, e.message.slice(0, 400)]);
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(e.message));
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

const stockOf = async (slug, size) => {
  await page.goto(`${B}/p/${slug}`);
  return Number(await page.locator(`input[name=size][value="${size}"]`).getAttribute("data-stock"));
};

await step("home renders seeded products", async () => {
  await page.goto(B);
  assert.equal(await page.locator(".card").count(), 4);
  assert.match(await page.title(), /Your Girls Favourite Resellers/);
});

await step("shop filter + sort via URL", async () => {
  await page.goto(`${B}/shop?category=art&sort=price-desc`);
  assert.equal(await page.locator(".card").count(), 2);
  await page.goto(`${B}/shop?category=bags`);
  assert.equal(await page.locator(".card").count(), 2);
});

await step("sold-out size is disabled", async () => {
  await page.goto(`${B}/p/logo-tee-bubblegum`);
  assert.equal(await page.locator('input[name=size][value="L"]').isDisabled(), true);
});

let before;
await step("add to bag requires a size, then opens drawer", async () => {
  before = await stockOf("logo-tee-white", "M");
  await page.click(".buy button[type=submit]");
  assert.equal(await page.locator("[data-buy-error]").isVisible(), true);
  await page.check('input[name=size][value="M"]', { force: true });
  await page.click(".buy button[type=submit]");
  await page.waitForSelector("#bag[open] .line");
  await page.click("[data-inc]");
  await page.waitForFunction(() => document.querySelector("[data-qty]")?.textContent === "2");
  assert.equal(await page.locator("[data-bag-count]").first().textContent(), "2");
  await page.waitForFunction(() => /Spend|shipping/.test(document.querySelector("[data-bag-shipnote]").textContent));
});

await step("checkout -> pay on mock Stripe -> success page", async () => {
  await page.click("[data-checkout]");
  await page.waitForURL(/127\.0\.0\.1:3178\/pay\//);
  assert.match(await page.textContent("body"), /Logo Tee, White \(M\)/);
  await page.click("#pay");
  await page.waitForURL(/\/checkout\/success/);
  assert.match(await page.textContent("h1"), /Order placed/);
  assert.match(await page.textContent("body"), /\$118\.00/); // 2 x $55 + $8 shipping
  assert.equal(await page.locator("[data-bag-count]").first().isHidden(), true);
});

await step("stock decremented exactly once (webhook + success page)", async () => {
  await page.reload();
  const after = await stockOf("logo-tee-white", "M");
  assert.equal(after, before - 2);
});

await step("forged webhook is rejected", async () => {
  const r = await fetch(`${B}/api/stripe/webhook`, { method: "POST", headers: { "stripe-signature": "t=1,v1=deadbeef" }, body: "{}" });
  assert.equal(r.status, 400);
});

await step("checkout rejects more than available stock", async () => {
  const cart = await (await fetch(`${B}/api/cart`, { method: "POST", body: JSON.stringify({ items: [] }) })).json();
  assert.equal(cart.subtotal, 0);
  await page.goto(`${B}/p/logo-tee-bubblegum`);
  const pid = JSON.parse(await page.locator("[data-add-to-bag]").getAttribute("data-add-to-bag")).id;
  const r = await fetch(`${B}/api/checkout`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [{ id: pid, size: "XL", qty: 5 }] }) });
  assert.equal(r.status, 409);
});

await step("last one is held while someone else is paying", async () => {
  const pid = JSON.parse(await page.locator("[data-add-to-bag]").getAttribute("data-add-to-bag")).id;
  const items = [{ id: pid, size: "XL", qty: 1 }];
  const first = await fetch(`${B}/api/checkout`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items }) });
  assert.equal(first.status, 200);
  const second = await fetch(`${B}/api/checkout`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items }) });
  assert.equal(second.status, 409);
});

await step("admin requires sign-in and rejects wrong password", async () => {
  await page.goto(`${B}/admin`);
  await page.waitForURL(/\/admin\/login/);
  await page.fill("#password", "nope");
  await page.click("button[type=submit]");
  assert.match(await page.textContent(".form-error"), /isn't right/);
  const r = await fetch(`${B}/api/admin/images`, { method: "POST", body: "x" });
  assert.equal(r.status, 401);
});

await step("admin sees the paid order and can mark it shipped", async () => {
  await page.fill("#password", "test-pass");
  await page.click("button[type=submit]");
  await page.waitForURL(`${B}/admin`);
  assert.match(await page.textContent(".stats"), /\$118\.00/);
  await page.goto(`${B}/admin/orders`);
  assert.match(await page.textContent(".olist"), /Aroha Test/);
  assert.match(await page.textContent(".olist"), /12 Test Street/);
  await page.click(".olist button[type=submit]");
  assert.match(await page.textContent(".olist .status"), /Shipped/);
});

await step("admin adds a product with an uploaded photo", async () => {
  await page.goto(`${B}/admin/products/new`);
  await page.setInputFiles("[data-file-input]", path.resolve("public/seed/tote-black.webp"));
  await page.waitForFunction(() => /^img_/.test(document.querySelector("[data-images-input]").value));
  await page.fill("#title", "Vintage Carhartt Jacket");
  await page.fill("#brand", "Carhartt");
  await page.selectOption("#category", "outerwear");
  await page.fill("#price", "120");
  await page.fill("#description", "Faded brown duck canvas.\n\nPit to pit 62cm.");
  await page.click("[data-save]");
  await page.waitForURL(/done=added/);
  await page.goto(`${B}/shop?category=outerwear`);
  assert.equal(await page.locator(".card").count(), 1);
  await page.click(".card a");
  assert.match(await page.textContent("h1"), /Vintage Carhartt Jacket/);
  const src = await page.locator(".pdp__main img").first().getAttribute("src");
  const img = await fetch(B + src);
  assert.equal(img.status, 200);
  assert.match(img.headers.get("content-type"), /image\//);
});

await step("admin validation keeps entered values", async () => {
  await page.goto(`${B}/admin/products/new`);
  await page.fill("#title", "No Photo Yet");
  await page.fill("#price", "20");
  await page.click("[data-save]");
  assert.match(await page.textContent(".form-error--box"), /at least one photo/);
  assert.equal(await page.inputValue("#title"), "No Photo Yet");
});

await step("admin settings change shipping shown in shop", async () => {
  await page.goto(`${B}/admin/settings`);
  await page.fill("#shipping", "6.50");
  await page.fill("#instagram", "@ygfr.nz");
  await page.click(".form-actions button[type=submit]");
  await page.waitForURL(/done=settings/);
  await page.goto(`${B}/help`);
  assert.match(await page.textContent("main"), /\$6\.50/);
  assert.match(await page.textContent("main"), /@ygfr\.nz/);
});

await step("admin deletes a product via confirm dialog", async () => {
  await page.goto(`${B}/admin`);
  await page.click('.plist__row:has-text("Vintage Carhartt Jacket") a.btn');
  await page.click("[data-open-dialog]");
  await page.click("#delete-dialog button[type=submit]");
  await page.waitForURL(/done=deleted/);
  const r = await fetch(`${B}/shop?category=outerwear`);
  assert.doesNotMatch(await r.text(), /Carhartt/);
});

await step("cross-site admin POST is blocked", async () => {
  const r = await fetch(`${B}/admin/settings`, { method: "POST", headers: { origin: "https://evil.example" }, body: "announcement=x" });
  assert.equal(r.status, 403);
});

await step("no browser console errors", async () => {
  // 401/422 responses above are expected; anything else is a real error.
  assert.deepEqual(consoleErrors.filter((e) => !/favicon|status of (401|422)/.test(e)), []);
});

await browser.close();
server.kill();
for (const r of results) console.log(r.join("  "));
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
