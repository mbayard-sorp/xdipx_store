/**
 * Curator-controlled discovery rules for the home page rails.
 *
 * Public API split into two concerns:
 *   1. Async I/O (DB reads/writes, KV cache) — functions that return Promises.
 *   2. Pure rule application (applyRules, fillFallbacks, autoLoosen) — sync,
 *      dependency-free, and trivially testable.
 *
 * The pure functions take their inputs as arguments so they can be imported
 * and exercised directly in unit tests without mocking DB or KV.
 */

import { eq, and, asc } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { discoveryRules, pipelineSettings } from '../../db/schema'
import { kvGet, kvSet, kvDel, cached, invalidateCache } from '~/lib/kv.server'
import { rankSingleRail } from '~/lib/discovery-emma'
import { invalidateDiscoveryIndex } from '~/lib/discovery.server'
import type {
  Category,
  DiscoveryProduct,
  DiscoveryRule,
  DiscoveryRuleType,
  Rail,
} from '~/types/discovery'
import type { ScoredProduct, DiscoveryState } from '~/types/discovery'

// ---------------------------------------------------------------------------
// Cache key + TTL
// ---------------------------------------------------------------------------

const RULES_CACHE_KEY = 'discovery:rules:v1'
const RULES_TTL_SECONDS = 5 * 60 // 5 minutes

// ---------------------------------------------------------------------------
// Async: rule reads
// ---------------------------------------------------------------------------

/** Active rules only, KV-cached for 5 minutes. */
export async function getActiveDiscoveryRules(): Promise<DiscoveryRule[]> {
  const cached = await kvGet<DiscoveryRule[]>(RULES_CACHE_KEY)
  if (cached && Array.isArray(cached)) return cached

  const rows = await db
    .select()
    .from(discoveryRules)
    .where(eq(discoveryRules.active, true))
    .orderBy(asc(discoveryRules.ruleType), asc(discoveryRules.sortOrder), asc(discoveryRules.id))

  const rules = rows.map(rowToRule)
  await kvSet(RULES_CACHE_KEY, rules, RULES_TTL_SECONDS)
  return rules
}

/** All rules (active + inactive), for the admin screen. */
export async function listAllDiscoveryRules(): Promise<DiscoveryRule[]> {
  const rows = await db
    .select()
    .from(discoveryRules)
    .orderBy(asc(discoveryRules.ruleType), asc(discoveryRules.sortOrder), asc(discoveryRules.id))
  return rows.map(rowToRule)
}

// ---------------------------------------------------------------------------
// Async: inventory threshold
// ---------------------------------------------------------------------------

/**
 * Read `pipeline_settings.discovery_inventory_min`.
 * Returns 0 (disabled) if the key is missing or not a valid positive integer.
 */
const INVENTORY_MIN_CACHE_KEY = 'discovery:inventory-min:v1'
const INVENTORY_MIN_CACHE_TTL = 5 * 60 // 5 min — matches rules cache cadence

export async function getInventoryMin(): Promise<number> {
  const cached = await kvGet<number>(INVENTORY_MIN_CACHE_KEY)
  if (typeof cached === 'number') return cached
  const row = await db
    .select({ value: pipelineSettings.value })
    .from(pipelineSettings)
    .where(eq(pipelineSettings.key, 'discovery_inventory_min'))
    .limit(1)
  const parsed = row.length && row[0] ? parseInt(row[0].value, 10) : 0
  const value = Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  await kvSet(INVENTORY_MIN_CACHE_KEY, value, INVENTORY_MIN_CACHE_TTL)
  return value
}

// ---------------------------------------------------------------------------
// Async: cache invalidation
// ---------------------------------------------------------------------------

export async function invalidateDiscoveryRulesCache(): Promise<void> {
  await kvDel(RULES_CACHE_KEY)
  await kvDel(INVENTORY_MIN_CACHE_KEY)
}

// ---------------------------------------------------------------------------
// Async: search taxonomy cache
// ---------------------------------------------------------------------------

import type { TaxonomyGroup } from '~/lib/search-filter-csv'

const SEARCH_TAXONOMY_CACHE_KEY = 'pipeline:searchTaxonomy'
const SEARCH_TAXONOMY_TTL = 300 // 5 minutes

