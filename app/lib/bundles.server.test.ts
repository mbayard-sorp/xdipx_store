// Regression guard for ticket #3448 finding (2): buildBundle() clamped an
// authored bundleDiscountPct to [0, 90], which let anyone authoring a bundle
// in Sanity set a discount that destroys contribution margin with no gate
// (break-even on a two-consumable bundle is ~8.5%; the clamp allowed 90%).
// The fix caps the clamp at 5.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
vi.mock('@sanity/client', () => ({
  createClient: () => ({ fetch: fetchMock }),
}))

const shopifyMock = vi.hoisted(() => ({ getProductsByHandles: vi.fn() }))
vi.mock('~/lib/shopify.server', () => shopifyMock)

// Bypass the KV cache so every call re-runs the fetcher.
vi.mock('~/lib/kv.server', () => ({
  cached: async (_k: string, _t: number, fn: () => unknown) => fn(),
}))

beforeEach(() => {
  process.env['SANITY_PROJECT_ID'] = 'test-project'
  fetchMock.mockReset()
  shopifyMock.getProductsByHandles.mockReset()
})

describe('buildBundle discount clamp', () => {
  it('clamps a 25% authored discount down to the 5% ceiling', async () => {
    const { getBundleByHandle } = await import('./bundles.server')

    fetchMock.mockResolvedValue({
      shopifyHandle: 'first-time-kit',
      title: 'First-Time Kit',
      bundleDiscountPct: 25,
      components: [
        { quantity: 1, handle: 'anchor-vibrator' },
        { quantity: 1, handle: 'lube-4oz' },
      ],
    })
    shopifyMock.getProductsByHandles.mockResolvedValue([
      { handle: 'anchor-vibrator', price: 89, compareAtPrice: null, images: [], variants: [{ id: 'gid://v1' }] },
      { handle: 'lube-4oz', price: 14, compareAtPrice: null, images: [], variants: [{ id: 'gid://v2' }] },
    ])

    const bundle = await getBundleByHandle('first-time-kit')
    expect(bundle).not.toBeNull()
    expect(bundle!.discountPct).toBe(5)
    expect(bundle!.bundlePrice).toBeCloseTo(103 * 0.95, 2)
  })

  it('leaves a 0-5% authored discount untouched', async () => {
    const { getBundleByHandle } = await import('./bundles.server')

    fetchMock.mockResolvedValue({
      shopifyHandle: 'couples-night',
      title: 'Couples Night',
      bundleDiscountPct: 3,
      components: [{ quantity: 1, handle: 'anchor-vibrator' }],
    })
    shopifyMock.getProductsByHandles.mockResolvedValue([
      { handle: 'anchor-vibrator', price: 89, compareAtPrice: null, images: [], variants: [{ id: 'gid://v1' }] },
    ])

    const bundle = await getBundleByHandle('couples-night')
    expect(bundle!.discountPct).toBe(3)
  })

  it('never lets a negative authored discount through either', async () => {
    const { getBundleByHandle } = await import('./bundles.server')

    fetchMock.mockResolvedValue({
      shopifyHandle: 'weird-bundle',
      title: 'Weird Bundle',
      bundleDiscountPct: -10,
      components: [{ quantity: 1, handle: 'anchor-vibrator' }],
    })
    shopifyMock.getProductsByHandles.mockResolvedValue([
      { handle: 'anchor-vibrator', price: 89, compareAtPrice: null, images: [], variants: [{ id: 'gid://v1' }] },
    ])

    const bundle = await getBundleByHandle('weird-bundle')
    expect(bundle!.discountPct).toBe(0)
  })
})
