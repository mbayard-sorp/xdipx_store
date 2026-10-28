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
 * Default mode handles single-variant products: every missing feed image.
 *
 * --variants mode handles multi-variant products, deliberately narrower. The
 * PDP fetches only the first 10 product images and only jumps to a variant's
 * image when it is among them, so appending every angle shot would mostly add
 * images nobody sees. Instead it fixes the variant link a shopper notices:
 *   - a variant with no linked media gets linked to its own image, appending
 *     its first feed image when none of its images is on the product yet;
 *   - a variant linked to another variant's image while none of its own images
 *     is on the product gets its first feed image appended and linked.
 * A variant already linked to another variant's image while one of its own is
 * on the product is left alone: size variants often share the same picture.
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
 *   - An image Shopify fails to process (a corrupt Nalpac file) is deleted again
 *     so no broken media entry is left on the product.
 *
 * Usage:
 *   npx tsx scripts/backfill-feed-images.ts                 # dry-run, whole catalog
 *   npx tsx scripts/backfill-feed-images.ts --limit 20      # cap products changed
 *   npx tsx scripts/backfill-feed-images.ts --handle x      # single product
 *   npx tsx scripts/backfill-feed-images.ts --limit 20 --apply
 *   npx tsx scripts/backfill-feed-images.ts --variants      # multi-variant links, dry-run
 *
 * --apply logs every created media id per product, and in --variants mode each
 * variant's previous media id, so a run's own output is its rollback list.
 */

import 'dotenv/config'
import { adminGraphQL } from '../app/lib/shopify.server'
import { fetchAllNalpacFeeds, type NalpacPriceSnapshot } from '../app/lib/nalpac-feeds.server'
import { altTextFor, imageStem, missingFeedImages } from './lib/shop-image-hygiene'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const VARIANTS = argv.includes('--variants')
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

interface MediaNode {
  id: string
  mediaContentType: string
  image?: { url: string } | null
}

interface VariantNode {
  id: string
  title: string
  sku: string | null
  media: { nodes: { id: string }[] }
}

