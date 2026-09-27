// Storefront behaviour: bag (saved in this browser), drawer, product gallery, checkout.
document.documentElement.classList.add("js");

const KEY = "ygfr-bag-v1";
const money = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" });
const fmt = (c) => money.format((c || 0) / 100);

const bag = {
  read() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  },
  write(items) {
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch {
      /* private mode: bag lasts for this page only */
    }
    memory = items;
    updateCount();
  },
  items() {
    return memory;
  },
};
let memory = bag.read();

function updateCount() {
  const n = memory.reduce((a, i) => a + i.qty, 0);
  document.querySelectorAll("[data-bag-count]").forEach((el) => {
    el.textContent = String(n);
    el.hidden = n === 0;
  });
  document.querySelectorAll("[data-open-bag]").forEach((b) => b.setAttribute("aria-label", n ? `Open bag, ${n} ${n === 1 ? "item" : "items"}` : "Open bag"));
}

function addItem(product, size) {
  const items = bag.items().slice();
  const found = items.find((i) => i.id === product.id && i.size === size);
  if (found) found.qty = Math.min(found.qty + 1, 10);
  else items.push({ id: product.id, size, qty: 1, title: product.title, price: product.price, image: product.image, slug: product.slug });
  bag.write(items);
}

// ---------- Drawer ----------
const drawer = document.getElementById("bag");
const linesEl = drawer?.querySelector("[data-bag-lines]");
const footEl = drawer?.querySelector("[data-bag-foot]");
const errorEl = drawer?.querySelector("[data-bag-error]");
let lastServer = null;

function openBag() {
  if (!drawer || drawer.open) return;
  drawer.showModal();
  render();
  refresh();
}
function closeBag() {
  if (!drawer?.open) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return drawer.close();
  drawer.classList.add("is-closing");
  setTimeout(() => {
    drawer.classList.remove("is-closing");
    drawer.close();
  }, 220);
}

function render() {
  if (!linesEl) return;
  const items = bag.items();
  linesEl.replaceChildren();
  errorEl.hidden = true;
  if (!items.length) {
    linesEl.append(document.getElementById("tpl-bag-empty").content.cloneNode(true));
    footEl.hidden = true;
    return;
  }
  const serverLines = lastServer?.lines || [];
  let subtotal = 0;
  let blocked = false;
  items.forEach((item, index) => {
    const live = serverLines.find((l) => l.id === item.id && l.size === item.size);
    const frag = document.getElementById("tpl-bag-line").content.cloneNode(true);
    const row = frag.querySelector(".line");
    const price = live?.price ?? item.price;
    frag.querySelectorAll("[data-link]").forEach((a) => (a.href = `/p/${item.slug}`));
    const img = frag.querySelector("img");
    img.src = live?.image || item.image;
    img.alt = item.title;
    frag.querySelector("[data-title]").textContent = live?.title || item.title;
    frag.querySelector("[data-meta]").textContent = `Size ${item.size}, ${fmt(price)} each`;
    frag.querySelector("[data-qty]").textContent = String(item.qty);
    frag.querySelector("[data-price]").textContent = fmt(price * item.qty);
    const warn = frag.querySelector("[data-warn]");
    if (live?.warn) {
      warn.textContent = live.warn;
      warn.hidden = false;
      row.classList.add("line--bad");
      blocked = true;
    } else {
      subtotal += price * item.qty;
    }
    const max = live ? Math.max(1, Math.min(10, live.available || 1)) : 10;
    const dec = frag.querySelector("[data-dec]");
    const inc = frag.querySelector("[data-inc]");
    dec.disabled = item.qty <= 1;
    inc.disabled = item.qty >= max;
    dec.addEventListener("click", () => setQty(index, item.qty - 1));
    inc.addEventListener("click", () => setQty(index, item.qty + 1));
    frag.querySelector("[data-remove]").addEventListener("click", () => {
      const next = bag.items().filter((_, i) => i !== index);
      bag.write(next);
      render();
      if (next.length) refresh();
    });
    linesEl.append(frag);
  });
  footEl.hidden = false;
  drawer.querySelector("[data-bag-subtotal]").textContent = fmt(subtotal);
  const note = drawer.querySelector("[data-bag-shipnote]");
  if (lastServer) {
    const { shipping, freeOver } = lastServer;
    note.textContent =
      shipping === 0 && subtotal > 0
        ? "Free NZ shipping on this order."
        : freeOver && subtotal < freeOver
          ? `${fmt(shipping)} NZ shipping. Spend ${fmt(freeOver - subtotal)} more for free shipping.`
          : `${fmt(shipping)} NZ shipping, added at checkout.`;
  } else note.textContent = "Shipping is added at checkout.";
  const btn = drawer.querySelector("[data-checkout]");
  btn.disabled = blocked;
  if (blocked) showError("Remove or change the items marked above to check out.");
}

