import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('~/lib/sanity.server', () => ({ getClient: vi.fn() }))
vi.mock('~/lib/shopify.server', () => ({ getCollectionList: vi.fn() }))

import { getPanelDeck } from './panel-deck.server'
import { getClient } from '~/lib/sanity.server'
import { getCollectionList } from '~/lib/shopify.server'

const mockClient = (fetchResult: unknown) => {
  ;(getClient as ReturnType<typeof vi.fn>).mockReturnValue({
    fetch: vi.fn().mockResolvedValue(fetchResult),
  })
}

const collections = (handles: Array<[string, number | null]>) => {
  ;(getCollectionList as ReturnType<typeof vi.fn>).mockResolvedValue(
    handles.map(([handle, productsCount]) => ({ handle, productsCount })),
  )
}

const squareRow = (items: unknown[]) => ({ _type: 'panelSquareRow', _key: 'r1', items })
const tile = (label: string, link: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  _key: `t-${label}`,
  label,
  surface: 'blush',
  mark: 'waves',
  link,
  ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getPanelDeck — destination validation', () => {
  it('resolves collection, article, and route destinations', async () => {
    collections([['pleasure', 12]])
    mockClient({
      theme: 'tint',
      rows: [
        squareRow([
          tile('Pleasure', { kind: 'collection', collectionHandle: 'pleasure' }),
          tile('Guide', { kind: 'article', articleSlug: 'first-toy', articlePublished: true }),
          tile('Notebook', { kind: 'route', route: '/notebook' }),
        ]),
      ],
    })
    const deck = await getPanelDeck()
    expect(deck?.rows[0]?.items.map(i => i.href)).toEqual([
      '/collections/pleasure',
      '/notebook/first-toy',
      '/notebook',
    ])
  })

  it('drops a door whose collection handle does not exist', async () => {
    // A typo'd handle would ship a 404 on the highest-traffic page. The deck
    // degrades panel by panel: the bad door disappears, the rest render.
    collections([['pleasure', 12]])
    mockClient({
      theme: 'tint',
      rows: [
        squareRow([
          tile('Pleasure', { kind: 'collection', collectionHandle: 'pleasure' }),
          tile('Typo', { kind: 'collection', collectionHandle: 'pleasrue' }),
        ]),
      ],
    })
    const deck = await getPanelDeck()
    expect(deck?.rows[0]?.items.map(i => i.label)).toEqual(['Pleasure'])
  })

  it('drops a door to a collection with zero products', async () => {
    collections([['pleasure', 12], ['empty-aisle', 0]])
    mockClient({
      theme: 'tint',
      rows: [
        squareRow([
          tile('Pleasure', { kind: 'collection', collectionHandle: 'pleasure' }),
          tile('Empty', { kind: 'collection', collectionHandle: 'empty-aisle' }),
        ]),
      ],
    })
    const deck = await getPanelDeck()
    expect(deck?.rows[0]?.items.map(i => i.label)).toEqual(['Pleasure'])
  })

  it('lets handles through unvalidated when the collection list is unavailable', async () => {
    // A Shopify hiccup at warm time must not strip every door off the deck.
    ;(getCollectionList as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('shopify down'))
    mockClient({
      theme: 'tint',
      rows: [squareRow([tile('Pleasure', { kind: 'collection', collectionHandle: 'pleasure' })])],
    })
    const deck = await getPanelDeck()
    expect(deck?.rows[0]?.items.map(i => i.href)).toEqual(['/collections/pleasure'])
  })

  it('drops an article door whose post is unpublished', async () => {
    collections([])
    mockClient({
      theme: 'tint',
      rows: [
        squareRow([
          tile('Draft', { kind: 'article', articleSlug: 'wip', articlePublished: false }),
          tile('Notebook', { kind: 'route', route: '/notebook' }),
        ]),
      ],
    })
    const deck = await getPanelDeck()
    expect(deck?.rows[0]?.items.map(i => i.label)).toEqual(['Notebook'])
  })

  it('rejects a route that is not site-relative', async () => {
    collections([])
    mockClient({
      theme: 'tint',
      rows: [
        squareRow([
          tile('Evil', { kind: 'route', route: 'https://elsewhere.example' }),
          tile('Fine', { kind: 'route', route: '/new' }),
        ]),
      ],
    })
    const deck = await getPanelDeck()
    expect(deck?.rows[0]?.items.map(i => i.label)).toEqual(['Fine'])
  })
})

describe('getPanelDeck — shape hardening', () => {
  it('returns null for an unpublished or empty deck', async () => {
    mockClient(null)
    expect(await getPanelDeck()).toBeNull()
    mockClient({ theme: 'tint', rows: [] })
    expect(await getPanelDeck()).toBeNull()
  })

  it('returns null when every door is dropped', async () => {
    collections([])
    mockClient({
      theme: 'tint',
      rows: [squareRow([tile('Typo', { kind: 'collection', collectionHandle: 'gone' })])],
    })
    expect(await getPanelDeck()).toBeNull()
  })

  it('falls back to the tint theme and stone surface on unknown values', async () => {
    collections([])
    mockClient({
      theme: 'holographic',
      rows: [
        squareRow([
          tile('Notebook', { kind: 'route', route: '/notebook' }, { surface: 'neon' }),
        ]),
      ],
    })
    const deck = await getPanelDeck()
    expect(deck?.theme).toBe('tint')
    expect(deck?.rows[0]?.items[0]?.surface).toBe('stone')
  })

  it('returns null on a fetch failure rather than throwing', async () => {
    ;(getClient as ReturnType<typeof vi.fn>).mockReturnValue({
      fetch: vi.fn().mockRejectedValue(new Error('sanity down')),
    })
    expect(await getPanelDeck()).toBeNull()
  })
})
