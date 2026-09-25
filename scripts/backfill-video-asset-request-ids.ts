/**
 * One-off backfill for media_assets.provider_request_id (ticket #11552,
 * migration 105).
 *
 * For every video job, pairs each provider handle on
 * video_jobs.provider_request_ids with the single media_assets row its output
 * was re-hosted to (matched by blob filename, see planBackfillForJob) and
 * copies the request id onto that row. Only empty columns are filled;
 * ambiguous and unmatched stages are counted and skipped. Scene frame
 * candidates are not backfillable: their per-candidate ids were only ever
 * logged to the token log, never stored on the job.
 *
 * Usage:
 *   npx tsx scripts/backfill-video-asset-request-ids.ts          # dry-run, prints counts
 *   npx tsx scripts/backfill-video-asset-request-ids.ts --apply  # write
 */
import './_load-env'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { mediaAssets, videoJobs } from '../db/schema'
import { planBackfillForJob } from '../app/lib/video-provider-lookup.server'

const APPLY = process.argv.includes('--apply')

async function main(): Promise<void> {
  const jobs = await db.select({ id: videoJobs.id, jobId: videoJobs.jobId, providerRequestIds: videoJobs.providerRequestIds }).from(videoJobs)
  const totals = { jobs: jobs.length, writes: 0, written: 0, alreadySet: 0, ambiguous: 0, unmatched: 0 }

  for (const job of jobs) {
    const assets = await db
      .select({ id: mediaAssets.id, blobUrl: mediaAssets.blobUrl, providerRequestId: mediaAssets.providerRequestId })
      .from(mediaAssets)
      .where(eq(mediaAssets.videoJobId, job.id))
    const plan = planBackfillForJob(job.jobId, job.providerRequestIds, assets)
    totals.writes += plan.writes.length
    totals.alreadySet += plan.alreadySet
    totals.ambiguous += plan.ambiguous.length
    totals.unmatched += plan.unmatched.length
    if (plan.ambiguous.length) console.log(`[ambiguous] ${job.jobId}: ${plan.ambiguous.join(', ')}`)
    for (const w of plan.writes) {
      console.log(`${APPLY ? '[write]' : '[dry-run]'} ${job.jobId} ${w.stage} -> asset ${w.assetId} = ${w.requestId}`)
      if (!APPLY) continue
      const done = await db.update(mediaAssets)
        .set({ providerRequestId: w.requestId })
        .where(and(eq(mediaAssets.id, w.assetId), isNull(mediaAssets.providerRequestId)))
        .returning({ id: mediaAssets.id })
      totals.written += done.length
    }
  }

  console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', ...totals }, null, 2))
}

main().then(() => process.exit(0), err => {
  console.error(err)
  process.exit(1)
})
