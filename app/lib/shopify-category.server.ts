/**
 * Shopify Standard Product Taxonomy category + category attribute metafields.
 *
 * Sets a product's taxonomy category and fills the category's attribute
 * metafields (namespace `shopify`, type `list.metaobject_reference`) so a new
 * import never lands uncategorized. Semantics are ported from the one-off
 * catalog sweep that was tested live:
 *
 *  - Category: `productUpdate(product: { id, category: <TaxonomyCategory gid> })`.
 *  - Attributes: one metafield per attribute, key = slug of the attribute name.
 *    Values are metaobjects of type `shopify--<key>` carrying `label` and
 *    `taxonomy_reference`. Color and Pattern share ONE metafield (`color-pattern`)
 *    whose metaobjects carry `label`, optional `color` hex,
 *    `color_taxonomy_reference` (JSON list) and `pattern_taxonomy_reference`.
 *  - A missing metafield definition is enabled with
 *    `standardMetafieldDefinitionEnable`.
 *  - Fill gaps only: an existing `shopify.*` metafield is never overwritten and an
 *    existing category is never changed unless the caller opts in. Requested
 *    values are validated against the category's allowed values; unknown
 *    attribute or value names are dropped, not written.
 *
 * Shopify-owned `shopify.*` definitions carry a category constraint list we cannot
 * edit, and one out-of-list entry fails the whole metafieldsSet call atomically.
 * Rejections that name an entry index are dropped and the rest is retried.
 *
 * Material is not a Shopify attribute on the toy category, so it lives in the
 * store-owned `xdipx.material` list metafield (see applyMaterial).
 *
 * Works on the pinned Admin API version (2024-10); verified read-only that the
 * taxonomy attribute queries and ProductUpdateInput.category exist there.
 *
 * Never throws into the caller's publish path: applyShopifyCategory returns a
 * result object describing what was set, kept and dropped, and why.
 */
import { adminGraphQL } from '~/lib/shopify.server'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ShopifyCategoryInput {
  /** Bare taxonomy id as printed in the playbook (`ma-1-4`), or a full gid. */
  id:         string
  /** Attribute name to allowed value names, e.g. { Color: ['Black'] }. */
  attributes?: Record<string, string[]>
}

export interface TaxonomyValue { id: string; name: string }

export interface AllowedAttribute {
  id:     string
  name:   string
  values: TaxonomyValue[]
}

export interface TaxonomyCategoryInfo {
  id:         string
  fullName:   string
  isLeaf:     boolean
  attributes: AllowedAttribute[]
}

export interface MetaobjectEntry {
  handle: string
  fields: Array<{ key: string; value: string }>
}

export interface AttributeWritePlan {
  /** Entries for the shared `color-pattern` metafield, or null when nothing to write. */
  colorPattern: MetaobjectEntry[] | null
  /** One plan per ordinary attribute, in request order. */
  simple:       Array<{ key: string; entries: MetaobjectEntry[] }>
  dropped:      string[]
}

export interface ApplyCategoryResult {
  ok:            boolean
  /** Category id written, or null when nothing was written. */
  categorySet:   string | null
  /** Existing category id left in place, when one differed from the request. */
  categoryKept:  string | null
  metafieldsSet: string[]
  dropped:       string[]
  errors:        string[]
}

export interface ApplyMaterialResult {
  ok:      boolean
  written: string[]
  /** Why nothing was written, when that was not an error. */
  skipped: string | null
  errors:  string[]
}

export interface MutationUserError { field?: string[] | null; message: string }

// ─── Pure helpers (unit tested) ──────────────────────────────────────────────

/**
 * Category ids the owner approved even though they are not taxonomy leaves
 * (2026-09-30): the taxonomy has no leaf for toy cleaners or supplements, so both
 * go under Health & Beauty > Personal Care (`hb-3`).
 */
export const OWNER_APPROVED_NON_LEAF_IDS: readonly string[] = ['hb-3']

