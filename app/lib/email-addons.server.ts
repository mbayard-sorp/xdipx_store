/**
 * Per-recipient add-on sync for the daily promo email program (ticket
 * #15001). For one Klaviyo profile: map that profile's purchased products'
 * curated `accessory_product_ids` + `pairing_why` (app/lib/shopify.server.ts)
 * to up to 3 real, in-stock, not-already-purchased add-ons ("owned"); a
 * profile with no resolvable owned add-on falls back to a small set of
 * universally-safe category searches ("generic") rather than a hardcoded
 * product list — CLAUDE.md: "No hardcoded product data anywhere". Writes
 * flat `xdipx_addon_{1..3}_{handle,title,image,url,why}` +
 * `xdipx_addons_kind` + `xdipx_addons_updated_at` profile properties via
 * `updateProfileProperties` (app/lib/klaviyo.server.ts), read by
 * `yourAddOnsBlock()` in app/lib/email-blocks.ts.
 *
 * Driving this per profile across a whole Klaviyo list (listing profiles,
 * pulling real purchase history, resolving the live accessory catalog) is
 * the daily-email-assembler's wiring (ticket #14999) to call into; this
 * module is the pure mapping core plus a per-profile orchestrator that takes
 * its data sources as injected deps, so it is fully unit-tested without a
 * network or a database.
 *
 * No server imports in the pure functions below, so they are unit-tested in
 * isolation. The orchestrator (`syncAddonsForProfile`) and the metric picker
 * (`choosePlacedOrderMetricId`) take deps for the same reason. The
 * production wiring at the bottom of this file (ticket #15002) is the one
 * place that imports a live client.
 */
import { updateProfileProperties } from './klaviyo.server'
import { searchAdminProducts } from './shopify.server'

export interface AddonCandidate {
  /** Product GID — the key `pairing_why` is authored against. */
  id: string
  handle: string
  title: string
  imageUrl: string
  inStock: boolean
}

export interface AddonSlot {
  handle: string
  title: string
  image: string
  url: string
  /** Emma-voice pairing blurb, carried through from the source product's
   *  `pairing_why` metafield verbatim. Empty string for a generic-fallback
   *  slot, which has no authored blurb to carry. */
  why: string
}

export type AddonKind = 'owned' | 'generic'

export interface PurchasedProductAccessories {
  handle: string
  /** xdipx.accessory_product_ids, in curation order. */
  accessoryProductIds: string[]
  /** xdipx.pairing_why: accessory GID -> Emma-voice blurb. */
  pairingWhy: Record<string, string>
}

/**
 * Category-aware fallback search queries for a profile with no owned add-on,
 * same pattern as the SMS UPSELL stage's lube fallback
 * (app/lib/sms-v2/stages/upsell.server.ts `pickLubeFallback`): a live
 * category search, never a hardcoded product. Lube-first because it is the
 * universally-safe pairing regardless of what else is in the catalog.
 */
export const GENERIC_ADDON_QUERIES: readonly string[] = ['water-based lube', 'bestseller', 'wellness']

function productUrl(handle: string): string {
  return `https://xdipx.com/products/${handle}`
}

/**
 * Map a profile's purchased products' curated accessories to up to 3 add-on
 * slots, in curation order across purchases (one purchase's accessories
 * before the next purchase's), deduped by handle, excluding anything already
 * purchased or out of stock. `pairing_why` copy passes through unchanged —
 * never rewritten, never defaulted to filler when a blurb exists.
 */
export function mapPurchasesToAddons(
  purchasedProducts: readonly PurchasedProductAccessories[],
  ownedCatalog: ReadonlyMap<string, AddonCandidate>,
  purchasedHandles: ReadonlySet<string>,
): AddonSlot[] {
  const seen = new Set<string>()
  const out: AddonSlot[] = []
  for (const purchased of purchasedProducts) {
    for (const accessoryId of purchased.accessoryProductIds) {
      if (out.length >= 3) return out
      const candidate = ownedCatalog.get(accessoryId)
      if (!candidate) continue
      if (seen.has(candidate.handle)) continue
      if (purchasedHandles.has(candidate.handle)) continue
      if (!candidate.inStock) continue
      seen.add(candidate.handle)
      out.push({
        handle: candidate.handle,
        title: candidate.title,
        image: candidate.imageUrl,
        url: productUrl(candidate.handle),
        why: purchased.pairingWhy[accessoryId] ?? '',
      })
    }
  }
  return out
}

