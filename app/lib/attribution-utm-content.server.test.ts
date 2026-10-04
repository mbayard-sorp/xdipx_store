/**
 * Ad Studio v2 PR-H: the creative id (utm_content) must reach the cart as the
 * `_utm_content` attribute so order attribution (ad-metrics resolver step 1)
 * finds it on the order. utm_source, utm_medium and utm_campaign keep stamping
 * exactly as before.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/customer-session.server', () => ({ getCustomerToken: vi.fn(async () => null) }))
const setCartAttributes = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('~/lib/shopify.server', () => ({
  getCustomerProfile: vi.fn(),
  setCartAttributes,
}))

import { applyAttributionAttrs, attributionCartAttrs } from '~/lib/attribution-cart.server'
import { captureUTM } from '~/lib/attribution.server'
import { extractOrderUtmContent } from '~/lib/ad-metrics-core'

const cookieFor = (utm: Record<string, unknown>) =>
  `__xdipx_utm=${encodeURIComponent(JSON.stringify({ capturedAt: '2026-10-03T00:00:00.000Z', ...utm }))}`
const req = (cookie?: string) => new Request('https://xdipx.com/cart', { headers: cookie ? { Cookie: cookie } : {} })
const attrMap = (r: Request) => Object.fromEntries(attributionCartAttrs(r).map(a => [a.key, a.value]))

describe('cart attributes carry the creative id', () => {
  it('stamps _utm_content with the other three UTM attributes', () => {
    const attrs = attrMap(req(cookieFor({ source: 'meta', medium: 'paid_social', campaign: '7', content: '1234' })))
    expect(attrs).toMatchObject({ _utm_source: 'meta', _utm_medium: 'paid_social', _utm_campaign: '7', _utm_content: '1234' })
  })

  it('stamps _utm_content when it is the only UTM field the visitor carried', () => {
    const attrs = attrMap(req(cookieFor({ source: null, medium: null, campaign: null, content: '88' })))
    expect(attrs['_utm_content']).toBe('88')
    expect(attrs).not.toHaveProperty('_utm_source')
  })

  it('trims and bounds the value, and skips a blank one', () => {
    expect(attrMap(req(cookieFor({ source: 'google', content: '  sample-creative-9  ' })))['_utm_content']).toBe('sample-creative-9')
    expect(attrMap(req(cookieFor({ source: 'google', content: 'x'.repeat(400) })))['_utm_content']).toHaveLength(255)
    expect(attrMap(req(cookieFor({ source: 'google', content: '   ' })))).not.toHaveProperty('_utm_content')
  })

  it('writes nothing for a visitor with no UTM cookie', () => {
    expect(attributionCartAttrs(req())).toEqual([])
  })

  it('applyAttributionAttrs puts the attribute on the cart, and the resolver reads it back off the order', async () => {
    setCartAttributes.mockClear()
    await applyAttributionAttrs('gid://shopify/Cart/1', req(cookieFor({ source: 'meta', content: '1234' })))
    expect(setCartAttributes).toHaveBeenCalledTimes(1)
    const [cartId, attrs] = setCartAttributes.mock.calls[0] as unknown as [string, Array<{ key: string; value: string }>]
    expect(cartId).toBe('gid://shopify/Cart/1')
    expect(attrs).toContainEqual({ key: '_utm_content', value: '1234' })
    // Shopify copies cart attributes to the order's note attributes under the same keys.
    expect(extractOrderUtmContent({ customAttributes: attrs })).toEqual({ value: '1234', source: 'note_attribute' })
  })
})

describe('captureUTM keeps a utm_content-only landing', () => {
  const landing = (qs: string) => captureUTM(new Request(`https://xdipx.com/products/x?${qs}`))

  it('writes the cookie when utm_content is the only parameter', () => {
    const out = landing('utm_content=1234')
    expect(out.utm).toMatchObject({ content: '1234', source: null })
    expect(out.cookies.join(';')).toContain('__xdipx_utm=')
    expect(decodeURIComponent(out.cookies[0]!)).toContain('"content":"1234"')
  })

  it('still writes the full set for a normal ad click', () => {
    const out = landing('utm_source=meta&utm_medium=paid_social&utm_campaign=7&utm_content=1234')
    expect(out.utm).toMatchObject({ source: 'meta', medium: 'paid_social', campaign: '7', content: '1234' })
  })

  it('writes nothing on an ordinary request, so pages stay edge-cacheable', () => {
    expect(landing('page=2').cookies).toEqual([])
  })
})
