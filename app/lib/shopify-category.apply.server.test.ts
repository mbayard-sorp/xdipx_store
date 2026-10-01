import { describe, it, expect, vi, beforeEach } from 'vitest'

const adminGraphQL = vi.fn()
vi.mock('~/lib/shopify.server', () => ({ adminGraphQL: (...a: unknown[]) => adminGraphQL(...a) }))

import { applyShopifyCategory, applyMaterial, _resetShopifyCategoryCaches } from './shopify-category.server'

const GID = 'gid://shopify/Product/1'
const REJECT = "Owner subtype does not match the metafield definition's constraints."

/** Route mocked Admin calls by the query text. */
function route(opts: { metafieldsSetReplies: unknown[]; existingMaterial?: string | null; productCategory?: string | null }) {
  const sets = [...opts.metafieldsSetReplies]
  const calls: Array<{ q: string; vars: Record<string, any> }> = []
  adminGraphQL.mockImplementation(async (q: string, vars: Record<string, any> = {}) => {
    calls.push({ q, vars })
    if (q.includes('fullName isLeaf')) {
      return { node: { fullName: 'Mature > Erotic > Sex Toys', isLeaf: true, attributes: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [
        { __typename: 'TaxonomyChoiceListAttribute', id: 'gid://shopify/TaxonomyAttribute/1', name: 'Color' },
        { __typename: 'TaxonomyChoiceListAttribute', id: 'gid://shopify/TaxonomyAttribute/9', name: 'Power source' },
      ] } } }
    }
    if (q.includes('values(first: 250')) {
      return { node: { attributes: { nodes: [
        { id: 'gid://shopify/TaxonomyAttribute/1', values: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: 'gid://shopify/TaxonomyValue/1', name: 'Black' }] } },
        { id: 'gid://shopify/TaxonomyAttribute/9', values: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: 'gid://shopify/TaxonomyValue/20', name: 'Rechargeable' }] } },
      ] } } }
    }
    if (q.includes('metafieldDefinitions')) return { metafieldDefinitions: { nodes: [{ key: 'color-pattern' }, { key: 'power-source' }] } }
    if (q.includes('metaobjectByHandle')) return { metaobjectByHandle: { id: `gid://shopify/Metaobject/${vars['h'].handle}` } }
    if (q.includes('category { id } metafields')) return { product: { category: opts.productCategory ? { id: opts.productCategory } : null, metafields: { nodes: [] } } }
    if (q.includes('metafield(namespace: "xdipx"')) return { product: { metafield: opts.existingMaterial == null ? null : { value: opts.existingMaterial } } }
    if (q.includes('metafieldsSet')) {
      const reply = sets.shift() ?? { userErrors: [] }
      return { ...(q.includes('productUpdate') ? { productUpdate: { userErrors: [] } } : {}), metafieldsSet: reply }
    }
    throw new Error(`unrouted query: ${q.slice(0, 60)}`)
  })
  return calls
}

beforeEach(() => { adminGraphQL.mockReset(); _resetShopifyCategoryCaches() })

