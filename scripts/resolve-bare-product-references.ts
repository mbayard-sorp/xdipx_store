/**
 * scripts/resolve-bare-product-references.ts
 *
 * Ticket #11474. instagram-campaigns.md §3.2c requires every on-skin frame
 * to be briefed from a bare, text-free product reference, and warns that
 * Shopify featuredMedia (media[0]) is sometimes the retail carton. Before
 * this ticket there was no detector, no flag, and no stored field for that —
 * it was a manual eyeball step on every brief, and a hand check of six
 * products found four of six carton-first and one with no bare frame in the
 * catalog at all. SKU 96203 is the documented cost of briefing from a carton
 * by mistake: the model reconstructed the toy from box art and invented a
 * stalk and club that do not exist.
 *
 * This script walks the catalog ONCE, resolves each active product's bare
 * frame with `resolveBareProductReference` (`app/lib/shopify.server.ts`) —
 * which excludes both packaging-looking frames and AI-generated ones
 * (`ai-generated-*.png`/`.jpg`, DONE WHEN 4) — and writes the verdict onto
 * `xdipx.bare_product_reference` so the social image path
 * (`app/routes/api.team.social-image.tsx`) can read it verbatim and refuse
 * cleanly rather than silently falling back to media[0].
 *
 * Read-only by default (DONE WHEN 3, the one-off audit): prints one line per
 * product and a JSON summary — including how many active products resolve to
 * `url: null` (no bare frame at all) — without touching Shopify. Pass
 * --apply to persist the verdicts. Products that already carry a resolved
 * value are skipped unless --force (fill-gaps semantics, same as
 * scripts/backfill-cast-target.ts).
 *
 * Usage:
 *   npx tsx scripts/resolve-bare-product-references.ts               # dry-run / audit
 *   npx tsx scripts/resolve-bare-product-references.ts --apply        # write (fills gaps only)
 *   npx tsx scripts/resolve-bare-product-references.ts --apply --force  # recompute + overwrite all
 *   npx tsx scripts/resolve-bare-product-references.ts --limit=25     # cap for a smoke test
 *
 * Exit code: 0 on a clean run, 1 if any product errored, 2 on a hard setup failure.
 */
// MUST be the first import — populates process.env (with override) before any
// downstream module reads it at evaluation time.
import './_load-env'
import { adminGraphQL, updateProductMetafield, resolveBareProductReference, ShopifyThrottleError } from '../app/lib/shopify.server'

// Same throttle handling as scripts/backfill-cast-target.ts: at catalog scale
// (~5,300 active products) this is one of the biggest consumers of the Admin
// GraphQL leaky bucket in a single run, and adminGraphQL's own in-loop retry
// gives up too soon under sustained load.
const THROTTLE_RETRIES = 6
const THROTTLE_BACKOFF_MS = 5000
const THROTTLE_MAX_WAIT_MS = 30_000

function throttleWaitMs(retryAfterMsHint: number, attempt: number): number {
  const escalating = attempt * THROTTLE_BACKOFF_MS
  return Math.min(Math.max(retryAfterMsHint, escalating), THROTTLE_MAX_WAIT_MS)
}

async function withThrottleRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const isThrottle = err instanceof ShopifyThrottleError || /throttl|429|exceeded.*calls per second/i.test(message)
      if (attempt > THROTTLE_RETRIES || !isThrottle) throw err
      const hint = err instanceof ShopifyThrottleError ? err.retryAfterMs : 0
      const waitMs = throttleWaitMs(hint, attempt)
      console.warn(`[throttle] attempt ${attempt}/${THROTTLE_RETRIES}, resting ${waitMs}ms`)
      await new Promise(r => setTimeout(r, waitMs))
    }
  }
}

interface Args {
  apply: boolean
  force: boolean
  limit: number
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2)
  const has = (flag: string) => args.includes(flag)
  const valOf = (prefix: string) => {
    const arg = args.find(a => a.startsWith(`${prefix}=`))
    return arg ? arg.slice(prefix.length + 1) : undefined
  }
  const limit = Number(valOf('--limit') ?? Infinity)
  return {
    apply: has('--apply'),
    force: has('--force'),
    limit: Number.isFinite(limit) && limit > 0 ? limit : Infinity,
  }
}

interface AdminImageNode { url: string; altText: string | null }
interface AdminProductNode {
  id: string
  handle: string
  title: string
  status: string
  images: { edges: { node: AdminImageNode }[] }
  existingRef: { value: string } | null
}
interface PageInfo { hasNextPage: boolean; endCursor: string | null }
type FetchResult = { products: { pageInfo: PageInfo; nodes: AdminProductNode[] } }

