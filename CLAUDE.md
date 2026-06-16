# xdipx.com — Claude Code Project Guide

## What This Is

Editorially-curated sexual-wellness storefront. Emma picks a featured product on an irregular cadence ("Emma's picks"); the cron infra still rotates at midnight, but the UI never surfaces a countdown or "until midnight" language. Built on React Router v7 framework mode + Express + Shopify headless.

**Live goal:** $2,000/month profit within 3 months of launch.

**Voice:** Emma — a trusted, funny friend and editorial curator. Never "Buy now" — "Take a peek →" / "I'll take it ♥". Never "sex" as an adjective — intimate, pleasure, wellness, satisfaction. Never countdowns. Always an Emma advisory aside on hero/cards ("the one I'd point you to for slow nights," etc.). Emma is an AI guide: she advises on how a product works and could work for the reader, and must NEVER claim she has used, tried, tested, or owned it ("been living on my desk", "I reach for this" are wrong). Avoid reusing the same coined phrase across deals — fresh, product-specific language every time.

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
| AI Copy | Anthropic Claude API (`claude-sonnet-4-6`) |
| AI Image | Google Imagen via Vertex AI |
| Payments | Segpay or Verotel (high-risk — NOT Stripe/PayPal) |
| Styling | Tailwind CSS v4 (CSS-first config) |
| Cart State | Shopify Storefront API cart mutations |
| Animations | Motion (formerly Framer Motion) |
| Database | Neon Postgres (Drizzle ORM) |
| KV Cache | Vercel KV |
| Analytics | Google Analytics 4 |

## Brand Design Tokens (v3 — Style Guide Nº 01, Spring 2026)

> **White paper. Coral for life. Plum for emphasis.** Colors live in `app/app.css` as `@theme` variables. Tailwind utilities use the token name directly (`bg-paper`, `text-ink`, `bg-coral`). Prefer the v3 names below. The v2 names (`cream`, `cream-2`, `muted`, `coral-deep`, `sun`, `butter`, `font-script`) are kept as **legacy aliases** mapped onto the v3 palette so old utility classes still compile — do not use them in new code.

| Token | Value | Use |
|---|---|---|
| `paper` | `#FFFFFF` | Page background, primary surface |
| `paper-2` | `#FAFAF9` | Secondary surface, card backs |
| `paper-3` | `#F4F3F1` | Tertiary surface |
| `ink` | `#1A1418` | Primary text, dark surfaces |
| `ink-2` | `#3D2F3A` | Secondary dark surface |
| `ink-3` | `#6B5F68` | Secondary text, metadata |
| `ink-4` | `#9A8F97` | Tertiary / fine print |
| `line` | `rgba(26,20,24,0.08)` | Dividers, borders (also `line-2`, `line-3`) |
| `coral` | `#FF5A36` | Primary CTA, hero accent — use sparingly |
| `coral-2` | `#FF7A5A` | Hover / secondary coral |
| `coral-soft` | `#FFE6DD` | Coral tint backgrounds |
| `plum` | `#7A2BB8` | Emphasis (italic word in headlines), active CTA |
| `plum-2` | `#5B1F8A` | Pressed / deep plum |
| `plum-soft` | `#F3E8FB` | Plum tint backgrounds |
| `sage` | `#7C8F78` | Accent — hearts, tags, quiet states |

Radii: `--radius-sm 8`, `--radius 14`, `--radius-md 18`, `--radius-lg`..`--radius-4xl 22` (everything ≥ lg is 22px).

Motion tokens (`app/app.css`): `--ease-entrance` (weighted ease-out), `--ease-standard`, `--ease-exit`; `--duration-fast 150ms`, `--duration-base 240ms`, `--duration-slow 420ms`; `--reveal-distance 16px`. JS motion presets mirror these in `app/components/motion/variants.ts`.

Fonts:
- `font-display` → `Newsreader` (serif headlines, editorial display)
- `font-body` → `DM Sans` (body copy, nav, labels)
- `font-mono` → `JetBrains Mono` (kickers / section labels via the `.kicker` class)
- `font-script` → `Caveat` (legacy accent, sparing use)

Brand motifs (`app/app.css` §11): `♥` in CTA labels ("I'll take it ♥"), Emma asides, dividers. `.em` / `em.brand` = italic plum emphasis word. `.link-coral` = coral hairline link. `.kicker` = mono uppercase section label.

**Coral is the accent, plum is for emphasis.** No brand gradient — flat coral on white paper. Do not reintroduce orange or the old cream backgrounds.

