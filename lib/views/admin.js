import { html, raw, money, CATEGORIES, CONDITIONS, categoryLabel, formatDate, escapeHtml } from "../util.js";
import { icon } from "../icons.js";
import { imageUrl, totalStock } from "../db.js";

function shell({ title, body, active = "", flash = "" }) {
  const tab = (href, label, key) => html`<a href="${href}" class="admin-nav__link" ${active === key ? raw('aria-current="page"') : ""}>${label}</a>`;
  return html`<!doctype html>
<html lang="en-NZ">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#ffffff">
<title>${title} | Admin</title>
<link rel="icon" href="/img/icon-32.png" sizes="32x32">
<link rel="stylesheet" href="/css/site.css?v=3">
</head>
<body class="admin">
<a class="skip" href="#main">Skip to content</a>
<header class="admin-header">
  <div class="container admin-header__inner">
    <a class="brand" href="/admin"><span class="wordmark wordmark--header" translate="no">Your Girls Favourite Resellers</span><span class="admin-badge">Admin</span></a>
    ${active !== "login" ? html`<nav class="admin-nav" aria-label="Admin">
      ${tab("/admin", "Products", "products")}
      ${tab("/admin/orders", "Orders", "orders")}
      ${tab("/admin/settings", "Settings", "settings")}
      <a href="/" class="admin-nav__link">View Shop</a>
      <form method="post" action="/admin/logout"><button class="admin-nav__link link-btn" type="submit">Sign Out</button></form>
    </nav>` : ""}
  </div>
</header>
<main id="main" class="container admin-main">
${flash ? html`<p class="flash" role="status">${flash}</p>` : ""}
${body}
</main>
<script type="module" src="/js/admin.js?v=3"></script>
</body>
</html>`;
}

export function setupNeeded({ missing }) {
  return shell({
    title: "Setup needed",
    active: "login",
    body: html`<section class="admin-card narrow">
  <h1 class="admin-title">Finish setup</h1>
  <p>Add these environment variables in Vercel (Project Settings, Environment Variables), then redeploy:</p>
  <ul class="setup-list">${missing.map((m) => html`<li><code>${m.name}</code> ${m.help}</li>`)}</ul>
</section>`,
  });
}

export function loginPage({ error = "" } = {}) {
  return shell({
    title: "Sign in",
    active: "login",
    body: html`<section class="admin-card narrow">
  <h1 class="admin-title">Sign in</h1>
  <form method="post" action="/admin/login" class="form" novalidate>
    <div class="field">
      <label for="password">Admin password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required class="input" ${error ? raw('aria-invalid="true" aria-describedby="pw-error"') : ""}>
      ${error ? html`<p id="pw-error" class="form-error">${error}</p>` : ""}
    </div>
    <button class="btn btn--primary btn--block" type="submit">Sign In</button>
  </form>
</section>`,
  });
}

export function productsList({ products, orders, flash }) {
  const paid = orders.filter((o) => o.status === "paid");
  const toShip = paid.filter((o) => !o.shippedAt).length;
  const revenue = paid.reduce((n, o) => n + (o.totalCents || 0), 0);
  const body = html`
<div class="admin-head">
  <h1 class="admin-title">Products</h1>
  <a class="btn btn--primary" href="/admin/products/new">${raw(icon("plus", { size: 18 }))} Add Product</a>
</div>
<div class="stats">
  <a class="stat" href="/admin/orders"><span class="stat__num num">${toShip}</span><span class="stat__label">Orders to ship</span></a>
  <div class="stat"><span class="stat__num num">${paid.length}</span><span class="stat__label">Paid orders</span></div>
  <div class="stat"><span class="stat__num num">${money(revenue)}</span><span class="stat__label">Total sales</span></div>
  <div class="stat"><span class="stat__num num">${products.filter((p) => p.status === "active").length}</span><span class="stat__label">Live products</span></div>
</div>
${products.length ? html`<ul class="plist">
  ${products.map((p) => {
    const stock = totalStock(p);
    return html`<li class="plist__row">
      <img src="${imageUrl(p.images[0])}" alt="" width="64" height="64">
      <div class="plist__main">
        <a class="plist__title" href="/admin/products/${p.id}">${p.title}</a>
        <p class="muted small">${categoryLabel(p.category)}, ${p.sizes.map((s) => `${s.label}: ${s.stock}`).join(", ")}</p>
      </div>
      <span class="num">${money(p.price)}</span>
      <span class="status ${p.status === "draft" ? "status--draft" : stock === 0 ? "status--out" : "status--live"}">${p.status === "draft" ? "Draft" : stock === 0 ? "Sold out" : "Live"}</span>
      <a class="btn btn--ghost btn--sm" href="/admin/products/${p.id}">${raw(icon("pencil-simple", { size: 16 }))} Edit</a>
    </li>`;
  })}
</ul>` : html`<div class="empty"><span class="empty__icon">${raw(icon("package", { size: 36 }))}</span><p>No products yet. Add your first one.</p></div>`}`;
  return shell({ title: "Products", body, active: "products", flash });
}

