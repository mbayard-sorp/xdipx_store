// Nightly `shelf:<type>` tag sweep (ticket #17678).
import { describe, expect, it } from 'vitest'
import { runShelfTagSweep, shelfTagAction, type ShelfTagCandidate, type ShelfTagSweepRepo } from './shelf-tag-sweep.server'

function product(overrides: Partial<ShelfTagCandidate> = {}): ShelfTagCandidate {
  return {
    productId: 'gid://shopify/Product/1',
    title: 'Some Product',
    productType: 'Vibrator',
    tags: [],
    categories: [],
    ...overrides,
  }
}

describe('shelfTagAction', () => {
  it('adds the shelf tag for a real type that carries no shelf tag yet', () => {
    expect(shelfTagAction(product({ productType: 'Vibrator', tags: [] })))
      .toEqual({ removeTags: [], addTag: 'shelf:vibrator' })
  })

  it('swaps a stale shelf tag for the current real type', () => {
    expect(shelfTagAction(product({ productType: 'Dildo', tags: ['shelf:vibrator', 'new-arrival'] })))
      .toEqual({ removeTags: ['shelf:vibrator'], addTag: 'shelf:dildo' })
  })

  it('does nothing when the shelf tag already matches the real type', () => {
    expect(shelfTagAction(product({ productType: 'Vibrator', tags: ['shelf:vibrator'] }))).toBeNull()
  })

  it('never touches a Discontinued product that already carries a shelf tag', () => {
    expect(shelfTagAction(product({ productType: 'Discontinued', tags: ['shelf:vibrator'] }))).toBeNull()
  })

  it('derives a shelf tag for a Discontinued product with no shelf tag, from its categories', () => {
    expect(shelfTagAction(product({
      productType: 'Discontinued',
      tags: [],
      categories: ['Wands'],
      title: 'Some Wand',
    }))).toEqual({ removeTags: [], addTag: 'shelf:wand-massager' })
  })

  it('leaves a Discontinued product with no shelf tag alone when derivation finds nothing', () => {
    expect(shelfTagAction(product({
      productType: 'Discontinued',
      tags: [],
      categories: [],
      title: 'Totally Unrecognizable Thing',
    }))).toBeNull()
  })

  it('does nothing for a blank product type', () => {
    expect(shelfTagAction(product({ productType: null, tags: [] }))).toBeNull()
    expect(shelfTagAction(product({ productType: '', tags: [] }))).toBeNull()
  })
})

describe('runShelfTagSweep', () => {
  function repoWith(products: ShelfTagCandidate[]) {
    const calls: Array<{ productId: string; removeTags: readonly string[]; addTag: string }> = []
    const repo: ShelfTagSweepRepo = {
      listCandidates: async () => products,
      swapTag: async (productId, removeTags, addTag) => {
        calls.push({ productId, removeTags, addTag })
      },
    }
    return { repo, calls }
  }

  it('counts a real-type swap separately from a Discontinued derivation', async () => {
    const { repo, calls } = repoWith([
      product({ productId: 'p1', productType: 'Dildo', tags: ['shelf:vibrator'] }),
      product({ productId: 'p2', productType: 'Discontinued', tags: [], categories: ['Wands'], title: 'Some Wand' }),
      product({ productId: 'p3', productType: 'Vibrator', tags: ['shelf:vibrator'] }),
    ])

    const result = await runShelfTagSweep({ repo })

    expect(result).toEqual({ checked: 3, swapped: 1, derivedForDiscontinued: 1 })
    expect(calls).toEqual([
      { productId: 'p1', removeTags: ['shelf:vibrator'], addTag: 'shelf:dildo' },
      { productId: 'p2', removeTags: [], addTag: 'shelf:wand-massager' },
    ])
  })

  it('calls swapTag on nothing when every product already matches', async () => {
    const { repo, calls } = repoWith([
      product({ productId: 'p1', productType: 'Vibrator', tags: ['shelf:vibrator'] }),
      product({ productId: 'p2', productType: 'Discontinued', tags: ['shelf:dildo'] }),
    ])

    const result = await runShelfTagSweep({ repo })

    expect(result).toEqual({ checked: 2, swapped: 0, derivedForDiscontinued: 0 })
    expect(calls).toEqual([])
  })
})