/**
 * Generic fallback: map already-resolved category-search candidates
 * (GENERIC_ADDON_QUERIES, resolved by the caller) to up to 3 slots, same
 * in-stock / not-already-purchased exclusion. No `pairing_why` exists for a
 * category search, so `why` is always empty.
 */
export function mapGenericAddons(
  candidates: readonly AddonCandidate[],
  purchasedHandles: ReadonlySet<string>,
): AddonSlot[] {
  const seen = new Set<string>()
  const out: AddonSlot[] = []
  for (const candidate of candidates) {
    if (out.length >= 3) break
    if (seen.has(candidate.handle)) continue
    if (purchasedHandles.has(candidate.handle)) continue
    if (!candidate.inStock) continue
    seen.add(candidate.handle)
    out.push({ handle: candidate.handle, title: candidate.title, image: candidate.imageUrl, url: productUrl(candidate.handle), why: '' })
  }
  return out
}

/**
 * Resolve the slots and the kind for one profile: owned when at least one
 * curated accessory survives the exclusions, generic otherwise — so every
 * recipient renders a full block, per the ticket.
 */
export function resolveAddonSlots(input: {
  purchasedProducts: readonly PurchasedProductAccessories[]
  ownedCatalog: ReadonlyMap<string, AddonCandidate>
  genericCandidates: readonly AddonCandidate[]
  purchasedHandles: ReadonlySet<string>
}): { slots: AddonSlot[]; kind: AddonKind } {
  const owned = mapPurchasesToAddons(input.purchasedProducts, input.ownedCatalog, input.purchasedHandles)
  if (owned.length > 0) return { slots: owned, kind: 'owned' }
  return { slots: mapGenericAddons(input.genericCandidates, input.purchasedHandles), kind: 'generic' }
}

/**
 * Flatten up to 3 slots into the profile properties `yourAddOnsBlock()`
 * reads: `xdipx_addon_{1..3}_{handle,title,image,url,why}`,
 * `xdipx_addons_kind`, `xdipx_addons_updated_at`. A profile with fewer than
 * 3 slots simply writes fewer numbered keys; `yourAddOnsBlock()`'s `{% if %}`
 * guards already handle a missing slot.
 */
export function buildAddonProfileProperties(
  slots: readonly AddonSlot[],
  kind: AddonKind,
  updatedAt: string,
): Record<string, string> {
  const props: Record<string, string> = {
    xdipx_addons_kind: kind,
    xdipx_addons_updated_at: updatedAt,
  }
  slots.slice(0, 3).forEach((slot, i) => {
    const n = i + 1
    props[`xdipx_addon_${n}_handle`] = slot.handle
    props[`xdipx_addon_${n}_title`] = slot.title
    props[`xdipx_addon_${n}_image`] = slot.image
    props[`xdipx_addon_${n}_url`] = slot.url
    props[`xdipx_addon_${n}_why`] = slot.why
  })
  return props
}

// ─── "Placed Order" metric selection ────────────────────────────────────────

export interface PlacedOrderMetricCandidate {
  id: string
  /** The metric's `integration.name` attribute from the Klaviyo Metrics API. */
  integrationName?: string
}

/**
 * Two "Placed Order" metrics can coexist in one Klaviyo account: one per
 * integration that has ever sent the event (e.g. a Shopify-native metric
 * plus a leftover custom/API-tracked one from before Shopify was wired up).
 * Only one carries real events going forward, and reading purchase history
 * off the wrong one silently returns an empty history for every profile.
 * `hasEvents` is injected so this is unit-tested without a live probe.
 * Prefers the Shopify-integration metric first when more than one candidate
 * actually has events.
 */
export async function choosePlacedOrderMetricId(
  candidates: readonly PlacedOrderMetricCandidate[],
  hasEvents: (metricId: string) => Promise<boolean>,
): Promise<string | null> {
  const score = (c: PlacedOrderMetricCandidate) => (c.integrationName?.toLowerCase() === 'shopify' ? 0 : 1)
  const ordered = [...candidates].sort((a, b) => score(a) - score(b))
  for (const c of ordered) {
    if (await hasEvents(c.id)) return c.id
  }
  return null
}

// ─── Per-profile orchestrator ───────────────────────────────────────────────

export interface AddonSyncDeps {
  getPurchasedProducts: (profileId: string) => Promise<PurchasedProductAccessories[]>
  getPurchasedHandles: (profileId: string) => Promise<Set<string>>
  getOwnedCatalog: (purchasedProducts: readonly PurchasedProductAccessories[]) => Promise<Map<string, AddonCandidate>>
  getGenericCandidates: () => Promise<AddonCandidate[]>
  updateProfileProperties: (email: string, properties: Record<string, string | null>) => Promise<void>
  now: () => string
}

