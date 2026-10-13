import { describe, it, expect, vi } from 'vitest'
import {
  buildAddonProfileProperties,
  choosePlacedOrderMetricId,
  mapGenericAddons,
  mapPurchasesToAddons,
  resolveAddonSlots,
  syncAddonsForProfile,
  type AddonCandidate,
  type AddonSyncDeps,
  type PurchasedProductAccessories,
} from './email-addons.server'

const WAND: AddonCandidate = { id: 'gid://shopify/Product/1', handle: 'the-compass-wand', title: 'The Compass Wand', imageUrl: 'https://cdn.shopify.com/wand.jpg', inStock: true }
const LUBE: AddonCandidate = { id: 'gid://shopify/Product/2', handle: 'slow-hands-lube', title: 'Slow Hands Lube', imageUrl: 'https://cdn.shopify.com/lube.jpg', inStock: true }
const OUT_OF_STOCK: AddonCandidate = { id: 'gid://shopify/Product/3', handle: 'quiet-hour-wear', title: 'Quiet Hour Wear', imageUrl: 'https://cdn.shopify.com/wear.jpg', inStock: false }
const ALREADY_OWNED: AddonCandidate = { id: 'gid://shopify/Product/4', handle: 'the-compass-wand', title: 'The Compass Wand', imageUrl: 'https://cdn.shopify.com/wand.jpg', inStock: true }

function catalog(entries: AddonCandidate[]): Map<string, AddonCandidate> {
  return new Map(entries.map((e) => [e.id, e]))
}

describe('mapPurchasesToAddons (owned mapping)', () => {
  it('maps a purchased product\'s curated accessories to add-on slots, carrying pairing_why through unchanged', () => {
    const purchased: PurchasedProductAccessories[] = [
      {
        handle: 'the-wand-set',
        accessoryProductIds: [WAND.id, LUBE.id],
        pairingWhy: { [WAND.id]: 'It pairs with the slower setting you liked.', [LUBE.id]: 'Keeps the glide going longer.' },
      },
    ]
    const slots = mapPurchasesToAddons(purchased, catalog([WAND, LUBE]), new Set())
    expect(slots).toHaveLength(2)
    expect(slots[0]).toEqual({
      handle: WAND.handle,
      title: WAND.title,
      image: WAND.imageUrl,
      url: 'https://xdipx.com/products/the-compass-wand',
      why: 'It pairs with the slower setting you liked.',
    })
    expect(slots[1]!.why).toBe('Keeps the glide going longer.')
  })

  it('caps at 3 slots across multiple purchases, in curation order', () => {
    const extra: AddonCandidate = { id: 'gid://shopify/Product/5', handle: 'extra-one', title: 'Extra One', imageUrl: 'https://cdn.shopify.com/e.jpg', inStock: true }
    const fourth: AddonCandidate = { id: 'gid://shopify/Product/6', handle: 'extra-two', title: 'Extra Two', imageUrl: 'https://cdn.shopify.com/f.jpg', inStock: true }
    const purchased: PurchasedProductAccessories[] = [
      { handle: 'a', accessoryProductIds: [WAND.id, LUBE.id], pairingWhy: {} },
      { handle: 'b', accessoryProductIds: [extra.id, fourth.id], pairingWhy: {} },
    ]
    const slots = mapPurchasesToAddons(purchased, catalog([WAND, LUBE, extra, fourth]), new Set())
    expect(slots.map((s) => s.handle)).toEqual(['the-compass-wand', 'slow-hands-lube', 'extra-one'])
  })

  it('deduplicates an accessory curated by more than one purchased product', () => {
    const purchased: PurchasedProductAccessories[] = [
      { handle: 'a', accessoryProductIds: [WAND.id], pairingWhy: { [WAND.id]: 'From A.' } },
      { handle: 'b', accessoryProductIds: [WAND.id], pairingWhy: { [WAND.id]: 'From B.' } },
    ]
    const slots = mapPurchasesToAddons(purchased, catalog([WAND]), new Set())
    expect(slots).toHaveLength(1)
    expect(slots[0]!.why).toBe('From A.') // first occurrence wins
  })

  it('excludes a curated accessory the profile already purchased', () => {
    const purchased: PurchasedProductAccessories[] = [
      { handle: 'a', accessoryProductIds: [ALREADY_OWNED.id, LUBE.id], pairingWhy: {} },
    ]
    const slots = mapPurchasesToAddons(purchased, catalog([ALREADY_OWNED, LUBE]), new Set(['the-compass-wand']))
    expect(slots.map((s) => s.handle)).toEqual(['slow-hands-lube'])
  })

  it('excludes an out-of-stock curated accessory', () => {
    const purchased: PurchasedProductAccessories[] = [
      { handle: 'a', accessoryProductIds: [OUT_OF_STOCK.id, LUBE.id], pairingWhy: {} },
    ]
    const slots = mapPurchasesToAddons(purchased, catalog([OUT_OF_STOCK, LUBE]), new Set())
    expect(slots.map((s) => s.handle)).toEqual(['slow-hands-lube'])
  })

  it('defaults to an empty why when the purchase has no authored pairing_why for that accessory', () => {
    const purchased: PurchasedProductAccessories[] = [{ handle: 'a', accessoryProductIds: [WAND.id], pairingWhy: {} }]
    const slots = mapPurchasesToAddons(purchased, catalog([WAND]), new Set())
    expect(slots[0]!.why).toBe('')
  })

  it('returns no slots when there is no purchase history', () => {
    expect(mapPurchasesToAddons([], catalog([WAND]), new Set())).toEqual([])
  })
})