/** Vocabulary of the `xdipx.material` metafield's `choices` validation, exact spelling. */
export const MATERIAL_VOCAB: readonly string[] = [
  'Silicone', 'TPE', 'TPR', 'ABS Plastic', 'PVC', 'Vinyl', 'Stainless Steel', 'Aluminum',
  'Glass', 'Faux Leather', 'Leather', 'Latex', 'Rubber', 'Neoprene', 'Nylon', 'Polyester',
  'Spandex', 'Cotton', 'Satin', 'Silk', 'Velvet', 'Faux Fur', 'Feather', 'Wood', 'Crystal',
  'Ceramic', 'Stone', 'Polyurethane', 'Acrylic', 'Polycarbonate', 'Steel', 'Metal', 'Plastic',
  'Elastomer', 'Paper',
]

const MATERIAL_ALIASES: Readonly<Record<string, string>> = {
  'abs':                      'ABS Plastic',
  'abs plastic':              'ABS Plastic',
  'thermoplastic elastomer':  'TPE',
  'thermoplastic rubber':     'TPR',
  'stainless':                'Stainless Steel',
  'vegan leather':            'Faux Leather',
  'pu leather':               'Faux Leather',
  'leatherette':              'Faux Leather',
  'borosilicate glass':       'Glass',
  'aluminium':                'Aluminum',
}

/**
 * Map free-form material names onto MATERIAL_VOCAB (case-insensitive, with a few
 * aliases). De-duplicates, keeps first-seen order, drops anything outside the
 * vocabulary. Non-array input yields an empty list, a lone string counts as one.
 */
export function normalizeMaterials(input: unknown): string[] {
  const list = Array.isArray(input) ? input : typeof input === 'string' ? [input] : []
  const byLower = new Map(MATERIAL_VOCAB.map(m => [m.toLowerCase(), m]))
  const out: string[] = []
  for (const raw of list) {
    if (typeof raw !== 'string') continue
    const k = raw.trim().replace(/\s+/g, ' ').toLowerCase()
    const hit = MATERIAL_ALIASES[k] ?? byLower.get(k)
    if (hit && !out.includes(hit)) out.push(hit)
  }
  return out
}

/**
 * Split metafieldsSet userErrors into those that point at a specific entry
 * (`field` = ['metafields', '<index>', ...], index inside `count`) and those
 * that do not. Indexed rejections are de-duplicated by index, first message wins.
 */
export function parseMetafieldUserErrors(
  errors: readonly MutationUserError[],
  count: number,
): { rejected: Array<{ index: number; message: string }>; unindexed: MutationUserError[] } {
  const byIndex = new Map<number, string>()
  const unindexed: MutationUserError[] = []
  for (const e of errors) {
    const f = e.field
    const idx = Array.isArray(f) && f[0] === 'metafields' && f.length > 1 && /^\d+$/.test(String(f[1]))
      ? Number(f[1])
      : -1
    if (idx >= 0 && idx < count) { if (!byIndex.has(idx)) byIndex.set(idx, e.message) }
    else unindexed.push(e)
  }
  const rejected = [...byIndex].map(([index, message]) => ({ index, message })).sort((a, b) => a.index - b.index)
  return { rejected, unindexed }
}

/** Representative hex for the plain Shopify color values, written on solid color entries. */
export const COLOR_HEX: Readonly<Record<string, string>> = {
  'Beige': '#F5F5DC', 'Black': '#000000', 'Blue': '#005BD3', 'Bronze': '#CD7F32',
  'Brown': '#8B4513', 'Clear': '#FFFFFF', 'Gold': '#FFD700', 'Gray': '#808080',
  'Green': '#05AA3D', 'Navy': '#282099', 'Orange': '#FF8A00', 'Pink': '#FFC0CB',
  'Purple': '#A54DCF', 'Red': '#F61F1F', 'Rose gold': '#B76E79', 'Silver': '#C0C0C0',
  'White': '#FFFFFF', 'Yellow': '#FFE500',
}

const CATEGORY_GID_PREFIX = 'gid://shopify/TaxonomyCategory/'
const VALUE_GID_PREFIX    = 'gid://shopify/TaxonomyValue/'

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** Accepts `ma-1-4` or a TaxonomyCategory gid; returns the bare id, or null when empty. */
export function normalizeCategoryId(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim()
  if (!t) return null
  const bare = t.startsWith(CATEGORY_GID_PREFIX) ? t.slice(CATEGORY_GID_PREFIX.length) : t
  return /^[a-z]{1,3}(-\d+)*$/.test(bare) ? bare : null
}

