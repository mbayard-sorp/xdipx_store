/**
 * Sanity ↔ Shopify archive reconcile.
 *
 * `archiveShopifyProduct` (shopify.server.ts) only flips the Shopify status, and
 * the discontinued-sweep mirror (feed-processor.server.ts) only touches SKUs it
 * can resolve through `dealHistory`. Any product archived or deleted by another
 * path leaves a live `productPage` doc in Sanity — one that on-site search and
 * IVR search still match (both filter `archived != true`), while PDP hydration
 * silently drops it because the Storefront API no longer returns the product.
 * The result is search hits that lead nowhere.
 *
 * This reconcile diffs the live (non-archived) `productPage` handles against a
 * full Shopify status sweep and sets `archived: true` on every doc whose Shopify
 * counterpart is archived or gone. It is dry-run by default; `apply` performs the
 * patches.
 *
 * Safety: a partial or failed Shopify sweep would look like "everything is gone"
 * and could mass-archive the live catalog (the exact class of incident that once
 * killed 17 sellable products — see CLAUDE.md, Shopify Metafields). So an apply
 * refuses to run when the sweep came back empty, or when the flagged set exceeds
 * `maxArchiveRatio` of the live docs, unless `force` is set.
 */

import { getClient } from './sanity.server'
import { collectProductHandlesByStatus } from './shopify.server'

export type ReconcileReason = 'archived-in-shopify' | 'gone-from-shopify'

export interface ReconcileArchivedResult {
  /** Live (non-archived) productPage docs with a handle, scanned in Sanity. */
  sanityLive: number
  /** Sellable (active + draft) Shopify handles seen in the sweep. */
  shopifySellable: number
  /** Archived-status Shopify handles seen in the sweep. */
  shopifyArchived: number
  /** Live docs whose Shopify counterpart is archived. */
  archivedInShopify: number
  /** Live docs whose Shopify counterpart is gone entirely. */
  goneFromShopify: number
  /** Total docs flagged (archivedInShopify + goneFromShopify). */
  flagged: number
  /** Docs actually patched to archived:true (0 in dry-run or when skipped). */
  patched: number
  /** True when patches were written. */
  applied: boolean
  /** Set when an apply was refused by a safety guard; describes why. */
  skippedForSafety?: { reason: string }
  /** First few flagged handles, for logging. */
  sample: Array<{ handle: string; reason: ReconcileReason }>
  /** Non-fatal per-doc patch failures. */
  errors: Array<{ handle: string; message: string }>
}

export interface ReconcileArchivedOpts {
  /** Perform the patches. Default false (dry-run). */
  apply?: boolean
  /** Bypass the safety guards below. Default false. */
  force?: boolean
  /** Refuse to apply when flagged/live exceeds this ratio. Default 0.25. */
  maxArchiveRatio?: number
}

export async function reconcileArchivedProductPages(
  opts: ReconcileArchivedOpts = {},
): Promise<ReconcileArchivedResult> {
  const apply = opts.apply === true
  const force = opts.force === true
  const maxArchiveRatio = opts.maxArchiveRatio ?? 0.25

  const result: ReconcileArchivedResult = {
    sanityLive: 0,
    shopifySellable: 0,
    shopifyArchived: 0,
    archivedInShopify: 0,
    goneFromShopify: 0,
    flagged: 0,
    patched: 0,
    applied: false,
    sample: [],
    errors: [],
  }

  const client = getClient(true, false, 'published')
  if (!client) {
    throw new Error('Sanity not configured — SANITY_API_TOKEN or SANITY_PROJECT_ID missing')
  }

  // Live productPage docs with a handle. `archived != true` matches the search /
  // IVR filters exactly, so we only look at docs that currently surface.
  const docs = await client.fetch<Array<{ _id: string; shopifyHandle: string }>>(
    `*[_type == "productPage" && defined(shopifyHandle) && archived != true]{ _id, shopifyHandle }`,
  )
  result.sanityLive = docs.length

  const { sellable, archived } = await collectProductHandlesByStatus()
  result.shopifySellable = sellable.size
  result.shopifyArchived = archived.size

  const toArchive: Array<{ _id: string; handle: string; reason: ReconcileReason }> = []
  for (const doc of docs) {
    const handle = doc.shopifyHandle
    if (sellable.has(handle)) continue // still sellable — leave it live
    const reason: ReconcileReason = archived.has(handle) ? 'archived-in-shopify' : 'gone-from-shopify'
    if (reason === 'archived-in-shopify') result.archivedInShopify++
    else result.goneFromShopify++
    toArchive.push({ _id: doc._id, handle, reason })
  }
  result.flagged = toArchive.length
  result.sample = toArchive.slice(0, 25).map(({ handle, reason }) => ({ handle, reason }))

  if (!apply) return result

  // Safety guards — a partial sweep must never mass-archive a live catalog.
  if (!force) {
    if (sellable.size === 0) {
      result.skippedForSafety = { reason: 'shopify sweep returned zero sellable products — treating as a failed sweep, refusing to archive' }
      return result
    }
    if (result.sanityLive > 0 && toArchive.length / result.sanityLive > maxArchiveRatio) {
      const pct = ((toArchive.length / result.sanityLive) * 100).toFixed(1)
      result.skippedForSafety = { reason: `flagged ${toArchive.length}/${result.sanityLive} live docs (${pct}%), over the ${(maxArchiveRatio * 100).toFixed(0)}% safety cap — refusing to archive without --force` }
      return result
    }
  }

  result.applied = true
  for (const item of toArchive) {
    try {
      await client.patch(item._id).set({ archived: true }).commit()
      result.patched++
    } catch (err) {
      result.errors.push({ handle: item.handle, message: err instanceof Error ? err.message : String(err) })
    }
  }

  return result
}