describe('mapGenericAddons (generic fallback)', () => {
  it('maps category-search candidates to slots with no pairing_why', () => {
    const slots = mapGenericAddons([WAND, LUBE], new Set())
    expect(slots).toHaveLength(2)
    for (const slot of slots) expect(slot.why).toBe('')
  })

  it('excludes already-purchased and out-of-stock candidates, same as owned mapping', () => {
    const slots = mapGenericAddons([WAND, OUT_OF_STOCK, LUBE], new Set(['the-compass-wand']))
    expect(slots.map((s) => s.handle)).toEqual(['slow-hands-lube'])
  })

  it('caps at 3', () => {
    const many: AddonCandidate[] = Array.from({ length: 5 }, (_, i) => ({
      id: `gid://shopify/Product/${100 + i}`, handle: `h${i}`, title: `T${i}`, imageUrl: 'https://cdn.shopify.com/x.jpg', inStock: true,
    }))
    expect(mapGenericAddons(many, new Set())).toHaveLength(3)
  })
})

describe('resolveAddonSlots', () => {
  it('prefers owned when at least one curated accessory survives', () => {
    const res = resolveAddonSlots({
      purchasedProducts: [{ handle: 'a', accessoryProductIds: [WAND.id], pairingWhy: {} }],
      ownedCatalog: catalog([WAND]),
      genericCandidates: [LUBE],
      purchasedHandles: new Set(),
    })
    expect(res.kind).toBe('owned')
    expect(res.slots.map((s) => s.handle)).toEqual(['the-compass-wand'])
  })

  it('falls back to generic when there is no purchase history', () => {
    const res = resolveAddonSlots({
      purchasedProducts: [],
      ownedCatalog: new Map(),
      genericCandidates: [LUBE],
      purchasedHandles: new Set(),
    })
    expect(res.kind).toBe('generic')
    expect(res.slots.map((s) => s.handle)).toEqual(['slow-hands-lube'])
  })

  it('falls back to generic when every curated accessory is excluded', () => {
    const res = resolveAddonSlots({
      purchasedProducts: [{ handle: 'a', accessoryProductIds: [OUT_OF_STOCK.id], pairingWhy: {} }],
      ownedCatalog: catalog([OUT_OF_STOCK]),
      genericCandidates: [LUBE],
      purchasedHandles: new Set(),
    })
    expect(res.kind).toBe('generic')
  })
})

