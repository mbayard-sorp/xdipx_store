/**
 * map_restricted sweep (ticket #16147).
 *
 * Finds ACTIVE products from honoured-MAP vendors, compares price to MAP, and
 * (only with --apply) sets xdipx.map_restricted=true on the "flag" rows.
 * Default is a read-only dry run. Never touches map_price or any other field.
 *
 * MAP source: xdipx.map_price metafield, else nalpac_price_history.map_price
 * keyed by variant sku.
 *
 * Usage:
 *   npx tsx scripts/map-restricted-sweep.ts --vendors Lovense,Playground [--apply] [--json out.json]
 *
 * The CURIOUS15 collection rule step is never written here. The script prints
 * the collectionUpdate ruleSet the owner-ruled vendors would need.
 */
import './_load-env'
import { writeFileSync } from 'node:fs'
import { inArray } from 'drizzle-orm'
import {
  fetchActiveProductsForMapSweep,
  fetchCollectionRuleSet,
  setMapRestrictedTrue,
} from '../app/lib/shopify.server'
import { classifyMapRow, priceVsMap, type MapSweepAction } from '../app/lib/map-restricted-sweep'

const CURIOUS15_COLLECTION_GID = 'gid://shopify/Collection/339706347691'

type Row = {
  vendor: string
  id: string
  handle: string
  sku: string
  price: number
  mapPrice: number | null
  mapSource: 'metafield' | 'feed' | 'none'
  flagged: boolean
  action: MapSweepAction
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function feedMap(skus: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (skus.length === 0) return out
  const { db } = await import('../app/lib/db.server')
  const { nalpacPriceHistory: t } = await import('../db/schema')
  for (let i = 0; i < skus.length; i += 200) {
    const rows = await db
      .select({ sku: t.sku, mapPrice: t.mapPrice })
      .from(t)
      .where(inArray(t.sku, skus.slice(i, i + 200)))
    for (const r of rows) {
      const n = Number(r.mapPrice)
      if (Number.isFinite(n) && n > 0) out.set(r.sku, n)
    }
  }
  return out
}

async function main(): Promise<void> {
  const vendors = (arg('--vendors') ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (vendors.length === 0) throw new Error('--vendors is required, e.g. --vendors Lovense,Playground')
  const apply = process.argv.includes('--apply')
  const jsonOut = arg('--json')

  const rows: Row[] = []
  const activeCount: Record<string, number> = {}
  for (const vendor of vendors) {
    const products = await fetchActiveProductsForMapSweep(vendor)
    activeCount[vendor] = products.length
    const feed = await feedMap(products.flatMap(p => p.skus))
    for (const p of products) {
      let mapPrice = p.mapPriceMetafield
      let mapSource: Row['mapSource'] = mapPrice != null ? 'metafield' : 'none'
      if (mapPrice == null) {
        const fromFeed = [p.sku, ...p.skus].map(s => feed.get(s)).find(v => v != null)
        if (fromFeed != null) { mapPrice = fromFeed; mapSource = 'feed' }
      }
      rows.push({
        vendor,
        id: p.id,
        handle: p.handle,
        sku: p.sku,
        price: p.price,
        mapPrice,
        mapSource,
        flagged: p.mapRestricted,
        action: classifyMapRow({ price: p.price, mapPrice, flagged: p.mapRestricted }),
      })
    }
  }

  // Per-vendor counts
  const counts = vendors.map(vendor => {
    const r = rows.filter(x => x.vendor === vendor)
    const unflagged = r.filter(x => !x.flagged)
    const rel = (x: Row) => priceVsMap(x.price, x.mapPrice)
    return {
      vendor,
      active: activeCount[vendor] ?? 0,
      flagged: r.filter(x => x.flagged).length,
      unflaggedAtMap: unflagged.filter(x => rel(x) === 'at').length,
      unflaggedAboveMap: unflagged.filter(x => rel(x) === 'above').length,
      belowMap: r.filter(x => rel(x) === 'below').length,
      noMapKnown: r.filter(x => rel(x) === 'unknown').length,
      toFlag: r.filter(x => x.action === 'flag').length,
    }
  })

  console.log(`mode: ${apply ? 'APPLY' : 'dry run'}`)
  console.table(counts)
  for (const vendor of vendors) {
    console.log(`\n## ${vendor}`)
    for (const x of rows.filter(r => r.vendor === vendor && r.action !== 'already flagged')) {
      console.log(
        [x.id.split('/').pop(), x.handle, x.sku || '-', x.price.toFixed(2),
          x.mapPrice != null ? x.mapPrice.toFixed(2) : '-', x.mapSource,
          x.flagged ? 'flagged' : 'unflagged', x.action].join(' | '),
      )
    }
  }

  // Print, never write, the CURIOUS15 ruleSet. The collection is an AND of
  // VENDOR NOT_EQUALS rules (an exclusion list), so a newly ruled vendor adds
  // a NOT_EQUALS rule and vendors already excluded add nothing.
  const existing = await fetchCollectionRuleSet(CURIOUS15_COLLECTION_GID)
  const have = new Set((existing?.rules ?? []).map(r => `${r.column}|${r.relation}|${r.condition.toLowerCase()}`))
  const add = vendors
    .filter(v => !have.has(`VENDOR|NOT_EQUALS|${v.toLowerCase()}`))
    .map(v => ({ column: 'VENDOR', relation: 'NOT_EQUALS', condition: v }))
  console.log('\n## CURIOUS15 collection ruleSet (NOT written)')
  console.log('current:', JSON.stringify(existing))
  console.log('collectionUpdate input:')
  console.log(JSON.stringify({
    id: CURIOUS15_COLLECTION_GID,
    ruleSet: {
      appliedDisjunctively: existing?.appliedDisjunctively ?? true,
      rules: [...(existing?.rules ?? []), ...add],
    },
  }, null, 2))

  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ counts, rows, curious15: { existing, add } }, null, 2))

  if (apply) {
    const gids = rows.filter(r => r.action === 'flag').map(r => r.id)
    const n = await setMapRestrictedTrue(gids)
    console.log(`\napplied map_restricted=true to ${n} product(s)`)
  } else {
    console.log('\ndry run: nothing written. Re-run with --apply after the owner ruling.')
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1) })
