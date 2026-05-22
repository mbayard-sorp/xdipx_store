# Discovery Home (Variant A) — Session Handoff

Handoff for a fresh agent to finish verification and a couple of pending
decisions on the Variant A "The Compass" discovery home page. The code work is
committed and green at build level; the only thing blocking sign-off is a
self-inflicted Shopify rate-limit penalty that left the discovery index empty.

## Branch / worktree

- Branch: `claude/strange-lovelace-0433db` (off `main`, after PR #145).
- Worktree: `/Users/mikebayard/Claude/xdipx_store/.claude/worktrees/strange-lovelace-0433db`
- Working tree is **clean** — all session work is in 3 commits on top of `b3eeee3`:
  1. `feat(discovery): enrich product index with savings + variant facets`
  2. `feat(home/variant-a): card savings + variant indicators, 4:5 fidelity, mobile lazy-load rails`
  3. `feat(home/variant-a): inline Emma in hero; drop sidebar, deal bar, save-picks`

## What shipped this session (all committed, typecheck clean, 114/114 unit tests pass)

1. **Fidelity polish** — `BudgetSlider` got a `compact` mode (kills the duplicate
   "Budget" label under HomeA's "Budget (last)"); `ProductCard` is portrait 4:5
   with a hairline border + hover shadow and lighter serif title; legacy tokens
   (`cream-2`, `muted`) replaced with v3 (`paper-2/3`, `ink-3/4`) across
   ProductCard, WelcomeBackBanner, EmmaSidekick.
2. **Removed the black "Today's Pick" deal bar** — `DailyDealStrip` no longer
   rendered; the dead `deal` prop + loader fetch removed from `_layout._index.tsx`.
3. **Removed the "Save my picks" button** — Emma's CTA is now just "Ask Emma".
4. **Card savings + variant indicators (matches the PLP `VaultCard`)** — struck
   compare-at + "You save $X (Y%)" (suppressed when the discount rounds to 0%),
   plus the pie-gradient color circle and size pill. Data comes from new
   `DiscoveryProduct` fields: `compareAtPrice` (from `xdipx.original_price`
   metafield, native compare-at fallback), `priceMax`, `colorValues`,
   `sizeValues`, fetched product-level in the Admin GraphQL index query.
   **Caveat (accepted by the user):** indicators are per-product, not the
   vault's cross-product master-collapse, so they're sparse (most catalog
   products are single-variant).
5. **Relocated Emma into the hero** — new `EmmaHeroIntro.tsx` (avatar + combined
   greeting/lede + single Ask Emma CTA) sits under the H1; the sticky right
   sidebar AND the mobile pill are gone; layout is now single-column. Combined
   copy is `EMMA_LINES.heroIntro` (no em-dashes per voice rule). Her line stays
   adaptive once chips are selected.
6. **Mobile rails lazy-load horizontally** — `Rail.tsx` has an end sentinel
   watched by an `IntersectionObserver` (root = the horizontal scroll track,
   `rootMargin` right 240px). It auto-fetches the next page via the existing
   `/api/discovery?...&offset&limit` path and stops when `shown >= rail.total`.
   "View more" button is now desktop-only (`hidden md:flex`). A small dot at the
   track end pulses while loading.

> A swipeable multi-image card carousel was built then **reverted** at the
> user's request (nested horizontal scroll inside the horizontal rail was
> wonky). The `images`/`media` fetch was removed; index version is back to v6.
> Don't re-add it.

## BLOCKER: Shopify Admin API rate-limit penalty → empty discovery index

While debugging an unrelated chips issue I force-rebuilt the discovery index
many times in a few minutes (clearing KV keys + warming). Shopify put the
Admin API token into an **extended throttle penalty**: `buildDiscoveryIndex()`
throws `Throttled`, so `getDiscoveryIndex()` returns `[]`, so:
- the index never persists to KV,
- chip vocab is empty (no mood/audience/matters chips render),
- rails are empty (so savings/indicators/lazy-scroll can't be seen).

This is **transient and self-healing** — it is NOT a code bug, and production
won't see it under normal traffic. It recovers after sustained quiet (likely
15–30+ min with no build attempts). **Do not keep retrying the build** — each
attempt fetches page 1 before throttling and prolongs the penalty.

To confirm recovery (run ONCE, then wait if still throttled). Note: dev runs
under homebrew **node@23** (see "How to run"):
```
# from the worktree root
cat > _b.mts <<'EOF'
import 'dotenv/config'
import { getDiscoveryIndex, getDiscoveryVocab } from './app/lib/discovery.server'
;(async () => {
  await import('./app/lib/kv.server').then(m => m.kvDel('discovery:index:building:v6'))
  const idx = await getDiscoveryIndex({ force: true })
  console.log('INDEX:', idx.length)
  if (idx.length) console.log('VOCAB moods:', (await getDiscoveryVocab()).moods.length)
  process.exit(0)
})()
EOF
PATH="/opt/homebrew/opt/node@23/bin:$PATH" node --import tsx/esm _b.mts; rm -f _b.mts
```
When `INDEX > 0` and `VOCAB moods > 0`, the index has rebuilt and persisted.
Then reload the home page and the chips + rails come back.

## Verification still owed (once the index repopulates)

View Variant A at `http://127.0.0.1:3007/` (see "How to run"):
- [ ] Chip filter groups (01/02/03) render again (this is the vocab recovering).
- [ ] Card savings line + struck price + color circle / size pill look right.
- [ ] Emma hero block + single "Ask Emma" CTA; no right sidebar; no deal bar.
- [ ] **Mobile (375px):** scroll a rail horizontally to the end → it auto-loads
      more and keeps going until the category is exhausted, then stops. This is
      the headline new feature and has NOT been seen working in a browser yet.

## Pending decision: stop rebuilding the index every hour

The user is right that the index doesn't need an hourly rebuild (catalog
changes are infrequent). Findings:
- `INDEX_TTL_SECONDS = 60*60` (1h) in `app/lib/discovery.server.ts` is the ONLY
  freshness path for catalog changes.
