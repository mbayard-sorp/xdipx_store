# ADR-005: Cold-Start TTFB Remediation (Googlebot Crawl Recovery)

**Date:** 2026-06-08
**Status:** Accepted
**Author:** tech-architect

---

## Context

Google Search Console crawl-stats show average response times of 2178-4271 ms on cache-miss days, vs. 108-388 ms on warm days. Crawl volume collapsed from peaks of 1304/day to 0 on several days; Google throttled the crawl rate due to slow/erroring responses (0.79% 5XX). ~47% of crawl budget is wasted on JS/.data/JSON rather than HTML content pages.

Root cause chain (verified in code):

1. **Discovery rebuild on cold KV miss.** `getDiscoveryIndex()` (discovery.server.ts:577) triggers `buildDiscoveryIndex()` (discovery.server.ts:549), a paginated Shopify Admin GraphQL loop that fetches every active product. This runs inline inside the homepage loader (Variant A path, _layout._index.tsx:108). On an Upstash cold start (empty KV after deploy, KV eviction, or TTL expiry), every Googlebot request during that window rebuilds the full index synchronously, blocking SSR. The cooperative lock (lines 586-588) helps avoid thundering-herd but still means the FIRST cold request blocks.

2. **`_layout.tsx` also awaits `getHomepageSections()`** (sanity.server.ts:247, KV-cached 60s), and `_layout._index.tsx` awaits it again independently. Both loaders run before SSR. On a cold KV, this means TWO Sanity fetches serialized across two loaders, but since they run parent-then-child sequentially in RR7, the latency stacks.

3. **`pipelineSettings` DB query not timeout-wrapped** (_layout._index.tsx:142-148). The Neon Drizzle select blocks the legacy path with no fallback if Neon is slow.

4. **`getEmmaContextRows()` calls `listActiveRails()`** (emma-rails.server.ts:372/430), which is a raw Sanity fetch with no KV cache. This runs on every legacy homepage request with a live deal.

5. **`getSwatchMap()` can call Claude inline** (swatches.server.ts:86) with a 1500ms timeout, but only on first-ever deploy or new color labels not yet in the `color_swatch_cache` table. Risk is real but bounded; after first warm-up, it hits the in-process `hot` map.

6. **`getProductReviews()`** does 4 Neon queries sequentially (reviews.server.ts:156-166) with no KV cache layer. Already wrapped in `withTimeout` in the loader.

The homepage IS edge-cached (s-maxage=60, SWR=600). Warm anonymous traffic is fast. The problem is cold instances (deploy, scale-out) and Googlebot, which may bypass or bust CDN cache through User-Agent or lack of cookies.

---

## Decision

### 1. Discovery Index: Move Build Out of Request Path

**Decision:** Add a dedicated cron job `POST /cron/warm-discovery-index` that calls `buildDiscoveryIndex()` and writes to KV, invoked on the existing GitHub Actions scheduler every 30 minutes. Modify `getDiscoveryIndex()` to return `[]` (empty, already the behavior) on cold miss WITHOUT blocking, and let the Variant A path render a graceful empty state (already implemented via `EMPTY_STATE`). The build lock already prevents thundering herd; the change is to NOT await the rebuild inline but instead fire-and-forget a background rebuild via the cron endpoint.

Concretely: in `discovery.server.ts`, extract the rebuild path into a new exported `scheduleDiscoveryRebuild()` function (a no-op fire-and-forget fetch to `/cron/warm-discovery-index`). The inline `getDiscoveryIndex()` function returns `[]` immediately on miss instead of calling `buildDiscoveryIndex()` directly. The cron handler does the real work in its own serverless invocation with no response-time pressure.

**Why not alternatives:**
- "Rebuild inline but add timeout" -- still blocks up to N seconds on the cold path; Googlebot doesn't wait.
- "Neon-backed index" -- higher complexity, adds a Neon query to every SSR; KV is the right tier for this shape.
- "Longer KV TTL" -- already 24h TTL (confirm in code); eviction after deploys is the real gap, fixed by the cron warm.

### 2. Cache-Warming Cron

**Decision:** Add `POST /cron/warm` to `server/cron.ts`. The handler performs three actions:
1. Calls `buildDiscoveryIndex()` and writes result to KV (warm the discovery index).
2. Issues internal HEAD/GET requests to `https://xdipx.com/` and the current live deal PDP (`/products/{handle}`) using the site's own base URL from env, with no-cache headers, to prime the CDN edge (SWR kicks in on the first cold hit, so a scheduled pre-hit before Googlebot arrives keeps the edge warm).
3. Returns `{ ok: true, discoveryProducts: N, pagesWarmed: [...] }`.

