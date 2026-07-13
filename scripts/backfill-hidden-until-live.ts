/**
 * WS2c — ONE-TIME MANUAL BACKFILL. Do not wire into any cron/routine.
 *
 * Context: `hiddenUntilLive` (studio/schemas/productPage.js) is opt-out —
 * unset/false = visible — so the already-published live catalog needs zero
 * backfill; `app/lib/bulk-import.server.ts` and `app/lib/import-enrich.server.ts`
 * set it true going forward at stub-creation time, and `activateShopifyProduct`
 * (app/lib/shopify.server.ts) clears it automatically on activation.
 *
 * The gap this script closes: productPage stubs created by the import pipeline
 * BEFORE this flag existed. Those stubs' underlying Shopify products may still
 * be DRAFT (queued, not yet approved/activated) and are currently leaking into
 * sitemap.xml + on-site search under the opt-out-visible default. This script
 * finds every currently-visible productPage doc, checks the real Shopify
 * product status, and retroactively sets `hiddenUntilLive: true` on the ones
 * still draft.
 *
 * Idempotent — safe to re-run. Each run re-derives status live from Shopify
 * and only ever writes the single `hiddenUntilLive` field; already-hidden docs
 * are skipped (not re-queried), and already-active products are left alone.
 *
 * Usage:
 *   Dry-run (default): npx tsx scripts/backfill-hidden-until-live.ts
 *   Apply:              npx tsx scripts/backfill-hidden-until-live.ts --apply
 *   Narrow to a list:   npx tsx scripts/backfill-hidden-until-live.ts --handles=slug-a,slug-b --apply
 *
 * If Shopify Admin credentials aren't available in this environment, the exact
 * query this script runs against Sanity to find CANDIDATES (before checking
 * Shopify status) is:
 *
 *   *[_type == "productPage" && defined(shopifyProductId)
 *     && (!defined(hiddenUntilLive) || hiddenUntilLive != true)]{
 *     _id, shopifyHandle, shopifyProductId
 *   }
 *
 * — feed the resulting `shopifyProductId` list through whatever admin tooling
 * is available to determine draft vs. active, then patch `hiddenUntilLive: true`
 * on the drafts' `_id`s directly in Sanity (Vision / sanity CLI `documents patch`).
 */
// MUST be first — populates process.env before any downstream module reads it.
import './_load-env'
import { createClient } from '@sanity/client'
import { adminGraphQL } from '../app/lib/shopify.server'

const SANITY_PROJECT_ID = process.env['SANITY_PROJECT_ID']
const SANITY_DATASET    = process.env['SANITY_DATASET'] ?? 'production'
const SANITY_TOKEN      = process.env['SANITY_API_TOKEN']

const APPLY = process.argv.includes('--apply')
const HANDLES_ARG  = process.argv.find(a => a.startsWith('--handles='))
const ONLY_HANDLES = HANDLES_ARG
  ? new Set(HANDLES_ARG.slice('--handles='.length).split(',').map(s => s.trim()).filter(Boolean))
  : null

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

interface StubDoc {
  _id:               string
  shopifyHandle:      string
  shopifyProductId:   string | null
}

function toGid(idLike: string): string {
  return idLike.startsWith('gid://') ? idLike : `gid://shopify/Product/${idLike}`
}

// GraphQL `nodes(ids:)` — comfortably under Shopify's query-cost cap per batch.
const BATCH_SIZE = 100

async function fetchShopifyStatuses(gids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let i = 0; i < gids.length; i += BATCH_SIZE) {
    const batch = gids.slice(i, i + BATCH_SIZE)
    const data = await adminGraphQL<{ nodes: ({ id: string; status: string } | null)[] }>(
      `query BackfillHiddenUntilLiveStatus($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product { id status }
        }
      }`,
      { ids: batch },
    )
    for (const node of data.nodes) {
      if (node?.id) out.set(node.id, node.status)
    }
  }
  return out
}

async function main() {
  console.log(APPLY
    ? 'APPLY mode — will patch hiddenUntilLive:true where the Shopify product is still draft'
    : 'DRY RUN — pass --apply to write. Showing what would change:')

  // Only currently-visible docs need checking; anything already
  // hiddenUntilLive:true is already correctly hidden.
  const docs = await sanity.fetch<StubDoc[]>(
    `*[_type == "productPage" && defined(shopifyProductId)
      && (!defined(hiddenUntilLive) || hiddenUntilLive != true)]{
      _id, shopifyHandle, shopifyProductId
    }`,
  )
  const candidates = ONLY_HANDLES ? docs.filter(d => ONLY_HANDLES.has(d.shopifyHandle)) : docs
  console.log(`Found ${candidates.length} currently-visible productPage doc(s) to check (of ${docs.length} total with a Shopify id).`)
  if (candidates.length === 0) return

  const gids = candidates.map(d => toGid(d.shopifyProductId!))
  const statusByGid = await fetchShopifyStatuses(gids)

  let hidden = 0
  let missing = 0
  for (const doc of candidates) {
    const gid = toGid(doc.shopifyProductId!)
    const status = statusByGid.get(gid)
    if (!status) {
      missing++
      console.warn(`  [skip] ${doc.shopifyHandle} (${gid}) — not found in Shopify (deleted?)`)
      continue
    }
    if (status.toUpperCase() === 'DRAFT') {
      hidden++
      console.log(`  [hide] ${doc.shopifyHandle} (${gid}) — Shopify status=${status}`)
      if (APPLY) {
        await sanity.patch(doc._id).set({ hiddenUntilLive: true }).commit()
      }
    }
  }

  console.log(`\n${APPLY ? 'Patched' : 'Would patch'} ${hidden} doc(s) to hiddenUntilLive:true. ${missing} product(s) not found in Shopify (left untouched).`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
