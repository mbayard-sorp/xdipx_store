/**
 * Nalpac dropship policy: what we may not sell through Nalpac dropship, and
 * which brands Nalpac checks for MAP compliance before approving their sales.
 *
 * Source: Nalpac's "Restricted from Dropship Sales" notice, received by the
 * owner 2026-10-09. The Lovense and Playground MAP agreements are signed.
 *
 * Pure module (no I/O), so every import gate and the pricing engine share one
 * list and the tests can pin it.
 */

/** A whole brand Nalpac will not dropship ("brick and mortar only"). */
export const DROPSHIP_BLOCKED_BRANDS: readonly string[] = ['Crave']

/**
 * Brands whose pills, supplements and gummies Nalpac will not dropship. The
 * rest of each brand's line (lubes, toys, body care) is still allowed.
 */
export const DROPSHIP_SUPPLEMENT_BLOCKED_BRANDS: readonly string[] = [
  'Bedroom Products',
  'Bijoux Indiscrets',
  'Doc Johnson',
  'Elixir',
  'Gig Wholesale',
  'K-Beech',
  'National',
  'Promescent',
  'Rhino',
  'Sex Chocolates',
  'Swiss Navy',
  'Zeus',
]

/**
 * The Nalpac feed Sub-Category values that hold pills, supplements and
 * gummies. "Shots Honeys and Nectars" is where Doc Johnson's Spanish Fly
 * drops and Royal Honey live; Nalpac counts them as supplements.
 */
export const SUPPLEMENT_SUB_CATEGORIES: readonly string[] = [
  'Pills',
  'Top Supplements',
  'Shots Honeys and Nectars',
  'Gummies and Edibles',
]

/**
 * SKUs Nalpac named outright. 98510 (Elixir Magnetic Lip Gloss with
 * Pheromones) sits in the feed under Body Care, so the category rule alone
 * would miss it. Elixir's other pheromone item (98509, the facial mist) is
 * caught by the title rule below on the same reading.
 */
export const DROPSHIP_BLOCKED_SKUS: readonly string[] = ['98510']

/**
 * Brands Nalpac verifies for MAP compliance before approving sales on our
 * account. Every listing for these must sit at or above the feed MAP, with no
 * clearance exemption. Spelled as the brand appears in the feed and as our
 * Shopify vendor; Snail Vibe ships as "SVibe" and Hello Playground as
 * "Playground", and both spellings are listed so either source matches.
 */
export const NALPAC_MAP_VERIFIED_BRANDS: readonly string[] = [
  'Lovense',
  'Playground',
  'Hello Playground',
  'Autoblow',
  'Dame',
  'Doxy',
  'Gun Oil',
  'Empowered Products',
  'Shinesty',
  'Snail Vibe',
  'SVibe',
  'SpareParts',
]

export interface DropshipCheckInput {
  brand: string | null | undefined
  /** Every title the product goes by (feed title, display title). */
  titles: readonly (string | null | undefined)[]
  /** Nalpac Sub-Category cells; each may itself be a comma-joined list. */
  subCategories: readonly (string | null | undefined)[]
  skus: readonly (string | null | undefined)[]
}

function norm(s: string | null | undefined): string {
  return (s ?? '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().toLowerCase()
}

function inList(brand: string, list: readonly string[]): boolean {
  return list.some(b => norm(b) === brand)
}

/** True when Nalpac verifies this brand's listings for MAP compliance. */
export function isNalpacMapVerifiedBrand(vendor: string | null | undefined): boolean {
  const v = norm(vendor)
  return v !== '' && inList(v, NALPAC_MAP_VERIFIED_BRANDS)
}

/**
 * Returns the reason a product may not be sold through Nalpac dropship, or
 * null when it is allowed.
 */
export function dropshipRestriction(input: DropshipCheckInput): string | null {
  const brand  = norm(input.brand)
  const titles = input.titles.map(norm).filter(Boolean)

  if (brand && inList(brand, DROPSHIP_BLOCKED_BRANDS)) {
    return `Nalpac dropship: ${input.brand} is brick and mortar only`
  }

  // Nalpac marks store-exclusive items in the title itself, e.g. "Adam's
  // Trainer By Fleshlight (Restricted to A&E Stores)".
  if (titles.some(t => t.includes('restricted to'))) {
    return 'Nalpac dropship: title marks the item store-restricted'
  }
  if (brand === 'adam & eve' && titles.some(t => t.includes('fleshlight'))) {
    return 'Nalpac dropship: Adam & Eve Fleshlight products are not dropshipped'
  }

  const skus = input.skus.map(s => (s ?? '').trim()).filter(Boolean)
  if (skus.some(s => DROPSHIP_BLOCKED_SKUS.includes(s))) {
    return 'Nalpac dropship: SKU named on the restricted list'
  }

  if (brand && inList(brand, DROPSHIP_SUPPLEMENT_BLOCKED_BRANDS)) {
    const subs = input.subCategories
      .flatMap(c => (c ?? '').split(','))
      .map(norm)
      .filter(Boolean)
    const hit = SUPPLEMENT_SUB_CATEGORIES.find(c => subs.includes(norm(c)))
    if (hit) return `Nalpac dropship: ${input.brand} ${hit.toLowerCase()} are not dropshipped`
    if (brand === 'elixir' && titles.some(t => t.includes('pheromone'))) {
      return 'Nalpac dropship: Elixir pheromone products are restricted (Nalpac cited 98510)'
    }
  }

  return null
}
