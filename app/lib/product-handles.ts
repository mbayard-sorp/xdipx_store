/**
 * Normalisation for Sanity `productHandles` arrays.
 *
 * These arrays exist in the dataset in TWO shapes, because different writers
 * have produced them over time:
 *
 *   - `productRef` objects — `[{ _key, _type: 'productRef', handle }]`
 *     (what `upsertEmmaPick` / `patchEmmaRail` write today)
 *   - bare strings        — `['some-product-handle']`
 *     (older/hand-written docs, still live on `singleton.homepage` rails)
 *
 * A GROQ object projection (`productHandles[]{ handle }`) silently collapses
 * every bare-string entry to `null`, and the consumer's `.map(p => p.handle)`
 * then throws `Cannot read properties of null`. Because the homepage builds
 * every team section in one `Promise.all`, a single legacy-shaped rail took
 * down the entire team content payload and the storefront fell back to its
 * hardcoded shell everywhere.
 *
 * So the queries now select `productHandles` RAW (preserving both shapes) and
 * hand the result to this helper, which is total: it accepts either shape, and
 * drops anything null/blank instead of throwing. Pure — no server-only imports,
 * safe from routes and `.server.ts` alike.
 */

/** A single `productHandles` entry as it may arrive from Sanity. */
export type ProductHandleEntry = string | { handle?: string | null } | null | undefined

/**
 * Flatten a raw `productHandles` array to clean handle strings.
 * Never throws; unknown/blank entries are dropped rather than propagated as
 * `undefined` (which would become a bogus Shopify lookup downstream).
 */
export function normalizeProductHandles(
  entries: readonly ProductHandleEntry[] | null | undefined,
): string[] {
  if (!Array.isArray(entries)) return []
  const handles: string[] = []
  for (const entry of entries) {
    const raw = typeof entry === 'string' ? entry : entry?.handle
    if (typeof raw === 'string' && raw.trim().length > 0) handles.push(raw.trim())
  }
  return handles
}
