import { html, raw, money, categoryLabel } from "../util.js";
import { icon } from "../icons.js";
import { imageUrl, totalStock } from "../db.js";

export const BRAND = "Your Girls Favourite Resellers";

export function page({ title, description, body, settings, path = "/", ogImage = "/img/og.jpg", noindex = false, bodyClass = "" }) {
  const fullTitle = title ? `${title} | ${BRAND}` : `${BRAND} | Streetwear tees, bags and art`;
  const desc = description || "Streetwear tees, bags and art from Your Girls Favourite Resellers. Shop online with secure card checkout.";
  return html`<!doctype html>
<html lang="en-NZ">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${fullTitle}</title>
<meta name="description" content="${desc}">
${noindex ? raw('<meta name="robots" content="noindex">') : ""}
<meta name="theme-color" content="#ffffff">
<meta property="og:title" content="${fullTitle}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${ogImage}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/img/icon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/img/icon-180.png">
<link rel="preload" href="/fonts/shrikhand.woff" as="font" type="font/woff" crossorigin>
<link rel="preload" href="/fonts/geist.woff" as="font" type="font/woff" crossorigin>
<link rel="stylesheet" href="/css/site.css?v=3">
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">Skip to content</a>
${settings?.announcement ? announcement(settings.announcement) : ""}
${header(path)}
<main id="main">${body}</main>
${footer(settings)}
${bagDrawer()}
<script type="module" src="/js/site.js?v=3"></script>
</body>
</html>`;
}

function announcement(text) {
  const item = html`<span class="marquee__item">${text}</span><span class="marquee__star">${raw(icon("star", { size: 14 }))}</span>`;
  const run = Array.from({ length: 6 }, () => item);
  return html`<div class="marquee" role="note" aria-label="${text}">
  <div class="marquee__track" aria-hidden="true"><div class="marquee__run">${run}</div><div class="marquee__run">${run}</div></div>
</div>`;
}

export function wordmarkText(tag = "span", cls = "") {
  return raw(`<${tag} class="wordmark ${cls}" translate="no">Your Girls Favourite Resellers</${tag}>`);
}

function header(path) {
  const link = (href, label) =>
    html`<a href="${href}" class="nav__link" ${path === href ? raw('aria-current="page"') : ""}>${label}</a>`;
  return html`<header class="site-header">
  <div class="site-header__inner">
    <a href="/" class="brand" aria-label="Your Girls Favourite Resellers, home">${wordmarkText("span", "wordmark--header")}</a>
    <nav class="nav" aria-label="Main">
      ${link("/shop", "Shop All")}
      ${link("/shop?category=tees", "Tees")}
      ${link("/shop?category=bags", "Bags")}
      ${link("/shop?category=art", "Art")}
    </nav>
    <button class="icon-btn bag-btn" type="button" data-open-bag aria-label="Open bag">
      ${raw(icon("tote-simple", { size: 24 }))}
      <span class="bag-btn__count" data-bag-count hidden>0</span>
    </button>
  </div>
</header>`;
}

function footer(settings = {}) {
  const socials = [];
  if (settings.instagram)
    socials.push(html`<a class="icon-btn icon-btn--soft" href="https://instagram.com/${settings.instagram.replace(/^@/, "")}" aria-label="Instagram">${raw(icon("instagram-logo", { size: 22 }))}</a>`);
  if (settings.tiktok)
    socials.push(html`<a class="icon-btn icon-btn--soft" href="https://www.tiktok.com/@${settings.tiktok.replace(/^@/, "")}" aria-label="TikTok">${raw(icon("tiktok-logo", { size: 22 }))}</a>`);
  return html`<footer class="site-footer">
  <div class="container site-footer__grid">
    <div class="site-footer__brand">
      <img src="/img/wordmark.png" alt="Your Girls Favourite Resellers" width="300" height="234" loading="lazy">
    </div>
    <nav class="site-footer__links" aria-label="Footer">
      <a href="/shop">Shop All</a>
      <a href="/help#shipping">Shipping</a>
      <a href="/help#returns">Returns</a>
      <a href="/help#contact">Contact</a>
    </nav>
    <div class="site-footer__social">${socials}</div>
  </div>
  <div class="container site-footer__base">
    <p>&copy; ${new Date().getFullYear()} Your Girls Favourite Resellers</p>
    <p>Prices in NZD. Secure card payments by Stripe.</p>
  </div>
</footer>`;
}

