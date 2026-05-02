/**
 * One-off cleanup: remove stale + mis-routed Emma rail refs from
 * `singleton.homepage.sections[]`.
 *
 * What counts as "stale":
 *   1. Rail's sourceDealId is NOT the current live deal (deal rotated, archive
 *      hook didn't fire — typically because the rail predates the hook).
 *   2. Rail's `target` field is `pdp` (publish-flow bug appended a PDP rail
 *      to homepage sections — fixed in api.publish-rails.tsx going forward).
 *   3. Rail status is `archived` (already archived but ref still lingers).
 *
 * For each match: archive the rail doc (status=archived, active=false) +
 * unset the ref from singleton.homepage.sections[].
 *
 * Run (dry-run):  npx tsx scripts/cleanup-stale-homepage-rails.ts
 * Apply:          npx tsx scripts/cleanup-stale-homepage-rails.ts --apply
 *
 * Dry-run prints exactly what would change. No mutations until --apply.
 */
import 'dotenv/config'
import { createClient } from '@sanity/client'
import { neon } from '@neondatabase/serverless'

const SANITY_PROJECT_ID = process.env['SANITY_PROJECT_ID']
const SANITY_DATASET    = process.env['SANITY_DATASET'] ?? 'production'
const SANITY_TOKEN      = process.env['SANITY_API_TOKEN']
const DATABASE_URL      = process.env['DATABASE_URL']
const APPLY             = process.argv.includes('--apply')

if (!SANITY_PROJECT_ID || !SANITY_TOKEN) {
  console.error('Missing SANITY_PROJECT_ID or SANITY_API_TOKEN')
  process.exit(1)
}
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL')
  process.exit(1)
}

const sanity = createClient({
  projectId:  SANITY_PROJECT_ID,
  dataset:    SANITY_DATASET,
  apiVersion: '2024-10-01',
  token:      SANITY_TOKEN,
  useCdn:     false,
})
const sql = neon(DATABASE_URL)

interface RailDoc {
  _id:          string
  status:       'draft' | 'approved' | 'live' | 'archived'
  active:       boolean
  target:       'homepage' | 'pdp'
  sourceDealId: string
  heading:      string | null
}

/** Strip the `gid://shopify/Product/` prefix so DB values + Sanity values compare cleanly. */
function numericId(idLike: string | null | undefined): string {
  if (!idLike) return ''
  return idLike.replace(/^gid:\/\/shopify\/Product\//, '').trim()
}

async function main() {
  // 1. Resolve current live deal's Shopify product id (DB stores numeric form)
  const liveRows = await sql`SELECT shopify_product_id FROM deal_history WHERE status = 'live' LIMIT 1`
  const liveDealNumeric = numericId(liveRows[0]?.['shopify_product_id'] as string | undefined)
  console.log('Current live deal product id:', liveDealNumeric || '(none)')

  // 2. Get every ref in singleton.homepage.sections[]
  const refIds = await sanity.fetch<string[]>(
    `*[_id == "singleton.homepage"][0].sections[defined(_ref)]._ref`,
  )
  if (!refIds || refIds.length === 0) {
    console.log('No emma rail refs in singleton.homepage.sections[]. Nothing to clean.')
    return
  }
  console.log('Total rail refs in homepage sections:', refIds.length)

  // 3. Fetch each rail doc behind those refs
  const rails: RailDoc[] = await sanity.fetch(
    `*[_id in $ids]{ _id, status, active, target, sourceDealId, heading }`,
    { ids: refIds },
  )

  // 4. Decide what to do per ref. Two action shapes:
  //    - 'unset-only'    → ref leaves homepage; rail doc stays as-is
  //                        (PDP rails that leaked, archived rails still
  //                        referenced — the rail itself is still valid).
  //    - 'archive-and-unset' → ref leaves homepage; rail doc flips to
  //                        archived/inactive (homepage rails for old deals,
  //                        the rotator should have caught these but didn't).
  type Action = 'unset-only' | 'archive-and-unset'
  const plan: { rail: RailDoc; action: Action; reasons: string[] }[] = []
  for (const r of rails) {
    const reasons: string[] = []
    let action: Action | null = null
    if (r.target === 'pdp') {
      reasons.push('target=pdp (leaked into homepage sections — keep PDP rail intact)')
      action = 'unset-only'
    } else if (r.status === 'archived') {
      reasons.push('status=archived (lingering ref to already-archived rail)')
      action = 'unset-only'
    } else if (liveDealNumeric && numericId(r.sourceDealId) !== liveDealNumeric) {
      reasons.push(`sourceDealId=${numericId(r.sourceDealId)} ≠ current live deal — archive`)
      action = 'archive-and-unset'
    }
    if (action) plan.push({ rail: r, action, reasons })
  }

  // Also catch dangling refs (ref points to nothing — doc deleted but ref still
  // in sections). Sanity returns no doc for those, so they won't appear in
  // `rails`. Just unset the ref.
  const fetchedIds = new Set(rails.map(r => r._id))
  const dangling = refIds.filter(id => !fetchedIds.has(id))

  // 5. Report
  console.log(`\nFound ${plan.length} stale rail(s) to clean:`)
  for (const { rail, action, reasons } of plan) {
    console.log(`  - ${rail._id}`)
    console.log(`    "${rail.heading ?? '(no heading)'}" | status=${rail.status} | target=${rail.target}`)
    console.log(`    action: ${action}`)
    for (const r of reasons) console.log(`    × ${r}`)
  }
  if (dangling.length) {
    console.log(`\n⚠ ${dangling.length} dangling ref(s) — referenced doc no longer exists:`)
    for (const id of dangling) console.log('  -', id, '(action: unset-only)')
  }

  if (plan.length === 0 && dangling.length === 0) {
    console.log('\nNothing to clean.')
    return
  }

  if (!APPLY) {
    console.log(`\nDry-run only. Re-run with --apply to mutate Sanity.`)
    return
  }

  // 6. Apply
  console.log('\nApplying cleanup...')
  let archived = 0
  let unsetRefs = 0
  for (const { rail, action } of plan) {
    if (action === 'archive-and-unset') {
      try {
        await sanity.patch(rail._id).set({ status: 'archived', active: false }).commit()
        archived++
      } catch (err) {
        console.error('  ! archive failed for', rail._id, err)
      }
    }
    try {
      await sanity
        .patch('singleton.homepage')
        .unset([`sections[_ref=="${rail._id}"]`])
        .commit()
      unsetRefs++
    } catch (err) {
      console.error('  ! unset ref failed for', rail._id, err)
    }
  }
  for (const id of dangling) {
    try {
      await sanity
        .patch('singleton.homepage')
        .unset([`sections[_ref=="${id}"]`])
        .commit()
      unsetRefs++
    } catch (err) {
      console.error('  ! unset dangling ref failed for', id, err)
    }
  }
  console.log(`Done. Archived ${archived} rail doc(s); removed ${unsetRefs} homepage ref(s).`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