describe('applyShopifyCategory metafieldsSet retry', () => {
  it('drops the rejected entry, retries the rest, never resends productUpdate', async () => {
    const calls = route({ metafieldsSetReplies: [
      { userErrors: [{ field: ['metafields', '0'], message: REJECT, code: 'INVALID_VALUE' }] },
      { userErrors: [] },
    ] })
    const r = await applyShopifyCategory(GID, { id: 'ma-1-4', attributes: { Color: ['Black'], 'Power source': ['Rechargeable'] } })
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.categorySet).toBe('ma-1-4')
    expect(r.metafieldsSet).toEqual(['power-source'])
    expect(r.dropped).toEqual([`Shopify rejected shopify.color-pattern on category ma-1-4: ${REJECT}`])
    const sets = calls.filter(c => c.q.includes('metafieldsSet'))
    expect(sets).toHaveLength(2)
    expect(sets[0]!.q).toContain('productUpdate')
    expect(sets[1]!.q).not.toContain('productUpdate')
    expect(sets[1]!.vars['m']).toHaveLength(1)
  })

  it('stops with ok true when every entry is rejected', async () => {
    const calls = route({ metafieldsSetReplies: [
      { userErrors: [
        { field: ['metafields', '0'], message: REJECT },
        { field: ['metafields', '1'], message: REJECT },
      ] },
    ] })
    const r = await applyShopifyCategory(GID, { id: 'ma-1-4', attributes: { Color: ['Black'], 'Power source': ['Rechargeable'] } })
    expect(r.ok).toBe(true)
    expect(r.metafieldsSet).toEqual([])
    expect(r.dropped).toHaveLength(2)
    expect(calls.filter(c => c.q.includes('metafieldsSet'))).toHaveLength(1)
  })

  it('keeps unindexed userErrors as errors with no retry', async () => {
    const calls = route({ metafieldsSetReplies: [{ userErrors: [{ message: 'Throttled' }] }] })
    const r = await applyShopifyCategory(GID, { id: 'ma-1-4', attributes: { Color: ['Black'] } })
    expect(r.ok).toBe(false)
    expect(r.errors).toEqual(['metafieldsSet: Throttled'])
    expect(calls.filter(c => c.q.includes('metafieldsSet'))).toHaveLength(1)
  })
})

describe('applyShopifyCategory non-leaf allowlist', () => {
  it('rejects a non-leaf that is not approved', async () => {
    adminGraphQL.mockResolvedValue({ node: { fullName: 'X', isLeaf: false, attributes: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } })
    const r = await applyShopifyCategory(GID, { id: 'hb-4' })
    expect(r.errors).toEqual(['category hb-4 is not a leaf'])
  })
  it('lets hb-3 through', async () => {
    adminGraphQL.mockImplementation(async (q: string) => {
      if (q.includes('fullName isLeaf')) return { node: { fullName: 'Health & Beauty > Personal Care', isLeaf: false, attributes: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } }
      if (q.includes('category { id } metafields')) return { product: { category: null, metafields: { nodes: [] } } }
      return { productUpdate: { userErrors: [] } }
    })
    const r = await applyShopifyCategory(GID, { id: 'hb-3' })
    expect(r.ok).toBe(true)
    expect(r.categorySet).toBe('hb-3')
  })
})

describe('applyMaterial', () => {
  it('writes the normalized list as JSON', async () => {
    const calls = route({ metafieldsSetReplies: [{ userErrors: [] }] })
    const r = await applyMaterial(GID, ['silicone', 'abs', 'Titanium'])
    expect(r).toEqual({ ok: true, written: ['Silicone', 'ABS Plastic'], skipped: null, errors: [] })
    const set = calls.find(c => c.q.includes('metafieldsSet'))!
    expect(set.vars['m']).toEqual([{ ownerId: GID, namespace: 'xdipx', key: 'material', type: 'list.single_line_text_field', value: '["Silicone","ABS Plastic"]' }])
  })
  it('does nothing when a value already exists', async () => {
    const calls = route({ metafieldsSetReplies: [], existingMaterial: '["TPE"]' })
    const r = await applyMaterial(GID, ['Silicone'])
    expect(r.ok).toBe(true)
    expect(r.skipped).toBe('material already set')
    expect(calls.some(c => c.q.includes('mutation'))).toBe(false)
  })
  it('skips without calling Shopify when nothing normalizes', async () => {
    const r = await applyMaterial(GID, ['Titanium'])
    expect(r.skipped).toBe('no recognised materials')
    expect(adminGraphQL).not.toHaveBeenCalled()
  })
  it('never throws', async () => {
    adminGraphQL.mockRejectedValue(new Error('network'))
    const r = await applyMaterial(GID, ['Silicone'])
    expect(r.ok).toBe(false)
    expect(r.errors).toEqual(['network'])
  })
})
