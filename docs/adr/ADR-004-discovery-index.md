# ADR-004: Discovery Index Architecture (Home Page Rebuild PR 1)

**Date:** 2026-05-15
**Status:** Proposed — pending PR 1 merge
**Owner:** tech-architect
**Implementation owner:** rr7-engineer

---

## Context

The home page rebuild introduces a "Find you in a product" surface. Discovery infra lands in PR 1:

- `app/lib/discovery.server.ts` — Admin GraphQL paginated fetch, KV cache, public rail API
- `app/routes/api.discovery.tsx` — live rail-filtering endpoint
- `app/lib/discovery-emma.ts` — pure scoring/ranking helpers
- `app/types/discovery.ts` — closed enums for mood/audience/matters

Key facts about the runtime environment:

- Catalog: ~3,000 active SKUs
- `adminGraphQL()` in `app/lib/shopify.server.ts` is a raw `fetch` wrapper with no retry, no throttle inspection, no `extensions.cost` reading
- KV backed by Vercel KV (`@vercel/kv`); local dev falls back to in-memory
- Index TTL: 3,600 seconds (1h); version key: `discovery:index:v1`

---

## Decisions

### A. KV version strategy — accept with one caveat

`INDEX_VERSION = 'v1'` is hardcoded; reads and writes are namespaced under `discovery:index:v1`. Old entries time out on their TTL.

**This is acceptable for v1 with one caveat.** The pitfall is a mid-deploy shape change: if a new deploy changes `DiscoveryProduct` shape but keeps `INDEX_VERSION = 'v1'`, the new code reads a stale KV entry with the old shape and silently serves corrupt rail data until TTL expires (up to 1h). This is not theoretical — any PR that adds a field to `DiscoveryProduct` (e.g. a `tags` array for a new rail axis) hits this window.

**Mitigation required before PR 2:** bump `INDEX_VERSION` whenever `DiscoveryProduct` shape changes, as part of the same PR. Enforce via a comment directly above the type definition in `app/types/discovery.ts` that reads: `// Bump INDEX_VERSION in discovery.server.ts when this type changes.`

### B. Admin GraphQL pagination cost — no block, but note for ops

At 3,000 active SKUs with page size 100: **30 round-trips per full index build**.

The PRODUCTS_PAGE_QUERY reads `products` (1 object) + 4 metafield lookups per node (100 nodes). Shopify Admin GraphQL costs objects/connections by their complexity weight. A conservative estimate for this query shape:

- Products connection: ~1 point
- 100 nodes x 1 point each: 100 points
- 4 metafield() calls per node at ~1 point each: 400 points
- Total per page: ~500 points
- 30 pages: ~15,000 points per full build

Shopify's default point bucket for a private app is 1,000 points, restoring at 50 points/second. A single page hit is already ~500 points — half the bucket. Two rapid cache-miss concurrent builds (cold deploy + health check, for example) can deplete the bucket and push subsequent Shopify calls (deal activator, order webhook, pricing agent) into rate-limit errors for ~10 seconds.

`adminGraphQL()` has no retry or `extensions.cost` inspection today. This is an existing gap in the seam, not introduced by discovery.

**Mitigation for PR 2:** add a `Retry-After`-aware retry loop to `adminGraphQL()` — single place, all callers benefit. The discovery index build is the first caller that makes it urgent.

**For v1 (PR 1):** the 1h TTL means the build runs at most once per hour per serverless instance. At current zero-user traffic this is fine. Flag for ops: watch Admin API rate-limit errors in Vercel logs after launch when the catalog grows or concurrent cold starts increase.

### C. Cache invalidation — 1h TTL is acceptable for v1

A product catalog edit in Shopify (title change, new metafield value, price change) will not surface in discovery rails for up to 1h. This is the correct tradeoff before any users exist.

`invalidateDiscoveryIndex()` exists for manual bust from admin tooling. The comment correctly notes webhook wiring is not present yet.

**Decision: do not wire product webhooks before PR 2 ships.** Justification: five webhooks (`products/create`, `products/update`, `products/delete`, `product_listings/add`, `product_listings/remove`) all need HMAC verification, retry handling, and idempotency. The cost is real. The benefit — sub-1h freshness — has no user-facing value at zero traffic.

**Revisit at:** 50 DAU or when the editorial team starts using discovery rails in the admin to preview content.

### D. Oxygen migration impact — no new friction

`discovery.server.ts` imports from `~/lib/kv.server.ts` and `~/lib/shopify.server.ts` — both already-established seams. No new Vercel-specific imports leak into `app/`. The KV seam (`kvGet`/`kvSet`) is already the abstraction point for the Oxygen migration; swapping the KV backend means touching `kv.server.ts` only, same as before this PR.

`discovery-emma.ts` is pure TypeScript with no server or platform imports — migrates for free.

**Net: no new Oxygen migration friction.**

### E. One concrete risk to mitigate before PR 2

The `api.discovery.tsx` loader calls `getDiscoveryRails()` which calls `getDiscoveryIndex()` on every request that is a KV miss. On first deploy, every serverless instance starts cold and KV is empty. If the homepage load and the `/api/discovery` polling hit simultaneously from multiple instances, you get N concurrent full Admin GraphQL builds (N = number of warm instances). Each build is ~30 Admin API calls. There is no mutex or lock.

This is a **thundering-herd on Admin API at cold start**. At current traffic it is unlikely to matter. At launch with a spike it could saturate the Admin API point bucket and cause deal-of-day or order-webhook failures.

**Recommended mitigation in PR 2:** a KV-based build lock (`kvSet('discovery:index:building', 1, 30)` with a check before entering `buildDiscoveryIndex()`). Callers that see the lock should return `[]` (empty state) rather than competing to build.

---

## Alternatives Considered

**Webhook-driven invalidation instead of TTL:** Correct long-term. Rejected for v1 due to implementation cost with zero user upside yet.

**Storefront API instead of Admin API for the index:** Storefront rate limits are more generous and it is the correct API for public read paths. However, Storefront does not expose `xdipx` namespace metafields — that requires Admin API or Metafield definitions with `storefront` access. Worth revisiting if the Admin API rate-limit risk becomes real.

**Build index at cron time, not on demand:** Would eliminate the thundering-herd entirely. Deferred because it requires cron infra change and the 1h TTL is acceptable.

---

## Consequences

- PR 1 ships as-is. No blocking issues.
- `rr7-engineer` must bump `INDEX_VERSION` in the same PR as any `DiscoveryProduct` shape change.
- `rr7-engineer` to add KV build lock in PR 2 before launch.
- `rr7-engineer` to add `Retry-After` retry to `adminGraphQL()` in PR 2.
- Webhook wiring deferred to post-launch milestone.