/**
 * Returns the parsed searchFilterTaxonomy pipeline setting, KV-cached for 5 min.
 * Returns null on parse failure or missing row so callers can safely fall back
 * to an empty taxonomy without crashing.
 */
export async function getSearchTaxonomy(): Promise<TaxonomyGroup[] | null> {
  return cached<TaxonomyGroup[] | null>(SEARCH_TAXONOMY_CACHE_KEY, SEARCH_TAXONOMY_TTL, async () => {
    const rows = await db
      .select({ value: pipelineSettings.value })
      .from(pipelineSettings)
      .where(eq(pipelineSettings.key, 'searchFilterTaxonomy'))
      .limit(1)
    if (!rows.length || !rows[0]) return null
    try {
      return JSON.parse(rows[0].value) as TaxonomyGroup[]
    } catch {
      return null
    }
  })
}

/** Call after any write to searchFilterTaxonomy to clear the cached value. */
export function invalidateSearchTaxonomyCache(): void {
  invalidateCache(SEARCH_TAXONOMY_CACHE_KEY)
}

// ---------------------------------------------------------------------------
// Async: CRUD helpers (for the admin route)
// ---------------------------------------------------------------------------

export async function createDiscoveryRule(input: {
  ruleType:  DiscoveryRuleType
  ruleValue: string
  category?: Category | null
  sortOrder?: number
  notes?: string | null
  active?: boolean
}): Promise<DiscoveryRule> {
  const rows = await db
    .insert(discoveryRules)
    .values({
      ruleType:  input.ruleType,
      ruleValue: input.ruleValue,
      category:  input.category ?? null,
      sortOrder: input.sortOrder ?? 0,
      notes:     input.notes ?? null,
      active:    input.active ?? true,
    })
    .returning()
  await bustBothCaches()
  const row = rows[0]
  if (!row) throw new Error('createDiscoveryRule: insert returned no row')
  return rowToRule(row)
}

export async function updateDiscoveryRule(
  id: number,
  patch: Partial<{
    ruleType:  DiscoveryRuleType
    ruleValue: string
    category:  Category | null
    sortOrder: number
    notes:     string | null
    active:    boolean
  }>,
): Promise<DiscoveryRule | null> {
  const rows = await db
    .update(discoveryRules)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(discoveryRules.id, id))
    .returning()
  const row = rows[0]
  if (!row) return null
  await bustBothCaches()
  return rowToRule(row)
}

export async function deleteDiscoveryRule(id: number): Promise<void> {
  await db.delete(discoveryRules).where(eq(discoveryRules.id, id))
  await bustBothCaches()
}

/**
 * Swap sort_order between a pin_fallback rule and its neighbour.
 * No-ops gracefully if the rule isn't a pin_fallback or has no neighbour.
 */