export interface AddonSyncResult {
  kind: AddonKind
  slotCount: number
}

/**
 * Sync one profile's add-on properties. Fetches the owned catalog first and
 * only reaches for the generic candidates when owned mapping comes back
 * empty, so a profile with real purchase history never pays for a category
 * search it will not use.
 */
export async function syncAddonsForProfile(
  profile: { id: string; email: string },
  deps: AddonSyncDeps,
): Promise<AddonSyncResult> {
  const purchasedProducts = await deps.getPurchasedProducts(profile.id)
  const purchasedHandles = await deps.getPurchasedHandles(profile.id)
  const ownedCatalog = await deps.getOwnedCatalog(purchasedProducts)

  const owned = mapPurchasesToAddons(purchasedProducts, ownedCatalog, purchasedHandles)
  const { slots, kind }: { slots: AddonSlot[]; kind: AddonKind } =
    owned.length > 0
      ? { slots: owned, kind: 'owned' }
      : { slots: mapGenericAddons(await deps.getGenericCandidates(), purchasedHandles), kind: 'generic' }

  await deps.updateProfileProperties(profile.email, buildAddonProfileProperties(slots, kind, deps.now()))
  return { kind, slotCount: slots.length }
}

// ─── Production wiring + audience-wide sync (ticket #15002) ────────────────
// Everything above this line stays network-free by design (see the module
// doc). This section is the first real caller: the daily email program,
// syncing every recipient on the send's audience list before the draft push.

function memoizedGenericCandidates(): () => Promise<AddonCandidate[]> {
  let cached: Promise<AddonCandidate[]> | null = null
  return () => {
    // GENERIC_ADDON_QUERIES never changes mid-pass, so a list of N recipients
    // costs 3 Admin searches total, not 3N — resolved once and reused.
    cached ??= (async () => {
      const seen = new Set<string>()
      const out: AddonCandidate[] = []
      for (const query of GENERIC_ADDON_QUERIES) {
        const results = await searchAdminProducts(query, 5)
        for (const r of results) {
          if (seen.has(r.handle)) continue
          seen.add(r.handle)
          out.push({ id: r.id, handle: r.handle, title: r.title, imageUrl: r.image ?? '', inStock: r.inventoryQuantity > 0 })
        }
      }
      return out
    })()
    return cached
  }
}

/**
 * Production deps for one sync pass. Purchase history ("owned" add-ons)
 * is meant to read Klaviyo's own Shopify-sourced "Placed Order" event
 * history (`choosePlacedOrderMetricId` above is the metric picker for
 * exactly that read) — but that sync is currently broken in production
 * (owner blocker `email:klaviyo-shopify-sync`,
 * docs/store-team/routine-email-daily.md), so there is no live purchase
 * history to read yet. `getPurchasedProducts`/`getPurchasedHandles` return
 * empty until a follow-up ticket wires the Events-API read once that sync
 * is repaired; every profile falls through to the generic category
 * fallback in the meantime, which is the documented, honest behavior
 * `routine-email-daily.md` describes for "Readers with no purchase
 * history."
 */
export function defaultAddonSyncDeps(): AddonSyncDeps {
  return {
    getPurchasedProducts: async () => [],
    getPurchasedHandles: async () => new Set<string>(),
    getOwnedCatalog: async (purchasedProducts) => (purchasedProducts.length === 0 ? new Map() : new Map()),
    getGenericCandidates: memoizedGenericCandidates(),
    updateProfileProperties,
    now: () => new Date().toISOString(),
  }
}

export interface AudienceSyncResult {
  attempted: number
  succeeded: number
  failed: number
}

/**
 * Best-effort add-on sync across every profile on a Klaviyo list. One
 * profile's failure (a transient Klaviyo error, a malformed profile) never
 * aborts the pass or the caller's draft — reported in the result, not
 * thrown.
 */
export async function syncAddonsForAudience(
  profiles: readonly { id: string; email: string }[],
  deps: AddonSyncDeps = defaultAddonSyncDeps(),
): Promise<AudienceSyncResult> {
  let succeeded = 0
  let failed = 0
  for (const profile of profiles) {
    try {
      await syncAddonsForProfile(profile, deps)
      succeeded++
    } catch (err) {
      failed++
      console.error('[email-addons] sync failed for', profile.email, err)
    }
  }
  return { attempted: profiles.length, succeeded, failed }
}
