/**
 * Collection taxonomy rules shared by the PLP, the /collections hub, the
 * sitemap and the llms.txt surfaces, so the four stop disagreeing about which
 * handles are public. Source: the 2026-10-23 collections audit
 * (docs/audits/collections-audit-2026-10-23.md, owner-approved 2026-10-24).
 *
 * Pure module (no .server suffix, no imports) so the rules are unit-testable
 * and importable from any route.
 */

/**
 * Handles that exist in Shopify but must never be listed: not on the hub, not
 * in the sitemap, not in llms.txt, and `noindex` if someone lands on the PLP.
 *
 * - Shopify's `frontpage` default and the retired daily-deal pair.
 * - `vault`, `for-him`, `for-her`: clean-URL duplicates and the retired
 *   gendered routes (owner decision 2026-10-24: retire for-him / for-her).
 * - Promo and channel utility collections: discount eligibility lists and the
 *   Shop channel price floor. They scope discounts and feeds, they are not
 *   shelves.
 * - `last-chance`: emptied by the 2026-10-24 retype, awaiting deletion.
 */
export const UNLISTED_COLLECTION_HANDLES: ReadonlySet<string> = new Set([
  'frontpage',
  'daily-deal',
  'bonus-deal',
  'vault',
  'for-him',
  'for-her',
  'welcome-eligible',
  'curious15-eligible',
  'shop-products',
  'lube-week-2026',
  'last-chance',
])

export function isUnlistedCollection(handle: string): boolean {
  return UNLISTED_COLLECTION_HANDLES.has(handle)
}

/**
 * Where a collection handle goes once it no longer exists in Shopify. A path
 * is a 301 target; `null` is 410 Gone (junk with no sensible parent).
 *
 * Consulted only when Shopify returns no collection for the handle, so an
 * entry can ship before its collection is deleted: until then the live page
 * keeps rendering. Every target is a final keeper, never another entry here,
 * so no redirect chains (enforced by collection-taxonomy.test.ts).
 */
export const COLLECTION_REDIRECTS: Readonly<Record<string, string | null>> = {
  // Daily deals retired 2026-08-03.
  'frontpage': null,
  'daily-deal': null,
  'bonus-deal': null,

  // Retired gendered shelves (owner decision 2026-10-24); same targets as
  // retired-routes.ts uses for /for-him and /for-her.
  'for-him': '/collections/strokers',
  'for-her': '/collections/vibrators',

  // Empty, thin, or rule-flawed.
  'cbd-supplements': '/collections',
  'all-wellness': '/collections',
  'kits-sets': '/collections',
  'accessories': '/collections',
  'discover': '/collections',
  'rechargeable': '/collections/vibrators',
  'thrusting-rotating': '/collections/thrusting-vibrating',
  'last-chance': '/collections/on-sale',
  'under-30': '/collections/under-25',
  'under-100': '/collections/under-50',
  'bath-body': '/collections/natural-organic',

  // Duplicates merged into one keeper.
  'all-vibrators': '/collections/vibrators',
  'all-dildos': '/collections/dildos',
  'realistic': '/collections/realistic-dildos',
  'vibrating-anal': '/collections/anal',
  'prostate-toys': '/collections/prostate',
  'fetishwear': '/collections/fetish-roleplay',
  'masks': '/collections/fetish-roleplay',
  'body-harnesses': '/collections/fetish-roleplay',
  'silicone': '/collections/body-safe-silicone',
  'penis-pumps': '/collections/pumps-extenders',
  'penis-sleeves': '/collections/pumps-extenders',
  'discover-app-controlled': '/collections/app-controlled',
  'pride': '/collections/discover-lgbtq',
  'cooling': '/collections/warming-lubes',
  'date-night-box': '/collections/discover-date-night',
  'candles': '/collections/massage-mood',
  'apparel': '/collections/wear',
  'all-bondage': '/collections/play',
  'discover-beginner-kits': '/collections/first-time',
  'prowler-red': '/collections/prowler',

  // A misspelled handle that drew traffic and 404s today.
  'hybrid-lubircants': '/collections/hybrid-lubricants',

  // Brands with fewer than 8 products in stock: send shoppers to the shelf
  // their products live on.
  'honey-play-box': '/collections/vibrators',
  'beloved': '/collections/vibrators',
  'thevibed': '/collections/vibrators',
  'fifty-shades-of-grey': '/collections/restraints',
  'fuck-water': '/collections/lubricants',
  'playground': '/collections/lubricants',
  'clone-a-willy': '/collections/dildos',
  'njoy': '/collections/plugs',
  'lifestyles': '/collections/condoms',
  'classic-brands': '/collections/pheromones',
  'the-male-rose': '/collections/strokers',
  'oh-la-la-cheri': '/collections/wear',
  'savage-me': '/collections',
  'twisted-wares': '/collections',
  'bonks': '/collections',
  'rhino': '/collections',
}

export type CollectionRedirect =
  | { kind: 'redirect'; to: string }
  | { kind: 'gone' }
  | null

/** The redirect for a handle Shopify no longer knows, or null to 404 as before. */
export function collectionRedirect(handle: string): CollectionRedirect {
  if (!Object.prototype.hasOwnProperty.call(COLLECTION_REDIRECTS, handle)) return null
  const to = COLLECTION_REDIRECTS[handle] ?? null
  return to === null ? { kind: 'gone' } : { kind: 'redirect', to }
}

/**
 * The .md twin of a redirect target: a collection target keeps its markdown
 * form, while the hub's twin is /collections.md.
 */
export function markdownRedirectTarget(to: string): string {
  return `${to.replace(/\/$/, '')}.md`
}
