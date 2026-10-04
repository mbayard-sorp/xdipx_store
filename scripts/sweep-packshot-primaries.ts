/**
 * sweep-packshot-primaries.ts — catalog-wide packaging-shot primary detector
 * (ticket #90).
 *
 * Run 89 pinned Tantus Cush O2 as hero and its Shopify PRIMARY image (77791A)
 * was the retail blister-pack packaging shot — a wide package floating in a
 * 1000x1000 canvas with big white bands and baked-in packaging text. The owner
 * rejected the look; the fix was promoting the clean product shot (77791B) to
 * position 0. Nalpac-imported products commonly ship the packaging shot first,
 * so this is catalog-wide: every PDP and card renders whatever sits at media
 * position 0.
 *
 * Detection heuristics, per active product with 2+ images:
 *
 *   1. FILENAME (confident — the only heuristic --apply acts on): the primary
 *      image's filename stem ends in the letter A after a digit (the Nalpac
 *      packaging-shot convention, e.g. 77791A.jpg) AND a sibling image shares
 *      the same stem with a later letter (77791B/77791C…). Proposed fix:
 *      promote the lowest-lettered non-A sibling to position 0.
 *
 *   2. PIXELS (--pixels, report-only): downloads the primary image and
 *      measures the non-white content bounding box. A near-square canvas whose
 *      content is a wide band (bbox aspect >= 1.6 with large empty top/bottom
 *      bands) renders as an odd letterboxed landscape inside product frames —
 *      the packaging-shot signature. Flagged for eyeballing, never auto-fixed:
 *      some legitimate product shots (wands lying flat) are genuinely wide.
 *
 * Usage:
 *   npx tsx scripts/sweep-packshot-primaries.ts                # dry-run, filename heuristic
 *   npx tsx scripts/sweep-packshot-primaries.ts --pixels       # + pixel analysis of primaries
 *   npx tsx scripts/sweep-packshot-primaries.ts --apply        # reorder confident candidates
 *   npx tsx scripts/sweep-packshot-primaries.ts --limit 50     # cap products scanned
 *   npx tsx scripts/sweep-packshot-primaries.ts --handle x     # single product
 *
 * Dry-run is the default; --apply writes via productReorderMedia
 * (setMediaAsPrimary in app/lib/shopify.server.ts).
 *
 * Shop image clean-up (docs/store-team/shop-image-strategy.md Layer 1,
 * owner direction 2026-09-30):
 *
 *   - Apparel is skipped by default. Its clean "B" sibling is usually the
 *     garment on a model, which ads-policy §Shop rule 4 keeps off position 0.
 *     Pass --include-apparel to override.
 *   - --alt-text also writes alt text to every image on a scanned product
 *     that has none (title plus brand, "view N" for later images), via
 *     fileUpdate in batches of 50. Honors --apply like the reorder does.
 *   - --zero-media reports (never writes) active products with no media at
 *     all, alongside the Nalpac main feed's "Image 1" URL for that SKU when
 *     one is on file, so shopify-ops has a ready link to pull from. A product
 *     with zero media cannot be approved on Shop (SKU 101629).
 *
 *   npx tsx scripts/sweep-packshot-primaries.ts --alt-text           # dry-run both
 *   npx tsx scripts/sweep-packshot-primaries.ts --alt-text --apply   # write both
 *   npx tsx scripts/sweep-packshot-primaries.ts --zero-media         # report only
 */

import 'dotenv/config'
import { adminGraphQL, setMediaAsPrimary, parseMetafield } from '../app/lib/shopify.server'
import { altTextFor, chunk, isApparelTitle, nalpacImageOneUrl } from './lib/shop-image-hygiene'
import { fetchAllNalpacFeeds } from '../app/lib/nalpac-feeds.server'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const PIXELS = argv.includes('--pixels')
const ALT_TEXT = argv.includes('--alt-text')
const ZERO_MEDIA = argv.includes('--zero-media')
const INCLUDE_APPAREL = argv.includes('--include-apparel')
function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  if (i === -1) return undefined
  const v = argv[i + 1]
  return v && !v.startsWith('--') ? v : undefined
}
const LIMIT = Number(flag('limit') ?? Infinity)
const ONLY_HANDLE = flag('handle')

interface MediaNode {
  id: string
  mediaContentType?: string
  image?: { url?: string | null; width?: number | null; height?: number | null; altText?: string | null } | null
}

interface ProductNode {
  id: string
  handle: string
  title: string
  vendor?: string | null
  media: { nodes: MediaNode[] }
  nalpacSkuMetafield: { namespace: string; key: string; value: string } | null
}

interface ZeroMediaEntry {
  handle: string
  title: string
  nalpacSku: string | null
  nalpacImageOneUrl: string | null
}

/**
 * Filename stem for a Shopify CDN url: basename, minus query, extension, and
 * Shopify's duplicate-upload suffix (`_<alnum>` appended on name collisions —
 * 77791A_abc123.jpg). Uppercased for comparison.
 */