export async function moveFallbackPin(
  id: number,
  direction: 'up' | 'down',
): Promise<void> {
  // Fetch the target row first.
  const [target] = await db
    .select()
    .from(discoveryRules)
    .where(and(eq(discoveryRules.id, id), eq(discoveryRules.ruleType, 'pin_fallback')))
    .limit(1)
  if (!target) return

  // Find the neighbour with the adjacent sort_order in the same category.
  const category = target.category
  const siblingRows = await db
    .select()
    .from(discoveryRules)
    .where(
      category
        ? and(eq(discoveryRules.ruleType, 'pin_fallback'), eq(discoveryRules.category, category))
        : eq(discoveryRules.ruleType, 'pin_fallback'),
    )
    .orderBy(asc(discoveryRules.sortOrder), asc(discoveryRules.id))

  const idx = siblingRows.findIndex(r => r.id === id)
  if (idx === -1) return
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1
  if (swapIdx < 0 || swapIdx >= siblingRows.length) return

  const sibling = siblingRows[swapIdx]
  if (!sibling) return
  const targetOrder = target.sortOrder ?? 0
  const siblingOrder = sibling.sortOrder ?? 0

  await Promise.all([
    db
      .update(discoveryRules)
      .set({ sortOrder: siblingOrder, updatedAt: new Date() })
      .where(eq(discoveryRules.id, id)),
    db
      .update(discoveryRules)
      .set({ sortOrder: targetOrder, updatedAt: new Date() })
      .where(eq(discoveryRules.id, sibling.id)),
  ])

  await bustBothCaches()
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function bustBothCaches(): Promise<void> {
  await Promise.all([
    invalidateDiscoveryRulesCache(),
    invalidateDiscoveryIndex(),
  ])
}

function rowToRule(row: typeof discoveryRules.$inferSelect): DiscoveryRule {
  return {
    id:         row.id,
    ruleType:   row.ruleType as DiscoveryRuleType,
    ruleValue:  row.ruleValue,
    category:   (row.category as Category | null) ?? null,
    sortOrder:  row.sortOrder,
    notes:      row.notes ?? null,
    active:     row.active,
    createdAt:  row.createdAt,
    updatedAt:  row.updatedAt,
  }
}

// ---------------------------------------------------------------------------
// Pure: applyRules
// ---------------------------------------------------------------------------

/**
 * Filter `products` against the active exclusion rules and the global
 * inventory floor. Pure and synchronous — takes all inputs as arguments.
 *
 * Drop logic (product is excluded if ANY of the following match):
 *   - exclude_product:      handle matches rule_value exactly
 *   - exclude_product_type: productType matches rule_value AND
 *                           (rule.category is null OR matches product.category)
 *   - exclude_keyword:      rule_value is a case-insensitive substring of title
 *   - exclude_price_min:    price < numeric(rule_value)
 *   - exclude_price_max:    price > numeric(rule_value)
 *   - inventoryMin > 0 AND totalInventory !== null AND totalInventory < inventoryMin
 *
 * Untracked inventory (totalInventory === null) always passes the floor filter.
 */
export function applyRules(
  products: DiscoveryProduct[],
  rules: DiscoveryRule[],
  inventoryMin: number,
): DiscoveryProduct[] {
  if (rules.length === 0 && inventoryMin === 0) return products

  // Pre-index rules by type for O(1) lookups within the product loop.
  const excludeHandles = new Set<string>()
  const excludeTypes: Array<{ value: string; category: Category | null }> = []
  const excludeKeywords: string[] = []
  const priceFloors: number[] = []
  const priceCeilings: number[] = []

  for (const rule of rules) {
    switch (rule.ruleType) {
      case 'exclude_product':
        excludeHandles.add(rule.ruleValue)
        break
      case 'exclude_product_type':
        // Match Shopify's native "Product organization → Type" field
        // case-insensitive after trim, so a "Discontinued" rule catches
        // products typed " discontinued " in admin without curator pain.
        excludeTypes.push({ value: rule.ruleValue.trim().toLowerCase(), category: rule.category })
        break
      case 'exclude_keyword':
        excludeKeywords.push(rule.ruleValue.toLowerCase())
        break
      case 'exclude_price_min': {
        const n = parseFloat(rule.ruleValue)
        if (Number.isFinite(n)) priceFloors.push(n)
        break
      }
      case 'exclude_price_max': {
        const n = parseFloat(rule.ruleValue)
        if (Number.isFinite(n)) priceCeilings.push(n)
        break
      }
      // pin_fallback rules are not exclusions; handled by fillFallbacks.
    }
  }

  return products.filter(p => {
    // --- handle exclusion ---
    if (excludeHandles.has(p.handle)) return false

    // --- product type exclusion ---
    if (p.productType) {
      const productTypeLc = p.productType.trim().toLowerCase()
      for (const et of excludeTypes) {
        if (
          et.value === productTypeLc &&
          (et.category === null || et.category === p.category)
        ) {
          return false
        }
      }
    }

    // --- keyword exclusion ---
    const lowerTitle = p.title.toLowerCase()
    for (const kw of excludeKeywords) {
      if (lowerTitle.includes(kw)) return false
    }

    // --- price floor: drop products priced BELOW the min ---
    for (const floor of priceFloors) {
      if (p.price < floor) return false
    }

    // --- price ceiling: drop products priced ABOVE the max ---
    for (const ceiling of priceCeilings) {
      if (p.price > ceiling) return false
    }

    // --- inventory floor (only when Shopify is tracking stock for this product) ---
    if (inventoryMin > 0 && p.totalInventory !== null && p.totalInventory < inventoryMin) {
      return false
    }

    return true
  })
}

// ---------------------------------------------------------------------------
// Pure: fillFallbacks
// ---------------------------------------------------------------------------

/**
 * Top up a sparse rail with curator-pinned products.
 *
 * - Pulls `pin_fallback` rules for `rail.category`, ordered by sort_order.
 * - Each pinned handle is looked up in `filteredIndex` (so pins respect
 *   the active exclusion rules and the budget filter from rankRails).
 * - Skips handles already present in `rail.items` or in `alreadyIncludedIds`.
 * - Appends up to `perRail - rail.items.length` pinned ScoredProducts (score=0).
 * - Returns a new Rail object; the caller replaces its rail with the result.
 */
export function fillFallbacks(
  rail: Rail,
  rules: DiscoveryRule[],
  filteredIndex: DiscoveryProduct[],
  perRail: number,
  alreadyIncludedIds: Set<string> = new Set(),
  /**
   * Resolved collection-pin product IDs per category. Built by
   * `resolveCollectionPins` before calling this function so the pure
   * fillFallbacks helper stays sync. Optional — when absent, only
   * pin_fallback handle rules contribute.
   */
  collectionPinIds: Partial<Record<Category, string[]>> = {},
  /**
   * Honorary-membership products: collection-pin IDs that weren't in the
   * discovery index were fetched separately and forced into the rule's
   * category. Looked up by id after filteredIndex misses, so they're
   * available to fillFallbacks without polluting ranking or chip
   * availability computations upstream.
   */
  honoraryProductsByCategory: Partial<Record<Category, DiscoveryProduct[]>> = {},
): Rail {
  const slots = perRail - rail.items.length
  if (slots <= 0) return rail

  // Build handle-to-product and id-to-product lookups from the filtered
  // catalog so collection pins can match by id (Shopify GID) and individual
  // pins can match by handle. Honorary members for this rail's category are
  // merged into byId so collection-pin lookups find them too.
  const byHandle = new Map<string, DiscoveryProduct>()
  const byId     = new Map<string, DiscoveryProduct>()
  for (const p of filteredIndex) {
    byHandle.set(p.handle, p)
    byId.set(p.id, p)
  }
  for (const p of honoraryProductsByCategory[rail.category] ?? []) {
    if (!byId.has(p.id)) byId.set(p.id, p)
  }

  // Handles already in the rail.
  const inRail = new Set(rail.items.map(sp => sp.product.handle))
  const inRailIds = new Set(rail.items.map(sp => sp.product.id))

  // Tier 1: individual product-handle pins (sort_order asc).
  const pins = rules
    .filter(r => r.ruleType === 'pin_fallback' && r.category === rail.category)
    .sort((a, b) => a.sortOrder - b.sortOrder)

  const extras: ScoredProduct[] = []
  const usedIds = new Set<string>()
  for (const pin of pins) {
    if (extras.length >= slots) break
    const product = byHandle.get(pin.ruleValue)
    if (!product) continue // excluded or not in the catalog
    if (inRail.has(product.handle)) continue
    if (alreadyIncludedIds.has(product.id)) continue
    if (usedIds.has(product.id)) continue
    extras.push({ product, score: 0 })
    usedIds.add(product.id)
  }

  // Tier 2: collection-pin product IDs. Only consulted after tier 1 is
  // exhausted. Iterates in resolver-supplied order (rule sort_order, then
  // collection order). Each product must also belong to the rail's category
  // (collection authors may include cross-category SKUs we want to skip).
  const collectionIds = collectionPinIds[rail.category] ?? []
  for (const id of collectionIds) {
    if (extras.length >= slots) break
    const product = byId.get(id)
    if (!product) continue // excluded or not in the discovery index
    if (product.category !== rail.category) continue
    if (inRailIds.has(product.id)) continue
    if (alreadyIncludedIds.has(product.id)) continue
    if (usedIds.has(product.id)) continue
    extras.push({ product, score: 0 })
    usedIds.add(product.id)
  }

  if (extras.length === 0) return rail

  return {
    ...rail,
    items: [...rail.items, ...extras],
    total: rail.total + extras.length,
  }
}

// ---------------------------------------------------------------------------
// Async: resolveCollectionPins
// ---------------------------------------------------------------------------

/**
 * Curator inputs may include full URLs, leading `/collections/`, trailing
 * paths, or facet query strings ("lubricants?matters=beginner-friendly").
 * Reduce any of those to the bare Shopify collection handle.
 *
 *   "lubricants"                                       → "lubricants"
 *   "lubricants?matters=foo"                           → "lubricants"
 *   "/collections/lubricants"                          → "lubricants"
 *   "https://xdipx.com/collections/lubricants/foo"     → "lubricants"
 *   ""                                                 → ""
 */
export function cleanCollectionHandle(input: string): string {
  if (!input) return ''
  let s = input.trim().toLowerCase()
  // Strip protocol + host if a full URL was pasted.
  const protoMatch = s.match(/^https?:\/\/[^/]+(.*)$/)
  if (protoMatch && protoMatch[1] !== undefined) s = protoMatch[1]
  // Strip leading "/collections/" and any leading slashes.
  s = s.replace(/^\/+collections\/+/, '').replace(/^\/+/, '')
  // Take everything before the first `?`, `#`, or `/`.
  const stop = s.search(/[?#/]/)
  if (stop !== -1) s = s.slice(0, stop)
  return s
}

/**
 * Resolve every `pin_collection_fallback` rule into a per-category list of
 * product IDs by calling the collection→IDs fetcher (KV-cached). Returns
 * `{ Pleasure: [id, id, ...], Play: [...], ... }` ready to hand to
 * `fillFallbacks`.
 *
 * Resolution order within a category preserves rule `sort_order` (asc), then
 * the collection's native product order. Duplicate IDs across rules in the
 * same category are collapsed; the first appearance wins.
 *
 * Dirty handles in the DB (e.g. legacy rows with a query string) are
 * normalized via `cleanCollectionHandle` before being sent to the fetcher,
 * so existing rows keep working without a manual rewrite.
 *
 * The fetcher is injected so tests can mock it without touching Shopify.
 */
export async function resolveCollectionPins(
  rules: DiscoveryRule[],
  fetcher: (handle: string) => Promise<string[]>,
): Promise<Partial<Record<Category, string[]>>> {
  const collectionPins = rules
    .filter(r => r.ruleType === 'pin_collection_fallback' && r.category !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder)

  if (collectionPins.length === 0) return {}

  // Cache identical handles across rules (a curator could legitimately pin
  // the same collection to multiple categories, and we don't want N fetches).
  const handleCache = new Map<string, string[]>()
  const result: Partial<Record<Category, string[]>> = {}

  for (const pin of collectionPins) {
    const handle = cleanCollectionHandle(pin.ruleValue)
    if (!handle || !pin.category) continue
    let ids = handleCache.get(handle)
    if (!ids) {
      ids = await fetcher(handle)
      handleCache.set(handle, ids)
    }
    const seen = new Set(result[pin.category] ?? [])
    const merged = result[pin.category] ?? []
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      merged.push(id)
    }
    result[pin.category] = merged
  }

  return result
}

// ---------------------------------------------------------------------------
// Pure: autoLoosen
// ---------------------------------------------------------------------------

/**
 * When a rail is empty after fallback filling, try progressively relaxing the
 * user's brief to find *something* to show.
 *
 * Loosening order (per plan): matters → audience → mood.
 * Budget is never dropped.
 *
 * Returns `{ items, reason }` on the first state that yields items, or null
 * if even the most-relaxed state has zero matching products in this category.
 */
export function autoLoosen(
  category: Category,
  state: DiscoveryState,
  filteredIndex: DiscoveryProduct[],
  perRail: number,
): { items: ScoredProduct[]; reason: string } | null {
  // Try dropping matters first.
  const withoutMatters: DiscoveryState = { ...state, matters: [] }
  const r1 = rankSingleRail(filteredIndex, withoutMatters, category, 0, perRail)
  if (r1.items.length > 0) {
    return { items: r1.items, reason: `Loosened your brief — showing all of ${category}.` }
  }

  // Then drop audience too.
  const withoutAudience: DiscoveryState = { ...withoutMatters, audience: [] }
  const r2 = rankSingleRail(filteredIndex, withoutAudience, category, 0, perRail)
  if (r2.items.length > 0) {
    return { items: r2.items, reason: `Loosened your brief — showing all of ${category}.` }
  }

  // Finally drop mood too (only budget remains).
  const withoutMood: DiscoveryState = { ...withoutAudience, mood: [] }
  const r3 = rankSingleRail(filteredIndex, withoutMood, category, 0, perRail)
  if (r3.items.length > 0) {
    return { items: r3.items, reason: `Loosened your brief — showing all of ${category}.` }
  }

  return null
}
