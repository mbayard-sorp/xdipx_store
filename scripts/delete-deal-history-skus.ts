/**
 * One-shot: delete dealHistory rows for the given SKUs so bulk-import's
 * isSkuAlreadyImported() check passes and the orchestrator + Sanity sync
 * actually run on a re-import.
 *
 * Usage: bun run scripts/delete-deal-history-skus.ts XDX-TEST-007 XDX-TEST-008 XDX-TEST-009
 */
import { db } from '~/lib/db.server'
import { dealHistory } from '~/../db/schema'
import { inArray } from 'drizzle-orm'

const skus = process.argv.slice(2)
if (skus.length === 0) {
  console.error('usage: bun run scripts/delete-deal-history-skus.ts <SKU> [SKU…]')
  process.exit(1)
}

const rows = await db.select({ sku: dealHistory.sku, status: dealHistory.status }).from(dealHistory).where(inArray(dealHistory.sku, skus))
console.log(`found ${rows.length} row(s):`, rows)

if (rows.length > 0) {
  await db.delete(dealHistory).where(inArray(dealHistory.sku, skus))
  console.log(`deleted ${rows.length} row(s)`)
}
process.exit(0)
