/**
 * Server-side assembly for the homepage Curiosity Shelf (Nº 07).
 *
 * Reads the live discovery index and the `singleton.curiosityShelf` Sanity doc,
 * falls back to the code-side `DEFAULT_SHELF_CONTENT` when Sanity is absent,
 * disabled, or invalid, validates every lane's see-all destination against the
 * live collection list, and resolves the whole band to real product at BUILD
 * time. The result is JSON-safe and rides the precomputed homepage B blob, so no
 * `/api/*` round trip exists at runtime (that absence is the whole point of the
 * redesign — see docs/homepage-team/discovery-band-redesign-spec.md §j).
 *
 * Server-only (`.server.ts`): never import from a client component. All matching
 * logic is pure and lives in `~/lib/curiosity-shelf`.
 */

import { getDiscoveryIndex } from '~/lib/discovery.server'
import { getCollectionList } from '~/lib/shopify.server'
import { getCuriosityShelf, type CuriosityShelfDoc } from '~/lib/sanity.server'
import { resolveShelf, DEFAULT_SHELF_CONTENT } from '~/lib/curiosity-shelf'
import type { CuriosityLane, CuriosityShelfContent, CuriosityShelfData } from '~/types/curiosity'
import { PRODUCT_TYPE_DIALS, type ProductTypeDial } from '~/types'

/** Coerce a Sanity type-dial value to a valid `ProductTypeDial`, else null. */
function coerceTypeDial(v: unknown): ProductTypeDial | null {
  return typeof v === 'string' && (PRODUCT_TYPE_DIALS as readonly string[]).includes(v)
    ? (v as ProductTypeDial)
    : null
}

function coerceNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Map a published Sanity doc to the authored content shape, or null when it is
 * absent, disabled, or has no usable lane. Missing top-level strings fall back to
 * the default field, so a partially-authored doc never renders a blank heading.
 */
function toContent(doc: CuriosityShelfDoc | null): CuriosityShelfContent | null {
  if (!doc || doc.enabled === false) return null

  const lanes: CuriosityLane[] = (doc.lanes ?? [])
    .filter(l => l && typeof l.label === 'string' && typeof l.key === 'string')
    .map(l => ({
      label: l.label!,
      key: l.key!,
      emmaLine: typeof l.emmaLine === 'string' ? l.emmaLine : '',
      productHandles: Array.isArray(l.productHandles)
        ? l.productHandles.filter((h): h is string => typeof h === 'string')
        : [],
      backfill: {
        typeDial: coerceTypeDial(l.backfill?.typeDial),
        mood: typeof l.backfill?.mood === 'string' ? l.backfill.mood : null,
        minPrice: coerceNumber(l.backfill?.minPrice),
        maxPrice: coerceNumber(l.backfill?.maxPrice),
      },
      seeAllHandle: typeof l.seeAllHandle === 'string' ? l.seeAllHandle : '',
      enabled: l.enabled !== false,
    }))

  if (lanes.length === 0) return null

  return {
    eyebrow: typeof doc.eyebrow === 'string' ? doc.eyebrow : DEFAULT_SHELF_CONTENT.eyebrow,
    heading: typeof doc.heading === 'string' ? doc.heading : DEFAULT_SHELF_CONTENT.heading,
    emphasis: typeof doc.emphasis === 'string' ? doc.emphasis : DEFAULT_SHELF_CONTENT.emphasis,
    emmaLine: typeof doc.emmaLine === 'string' ? doc.emmaLine : DEFAULT_SHELF_CONTENT.emmaLine,
    lanes,
  }
}

/**
 * Assemble the loader payload. Reads the discovery index once (already warmed by
 * the rails call in `assembleStorefrontHome`, so this is an in-memory hit) and
 * resolves the band against it. Returns `null` on a cold index or when fewer than
 * three lanes can honestly fill six — StorefrontHome then skips the band, exactly
 * as the retired Sensation Map did.
 *
 * The day-granularity rotation seed lives here at the server-assembly boundary
 * (not inside the pure resolver) and is injectable so tests can pin "today". The
 * payload is rebuilt by `/cron/warm` every 15 min, so day-bucket rotation is safe.
 */
export async function getCuriosityShelfData(
  now: () => Date = () => new Date(),
): Promise<CuriosityShelfData | null> {
  const index = await getDiscoveryIndex()
  if (index.length === 0) return null

  const doc = await getCuriosityShelf()
  const content = toContent(doc) ?? DEFAULT_SHELF_CONTENT

  // Verified see-all destinations: collections that exist AND have stock. An
  // authored handle that is not on this list drops that lane's See-all (the
  // resolver renders no link) rather than repointing it at best-sellers, whose
  // ranking is structurally guaranteed to mismatch a lane's discovery-index deck
  // (mission brief §1). A Shopify hiccup degrades to "trust the authored handles"
  // so a transient API failure does not strip every See-all off the band.
  let verifiedCollections: Set<string>
  try {
    const collections = await getCollectionList()
    verifiedCollections = new Set(
      collections.filter(c => c.productsCount === null || c.productsCount > 0).map(c => c.handle),
    )
  } catch (err) {
    console.warn('[curiosity-shelf] collection list unavailable, trusting authored handles:', err)
    verifiedCollections = new Set(content.lanes.map(l => l.seeAllHandle).filter(Boolean))
  }

  const dayBucket = Math.floor(now().getTime() / 86_400_000)
  return resolveShelf(content, index, { dayBucket, verifiedCollections })
}