export function filenameStem(url: string): string {
  const base = url.split('?')[0]!.split('/').pop() ?? ''
  const noExt = base.replace(/\.[a-z0-9]+$/i, '')
  // Strip ONE trailing underscore-suffix only when what remains still ends in
  // a letter-after-digit token (so 77791A_1 -> 77791A, but wand_black stays).
  const m = /^(.*\d[a-z])_[a-z0-9-]+$/i.exec(noExt)
  return (m ? m[1]! : noExt).toUpperCase()
}

/** `77791A` -> { base: '77791', letter: 'A' }; null when not a lettered stem. */
export function letteredStem(stem: string): { base: string; letter: string } | null {
  const m = /^(.*\d)([A-Z])$/.exec(stem)
  return m ? { base: m[1]!, letter: m[2]! } : null
}

interface Candidate {
  handle: string
  title: string
  productId: string
  primaryMediaId: string
  primaryUrl: string
  proposedMediaId: string
  proposedUrl: string
  reason: string
}

interface PixelFlag {
  handle: string
  title: string
  primaryUrl: string
  reason: string
}

async function* iterateProducts(): AsyncGenerator<ProductNode> {
  const queryFilter = ONLY_HANDLE ? `handle:${ONLY_HANDLE}` : 'status:active'
  let cursor: string | null = null
  for (;;) {
    const data: {
      products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ProductNode[] }
    } = await adminGraphQL(
      `query Sweep($cursor: String, $q: String!) {
        products(first: 100, after: $cursor, query: $q) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            handle
            title
            vendor
            media(first: 30) {
              nodes {
                id
                mediaContentType
                ... on MediaImage { image { url width height altText } }
              }
            }
            nalpacSkuMetafield: metafield(namespace: "xdipx", key: "nalpac_sku") {
              namespace key value
            }
          }
        }
      }`,
      { cursor, q: queryFilter },
    )
    for (const node of data.products.nodes) yield node
    if (!data.products.pageInfo.hasNextPage) return
    cursor = data.products.pageInfo.endCursor
  }
}

/**
 * Pixel analysis: content bounding box against near-white. Returns a human
 * reason when the primary looks like a letterboxed packaging shot.
 */
async function analyzePixels(url: string): Promise<string | null> {
  const sharp = (await import('sharp')).default
  const res = await fetch(url)
  if (!res.ok) return null
  const buf = Buffer.from(await res.arrayBuffer())
  const SIZE = 64
  const { data, info } = await sharp(buf)
    .resize(SIZE, SIZE, { fit: 'fill' })
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const w = info.width
  const h = info.height
  const WHITE = 245
  let minX = w, maxX = -1, minY = h, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[y * w + x]! < WHITE) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return 'primary is entirely near-white'
  const bw = maxX - minX + 1
  const bh = maxY - minY + 1
  const aspect = bw / bh
  const emptyBands = (minY + (h - 1 - maxY)) / h
  if (aspect >= 1.6 && emptyBands >= 0.3) {
    return `wide content band (bbox aspect ${aspect.toFixed(2)}, ${(emptyBands * 100).toFixed(0)}% empty top/bottom)`
  }
  return null
}