export function productForm({ product, error = "" }) {
  const p = product || { title: "", brand: "", category: "tees", condition: "Pre-loved, like new", price: 0, compareAt: null, description: "", images: [], sizes: [{ label: "One size", stock: 1 }], status: "active", featured: false };
  const isNew = !product?.id;
  const cents = (c) => (c ? (c / 100).toFixed(2) : "");
  const body = html`
<div class="admin-head">
  <h1 class="admin-title">${isNew ? "Add Product" : "Edit Product"}</h1>
  ${!isNew ? html`<a class="text-link" href="/p/${p.slug}" target="_blank" rel="noopener">View in shop ${raw(icon("arrow-right", { size: 16 }))}</a>` : ""}
</div>
${error ? html`<p class="form-error form-error--box" role="alert">${error}</p>` : ""}
<form method="post" action="${isNew ? "/admin/products/new" : `/admin/products/${p.id}`}" class="form pform" data-product-form>
  <section class="admin-card">
    <h2 class="admin-subtitle">Photos</h2>
    <p class="muted small">Square photos look best. The first photo is the cover. Images are resized in your browser before upload.</p>
    <input type="hidden" name="images" value="${p.images.join(",")}" data-images-input>
    <ul class="uploader" data-images-list>
      ${p.images.map((img) => html`<li class="uploader__item" data-ref="${img}">
        <img src="${imageUrl(img)}" alt="" width="140" height="140">
        <div class="uploader__tools">
          <button type="button" class="icon-btn icon-btn--soft icon-btn--sm" data-move="-1" aria-label="Move photo earlier">${raw(icon("arrow-left", { size: 16 }))}</button>
          <button type="button" class="icon-btn icon-btn--soft icon-btn--sm" data-move="1" aria-label="Move photo later">${raw(icon("arrow-right", { size: 16 }))}</button>
          <button type="button" class="icon-btn icon-btn--soft icon-btn--sm" data-remove-image aria-label="Remove photo">${raw(icon("trash", { size: 16 }))}</button>
        </div>
      </li>`)}
    </ul>
    <label class="dropzone" data-dropzone>
      ${raw(icon("upload-simple", { size: 28 }))}
      <span><strong>Add photos</strong> or drop them here</span>
      <span class="muted small">JPG, PNG, WebP or HEIC, up to 8 photos</span>
      <input type="file" accept="image/*" multiple class="sr-only" data-file-input aria-label="Add photos">
    </label>
    <p class="small" data-upload-status aria-live="polite"></p>
  </section>

  <section class="admin-card">
    <h2 class="admin-subtitle">Details</h2>
    <div class="field">
      <label for="title">Title</label>
      <input id="title" name="title" class="input" required maxlength="120" value="${p.title}" autocomplete="off" placeholder="Vintage Nike Tee, Washed Black…">
    </div>
    <div class="field-row">
      <div class="field">
        <label for="brand">Brand</label>
        <input id="brand" name="brand" class="input" maxlength="60" value="${p.brand}" autocomplete="off" placeholder="Nike…">
      </div>
      <div class="field">
        <label for="category">Category</label>
        <select id="category" name="category" class="select">
          ${CATEGORIES.map((c) => html`<option value="${c.slug}" ${p.category === c.slug ? "selected" : ""}>${c.label}</option>`)}
        </select>
      </div>
      <div class="field">
        <label for="condition">Condition</label>
        <select id="condition" name="condition" class="select">
          ${CONDITIONS.map((c) => html`<option ${p.condition === c ? "selected" : ""}>${c}</option>`)}
        </select>
      </div>
    </div>
    <div class="field">
      <label for="description">Description</label>
      <textarea id="description" name="description" class="input" rows="6" maxlength="4000" placeholder="Fit, measurements, flaws, how it was worn…">${p.description}</textarea>
      <p class="muted small">Leave a blank line between paragraphs.</p>
    </div>
  </section>

  <section class="admin-card">
    <h2 class="admin-subtitle">Price</h2>
    <div class="field-row">
      <div class="field">
        <label for="price">Price (NZD)</label>
        <input id="price" name="price" class="input num" inputmode="decimal" required value="${cents(p.price)}" autocomplete="off" placeholder="45.00">
      </div>
      <div class="field">
        <label for="compareAt">Was price (optional)</label>
        <input id="compareAt" name="compareAt" class="input num" inputmode="decimal" value="${cents(p.compareAt)}" autocomplete="off" placeholder="60.00">
        <p class="muted small">Shows the old price crossed out.</p>
      </div>
    </div>
  </section>

  <section class="admin-card">
    <h2 class="admin-subtitle">Sizes and stock</h2>
    <p class="muted small">For a one-off piece, use a single size with stock 1.</p>
    <div class="size-rows" data-size-rows>
      ${p.sizes.map((s) => sizeRow(s))}
    </div>
    <div class="size-actions">
      <button type="button" class="btn btn--ghost btn--sm" data-add-size>${raw(icon("plus", { size: 16 }))} Add Size</button>
      <button type="button" class="btn btn--ghost btn--sm" data-preset="S,M,L,XL">Use S to XL</button>
      <button type="button" class="btn btn--ghost btn--sm" data-preset="One size">Use One Size</button>
    </div>
    <template id="tpl-size-row">${sizeRow({ label: "", stock: 1 })}</template>
  </section>

  <section class="admin-card">
    <h2 class="admin-subtitle">Visibility</h2>
    <div class="field-row">
      <label class="check"><input type="radio" name="status" value="active" ${p.status !== "draft" ? "checked" : ""}> <span><strong>Live</strong> Visible in the shop</span></label>
      <label class="check"><input type="radio" name="status" value="draft" ${p.status === "draft" ? "checked" : ""}> <span><strong>Draft</strong> Hidden from customers</span></label>
    </div>
  </section>

  <div class="form-actions">
    <button class="btn btn--primary btn--lg" type="submit" data-save>${isNew ? "Add Product" : "Save Changes"}</button>
    <a class="btn btn--ghost btn--lg" href="/admin">Cancel</a>
    ${!isNew ? html`<button class="btn btn--danger btn--lg form-actions__end" type="button" data-open-dialog="delete-dialog">${raw(icon("trash", { size: 18 }))} Delete</button>` : ""}
  </div>
</form>
${!isNew ? html`<dialog class="modal" id="delete-dialog" aria-labelledby="delete-title">
  <form method="post" action="/admin/products/${p.id}/delete" class="modal__panel">
    <h2 id="delete-title" class="admin-subtitle">Delete this product?</h2>
    <p>${p.title} and its photos will be removed. Past orders keep their details.</p>
    <div class="form-actions">
      <button class="btn btn--danger" type="submit">Delete Product</button>
      <button class="btn btn--ghost" type="button" data-close-dialog>Keep It</button>
    </div>
  </form>
</dialog>` : ""}`;
  return shell({ title: isNew ? "Add Product" : `Edit ${p.title}`, body, active: "products" });
}

