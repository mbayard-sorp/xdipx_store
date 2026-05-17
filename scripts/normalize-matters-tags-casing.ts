/**
 * normalize-matters-tags-casing.ts
 *
 * Step 1.5 of the v2 "What Matters" chip-set migration.
 *
 * Pure data fix — collapses Sanity `productPage.mattersTags` values that
 * exist in multiple casing variants ("Body-Safe-Silicone" and
 * "body-safe-silicone", "Hands-Free" and "hands-free", etc.) into a single
 * canonical sentence-case form per Co-Work's sign-off.
 *
 * Normalization rule (minimal — case only, no semantic renames):
 *   - Lowercase the entire string
 *   - Capitalize the first character
 *   - Preserve hyphens and spaces as-is
 *
 * Examples:
 *   "Body-Safe-Silicone"  → "Body-safe-silicone"
 *   "body-safe-silicone"  → "Body-safe-silicone"
 *   "Plus-Size-Friendly"  → "Plus-size-friendly"
 *   "Whisper-Quiet"       → "Whisper-quiet"
 *
 * Semantic renames (Travel-size → Travel-ready, Discreet-design → Discreet,
 * App-controlled → Remote-controlled, separator changes like
 * "Plus-size-friendly" → "Plus-size friendly") are intentionally out of
 * scope here — those land in the chip-set rename PR (steps 1-3) so this
 * fix is reversible if the rename PR slips.
 *
 * Scope: Sanity only. Shopify metafield values get re-synced as a side-
 * effect of step 5.5's full-catalog backfill via the existing push pipeline.
 *
 * Idempotent — safe to re-run. Dry-run by default.
 *
 * Usage:
 *   npx tsx scripts/normalize-matters-tags-casing.ts             # dry-run
 *   npx tsx scripts/normalize-matters-tags-casing.ts --apply     # write
 *
 * See: docs/what-matters-final-signoff.md (step 1.5)
 */

import './_load-env'
import { createClient } from '@sanity/client'

const APPLY = process.argv.includes('--apply')

/** Normalize one tag value to canonical sentence-case. */
function normalize(tag: string): string {
  if (!tag) return tag
  const lowered = tag.toLowerCase()
  return lowered.charAt(0).toUpperCase() + lowered.slice(1)
}

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

  // Pull every productPage doc (incl. drafts) so we don't leave drafts stale.
  // Only those with at least one mattersTags value need consideration.
  const docs = await sanity.fetch<{ _id: string; mattersTags: string[] | null }[]>(
    `*[_type == "productPage" && count(mattersTags) > 0]{ _id, mattersTags }`,
  )
  console.log(`Found ${docs.length} productPage docs with mattersTags`)
  console.log(`Mode: ${APPLY ? 'APPLY (writing changes)' : 'DRY-RUN (preview only — pass --apply to write)'}`)
  console.log('')

  // Collect a global rename report so the operator can see what's collapsing.
  const renames = new Map<string, string>()  // raw → normalized
  let updated = 0
  let skipped = 0
  let failed  = 0
  let i = 0

  for (const d of docs) {
    i++
    const current = d.mattersTags ?? []

    // Normalize + de-dupe (collapsing same-after-normalization variants).
    const desired = Array.from(new Set(current.map(normalize)))

    // Track every value's transformation for the summary report.
    for (const raw of current) {
      const norm = normalize(raw)
      if (raw !== norm) renames.set(raw, norm)
    }

    if (sameSet(desired, current) && desired.length === current.length) {
      skipped++
      continue
    }

    if (!APPLY) {
      updated++
      if (updated <= 10) {
        console.log(`  would patch ${d._id}: ${JSON.stringify(current)} → ${JSON.stringify(desired)}`)
      } else if (updated === 11) {
        console.log(`  … (further dry-run examples suppressed; see summary below)`)
      }
      continue
    }

    try {
      await sanity.patch(d._id).set({ mattersTags: desired }).commit({ visibility: 'async' })
      updated++
      if (updated % 100 === 0) {
        console.log(`  patched ${updated} (${i}/${docs.length})`)
      }
    } catch (e) {
      failed++
      console.error(`  patch failed: ${d._id}`, e instanceof Error ? e.message : e)
    }
  }

  console.log('')
  console.log(`Rename map (raw → canonical, only differing values):`)
  if (renames.size === 0) {
    console.log(`  (no casing drift detected — every tag was already canonical)`)
  } else {
    const sorted = Array.from(renames.entries()).sort(([a], [b]) => a.localeCompare(b))
    for (const [raw, norm] of sorted) console.log(`  "${raw}" → "${norm}"`)
  }

  console.log('')
  console.log(`Done — ${APPLY ? 'patched' : 'would patch'} ${updated}, skipped ${skipped}, failed ${failed}`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
