/**
 * Backfill: normalize every Sanity productPage.ivrVoiceSummary so existing
 * docs authored before the write-path fix (scripts/enrich-ivr-tags.ts) also
 * sound clean when the IVR speaks them.
 *
 * Idempotent — skips docs whose stored value already matches normalizeForTTS.
 *
 * Usage:
 *   npx tsx scripts/backfill-ivr-voice-summaries.ts --dry-run
 *   npx tsx scripts/backfill-ivr-voice-summaries.ts
 */
import 'dotenv/config'
import { createClient } from '@sanity/client'
import { normalizeForTTS } from '../app/lib/tts-normalize.ts'

const dryRun = process.argv.includes('--dry-run')

const sanity = createClient({
  projectId: process.env['SANITY_PROJECT_ID']!,
  dataset: process.env['SANITY_DATASET'] ?? 'production',
  apiVersion: '2024-10-01',
  token: process.env['SANITY_API_TOKEN']!,
  useCdn: false,
})

interface Row { _id: string; title: string; ivrVoiceSummary: string }

async function main() {
  const rows = await sanity.fetch<Row[]>(
    `*[_type == "productPage" && defined(ivrVoiceSummary)] { _id, title, ivrVoiceSummary }`,
  )
  console.log(`Fetched ${rows.length} productPage docs with ivrVoiceSummary`)

  let changed = 0
  let skipped = 0
  for (const row of rows) {
    const normalized = normalizeForTTS(row.ivrVoiceSummary).slice(0, 120)
    if (normalized === row.ivrVoiceSummary) {
      skipped++
      continue
    }
    changed++
    console.log(`\n${row.title} (${row._id})`)
    console.log(`  before: ${JSON.stringify(row.ivrVoiceSummary)}`)
    console.log(`  after:  ${JSON.stringify(normalized)}`)
    if (!dryRun) {
      await sanity.patch(row._id).set({ ivrVoiceSummary: normalized }).commit()
    }
  }

  console.log(`\n${dryRun ? '[dry-run] ' : ''}changed=${changed} skipped=${skipped} total=${rows.length}`)
  if (dryRun && changed > 0) {
    console.log('Re-run without --dry-run to apply.')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