function sizeRow(s) {
  return html`<div class="size-row">
  <div class="field"><label class="sr-only">Size label</label><input name="sizeLabel[]" class="input" value="${s.label}" placeholder="M…" maxlength="24" autocomplete="off" aria-label="Size label"></div>
  <div class="field"><label class="sr-only">Stock</label><input name="sizeStock[]" class="input num" type="number" min="0" step="1" value="${s.stock}" inputmode="numeric" aria-label="Stock"></div>
  <button type="button" class="icon-btn icon-btn--soft" data-remove-size aria-label="Remove size">${raw(icon("x", { size: 18 }))}</button>
</div>`;
}

export function ordersPage({ orders, flash }) {
  const list = orders.filter((o) => o.status === "paid");
  const body = html`
<div class="admin-head"><h1 class="admin-title">Orders</h1></div>
${list.length ? html`<ul class="olist">
  ${list.map((o) => {
    const a = o.shipping?.address || {};
    return html`<li class="admin-card order">
      <div class="order__head">
        <div>
          <p class="order__who"><strong>${o.customerName || "Customer"}</strong> <span class="muted small">${o.email || ""}</span></p>
          <p class="muted small">${formatDate(o.paidAt || o.createdAt)}, order ${o.id}</p>
        </div>
        <span class="status ${o.shippedAt ? "status--live" : "status--draft"}">${o.shippedAt ? "Shipped" : "To ship"}</span>
      </div>
      <div class="order__grid">
        <div>
          ${o.items.map((i) => html`<p>${i.title} <span class="muted">(${i.size}) &times; ${i.qty}</span> <span class="num">${money(i.price * i.qty)}</span></p>`)}
          <p class="muted">Shipping <span class="num">${money(o.shippingCents || 0)}</span></p>
          <p><strong>Total <span class="num">${money(o.totalCents || 0)}</span></strong></p>
        </div>
        <address class="order__addr">
          ${o.shipping?.name || o.customerName || ""}<br>
          ${[a.line1, a.line2, a.city, a.state, a.postal_code, a.country].filter(Boolean).join(", ")}
          ${o.phone ? html`<br>${o.phone}` : ""}
        </address>
      </div>
      <form method="post" action="/admin/orders/${o.id}/ship">
        <input type="hidden" name="shipped" value="${o.shippedAt ? "0" : "1"}">
        <button class="btn ${o.shippedAt ? "btn--ghost" : "btn--primary"} btn--sm" type="submit">${o.shippedAt ? "Mark as Not Shipped" : html`${raw(icon("check", { size: 16 }))} Mark as Shipped`}</button>
      </form>
    </li>`;
  })}
</ul>` : html`<div class="empty"><span class="empty__icon">${raw(icon("package", { size: 36 }))}</span><p>No paid orders yet. They'll show up here as soon as someone checks out.</p></div>`}`;
  return shell({ title: "Orders", body, active: "orders", flash });
}