function bagDrawer() {
  return html`<dialog class="drawer" id="bag" aria-labelledby="bag-title">
  <div class="drawer__panel">
    <div class="drawer__head">
      <h2 id="bag-title" class="drawer__title">Your Bag</h2>
      <button class="icon-btn icon-btn--soft" type="button" data-close-bag aria-label="Close bag">${raw(icon("x", { size: 20 }))}</button>
    </div>
    <div class="drawer__body" data-bag-lines aria-live="polite"></div>
    <div class="drawer__foot" data-bag-foot hidden>
      <div class="drawer__row"><span>Subtotal</span><span class="num" data-bag-subtotal></span></div>
      <p class="muted small" data-bag-shipnote></p>
      <p class="form-error" data-bag-error role="alert" hidden></p>
      <button class="btn btn--primary btn--block" type="button" data-checkout>Checkout ${raw(icon("lock-simple", { size: 18 }))}</button>
    </div>
  </div>
</dialog>
<template id="tpl-bag-line">
  <div class="line">
    <a class="line__img" data-link><img alt="" width="96" height="96"></a>
    <div class="line__info">
      <a class="line__title" data-link data-title></a>
      <p class="muted small" data-meta></p>
      <p class="line__warn small" data-warn hidden></p>
      <div class="qty">
        <button type="button" class="qty__btn" data-dec aria-label="Decrease quantity">${raw(icon("minus", { size: 16 }))}</button>
        <span class="qty__val num" data-qty></span>
        <button type="button" class="qty__btn" data-inc aria-label="Increase quantity">${raw(icon("plus", { size: 16 }))}</button>
      </div>
    </div>
    <div class="line__end">
      <span class="num" data-price></span>
      <button type="button" class="link-btn small" data-remove>Remove</button>
    </div>
  </div>
</template>
<template id="tpl-bag-empty">
  <div class="empty">
    <span class="empty__icon">${raw(icon("tote-simple", { size: 36 }))}</span>
    <p>Your bag is empty.</p>
    <a class="btn btn--primary" href="/shop">Shop All</a>
  </div>
</template>`;
}

export function productCard(p, { priority = false } = {}) {
  const stock = totalStock(p);
  const [first, second] = p.images;
  const note = stock === 0 ? html`<span class="card__sold">Sold out</span>` : stock === 1 ? html`<span class="card__low">Last one</span>` : "";
  return html`<article class="card reveal">
  <a href="/p/${p.slug}" class="card__link">
    <div class="card__media ${second ? "card__media--swap" : ""}">
      <img src="${imageUrl(first)}" alt="${p.title}" width="600" height="600" ${priority ? raw('fetchpriority="high"') : raw('loading="lazy"')}>
      ${second ? html`<img src="${imageUrl(second)}" alt="" width="600" height="600" loading="lazy" class="card__alt">` : ""}
    </div>
    <div class="card__body">
      <h3 class="card__title">${p.title}</h3>
      <p class="card__meta">${categoryLabel(p.category)}${p.condition && p.condition !== "New" ? `, ${p.condition.toLowerCase()}` : ""} ${note}</p>
      <p class="card__price num">${p.compareAt && p.compareAt > p.price ? html`<s class="muted">${money(p.compareAt)}</s> ` : ""}${money(p.price)}</p>
    </div>
  </a>
</article>`;
}

export function notFound(settings) {
  return page({
    title: "Page not found",
    settings,
    noindex: true,
    body: html`<section class="container narrow empty-page">
  <h1 class="display-md">Lost the plot?</h1>
  <p class="lede">We couldn't find that page. It may have sold or moved.</p>
  <a class="btn btn--primary" href="/shop">Shop All</a>
</section>`,
  });
}