/** Allowed values by attribute name for a category. */
export function allowedByName(cat: Pick<TaxonomyCategoryInfo, 'attributes'>): Record<string, AllowedAttribute> {
  const out: Record<string, AllowedAttribute> = {}
  for (const a of cat.attributes) out[a.name] = a
  return out
}

/**
 * Validate requested value names against one attribute's allowed values
 * (case-insensitive). Returns the matching allowed values in request order,
 * de-duplicated, plus the names that were not allowed.
 */
export function matchAllowedValues(
  allowed: AllowedAttribute,
  requested: readonly string[],
): { ok: TaxonomyValue[]; rejected: string[] } {
  const byName = new Map(allowed.values.map(v => [v.name.toLowerCase(), v]))
  const ok: TaxonomyValue[] = []
  const rejected: string[] = []
  for (const x of requested) {
    const v = byName.get(String(x).toLowerCase())
    if (!v) rejected.push(String(x))
    else if (!ok.includes(v)) ok.push(v)
  }
  return { ok, rejected }
}

/**
 * Shape the `shopify--color-pattern` metaobjects for a set of colors and one
 * pattern. Solid (or no pattern) entries are named for the color and carry a hex
 * when we have one; a printed pattern names the entry `<Color> <pattern>`, or just
 * the pattern when the color is Multicolor.
 */
export function buildColorPatternEntries(
  colors: readonly TaxonomyValue[],
  pattern: TaxonomyValue | null,
): MetaobjectEntry[] {
  const isSolid = pattern == null || pattern.name === 'Solid'
  return colors.map(c => {
    const multi = c.name === 'Multicolor'
    const handle = isSolid ? slugify(c.name) : multi ? slugify(pattern.name) : slugify(`${c.name} ${pattern.name}`)
    const label  = isSolid ? c.name : multi ? pattern.name : `${c.name} ${pattern.name.toLowerCase()}`
    const fields = [
      { key: 'label', value: label },
      { key: 'color_taxonomy_reference', value: JSON.stringify([VALUE_GID_PREFIX + c.id]) },
    ]
    if (pattern) fields.push({ key: 'pattern_taxonomy_reference', value: VALUE_GID_PREFIX + pattern.id })
    const hex = COLOR_HEX[c.name]
    if (isSolid && hex) fields.push({ key: 'color', value: hex })
    return { handle, fields }
  })
}

/**
 * Decide which attribute metafields to write. Pure: no I/O, no ids resolved.
 * Gaps only: any key already present in `existingKeys` is skipped. Unknown
 * attributes and values are dropped with a reason.
 */
export function planAttributeWrites(
  allowed: Record<string, AllowedAttribute>,
  requested: Record<string, readonly string[]>,
  existingKeys: ReadonlySet<string>,
  categoryId: string,
): AttributeWritePlan {
  const dropped: string[] = []
  const A: Record<string, readonly string[]> = {}
  for (const [k, v] of Object.entries(requested)) if (Array.isArray(v) && v.length) A[k] = v

  const vals = (name: string): TaxonomyValue[] => {
    const attr = allowed[name]
    if (!attr) {
      if (name in A) dropped.push(`attribute ${name} not on category ${categoryId}`)
      return []
    }
    const { ok, rejected } = matchAllowedValues(attr, A[name] ?? [])
    for (const r of rejected) dropped.push(`value ${JSON.stringify(r)} not allowed for ${name}`)
    return ok
  }

  let colorPattern: MetaobjectEntry[] | null = null
  let colors = vals('Color')
  const pats = vals('Pattern')
  if ((colors.length || pats.length) && !existingKeys.has('color-pattern')) {
    const solid = allowed['Pattern']?.values.find(v => v.name === 'Solid') ?? null
    const pattern = pats[0] ?? solid
    const multi = allowed['Color']?.values.find(v => v.name === 'Multicolor')
    if (!colors.length && multi) colors = [multi]
    const entries = buildColorPatternEntries(colors, pattern)
    if (entries.length) colorPattern = entries
  }

  const simple: AttributeWritePlan['simple'] = []
  for (const name of Object.keys(A)) {
    if (name === 'Color' || name === 'Pattern') continue
    const key = slugify(name)
    if (existingKeys.has(key)) continue
    const vs = vals(name)
    if (!vs.length) continue
    simple.push({
      key,
      entries: vs.map(v => ({
        handle: slugify(v.name),
        fields: [
          { key: 'label', value: v.name },
          { key: 'taxonomy_reference', value: VALUE_GID_PREFIX + v.id },
        ],
      })),
    })
  }
  return { colorPattern, simple, dropped }
}