async function main(): Promise<number> {
  const candidates: Candidate[] = []
  const pixelFlags: PixelFlag[] = []
  const altWrites: { id: string; alt: string }[] = []
  // Alt text is labelled by FINAL position, so it is computed after the
  // reorder decision: the promoted image gets the bare description.
  const altQueue: { product: ProductNode; images: (MediaNode & { image: { url: string } })[] }[] = []
  const zeroMediaProducts: { handle: string; title: string; nalpacSku: string | null }[] = []
  const promotedFor = new Map<string, string>()
  let skippedApparel = 0
  let scanned = 0

  for await (const product of iterateProducts()) {
    if (scanned >= LIMIT) break
    scanned++

    const images = product.media.nodes.filter(
      (m): m is MediaNode & { image: { url: string } } =>
        m.mediaContentType === 'IMAGE' && typeof m.image?.url === 'string',
    )
    if (ALT_TEXT) altQueue.push({ product, images })
    if (ZERO_MEDIA && images.length === 0) {
      zeroMediaProducts.push({
        handle: product.handle,
        title: product.title,
        nalpacSku: parseMetafield([product.nalpacSkuMetafield], 'nalpac_sku') || null,
      })
    }
    if (images.length < 2) continue
    if (!INCLUDE_APPAREL && isApparelTitle(product.title)) {
      skippedApparel++
      continue
    }

    const primary = images[0]!
    const primaryStem = letteredStem(filenameStem(primary.image.url))

    // Heuristic 1 — filename: A-primary with a cleaner lettered sibling.
    if (primaryStem && primaryStem.letter === 'A') {
      const siblings = images
        .slice(1)
        .map((m) => ({ m, s: letteredStem(filenameStem(m.image.url)) }))
        .filter((x): x is { m: typeof x.m; s: NonNullable<typeof x.s> } =>
          x.s !== null && x.s.base === primaryStem.base && x.s.letter > 'A',
        )
        .sort((a, b) => a.s.letter.localeCompare(b.s.letter))
      const pick = siblings[0]
      if (pick) {
        candidates.push({
          handle: product.handle,
          title: product.title,
          productId: product.id,
          primaryMediaId: primary.id,
          primaryUrl: primary.image.url,
          proposedMediaId: pick.m.id,
          proposedUrl: pick.m.image.url,
          reason: `primary stem ${primaryStem.base}${primaryStem.letter} has cleaner sibling ${pick.s.base}${pick.s.letter}`,
        })
        promotedFor.set(product.id, pick.m.id)
        continue // filename hit; no need to burn a download on pixels
      }
    }

    // Heuristic 2 — pixels (opt-in, report-only).
    if (PIXELS) {
      try {
        const reason = await analyzePixels(primary.image.url)
        if (reason) {
          pixelFlags.push({ handle: product.handle, title: product.title, primaryUrl: primary.image.url, reason })
        }
      } catch (err) {
        process.stderr.write(`WARN ${product.handle}: pixel analysis failed: ${(err as Error).message}\n`)
      }
    }
  }

  for (const { product, images } of altQueue) {
    const promoted = promotedFor.get(product.id)
    const ordered = promoted
      ? [...images.filter((m) => m.id === promoted), ...images.filter((m) => m.id !== promoted)]
      : images
    ordered.forEach((m, i) => {
      if (!(m.image.altText ?? '').trim()) {
        altWrites.push({ id: m.id, alt: altTextFor(product.title, product.vendor, i) })
      }
    })
  }

  // Zero-media report (--zero-media). Report-only, never writes: the fix is
  // pulling the Nalpac main-feed image, which is a shopify-ops action, not a
  // media reorder this script can apply.
  let zeroMedia: ZeroMediaEntry[] = []
  if (ZERO_MEDIA && zeroMediaProducts.length > 0) {
    const { snapshots } = await fetchAllNalpacFeeds()
    zeroMedia = zeroMediaProducts.map((p) => ({
      handle: p.handle,
      title: p.title,
      nalpacSku: p.nalpacSku,
      nalpacImageOneUrl: p.nalpacSku
        ? nalpacImageOneUrl(snapshots.get(p.nalpacSku)?.raw.mainRow)
        : null,
    }))
  }

  process.stderr.write(`scanned ${scanned} product(s)\n`)
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: APPLY ? 'apply' : 'dry-run',
        scanned,
        skippedApparel,
        ...(ALT_TEXT ? { altTextWrites: altWrites.length } : {}),
        confident: candidates,
        ...(PIXELS ? { pixelFlagged: pixelFlags } : {}),
        ...(ZERO_MEDIA ? { zeroMedia } : {}),
      },
      null,
      2,
    )}\n`,
  )

  if (!APPLY) {
    process.stderr.write(
      `dry-run: ${candidates.length} confident candidate(s)` +
        (PIXELS ? `, ${pixelFlags.length} pixel-flagged for eyeballing` : '') +
        (ALT_TEXT ? `, ${altWrites.length} image(s) missing alt text` : '') +
        (ZERO_MEDIA ? `, ${zeroMedia.length} product(s) with zero media` : '') +
        `, ${skippedApparel} apparel product(s) skipped` +
        '. Re-run with --apply to write.\n',
    )
    return 0
  }

  let applied = 0
  for (const c of candidates) {
    try {
      await setMediaAsPrimary(c.productId, c.proposedMediaId)
      applied++
      // primaryMediaId is logged so a run's own output is its rollback list:
      // setMediaAsPrimary(productId, primaryMediaId) restores the prior order.
      process.stderr.write(`APPLIED ${c.handle}: promoted ${c.proposedUrl.split('?')[0]!.split('/').pop()} (was ${c.primaryMediaId} on ${c.productId})\n`)
    } catch (err) {
      process.stderr.write(`ERROR ${c.handle}: reorder failed: ${(err as Error).message}\n`)
    }
  }
  process.stderr.write(`applied ${applied}/${candidates.length} reorder(s)\n`)

  let altWritten = 0
  for (const batch of chunk(altWrites, 50)) {
    try {
      const res = await adminGraphQL<{ fileUpdate: { userErrors: { field: string[]; message: string }[] } }>(
        `mutation AltText($files: [FileUpdateInput!]!) {
          fileUpdate(files: $files) { userErrors { field message } }
        }`,
        { files: batch },
      )
      const errs = res.fileUpdate.userErrors
      if (errs.length) process.stderr.write(`WARN alt-text batch: ${errs.map((e) => e.message).join('; ')}\n`)
      altWritten += batch.length - errs.length
    } catch (err) {
      process.stderr.write(`ERROR alt-text batch: ${(err as Error).message}\n`)
    }
  }
  if (ALT_TEXT) process.stderr.write(`alt text written ${altWritten}/${altWrites.length}\n`)

  return applied === candidates.length && altWritten === altWrites.length ? 0 : 1
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`ERROR: ${(err as Error).message}\n`)
    process.exit(2)
  },
)
