/**
 * Pure catalog-family grouping logic for scripts/catalog-grouping.ts (ticket #12683).
 *
 * A "family" is 2+ active products from the same vendor whose titles differ
 * only by a trailing size/color/flavor/scent token -- split-option products
 * that should present as one Shop card instead of competing separate cards.
 * No Shopify or network access here; all functions are pure so they run in
 * the test suite with fixture data.
 *
 * Deliberately conservative: a family only ships when every member has a
 * distinct, derivable option. Anything else (an exact-duplicate title, a
 * title with no removable size/flavor/color suffix, or two members that
 * would derive the same option) is reported as a collision instead, never
 * auto-grouped -- see groupProducts' doc comment.
 */

const SIZE_UNIT_RE =
  /\s*[-,(]?\s*(\d+(?:\.\d+)?(?:\/\d+)?)\s?(oz|ml|in|inch|inches|cm|lb|g)\)?\s*$/i

/**
 * Starting seed list of flavor/color/scent option words seen in the catalog
 * (Screaming O, Swiss Navy and similar split-variant SKUs). Extend as new
 * families are found; under-matching only costs a missed grouping (reported,
 * never wrongly grouped), never a false positive.
 */
const KNOWN_OPTION_WORDS = [
  // flavors
  'strawberry', 'blueberry', 'grape', 'watermelon', 'cherry', 'chocolate',
  'vanilla', 'mint', 'mango', 'raspberry', 'peach', 'pina colada', 'bubblegum',
  'cotton candy', 'green apple', 'tropical', 'unflavored',
  // colors
  'black', 'pink', 'purple', 'blue', 'red', 'white', 'teal', 'clear', 'green',
  'orange', 'yellow', 'rose gold', 'gold', 'silver', 'grey', 'gray', 'coral',
  'lavender', 'turquoise', 'magenta', 'nude',
  // scents
  'unscented',
]

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const OPTION_WORD_RE = new RegExp(
  `\\s*[-,(]?\\s*(${KNOWN_OPTION_WORDS.map(escapeRegExp).join('|')})\\)?\\s*$`,
  'i',
)

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, t => (t[0] ?? '').toUpperCase() + t.slice(1).toLowerCase())
}

export interface StrippedTitle {
  base: string
  option: string | null
}

/**
 * Strips a trailing size or color/flavor/scent token off a product title.
 * Tries the size-unit pattern first (numeric + unit is unambiguous), then
 * the curated option-word list. No match: `option` is null and `base` is
 * the title unchanged -- a product with no derivable option can never be
 * grouped with a sibling (see groupProducts).
 */
export function stripOptionToken(title: string): StrippedTitle {
  const trimmed = title.trim()

  const sizeMatch = trimmed.match(SIZE_UNIT_RE)
  if (sizeMatch && typeof sizeMatch.index === 'number') {
    const base = trimmed.slice(0, sizeMatch.index).trim().replace(/[-,]\s*$/, '').trim()
    const option = `${sizeMatch[1]} ${sizeMatch[2]!.toLowerCase()}`
    return { base, option }
  }

  const wordMatch = trimmed.match(OPTION_WORD_RE)
  if (wordMatch && typeof wordMatch.index === 'number') {
    const base = trimmed.slice(0, wordMatch.index).trim().replace(/[-,]\s*$/, '').trim()
    const option = titleCase(wordMatch[1]!)
    return { base, option }
  }

  return { base: trimmed, option: null }
}

export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * The family key a product groups under: vendor + the title with its
 * trailing option token stripped. Two products only ever share a key when
 * they share a vendor and an (otherwise identical) base title, so products
 * from different vendors never group regardless of title similarity.
 */
export function familyKey(vendor: string, title: string): string {
  const { base } = stripOptionToken(title)
  return `${slugify(vendor)}|${slugify(base)}`
}

export interface GroupableProduct {
  handle: string
  vendor: string
  title: string
}

export interface CatalogFamily {
  key: string
  members: Array<{ handle: string; title: string; option: string }>
}

export type CollisionReason = 'duplicate-title' | 'missing-option' | 'option-collision'

export interface CatalogCollision {
  key: string
  reason: CollisionReason
  members: Array<{ handle: string; title: string }>
}

export interface GroupingResult {
  families: CatalogFamily[]
  collisions: CatalogCollision[]
}

/**
 * Groups products into families by vendor + stripped base title. A
 * candidate family of 2+ members ships as a family only when every member
 * has a distinct, non-null derived option. Three ways a candidate is
 * refused and reported as a collision instead:
 *
 *   - two members share the exact same title text (an exact duplicate --
 *     most likely a catalog data error, never a legitimate split variant)
 *   - any member has no removable size/color/flavor/scent suffix, so no
 *     option can be derived for it
 *   - two members, despite differing title text, derive the same option
 *     value (e.g. two different spellings resolving to "Strawberry")
 *
 * None of these auto-group. They are returned in `collisions` for a human
 * to resolve.
 */
export function groupProducts(products: readonly GroupableProduct[]): GroupingResult {
  const byKey = new Map<string, GroupableProduct[]>()
  for (const p of products) {
    const key = familyKey(p.vendor, p.title)
    const list = byKey.get(key) ?? []
    list.push(p)
    byKey.set(key, list)
  }

  const families: CatalogFamily[] = []
  const collisions: CatalogCollision[] = []

  for (const [key, members] of byKey) {
    if (members.length < 2) continue
    const asRows = (): Array<{ handle: string; title: string }> =>
      members.map(m => ({ handle: m.handle, title: m.title }))

    const titlesSeen = new Set<string>()
    const hasDuplicateTitle = members.some(m => {
      const t = m.title.trim().toLowerCase()
      if (titlesSeen.has(t)) return true
      titlesSeen.add(t)
      return false
    })
    if (hasDuplicateTitle) {
      collisions.push({ key, reason: 'duplicate-title', members: asRows() })
      continue
    }

    const stripped = members.map(m => ({ ...m, option: stripOptionToken(m.title).option }))
    if (stripped.some(m => m.option === null)) {
      collisions.push({ key, reason: 'missing-option', members: asRows() })
      continue
    }

    const optionsSeen = new Set<string>()
    const hasOptionCollision = stripped.some(m => {
      const o = m.option!.toLowerCase()
      if (optionsSeen.has(o)) return true
      optionsSeen.add(o)
      return false
    })
    if (hasOptionCollision) {
      collisions.push({ key, reason: 'option-collision', members: asRows() })
      continue
    }

    families.push({
      key,
      members: stripped.map(m => ({ handle: m.handle, title: m.title, option: m.option! })),
    })
  }

  return { families, collisions }
}