/**
 * Pick the category to set: the requested one when the product has none,
 * otherwise keep the existing unless the caller allows a change.
 */
export function resolveCategoryToSet(
  existing: string | null,
  requested: string,
  allowChange: boolean,
): { effective: string; set: string | null; kept: string | null } {
  if (!existing) return { effective: requested, set: requested, kept: null }
  if (existing === requested) return { effective: requested, set: null, kept: null }
  if (allowChange) return { effective: requested, set: requested, kept: null }
  return { effective: existing, set: null, kept: existing }
}

// Deterministic default category, used when the enricher payload carries none.
// Only unambiguous types are mapped; anything that needs judgment (massage
// candles vs oils, perfumes, apparel, enhancers) has no default on purpose.
const DEFAULT_BY_PRODUCT_TYPE: Readonly<Record<string, string>> = {
  'lubricant':    'hb-3-13',
  'condom':       'hb-1-5',
  'massage oil':  'hb-3-11-4',
  'erotic books': 'ma-1-6',
  'adult game':   'ma-1-4',
  // Owner decision 2026-09-30: no taxonomy leaf exists, so these use the Personal Care parent.
  'toy cleaner':      'hb-3',
  'supplement / pill': 'hb-3',
}

const DEFAULT_BY_DIAL: Readonly<Record<string, string>> = {
  'vibrator':    'ma-1-4',
  'dildo':       'ma-1-4',
  'anal':        'ma-1-4',
  'bondage':     'ma-1-4',
  'cock-ring':   'ma-1-4',
  'stroker':     'ma-1-4',
  'couples':     'ma-1-4',
  'harness':     'ma-1-4',
  'extender':    'ma-1-4',
  'pump':        'ma-1-4',
  'sex-machine': 'ma-1-4',
  'lube':        'hb-3-13',
  'condom':      'hb-1-5',
  'book-media':  'ma-1-6',
}

/**
 * Default category id for a product whose enrichment payload had none. The
 * Shopify product type wins when it names an unambiguous type; otherwise the
 * classified productTypeDial decides. Null when the type needs judgment.
 */
export function defaultCategoryId(
  productType: string | null | undefined,
  productTypeDial: string | null | undefined,
  productSubtypeDial?: string | null,
): string | null {
  const byType = DEFAULT_BY_PRODUCT_TYPE[(productType ?? '').trim().toLowerCase()]
  if (byType) return byType
  const dial = (productTypeDial ?? '').trim()
  if (dial === 'novelty') return productSubtypeDial === 'game' ? 'ma-1-4' : null
  return DEFAULT_BY_DIAL[dial] ?? null
}

// ─── In-memory caches (per server process) ───────────────────────────────────

const categoryCache  = new Map<string, TaxonomyCategoryInfo | null>()
const metaobjectIds  = new Map<string, string>()
let   definitionKeys: Set<string> | null = null
const badDefinitions = new Set<string>()

/** Test hook: reset every module cache. */
export function _resetShopifyCategoryCaches(): void {
  categoryCache.clear()
  metaobjectIds.clear()
  badDefinitions.clear()
  definitionKeys = null
}

// ─── Taxonomy lookup ─────────────────────────────────────────────────────────

const tail = (gid: string): string => gid.split('/').pop() ?? gid

async function fetchCategory(id: string): Promise<TaxonomyCategoryInfo | null> {
  if (categoryCache.has(id)) return categoryCache.get(id) ?? null
  const gid = CATEGORY_GID_PREFIX + id
  const attrs: Array<{ id: string; name: string }> = []
  let fullName = ''
  let isLeaf = false
  let cursor: string | null = null
  for (;;) {
    const d: {
      node: {
        fullName: string
        isLeaf: boolean
        attributes: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null }
          nodes: Array<{ __typename: string; id?: string; name?: string }>
        }
      } | null
    } = await adminGraphQL(
      `query($id: ID!, $a: String) { node(id: $id) { ... on TaxonomyCategory { fullName isLeaf attributes(first: 50, after: $a) { pageInfo { hasNextPage endCursor } nodes { __typename ... on TaxonomyChoiceListAttribute { id name } } } } } }`,
      { id: gid, a: cursor },
    )
    if (!d.node) { categoryCache.set(id, null); return null }
    fullName = d.node.fullName
    isLeaf = d.node.isLeaf
    for (const a of d.node.attributes.nodes) {
      if (a.__typename === 'TaxonomyChoiceListAttribute' && a.id && a.name) attrs.push({ id: tail(a.id), name: a.name })
    }
    if (!d.node.attributes.pageInfo.hasNextPage) break
    cursor = d.node.attributes.pageInfo.endCursor
  }
  const attributes: AllowedAttribute[] = []
  for (const a of attrs) attributes.push({ ...a, values: await fetchAttributeValues(gid, a.id) })
  const info: TaxonomyCategoryInfo = { id, fullName, isLeaf, attributes }
  categoryCache.set(id, info)
  return info
}

