/**
 * One-time backfill for `xdipx.cast_target` (ADR-015, ticket #10730).
 *
 * Every live product gets a derived default computed from its existing
 * `product_type_dial` / `product_subtype_dial` metafields (see
 * `deriveCastTarget` in `app/lib/cast-target.server.ts`) — this is what makes
 * the field non-inert on day one, so the cast-target gate's fail-closed
 * default (ADR-015 §5) is a near-zero-occurrence case rather than a chronic
 * zero-day generator. A product that already carries an explicit
 * `xdipx.cast_target` value is left untouched (fill-gaps) unless --force is
 * passed.
 *
 * Usage:
 *   npx tsx scripts/backfill-cast-target.ts            # dry-run: show plan
 *   npx tsx scripts/backfill-cast-target.ts --apply     # write (only fills empty)
 *   npx tsx scripts/backfill-cast-target.ts --apply --force  # overwrite non-empty too
 *   npx tsx scripts/backfill-cast-target.ts --limit=10  # cap for a smoke test
 *
 * Exit code: 0 on a clean run, 1 if any product errored, 2 on a hard setup failure.
 */
// MUST be the first import — populates process.env (with override) before any
// downstream module reads it at evaluation time.
import './_load-env'
import { adminGraphQL, updateProductMetafield, ShopifyThrottleError } from '../app/lib/shopify.server'
import { deriveCastTarget } from '../app/lib/cast-target.server'
import type { ProductTypeDial, ProductSubtypeDial } from '../app/types'

// At catalog scale (~5,300 active products) this script is the single
// biggest consumer of the Admin GraphQL leaky bucket in one run.
// adminGraphQL's own in-loop retry caps its wait at 5s and gives up after 4
// attempts, which is not long enough for the bucket to actually refill under
// sustained load (the same failure mode documented at
// PRICING_FETCH_THROTTLE_MAX_WAIT_MS in shopify.server.ts) — this mirrors
// that fix: a longer, escalating rest that prefers Shopify's own refill
// estimate before re-fetching the same page or re-issuing the same write.
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
      // GraphQL surfaces THROTTLED errors; the REST metafields write below
      // hits a different bucket ("Exceeded N calls per second") and reports
      // it as a plain 429, so both shapes have to match here or the REST
      // write path never actually retries.
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

interface AdminMetafieldNode { key: string; value: string }
interface AdminProductNode {
  id: string
  handle: string
  title: string
  status: string
  xdipxMf: { nodes: AdminMetafieldNode[] }
  customMf: { nodes: AdminMetafieldNode[] }
}
interface PageInfo { hasNextPage: boolean; endCursor: string | null }
type FetchResult = { products: { pageInfo: PageInfo; nodes: AdminProductNode[] } }

interface IndexedProduct {
  gid: string
  handle: string
  title: string
  productTypeDial: string
  productSubtypeDial: string
  existingCastTarget: string
}

async function fetchCatalogIndex(): Promise<IndexedProduct[]> {
  const out: IndexedProduct[] = []
  let cursor: string | null = null
  let hasNextPage = true
  let page = 0

  while (hasNextPage) {
    page++
    const data: FetchResult = await withThrottleRetry(() => adminGraphQL<FetchResult>(`
      query BackfillCastTargetIndex($first: Int!, $after: String) {
        products(first: $first, after: $after, query: "status:active") {
          pageInfo { hasNextPage endCursor }
          nodes {
            id handle title status
            xdipxMf: metafields(namespace: "xdipx", first: 100) { nodes { key value } }
            customMf: metafields(namespace: "custom", first: 5) { nodes { key value } }
          }
        }
      }
    `, { first: 50, after: cursor }))

    const conn = data.products
    hasNextPage = conn.pageInfo.hasNextPage
    cursor = conn.pageInfo.endCursor

    for (const node of conn.nodes) {
      const xVal = (key: string) => node.xdipxMf.nodes.find(m => m.key === key)?.value ?? ''
      const cVal = (key: string) => node.customMf.nodes.find(m => m.key === key)?.value ?? ''
      out.push({
        gid:    node.id,
        handle: node.handle,
        title:  node.title,
        productTypeDial:    xVal('product_type_dial'),
        productSubtypeDial: cVal('product_subtype_dial'),
        existingCastTarget: xVal('cast_target'),
      })
    }

    console.log(`[index] page ${page}: +${conn.nodes.length} products, cumulative=${out.length}`)
  }

  return out
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv)
  const catalog = await fetchCatalogIndex()
  const candidates = (args.force ? catalog : catalog.filter(p => !p.existingCastTarget.trim())).slice(0, args.limit)

  console.log(
    `[plan] ${catalog.length} active products, ${candidates.length} to ` +
    `${args.force ? 'overwrite' : 'fill (missing xdipx.cast_target)'}` +
    (args.limit !== Infinity ? ` (capped at ${args.limit})` : ''),
  )

  let wrote = 0
  let errors = 0
  for (const p of candidates) {
    const target = deriveCastTarget(
      p.productTypeDial as ProductTypeDial || null,
      p.productSubtypeDial as ProductSubtypeDial || null,
    )
    console.log(
      `${p.handle} (type=${p.productTypeDial || '(none)'}, subtype=${p.productSubtypeDial || '(none)'}) ` +
      `-> ${target}${p.existingCastTarget ? ` [was: ${p.existingCastTarget}]` : ''}`,
    )
    if (!args.apply) continue
    try {
      await withThrottleRetry(() => updateProductMetafield(p.gid, 'cast_target', target))
      wrote++
      // The REST metafields endpoint leaks at ~2 calls/sec; pace writes under
      // that proactively instead of relying solely on reactive retry, which
      // otherwise burns the whole retry budget on the first few hundred
      // products of a >5,000-product catalog.
      await new Promise(r => setTimeout(r, 550))
    } catch (err) {
      errors++
      console.error(`ERROR writing ${p.handle}:`, err instanceof Error ? err.message : err)
    }
  }

  const unclassified = args.apply
    ? catalog.filter(p => !p.existingCastTarget.trim() && !candidates.some(c => c.gid === p.gid)).length
    : catalog.filter(p => !p.existingCastTarget.trim()).length - candidates.length

  console.log(
    args.apply
      ? `applied ${wrote} write(s), ${errors} error(s). Still unclassified after this run: ${unclassified}.`
      : 'dry-run (re-run with --apply to write)',
  )
  return errors > 0 ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('ERROR:', err instanceof Error ? err.message : err)
    process.exit(2)
  },
)
