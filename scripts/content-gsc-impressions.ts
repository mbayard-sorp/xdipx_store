/**
 * content-gsc-impressions.ts
 *
 * Ticket #16369 (split from #16280). The content routine's retro (Step 7,
 * docs/store-team/routine-content-daily.md) never had a way to tell whether
 * any of its own URLs (/notebook/, /compare/) earned a GSC impression that
 * week -- content-writer's tools are Read/Bash/Grep/Glob plus Sanity, no
 * direct DB client, so the retro needs a thin CLI it can run with Bash
 * rather than a function it would have to import into a script of its own.
 *
 * Reads the latest gsc_snapshots row (the weekly Monday 06:00 UTC snapshot,
 * app/lib/gsc.server.ts's runGscSnapshot) and sums its top_pages impressions
 * for /notebook/ and /compare/ URLs. A page not in the top 100 contributes 0;
 * that is an honest answer the retro should report, not an error.
 *
 * Usage:
 *   npx tsx scripts/content-gsc-impressions.ts [--json]
 *
 * Exit 0 on a successful read, including "no gsc_snapshots row yet" (an
 * honest, reportable zero, not a failure). Exit 1 only if the query itself
 * errors, so a real failure is never reported as a quiet zero.
 */

import { getWeeklyContentImpressions } from '../app/lib/gsc.server'

async function main() {
  const asJson = process.argv.includes('--json')
  const summary = await getWeeklyContentImpressions()

  if (asJson) {
    console.log(JSON.stringify(summary))
    return
  }

  if (summary.periodStart == null) {
    console.log('[content-gsc-impressions] no gsc_snapshots row yet (weekly, Monday 06:00 UTC) -- cannot report this week\'s impressions.')
    return
  }

  console.log(`[content-gsc-impressions] window ${summary.periodStart} to ${summary.periodEnd}:`)
  console.log(`  /notebook/ impressions: ${summary.notebookImpressions}`)
  console.log(`  /compare/  impressions: ${summary.compareImpressions}`)
  console.log(`  total:                 ${summary.totalImpressions} (across ${summary.pagesSeen} top-100 page${summary.pagesSeen === 1 ? '' : 's'})`)
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[content-gsc-impressions] failed:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