async function fetchAttributeValues(categoryGid: string, attrId: string): Promise<TaxonomyValue[]> {
  const out: TaxonomyValue[] = []
  let cursor: string | null = null
  for (;;) {
    const d: {
      node: { attributes: { nodes: Array<{
        id?: string
        values?: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Array<{ id: string; name: string }> }
      }> } } | null
    } = await adminGraphQL(
      `query($id: ID!, $a: String) { node(id: $id) { ... on TaxonomyCategory { attributes(first: 50) { nodes { ... on TaxonomyChoiceListAttribute { id values(first: 250, after: $a) { pageInfo { hasNextPage endCursor } nodes { id name } } } } } } } }`,
      { id: categoryGid, a: cursor },
    )
    const node = d.node?.attributes.nodes.find(n => n.id && tail(n.id) === attrId)
    if (!node?.values) break
    for (const v of node.values.nodes) out.push({ id: tail(v.id), name: v.name })
    if (!node.values.pageInfo.hasNextPage) break
    cursor = node.values.pageInfo.endCursor
  }
  return out
}

// ─── Definitions + metaobjects ───────────────────────────────────────────────

async function ensureDefinition(key: string, errors: string[]): Promise<boolean> {
  if (!definitionKeys) {
    const d = await adminGraphQL<{ metafieldDefinitions: { nodes: Array<{ key: string }> } }>(
      `{ metafieldDefinitions(first: 250, ownerType: PRODUCT, namespace: "shopify") { nodes { key } } }`,
    )
    definitionKeys = new Set(d.metafieldDefinitions.nodes.map(n => n.key))
  }
  if (definitionKeys.has(key)) return true
  if (badDefinitions.has(key)) return false
  const d = await adminGraphQL<{ standardMetafieldDefinitionEnable: {
    createdDefinition: { key: string } | null
    userErrors: Array<{ message: string }>
  } | null }>(
    `mutation($k: String!) { standardMetafieldDefinitionEnable(ownerType: PRODUCT, namespace: "shopify", key: $k) { createdDefinition { id key } userErrors { field message code } } }`,
    { k: key },
  )
  const r = d.standardMetafieldDefinitionEnable
  if (r?.createdDefinition) { definitionKeys.add(key); return true }
  badDefinitions.add(key)
  errors.push(`enable definition shopify.${key}: ${r?.userErrors.map(e => e.message).join('; ') || 'no definition created'}`)
  return false
}

async function ensureMetaobject(type: string, entry: MetaobjectEntry, errors: string[]): Promise<string | null> {
  const ck = `${type}/${entry.handle}`
  const cached = metaobjectIds.get(ck)
  if (cached) return cached
  const handle = { type, handle: entry.handle }
  const found = await adminGraphQL<{ metaobjectByHandle: { id: string } | null }>(
    `query($h: MetaobjectHandleInput!) { metaobjectByHandle(handle: $h) { id } }`,
    { h: handle },
  )
  let id = found.metaobjectByHandle?.id ?? null
  if (!id) {
    const up = await adminGraphQL<{ metaobjectUpsert: {
      metaobject: { id: string } | null
      userErrors: Array<{ message: string }>
    } | null }>(
      `mutation($h: MetaobjectHandleInput!, $m: MetaobjectUpsertInput!) { metaobjectUpsert(handle: $h, metaobject: $m) { metaobject { id } userErrors { field message code } } }`,
      { h: handle, m: { fields: entry.fields } },
    )
    id = up.metaobjectUpsert?.metaobject?.id ?? null
    if (!id) {
      errors.push(`upsert ${ck}: ${up.metaobjectUpsert?.userErrors.map(e => e.message).join('; ') || 'no metaobject returned'}`)
      return null
    }
  }
  metaobjectIds.set(ck, id)
  return id
}