- `invalidateDiscoveryIndex()` already busts on **discovery-rule** edits
  (`admin.discovery-rules.tsx`, `discovery-rules.server.ts`) but is NOT wired to
  product/collection webhooks or the nightly feed/deal crons.

Options offered (pick one, then implement — separate from the UI work):
- **Simple:** bump `INDEX_TTL_SECONDS` 1h → 24h (one line). Cuts rebuild churn
  24x, kills the throttle risk. Worst-case staleness 24h.
- **Event-driven (recommended):** push TTL to ~7d as a backstop AND call
  `invalidateDiscoveryIndex()` on the actual catalog-change path (Nalpac import
  and/or a `products/update` webhook), so it rebuilds only when products change.
- A longer-term robustness idea (optional): serve-stale-while-revalidate so an
  expired/throttled rebuild never collapses the home to empty, plus a couple of
  backoff retries in `buildDiscoveryIndex` (it currently has none, which is what
  made the throttle cascade).

Bumping the TTL also helps the current mess: once the index rebuilds, a long
TTL keeps it cached instead of re-churning.

## Loose ends / cleanup

- **Orphaned files (now unused, left in place pending the user's OK to delete):**
  - `app/components/discovery/EmmaSidekick.tsx` — replaced by `EmmaHeroIntro`.
  - `app/components/discovery/DailyDealStrip.tsx` — deal bar removed.
  Both still compile; just no longer imported. The user was asked about deleting
  `DailyDealStrip` and didn't answer before moving on. Confirm before deleting.

## How to run (environment quirks — important)

The dev server does NOT boot under the default Node 24 in this environment:
- **Node 24 + tsx + `@sentry/node`** crashes at import (`@fastify/otel`
  package.json parse). Run under **homebrew node@23** instead.
- Several deps declared on this branch were missing from the shared root
  `node_modules` and had to be installed: `fontaine`, `nodemailer`
  (+`@types/nodemailer`), and the four `@fontsource-variable/*` packages. They
  were `pnpm add`-ed at the **repo root** (`/Users/mikebayard/Claude/xdipx_store`),
  which left that root checkout's `package.json` + `pnpm-lock.yaml` modified
  (separate from this worktree branch — reconcile/ignore as appropriate; this
  branch's `package.json` already declares them).
- The Preview MCP uses Node 24, so it can't boot this app. Use a manual server +
  Chrome MCP (or your own browser) instead.

Start the server:
```
cd /Users/mikebayard/Claude/xdipx_store/.claude/worktrees/strange-lovelace-0433db
PATH="/opt/homebrew/opt/node@23/bin:$PATH" PORT=3007 HOME_VARIANT=a npm run dev
```
Then open `http://127.0.0.1:3007/` (use `127.0.0.1`, not `localhost` — IPv6
resolution returns connection-refused for curl). `HOME_VARIANT=a` makes `/`
render Variant A directly. A gitignored `.claude/launch.json` entry
"xdipx-store (Variant A default)" also exists but only works under Node 24, so
prefer the manual node@23 command above.

`typecheck` / tests under node@23:
```
PATH="/opt/homebrew/opt/node@23/bin:$PATH" npm run typecheck
PATH="/opt/homebrew/opt/node@23/bin:$PATH" npx vitest run app/lib/discovery-emma.test.ts app/lib/discovery-rules.test.ts app/lib/discovery-tags.test.ts app/lib/home-variant.server.test.ts
```

## Key files

- `app/components/discovery/HomeA.tsx` — single-column composition.
- `app/components/discovery/EmmaHeroIntro.tsx` — NEW; Emma in the hero.
- `app/components/discovery/ProductCard.tsx` — savings + indicators + 4:5.
- `app/components/discovery/Rail.tsx` — mobile lazy-load (sentinel + IO).
- `app/components/discovery/BudgetSlider.tsx` — `compact` prop.
- `app/lib/discovery.server.ts` — index build, query, `INDEX_VERSION` (v6),
  `INDEX_TTL_SECONDS`, `invalidateDiscoveryIndex`, vocab.
- `app/types/discovery.ts` — `DiscoveryProduct` (savings/variant fields).
- `app/lib/discovery-emma.ts` — `EMMA_LINES` (incl. new `heroIntro`).
- `app/routes/_layout._index.tsx` — Variant A loader branch + render.
