/**
 * Pure classification for the map_restricted sweep (ticket #16147).
 * No I/O. scripts/map-restricted-sweep.ts feeds it live Shopify + feed data.
 */

export type MapSweepAction =
  | 'flag'
  | 'already flagged'
  | 'below MAP, report only'
  | 'no MAP known'

export type PriceVsMap = 'below' | 'at' | 'above' | 'unknown'

const CENT = 0.005

/** Compare a price to MAP at cent precision. MAP <= 0 or null counts as unknown. */
export function priceVsMap(price: number, mapPrice: number | null): PriceVsMap {
  if (mapPrice == null || !Number.isFinite(mapPrice) || mapPrice <= 0) return 'unknown'
  if (price < mapPrice - CENT) return 'below'
  if (price > mapPrice + CENT) return 'above'
  return 'at'
}

/**
 * Decide the sweep action for one ACTIVE product from an honoured-MAP vendor.
 * - Below MAP is never written: it is a pricing violation for the owner to rule on.
 * - Unknown MAP is never written: nothing to compare against.
 * - Already flagged rows are left alone (idempotent).
 * - Everything else (at or above MAP, unflagged) gets the flag.
 */
export function classifyMapRow(input: {
  price: number
  mapPrice: number | null
  flagged: boolean
}): MapSweepAction {
  const rel = priceVsMap(input.price, input.mapPrice)
  if (rel === 'below') return 'below MAP, report only'
  if (rel === 'unknown') return input.flagged ? 'already flagged' : 'no MAP known'
  return input.flagged ? 'already flagged' : 'flag'
}
