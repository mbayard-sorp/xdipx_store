/**
 * READ-ONLY. Finds every ACTIVE Shopify product whose `xdipx.material`
 * metafield or `xdipx.specifications` "Material:" line asserts a material
 * with no first-party (Nalpac feed) backing.
 *
 * "No first-party backing" means the product's mfgProductSpecs Sanity doc
 * (see app/lib/mfg-specs/extractor.server.ts) has `sourceVersion:
 * 'description-parse-v1'`, or no doc exists at all. The Nalpac-feed path
 * (`sourceVersion: 'nalpac-csv-v1'`) is the only extractor source that ever
 * populates `material`, so a description-parse-v1 doc never backs a material
 * claim (confirmed: that path hardcodes `material: undefined`). Any
 * xdipx.material/specifications value on such a product was invented
 * downstream, by the AI enrichment prompt — see ticket #19981, split from
 * #19950 (sku 78048, 3-speed-original-bullet-vibrator: tagged "Body-safe
 * silicone" despite reading as a plated/chrome bullet in its own photography,
 * with zero material mention from the only reachable manufacturer listing).
 *
 * app/lib/import-enrich.server.ts's applyFullEnrichmentWrites now gates new
 * writes.material claims on app/lib/mfg-specs/sync.server.ts's
 * hasFirstPartyMaterial before they reach Shopify (same ticket), so this
 * script covers the pre-existing drift that gate can't retroactively fix.
 *
 * Usage:
 *   npx tsx scripts/audit-material-overclaims.ts
 *   npx tsx scripts/audit-material-overclaims.ts --json out.json
 *
 * Exit codes:
 *   0 — no overclaims found
 *   1 — one or more overclaims found, or an API error
 */
import { writeFileSync } from 'node:fs'
import { createClient } from '@sanity/client'
import { adminGraphQL } from '~/lib/shopify.server'

interface Overclaim {
  handle:              string
  title:               string
  materialMetafield:   string[] | null
  specificationsMaterial: string | null
}

/** All product handles whose mfgProductSpecs doc has no first-party material
 *  support: sourceVersion is description-parse-v1, or the doc exists with no
 *  usable material (nalpac-csv-v1 rows with an actual material are excluded —
 *  those ARE first-party backed). Returns null if Sanity isn't configured. */
async function getNoFirstPartyMaterialHandles(): Promise<Set<string> | null> {
  const projectId = process.env['SANITY_PROJECT_ID']
  const token     = process.env['SANITY_API_TOKEN']
  if (!projectId || !token) return null

  const client = createClient({
    projectId,
    dataset:    process.env['SANITY_DATASET'] ?? 'production',
    apiVersion: '2024-10-01',
    token,
    useCdn:     true,
  })

  const docs = await client.fetch<Array<{ productHandle: string; sourceVersion?: string; material?: string }>>(
    `*[_type == "mfgProductSpecs"]{productHandle, sourceVersion, material}`,
  )

  const out = new Set<string>()
  for (const d of docs) {
    const firstParty = d.sourceVersion === 'nalpac-csv-v1' && typeof d.material === 'string' && d.material.trim().length > 0
    if (!firstParty) out.add(d.productHandle)
  }
  return out
}

/** Extracts the value after a "Material:" line in a specifications array, if present. */
function specMaterial(specifications: string[] | null): string | null {
  if (!specifications) return null
  for (const line of specifications) {
    const m = line.match(/\bMaterial\s*:\s*(.+)/i)
    if (m?.[1]) return m[1].trim()
  }
  return null
}

interface GqlProduct {
  handle: string
  title:  string
  status: string
  material:       { value: string } | null
  specifications: { value: string } | null
}

const QUERY = `
  query MaterialOverclaims($cursor: String) {
    products(first: 100, after: $cursor, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      nodes {
        handle
        title
        status
        material:       metafield(namespace: "xdipx", key: "material") { value }
        specifications: metafield(namespace: "xdipx", key: "specifications") { value }
      }
    }
  }`

async function main() {
  const noFirstParty = await getNoFirstPartyMaterialHandles()
  if (noFirstParty === null) {
    console.error('[audit-material-overclaims] Sanity not configured (SANITY_PROJECT_ID/SANITY_API_TOKEN) — cannot determine first-party support, refusing to guess.')
    process.exit(1)
  }
  console.log(`[audit-material-overclaims] ${noFirstParty.size} product(s) have a mfgProductSpecs doc with no first-party material support.`)

  const overclaims: Overclaim[] = []
  let scanned = 0
  let cursor: string | null = null
  let hasNext = true

  while (hasNext) {
    const data: {
      products: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: GqlProduct[] }
    } = await adminGraphQL(QUERY, cursor ? { cursor } : {})

    for (const p of data.products.nodes) {
      scanned++
      if (!noFirstParty.has(p.handle)) continue

      let materialMetafield: string[] | null = null
      if (p.material?.value) {
        try {
          const parsed = JSON.parse(p.material.value)
          if (Array.isArray(parsed) && parsed.length) materialMetafield = parsed
        } catch { /* not JSON — ignore */ }
      }

      let specifications: string[] | null = null
      if (p.specifications?.value) {
        try {
          const parsed = JSON.parse(p.specifications.value)
          if (Array.isArray(parsed)) specifications = parsed
        } catch { /* not JSON — ignore */ }
      }
      const specificationsMaterial = specMaterial(specifications)

      if (materialMetafield || specificationsMaterial) {
        overclaims.push({ handle: p.handle, title: p.title, materialMetafield, specificationsMaterial })
      }
    }

    hasNext = data.products.pageInfo.hasNextPage
    cursor  = data.products.pageInfo.endCursor
    console.log(`…scanned ${scanned}`)
  }

  console.log(`\nscanned ${scanned} ACTIVE product(s), ${overclaims.length} material overclaim(s)\n`)
  for (const o of overclaims) {
    console.log(`- ${o.title} (${o.handle})`)
    if (o.materialMetafield)      console.log(`    xdipx.material: ${o.materialMetafield.join(', ')}`)
    if (o.specificationsMaterial) console.log(`    specifications Material: ${o.specificationsMaterial}`)
  }

  const jsonFlag = process.argv.indexOf('--json')
  if (jsonFlag !== -1 && process.argv[jsonFlag + 1]) {
    writeFileSync(process.argv[jsonFlag + 1]!, JSON.stringify(overclaims, null, 2))
    console.log(`\nwrote ${process.argv[jsonFlag + 1]}`)
  }

  process.exit(overclaims.length > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('[audit-material-overclaims] error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
