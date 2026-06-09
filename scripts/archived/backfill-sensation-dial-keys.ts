/**
 * backfill-sensation-dial-keys.ts
 *
 * Repairs productPage.sensationDialV2.items entries that are missing the
 * required `_key` property. Sanity arrays of objects require a unique string
 * `_key` per item — without it, Studio refuses to render the field for edit
 * ("Missing keys" error).
 *
 * Root cause: historical data was written via API client paths that didn't
 * include `_key`. The current write path in app/lib/sanity.server.ts already
 * runs items through withSanityKey() so new writes are clean — this script
 * only fixes the legacy data.
 *
 * Key algorithm: mirrors `withSanityKey()` from sanity.server.ts ─
 *   sha1(item.label).slice(0, 12), with index-suffixed fallback on collision.
 * Re-running is safe and produces the same _key for the same label.
 *
 * Idempotent — skips docs where every item already has a _key. Dry-run by
 * default.
 *
 * Usage:
 *   npx tsx scripts/backfill-sensation-dial-keys.ts             # dry-run
 *   npx tsx scripts/backfill-sensation-dial-keys.ts --apply     # write
 */

import './_load-env'
import { createHash } from 'node:crypto'
import { createClient } from '@sanity/client'

const APPLY = process.argv.includes('--apply')

interface DialItem {
  label: string
  value: number
  proposed?: boolean
  _key?: string
}

interface DialDoc {
  _id: string
  sensationDialV2: {
    items?: DialItem[]
  } | null
}

/** Mirror of withSanityKey() from app/lib/sanity.server.ts. */
function withSanityKey<T extends { label: string; _key?: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.map((item, i) => {
    if (item._key) {
      seen.add(item._key)
      return item
    }
    const base = createHash('sha1').update(item.label).digest('hex').slice(0, 12)
    let key = base
    if (seen.has(key)) key = `${base}${i.toString(36)}`
    seen.add(key)
    return { ...item, _key: key }
  })
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

  // Pull every productPage doc (incl. drafts) where any item lacks _key.
  const docs = await sanity.fetch<DialDoc[]>(
    `*[_type == "productPage" && defined(sensationDialV2.items) && count(sensationDialV2.items[!defined(_key)]) > 0]{ _id, sensationDialV2 }`,
  )
  console.log(`Found ${docs.length} productPage docs with sensationDialV2 items missing _key`)
  console.log(`Mode: ${APPLY ? 'APPLY (writing changes)' : 'DRY-RUN (preview only — pass --apply to write)'}`)
  console.log('')

  let updated = 0
  let failed  = 0
  let i = 0

  for (const d of docs) {
    i++
    const items = d.sensationDialV2?.items ?? []
    if (items.length === 0) continue

    const repaired = withSanityKey(items)

    if (!APPLY) {
      updated++
      if (updated <= 5) {
        const before = items.map(it => ({ label: it.label, _key: it._key ?? '(missing)' }))
        const after  = repaired.map(it => ({ label: it.label, _key: it._key }))
        console.log(`  would patch ${d._id}:`)
        console.log(`    before: ${JSON.stringify(before)}`)
        console.log(`    after:  ${JSON.stringify(after)}`)
      } else if (updated === 6) {
        console.log(`  … (further dry-run examples suppressed)`)
      }
      continue
    }

    try {
      await sanity
        .patch(d._id)
        .set({ 'sensationDialV2.items': repaired })
        .commit({ visibility: 'async' })
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
  console.log(`Done — ${APPLY ? 'patched' : 'would patch'} ${updated}, failed ${failed}`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