describe('buildAddonProfileProperties (flat-key output shape)', () => {
  it('writes xdipx_addon_{1..3}_{handle,title,image,url,why}, kind, and updated_at', () => {
    const slots = [
      { handle: 'a', title: 'A', image: 'https://cdn.shopify.com/a.jpg', url: 'https://xdipx.com/products/a', why: 'Why A.' },
      { handle: 'b', title: 'B', image: 'https://cdn.shopify.com/b.jpg', url: 'https://xdipx.com/products/b', why: 'Why B.' },
    ]
    const props = buildAddonProfileProperties(slots, 'owned', '2026-10-14T00:00:00.000Z')
    expect(props).toEqual({
      xdipx_addons_kind: 'owned',
      xdipx_addons_updated_at: '2026-10-14T00:00:00.000Z',
      xdipx_addon_1_handle: 'a',
      xdipx_addon_1_title: 'A',
      xdipx_addon_1_image: 'https://cdn.shopify.com/a.jpg',
      xdipx_addon_1_url: 'https://xdipx.com/products/a',
      xdipx_addon_1_why: 'Why A.',
      xdipx_addon_2_handle: 'b',
      xdipx_addon_2_title: 'B',
      xdipx_addon_2_image: 'https://cdn.shopify.com/b.jpg',
      xdipx_addon_2_url: 'https://xdipx.com/products/b',
      xdipx_addon_2_why: 'Why B.',
    })
  })

  it('writes no addon_3_* keys when there are only 2 slots', () => {
    const props = buildAddonProfileProperties([{ handle: 'a', title: 'A', image: 'i', url: 'u', why: '' }], 'generic', 't')
    expect(Object.keys(props).some((k) => k.startsWith('xdipx_addon_3_'))).toBe(false)
  })

  it('writes zero addon keys, only kind and updated_at, when there are no slots', () => {
    const props = buildAddonProfileProperties([], 'generic', 't')
    expect(props).toEqual({ xdipx_addons_kind: 'generic', xdipx_addons_updated_at: 't' })
  })
})

describe('choosePlacedOrderMetricId', () => {
  it('picks the one candidate that has events when only one does', async () => {
    const hasEvents = vi.fn(async (id: string) => id === 'M2')
    const id = await choosePlacedOrderMetricId([{ id: 'M1' }, { id: 'M2' }], hasEvents)
    expect(id).toBe('M2')
  })

  it('prefers the Shopify-integration metric when more than one candidate has events', async () => {
    const hasEvents = vi.fn(async () => true)
    const id = await choosePlacedOrderMetricId(
      [{ id: 'CUSTOM', integrationName: 'API' }, { id: 'SHOPIFY', integrationName: 'Shopify' }],
      hasEvents,
    )
    expect(id).toBe('SHOPIFY')
  })

  it('returns null when nothing has events', async () => {
    const id = await choosePlacedOrderMetricId([{ id: 'M1' }], vi.fn(async () => false))
    expect(id).toBeNull()
  })
})

describe('syncAddonsForProfile', () => {
  function makeDeps(overrides: Partial<AddonSyncDeps> = {}): AddonSyncDeps {
    return {
      getPurchasedProducts: vi.fn(async () => []),
      getPurchasedHandles: vi.fn(async () => new Set<string>()),
      getOwnedCatalog: vi.fn(async () => new Map<string, AddonCandidate>()),
      getGenericCandidates: vi.fn(async () => [LUBE]),
      updateProfileProperties: vi.fn(async () => {}),
      now: () => '2026-10-14T00:00:00.000Z',
      ...overrides,
    }
  }

  it('writes an owned block and never calls getGenericCandidates when owned mapping succeeds', async () => {
    const purchased: PurchasedProductAccessories[] = [{ handle: 'a', accessoryProductIds: [WAND.id], pairingWhy: {} }]
    const deps = makeDeps({
      getPurchasedProducts: vi.fn(async () => purchased),
      getOwnedCatalog: vi.fn(async () => catalog([WAND])),
    })
    const res = await syncAddonsForProfile({ id: 'P1', email: 'a@b.com' }, deps)

    expect(res).toEqual({ kind: 'owned', slotCount: 1 })
    expect(deps.getGenericCandidates).not.toHaveBeenCalled()
    expect(deps.updateProfileProperties).toHaveBeenCalledWith('a@b.com', expect.objectContaining({ xdipx_addons_kind: 'owned' }))
  })

  it('falls back to generic and calls updateProfileProperties with the generic kind when there is no purchase history', async () => {
    const deps = makeDeps()
    const res = await syncAddonsForProfile({ id: 'P2', email: 'c@d.com' }, deps)

    expect(res).toEqual({ kind: 'generic', slotCount: 1 })
    expect(deps.getGenericCandidates).toHaveBeenCalledOnce()
    expect(deps.updateProfileProperties).toHaveBeenCalledWith('c@d.com', expect.objectContaining({ xdipx_addons_kind: 'generic' }))
  })
})
