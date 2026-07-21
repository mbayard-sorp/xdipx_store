/**
 * One-off sweep after the 2026-07-20 new-items bulk import:
 *  - Candidate 342 imported successfully (Shopify draft + deal_history 4259)
 *    but the importer was interrupted before linking deal_history_id. Relink.
 *  - Candidates 367/371/613/671 parked after two quality-gate failures.
 *    Reset their enrich state for one more attempt via enrich-new-imports.
 *
 *   npx tsx scripts/sweep-new-items-enrich.ts
 */

import 'dotenv/config'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { importCandidates } from '../db/schema'

async function main(): Promise<void> {
  const relinked = await db
    .update(importCandidates)
    .set({ dealHistoryId: 4259, updatedAt: new Date() })
    .where(and(eq(importCandidates.id, 342), isNull(importCandidates.dealHistoryId)))
    .returning({ id: importCandidates.id })
  console.log('relinked 342:', relinked)

  const reset = await db
    .update(importCandidates)
    .set({ enrichFailedAt: null, enrichAttempts: 0, enrichBatchId: null, updatedAt: new Date() })
    .where(inArray(importCandidates.id, [367, 371, 613, 671]))
    .returning({ id: importCandidates.id })
  console.log('reset parked:', reset)
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
