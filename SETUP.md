# xdipx.com — Operator Setup Guide

Follow this checklist in order. Each step has a "done when" checkpoint.

---

## 1. Prerequisites

- [ ] Node.js 20+ installed (`node --version`)
- [ ] A Shopify Partner account with a development store
- [ ] A Vercel account
- [ ] A Klaviyo account (free tier is fine to start)
- [ ] A Neon Postgres account (free tier)
- [ ] Google Workspace (for hello@xdipx.com)

---

## 2. Clone & Install

```bash
git clone <your-repo>
cd xdipx_store
npm install
cp .env.example .env
```

**Done when:** `npm install` completes with no errors.

---

## 3. Shopify Setup

### 3a. Create your Shopify store
1. Log in to partners.shopify.com → Stores → Add store → Development store
2. Store name: `xdipx` (or anything — the URL is what matters)

### 3b. Create Collections
In your Shopify admin → Products → Collections, create these:
- `daily-deal`
- `for-him`
- `for-her`
- `accessories`
- `vault`
- `bonus-deal`

### 3c. Create Product Metafields
Admin → Settings → Custom data → Products → Add definition for each:

| Namespace | Key | Type |
|---|---|---|
| xdipx | is_daily_deal | Boolean |
| xdipx | deal_date | Date |
| xdipx | deal_status | Single line text |
| xdipx | original_price | Decimal |
| xdipx | wholesale_cost | Decimal |
| xdipx | map_price | Decimal |
| xdipx | deal_score | Decimal |
| xdipx | tagline | Single line text |
| xdipx | full_story | Multi-line text |
| xdipx | works_for_him | Multi-line text |
| xdipx | works_for_her | Multi-line text |
| xdipx | feature_bullets | JSON |
| xdipx | accessory_product_ids | JSON |
| xdipx | mood_image_url | URL |
| xdipx | category | Single line text |
| xdipx | nalpac_sku | Single line text |
| xdipx | seo_meta_description | Multi-line text |

### 3d. Get API credentials
1. Admin → Settings → Apps → Develop apps → Create app → "xdipx Headless"
2. Configure Storefront API scopes: `unauthenticated_read_product_listings`, `unauthenticated_read_collection_listings`, `unauthenticated_write_checkouts`, `unauthenticated_read_checkouts`
3. Configure Admin API scopes: `read_products`, `write_products`, `read_orders`, `write_orders`, `read_inventory`
4. Install app → copy both tokens into `.env`:

```env
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_STOREFRONT_ACCESS_TOKEN=your-storefront-token
SHOPIFY_ADMIN_ACCESS_TOKEN=your-admin-token
```

**Done when:** You can navigate to your Shopify admin with no errors.

---

## 4. Neon Postgres Setup

1. Sign up at neon.tech → New project → "xdipx"
2. Copy the connection string to `.env`:
   ```env
   DATABASE_URL=postgresql://...
   ```
3. Run migrations:
   ```bash
   npm run db:generate
   npm run db:migrate
   ```
4. (Optional) Seed dev data:
   ```bash
   npm run db:seed
   ```

**Done when:** `npm run db:migrate` completes. Run `npm run db:seed` to populate placeholder deals.

---

## 5. Klaviyo Setup

### 5a. Create API key
Klaviyo account → Settings → API Keys → Create private key → Full access
```env
KLAVIYO_API_KEY=pk_...
```

### 5b. Create lists
1. Audience → Lists & Segments → Create List
   - "Daily Deal Subscribers" → copy ID to `KLAVIYO_LIST_ID_DAILY_DEAL`
   - "Waitlist" → copy ID to `KLAVIYO_LIST_ID_WAITLIST`

### 5c. Configure email sending domain
Settings → Sending domains → Add domain → `mail.xdipx.com`
Copy the DNS records shown and add them to your domain (see DNS section below).

**Done when:** Klaviyo shows `mail.xdipx.com` as verified.

---

## 6. DNS Configuration (xdipx.com)

Add these records at your domain registrar:

```
# Klaviyo email authentication
TXT   @                 "v=spf1 include:klaviyomail.com ~all"
CNAME klaviyo1._domainkey   [from Klaviyo dashboard]
CNAME klaviyo2._domainkey   [from Klaviyo dashboard]
TXT   _dmarc            "v=DMARC1; p=none; rua=mailto:dmarc@xdipx.com"
CNAME mail               [from Klaviyo dashboard]
```

**After DNS propagates (24–48h):** Go to Klaviyo → Sending domains → Verify.

**⚠️ Do not send any Klaviyo emails before DNS is verified.** Spam complaints before domain reputation is established are very hard to recover from.

---

## 7. Anthropic (Claude) API

1. console.anthropic.com → API Keys → Create key
2. ```env
   ANTHROPIC_API_KEY=sk-ant-...
   ```

**Done when:** You can test content generation in the admin panel.

---

## 8. Vercel KV (Optional for Launch — Needed for Social Proof)

1. Vercel dashboard → your project → Storage → Create database → KV
2. Copy all four KV env vars to your Vercel project settings and local `.env`

---

## 9. Admin Password

Generate a strong password and session secret:

```bash
# Generate SESSION_SECRET (32+ chars)
openssl rand -hex 32

# Pick a strong ADMIN_PASSWORD
```

Add to `.env`:
```env
ADMIN_PASSWORD=your-strong-password
SESSION_SECRET=<output-from-openssl>
CRON_SECRET=<another-random-hex>
```

---

## 10. Payment Processor

You need a **high-risk payment processor**. Stripe and PayPal do not allow adult content.

