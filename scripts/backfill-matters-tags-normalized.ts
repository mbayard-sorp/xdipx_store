/**
 * backfill-matters-tags-normalized.ts
 *
 * Ticket #1256 (conv-audit A3). Populates the derived
 * `productPage.mattersTagsNormalized` field from `mattersTags` via the
 * canonical slugifier in app/lib/tag-normalize.ts — the same function the
 * conversation search filter uses at query time. Until every doc carries the
 * normalized sibling, the search clause cannot switch off the Title-Case
 * display values (ticket #1257 depends on this having run).
 *
 * Idempotent — docs whose normalized field already matches are skipped.
 * Dry-run by default.
 *
 * Usage:
 *   npx tsx scripts/backfill-matters-tags-normalized.ts             # dry-run
 *   npx tsx scripts/backfill-matters-tags-normalized.ts --apply     # write
 *
 * Verification (from the ticket): after --apply,
 *   count(*[_type=="productPage" && count(mattersTags)>0 &&
 *           count(mattersTagsNormalized)==0]) == 0
 */

import './_load-env'
import { createClient } from '@sanity/client'
import { normalizeTagList } from '../app/lib/tag-normalize'

const APPLY = process.argv.includes('--apply')

/** True when the two arrays contain the same set of values, ignoring order. */
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = new Set(a)
  for (const v of b) if (!sa.has(v)) return false
  return true
}

async function main(): Promise<void> {
  const projectId = process.env['SANITY_PROJECT_ID']
  const token     = process.env['SANITY_API_TOKEN']
  if (!projectId || !token) {
    console.error('Missing SANITY_PROJECT_ID or SANITY_API_TOKEN')
    process.exit(1)
  }

  const sanity = createClient({
    projectId,
    dataset: process.env['SANITY_DATASET'] ?? 'production',
    apiVersion: '2024-10-01',
    useCdn: false,
    token,
  })

  // Pull every productPage doc (incl. drafts) with at least one mattersTags
  // value; docs with none need no normalized sibling (count of a missing
  // field is null, so query both shapes explicitly).
  const docs = await sanity.fetch<{ _id: string; mattersTags: string[] | null; mattersTagsNormalized: string[] | null }[]>(
    `*[_type == "productPage" && count(mattersTags) > 0]{ _id, mattersTags, mattersTagsNormalized }`,
  )
  console.log(`Found ${docs.length} productPage docs with mattersTags`)
  console.log(`Mode: ${APPLY ? 'APPLY (writing changes)' : 'DRY-RUN (preview only — pass --apply to write)'}`)
  console.log('')

  let updated = 0
  let skipped = 0
  let failed = 0
  let i = 0

  for (const d of docs) {
    i++
    const desired = normalizeTagList(d.mattersTags ?? [])
    const current = d.mattersTagsNormalized ?? []
    if (sameSet(desired, current)) {
      skipped++
      continue
    }

    if (!APPLY) {
      if (updated < 10) {
        console.log(`  would patch ${d._id}: [${(d.mattersTags ?? []).join(', ')}] → [${desired.join(', ')}]`)
      }
      updated++
      continue
    }

    try {
      await sanity.patch(d._id).set({ mattersTagsNormalized: desired }).commit({ visibility: 'async' })
      updated++
      if (updated % 100 === 0) {
        console.log(`  patched ${updated} (${i}/${docs.length})`)
      }
    } catch (err) {
      failed++
      console.error(`  FAILED ${d._id}:`, err instanceof Error ? err.message : err)
    }
  }

  console.log('')
  console.log(`${APPLY ? 'Patched' : 'Would patch'}: ${updated}  Skipped (already correct): ${skipped}  Failed: ${failed}`)
  if (APPLY && failed === 0) {
    const remaining = await sanity.fetch<number>(
      `count(*[_type == "productPage" && count(mattersTags) > 0 && count(mattersTagsNormalized) == 0])`,
    )
    console.log(`Verification — docs with mattersTags but no normalized sibling: ${remaining} (must be 0)`)
    if (remaining > 0) process.exit(1)
  }
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
