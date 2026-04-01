# xdipx.com — Claude Code Project Guide

## What This Is

Daily flash-sale storefront for sexual wellness products. One featured deal per day (like meh.com). Built on React Router v7 framework mode + Express + Shopify headless.

**Live goal:** $2,000/month profit within 3 months of launch.

## Critical Patterns — Read Before Writing Any Code

### React Router v7 Framework Mode Only

Data **always** flows through `loader → useLoaderData`. Mutations go through `action → useFetcher` or form submissions. **Never** `useEffect` for data fetching. No Next.js patterns anywhere.

```ts
// ✅ Correct
export async function loader({ request }: LoaderFunctionArgs) {
  return { deal: await getDailyDeal() }
}
export default function Page() {
  const { deal } = useLoaderData<typeof loader>()
}

// ❌ Wrong
useEffect(() => { fetch('/api/deal').then(...) }, [])
```

### `.server.ts` Suffix Is Mandatory

All server-only files end in `.server.ts`. React Router tree-shakes these from the client bundle. **Never** import a `.server.ts` file from a client component.

```
app/lib/shopify.server.ts    ← server only
app/lib/db.server.ts         ← server only
app/components/store/AgeGate.tsx  ← client OK
```

### Shopify Is Source of Truth

No hardcoded product data anywhere except `db/seed.ts`. All product data comes from Shopify Storefront API via `app/lib/shopify.server.ts`.

### Admin = Approval Only

AI generates content; humans approve. The `admin/today` route has an approval toggle. **Never** auto-publish a deal without `deal_status: approved` in Shopify metafield.

### Mobile-First

Build and test at 375px first. Most traffic will be mobile. Use responsive classes in order: base (375px) → `sm:` → `md:` → `lg:`.

## Tech Stack

| Layer | Tool |
|---|---|
| Framework | React Router v7 (framework mode, SSR) |
| Server | Express via `@react-router/express` |
| Hosting | Vercel (Node.js serverless) |
| Commerce | Shopify Storefront + Admin APIs |
| Fulfillment | Nalpac Shopify App |
| Email | Klaviyo |
| AI Copy | Anthropic Claude API (`claude-sonnet-4-20250514`) |
| AI Image | Google Imagen via Vertex AI |
| Payments | Segpay or Verotel (high-risk — NOT Stripe/PayPal) |
| Styling | Tailwind CSS v4 (CSS-first config) |
| Cart State | Shopify Storefront API cart mutations |
| Animations | Motion (formerly Framer Motion) |
| Database | Neon Postgres (Drizzle ORM) |
| KV Cache | Vercel KV |
| Analytics | Google Analytics 4 |

## Brand Design Tokens

Colors live in `app/app.css` as `@theme` variables:

| Token | Value | Use |
|---|---|---|
| `brand-coral` | `#F04E37` | Primary CTA, logo left |
| `brand-orange` | `#FF8C38` | Gradient end, logo right |
| `brand-purple` | `#7B2FBE` | Hearts, accent, active states |
| `brand-purple-light` | `#A855F7` | Hover states, tags |
| `brand-cream` | `#FFF8F4` | Page background |
| `brand-charcoal` | `#1E1A2E` | Body text |
| `brand-mist` | `#F5EEF8` | Light section backgrounds |

Gradient: `bg-brand-gradient` → `linear-gradient(to right, #F04E37, #FF8C38)`
Gradient text: `.text-brand-gradient` (CSS class in app.css)

Fonts:
- `font-display` → `Poppins` (headlines, CTAs, nav)
- `font-body` → `Inter` (body copy)

Brand motif: `♥` purple heart — use as bullet points, CTA labels ("Dip In ♥"), section dividers.

## File Structure (Key Files)

```
server/
  index.ts          ← Express entry + React Router adapter
  cron.ts           ← Cron job handlers
  webhooks.ts       ← Shopify webhook HMAC verification

app/
  root.tsx          ← HTML shell, global loader (cart, UTM, ENV)
  app.css           ← Tailwind @theme tokens + utilities
  routes.ts         ← flatRoutes() config
  types/index.ts    ← Shared TypeScript types

  lib/
    shopify.server.ts      ← ALL Shopify API calls live here
    claude.server.ts       ← Anthropic API wrapper
    imagen.server.ts       ← Google Imagen wrapper
    klaviyo.server.ts      ← Klaviyo API wrapper
    feed-processor.server.ts ← Nalpac CSV fetch + scoring
    deal-activator.server.ts ← Midnight deal rotation
    profit.server.ts       ← Profit calculation + DB writes
    db.server.ts           ← Neon + Drizzle client
    kv.server.ts           ← Vercel KV client
    session.server.ts      ← Cookie session (admin auth)
    cart.server.ts         ← Cart cookie helpers
    attribution.server.ts  ← UTM + ref capture
    consent.server.ts      ← CCPA/GDPR consent logging

  routes/
    _layout.tsx            ← Store layout (Navbar, Footer, TrustBar)
    _layout._index.tsx     ← Homepage (daily deal PDP)
    _layout.checkout-extras.tsx
    _layout.products.$slug.tsx  ← Canonical product URL
    _layout.vault.tsx
    _layout.vault.$slug.tsx
    _layout.for-him.tsx
    _layout.for-her.tsx
    _layout.faq.tsx
    _layout.about.tsx
    admin.tsx              ← Admin layout (auth guard)
    admin._index.tsx
    admin.login.tsx
    admin.queue.tsx
    admin.today.tsx
    admin.generate.tsx
    admin.emails.tsx
    api.generate-copy.tsx
    api.generate-image.tsx
    api.klaviyo.tsx
    api.consent.tsx
    api.waitlist.tsx
    api.webhooks.order-created.tsx

db/
  schema.ts          ← Drizzle ORM schema
  seed.ts            ← Dev seed data
```

