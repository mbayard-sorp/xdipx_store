/**
 * backfill-shop-channel-publish.ts — publish historical active products to
 * the Shop app sales channel. Ticket #22341's sibling ticket #22350.
 *
 * Measured 2026-11-16: 2,283 ACTIVE products are absent from the Shop
 * publication (gid 180118913195, name "Shop"), the channel behind 86 percent
 * of this store's attributed orders. Every sampled row predates 2026-10-20,
 * so this is historical backlog, not a regression in the live import path
 * (`publishProductToXdipxChannels` in app/lib/shopify.server.ts already
 * publishes new imports to Shop). This script is the one-shot catch-up for
 * everything that import path never touched.
 *
 * Deliberately narrower than `publishProductToXdipxChannels`: that function
 * reconciles a product against the FULL xdipx channel set (Online Store,
 * Storefront Admin, Google & YouTube, ChatGPT, Shop) and unpublishes from
 * Point of Sale. This script's whole job is the Shop gap specifically, so it
 * calls `publishablePublish` with only the Shop publication id and never
 * touches any other channel or does any unpublishing.
 *
 * Excludes:
 *   - productType "Discontinued" (246 of the 2,283; legitimately absent).
 *   - any product with `xdipx.discontinued_at` set (belt-and-suspenders with
 *     the productType check: the nightly feed sweep stamps this metafield
 *     independently of productType, see feed-processor.server.ts).
 *   - any product Shopify has already refused on a prior run of this script.
 *     The Shop channel applies its own mature-content rules on top of
 *     product-level publish permissions, so a refusal here is expected on
 *     some rows, not a bug to retry into forever. Recorded durably as the
 *     `xdipx.shop_publish_refused_at` metafield (read back via the same
 *     product query next run, exactly like `discontinued_at` already is) so
 *     a later pass never re-attempts and re-fails the same row.
 *
 * Usage:
 *   npx tsx scripts/backfill-shop-channel-publish.ts                 # dry-run, whole catalog
 *   npx tsx scripts/backfill-shop-channel-publish.ts --limit 50      # cap products attempted
 *   npx tsx scripts/backfill-shop-channel-publish.ts --handle x      # single product
 *   npx tsx scripts/backfill-shop-channel-publish.ts --apply
 *
 * --apply logs every published handle and every newly-refused handle (with
 * Shopify's own userError message) to stderr, so a run's own output is a
 * record of what changed.
 */

import './_load-env'
import { adminGraphQL, updateProductMetafield } from '../app/lib/shopify.server'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  if (i === -1) return undefined
  const v = argv[i + 1]
  return v && !v.startsWith('--') ? v : undefined
}
const LIMIT = Number(flag('limit') ?? Infinity)
const ONLY_HANDLE = flag('handle')

export const SHOP_PUBLICATION = 'gid://shopify/Publication/180118913195'

export type ShopBackfillAction =
  | 'publish'
  | 'skip-discontinued-type'
  | 'skip-discontinued-at'
  | 'skip-already-refused'

export interface ShopBackfillCandidate {
  productType: string | null
  discontinuedAt: string | null
  refusedAt: string | null
}

/**
 * Pure classification, exported and unit-tested separately from the Admin
 * API calls below (same split `scripts/backfill-inventory-resync.ts` uses
 * for its own decision predicate). Order matters only for which skip reason
 * is reported when more than one applies; the end result (never published)
 * is the same either way.
 */
export function classifyForShopBackfill(c: ShopBackfillCandidate): ShopBackfillAction {
  if ((c.productType ?? '').trim().toLowerCase() === 'discontinued') return 'skip-discontinued-type'
  if ((c.discontinuedAt ?? '').trim()) return 'skip-discontinued-at'
  if ((c.refusedAt ?? '').trim()) return 'skip-already-refused'
  return 'publish'
}

interface ProductNode {
  id: string
  handle: string
  title: string
  productType: string
  discontinuedAtRaw: { value: string } | null
  refusedAtRaw: { value: string } | null
}

