/**
 * audit-pdp-water-grant.ts
 *
 * Ticket #22588: the IPX7-as-shower defect (scripts/audit-ipx7-water-grant.ts,
 * scoped to the Notebook blogPost surface) also lives in PDP copy — product
 * description, and the xdipx-namespace tagline and full_story ("Emma's
 * take") metafields — a surface nothing audits. This script is that
 * detector made reusable for PDP: it reads every available-for-sale product
 * from Shopify via getCatalogProductCopySurfaces() and runs
 * findPdpWaterGrants (app/lib/pdp-water-grant.ts, unit tested) over all
 * three copy surfaces.
 *
 * This script is read-only. It does not write to Shopify — fixing a flagged
 * sentence is a Shopify PDP-copy change, owned by shopify-ops or the
 * enricher rather than by this code lane (ticket #22588's DONE WHEN (d)),
 * and any replacement prose asserting a water permission needs the
 * emma-empathy-reviewer / sex-wellness-reviewer accuracy gate exactly as the
 * Notebook prose did.
 *
 * Known limit, stated here rather than hidden: this is a reusable-token
 * checker (see app/lib/pdp-water-grant.ts's own header), so it cannot see a
 * grant sentence that refers back to a water rating or waterproofing claim
 * by pronoun instead of repeating a basis token. A sweep returning zero does
 * not prove the catalog is clean of every phrasing of this defect.
 *
 * Usage:
 *   npx tsx scripts/audit-pdp-water-grant.ts          # human-readable report
 *   npx tsx scripts/audit-pdp-water-grant.ts --json   # JSON report
 *
 * Exit codes:
 *   0 — clean sweep, zero findings
 *   1 — one or more findings, or could not reach Shopify
 */
import './_load-env'
import { getCatalogProductCopySurfaces } from '../app/lib/shopify.server'
import { findPdpWaterGrants, type PdpWaterGrantHit } from '../app/lib/pdp-water-grant'

const TAG = '[audit-pdp-water-grant]'
const asJson = process.argv.includes('--json')

interface ProductHits {
  handle: string
  title: string
  hits: PdpWaterGrantHit[]
}

async function main(): Promise<void> {
  const products = await getCatalogProductCopySurfaces()

  const perProduct: ProductHits[] = []
  for (const product of products) {
    const hits = findPdpWaterGrants({
      handle: product.handle,
      description: product.descriptionHtml,
      tagline: product.tagline,
      fullStory: product.fullStory,
    })
    if (hits.length > 0) perProduct.push({ handle: product.handle, title: product.title, hits })
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        { scannedCount: products.length, flaggedCount: perProduct.length, perProduct, overLimit: perProduct.length > 0 },
        null,
        2,
      ),
    )
    process.exit(perProduct.length > 0 ? 1 : 0)
  }

  if (perProduct.length === 0) {
    console.log(`${TAG} OK. 0 findings across ${products.length} available-for-sale product(s).`)
    return
  }

  console.error(
    `${TAG} ${perProduct.length} of ${products.length} product(s) carry a sentence that grants shower/bath/jet/tap ` +
      'water use with a weak basis (vendor adjective, bare depth figure, or IPX7 mark) and no restriction:',
  )
  for (const p of perProduct) {
    console.error(`  ${p.handle} ("${p.title}")`)
    for (const hit of p.hits) {
      console.error(`    [${hit.surface}] "${hit.sentence}"`)
    }
  }
  console.error(
    `${TAG} Remediation owner: this is a Shopify PDP-copy fix (shopify-ops or the enricher), not a content-lane ` +
      'fix — the defect lives in product description / tagline / full_story metafields, not Sanity. Any replacement ' +
      'water-permission prose needs the emma-empathy-reviewer / sex-wellness-reviewer accuracy gate.',
  )
  process.exit(1)
}

main().catch(err => {
  console.error(`${TAG} ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
