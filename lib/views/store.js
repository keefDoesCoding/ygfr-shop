import { html, raw, money, categoryLabel, CATEGORIES, paragraphs, escapeHtml } from "../util.js";
import { icon } from "../icons.js";
import { imageUrl, totalStock } from "../db.js";
import { page, productCard, wordmarkText } from "./layout.js";

export function homePage({ products, settings }) {
  const newIn = products.slice(0, 4);
  const hero = products.find((p) => p.images[0] === "/seed/tee-white.webp") || products.find((p) => p.featured) || products[0];
  const heroAlt = products.find((p) => p.category === "art" && p.id !== hero?.id) || products[1];
  const pick = (cat) => products.find((p) => p.category === cat && p.featured) || products.find((p) => p.category === cat);
  const tiles = [
    { cat: "tees", p: products.find((p) => p.images[0] === "/seed/tee-bubblegum.webp") || pick("tees") },
    { cat: "bags", p: pick("bags") },
    { cat: "art", p: pick("art") },
  ].filter((t) => t.p);
  const freeOver = settings.freeShippingOverCents;

  const body = html`
<section class="hero container">
  <div class="hero__copy">
    <h1 class="hero__title">${wordmarkText("span", "wordmark--hero")}</h1>
    <p class="hero__sub">Streetwear tees, bags and art, picked by us and ready to ship across New Zealand.</p>
    <div class="hero__ctas">
      <a class="btn btn--primary btn--lg" href="/shop">Shop All ${raw(icon("arrow-right", { size: 20 }))}</a>
      <a class="btn btn--ghost btn--lg" href="/shop?category=art">See the Art</a>
    </div>
  </div>
  <div class="hero__media">
    ${hero ? html`<a href="/p/${hero.slug}" class="hero__frame hero__frame--main" aria-label="${hero.title}">
      <img src="${imageUrl(hero.images[0])}" alt="${hero.title}" width="1200" height="1200" fetchpriority="high">
    </a>` : ""}
    ${heroAlt ? html`<a href="/p/${heroAlt.slug}" class="hero__frame hero__frame--polaroid" aria-label="${heroAlt.title}">
      <img src="${imageUrl(heroAlt.images[0])}" alt="${heroAlt.title}" width="600" height="600">
    </a>` : ""}
    <span class="hero__spark" aria-hidden="true">${raw(icon("sparkle", { size: 56 }))}</span>
  </div>
</section>

<section class="section container" aria-labelledby="new-in">
  <div class="section__head">
    <h2 id="new-in" class="display-md">New In</h2>
    <a class="text-link" href="/shop">View all ${raw(icon("arrow-right", { size: 18 }))}</a>
  </div>
  ${newIn.length
    ? html`<div class="grid-products">${newIn.map((p, i) => productCard(p, { priority: i < 2 }))}</div>`
    : html`<p class="muted">New pieces are on the way. Check back soon.</p>`}
</section>

${tiles.length ? html`<section class="section container" aria-labelledby="shop-by">
  <h2 id="shop-by" class="display-md">Shop by Category</h2>
  <div class="bento bento--${tiles.length}">
    ${tiles.map((t, i) => html`<a class="tile tile--${i} reveal" href="/shop?category=${t.cat}">
      <span class="tile__img"><img src="${imageUrl(t.p.images[0])}" alt="" width="1200" height="1200" loading="lazy"></span>
      <span class="tile__label">${categoryLabel(t.cat)} ${raw(icon("arrow-right", { size: 22 }))}</span>
    </a>`)}
  </div>
</section>` : ""}

<section class="band" aria-labelledby="how-to-buy">
  <div class="container band__inner">
    <h2 id="how-to-buy" class="band__title">Checkout Takes a Minute</h2>
    <ul class="band__facts">
      <li>${raw(icon("lock-simple", { size: 28 }))}<span><strong>Secure card checkout</strong> through Stripe. Apple Pay and Google Pay work too.</span></li>
      <li>${raw(icon("truck", { size: 28 }))}<span><strong>${money(settings.shippingCents)} shipping NZ-wide</strong>${freeOver ? `, free on orders over ${money(freeOver)}` : ""}.</span></li>
      <li>${raw(icon("arrow-u-up-left", { size: 28 }))}<span><strong>Something not right?</strong> <a href="/help#returns">Read our returns policy</a>.</span></li>
    </ul>
  </div>
</section>`;
  return page({ settings, body, path: "/" });
}