## Nalpac Feed

**Feed URL:** `https://productfeeds.wyomind.com/feeds/1s6o37vbh23/nal-top-100.csv`

**Critical encoding bug:** Every apostrophe arrives as `ft.` and every opening quote as `in.`. Always run `cleanDescription()` from `feed-processor.server.ts` before storing or displaying any text. Do NOT replace `in.` after digits (those are inches in dimension specs).

**Scoring weights:** Profitability 35% | Deal-ability 30% | Inventory 20% | Images 10% | Category Freshness 5%

**MAP pricing rules:**
- MAP = 0 → price at 45–50% off MSRP, copy says "X% off today only"
- MAP < MSRP → use MAP as floor, note "best price we're allowed to advertise"
- MAP = MSRP → cannot advertise discount, use as accessory not daily deal

## Shopify Metafields

**Namespace: `xdipx`** on Product objects:
- `is_daily_deal`, `deal_date`, `deal_status` (pending_approval|approved|live|archived)
- `original_price`, `wholesale_cost`, `map_price`, `deal_score`
- `tagline`, `full_story`, `works_for_him`, `works_for_her`, `feature_bullets` (JSON)
- `accessory_product_ids` (JSON), `mood_image_url`, `category`, `nalpac_sku`, `seo_meta_description`

## URL / Canonical Strategy (Day-1 Non-Negotiable)

1. `/products/{slug}` is the canonical URL for every product — never changes
2. Homepage renders deal inline — does NOT redirect to `/products/{slug}`
3. Homepage canonical: `https://xdipx.com/` (points to itself)
4. Vault links to `/products/{slug}` — no duplicate content
5. Recycled products reuse same URL with updated `deal_date` — 200 response
6. Shopify product `handle` = SEO slug — set explicitly on import, **never auto-generate**

## Cron Schedule

| Route | Schedule | Action |
|---|---|---|
| `/cron/daily-feed-processor` | 11:45 PM | Fetch Nalpac CSV, score products, stage tomorrow's deal |
| `/cron/deal-activator` | 11:59 PM | Archive today → activate tomorrow → trigger Klaviyo |
| `/cron/profit-summary` | 12:05 AM | Write daily_profit_summary to Neon |

Cron routes protected by `x-cron-secret` header matching `CRON_SECRET` env var.

## Claude API Voice

System prompt (always include):
> You are the voice of xdipx.com — a daily flash-sale site for sexual wellness products. Brand voice: playful, cheeky, warm, curious. Never clinical. Never sleazy. Write as a trusted, funny friend who isn't embarrassed about the topic. Keep all copy tasteful — suggestive is fine, explicit is not. Never use "sex" as an adjective — use "intimate", "pleasure", or "wellness". Never assume the reader's experience level.

Model: `claude-sonnet-4-20250514`

## Oxygen Migration Path

React Router v7 framework mode IS the same framework as Shopify Oxygen/Hydrogen. Migration later requires:
1. Swap `@react-router/express` adapter for `@shopify/remix-oxygen`
2. Replace `<img>` with Hydrogen `<Image>`, add `<Money>` for prices
3. Add `<CartProvider>` to root, replace raw cart mutations with `useCart()`
4. Move env vars to Oxygen CLI secrets
5. Replace Vercel Cron with Inngest or Upstash Qstash

**Keep all Shopify calls in `app/lib/shopify.server.ts`** — single file to swap.
**Keep all Vercel-specific code in `server/index.ts`** — never import `@vercel/kv` inside `app/`.

## Phase 1 Launch Checklist

- [ ] Age gate renders before all content, persists 30 days
- [ ] Homepage daily deal loads from Shopify via loader
- [ ] Countdown timer accurate, resets at midnight
- [ ] "Dip In ♥" → checkout-extras → Shopify checkout end-to-end
- [ ] Email subscribe posts to Klaviyo
- [ ] Admin: login, queue, deal editor, AI generation, approval toggle
- [ ] Cron rotates deal at midnight
- [ ] Order webhook writes wholesale cost metafield
- [ ] UTM + ref capture on all page loads
- [ ] JSON-LD on homepage, product pages, FAQ
- [ ] Canonical tags correct on all pages
- [ ] Mobile responsive at 375px
- [ ] Nalpac app installed on Shopify backend
