# Your Girls Favourite Resellers: online shop

A streetwear shop with product pages, a bag, card checkout through Stripe (Apple Pay and Google Pay show up automatically), and a password-protected admin area where you add products, upload photos, and see orders to ship.

It has **no dependencies**: plain Node on Vercel Functions, with Redis storage (Upstash, free tier) and Stripe's API. There's nothing to install or build, so deploys can't break on packages.

---

## Go live on Vercel (about 20 minutes)

You need free accounts at **github.com**, **vercel.com** and **stripe.com**.

### 1. Put the code on GitHub
1. On GitHub, click **New repository**, name it `ygfr-shop`, keep it **Private**, and create it.
2. On the empty repo page, click **uploading an existing file**, drag in everything inside this folder (not the folder itself), then **Commit changes**.

### 2. Create the Vercel project
1. In Vercel, click **Add New > Project**, pick the `ygfr-shop` repo, then **Import**.
2. Leave **Framework Preset** as **Other**. Don't change the build settings. Click **Deploy**.
   The first visit will say "Setting up shop" until storage is connected. That's expected.

### 3. Connect storage (free)
1. In the project, open the **Storage** tab, then **Create Database**, and choose **Upstash for Redis** on the free plan.
2. Connect it to the project for all environments. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you.

### 4. Add your secrets
In **Settings > Environment Variables**, add:

| Name | Value |
| --- | --- |
| `ADMIN_PASSWORD` | A strong password for `/admin` |
| `SESSION_SECRET` | Any long random text (mash the keyboard, 40+ characters) |
| `STRIPE_SECRET_KEY` | Stripe **Developers > API keys > Secret key**. Start with `sk_test_…` |
| `STRIPE_WEBHOOK_SECRET` | From step 5 |

### 5. Connect Stripe webhooks
This is how paid orders reach your admin page and stock goes down.
1. In Stripe, go to **Developers > Webhooks > Add endpoint**.
2. Endpoint URL: `https://YOUR-SITE.vercel.app/api/stripe/webhook`
3. Events: `checkout.session.completed` and `checkout.session.expired`.
4. Copy the **Signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET` in Vercel.

### 6. Redeploy and test
1. In Vercel, go to **Deployments**, open the ⋯ menu on the latest deployment, and choose **Redeploy** so the new variables apply.
2. Buy something with Stripe's test card `4242 4242 4242 4242`, any future expiry date, and any CVC.
3. Check that the order shows at `/admin/orders`.

### 7. Before launch
- Go to **/admin > Settings** and rewrite the **shipping and returns policies** so they match how you actually work. They start as example text.
- Add your contact email and Instagram or TikTok handles.
- Delete or replace the demo products, and add your real ones.
- In Stripe, finish activating your account. Then swap `STRIPE_SECRET_KEY` for the **live** key (`sk_live_…`), create a live-mode webhook the same way as step 5, update `STRIPE_WEBHOOK_SECRET`, and redeploy.
- Optional: add your own domain under **Settings > Domains**. If you do, update the Stripe webhook URL to match.

---

## Running the shop day to day
- **Add a product:** go to `/admin` and click **Add Product**. Photos are resized in your browser, so phone photos are fine. The first photo is the cover. For a one-off piece, use one size with stock 1.
- **Orders:** `/admin/orders` lists paid orders with the customer's shipping address. Click **Mark as Shipped** once it's sent. Stripe emails the customer a receipt if receipts are turned on (Stripe **Settings > Customer emails**).
- **Stock:** stock goes down automatically when a payment succeeds. While someone is on the payment page, their items are held for 45 minutes, so the last piece can't sell twice.
- **Shipping:** set the NZ flat rate and the free-shipping threshold in `/admin > Settings`. Checkout is set to ship to New Zealand only.

## Limits worth knowing
- Photos are stored in Upstash Redis. The free tier (256 MB) holds roughly 400 to 800 photos at the sizes this shop uploads. If you outgrow it, upgrade Upstash (pay as you go).
- Payment is by card only for now (plus Apple Pay and Google Pay). Afterpay can be added later by turning it on in Stripe and adding `afterpay_clearpay` to `payment_method_types` in `lib/app.js`.
- There's one admin password. Anyone you share it with has full access.

## Brand note
The logo on the site and products was recreated without the Betty Boop character from the original artwork. Betty Boop is owned by King Features / Fleischer Studios. Selling products with her on them needs a licence, and Stripe can close accounts over unlicensed character merch.

## Local development (optional)
You need Node 20 or newer.
```
npm run dev
```
Then open http://localhost:3000. The admin password is `letmein`. Without keys, it uses built-in stand-ins for storage and Stripe (including a fake payment page), so you can click through a whole purchase offline. To use real Stripe test mode locally, copy `.env.example` to `.env.local` and fill it in.

`npm test` runs the end-to-end test (needs `npm i -D playwright`).

## Where things are
```
api/index.js          Vercel Function entry (every page and API goes through here)
lib/app.js            routes, checkout, Stripe webhook, admin actions
lib/db.js             storage (products, images, orders, settings, stock holds)
lib/stripe.js         Stripe API calls + webhook signature check
lib/views/            page templates (store + admin)
public/               CSS, browser JS, fonts, images
dev/                  local server, Redis/Stripe stand-ins, end-to-end test
```
Fonts: Shrikhand and Geist (SIL Open Font License, see `public/fonts`). Icons: Phosphor (MIT).
