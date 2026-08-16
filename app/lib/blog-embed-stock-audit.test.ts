import { describe, expect, it } from 'vitest'
import {
  classifyBuyability,
  findDeadEmbeds,
  groupByDeadHandle,
  type ProductBuyability,
} from './blog-embed-stock-audit'

function buyable(handle: string, over: Partial<ProductBuyability> = {}): ProductBuyability {
  return { handle, found: true, status: 'ACTIVE', totalInventory: 10, ...over }
}

describe('classifyBuyability', () => {
  it('returns null for a found, active, in-stock product', () => {
    expect(classifyBuyability(buyable('a'))).toBeNull()
  })

  it('treats a missing snapshot as gone', () => {
    expect(classifyBuyability(undefined)).toBe('gone')
  })

  it('treats not-found as gone', () => {
    expect(classifyBuyability({ handle: 'a', found: false, status: null, totalInventory: null })).toBe('gone')
  })

  it('treats a 404 storefront PDP as gone even when Admin is otherwise fine', () => {
    expect(classifyBuyability(buyable('a', { storefrontStatus: 404 }))).toBe('gone')
  })

  it('treats ARCHIVED status as gone (drops from Storefront API)', () => {
    expect(classifyBuyability(buyable('a', { status: 'ARCHIVED' }))).toBe('gone')
  })

  it('treats DRAFT status as inactive', () => {
    expect(classifyBuyability(buyable('a', { status: 'DRAFT' }))).toBe('inactive')
  })

  it('flags zero or negative inventory as out-of-stock', () => {
    expect(classifyBuyability(buyable('a', { totalInventory: 0 }))).toBe('out-of-stock')
    expect(classifyBuyability(buyable('a', { totalInventory: -3 }))).toBe('out-of-stock')
  })

  it('does not flag out-of-stock when inventory is unknown (null)', () => {
    expect(classifyBuyability(buyable('a', { totalInventory: null }))).toBeNull()
  })

  it('ranks gone above out-of-stock when both apply', () => {
    expect(classifyBuyability(buyable('a', { found: false, totalInventory: 0 }))).toBe('gone')
  })
})

describe('findDeadEmbeds', () => {
  it('omits posts whose embeds are all buyable', () => {
    const posts = [{ slug: 'clean', embedHandles: ['a', 'b'] }]
    expect(findDeadEmbeds(posts, [buyable('a'), buyable('b')])).toEqual([])
  })

  it('reports a post with a single dead embed', () => {
    const posts = [{ slug: 'p', embedHandles: ['a', 'b'] }]
    const report = findDeadEmbeds(posts, [buyable('a'), buyable('b', { totalInventory: 0 })])
    expect(report).toHaveLength(1)
    expect(report[0]!.deadEmbeds).toEqual([{ handle: 'b', reason: 'out-of-stock' }])
    expect(report[0]!.hasNoBuyablePath).toBe(false)
  })

  it('flags hasNoBuyablePath when every embed is dead', () => {
    const posts = [{ slug: 'dead-end', embedHandles: ['gone-handle'] }]
    const report = findDeadEmbeds(posts, [])
    expect(report[0]!.hasNoBuyablePath).toBe(true)
    expect(report[0]!.deadEmbeds).toEqual([{ handle: 'gone-handle', reason: 'gone' }])
  })

  it('sorts no-buyable-path posts before partially-dead posts', () => {
    const posts = [
      { slug: 'partial', embedHandles: ['ok', 'oos'] },
      { slug: 'dead-end', embedHandles: ['gone'] },
    ]
    const report = findDeadEmbeds(posts, [buyable('ok'), buyable('oos', { totalInventory: 0 })])
    expect(report.map((r) => r.slug)).toEqual(['dead-end', 'partial'])
  })

  it('skips posts that carry no embeds', () => {
    const posts = [{ slug: 'no-embeds', embedHandles: [] }]
    expect(findDeadEmbeds(posts, [])).toEqual([])
  })

  it('resolves handles case- and whitespace-insensitively', () => {
    const posts = [{ slug: 'p', embedHandles: ['  Magic-Wand-Mini  '] }]
    const report = findDeadEmbeds(posts, [buyable('magic-wand-mini', { totalInventory: 0 })])
    expect(report[0]!.deadEmbeds).toEqual([{ handle: 'magic-wand-mini', reason: 'out-of-stock' }])
  })

  it('tolerates a null embedHandles projection from Sanity', () => {
    // GROQ returns null (not []) for a post with no matching embeds.
    const posts = [{ slug: 'p', embedHandles: null as unknown as string[] }]
    expect(findDeadEmbeds(posts, [])).toEqual([])
  })
})

describe('groupByDeadHandle', () => {
  it('returns an empty array when nothing is dead', () => {
    expect(groupByDeadHandle([])).toEqual([])
  })

  it('groups two posts that share one dead handle under that handle', () => {
    const posts = [
      { slug: 'post-a', embedHandles: ['dead-handle', 'ok-handle'] },
      { slug: 'post-b', embedHandles: ['dead-handle'] },
    ]
    const buyability = [buyable('ok-handle'), buyable('dead-handle', { totalInventory: 0 })]
    const reports = findDeadEmbeds(posts, buyability)
    const groups = groupByDeadHandle(reports)

    expect(groups).toEqual([
      { handle: 'dead-handle', reason: 'out-of-stock', slugs: ['post-a', 'post-b'] },
    ])
  })

  it('sorts the group whose handle breaks the most posts first', () => {
    const posts = [
      { slug: 'p1', embedHandles: ['widely-broken'] },
      { slug: 'p2', embedHandles: ['widely-broken'] },
      { slug: 'p3', embedHandles: ['narrowly-broken'] },
    ]
    const buyability = [
      buyable('widely-broken', { totalInventory: 0 }),
      buyable('narrowly-broken', { found: false }),
    ]
    const reports = findDeadEmbeds(posts, buyability)
    const groups = groupByDeadHandle(reports)

    expect(groups.map((g) => g.handle)).toEqual(['widely-broken', 'narrowly-broken'])
  })

})
