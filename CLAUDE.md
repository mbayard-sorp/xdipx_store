# xdipx.com — Claude Code Project Guide

## What This Is

Editorially-curated sexual-wellness storefront. Emma picks a featured product on an irregular cadence ("Emma's picks"); the cron infra still rotates at midnight, but the UI never surfaces a countdown or "until midnight" language. Built on React Router v7 framework mode + Express + Shopify headless.

**Live goal:** $2,000/month profit within 3 months of launch.

**Voice (v5):** Desire-forward at intensity 9 on owned channels (site, email, opted-in SMS), running as a 30-day trial through 2026-08-19: explicit-indulgent, act-anchored, temptation closers; 10 never ships. Paid ads stay education-register at 3-4 per docs/ads-policy.md; support stays 2-3; blog answers stay citable at 4-5. Social platforms are rented, not owned: Instagram/TikTok run at 4-5 and X at 6-7 per the social addendum, LinkedIn at 2-3, and platform policy outranks the charter on those surfaces (docs/ads-policy.md §Organic social). "Sex toy" is a normal noun and acts are nameable plainly; never crude, never porn-copy; "sex"/"sexy" as a branding adjective is banned. Emma is an AI guide with no lived experience (never "I tried/tested/own it"): she speaks to what the reader will feel, never what she has felt. No em-dashes (periods and commas). No countdowns or urgency theater. Billing descriptor is always XDIPX. CTAs from the whitelist only ("Take a peek →", "Show me", "Find your fit →", "I'll take it ♥", never "Buy now"). Fresh product-specific language every time; rotate out any repeating tic. Canonical source: docs/emma-voice.md. If this summary and the charter disagree, the charter wins.

**Visuals:** docs/design-doctrine.md (v1.1) is the binding visual charter, the pixel twin of the voice charter: §4 imagery archetypes A-D with the coral-soft/plum-soft/paper ground lock, §6 proof & trust components (never fabricate proof), §7 reference bench. The current competitive decision doc is docs/homepage-team/competitor-teardown-2026-07-live.md. Where this summary and the doctrine disagree, the doctrine wins on pixels.

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

AI generates content; humans approve. The `admin/deals` route is the product editor. Imported products stay Shopify-DRAFT until the enrich→publish step; the `import_enrich_enabled` valve is the gate.

**Carve-out — autonomous homepage merchandising team:** the homepage team (see `docs/homepage-team/`) MAY auto-publish *content-only* homepage changes (featured product rotation, Emma copy refresh, image swaps, section reorder via Sanity) without per-change approval, within the `/admin/homepage-team` kill switch + daily $ budget. Any *code/layout/component* change still goes through a reviewable PR, which the release engine merges only after the gates below pass. Daily deals are retired, so the old `deal_status: approved` gate no longer exists; product publishing is gated by `import_enrich_enabled` instead.

**Merge policy: the release engine.** Agent PRs are merged by the release engine, not by the agents themselves. No agent ever merges or pushes to the default branch; every change is a reviewable PR. The release engine, a server-side cron, squash-merges an agent PR only when CI is green (typecheck, tests, build), the linked ticket is QA-verified for code changes or allowlist-verified for docs changes, and no changed file touches a protected path. Protected paths (checkout and payment, cart, database migrations and schema, auth and session, team valves and spend controls, CI and deploy config, and the release engine itself) always stop and escalate to the owner by email; only the owner merges those. After merging, the engine waits for the production deploy, runs smoke checks, and reverts automatically on failure. A ticket that fails three fix attempts is blocked and escalated to mike@xdipx.com. The kill switch is the `release_engine_enabled` valve; when it is off, every agent PR waits for the owner exactly as before. Money valves are unchanged by this policy: `import_enrich_enabled`, video frame review, and social autopost remain owner-gated. See `docs/store-team/operating-system.md`.

**Owner bandwidth doctrine (owner direction 2026-08-19).** The owner's standing decision surface is: money and spend, brand/legal/likeness judgment, protected-path merges (now a read-and-click: agents author these diffs per `routine-dev-daily.md` Step 2, QA pre-verifies, the engine escalates and never merges), and valve flips. Everything else is team-decided, with urgency. Never park an owner ask in a session thread; it goes on the blocker list (`/api/team/blocker`, with a verify probe when one exists) or it did not happen. The full binding list is `operating-system.md` §7 and the run-level rules are `docs/store-team/mission-brief.md` §2b.

