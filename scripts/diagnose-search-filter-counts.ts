// One-off diagnostic: prints which admin-curated taxonomy tags actually have
// matching products in Sanity, and which are zero. Run with:
//
//   npx tsx scripts/diagnose-search-filter-counts.ts
//
// Reads the taxonomy from Postgres (pipeline_settings.searchFilterTaxonomy)
// and queries Sanity for the live tag distribution across non-archived
// productPage docs. No writes.

import './_load-env'
import { createClient } from '@sanity/client'
import { db } from '../app/lib/db.server'
import { pipelineSettings } from '../db/schema'
import { eq } from 'drizzle-orm'
import { normalizeTag } from '../app/lib/tag-normalize'

interface TaxonomyTag { tag: string; label: string }
interface TaxonomyGroup { id: string; label: string; tags: TaxonomyTag[] }

async function main() {
  const projectId = process.env['SANITY_PROJECT_ID']
  if (!projectId) {
    console.error('Missing SANITY_PROJECT_ID — env not loaded')
    process.exit(1)
  }
  const sanity = createClient({
    projectId,
    dataset: process.env['SANITY_DATASET'] ?? 'production',
    apiVersion: '2024-01-01',
    useCdn: true,
    token: process.env['SANITY_API_TOKEN'],
  })

  const rows = await db.select().from(pipelineSettings).where(eq(pipelineSettings.key, 'searchFilterTaxonomy'))
  if (rows.length === 0) {
    console.error('No searchFilterTaxonomy row in pipeline_settings')
    process.exit(1)
  }
  const taxonomy: TaxonomyGroup[] = JSON.parse(rows[0]!.value)

  const products = await sanity.fetch<{ tags: string[] | null; normalizedTags: string[] | null }[]>(
    `*[_type == "productPage" && archived != true]{ tags, normalizedTags }`,
  )
  console.log(`Sanity products (non-archived): ${products.length}`)

  // Count by both raw tags (for orphan reporting) and normalized slug (for
  // taxonomy lookup parity with /search and /view-all).
  const tagCount = new Map<string, number>()
  const normalizedCount = new Map<string, number>()
  for (const p of products) {
    if (p.tags) {
      const seen = new Set(p.tags)
      for (const t of seen) tagCount.set(t, (tagCount.get(t) ?? 0) + 1)
    }
    if (p.normalizedTags) {
      const seen = new Set(p.normalizedTags)
      for (const t of seen) normalizedCount.set(t, (normalizedCount.get(t) ?? 0) + 1)
    }
  }

  let totalEntries = 0
  let zeroEntries = 0
  const report: { group: string; label: string; tag: string; count: number; kind: 'single' | 'compound' }[] = []

  for (const group of taxonomy) {
    for (const t of group.tags) {
      totalEntries++
      const parts = t.tag.split(',').map(s => normalizeTag(s)).filter(Boolean)
      let count = 0
      if (parts.length <= 1) {
        // Normalize the taxonomy entry the same way the server does, then
        // look it up in the per-product normalizedTags index.
        count = normalizedCount.get(parts[0] ?? '') ?? 0
      } else {
        // OR-match against normalizedTags: count once if any part matches.
        for (const p of products) {
          if (!p.normalizedTags) continue
          const seen = new Set(p.normalizedTags)
          if (parts.some(part => seen.has(part))) count++
        }
      }
      if (count === 0) zeroEntries++
      report.push({ group: group.label, label: t.label, tag: t.tag, count, kind: parts.length > 1 ? 'compound' : 'single' })
    }
  }

  console.log('')
  console.log(`Taxonomy entries: ${totalEntries} — zero-count: ${zeroEntries}`)
  console.log('')

  // Group by group label
  const byGroup = new Map<string, typeof report>()
  for (const r of report) {
    const arr = byGroup.get(r.group) ?? []
    arr.push(r)
    byGroup.set(r.group, arr)
  }

  for (const [groupLabel, entries] of byGroup) {
    console.log(`── ${groupLabel} ──`)
    for (const e of entries.sort((a, b) => a.count - b.count)) {
      const flag = e.count === 0 ? '⚠️ ' : '   '
      const kind = e.kind === 'compound' ? '[compound]' : '          '
      console.log(`${flag}${String(e.count).padStart(4)}  ${kind}  ${e.label}  (${e.tag})`)
    }
    console.log('')
  }

  // Suggest: tags in the data that are NOT in the taxonomy (might want to surface)
  const taxonomyParts = new Set<string>()
  for (const group of taxonomy) {
    for (const t of group.tags) {
      for (const p of t.tag.split(',').map(s => s.trim()).filter(Boolean)) {
        taxonomyParts.add(p)
      }
    }
  }
  const orphans = [...tagCount.entries()]
    .filter(([t]) => !taxonomyParts.has(t))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
  if (orphans.length) {
    console.log('── Top product tags NOT in taxonomy ──')
    for (const [tag, count] of orphans) {
      console.log(`   ${String(count).padStart(4)}  ${tag}`)
    }
  }

  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
