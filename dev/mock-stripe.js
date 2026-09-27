// Local stand-in for Stripe Checkout, used when no real Stripe key is set.
// Implements the two API calls the shop makes, plus a fake payment page that
// sends a signed checkout.session.completed webhook like Stripe does.
import http from "node:http";
import { signPayload } from "../lib/stripe.js";

function parseNested(body) {
  const out = {};
  for (const [key, value] of new URLSearchParams(body)) {
    const parts = key.replace(/\]/g, "").split("[");
    let node = out;
    parts.forEach((p, i) => {
      const last = i === parts.length - 1;
      const nextIsIndex = !last && /^\d+$/.test(parts[i + 1]);
      if (last) node[p] = value;
      else node = node[p] ||= nextIsIndex ? [] : {};
    });
  }
  return out;
}

export function startMockStripe({ port = 8078, appUrl, webhookSecret, secretKey }) {
  const sessions = {};
  const base = `http://127.0.0.1:${port}`;
  const send = (res, status, data, type = "application/json") => {
    res.writeHead(status, { "content-type": type });
    res.end(type === "application/json" ? JSON.stringify(data) : data);
  };

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const url = new URL(req.url, base);
      if (url.pathname.startsWith("/v1/")) {
        if (req.headers.authorization !== `Bearer ${secretKey}`) return send(res, 401, { error: { message: "Invalid API Key provided" } });
      }
      if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
        const p = parseNested(body);
        if (p.mode !== "payment") return send(res, 400, { error: { message: "mode must be payment" } });
        if (!p.payment_method_types || p.payment_method_types[0] !== "card") return send(res, 400, { error: { message: "expected card" } });
        if (!p.success_url?.includes("{CHECKOUT_SESSION_ID}")) return send(res, 400, { error: { message: "success_url missing placeholder" } });
        const items = (p.line_items || []).map((li) => ({ qty: Number(li.quantity), amount: Number(li.price_data.unit_amount), name: li.price_data.product_data.name, currency: li.price_data.currency }));
        if (items.some((i) => i.currency !== "nzd" || !(i.amount > 0))) return send(res, 400, { error: { message: "bad line item" } });
        const shipping = Number(p.shipping_options?.[0]?.shipping_rate_data?.fixed_amount?.amount || 0);
        const subtotal = items.reduce((n, i) => n + i.amount * i.qty, 0);
        const id = "cs_test_" + Math.random().toString(36).slice(2, 12);
        sessions[id] = {
          id,
          object: "checkout.session",
          url: `${base}/pay/${id}`,
          mode: "payment",
          status: "open",
          payment_status: "unpaid",
          client_reference_id: p.client_reference_id,
          metadata: p.metadata || {},
          amount_subtotal: subtotal,
          amount_total: subtotal + shipping,
          currency: "nzd",
          success_url: p.success_url,
          cancel_url: p.cancel_url,
          _items: items,
          _shipping: shipping,
        };
        return send(res, 200, sessions[id]);
      }
      let m;
      if (req.method === "GET" && (m = url.pathname.match(/^\/v1\/checkout\/sessions\/(.+)$/))) {
        const s = sessions[m[1]];
        return s ? send(res, 200, s) : send(res, 404, { error: { message: "No such checkout.session" } });
      }
      if ((m = url.pathname.match(/^\/pay\/(.+)$/))) {
        const s = sessions[m[1]];
        if (!s) return send(res, 404, "Session not found", "text/plain");
        const fmt = (c) => new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(c / 100);
        if (req.method === "GET") {
          return send(res, 200, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test checkout</title>
<style>body{font:16px/1.5 system-ui;background:#f6f9fc;margin:0;display:grid;place-items:center;min-height:100vh}main{background:#fff;padding:32px;border-radius:12px;width:min(420px,92vw);box-shadow:0 8px 30px #0001}button,a{display:block;width:100%;padding:14px;border-radius:8px;border:0;font:600 16px system-ui;margin-top:12px;text-align:center}button{background:#635bff;color:#fff;cursor:pointer}a{color:#555}label{display:block;margin-top:12px;font-size:14px}input{width:100%;padding:10px;border:1px solid #ccd;border-radius:6px;box-sizing:border-box}</style></head>
<body><main><p style="color:#635bff;font-weight:700">TEST MODE (local mock of Stripe Checkout)</p>
${s._items.map((i) => `<p>${i.name} &times; ${i.qty}<span style="float:right">${fmt(i.amount * i.qty)}</span></p>`).join("")}
<p>Shipping<span style="float:right">${fmt(s._shipping)}</span></p><p><strong>Total<span style="float:right">${fmt(s.amount_total)}</span></strong></p>
<form method="post"><label>Email<input name="email" value="test.buyer@example.com"></label><label>Name<input name="name" value="Aroha Test"></label><label>Card number<input value="4242 4242 4242 4242" readonly></label>
<button type="submit" id="pay">Pay ${fmt(s.amount_total)}</button></form><a href="${s.cancel_url}">Back to shop</a></main></body></html>`, "text/html");
        }
        const form = new URLSearchParams(body);
        Object.assign(s, {
          status: "complete",
          payment_status: "paid",
          payment_intent: "pi_test_" + Math.random().toString(36).slice(2, 10),
          customer_details: { email: form.get("email"), name: form.get("name"), phone: "+64211234567", address: { country: "NZ" } },
          shipping_details: { name: form.get("name"), address: { line1: "12 Test Street", city: "Auckland", postal_code: "1010", country: "NZ" } },
        });
        const event = JSON.stringify({ id: "evt_test", type: "checkout.session.completed", data: { object: s } });
        try {
          const r = await fetch(`${appUrl}/api/stripe/webhook`, {
            method: "POST",
            headers: { "content-type": "application/json", "stripe-signature": signPayload(event, webhookSecret) },
            body: event,
          });
          console.log(`[mock-stripe] webhook -> ${r.status}`);
        } catch (e) {
          console.log("[mock-stripe] webhook failed", e.message);
        }
        res.writeHead(303, { location: s.success_url.replace("{CHECKOUT_SESSION_ID}", s.id) });
        return res.end();
      }
      send(res, 404, { error: { message: "Unknown mock endpoint" } });
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, base })));
}
