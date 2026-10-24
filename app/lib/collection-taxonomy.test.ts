import { describe, expect, it } from 'vitest'
import {
  COLLECTION_REDIRECTS,
  collectionRedirect,
  isUnlistedCollection,
  markdownRedirectTarget,
} from './collection-taxonomy'
import { RETIRED_ROUTE_TARGETS } from './retired-routes'

describe('collectionRedirect', () => {
  it('returns null for a handle with no entry, so the PLP 404s as before', () => {
    expect(collectionRedirect('vibrators')).toBeNull()
  })

  it('maps a merged handle to its keeper', () => {
    expect(collectionRedirect('all-vibrators')).toEqual({ kind: 'redirect', to: '/collections/vibrators' })
  })

  it('marks retired daily-deal handles gone', () => {
    expect(collectionRedirect('daily-deal')).toEqual({ kind: 'gone' })
    expect(collectionRedirect('frontpage')).toEqual({ kind: 'gone' })
  })

  it('does not treat Object.prototype keys as entries', () => {
    expect(collectionRedirect('constructor')).toBeNull()
    expect(collectionRedirect('toString')).toBeNull()
  })

  it('never chains: no target is itself a redirected handle', () => {
    for (const [from, to] of Object.entries(COLLECTION_REDIRECTS)) {
      if (to === null || to === '/collections') continue
      const target = to.replace('/collections/', '')
      expect(COLLECTION_REDIRECTS, `${from} -> ${to} chains`).not.toHaveProperty(target)
    }
  })

  it('only targets the hub or a collection page', () => {
    for (const to of Object.values(COLLECTION_REDIRECTS)) {
      if (to === null) continue
      expect(to).toMatch(/^\/collections(\/[a-z0-9-]+)?$/)
    }
  })

  it('sends the retired gendered shelves where the retired routes already go', () => {
    expect(COLLECTION_REDIRECTS['for-him']).toBe(RETIRED_ROUTE_TARGETS.forHim)
    expect(COLLECTION_REDIRECTS['for-her']).toBe(RETIRED_ROUTE_TARGETS.forHer)
  })
})

describe('markdownRedirectTarget', () => {
  it('points a collection at its .md twin', () => {
    expect(markdownRedirectTarget('/collections/vibrators')).toBe('/collections/vibrators.md')
  })

  it('points the hub at /collections.md', () => {
    expect(markdownRedirectTarget('/collections')).toBe('/collections.md')
  })
})

describe('isUnlistedCollection', () => {
  it('hides utility and retired handles', () => {
    for (const h of ['welcome-eligible', 'curious15-eligible', 'shop-products', 'frontpage', 'for-him']) {
      expect(isUnlistedCollection(h)).toBe(true)
    }
  })

  it('lists ordinary shelves', () => {
    expect(isUnlistedCollection('vibrators')).toBe(false)
    expect(isUnlistedCollection('on-sale')).toBe(false)
  })
})