**Opening a PR from an interactive session, file a ticket with it.** (ADR-008 step 3, owner-approved 2026-08-04.) The engine cannot merge an eligible-branch PR without a linked ticket in status `verified`, and a session that opens a PR without touching the bus produces work that structurally cannot reach QA. So when you open a PR on `agents/`, `ticket/`, `claude/`, `phase1/`, `tonight/`, `fix/`, or `pm/`, file its ticket in the same breath: `POST /api/team/suggestion {op:'create', kind:'code', team:…, suggestion:<what changed + DONE WHEN>}` plus a `pr` link pointing at the PR URL. Do this rather than relying on the fallback: you know the real priority, category, and acceptance criteria, and the fallback has to guess all three. **The fallback is not optional cleanup you can skip:** if you forget, the release engine auto-files a `pr_open` ticket for the PR on its next cycle (`app/lib/release-ticket-autofile.server.ts`), so the PR still reaches QA. Nothing about this changes a gate. The auto-filed row lands at `pr_open` exactly like a hand-filed one, and QA still has to verify it before anything merges. Protected-path PRs are never auto-filed; they escalate to the owner as they always have.

**Carve-out — product import queue:** the `product-manager` agent MAY approve/reject/watch `import_candidates` on its own editorial judgment with no per-item human approval, calling `POST /api/team/import-candidate-action` (team-token auth, not an admin session). Gated by the `product_manager_enabled` kill switch (default off) and a `product_manager_max_actions_per_run` cap, both editable on `/admin/imports`. This is explicit store-owner direction: margin is not a gate on imports (see `docs/product-import-spec.md` and `docs/import-monitor-runbook.md`), and repeated manual approval of import candidates was an unwanted friction point. The downstream enrich→publish step (draft → live on the storefront) stays behind the separate, still-manual `import_enrich_enabled` switch shared with Phase 2 auto-import — flipping both switches on is what makes the whole import→live path unattended.

