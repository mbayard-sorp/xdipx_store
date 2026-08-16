/**
 * Ticket #3010: live PDP product descriptions (descriptionHtml) violate two
 * voice-charter hard rules at scale:
 *   1. Em-dashes ("no em-dashes anywhere, use periods and commas")
 *   2. Lived-experience phrasing ("from someone who's tested/tried..."),
 *      Emma claiming she personally tested a product, which she never does.
 *
 * Reads every ACTIVE Shopify product, runs fixCharterCopy() (deterministic,
 * see app/lib/feed-processor.server.ts, next to cleanDescription) against
 * descriptionHtml, and writes back only the products whose text changed.
 *
 * Defaults to DRY RUN: prints a violation count and a sample of before/after
 * diffs, writes nothing. Pass --apply to write for real.
 *
 * Usage:
 *   npx tsx scripts/fix-pdp-charter-violations.ts                  # dry run
 *   npx tsx scripts/fix-pdp-charter-violations.ts --apply          # writes to Shopify
 *   npx tsx scripts/fix-pdp-charter-violations.ts --apply --limit 50   # cap for a canary run
 */
import './_load-env'
import { adminGraphQL, shopifyAdmin, updateProductDescriptionHtml } from '~/lib/shopify.server'
import { fixCharterCopy } from '~/lib/feed-processor.server'
import { upsertProductPage } from '~/lib/sanity.server'

const APPLY = process.argv.includes('--apply')
const limitFlagIdx = process.argv.indexOf('--limit')
const LIMIT = limitFlagIdx !== -1 ? Number(process.argv[limitFlagIdx + 1]) : Infinity

interface GqlProduct {
  legacyResourceId: string
  title: string
  handle: string
  status: string
  descriptionHtml: string | null
}

const QUERY = `
  query Sweep($cursor: String) {
    products(first: 250, after: $cursor, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      nodes { legacyResourceId title handle status descriptionHtml }
    }
  }`

interface Change { productId: string; handle: string; title: string; before: string; after: string }

const changes: Change[] = []
let cursor: string | null = null
let hasNext = true
let scanned = 0

while (hasNext) {
  const data: { products: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: GqlProduct[] } } =
    await adminGraphQL(QUERY, cursor ? { cursor } : {})
  for (const p of data.products.nodes) {
    scanned++
    const html = p.descriptionHtml ?? ''
    if (!html) continue
    const { text, changed } = fixCharterCopy(html)
    if (!changed) continue
    changes.push({ productId: p.legacyResourceId, handle: p.handle, title: p.title, before: html, after: text })
  }
  hasNext = data.products.pageInfo.hasNextPage
  cursor = data.products.pageInfo.endCursor
  console.log(`...scanned ${scanned}`)
}

console.log(`\nscanned ${scanned} ACTIVE products, ${changes.length} need a copy fix`)

const residual = changes.filter(c => /—/.test(c.after))
if (residual.length) {
  console.error(`\nABORTING: ${residual.length} product(s) still contain an em-dash after fixCharterCopy. Not safe to apply.`)
  for (const r of residual.slice(0, 10)) console.error(`  - ${r.handle}: ${r.after}`)
  process.exit(1)
}

console.log(`\n--- sample diffs (first 20 of ${changes.length}) ---`)
for (const c of changes.slice(0, 20)) {
  console.log(`\n[${c.handle}] ${c.title}`)
  console.log(`  BEFORE: ${c.before}`)
  console.log(`  AFTER:  ${c.after}`)
}

if (!APPLY) {
  console.log(`\n[dry-run] would update ${Math.min(changes.length, LIMIT)} product(s). Re-run with --apply to write to Shopify.`)
  process.exit(0)
}

// A write that returns 200 is not proof it stuck. A canary write during
// development returned success but a later re-read showed the old text
// restored byte-for-byte (Shopify updated_at unchanged). The cause: Sanity's
// productPage.description still held the pre-fix copy, and
// app/routes/api.sanity-product-push.tsx re-pushes that field to Shopify on
// every Sanity publish, so an unrelated Sanity edit silently reverted the
// Shopify-only fix. Every write here therefore updates BOTH Shopify and the
// Sanity mirror (same pattern as scripts/apply-lived-experience-rewrites.ts),
// and is read back and confirmed against Shopify before counting as applied.

// Shopify's REST Admin bucket here is 2 calls/sec. A first pass at
// concurrency 8 blew through that (35% 429s even with per-call retries), so
// every REST call (write or read) goes through one shared gate that never
// lets more than ~1.8 calls/sec out, regardless of how many workers are
// waiting on it.
let lastRestCallAt = 0
async function restGate(): Promise<void> {
  const minGapMs = 560
  const wait = lastRestCallAt + minGapMs - Date.now()
  if (wait > 0) await new Promise(res => setTimeout(res, wait))
  lastRestCallAt = Date.now()
}

async function readBackDescription(productId: string): Promise<string | null> {
  try {
    await restGate()
    const res = await shopifyAdmin<{ product: { body_html: string } }>(`/products/${productId}.json`)
    return res.product.body_html
  } catch {
    return null
  }
}

async function writeAndConfirm(c: Change, attempts = 4): Promise<boolean> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await restGate()
      await updateProductDescriptionHtml(`gid://shopify/Product/${c.productId}`, c.after)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`  write attempt ${attempt} failed for ${c.handle}: ${msg}`)
      await new Promise(res => setTimeout(res, msg.includes('429') ? 2500 : attempt * 1000))
      continue
    }
    try {
      await upsertProductPage({
        handle: c.handle,
        shopifyProductId: `gid://shopify/Product/${c.productId}`,
        title: c.title,
        description: c.after,
      })
    } catch (err) {
      console.error(`  Sanity mirror failed for ${c.handle}: ${err instanceof Error ? err.message : err}`)
    }
    const readBack = await readBackDescription(c.productId)
    if (readBack === c.after) return true
    console.error(`  attempt ${attempt} for ${c.handle} did not persist on read-back, retrying`)
    await new Promise(res => setTimeout(res, attempt * 1000))
  }
  return false
}

// Small worker pool. Each item is 3-4 sequential round trips (Shopify write,
// Sanity write, Shopify read-back), so running one at a time was far too
// slow for the catalog size; this keeps a bounded number in flight.
const CONCURRENCY = 6
const toApply = changes.slice(0, LIMIT)
let applied = 0
let failed = 0
let started = 0
const failedHandles: string[] = []

async function worker(): Promise<void> {
  while (started < toApply.length) {
    const c = toApply[started]!
    started++
    const ok = await writeAndConfirm(c)
    if (ok) {
      applied++
      if (applied % 50 === 0) console.log(`…applied+confirmed ${applied}/${toApply.length}`)
    } else {
      failed++
      failedHandles.push(c.handle)
      console.error(`FAILED (unconfirmed after retries) ${c.handle} (${c.productId})`)
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

console.log(`\napplied+confirmed ${applied}, failed ${failed}, out of ${toApply.length} targeted (${changes.length} total found)`)
if (failedHandles.length) console.log('unconfirmed handles: ' + failedHandles.join(', '))
process.exit(failed ? 1 : 0)