export function settingsPage({ settings: s, flash }) {
  const cents = (c) => (c ? (c / 100).toFixed(2) : "0.00");
  const body = html`
<div class="admin-head"><h1 class="admin-title">Settings</h1></div>
<form method="post" action="/admin/settings" class="form">
  <section class="admin-card">
    <h2 class="admin-subtitle">Shipping</h2>
    <div class="field-row">
      <div class="field"><label for="shipping">NZ shipping (NZD)</label><input id="shipping" name="shipping" class="input num" inputmode="decimal" value="${cents(s.shippingCents)}" autocomplete="off"></div>
      <div class="field"><label for="freeOver">Free shipping over (NZD)</label><input id="freeOver" name="freeOver" class="input num" inputmode="decimal" value="${cents(s.freeShippingOverCents)}" autocomplete="off"><p class="muted small">Set to 0 to turn off free shipping.</p></div>
    </div>
  </section>
  <section class="admin-card">
    <h2 class="admin-subtitle">Shop banner and contact</h2>
    <div class="field"><label for="announcement">Scrolling banner text</label><input id="announcement" name="announcement" class="input" maxlength="120" value="${s.announcement}" autocomplete="off"><p class="muted small">Leave empty to hide the banner.</p></div>
    <div class="field-row">
      <div class="field"><label for="contactEmail">Contact email</label><input id="contactEmail" name="contactEmail" type="email" class="input" value="${s.contactEmail}" autocomplete="email" spellcheck="false"></div>
      <div class="field"><label for="instagram">Instagram handle</label><input id="instagram" name="instagram" class="input" value="${s.instagram}" autocomplete="off" spellcheck="false" placeholder="yourgirlsfavourite…"></div>
      <div class="field"><label for="tiktok">TikTok handle</label><input id="tiktok" name="tiktok" class="input" value="${s.tiktok}" autocomplete="off" spellcheck="false"></div>
    </div>
  </section>
  <section class="admin-card">
    <h2 class="admin-subtitle">Policies</h2>
    <p class="notice small">${raw(icon("warning-circle", { size: 18 }))} These start as example text. Check they match how you actually ship and handle returns before you launch. Stripe also asks for a visible refund policy.</p>
    <div class="field"><label for="shippingPolicy">Shipping policy</label><textarea id="shippingPolicy" name="shippingPolicy" class="input" rows="5">${s.shippingPolicy}</textarea></div>
    <div class="field"><label for="returnsPolicy">Returns policy</label><textarea id="returnsPolicy" name="returnsPolicy" class="input" rows="5">${s.returnsPolicy}</textarea></div>
  </section>
  <div class="form-actions"><button class="btn btn--primary btn--lg" type="submit">Save Settings</button></div>
</form>`;
  return shell({ title: "Settings", body, active: "settings", flash });
}

export { escapeHtml };
