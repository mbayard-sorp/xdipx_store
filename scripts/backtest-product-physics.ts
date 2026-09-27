/**
 * scripts/backtest-product-physics.ts
 *
 * Ticket #11460. `productPhysics` shipped as a REPORT-ONLY vision-gate field
 * (app/lib/social-vision-gate.server.ts): it never gates `pass`, on purpose,
 * per constraint 2 — a craft check on ambiguous crops carries a materially
 * higher false-positive risk than a safety check, and there was no backtest
 * data to calibrate against at ship time. This script IS that backtest: it
 * re-runs the vision gate against the last 30 on-skin `social_media_assets`
 * rows and reports the `productPhysics` verdict distribution, so the
 * promote-to-blocking decision is made on data, not a guess.
 *
 * Could not run from the build sandbox that authored this ticket:
 * `ANTHROPIC_API_KEY` was absent there (confirmed via env check), so no live
 * vision-model call was possible, even though `DATABASE_URL` in that sandbox
 * DID resolve to a reachable Postgres. This mirrors the same production-only
 * gap `scripts/audit-vision-verdicts.ts` (ticket #11468) hit and documented
 * the same way: the code is real and ready, but needs an ops session with
 * both credentials present to actually run.
 *
 * "On-skin" scope matches the established convention in
 * `scripts/audit-vision-verdicts.ts`: `castSlugs` populated (a real
 * presenter's body genuinely in frame), which is the only category a craft
 * check like this is meaningfully at risk on — a product-only shot has no
 * body to fail to support against, and reports `not_applicable` trivially.
 * `--include-non-cast` widens the scope to every asset regardless of
 * `castSlugs`, matching the sibling script's own escape hatch.
 *
 * Needs `ANTHROPIC_API_KEY` (the same credential `social-vision-gate.server.ts`
 * already calls in production) and `DATABASE_URL`. Read-only: this never
 * writes a verdict back onto an asset row (unlike `audit-vision-verdicts.ts`'s
 * `--write`), because `productPhysics` is report-only and there is no
 * "corrected" verdict here to persist — only a fresh read to tally.
 *
 * Usage:
 *   npx tsx scripts/backtest-product-physics.ts [--limit 30] [--include-non-cast]
 *
 * Output: a JSON summary with counts per productPhysics value, the list of
 * `unsupported` findings (id, url, product handle, notes) for a human to spot
 * check, and the raw per-row verdicts for anyone who wants to dig further.
 */

import './_load-env'
import { desc, isNotNull, sql, and } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { socialMediaAssets } from '../db/schema'
import { runVisionGate, type ProductPhysicsVerdict } from '../app/lib/social-vision-gate.server'

const limitArg = process.argv.indexOf('--limit')
const LIMIT = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : 30
const INCLUDE_NON_CAST = process.argv.includes('--include-non-cast')

interface BacktestRow {
  id: number
  url: string
  productHandle: string | null
  castSlugs: string[] | null
  createdAt: Date
}

async function main() {
  const conditions = [
    isNotNull(socialMediaAssets.url),
    ...(INCLUDE_NON_CAST ? [] : [sql`jsonb_array_length(coalesce(${socialMediaAssets.castSlugs}, '[]'::jsonb)) > 0`]),
  ]

  const rows = await db
    .select({
      id: socialMediaAssets.id,
      url: socialMediaAssets.url,
      productHandle: socialMediaAssets.productHandle,
      castSlugs: socialMediaAssets.castSlugs,
      createdAt: socialMediaAssets.createdAt,
    })
    .from(socialMediaAssets)
    .where(and(...conditions))
    .orderBy(desc(socialMediaAssets.createdAt))
    .limit(LIMIT)

  const candidates = rows as BacktestRow[]
  console.log(`[backtest-product-physics] ${candidates.length} on-skin asset(s)${INCLUDE_NON_CAST ? ' (including non-cast)' : ''}, most recent first`)

  const counts: Record<ProductPhysicsVerdict | 'null', number> = {
    supported: 0,
    unsupported: 0,
    not_applicable: 0,
    null: 0,
  }
  const unsupportedFindings: Array<{ id: number; url: string; productHandle: string | null; notes: string }> = []
  const perRow: Array<{ id: number; url: string; productHandle: string | null; productPhysics: ProductPhysicsVerdict | null; checkCompleted: boolean; notes: string }> = []

  for (const row of candidates) {
    const verdict = await runVisionGate(row.url)
    const key = (verdict.productPhysics ?? 'null') as ProductPhysicsVerdict | 'null'
    counts[key] = (counts[key] ?? 0) + 1
    perRow.push({
      id: row.id,
      url: row.url,
      productHandle: row.productHandle,
      productPhysics: verdict.productPhysics,
      checkCompleted: verdict.checkCompleted,
      notes: verdict.notes,
    })
    if (verdict.productPhysics === 'unsupported') {
      unsupportedFindings.push({ id: row.id, url: row.url, productHandle: row.productHandle, notes: verdict.notes })
      console.error(`[backtest-product-physics] UNSUPPORTED asset ${row.id} (${row.productHandle ?? 'n/a'}): ${verdict.notes}`)
    }
  }

  console.log(JSON.stringify({
    checked: candidates.length,
    counts,
    unsupportedRate: candidates.length > 0 ? Number((counts.unsupported / candidates.length).toFixed(4)) : 0,
    unsupportedFindings,
    perRow,
  }, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backtest-product-physics] fatal:', err)
    process.exit(1)
  })
