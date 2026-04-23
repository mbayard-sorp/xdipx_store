/**
 * Batch-remove white backgrounds from Shopify product images using fal.ai BiRefNet v2.
 *
 * Flow per product: fetch featured image → sample edge pixels to confirm white-bg
 * → send URL to fal.ai → download transparent PNG → upload to Shopify via staged
 * upload → promote to primary → (optional) delete original.
 *
 * Usage:
 *   npm run bg:remove                             # dry run — no fal calls, no writes
 *   npm run bg:remove -- --live                   # process for real, keep originals
 *   npm run bg:remove -- --live --delete-originals
 *   npm run bg:remove -- --only=bellesa-demi-wand
 *   npm run bg:remove -- --live --limit=5
 *   npm run bg:remove -- --live --resume          # skip products already in checkpoint
 *   npm run bg:remove -- --live --yes             # skip cost-confirmation prompt
 *
 * Cost: ~$0.01/image on fal.ai BiRefNet v2. Shopify Admin has no charge.
 *
 * Checkpoint: scripts/.bg-removal-checkpoint.json (gitignored).
 */
import 'dotenv/config'
import sharp from 'sharp'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import {
  uploadThumbnailToProduct,
  setMediaAsPrimary,
  deleteProductMedia,
} from '../app/lib/shopify.server.ts'
import { removeBackground } from '../app/lib/fal.server.ts'

// ─── CLI args ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const opt  = (name: string): string | null => {
  const pref = `--${name}=`
  const hit = args.find(a => a.startsWith(pref))
  return hit ? hit.slice(pref.length) : null
}

const LIVE              = flag('live')
const DELETE_ORIGINALS  = flag('delete-originals')
const RESUME            = flag('resume')
const SKIP_CONFIRM      = flag('yes')
const ONLY_HANDLE       = opt('only')
const LIMIT             = opt('limit') ? parseInt(opt('limit')!, 10) : null
const CONCURRENCY       = parseInt(opt('concurrency') ?? '4', 10)
const COST_PER_IMAGE    = 0.01 // USD — fal.ai BiRefNet v2 posted price

// ─── Checkpoint ───────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))
const CHECKPOINT_PATH = resolve(__dirname, '.bg-removal-checkpoint.json')

type Outcome =
  | 'processed'
  | 'skipped-already-transparent'
  | 'skipped-not-white-bg'
  | 'skipped-no-image'
  | 'failed'

interface CheckpointEntry {
  productId: string
  handle: string
  outcome: Outcome
  newMediaGid?: string
  deletedOriginalMediaGid?: string
  error?: string
  at: string
}

type Checkpoint = Record<string, CheckpointEntry>

function loadCheckpoint(): Checkpoint {
  if (!existsSync(CHECKPOINT_PATH)) return {}
  try {
    return JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf8')) as Checkpoint
  } catch {
    return {}
  }
}

function saveCheckpoint(cp: Checkpoint): void {
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(cp, null, 2))
}

// ─── Shopify query ────────────────────────────────────────────────────────

interface ProductNode {
  id: string
  handle: string
  title: string
  featuredImage: { url: string; altText: string | null } | null
  media: {
    nodes: {
      id: string
      __typename: string
      image?: { url: string } | null
    }[]
  }
}

