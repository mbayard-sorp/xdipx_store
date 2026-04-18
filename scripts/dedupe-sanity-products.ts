/**
 * One-off cleanup: remove duplicate productPage documents in Sanity.
 *
 * Two code paths historically created productPage docs with different _id
 * conventions (`product-{handle}` from the bulk sync, `productPage-{handle}`
 * from webhooks/admin), so the same Shopify product can have two docs with
 * the same shopifyHandle.
 *
 * Keeps the doc with contentBlocks (manual edits). If neither has blocks,
 * keeps the oldest. Deletes the rest.
 *
 * Run (dry-run):  npx tsx scripts/dedupe-sanity-products.ts
 * Apply:          npx tsx scripts/dedupe-sanity-products.ts --apply
 */
import 'dotenv/config'
import { createClient } from '@sanity/client'

const SANITY_PROJECT_ID = process.env['SANITY_PROJECT_ID']
const SANITY_DATASET    = process.env['SANITY_DATASET'] ?? 'production'
const SANITY_TOKEN      = process.env['SANITY_API_TOKEN']
const APPLY             = process.argv.includes('--apply')

if (!SANITY_PROJECT_ID || !SANITY_TOKEN) {
  console.error('Missing SANITY_PROJECT_ID or SANITY_API_TOKEN')
  process.exit(1)
}

const sanity = createClient({
  projectId:  SANITY_PROJECT_ID,
  dataset:    SANITY_DATASET,
  apiVersion: '2024-10-01',
  token:      SANITY_TOKEN,
  useCdn:     false,
})

interface Doc {
  _id:            string
  _createdAt:     string
  _updatedAt:     string
  shopifyHandle?: string
  hasBlocks:      boolean
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (will delete)' : 'dry run'}\n`)

  const docs = await sanity.fetch<Doc[]>(
    `*[_type == "productPage"]{
      _id, _createdAt, _updatedAt, shopifyHandle,
      "hasBlocks": count(contentBlocks) > 0
    }`,
  )

  const byHandle = new Map<string, Doc[]>()
  let noHandle = 0
  for (const d of docs) {
    if (!d.shopifyHandle) { noHandle++; continue }
    const arr = byHandle.get(d.shopifyHandle) ?? []
    arr.push(d)
    byHandle.set(d.shopifyHandle, arr)
  }

  console.log(`Total productPage docs: ${docs.length}`)
  console.log(`Docs without shopifyHandle: ${noHandle}`)
  console.log(`Unique handles: ${byHandle.size}\n`)

  const dupes = [...byHandle.entries()].filter(([, arr]) => arr.length > 1)
  console.log(`Handles with duplicates: ${dupes.length}\n`)

  let toDelete = 0
  for (const [handle, arr] of dupes) {
    // Prefer docs with content blocks; tiebreak by oldest _createdAt
    const sorted = [...arr].sort((a, b) => {
      if (a.hasBlocks !== b.hasBlocks) return a.hasBlocks ? -1 : 1
      return a._createdAt.localeCompare(b._createdAt)
    })
    const [keep, ...rest] = sorted
    console.log(`[${handle}]`)
    console.log(`  keep   ${keep!._id} (blocks=${keep!.hasBlocks}, created=${keep!._createdAt})`)
    for (const d of rest) {
      console.log(`  delete ${d._id} (blocks=${d.hasBlocks}, created=${d._createdAt})`)
      toDelete++
      if (APPLY) {
        try {
          await sanity.delete(d._id)
        } catch (err) {
          console.error(`    ✗ failed: ${(err as Error).message}`)
        }
      }
    }
  }

  console.log(`\n${APPLY ? 'Deleted' : 'Would delete'}: ${toDelete} documents`)
  if (!APPLY && toDelete > 0) console.log('Re-run with --apply to commit.')
}

main().catch(err => { console.error(err); process.exit(1) })
