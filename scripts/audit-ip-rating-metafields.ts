/**
 * audit-ip-rating-metafields.ts
 *
 * Ticket #24094: le-wand-classique-petite-wand-massager (sku 96378, ACTIVE)
 * publishes a `xdipx.care_instructions` bullet that extends its IPX7 rating
 * into a shower/bath grant and then contradicts itself about the charging
 * port:
 *
 *   "Fully waterproof — shower and bath play welcome, just avoid
 *    submerging the charging port"
 *
 * IPX7 covers immersion only (one metre, thirty minutes); running water and
 * jets carry their own ratings that do not stack onto an IPX7 mark, so this
 * bullet's shower claim is unsupported, and "avoid submerging the charging
 * port" directly contradicts the immersion rating it is attached to. It also
 * carries an em-dash, which the voice charter bans outright.
 *
 * This script:
 *   1. Replaces that one bullet with the exact, already-published IPX7 house
 *      wording (IPX7_HOUSE_WORDING, app/lib/fresh-language-frozen-strings.ts)
 *      so the correction matches the Notebook corpus byte-for-byte rather
 *      than re-deriving a paraphrase. Exact-match guarded against the live
 *      value, same drift protocol as scripts/fix-ipx-shower-claims.ts: a
 *      changed value is skipped and reported, never force-written.
 *   2. Runs a catalog-wide, read-only sweep of every available-for-sale
 *      product's `care_instructions` and `specifications` bullets for the
 *      co-occurrence this ticket's DONE WHEN asks to be sized: a bullet
 *      naming IPX4 or IPX7 alongside shower/bath/running-water language
 *      (findIpRatingMetafieldHits, app/lib/ip-rating-metafield-sweep.ts).
 *      This is a sizing count, not a remediation — it reports whether the
 *      defect is this one sku or hundreds; fixing any further hits it finds
 *      is out of scope for this ticket and belongs to whichever row the
 *      count justifies filing next.
 *
 * Usage:
 *   npx tsx scripts/audit-ip-rating-metafields.ts          # dry run (fix) + sweep
 *   npx tsx scripts/audit-ip-rating-metafields.ts --apply  # writes the one fix to Shopify, then sweeps
 */
import './_load-env'
import { adminGraphQL, updateProductMetafield } from '~/lib/shopify.server'
import { getCatalogIpRatingMetafieldBullets } from '~/lib/shopify.server'
import { findIpRatingMetafieldHits } from '~/lib/ip-rating-metafield-sweep'
import { IPX7_HOUSE_WORDING } from '~/lib/fresh-language-frozen-strings'

const APPLY = process.argv.includes('--apply')
const TAG = '[audit-ip-rating-metafields]'

const TARGET_HANDLE = 'le-wand-classique-petite-wand-massager'
const OLD_BULLET =
  'Fully waterproof — shower and bath play welcome, just avoid submerging the charging port'
const NEW_BULLET = IPX7_HOUSE_WORDING

interface GqlProduct {
  legacyResourceId: string
  title: string
  handle: string
  metafields: { nodes: { key: string; value: string }[] }
}

async function fixTargetSku(): Promise<void> {
  const data: { products: { nodes: GqlProduct[] } } = await adminGraphQL(`
    query { products(first: 1, query: "handle:${TARGET_HANDLE}") {
      nodes { legacyResourceId title handle metafields(namespace: "xdipx", first: 30) { nodes { key value } } }
    } }`)
  const p = data.products.nodes[0]
  if (!p) {
    console.error(`${TAG} SKIP ${TARGET_HANDLE}: product not found (handle may have changed)`)
    return
  }

  const careRaw = p.metafields.nodes.find(m => m.key === 'care_instructions')?.value
  if (!careRaw) {
    console.error(`${TAG} SKIP ${TARGET_HANDLE}: care_instructions field not present on product`)
    return
  }

  let bullets: string[]
  try {
    bullets = JSON.parse(careRaw)
  } catch {
    console.error(`${TAG} SKIP ${TARGET_HANDLE}: care_instructions value is not valid JSON, not writing`)
    return
  }

  const idx = bullets.indexOf(OLD_BULLET)
  if (idx === -1) {
    console.error(`${TAG} NOT FOUND ${TARGET_HANDLE}: old bullet has drifted, skipping\n  expected: ${OLD_BULLET}`)
    return
  }

  const newBullets = [...bullets]
  newBullets[idx] = NEW_BULLET
  const newValue = JSON.stringify(newBullets)

  console.log(`\n[${TARGET_HANDLE}] ${p.title}`)
  console.log(`  care_instructions[${idx}]:\n    old: ${OLD_BULLET}\n    new: ${NEW_BULLET}`)

  if (!APPLY) {
    console.log(`  [dry-run] would write care_instructions`)
    return
  }

  await updateProductMetafield(`gid://shopify/Product/${p.legacyResourceId}`, 'care_instructions', newValue, 'json')
  console.log(`  applied care_instructions write`)
}

async function sweepCatalog(): Promise<void> {
  console.log(`\n${TAG} ── catalog sweep: care_instructions / specifications vs IPX4/IPX7 + water language ──`)
  const products = await getCatalogIpRatingMetafieldBullets()

  let flaggedProducts = 0
  let totalHits = 0
  for (const product of products) {
    const hits = findIpRatingMetafieldHits(product)
    if (hits.length === 0) continue
    flaggedProducts++
    totalHits += hits.length
    console.log(`  ${product.handle} ("${product.title}")`)
    for (const hit of hits) {
      console.log(`    [${hit.surface}] "${hit.bullet}"`)
    }
  }

  console.log(
    `${TAG} ${totalHits} bullet(s) across ${flaggedProducts} of ${products.length} available-for-sale product(s) ` +
      'name IPX4 or IPX7 alongside shower/bath/running-water language.',
  )
}

async function main(): Promise<void> {
  await fixTargetSku()
  await sweepCatalog()
}

main().catch(err => {
  console.error(`${TAG} ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