async function adminGql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const endpoint = `https://${process.env['SHOPIFY_STORE_DOMAIN']}/admin/api/2024-10/graphql.json`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': process.env['SHOPIFY_ADMIN_ACCESS_TOKEN']!,
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Shopify Admin GraphQL error: ${res.status}`)
  const { data, errors } = await res.json() as { data: T; errors?: { message: string }[] }
  if (errors?.length) throw new Error(errors[0]?.message ?? 'Shopify Admin GraphQL error')
  return data
}

async function fetchProducts(): Promise<ProductNode[]> {
  const products: ProductNode[] = []
  let cursor: string | null = null
  const query = ONLY_HANDLE ? `handle:${ONLY_HANDLE}` : null

  while (true) {
    const data = await adminGql<{
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: ProductNode[]
      }
    }>(`
      query Products($first: Int!, $after: String, $query: String) {
        products(first: $first, after: $after, query: $query) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id handle title
            featuredImage { url altText }
            media(first: 20) {
              nodes {
                __typename id
                ... on MediaImage { image { url } }
              }
            }
          }
        }
      }
    `, { first: 50, after: cursor, query })

    products.push(...data.products.nodes)
    if (!data.products.pageInfo.hasNextPage) break
    cursor = data.products.pageInfo.endCursor
    if (LIMIT && products.length >= LIMIT) break
  }

  return LIMIT ? products.slice(0, LIMIT) : products
}

// ─── White-bg heuristic ───────────────────────────────────────────────────

interface BgAnalysis {
  hasAlpha: boolean
  isWhiteBg: boolean
  whiteCornerHits: number // 0–8
}

async function analyzeBackground(imageBuffer: Buffer): Promise<BgAnalysis> {
  const img = sharp(imageBuffer)
  const meta = await img.metadata()
  const hasAlpha = Boolean(meta.hasAlpha)

  const W = meta.width ?? 0
  const H = meta.height ?? 0
  if (W < 10 || H < 10) return { hasAlpha, isWhiteBg: false, whiteCornerHits: 0 }

  // 8 sample points: 4 corners + 4 edge midpoints, inset by 4px to avoid JPG fringe
  const inset = 4
  const points = [
    [inset, inset],                       // TL
    [W - inset - 1, inset],               // TR
    [inset, H - inset - 1],               // BL
    [W - inset - 1, H - inset - 1],       // BR
    [Math.floor(W / 2), inset],           // TM
    [Math.floor(W / 2), H - inset - 1],   // BM
    [inset, Math.floor(H / 2)],           // LM
    [W - inset - 1, Math.floor(H / 2)],   // RM
  ] as const

  const { data } = await img
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const channels = 4 // ensureAlpha forces 4
  let hits = 0
  const TOLERANCE = 8 // per-channel distance from 255

  for (const [x, y] of points) {
    const idx = (y * W + x) * channels
    const r = data[idx] ?? 0
    const g = data[idx + 1] ?? 0
    const b = data[idx + 2] ?? 0
    const a = data[idx + 3] ?? 255
    if (a < 250) continue // already transparent here — not "white bg"
    if (r >= 255 - TOLERANCE && g >= 255 - TOLERANCE && b >= 255 - TOLERANCE) hits++
  }

  return { hasAlpha, isWhiteBg: hits >= 7, whiteCornerHits: hits }
}

// ─── Per-product processing ───────────────────────────────────────────────

interface PlanEntry {
  product: ProductNode
  originalUrl: string
  originalMediaGid: string
  analysis: BgAnalysis
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

async function planProduct(product: ProductNode): Promise<
  | { kind: 'plan'; entry: PlanEntry }
  | { kind: 'skip'; outcome: Outcome; reason: string }
> {
  const featured = product.featuredImage
  if (!featured?.url) return { kind: 'skip', outcome: 'skipped-no-image', reason: 'no featured image' }

  // Find the MediaImage GID whose image.url matches the featured image URL (ignoring query params)
  const baseUrl = featured.url.split('?')[0]
  const match = product.media.nodes.find(
    m => m.__typename === 'MediaImage' && m.image?.url && m.image.url.split('?')[0] === baseUrl,
  )
  if (!match) return { kind: 'skip', outcome: 'skipped-no-image', reason: 'featured image has no matching Media GID' }

  const buffer = await fetchBuffer(featured.url)
  const analysis = await analyzeBackground(buffer)

  if (analysis.hasAlpha) {
    return { kind: 'skip', outcome: 'skipped-already-transparent', reason: 'image already has alpha channel' }
  }
  if (!analysis.isWhiteBg) {
    return { kind: 'skip', outcome: 'skipped-not-white-bg', reason: `only ${analysis.whiteCornerHits}/8 edge pixels are white` }
  }

  return { kind: 'plan', entry: { product, originalUrl: featured.url, originalMediaGid: match.id, analysis } }
}

async function processEntry(entry: PlanEntry, cp: Checkpoint): Promise<void> {
  const { product, originalUrl, originalMediaGid } = entry
  try {
    const { imageUrl: transparentUrl } = await removeBackground(originalUrl)
    const pngBuffer = await fetchBuffer(transparentUrl)

    const filename = `${product.handle}-nobg.png`
    const altText  = product.featuredImage?.altText ?? product.title

    const newMediaGid = await uploadThumbnailToProduct(
      product.id,
      pngBuffer,
      filename,
      altText,
      'image/png',
    )

    // Wait for Shopify to process the media before reorder / delete calls
    await new Promise(r => setTimeout(r, 2500))
    await setMediaAsPrimary(product.id, newMediaGid)

    let deletedOriginalMediaGid: string | undefined
    if (DELETE_ORIGINALS) {
      await deleteProductMedia(product.id, [originalMediaGid])
      deletedOriginalMediaGid = originalMediaGid
    }

    cp[product.id] = {
      productId: product.id,
      handle:    product.handle,
      outcome:   'processed',
      newMediaGid,
      ...(deletedOriginalMediaGid ? { deletedOriginalMediaGid } : {}),
      at:        new Date().toISOString(),
    }
    console.log(`  ✓ ${product.handle} → promoted ${newMediaGid}${deletedOriginalMediaGid ? ' (deleted original)' : ''}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    cp[product.id] = {
      productId: product.id,
      handle:    product.handle,
      outcome:   'failed',
      error:     message,
      at:        new Date().toISOString(),
    }
    console.error(`  ✗ ${product.handle} → ${message}`)
  } finally {
    saveCheckpoint(cp)
  }
}

