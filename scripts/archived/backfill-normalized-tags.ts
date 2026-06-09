// One-time backfill: populate productPage.normalizedTags from productPage.tags
// for every existing doc. After this runs, /search and /view-all faceted
// filtering will match admin-curated taxonomy values against real product
// tags.
//
// Run:
//   npx tsx scripts/backfill-normalized-tags.ts
//
// Idempotent — safe to re-run. Skips docs whose normalizedTags already match
// what would be computed from `tags`.

import './_load-env'
import { createClient } from '@sanity/client'
import { normalizeTagList } from '../app/lib/tag-normalize'

async function main() {
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

  // Pull every productPage doc (incl. drafts) so we don't leave drafts stale.
  const docs = await sanity.fetch<{ _id: string; tags: string[] | null; normalizedTags: string[] | null }[]>(
    `*[_type == "productPage"]{ _id, tags, normalizedTags }`,
  )
  console.log(`Found ${docs.length} productPage docs`)

  let updated = 0
  let skipped = 0
  let failed = 0
  let i = 0

  for (const d of docs) {
    i++
    const desired = normalizeTagList(d.tags ?? [])
    const current = d.normalizedTags ?? []
    if (sameSet(desired, current)) { skipped++; continue }

    try {
      await sanity.patch(d._id).set({ normalizedTags: desired }).commit({ visibility: 'async' })
      updated++
      if (updated % 50 === 0) {
        console.log(`  patched ${updated} (${i}/${docs.length})`)
      }
    } catch (e) {
      failed++
      console.error(`  patch failed: ${d._id}`, e instanceof Error ? e.message : e)
    }
  }

  console.log('')
  console.log(`Done — updated ${updated}, skipped ${skipped}, failed ${failed}`)
  process.exit(failed > 0 ? 1 : 0)
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = new Set(a)
  for (const v of b) if (!sa.has(v)) return false
  return true
}

main().catch(e => { console.error(e); process.exit(1) })