async function* iterateMissingFromShop(): AsyncGenerator<ProductNode> {
  const base = 'status:active -publication_ids:180118913195'
  const q = ONLY_HANDLE ? `${base} handle:${ONLY_HANDLE}` : base
  let cursor: string | null = null
  for (;;) {
    const data: {
      products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ProductNode[] }
    } = await adminGraphQL(
      `query ShopBackfill($cursor: String, $q: String!) {
        products(first: 50, after: $cursor, query: $q) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id handle title productType
            discontinuedAtRaw: metafield(namespace: "xdipx", key: "discontinued_at") { value }
            refusedAtRaw: metafield(namespace: "xdipx", key: "shop_publish_refused_at") { value }
          }
        }
      }`,
      { cursor, q },
    )
    for (const node of data.products.nodes) yield node
    if (!data.products.pageInfo.hasNextPage) return
    cursor = data.products.pageInfo.endCursor
  }
}

interface Plan {
  id: string
  handle: string
  title: string
  action: ShopBackfillAction
}

/** Publish a single product to the Shop channel only. Never throws: a
 *  mutation userError (e.g. the Shop channel's own mature-content refusal)
 *  comes back as a reason string instead, so the caller can record it and
 *  keep going rather than aborting the batch. */
async function publishToShop(productId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const res = await adminGraphQL<{
      publishablePublish: { userErrors: { field: string[] | null; message: string }[] }
    }>(
      `mutation PublishToShop($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          userErrors { field message }
        }
      }`,
      { id: productId, input: [{ publicationId: SHOP_PUBLICATION }] },
    )
    const errs = res.publishablePublish?.userErrors ?? []
    if (errs.length) return { ok: false, reason: errs.map(e => e.message).join('; ') }
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

async function main(): Promise<number> {
  const plans: Plan[] = []
  let scanned = 0
  const skipCounts: Record<Exclude<ShopBackfillAction, 'publish'>, number> = {
    'skip-discontinued-type': 0,
    'skip-discontinued-at': 0,
    'skip-already-refused': 0,
  }

  for await (const p of iterateMissingFromShop()) {
    scanned++
    const action = classifyForShopBackfill({
      productType: p.productType,
      discontinuedAt: p.discontinuedAtRaw?.value ?? null,
      refusedAt: p.refusedAtRaw?.value ?? null,
    })
    if (action !== 'publish') {
      skipCounts[action]++
      continue
    }
    if (plans.length >= LIMIT) continue
    plans.push({ id: p.id, handle: p.handle, title: p.title, action })
  }

  process.stdout.write(`${JSON.stringify({
    mode: APPLY ? 'apply' : 'dry-run',
    scanned,
    toPublish: plans.length,
    skipDiscontinuedType: skipCounts['skip-discontinued-type'],
    skipDiscontinuedAt: skipCounts['skip-discontinued-at'],
    expectedRefusal: skipCounts['skip-already-refused'],
    plans: plans.map(p => ({ handle: p.handle, title: p.title })),
  }, null, 2)}\n`)

  if (!APPLY) {
    process.stderr.write(`dry-run: ${plans.length} product(s) would be published to Shop. Re-run with --apply to write.\n`)
    return 0
  }

  let published = 0
  let refused = 0
  for (const plan of plans) {
    const res = await publishToShop(plan.id)
    if (res.ok) {
      published++
      process.stderr.write(`PUBLISHED ${plan.handle} (${plan.id})\n`)
    } else {
      refused++
      try {
        await updateProductMetafield(plan.id, 'shop_publish_refused_at', new Date().toISOString().slice(0, 10), 'date')
      } catch (err) {
        process.stderr.write(`WARN ${plan.handle}: refused AND failed to record shop_publish_refused_at: ${(err as Error).message}\n`)
      }
      process.stderr.write(`REFUSED ${plan.handle} (${plan.id}): ${res.reason}\n`)
    }
  }
  process.stderr.write(`applied: published ${published}/${plans.length}, refused ${refused}/${plans.length}\n`)
  return 0
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`ERROR: ${(err as Error).message}\n`)
    process.exit(2)
  },
)