// ─── Public entry points ─────────────────────────────────────────────────────

/**
 * Apply a category and its attribute metafields to one product. Fill gaps only.
 * Never throws: failures land in `errors`.
 */
export async function applyShopifyCategory(
  productGid: string,
  input: ShopifyCategoryInput,
  opts: { allowCategoryChange?: boolean } = {},
): Promise<ApplyCategoryResult> {
  const result: ApplyCategoryResult = {
    ok: false, categorySet: null, categoryKept: null, metafieldsSet: [], dropped: [], errors: [],
  }
  try {
    const requested = normalizeCategoryId(input.id)
    if (!requested) { result.errors.push(`invalid category id ${JSON.stringify(input.id)}`); return result }

    const cat = await fetchCategory(requested)
    if (!cat) { result.errors.push(`unknown category ${requested}`); return result }
    if (!cat.isLeaf && !OWNER_APPROVED_NON_LEAF_IDS.includes(requested)) { result.errors.push(`category ${requested} is not a leaf`); return result }

    const prod = await adminGraphQL<{ product: {
      category: { id: string } | null
      metafields: { nodes: Array<{ key: string }> }
    } | null }>(
      `query($id: ID!) { product(id: $id) { category { id } metafields(first: 100, namespace: "shopify") { nodes { key } } } }`,
      { id: productGid },
    )
    if (!prod.product) { result.errors.push(`product ${productGid} not found`); return result }

    const existingCat = prod.product.category ? tail(prod.product.category.id) : null
    const pick = resolveCategoryToSet(existingCat, requested, opts.allowCategoryChange === true)
    result.categoryKept = pick.kept
    if (pick.kept) result.dropped.push(`kept existing category ${pick.kept} (change to ${requested} not allowed)`)

    // Attributes are validated against the category that will actually stand.
    const effective = pick.effective === requested ? cat : await fetchCategory(pick.effective)
    const existingKeys = new Set(prod.product.metafields.nodes.map(n => n.key))
    const plan = effective
      ? planAttributeWrites(allowedByName(effective), input.attributes ?? {}, existingKeys, pick.effective)
      : { colorPattern: null, simple: [], dropped: [`could not load attributes for ${pick.effective}`] }
    result.dropped.push(...plan.dropped)

    const metafields: Array<{ ownerId: string; namespace: string; key: string; type: string; value: string }> = []
    const addMetafield = async (key: string, type: string, entries: MetaobjectEntry[]) => {
      if (!(await ensureDefinition(key, result.errors))) return
      const ids: string[] = []
      for (const e of entries) {
        const id = await ensureMetaobject(type, e, result.errors)
        if (id && !ids.includes(id)) ids.push(id)
      }
      if (ids.length) metafields.push({ ownerId: productGid, namespace: 'shopify', key, type: 'list.metaobject_reference', value: JSON.stringify(ids) })
    }
    if (plan.colorPattern) await addMetafield('color-pattern', 'shopify--color-pattern', plan.colorPattern)
    for (const s of plan.simple) await addMetafield(s.key, `shopify--${s.key}`, s.entries)

    // productUpdate is sent once. metafieldsSet may be retried: Shopify fails the
    // whole call when one entry is outside a definition's category constraints, so
    // entries it names by index are dropped and the remainder is sent again.
    let pending = metafields
    let sendCategory = pick.set != null
    while (sendCategory || pending.length) {
      const vars: Record<string, unknown> = {}
      const decl: string[] = []
      const body: string[] = []
      if (sendCategory && pick.set) {
        decl.push('$p: ProductUpdateInput!')
        body.push('productUpdate(product: $p) { product { id } userErrors { field message } }')
        vars['p'] = { id: productGid, category: CATEGORY_GID_PREFIX + pick.set }
      }
      if (pending.length) {
        decl.push('$m: [MetafieldsSetInput!]!')
        body.push('metafieldsSet(metafields: $m) { metafields { key } userErrors { field message code } }')
        vars['m'] = pending
      }
      const d = await adminGraphQL<{
        productUpdate?:  { userErrors: Array<{ message: string }> } | null
        metafieldsSet?:  { userErrors: MutationUserError[] } | null
      }>(`mutation(${decl.join(', ')}) { ${body.join(' ')} }`, vars)
      if (sendCategory && pick.set) {
        const pu = d.productUpdate?.userErrors ?? []
        if (pu.length) result.errors.push(`productUpdate: ${pu.map(e => e.message).join('; ')}`)
        else result.categorySet = pick.set
      }
      sendCategory = false
      if (!pending.length) break
      const ms = d.metafieldsSet?.userErrors ?? []
      if (!ms.length) { result.metafieldsSet = pending.map(m => m.key); break }
      const { rejected, unindexed } = parseMetafieldUserErrors(ms, pending.length)
      if (unindexed.length) {
        result.errors.push(`metafieldsSet: ${ms.map(e => e.message).join('; ')}`)
        break
      }
      const drop = new Set(rejected.map(r => r.index))
      for (const r of rejected) {
        result.dropped.push(`Shopify rejected shopify.${pending[r.index]!.key} on category ${pick.effective}: ${r.message}`)
      }
      pending = pending.filter((_, i) => !drop.has(i))
    }
    result.ok = result.errors.length === 0
    return result
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err))
    result.ok = false
    return result
  }
}