The GitHub Actions scheduler hits this every **15 minutes** (not every 5 -- we don't need sub-minute freshness and 15min keeps GH Actions minutes budget low). The existing `guard` middleware (cron-secret check) applies.

**CDN warming mechanism:** The warm cron issues a plain `fetch('https://xdipx.com/')` with `x-cron-warm: 1` header (or simply no special header -- just a GET). Vercel's CDN will serve the cached version or revalidate if stale. This ensures the edge always has a warm entry for Googlebot's next hit. The PDP to warm is read from the `deal_history` table (`status = 'live'`).

### 3. Streaming (defer/Await)

**Decision: No streaming this pass.**

Rationale:
- The homepage is edge-cached with `s-maxage=60, stale-while-revalidate=600`. CDN full-response caching requires a complete response. `defer()` with streaming means the CDN can only cache the initial shell, not the deferred data, unless using a streaming-aware CDN edge function -- Vercel supports this but it changes the cache model significantly.
- The root cause is cold-start fan-out causing the function to hit the 60s `maxDuration` and return 5XX. Streaming doesn't help that -- it just shows content sooner to an interactive user. Googlebot waits for the full response.
- The correct fix for Googlebot is ensuring the full SSR response is fast (under 1s), which the cron warm + timeout hardening achieves without streaming complexity.
- Revisit streaming in a separate ADR once we have evidence that warm-cache TTFB is still above 500ms for interactive users (distinct from Googlebot).

### 4. Error Hardening: Uncached Calls

**Decision:** Fix the following this pass, in priority order:

**P0 -- pipelineSettings (legacy path, _layout._index.tsx:142-148):** Wrap the Drizzle select in `withTimeout(8000, defaultSettings)`. The `defaultSettings` fallback should use the same defaults that already appear in the `homepageSettings` extraction (template: 'endorsement', etc.).

**P1 -- listActiveRails (emma-rails.server.ts:224):** Add a KV cache layer with 5-minute TTL. The rails are Sanity documents that change infrequently. Use `cached('emma:active-rails', 300, fetcher)` from `kv.server.ts` to match the pattern used in `sanity.server.ts`. This removes a raw Sanity fetch from every legacy homepage request with a live deal.

**P1 -- getHomepageSections duplicate:** `_layout.tsx` and `_layout._index.tsx` both call `getHomepageSections()`. The `_layout.tsx` result is available in `_layout._index.tsx` via `useRouteLoaderData('routes/_layout')`. Remove the `getHomepageSections()` call from `_layout._index.tsx` and read the `cmsData` from the parent loader data instead. Since both are already KV-cached (60s), the win is one KV round-trip per cold-cache request rather than two, plus reduced Sanity calls on cache miss.

**P2 -- getProductReviews KV cache:** Add a 5-minute KV cache keyed on `reviews:{shopifyProductId}`. The function is already timeout-wrapped in the loader; this prevents 4 Neon queries per homepage SSR. New reviews take up to 5 minutes to appear on the homepage hero, which is acceptable.

**P2 -- getProductAggregate:** Same pattern, 5-minute KV cache keyed on `aggregate:{shopifyProductId}`.

**Out of scope this pass:** getSwatchMap Claude inference -- the `hot` in-process map and DB cache mean Claude is only called on genuinely new color labels. The 1500ms timeout is already bounded. Not a meaningful contributor to Googlebot TTFB after first warm-up.

---

## Alternatives Considered

- **Streaming (defer/Await):** Rejected for this pass. See Decision 3.
- **Edge Middleware for CDN priming:** Would require Vercel Edge Middleware, which moves code closer to the CDN but adds another layer. The cron warm approach achieves the same result without changing the execution model.
- **Long-lived process-level cache (Node module-scope Map):** Works for in-process hits but doesn't survive deploys or across multiple serverless instances. KV is the right tier.

---

## Consequences

- Googlebot TTFB on cold instances drops from 2-4s to <500ms (discovery build is no longer inline; remaining calls are KV-cached or timeout-bounded).
- 5XX rate should drop to near-zero; the timeout hardening on `pipelineSettings` eliminates the last known unbounded blocking call in the legacy path.
- Discovery Variant A renders an empty state for the ~30-second window after a cold KV clear, then the cron fills it. Acceptable -- empty state is already implemented.
- GH Actions scheduler needs one new entry for `/cron/warm` at `*/15 * * * *`.
- CDN cache behavior is unchanged -- no streaming, no Vary changes, no new routes that affect cache keys.

---

## Files to Touch

### Group A: Discovery + Cron (server/cron.ts, app/lib/discovery.server.ts)
- `server/cron.ts` -- add `/cron/warm` handler
- `app/lib/discovery.server.ts` -- add `scheduleDiscoveryRebuild()`, modify `getDiscoveryIndex()` to not rebuild inline

### Group B: Homepage loader dedup + pipelineSettings timeout (_layout._index.tsx only)
- `app/routes/_layout._index.tsx` -- remove `getHomepageSections()` call, read from parent loader data; wrap `pipelineSettings` select in `withTimeout`

### Group C: KV caching for rails + reviews (emma-rails.server.ts, reviews.server.ts)
- `app/lib/emma-rails.server.ts` -- KV-cache `listActiveRails()` (5 min TTL)
- `app/lib/reviews.server.ts` -- KV-cache `getProductReviews()` and `getProductAggregate()` (5 min TTL)

### Group D: GH Actions scheduler
- `.github/workflows/cron.yml` (or equivalent) -- add `/cron/warm` schedule