// ─── Small async pool ─────────────────────────────────────────────────────

async function runPool<T>(items: T[], limit: number, worker: (t: T) => Promise<void>): Promise<void> {
  let idx = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const my = idx++
      await worker(items[my]!)
    }
  })
  await Promise.all(runners)
}

// ─── Confirmation prompt ──────────────────────────────────────────────────

async function confirm(question: string): Promise<boolean> {
  if (SKIP_CONFIRM) return true
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const ans = (await rl.question(`${question} [y/N] `)).trim().toLowerCase()
    return ans === 'y' || ans === 'yes'
  } finally {
    rl.close()
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env['SHOPIFY_STORE_DOMAIN'] || !process.env['SHOPIFY_ADMIN_ACCESS_TOKEN']) {
    throw new Error('SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN must be set')
  }

  const cp = RESUME || LIVE ? loadCheckpoint() : {}

  console.log(`Mode: ${LIVE ? 'LIVE' : 'DRY-RUN'}${DELETE_ORIGINALS ? ' (deletes originals)' : ''}`)
  if (ONLY_HANDLE) console.log(`Filter: handle=${ONLY_HANDLE}`)
  if (LIMIT) console.log(`Limit: ${LIMIT}`)
  if (RESUME) console.log(`Resume: ${Object.keys(cp).length} products in checkpoint will be skipped`)
  console.log('')

  console.log('Fetching products…')
  const products = await fetchProducts()
  console.log(`Found ${products.length} product${products.length === 1 ? '' : 's'}.`)

  const toConsider = RESUME
    ? products.filter(p => !cp[p.id] || cp[p.id]!.outcome === 'failed')
    : products

  console.log(`Analyzing ${toConsider.length} featured image${toConsider.length === 1 ? '' : 's'}…`)
  const plans: PlanEntry[] = []
  const counts: Record<Outcome, number> = {
    'processed': 0,
    'skipped-already-transparent': 0,
    'skipped-not-white-bg': 0,
    'skipped-no-image': 0,
    'failed': 0,
  }

  await runPool(toConsider, CONCURRENCY, async (product) => {
    try {
      const result = await planProduct(product)
      if (result.kind === 'plan') {
        plans.push(result.entry)
      } else {
        counts[result.outcome]++
        console.log(`  — ${product.handle}: ${result.reason}`)
      }
    } catch (err) {
      counts['failed']++
      console.error(`  ✗ ${product.handle}: analysis failed — ${err instanceof Error ? err.message : err}`)
    }
  })

  console.log('')
  console.log('Plan:')
  console.log(`  ${plans.length} product${plans.length === 1 ? '' : 's'} need background removal`)
  console.log(`  ${counts['skipped-already-transparent']} already transparent`)
  console.log(`  ${counts['skipped-not-white-bg']} not-white-background`)
  console.log(`  ${counts['skipped-no-image']} missing image`)
  console.log(`  ${counts['failed']} analysis failures`)
  console.log(`  estimated cost: $${(plans.length * COST_PER_IMAGE).toFixed(2)}`)

  if (!LIVE) {
    console.log('\nDry run — no API writes. Rerun with --live to execute.')
    return
  }

  if (plans.length === 0) {
    console.log('\nNothing to do.')
    return
  }

  const ok = await confirm(`\nProcess ${plans.length} images${DELETE_ORIGINALS ? ' and DELETE originals' : ''}?`)
  if (!ok) {
    console.log('Aborted.')
    return
  }

  console.log('\nProcessing…')
  await runPool(plans, CONCURRENCY, (entry) => processEntry(entry, cp))

  for (const e of Object.values(cp)) counts[e.outcome] = (counts[e.outcome] ?? 0) + 0
  const final = Object.values(cp)
  console.log('\nDone.')
  console.log(`  processed: ${final.filter(e => e.outcome === 'processed').length}`)
  console.log(`  failed:    ${final.filter(e => e.outcome === 'failed').length}`)
  console.log(`\nCheckpoint: ${CHECKPOINT_PATH}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
