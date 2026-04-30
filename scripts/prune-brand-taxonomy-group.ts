// One-time cleanup: remove any taxonomy groups whose entries are exclusively
// `brand:*` slugs. Brands aren't carried as Shopify product tags — vendor
// already has its own facet bucket — so the curated "All Brands" group has
// always returned zero matches.
//
// Reversible: this prints the removed group(s) so you can re-add via the
// /admin/search-filters UI if you change your mind.
//
// Run:
//   npx tsx scripts/prune-brand-taxonomy-group.ts
//
// Add --dry-run to preview without writing.

import './_load-env'
import { db } from '../app/lib/db.server'
import { pipelineSettings } from '../db/schema'
import { eq } from 'drizzle-orm'

interface TaxonomyTag { tag: string; label: string }
interface TaxonomyGroup { id: string; label: string; tags: TaxonomyTag[]; defaultExpanded?: boolean }

const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  const rows = await db.select().from(pipelineSettings).where(eq(pipelineSettings.key, 'searchFilterTaxonomy'))
  if (rows.length === 0) {
    console.log('No searchFilterTaxonomy row found')
    process.exit(0)
  }
  const taxonomy: TaxonomyGroup[] = JSON.parse(rows[0]!.value)

  const kept: TaxonomyGroup[] = []
  const removed: TaxonomyGroup[] = []

  for (const group of taxonomy) {
    const allBrand = group.tags.length > 0 && group.tags.every(t => t.tag.startsWith('brand:'))
    if (allBrand) removed.push(group)
    else kept.push(group)
  }

  if (removed.length === 0) {
    console.log('No brand-only groups found — nothing to prune.')
    process.exit(0)
  }

  console.log(`Removing ${removed.length} brand-only group(s):`)
  for (const g of removed) {
    console.log(`  - "${g.label}" (${g.tags.length} entries)`)
  }

  if (DRY_RUN) {
    console.log('')
    console.log('--dry-run: no changes written.')
    process.exit(0)
  }

  await db.update(pipelineSettings)
    .set({ value: JSON.stringify(kept), updatedAt: new Date() })
    .where(eq(pipelineSettings.key, 'searchFilterTaxonomy'))

  console.log('')
  console.log(`Done — taxonomy now has ${kept.length} group(s)`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
