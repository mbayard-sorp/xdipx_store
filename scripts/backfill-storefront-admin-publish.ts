/**
 * Ticket #23840. DRY-RUN BY DEFAULT.
 *
 * `publishProductToXdipxChannels` (app/lib/shopify.server.ts) matched this
 * shop's "Storefront Admin" sales-channel publication by the literal name
 * 'Storefront Admin', which never equalled the shop-prefixed name Shopify
 * actually uses here ('xdipx.com: Storefront Admin'), so our own explicit
 * publish step never covered that channel. Shopify's own default
 * auto-publish-to-all-channels behavior silently filled the gap until it
 * stopped doing so around 2026-11-15: every product created from that date
 * forward is Active and published to every OTHER intended channel, but is
 * permanently invisible to the Storefront API (confirmed live:
 * `product(handle:)` and `node(id:)` both return null, not slow) because it
 * never reached the one publication the Storefront API token actually reads
 * through.
 *
 * The code fix (isStorefrontAdminPublicationName) makes every future
 * activation correct immediately. This script is the one-time remediation
 * for the products that already fell through the gap: it finds every ACTIVE
 * product missing the Storefront Admin publication (by the same tolerant
 * name match as the fix) and republishes it via the same
 * `publishProductToXdipxChannels` call the ordinary activation path uses --
 * idempotent, additive-only (it only adds a channel publication; it changes
 * no price, inventory, or content), and safe to run more than once.
 *
 * NOT run from the originating R-DEV pass: it is a live mutation across
 * every currently-affected SKU (roughly 110+ as of 2026-11-23), which is a
 * materially different kind of action than a reviewed code diff, so it
 * needs a human (or an owner-directed run) to pull the trigger. Flagged as
 * an urgent blocker alongside this ticket's PR.
 *
 * Usage:
 *   npx tsx scripts/backfill-storefront-admin-publish.ts             # dry run, table
 *   npx tsx scripts/backfill-storefront-admin-publish.ts --json      # dry run, JSON
 *   npx tsx scripts/backfill-storefront-admin-publish.ts --limit 20  # cap rows checked
 *   npx tsx scripts/backfill-storefront-admin-publish.ts --apply     # actually republishes
 */
import './_load-env'
import {
  shopifyAdmin,
  adminGraphQL,
  publishProductToXdipxChannels,
  isStorefrontAdminPublicationName,
} from '../app/lib/shopify.server'

interface AdminProduct {
  id: number
  handle: string
  created_at: string
}

interface AffectedRow {
  id: number
  handle: string
  createdAt: string
}

async function findAffected(limit: number): Promise<AffectedRow[]> {
  const { products } = await shopifyAdmin<{ products: AdminProduct[] }>(
    `/products.json?status=active&limit=${limit}&fields=id,handle,created_at&order=created_at desc`,
  )

  const affected: AffectedRow[] = []
  for (const p of products) {
    const data = await adminGraphQL<{
      product: { resourcePublicationsV2: { edges: { node: { publication: { name: string } } }[] } } | null
    }>(
      `query P($id: ID!) { product(id: $id) { resourcePublicationsV2(first: 10) { edges { node { publication { name } } } } } }`,
      { id: `gid://shopify/Product/${p.id}` },
    )
    const names = (data.product?.resourcePublicationsV2.edges ?? []).map(e => e.node.publication.name)
    if (!names.some(isStorefrontAdminPublicationName)) {
      affected.push({ id: p.id, handle: p.handle, createdAt: p.created_at })
    }
  }
  return affected
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const json  = args.includes('--json')
  const limitArg = args.indexOf('--limit')
  const limit = limitArg !== -1 ? parseInt(args[limitArg + 1] ?? '250', 10) : 250

  const affected = await findAffected(limit)

  if (json) {
    console.log(JSON.stringify({ apply, checked: limit, affectedCount: affected.length, affected }, null, 2))
  } else {
    console.log(`Checked the ${limit} most-recently-created ACTIVE products.`)
    console.log(`${affected.length} missing the Storefront Admin publication:\n`)
    for (const row of affected) {
      console.log(`  ${row.handle}  (id ${row.id}, created ${row.createdAt})`)
    }
  }

  if (!apply) {
    console.log(`\nDRY RUN. Re-run with --apply to republish these ${affected.length} product(s).`)
    return
  }

  console.log(`\nApplying: republishing ${affected.length} product(s)...`)
  let ok = 0
  let failed = 0
  for (const row of affected) {
    try {
      await publishProductToXdipxChannels(String(row.id))
      ok++
      console.log(`  OK  ${row.handle}`)
    } catch (err) {
      failed++
      console.error(`  FAIL  ${row.handle}: ${err instanceof Error ? err.message : err}`)
    }
  }
  console.log(`\nDone. ${ok} republished, ${failed} failed.`)
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch(err => {
    console.error(err)
    process.exit(2)
  })
}