function setQty(index, qty) {
  const items = bag.items().slice();
  items[index] = { ...items[index], qty: Math.max(1, Math.min(10, qty)) };
  bag.write(items);
  render();
  refresh();
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

let refreshToken = 0;
async function refresh() {
  const items = bag.items();
  if (!items.length) return;
  const token = ++refreshToken;
  try {
    const res = await fetch("/api/cart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: items.map(({ id, size, qty }) => ({ id, size, qty })) }),
    });
    const data = await res.json();
    if (token !== refreshToken || !res.ok) return;
    lastServer = data;
    // Keep saved titles/prices in sync with the shop and drop products that were deleted.
    const next = bag
      .items()
      .map((i) => {
        const l = data.lines.find((x) => x.id === i.id && x.size === i.size);
        return l && !l.gone ? { ...i, title: l.title, price: l.price, image: l.image, slug: l.slug } : l?.gone ? null : i;
      })
      .filter(Boolean);
    if (next.length !== bag.items().length) bag.write(next);
    else bag.write(next);
    render();
  } catch {
    /* offline: keep showing the saved bag */
  }
}

async function checkout(btn) {
  btn.setAttribute("aria-busy", "true");
  const label = btn.innerHTML;
  btn.textContent = "Opening secure checkout…";
  errorEl.hidden = true;
  try {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: bag.items().map(({ id, size, qty }) => ({ id, size, qty })) }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) {
      window.location.assign(data.url);
      return;
    }
    if (data.lines) {
      lastServer = { ...(lastServer || {}), lines: data.lines };
      render();
    }
    showError(data.error || "We couldn't start checkout. Please try again.");
  } catch {
    showError("You seem to be offline. Check your connection and try again.");
  }
  btn.removeAttribute("aria-busy");
  btn.innerHTML = label;
}

if (drawer) {
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-open-bag]")) openBag();
    if (e.target.closest("[data-close-bag]")) closeBag();
    const co = e.target.closest("[data-checkout]");
    if (co && !co.disabled) checkout(co);
  });
  drawer.addEventListener("click", (e) => {
    if (e.target === drawer) closeBag(); // backdrop click
  });
  drawer.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeBag();
  });
}

// ---------- Add to bag ----------
document.querySelectorAll("[data-add-to-bag]").forEach((form) => {
  const product = JSON.parse(form.dataset.addToBag);
  const err = form.querySelector("[data-buy-error]");
  const fieldset = form.querySelector(".sizes");
  form.addEventListener("change", () => {
    err.hidden = true;
    fieldset?.removeAttribute("data-invalid");
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const chosen = form.querySelector('input[name="size"]:checked');
    if (!chosen) {
      err.textContent = "Pick a size first.";
      err.hidden = false;
      fieldset?.setAttribute("data-invalid", "");
      form.querySelector('input[name="size"]:not(:disabled)')?.focus();
      return;
    }
    const inBag = bag.items().find((i) => i.id === product.id && i.size === chosen.value);
    if (inBag && inBag.qty >= Number(chosen.dataset.stock)) {
      err.textContent = `You already have all ${chosen.dataset.stock} in your bag.`;
      err.hidden = false;
      openBag();
      return;
    }
    addItem(product, chosen.value);
    openBag();
  });
});

// ---------- Product gallery ----------
document.querySelectorAll("[data-gallery]").forEach((g) => {
  const track = g.querySelector(".pdp__main");
  const thumbs = [...g.querySelectorAll("[data-goto]")];
  thumbs.forEach((t) =>
    t.addEventListener("click", () => {
      const i = Number(t.dataset.goto);
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      track.scrollTo({ left: track.clientWidth * i, behavior: reduce ? "auto" : "smooth" });
    })
  );
  track.addEventListener(
    "scroll",
    () => {
      const i = Math.round(track.scrollLeft / track.clientWidth);
      thumbs.forEach((t, j) => (j === i ? t.setAttribute("aria-current", "true") : t.removeAttribute("aria-current")));
    },
    { passive: true }
  );
});

// ---------- Sort auto-submit ----------
document.querySelectorAll("[data-autosubmit] select").forEach((s) => s.addEventListener("change", () => s.form.submit()));

// ---------- Reveal on scroll ----------
const reveals = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window && reveals.length) {
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add("is-in");
          io.unobserve(en.target);
        }
      }),
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
  );
  reveals.forEach((el, i) => {
    el.style.transitionDelay = `${(i % 4) * 60}ms`;
    io.observe(el);
  });
} else reveals.forEach((el) => el.classList.add("is-in"));

// ---------- After checkout ----------
if (document.querySelector('[data-clear-bag="1"]')) bag.write([]);
if (new URLSearchParams(location.search).get("bag") === "open") {
  history.replaceState(null, "", location.pathname + location.search.replace(/[?&]bag=open/, "").replace(/^&/, "?"));
  openBag();
}

updateCount();