interface IndexedProduct {
  gid: string
  handle: string
  title: string
  images: { url: string; altText: string | null }[]
  alreadyResolved: boolean
}

async function fetchCatalogIndex(): Promise<IndexedProduct[]> {
  const out: IndexedProduct[] = []
  let cursor: string | null = null
  let hasNextPage = true
  let page = 0

  while (hasNextPage) {
    page++
    const data: FetchResult = await withThrottleRetry(() => adminGraphQL<FetchResult>(`
      query ResolveBareProductReferenceIndex($first: Int!, $after: String) {
        products(first: $first, after: $after, query: "status:active") {
          pageInfo { hasNextPage endCursor }
          nodes {
            id handle title status
            images(first: 20) { edges { node { url altText } } }
            existingRef: metafield(namespace: "xdipx", key: "bare_product_reference") { value }
          }
        }
      }
    `, { first: 50, after: cursor }))

    const conn = data.products
    hasNextPage = conn.pageInfo.hasNextPage
    cursor = conn.pageInfo.endCursor

    for (const node of conn.nodes) {
      out.push({
        gid: node.id,
        handle: node.handle,
        title: node.title,
        images: node.images.edges.map(e => ({ url: e.node.url, altText: e.node.altText })),
        alreadyResolved: node.existingRef != null,
      })
    }

    console.log(`[index] page ${page}: +${conn.nodes.length} products, cumulative=${out.length}`)
  }

  return out
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv)
  const catalog = await fetchCatalogIndex()
  const candidates = (args.force ? catalog : catalog.filter(p => !p.alreadyResolved)).slice(0, args.limit)

  console.log(
    `[plan] ${catalog.length} active products, ${candidates.length} to ` +
    `${args.force ? 'recompute + overwrite' : 'resolve (missing xdipx.bare_product_reference)'}` +
    (args.limit !== Infinity ? ` (capped at ${args.limit})` : ''),
  )

  let wrote = 0
  let errors = 0
  let resolvedNull = 0
  let resolvedUrl = 0
  const nullReasons: Record<string, number> = {}
  const noBareFrameHandles: string[] = []

  for (const p of candidates) {
    const resolution = resolveBareProductReference(p.images)
    if (resolution.url == null) {
      resolvedNull++
      nullReasons[resolution.reason] = (nullReasons[resolution.reason] ?? 0) + 1
      noBareFrameHandles.push(p.handle)
    } else {
      resolvedUrl++
    }
    console.log(`${p.handle}: ${resolution.url ?? 'NULL'} (${resolution.reason})`)

    if (!args.apply) continue
    try {
      const metafieldValue: import('../app/lib/shopify.server').BareProductReferenceMetafield = {
        ...resolution,
        resolvedAt: new Date().toISOString(),
        method: 'heuristic',
      }
      await withThrottleRetry(() =>
        updateProductMetafield(p.gid, 'bare_product_reference', JSON.stringify(metafieldValue), 'json'),
      )
      wrote++
      // The REST metafields endpoint leaks at ~2 calls/sec; pace writes under
      // that proactively (same reasoning as backfill-cast-target.ts).
      await new Promise(r => setTimeout(r, 550))
    } catch (err) {
      errors++
      console.error(`ERROR writing ${p.handle}:`, err instanceof Error ? err.message : err)
    }
  }

  const stillUnresolved = args.apply
    ? catalog.filter(p => !p.alreadyResolved && !candidates.some(c => c.gid === p.gid)).length
    : catalog.filter(p => !p.alreadyResolved).length - candidates.length

  console.log(args.apply
    ? `applied ${wrote} write(s), ${errors} error(s). Still unresolved after this run: ${stillUnresolved}.`
    : 'dry-run (re-run with --apply to write)')

  // DONE WHEN (3): the catalog gap as a number the owner can act on.
  console.log(JSON.stringify({
    scanned: catalog.length,
    alreadyResolved: catalog.filter(p => p.alreadyResolved).length,
    checkedThisRun: candidates.length,
    resolvedWithUrl: resolvedUrl,
    resolvedNull,
    resolvedNullReasons: nullReasons,
    noBareFrameHandles,
    wrote,
    errors,
    applied: args.apply,
    forced: args.force,
  }, null, 2))

  return errors > 0 ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('ERROR:', err instanceof Error ? err.message : err)
    process.exit(2)
  },
)