Options:
- **Segpay** — segpay.com → Merchant application → Adult content
- **Verotel** — verotel.com → Sign up → Adult merchant

This takes 1–2 weeks to get approved. Apply early.

Once approved, you'll connect via Shopify's payment gateway settings. Set:
```env
SEGPAY_MERCHANT_ID=...
SEGPAY_API_KEY=...
```

**⚠️ Do not launch to real customers without a payment processor.** The default Shopify Payments does not support this category.

---

## 11. Install Nalpac App on Shopify

1. Log in to your Nalpac account
2. Install the Nalpac Shopify app from the Shopify App Store
3. Connect it to your store → it will sync inventory and route orders automatically

**Done when:** Nalpac app shows "Connected" in your Shopify admin.

---

## 12. Configure Shopify Webhooks

Admin → Settings → Notifications → Webhooks → Create webhook:
- Event: `Order creation`
- Format: JSON
- URL: `https://xdipx.com/webhooks/order-created`
- Newest API version

Copy the signing secret to `.env`:
```env
SHOPIFY_WEBHOOK_SECRET=your-webhook-secret
```

---

## 13. Google Analytics 4

1. analytics.google.com → Create property → "xdipx.com"
2. Copy measurement ID (format: G-XXXXXXXXXX):
   ```env
   GA4_MEASUREMENT_ID=G-XXXXXXXXXX
   ```
3. (Optional) To load Google Tag Manager alongside GA4 — lets marketing add/update pixels (Meta, TikTok, ads) without code deploys — create a container at tagmanager.google.com and set:
   ```env
   GTM_CONTAINER_ID=GTM-XXXXXXX
   ```
   GTM respects the same Consent Mode v2 defaults (all denied) until the user accepts cookies. Leave blank to disable.

---

## 14. Google Workspace Email

1. workspace.google.com → Create account for xdipx.com
2. Set up `hello@xdipx.com` for customer service

---

## 15. Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set all environment variables in Vercel dashboard:
# Project → Settings → Environment Variables
# Add every key from .env.example
```

Or connect via GitHub → Vercel will auto-deploy on push to main.

**Done when:** `https://xdipx.com` loads the age gate.

---

## 16. First Product Setup

1. Log in to `/admin` with your `ADMIN_PASSWORD`
2. Go to **AI Generator** → paste a Nalpac product's data → generate all copy
3. Create a product in Shopify admin with the generated copy
4. Set the xdipx metafields on the product:
   - `wholesale_cost` → your cost from Nalpac
   - `original_price` → MSRP from Nalpac
   - `nalpac_sku` → the Nalpac SKU
   - Set variant `price` to your selling price, `compare_at_price` to MSRP
5. Set the Shopify product status to **Active** so the Storefront API serves it

Daily deals are retired: there is no `deal_status` / `deal_date` metafield, no
`deal-status-*` tag, and no midnight rotation. A product is live when Shopify
says it is active, and gone when Shopify says it is archived.

---

## 17. Pre-Launch Checklist

- [ ] Age gate loads and persists to localStorage
- [ ] Homepage shows deal correctly on mobile (test at 375px)
- [ ] "Dip In ♥" button → checkout-extras → Shopify checkout (end-to-end)
- [ ] Email subscribe form posts to Klaviyo
- [ ] `/admin` login works, deal editor saves to Shopify
- [ ] Test webhook: place a test order → check Shopify order metafields for profit data
- [ ] Canonical URLs correct (check source on homepage and `/products/{slug}`)
- [ ] JSON-LD present on homepage — test at https://search.google.com/test/rich-results
- [ ] All DNS records propagated and Klaviyo domain verified
- [ ] Payment processor approved and connected
- [ ] Cron jobs tested in staging at 11:45 PM and 11:59 PM

---

## 18. Email Warm-Up Schedule

Follow this exactly to protect domain reputation:

| Days | Max sends/day |
|------|--------------|
| 1–3  | 50           |
| 4–7  | 100          |
| 8–14 | 500          |
| 15–21| 2,000        |
| 22+  | 5,000+       |

**Never** send to unengaged contacts during warm-up.
**Spam complaint rate above 0.1% will damage your domain permanently.**

---

## Environment Variables Reference

See `.env.example` for all variables. Key ones for launch:

| Variable | Required | Where |
|---|---|---|
| SHOPIFY_STORE_DOMAIN | ✅ | Shopify admin |
| SHOPIFY_STOREFRONT_ACCESS_TOKEN | ✅ | Shopify API |
| SHOPIFY_ADMIN_ACCESS_TOKEN | ✅ | Shopify API |
| SHOPIFY_WEBHOOK_SECRET | ✅ | Shopify Webhooks |
| ANTHROPIC_API_KEY | ✅ | console.anthropic.com |
| DATABASE_URL | ✅ | Neon dashboard |
| KLAVIYO_API_KEY | ✅ | Klaviyo settings |
| KLAVIYO_LIST_ID_DAILY_DEAL | ✅ | Klaviyo lists |
| KLAVIYO_LIST_ID_WAITLIST | ✅ | Klaviyo lists |
| ADMIN_PASSWORD | ✅ | You choose |
| SESSION_SECRET | ✅ | `openssl rand -hex 32` |
| CRON_SECRET | ✅ | `openssl rand -hex 32` |
| GA4_MEASUREMENT_ID | At launch | Google Analytics |
| GTM_CONTAINER_ID | Optional | Google Tag Manager container |
| AGE_GATE_LEVEL | Optional | `click_through` default |
| CURRENT_TOS_VERSION | Optional | `1.0` default |

---

## Support

Questions? hello@xdipx.com