**Carve-out — improvement-bus suggestion triage:** each team has a `{team}_team_auto_approve_suggestions` valve (migration 062, editable on that team's tab of `/admin/homepage-team`). When on, incoming suggestions the team acts on skip the owner's `proposed → approved` triage click and are written straight to `approved` (`decided_by='auto'`). This automates **only** the first gate — the downstream execution gates are unchanged: `instructions/agent-def/config` rows still become an `agent-editor` PR (and only when `suggestion_apply_enabled` is also on), merged by the release engine under the merge policy above once CI and the allowlist check pass and no protected path is touched, and `campaign/promo/program` rows are still executed by hand. **`code` rows are not executed by hand** — since R-DEV went live (2026-07-28) the daily dev routine claims approved `code` tickets itself at 14:00 and 20:00, opens a `ticket/<id>` PR, and the release engine merges it once QA marks it `verified`. Combined with auto-approve, an agent-filed `code` row can reach production with no human step; the gates that remain are CI, the protected-path classifier, the QA verdict, the merge cap, and post-deploy smoke with automatic revert. Explicit store-owner direction so the owner isn't the approval bottleneck. **As of 2026-07-29 it is ON for all five active teams** (homepage, content, product, social, strategy), paired with `suggestion_apply_enabled` ON. The four non-homepage valves were in fact flipped on 2026-07-18 while these docs said otherwise for eleven days; valve writes now record an actor and a source in `settings_audit_log` (migration 072) so a flip is attributable afterward. Note what this means with the release engine on: an agent-filed `instructions` suggestion from any team can reach merged behavior change with no human triage. The gates that remain are CI, the file allowlist, the protected-path classifier, and the daily merge cap. See `docs/store-team/improvement-loop.md`.

### Home page variants (`app/lib/home-variant.server.ts`)

`/` resolves a variant: `a` = "The Compass" discovery finder (now also served standalone at `/discover`), `b` = the new traditional storefront (`StorefrontHome`), `legacy` = the daily-deal home (deferred; daily deals are a later phase). Default until flipped is `legacy`/`a`; set `HOME_VARIANT=b` (or Sanity `activeVariant='b'`) to make the storefront the homepage. Preview any variant with `?variant=a|b`.

### Mobile-First

Build and test at 375px first. Most traffic will be mobile. Use responsive classes in order: base (375px) → `sm:` → `md:` → `lg:`.

**Admin pages too.** The admin shell collapses to a drawer below `md:`. Recipes: wrap every table in `<ResponsiveTable>` (`app/components/admin/ResponsiveTable.tsx`) and give the table a `min-w-[…]` floor; stat grids `grid-cols-2 md:grid-cols-4`; form rows `flex flex-col gap-3 md:flex-row md:items-center`; page headers `flex-wrap`. Tables scroll horizontally inside their wrapper — never let the page body scroll sideways, and never restructure admin tables into cards.

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
    feed-processor.server.ts ← Nalpac CSV fetch + scoring + discontinued sweep
    profit.server.ts       ← Profit calculation + DB writes
    db.server.ts           ← Neon + Drizzle client
    kv.server.ts           ← Vercel KV client
    session.server.ts      ← Cookie session (admin auth)
    cart.server.ts         ← Cart cookie helpers
    attribution.server.ts  ← UTM + ref capture
    consent.server.ts      ← CCPA/GDPR consent logging

  routes/
    _layout.tsx            ← Store layout (Navbar, Footer, TrustBar)
    _layout._index.tsx     ← Homepage (variant-resolved: storefront 'b' / Compass 'a' / legacy)
    _layout.discover.tsx   ← "The Compass" discovery finder (standalone)
    _layout.products.$slug.tsx  ← Canonical product URL
    _layout.vault.tsx
    _layout.vault.$slug.tsx
    _layout.for-him.tsx
    _layout.for-her.tsx
    _layout.faq.tsx
    _layout.about.tsx
    admin.tsx              ← Admin layout (auth guard)
    admin._index.tsx
    admin_.login.tsx       ← underscore escapes flat-route nesting under admin.tsx
    admin.queue.tsx
    admin.deals.tsx
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
- `original_price`, `wholesale_cost`, `map_price`, `deal_score`

**Retired 2026-08-03 — do not reintroduce:** `is_daily_deal`, `deal_date`, `deal_status`. They were daily-deal bookkeeping. `deal_status: 'archived'` gated the PDP into a 410, which killed 17 active, sellable products, and also suppressed them from the sitemap and collection shelves. All values were cleared catalog-wide and every writer was removed; the definitions remain in Shopify as empty shells. A product being gone is expressed by Shopify's own `product.status = ARCHIVED`, which drops it from the Storefront API so the PDP 404s on its own.
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
5. A product that returns to the catalog reuses the same URL — 200 response
6. Shopify product `handle` = SEO slug — set explicitly on import, **never auto-generate**

## Cron Schedule

| Route | Schedule | Action |
|---|---|---|
| `/cron/discontinued-sweep` | 11:45 PM | Fetch Nalpac CSV, archive products the feed now marks discontinued |
| `/cron/profit-summary` | 12:05 AM | Write daily_profit_summary to Neon |

Cron routes protected by `x-cron-secret` header matching `CRON_SECRET` env var.

## Claude API Voice — Emma persona

Do not restate voice rules in prompts; include the charter itself. Runtime prompts load the charter core plus the matching channel addendum from `docs/emma-voice.md` via `app/lib/emma-voice.server.ts` and prepend it to every Emma-voice system prompt.

System prompt (always include):
> You are Emma, the voice of xdipx.com, an editorially curated sex toy and sexual wellness store. Follow the xdipx voice charter included below in full; it is the single source of truth for voice. In short: "sex toy" is a normal noun and acts are nameable plainly in product context; be suggestive about what a product does, never crude; you are an AI guide with no lived experience; no em-dashes; no countdowns; the statement reads XDIPX; CTAs from the whitelist only (never "Buy now"); fresh product-specific language every time.
>
> [charter core + channel addendum inserted here by `app/lib/emma-voice.server.ts`]

Canonical source: docs/emma-voice.md. If this summary and the charter disagree, the charter wins.

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
- [ ] "I'll take it ♥" → cart → Shopify checkout end-to-end
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