export function shopPage({ products, settings, category, sort }) {
  let list = category ? products.filter((p) => p.category === category) : products.slice();
  if (sort === "price-asc") list.sort((a, b) => a.price - b.price);
  else if (sort === "price-desc") list.sort((a, b) => b.price - a.price);
  // Sold-out pieces sink to the bottom so available stock leads.
  list.sort((a, b) => (totalStock(b) > 0) - (totalStock(a) > 0));
  const available = CATEGORIES.filter((c) => products.some((p) => p.category === c.slug));
  const title = category ? categoryLabel(category) : "Shop All";
  const q = (c) => {
    const u = new URLSearchParams();
    if (c) u.set("category", c);
    if (sort && sort !== "new") u.set("sort", sort);
    const s = u.toString();
    return s ? `/shop?${s}` : "/shop";
  };
  const body = html`
<section class="container shop">
  <div class="shop__head">
    <h1 class="display-lg">${title}</h1>
    <p class="muted num">${list.length} ${list.length === 1 ? "piece" : "pieces"}</p>
  </div>
  <div class="shop__bar">
    <nav class="chips" aria-label="Categories">
      <a class="chip ${!category ? "chip--on" : ""}" href="${q("")}" ${!category ? raw('aria-current="page"') : ""}>All</a>
      ${available.map((c) => html`<a class="chip ${category === c.slug ? "chip--on" : ""}" href="${q(c.slug)}" ${category === c.slug ? raw('aria-current="page"') : ""}>${c.label}</a>`)}
    </nav>
    <form class="sort" method="get" action="/shop" data-autosubmit>
      ${category ? html`<input type="hidden" name="category" value="${category}">` : ""}
      <label for="sort" class="sort__label">Sort</label>
      <select id="sort" name="sort" class="select">
        <option value="new" ${!sort || sort === "new" ? "selected" : ""}>Newest</option>
        <option value="price-asc" ${sort === "price-asc" ? "selected" : ""}>Price, low to high</option>
        <option value="price-desc" ${sort === "price-desc" ? "selected" : ""}>Price, high to low</option>
      </select>
      <noscript><button class="btn btn--ghost btn--sm" type="submit">Apply</button></noscript>
    </form>
  </div>
  ${list.length
    ? html`<div class="grid-products">${list.map((p, i) => productCard(p, { priority: i < 4 }))}</div>`
    : html`<div class="empty"><span class="empty__icon">${raw(icon("storefront", { size: 36 }))}</span><p>Nothing here right now. New pieces drop often.</p><a class="btn btn--primary" href="/shop">Shop All</a></div>`}
</section>`;
  return page({ settings, body, title, path: category ? `/shop?category=${category}` : "/shop" });
}

export function productPage({ product: p, related, settings }) {
  const stock = totalStock(p);
  const firstAvailable = p.sizes.find((s) => s.stock > 0);
  const single = p.sizes.length === 1;
  const cartData = { id: p.id, slug: p.slug, title: p.title, price: p.price, image: imageUrl(p.images[0]) };
  const body = html`
<section class="container pdp">
  <div class="pdp__gallery" data-gallery>
    <div class="pdp__main">
      ${p.images.map((img, i) => html`<img src="${imageUrl(img)}" alt="${i === 0 ? p.title : `${p.title}, photo ${i + 1}`}" width="1200" height="1200" ${i === 0 ? raw('fetchpriority="high"') : raw('loading="lazy"')} data-slide="${i}">`)}
    </div>
    ${p.images.length > 1 ? html`<div class="pdp__thumbs" role="group" aria-label="Photos">
      ${p.images.map((img, i) => html`<button type="button" class="pdp__thumb" data-goto="${i}" aria-label="Show photo ${i + 1}" ${i === 0 ? raw('aria-current="true"') : ""}><img src="${imageUrl(img)}" alt="" width="120" height="120" loading="lazy"></button>`)}
    </div>` : ""}
  </div>
  <div class="pdp__info">
    <nav class="crumbs small" aria-label="Breadcrumb"><a href="/shop">Shop</a> / <a href="/shop?category=${p.category}">${categoryLabel(p.category)}</a></nav>
    <h1 class="pdp__title">${p.title}</h1>
    <p class="pdp__price num">${p.compareAt && p.compareAt > p.price ? html`<s class="muted">${money(p.compareAt)}</s> ` : ""}${money(p.price)}</p>
    <dl class="pdp__facts">
      ${p.brand ? html`<div><dt>Brand</dt><dd>${p.brand}</dd></div>` : ""}
      <div><dt>Condition</dt><dd>${p.condition}</dd></div>
    </dl>
    <form class="buy" data-add-to-bag='${raw(escapeHtml(JSON.stringify(cartData)))}'>
      <fieldset class="sizes" ${single ? raw('hidden') : ""}>
        <legend class="sizes__legend">Size</legend>
        <div class="sizes__grid">
          ${p.sizes.map((s) => html`<label class="size ${s.stock === 0 ? "size--out" : ""}">
            <input type="radio" name="size" value="${s.label}" ${s.stock === 0 ? "disabled" : ""} ${firstAvailable && s.label === firstAvailable.label && single ? "checked" : ""} data-stock="${s.stock}">
            <span>${s.label}</span>
          </label>`)}
        </div>
      </fieldset>
      ${stock > 0 && stock <= 2 ? html`<p class="pdp__low small">Only ${stock} left</p>` : ""}
      <p class="form-error" data-buy-error role="alert" hidden></p>
      ${stock > 0
        ? html`<button class="btn btn--primary btn--lg btn--block" type="submit">Add to Bag</button>`
        : html`<button class="btn btn--lg btn--block" type="button" disabled>Sold Out</button>`}
    </form>
    <div class="pdp__desc">${paragraphs(p.description)}</div>
    <details class="acc">
      <summary>Shipping ${raw(icon("caret-down", { size: 18 }))}</summary>
      <div class="acc__body">
        <p>${money(settings.shippingCents)} flat rate NZ-wide${settings.freeShippingOverCents ? `, free on orders over ${money(settings.freeShippingOverCents)}` : ""}.</p>
        <p><a href="/help#shipping">Shipping details</a></p>
      </div>
    </details>
    <details class="acc">
      <summary>Returns ${raw(icon("caret-down", { size: 18 }))}</summary>
      <div class="acc__body">${paragraphs(settings.returnsPolicy)}</div>
    </details>
  </div>
</section>
${related.length ? html`<section class="section container" aria-labelledby="related">
  <h2 id="related" class="display-md">You Might Also Like</h2>
  <div class="grid-products">${related.map((r) => productCard(r))}</div>
</section>` : ""}`;
  return page({
    settings,
    body,
    title: p.title,
    description: `${p.title}, ${money(p.price)}. ${String(p.description || "").slice(0, 140)}`,
    ogImage: imageUrl(p.images[0]),
    path: "/shop",
  });
}