interface ProductNode {
  id: string
  handle: string
  title: string
  vendor: string | null
  onShop: boolean
  variants: { nodes: VariantNode[] }
  media: { nodes: MediaNode[] }
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

interface VariantFix {
  variantId: string
  variantTitle: string
  sku: string
  previousMediaId: string | null
  /** Media already on the product to link, or null when `appendSrc` is created first. */
  linkMediaId: string | null
  appendSrc: string | null
  reason: 'unlinked' | 'own-image-missing'
}

interface VariantPlan {
  handle: string
  title: string
  vendor: string | null
  productId: string
  onShop: boolean
  existing: number
  fixes: VariantFix[]
}

async function* iterateProducts(): AsyncGenerator<ProductNode> {
  const q = ONLY_HANDLE ? `handle:${ONLY_HANDLE}` : 'status:active'
  let cursor: string | null = null
  for (;;) {
    const data: {
      products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ProductNode[] }
    } = await adminGraphQL(
      `query Backfill($cursor: String, $q: String!) {
        products(first: 25, after: $cursor, query: $q) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id handle title vendor
            onShop: publishedOnPublication(publicationId: "${SHOP_PUBLICATION}")
            variants(first: 100) { nodes { id title sku media(first: 1) { nodes { id } } } }
            media(first: 100) { nodes { id mediaContentType ... on MediaImage { image { url } } } }
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

function feedImages(snap: NalpacPriceSnapshot | undefined): string[] {
  const row = snap?.raw.mainRow ?? snap?.raw.saleRow
  if (!row) return []
  const urls: string[] = []
  for (let i = 1; i <= 10; i++) {
    const url = row[`Image ${i}`]?.trim()
    if (url) urls.push(url)
  }
  return urls
}

/**
 * Append images to a product and wait for Shopify to process them. Unlike
 * copyMediaToProduct this never throws on a FAILED image: it returns what
 * landed, deletes what failed, and reports both, so a partial product is
 * still logged for rollback.
 */
async function appendMedia(
  productId: string,
  sources: { src: string; alt: string }[],
): Promise<{ ready: { id: string; src: string }[]; failed: string[] }> {
  const res = await adminGraphQL<{
    productCreateMedia: {
      media: { id: string }[]
      mediaUserErrors: { field: string[]; message: string }[]
    }
  }>(
    `mutation Append($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { id }
        mediaUserErrors { field message }
      }
    }`,
    { productId, media: sources.map(s => ({ originalSource: s.src, alt: s.alt, mediaContentType: 'IMAGE' })) },
  )
  const errs = res.productCreateMedia.mediaUserErrors
  if (errs.length) throw new Error(`productCreateMedia: ${errs.map(e => e.message).join('; ')}`)
  const created = res.productCreateMedia.media.map((m, i) => ({ id: m.id, src: sources[i]!.src }))

  const deadline = Date.now() + 60_000
  let statuses = new Map<string, string>()
  for (;;) {
    const poll = await adminGraphQL<{ nodes: ({ id: string; status: string } | null)[] }>(
      `query Status($ids: [ID!]!) { nodes(ids: $ids) { ... on MediaImage { id status } } }`,
      { ids: created.map(c => c.id) },
    )
    statuses = new Map(poll.nodes.filter((n): n is { id: string; status: string } => !!n).map(n => [n.id, n.status]))
    const pending = created.some(c => !['READY', 'FAILED'].includes(statuses.get(c.id) ?? ''))
    if (!pending || Date.now() > deadline) break
    await new Promise(r => setTimeout(r, 1500))
  }

  const ready = created.filter(c => statuses.get(c.id) === 'READY')
  const failed = created.filter(c => statuses.get(c.id) !== 'READY')
  if (failed.length) {
    await adminGraphQL(`mutation Drop($ids: [ID!]!) { fileDelete(fileIds: $ids) { userErrors { message } } }`, { ids: failed.map(f => f.id) })
  }
  return { ready, failed: failed.map(f => f.src) }
}

async function runSingle(snapshots: Map<string, NalpacPriceSnapshot>): Promise<number> {
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

    const feed = feedImages(snap)
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
      const { ready, failed } = await appendMedia(
        plan.productId,
        plan.adding.map((src, i) => ({ src, alt: altTextFor(plan.title, plan.vendor, plan.existing + i) })),
      )
      if (!failed.length) ok++
      added += ready.length
      process.stderr.write(`APPLIED ${plan.handle}: +${ready.length} on ${plan.productId} media ${ready.map(r => r.id).join(',')}\n`)
      for (const src of failed) process.stderr.write(`ERROR ${plan.handle}: image failed processing and was deleted: ${src}\n`)
    } catch (err) {
      process.stderr.write(`ERROR ${plan.handle}: ${(err as Error).message}\n`)
    }
  }
  process.stderr.write(`applied ${ok}/${plans.length} product(s), ${added}/${imageCount} image(s)\n`)
  return ok === plans.length ? 0 : 1
}

async function runVariants(snapshots: Map<string, NalpacPriceSnapshot>): Promise<number> {
  const plans: VariantPlan[] = []
  let scanned = 0
  let skippedZeroMedia = 0
  let skippedCurated = 0

  for await (const p of iterateProducts()) {
    if (plans.length >= LIMIT) break
    if (p.variants.nodes.length < 2) continue
    scanned++
    if (p.media.nodes.length === 0) { skippedZeroMedia++; continue }

    const images = p.media.nodes.filter(m => m.mediaContentType === 'IMAGE' && m.image?.url)
    const mediaByStem = new Map<string, string>()
    for (const m of images) {
      const stem = imageStem(m.image!.url)
      if (!mediaByStem.has(stem)) mediaByStem.set(stem, m.id)
    }
    const stemById = new Map(images.map(m => [m.id, imageStem(m.image!.url)]))
    const allFeedStems = new Set(p.variants.nodes.flatMap(v => feedImages(snapshots.get(v.sku?.trim() ?? '')).map(imageStem)))
    if (![...mediaByStem.keys()].some(s => allFeedStems.has(s))) { skippedCurated++; continue }

    const fixes: VariantFix[] = []
    for (const v of p.variants.nodes) {
      const sku = v.sku?.trim() ?? ''
      const feed = feedImages(snapshots.get(sku))
      if (!feed.length) continue
      const ownStems = new Set(feed.map(imageStem))
      const linked = v.media.nodes[0]?.id ?? null
      const linkedStem = linked ? stemById.get(linked) : undefined
      if (linkedStem && ownStems.has(linkedStem)) continue

      const presentSrc = feed.find(u => mediaByStem.has(imageStem(u)))
      const present = presentSrc ? mediaByStem.get(imageStem(presentSrc))! : null
      if (!linked) {
        fixes.push({ variantId: v.id, variantTitle: v.title, sku, previousMediaId: null, linkMediaId: present, appendSrc: present ? null : feed[0]!, reason: 'unlinked' })
      } else if (!present) {
        fixes.push({ variantId: v.id, variantTitle: v.title, sku, previousMediaId: linked, linkMediaId: null, appendSrc: feed[0]!, reason: 'own-image-missing' })
      }
    }
    if (fixes.length) plans.push({ handle: p.handle, title: p.title, vendor: p.vendor, productId: p.id, onShop: p.onShop, existing: p.media.nodes.length, fixes })
  }

  const all = plans.flatMap(p => p.fixes)
  const appendCount = all.filter(f => f.appendSrc).length
  process.stdout.write(`${JSON.stringify({
    mode: APPLY ? 'apply' : 'dry-run',
    variantsMode: true,
    scanned,
    products: plans.length,
    onShop: plans.filter(p => p.onShop).length,
    variantFixes: all.length,
    unlinked: all.filter(f => f.reason === 'unlinked').length,
    ownImageMissing: all.filter(f => f.reason === 'own-image-missing').length,
    imagesToAppend: appendCount,
    skippedZeroMedia,
    skippedCurated,
    plans: plans.map(p => ({ handle: p.handle, onShop: p.onShop, existing: p.existing, fixes: p.fixes.map(f => ({ variant: f.variantTitle, sku: f.sku, reason: f.reason, link: f.linkMediaId ? 'existing' : 'append' })) })),
  }, null, 2)}\n`)

  if (!APPLY) {
    process.stderr.write(`dry-run: ${all.length} variant fix(es) across ${plans.length} product(s), ${appendCount} image(s) to append. Re-run with --apply to write.\n`)
    return 0
  }

  let ok = 0
  let linkedCount = 0
  for (const plan of plans) {
    try {
      const toAppend = [...new Set(plan.fixes.map(f => f.appendSrc).filter((s): s is string => !!s))]
      const created = new Map<string, string>()
      const failedSrc = new Set<string>()
      if (toAppend.length) {
        const { ready, failed } = await appendMedia(
          plan.productId,
          toAppend.map((src, i) => ({ src, alt: altTextFor(plan.title, plan.vendor, plan.existing + i) })),
        )
        for (const r of ready) created.set(r.src, r.id)
        for (const s of failed) failedSrc.add(s)
        process.stderr.write(`APPENDED ${plan.handle}: +${ready.length} on ${plan.productId} media ${ready.map(r => r.id).join(',')}\n`)
        for (const s of failed) process.stderr.write(`ERROR ${plan.handle}: image failed processing and was deleted: ${s}\n`)
      }

      const links = plan.fixes
        .map(f => ({ f, mediaId: f.linkMediaId ?? (f.appendSrc ? created.get(f.appendSrc) : undefined) }))
        .filter((x): x is { f: VariantFix; mediaId: string } => !!x.mediaId)
      if (links.length) {
        const res = await adminGraphQL<{ productVariantsBulkUpdate: { userErrors: { field: string[]; message: string }[] } }>(
          `mutation Link($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } }
          }`,
          { productId: plan.productId, variants: links.map(l => ({ id: l.f.variantId, mediaId: l.mediaId })) },
        )
        const errs = res.productVariantsBulkUpdate.userErrors
        if (errs.length) throw new Error(`productVariantsBulkUpdate: ${errs.map(e => e.message).join('; ')}`)
        linkedCount += links.length
        for (const l of links) {
          process.stderr.write(`LINKED ${plan.handle}: ${l.f.variantId} (${l.f.variantTitle}) -> ${l.mediaId} (was ${l.f.previousMediaId ?? 'none'})\n`)
        }
      }
      if (links.length === plan.fixes.length && !failedSrc.size) ok++
    } catch (err) {
      process.stderr.write(`ERROR ${plan.handle}: ${(err as Error).message}\n`)
    }
  }
  process.stderr.write(`applied ${ok}/${plans.length} product(s), ${linkedCount}/${all.length} variant link(s)\n`)
  return ok === plans.length ? 0 : 1
}

async function main(): Promise<number> {
  const { snapshots, errors } = await fetchAllNalpacFeeds()
  for (const e of errors) process.stderr.write(`WARN feed: ${e}\n`)
  return VARIANTS ? runVariants(snapshots) : runSingle(snapshots)
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`ERROR: ${(err as Error).message}\n`)
    process.exit(2)
  },
)
