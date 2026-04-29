// One-off survey: count enrichable products and group by ProductTypeDial
// (read from Shopify metafield xdipx.product_type_dial). Used to plan how
// many products to backfill so Emma's learning loop hits every type.
import './_load-env'
import { db } from '../app/lib/db.server'
import { dealHistory } from '../db/schema'
import { sql } from 'drizzle-orm'
import { shopifyAdmin } from '../app/lib/shopify.server'
import { PRODUCT_TYPE_DIALS } from '../app/types'

interface MetafieldRow {
  metafields: Array<{ namespace: string; key: string; value: string }>
}

async function main() {
  const rows = await db
    .select({ sku: dealHistory.sku, shopifyProductId: dealHistory.shopifyProductId })
    .from(dealHistory)
    .where(sql`${dealHistory.status} != 'archived'`)
    .orderBy(dealHistory.sku)

  console.log(`[survey] ${rows.length} non-archived products`)

  const byType = new Map<string, string[]>()  // type → SKUs
  byType.set('(unset)', [])
  for (const t of PRODUCT_TYPE_DIALS) byType.set(t, [])

  let i = 0
  for (const row of rows) {
    i++
    const numericId = row.shopifyProductId.split('/').pop()
    if (!numericId) continue
    try {
      const res = await shopifyAdmin<MetafieldRow>(`/products/${numericId}/metafields.json?namespace=xdipx&limit=10`)
      const dial = res.metafields.find(m => m.key === 'product_type_dial')?.value
      const key = dial && byType.has(dial) ? dial : '(unset)'
      byType.get(key)!.push(row.sku)
      if (i % 25 === 0) process.stdout.write(`  ...${i}/${rows.length}\r`)
    } catch (err) {
      console.warn(`\n  fetch failed for ${row.sku}: ${err instanceof Error ? err.message : err}`)
    }
  }

  console.log()
  console.log('— distribution —')
  const sorted = [...byType.entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [type, skus] of sorted) {
    if (skus.length === 0) continue
    console.log(`  ${type.padEnd(14)} ${skus.length.toString().padStart(4)} — first: ${skus.slice(0, 3).join(', ')}`)
  }
  for (const [type, skus] of sorted) {
    if (skus.length === 0) console.log(`  ${type.padEnd(14)}    0  ← EMPTY`)
  }

  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
