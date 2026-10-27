/**
 * backfill-feed-images.ts — append Nalpac feed images a product never got.
 *
 * Audit 2026-10-26: 1,986 active products carried fewer images than the Nalpac
 * feed, about 14,500 images short. Two causes, neither a skipped feed file:
 *   - single-variant products (872): Nalpac added images after we imported
 *     (mostly its August 2026 refresh) and nothing re-syncs media after create.
 *     793 of them had exactly one image. Example: SKU 92272, 1 image vs 7.
 *   - multi-variant products (1,114): the importer takes the representative
 *     row's images only, so other colors and sizes never got theirs.
 *
 * This pass handles single-variant products only. Multi-variant needs each
 * image linked to its own variant and is a separate step.
 *
 * Rules:
 *   - Append-only. New images go after the existing ones via productCreateMedia,
 *     so media position 0 (what Shop and Shop Campaigns show) never changes.
 *   - A product with zero media is skipped: its first image would become
 *     position 0, and that is a primary-image decision, not a backfill.
 *   - Every new image gets alt text from altTextFor at its final position.
 *   - Matching is by filename stem, so an image Shopify renamed on upload
 *     counts as present (imageStem / missingFeedImages in lib/shop-image-hygiene).
 *   - A product none of whose images came from the feed is skipped. Its media
 *     was curated (AI-generated or hand-uploaded, e.g. the Tantus harness bag),
 *     and putting Nalpac shots back would undo that choice.
 *
 * Usage:
 *   npx tsx scripts/backfill-feed-images.ts                 # dry-run, whole catalog
 *   npx tsx scripts/backfill-feed-images.ts --limit 20      # cap products changed
 *   npx tsx scripts/backfill-feed-images.ts --handle x      # single product
 *   npx tsx scripts/backfill-feed-images.ts --limit 20 --apply
 *
 * --apply logs every created media id per product, so a run's own output is its
 * rollback list (productDeleteMedia with those ids).
 */

import 'dotenv/config'
import { adminGraphQL, copyMediaToProduct } from '../app/lib/shopify.server'
import { fetchAllNalpacFeeds } from '../app/lib/nalpac-feeds.server'
import { altTextFor, imageStem, missingFeedImages } from './lib/shop-image-hygiene'

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

const SHOP_PUBLICATION = 'gid://shopify/Publication/180118913195'
// Shopify allows 250 media per product; stay well under it.
const MEDIA_CAP = 50

interface ProductNode {
  id: string
  handle: string
  title: string
  vendor: string | null
  onShop: boolean
  variants: { nodes: { sku: string | null }[] }
  media: { nodes: { mediaContentType: string; image?: { url: string } | null }[] }
}

interface Plan {
  handle: string
  title: string
  vendor: string | null
  productId: string
  sku: string
  onShop: boolean
  existing: number
  adding: string[]
}

async function* iterateProducts(): AsyncGenerator<ProductNode> {
  const q = ONLY_HANDLE ? `handle:${ONLY_HANDLE}` : 'status:active'
  let cursor: string | null = null
  for (;;) {
    const data: {
      products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ProductNode[] }
    } = await adminGraphQL(
      `query Backfill($cursor: String, $q: String!) {
        products(first: 50, after: $cursor, query: $q) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id handle title vendor
            onShop: publishedOnPublication(publicationId: "${SHOP_PUBLICATION}")
            variants(first: 2) { nodes { sku } }
            media(first: 60) { nodes { mediaContentType ... on MediaImage { image { url } } } }
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

function feedImages(row: Record<string, string> | undefined): string[] {
  if (!row) return []
  const urls: string[] = []
  for (let i = 1; i <= 10; i++) {
    const url = row[`Image ${i}`]?.trim()
    if (url) urls.push(url)
  }
  return urls
}

async function main(): Promise<number> {
  const { snapshots, errors } = await fetchAllNalpacFeeds()
  for (const e of errors) process.stderr.write(`WARN feed: ${e}\n`)

  const plans: Plan[] = []
  let scanned = 0
  let skippedMulti = 0
  let skippedZeroMedia = 0
  let skippedCurated = 0
  let notInFeed = 0

  for await (const p of iterateProducts()) {
    if (plans.length >= LIMIT) break
    scanned++
    if (p.variants.nodes.length > 1) { skippedMulti++; continue }
    const sku = p.variants.nodes[0]?.sku?.trim() ?? ''
    const snap = sku ? snapshots.get(sku) : undefined
    if (!snap) { notInFeed++; continue }

    const existing = p.media.nodes.filter(m => m.mediaContentType === 'IMAGE' && m.image?.url).map(m => m.image!.url)
    if (p.media.nodes.length === 0) { skippedZeroMedia++; continue }

    const feed = feedImages(snap.raw.mainRow ?? snap.raw.saleRow)
    const feedStems = new Set(feed.map(imageStem))
    if (!existing.some(u => feedStems.has(imageStem(u)))) { skippedCurated++; continue }

    const adding = missingFeedImages(feed, existing)
      .slice(0, Math.max(0, MEDIA_CAP - p.media.nodes.length))
    if (adding.length === 0) continue
    plans.push({ handle: p.handle, title: p.title, vendor: p.vendor, productId: p.id, sku, onShop: p.onShop, existing: p.media.nodes.length, adding })
  }

  const imageCount = plans.reduce((n, p) => n + p.adding.length, 0)
  process.stdout.write(`${JSON.stringify({
    mode: APPLY ? 'apply' : 'dry-run',
    scanned,
    products: plans.length,
    images: imageCount,
    onShop: plans.filter(p => p.onShop).length,
    skippedMulti,
    skippedZeroMedia,
    skippedCurated,
    notInFeed,
    plans: plans.map(p => ({ handle: p.handle, sku: p.sku, onShop: p.onShop, existing: p.existing, adding: p.adding.length })),
  }, null, 2)}\n`)

  if (!APPLY) {
    process.stderr.write(`dry-run: ${imageCount} image(s) across ${plans.length} product(s). Re-run with --apply to write.\n`)
    return 0
  }

  let ok = 0
  let added = 0
  for (const plan of plans) {
    try {
      const created = await copyMediaToProduct(
        plan.productId,
        plan.adding.map((src, i) => ({ originalSrc: src, alt: altTextFor(plan.title, plan.vendor, plan.existing + i) })),
      )
      ok++
      added += created.length
      process.stderr.write(`APPLIED ${plan.handle}: +${created.length} on ${plan.productId} media ${created.map(c => c.mediaId).join(',')}\n`)
    } catch (err) {
      process.stderr.write(`ERROR ${plan.handle}: ${(err as Error).message}\n`)
    }
  }
  process.stderr.write(`applied ${ok}/${plans.length} product(s), ${added}/${imageCount} image(s)\n`)
  return ok === plans.length ? 0 : 1
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`ERROR: ${(err as Error).message}\n`)
    process.exit(2)
  },
)
