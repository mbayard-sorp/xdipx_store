/**
 * One-off driver for the import-enrich lifecycle over freshly-imported drafts.
 *
 * Uses the exact same functions as /cron/import-enrich (so all bookkeeping —
 * enrich_batch_id, enriched_at, retries, parking, published_at — stays
 * consistent with the cron), but runs locally with a big submission cap and a
 * tight poll loop instead of the 10-per-30-min drip:
 *
 *   1. submitEnrichmentBatch(cap) — one Anthropic Message Batch for every
 *      imported-but-unenriched candidate (50% batch discount).
 *   2. Poll collectEnrichmentBatch() until nothing is pending; failed products
 *      get their one bounded retry via a follow-up submit round.
 *   3. publishEnrichedProducts() — flip enriched drafts to active.
 *
 * The 30-min cron may interleave; that is safe (applies are idempotent and
 * per-product stamps persist progress).
 *
 *   npx tsx scripts/enrich-new-imports.ts             # dry-run: show counts only
 *   npx tsx scripts/enrich-new-imports.ts --apply     # run the full lifecycle
 *   npx tsx scripts/enrich-new-imports.ts --apply --no-publish
 */

import 'dotenv/config'
import { eq, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { importCandidates } from '../db/schema'
import {
  submitEnrichmentBatch,
  collectEnrichmentBatch,
  publishEnrichedProducts,
} from '~/lib/import-enrich.server'

const SUBMIT_CAP = 35 // per-batch chunk; large single uploads flake on TLS locally
const POLL_INTERVAL_MS = 60_000
const MAX_SUBMIT_ROUNDS = 3
const MAX_POLLS_PER_ROUND = 120 // 2h ceiling per batch

const apply = process.argv.includes('--apply')
const noPublish = process.argv.includes('--no-publish')

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function counts() {
  const [row] = await db
    .select({
      unenriched: sql<number>`count(*) filter (where ${importCandidates.enrichedAt} is null and ${importCandidates.enrichFailedAt} is null and ${importCandidates.enrichBatchId} is null)`,
      inFlight:   sql<number>`count(*) filter (where ${importCandidates.enrichedAt} is null and ${importCandidates.enrichBatchId} is not null)`,
      enriched:   sql<number>`count(*) filter (where ${importCandidates.enrichedAt} is not null)`,
      parked:     sql<number>`count(*) filter (where ${importCandidates.enrichFailedAt} is not null)`,
      unpublished: sql<number>`count(*) filter (where ${importCandidates.enrichedAt} is not null and ${importCandidates.publishedAt} is null)`,
    })
    .from(importCandidates)
    .where(eq(importCandidates.status, 'imported'))
  return row
}

async function main(): Promise<void> {
  console.log('initial state:', await counts())
  if (!apply) {
    console.log('\nDry run. Re-run with --apply to submit + collect + publish.')
    process.exit(0)
  }

  for (let round = 1; round <= MAX_SUBMIT_ROUNDS; round++) {
    // Drain the unsubmitted pool in chunks. Multiple in-flight batches are
    // fine: collectEnrichmentBatch groups candidates by batchId. Transient
    // connection errors get a bounded retry with backoff.
    let submittedTotal = 0
    for (;;) {
      let submitted
      let attempt = 0
      for (;;) {
        try {
          submitted = await submitEnrichmentBatch(SUBMIT_CAP)
          break
        } catch (err) {
          attempt++
          const msg = err instanceof Error ? err.message : String(err)
          if (attempt >= 6) throw err
          console.warn(`submit attempt ${attempt} failed (${msg}); retrying in 30s`)
          await sleep(30_000)
        }
      }
      console.log(`round ${round}: submit ->`, submitted)
      submittedTotal += submitted.submitted
      if (submitted.submitted < SUBMIT_CAP) break
    }
    if (submittedTotal === 0 && round === 1) {
      // Nothing new to submit; there may still be an in-flight batch to drain.
      const state = await counts()
      if (Number(state.inFlight) === 0) break
    } else if (submittedTotal === 0) {
      break
    }

    let done = false
    for (let poll = 0; poll < MAX_POLLS_PER_ROUND; poll++) {
      await sleep(POLL_INTERVAL_MS)
      const collected = await collectEnrichmentBatch()
      console.log(`round ${round} poll ${poll + 1}:`, collected, new Date().toISOString())
      if (collected.stillPending === 0) {
        done = true
        break
      }
    }
    if (!done) {
      console.error('poll ceiling reached with batch still pending; the cron will finish collection. Exiting.')
      process.exit(1)
    }

    // Anything that failed its first attempt has enrich_batch_id cleared and
    // gets exactly one retry via the next round's submit. If nothing is left
    // unsubmitted, we are done.
    const state = await counts()
    console.log(`round ${round} end state:`, state)
    if (Number(state.unenriched) === 0) break
  }

  if (noPublish) {
    console.log('skipping publish (--no-publish). final state:', await counts())
    process.exit(0)
  }

  const published = await publishEnrichedProducts()
  console.log('publish ->', published)
  console.log('final state:', await counts())
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