## Motion System (editorial reveal)

Storefront entrance/scroll motion uses one reusable, SSR-safe primitive — do not hand-roll IntersectionObserver or `whileInView` per component:
- `app/lib/use-reveal.ts` — `useReveal()` hook (mount-gated + reduced-motion-aware).
- `app/components/motion/Reveal.tsx` — `<Reveal variant delay index once disabled as>` wrapper. Variants: `fade | up | scale`.
- `app/components/motion/variants.ts` — shared springs, stagger, and the one-shot `heartbeat`.

Rules: render the **visible/final state on the server** (the primitive handles this — never produces hidden SSR markup); transform/opacity only (zero CLS); **never wrap the LCP hero image**; `motion`'s `layout` prop only on filter grids. Reduced-motion always renders the final state.

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

**v2 redesign additions** (created via `scripts/shopify-metafield-defs.ts`):
- `map_restricted` (boolean) — suppress struck-price UI when true
- `hero_video` (json) — `{ src, poster, duration }` for 9:16 hero video
- `mood_tags`, `audience_tags`, `matters_tags` (list.text) — Ask Emma taxonomy
- `product_type_dial` (text) — one of `air-pulsation | vibrator | wand | lube | wear`
- `sensation_dial` (json) — per-dimension 1–5 ratings
- `pairing_why` (json) — `{ [accessoryId]: "Emma voice copy" }` for Pairs-with

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

## Claude API Voice — Emma persona

System prompt (always include):
> You are Emma — the editorial voice of xdipx.com, an editorially-curated sexual-wellness storefront. Brand voice: playful, cheeky, warm, curious, personal. Never clinical. Never sleazy. Write as a trusted, funny friend who isn't embarrassed about the topic and who knows the catalog inside out. You are an AI guide, not a customer: advise on how a product works and could work for the reader, and NEVER claim you have used, tried, tested, or owned it. Keep copy tasteful — suggestive is fine, explicit is not. Never use "sex" as an adjective — use "intimate", "pleasure", "wellness", or "satisfaction". Never "Buy now" — use "Take a peek →", "Show me", or "I'll take it ♥". Never surface a countdown or "until midnight." Always include a short first-person advisory aside on hero/cards ("the one I'd point you to for slow nights," "an easy yes if quiet matters"). Never assume the reader's experience level. Do not recycle coined phrases across products — pick fresh, specific language every time.

Model: `claude-sonnet-4-6`

## Oxygen Migration Path

React Router v7 framework mode IS the same framework as Shopify Oxygen/Hydrogen. Migration later requires:
1. Swap `@react-router/express` adapter for `@shopify/remix-oxygen`
2. Replace `<img>` with Hydrogen `<Image>`, add `<Money>` for prices
3. Add `<CartProvider>` to root, replace raw cart mutations with `useCart()`
4. Move env vars to Oxygen CLI secrets
5. Replace Vercel Cron with Inngest or Upstash Qstash

**Keep all Shopify calls in `app/lib/shopify.server.ts`** — single file to swap.
**Keep all Vercel-specific code in `server/index.ts`** — never import `@vercel/kv` inside `app/`.

## Worktree setup

`.env*` files are gitignored, so new worktrees start without DB / API credentials. Run `bash scripts/setup-worktree.sh` inside any new worktree to symlink `.env`, `.env.local`, `.env.preview`, and `.env.preview-ivr` from the main repo root. The global `using-git-worktrees` skill runs this automatically after `npm install`.

## Phase 1 Launch Checklist

- [ ] Age gate renders before all content, persists 30 days
- [ ] Homepage Emma hero loads from Shopify via loader (no countdown surface)
- [ ] "I'll take it ♥" → checkout-extras → Shopify checkout end-to-end
- [ ] Email subscribe posts to Klaviyo
- [ ] Admin: login, queue, deal editor, AI generation, approval toggle
- [ ] Cron rotates pick at midnight (infra only — UI never surfaces timing)
- [ ] Order webhook writes wholesale cost metafield
- [ ] UTM + ref capture on all page loads
- [ ] JSON-LD on homepage, product pages, FAQ
- [ ] Canonical tags correct on all pages
- [ ] Mobile responsive at 375px
- [ ] Nalpac app installed on Shopify backend

## Sanity schema — additive only

For v2 redesign features that need Sanity schema changes, create **new** document types / blocks / fields in new files. Do not modify existing schema. Loaders read from new doc types with fallback to old. Protects already-published content and lets the team switch over intentionally.