export function helpPage({ settings }) {
  const contact = [];
  if (settings.contactEmail) contact.push(html`<p>Email <a href="mailto:${settings.contactEmail}">${settings.contactEmail}</a></p>`);
  if (settings.instagram) contact.push(html`<p>Instagram <a href="https://instagram.com/${settings.instagram.replace(/^@/, "")}">@${settings.instagram.replace(/^@/, "")}</a></p>`);
  if (settings.tiktok) contact.push(html`<p>TikTok <a href="https://www.tiktok.com/@${settings.tiktok.replace(/^@/, "")}">@${settings.tiktok.replace(/^@/, "")}</a></p>`);
  const body = html`<section class="container narrow prose">
  <h1 class="display-lg">Help</h1>
  <h2 id="shipping">Shipping</h2>
  ${paragraphs(settings.shippingPolicy)}
  <p>Current rate: ${money(settings.shippingCents)} NZ-wide${settings.freeShippingOverCents ? `, free on orders over ${money(settings.freeShippingOverCents)}` : ""}.</p>
  <h2 id="returns">Returns</h2>
  ${paragraphs(settings.returnsPolicy)}
  <h2 id="contact">Contact</h2>
  ${contact.length ? contact : html`<p>Contact details are coming soon.</p>`}
  <h2 id="payments">Payments</h2>
  <p>All payments are processed by Stripe. We never see or store your card details.</p>
</section>`;
  return page({ settings, body, title: "Help", path: "/help" });
}

export function successPage({ settings, order, paid }) {
  const body = html`<section class="container narrow confirm" data-clear-bag="${paid ? "1" : ""}">
  <span class="confirm__icon">${raw(icon(paid ? "seal-check" : "warning-circle", { size: 56 }))}</span>
  <h1 class="display-md">${paid ? "Order placed" : "Payment not finished"}</h1>
  ${paid
    ? html`<p class="lede">Thanks${order?.customerName ? `, ${order.customerName.split(" ")[0]}` : ""}! A receipt is on its way to ${order?.email || "your email"}.</p>`
    : html`<p class="lede">We haven't received your payment yet. Your bag is saved, so you can try again.</p>`}
  ${order ? html`<div class="summary">
    <p class="muted small">Order ${order.id}</p>
    ${order.items.map((i) => html`<div class="summary__row"><span>${i.title} <span class="muted">(${i.size}) &times; ${i.qty}</span></span><span class="num">${money(i.price * i.qty)}</span></div>`)}
    <div class="summary__row"><span>Shipping</span><span class="num">${money(order.shippingCents || 0)}</span></div>
    <div class="summary__row summary__row--total"><span>Total</span><span class="num">${money(order.totalCents ?? order.subtotalCents + (order.shippingCents || 0))}</span></div>
  </div>` : ""}
  <a class="btn btn--primary" href="/shop">Keep Shopping</a>
</section>`;
  return page({ settings, body, title: paid ? "Order placed" : "Payment not finished", noindex: true });
}