/**
 * Write `xdipx.material` for one product. Fill gaps only: an existing non-empty
 * value is never overwritten. Values are normalized onto MATERIAL_VOCAB first.
 * Never throws: failures land in `errors`.
 */
export async function applyMaterial(productGid: string, materials: unknown): Promise<ApplyMaterialResult> {
  const result: ApplyMaterialResult = { ok: false, written: [], skipped: null, errors: [] }
  try {
    const list = normalizeMaterials(materials)
    if (!list.length) { result.ok = true; result.skipped = 'no recognised materials'; return result }

    const cur = await adminGraphQL<{ product: { metafield: { value: string } | null } | null }>(
      `query($id: ID!) { product(id: $id) { metafield(namespace: "xdipx", key: "material") { value } } }`,
      { id: productGid },
    )
    if (!cur.product) { result.errors.push(`product ${productGid} not found`); return result }
    const existing = cur.product.metafield?.value?.trim() ?? ''
    if (existing && existing !== '[]') { result.ok = true; result.skipped = 'material already set'; return result }

    const d = await adminGraphQL<{ metafieldsSet: { userErrors: MutationUserError[] } | null }>(
      `mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { key } userErrors { field message code } } }`,
      { m: [{ ownerId: productGid, namespace: 'xdipx', key: 'material', type: 'list.single_line_text_field', value: JSON.stringify(list) }] },
    )
    const errs = d.metafieldsSet?.userErrors ?? []
    if (errs.length) result.errors.push(`metafieldsSet: ${errs.map(e => e.message).join('; ')}`)
    else result.written = list
    result.ok = result.errors.length === 0
    return result
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err))
    result.ok = false
    return result
  }
}

/**
 * Enrichment entry point: apply the payload's `shopifyCategory`, or the
 * deterministic default for the product type when the payload carries none (or
 * carries an id Shopify does not know and the product still has no category).
 * Returns null when there is nothing to apply. Never throws.
 */
export async function applyCategoryForEnrichment(
  productGid: string,
  writes: {
    shopifyCategory?:    ShopifyCategoryInput | undefined
    productTypeDial?:    string | null | undefined
    productSubtypeDial?: string | null | undefined
  },
  productType: string | null | undefined,
): Promise<ApplyCategoryResult | null> {
  const fallbackId = defaultCategoryId(productType, writes.productTypeDial, writes.productSubtypeDial)
  const primary = writes.shopifyCategory?.id
    ? writes.shopifyCategory
    : fallbackId ? { id: fallbackId } : null
  if (!primary) return null
  const first = await applyShopifyCategory(productGid, primary)
  const unusable = first.categorySet == null && first.categoryKept == null && first.errors.length > 0
  if (unusable && fallbackId && normalizeCategoryId(primary.id) !== fallbackId) {
    const second = await applyShopifyCategory(productGid, { id: fallbackId, attributes: primary.attributes ?? {} })
    second.dropped.unshift(`payload category ${JSON.stringify(primary.id)} failed (${first.errors.join('; ')}), used default ${fallbackId}`)
    return second
  }
  return first
}
