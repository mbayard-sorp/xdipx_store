/**
 * scripts/audit-vision-verdicts.ts
 *
 * Ticket #11468, P0. The owner found two production vision-gate verdicts
 * (assets 675, 698) that read `pass:true` on `nippleOccluded`/`genitaliaAbsent`
 * while `notes` confidently described a frame that did not match the actual
 * pixels — a hallucinated read graded against its own description. The code
 * fix (`app/lib/social-vision-gate.server.ts`, `confirmExposureChecks`) now
 * requires a second, independent model call to agree before a clean exposure
 * read ships. This script is the DONE-WHEN-(1) backfill that re-checks every
 * previously-passed on-skin asset against the strengthened gate and reports
 * how many were false passes under the old single-call check.
 *
 * Needs `ANTHROPIC_API_KEY` (the same credential `social-vision-gate.server.ts`
 * already calls in production) and `DATABASE_URL`. Neither was available in
 * the session that wrote this script, so it has not been run against
 * production yet — see the ticket note for what that means for DONE WHEN
 * (1)/(3)/(4), which need a real run's output, not code alone.
 *
 * Scope: defaults to assets with `castSlugs` populated (a real presenter's
 * body in frame — the precise category both incident assets fall into, and
 * the only one exposure checks are actually at risk on). `--include-non-cast`
 * widens to every asset regardless of `castSlugs`.
 *
 * Read-only by default: prints the comparison and the false-pass rate, and
 * never touches the database. `--write` additionally persists the corrected
 * (re-confirmed) verdict onto each asset whose read changed, via the same
 * `recordVisionVerdict` production code path already uses — off by default
 * so a first run is always safe to inspect before anything is overwritten.
 *
 * Usage:
 *   npx tsx scripts/audit-vision-verdicts.ts [--since 2026-09-19] [--limit N]
 *     [--include-non-cast] [--write]
 */

import './_load-env'
import { and, gte, isNotNull, sql } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { socialMediaAssets } from '../db/schema'
import { runVisionGate, recordVisionVerdict, EXPOSURE_CHECK_NAMES, type VisionVerdict } from '../app/lib/social-vision-gate.server'

const sinceArg = process.argv.indexOf('--since')
const SINCE = new Date(sinceArg >= 0 ? process.argv[sinceArg + 1]! : '2026-09-19T00:00:00Z')
const limitArg = process.argv.indexOf('--limit')
const LIMIT = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity
const INCLUDE_NON_CAST = process.argv.includes('--include-non-cast')
const WRITE = process.argv.includes('--write')

interface AuditRow {
  id: number
  url: string
  productHandle: string | null
  castSlugs: string[] | null
  oldVerdict: VisionVerdict
}

function exposureChecksOf(v: VisionVerdict): Record<string, 'pass' | 'fail' | 'unknown'> {
  const out: Record<string, 'pass' | 'fail' | 'unknown'> = {}
  for (const name of EXPOSURE_CHECK_NAMES) out[name] = v.checks?.[name] ?? 'unknown'
  return out
}

async function main() {
  const conditions = [
    gte(socialMediaAssets.createdAt, SINCE),
    isNotNull(socialMediaAssets.visionVerdict),
    // Only rows the OLD gate called clean: a row already on record as a fail
    // was never at risk of being a false pass, and re-checking it teaches
    // nothing about the defect this ticket is auditing.
    sql`${socialMediaAssets.visionVerdict}->>'pass' = 'true'`,
    sql`${socialMediaAssets.visionVerdict}->>'checkCompleted' = 'true'`,
    ...(INCLUDE_NON_CAST ? [] : [sql`jsonb_array_length(coalesce(${socialMediaAssets.castSlugs}, '[]'::jsonb)) > 0`]),
  ]

  const rows = await db
    .select({
      id: socialMediaAssets.id,
      url: socialMediaAssets.url,
      productHandle: socialMediaAssets.productHandle,
      castSlugs: socialMediaAssets.castSlugs,
      oldVerdict: socialMediaAssets.visionVerdict,
    })
    .from(socialMediaAssets)
    .where(and(...conditions))
    .limit(Number.isFinite(LIMIT) ? LIMIT : 100_000)

  const candidates = rows as AuditRow[]
  console.log(`[audit-vision-verdicts] ${candidates.length} previously-passed on-skin asset(s) since ${SINCE.toISOString()}${INCLUDE_NON_CAST ? ' (including non-cast)' : ''}`)

  let falsePassCount = 0
  const falsePasses: Array<{ id: number; url: string; productHandle: string | null; oldNotes: string; newNotes: string; disagreedOn: string[] }> = []

  for (const row of candidates) {
    const newVerdict = await runVisionGate(row.url)
    const oldExposure = exposureChecksOf(row.oldVerdict)
    const newExposure = exposureChecksOf(newVerdict)
    const disagreedOn = EXPOSURE_CHECK_NAMES.filter((name) => oldExposure[name] === 'pass' && newExposure[name] !== 'pass')

    if (disagreedOn.length > 0 || !newVerdict.pass) {
      falsePassCount++
      falsePasses.push({
        id: row.id, url: row.url, productHandle: row.productHandle,
        oldNotes: row.oldVerdict.notes, newNotes: newVerdict.notes, disagreedOn,
      })
      console.error(`[audit-vision-verdicts] FALSE PASS asset ${row.id} (${row.productHandle ?? 'n/a'}): old pass, new ${newVerdict.pass ? 'pass with different exposure reads' : 'fail'} on [${disagreedOn.join(', ') || 'see notes'}]`)
      console.error(`  old notes: ${row.oldVerdict.notes}`)
      console.error(`  new notes: ${newVerdict.notes}`)
      if (WRITE) await recordVisionVerdict(row.id, newVerdict)
    }
  }

  const rate = candidates.length > 0 ? (falsePassCount / candidates.length) : 0
  console.log(JSON.stringify({
    checked: candidates.length,
    falsePasses: falsePassCount,
    falsePassRate: Number(rate.toFixed(4)),
    wrote: WRITE,
    since: SINCE.toISOString(),
    details: falsePasses,
  }, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[audit-vision-verdicts] fatal:', err)
    process.exit(1)
  })
