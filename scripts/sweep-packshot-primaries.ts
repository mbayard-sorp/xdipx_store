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
 */

import 'dotenv/config'
import { adminGraphQL, setMediaAsPrimary } from '../app/lib/shopify.server'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const PIXELS = argv.includes('--pixels')
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
  media: { nodes: MediaNode[] }
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
            media(first: 30) {
              nodes {
                id
                mediaContentType
                ... on MediaImage { image { url width height altText } }
              }
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
  let scanned = 0

  for await (const product of iterateProducts()) {
    if (scanned >= LIMIT) break
    scanned++

    const images = product.media.nodes.filter(
      (m): m is MediaNode & { image: { url: string } } =>
        m.mediaContentType === 'IMAGE' && typeof m.image?.url === 'string',
    )
    if (images.length < 2) continue

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
          primaryUrl: primary.image.url,
          proposedMediaId: pick.m.id,
          proposedUrl: pick.m.image.url,
          reason: `primary stem ${primaryStem.base}${primaryStem.letter} has cleaner sibling ${pick.s.base}${pick.s.letter}`,
        })
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

  process.stderr.write(`scanned ${scanned} product(s)\n`)
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: APPLY ? 'apply' : 'dry-run',
        scanned,
        confident: candidates,
        ...(PIXELS ? { pixelFlagged: pixelFlags } : {}),
      },
      null,
      2,
    )}\n`,
  )

  if (!APPLY) {
    process.stderr.write(
      `dry-run: ${candidates.length} confident candidate(s)` +
        (PIXELS ? `, ${pixelFlags.length} pixel-flagged for eyeballing` : '') +
        '. Re-run with --apply to promote the proposed images.\n',
    )
    return 0
  }

  let applied = 0
  for (const c of candidates) {
    try {
      await setMediaAsPrimary(c.productId, c.proposedMediaId)
      applied++
      process.stderr.write(`APPLIED ${c.handle}: promoted ${c.proposedUrl.split('?')[0]!.split('/').pop()}\n`)
    } catch (err) {
      process.stderr.write(`ERROR ${c.handle}: reorder failed: ${(err as Error).message}\n`)
    }
  }
  process.stderr.write(`applied ${applied}/${candidates.length} reorder(s)\n`)
  return applied === candidates.length ? 0 : 1
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`ERROR: ${(err as Error).message}\n`)
    process.exit(2)
  },
)
