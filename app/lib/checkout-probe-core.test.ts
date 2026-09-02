import { describe, expect, it } from 'vitest'

import { classifyCheckoutStatus } from '~/lib/checkout-probe-core'

const CHECKOUT = 'https://xdipx.com/checkouts/cn/abc123?key=x'
const at = (status: number, over: Partial<{ finalUrl: string; body: string }> = {}) =>
  classifyCheckoutStatus({ status, finalUrl: CHECKOUT, body: '', ...over })

describe('what a checkout response means', () => {
  it('passes a rendered checkout', () => {
    const v = at(200, { body: '<h2>Order summary</h2><label>Contact information</label>' })
    expect(v.ok).toBe(true)
    expect(v.detail).toBeUndefined()
  })

  it('passes the bot wall, which is what production actually returns', () => {
    // Measured over 14 days: every single checkout-page step recorded exactly
    // 403. Cloudflare answers a headless agent that way regardless of UA, so
    // this tier asserts routing and the browser tier asserts the render.
    for (const s of [401, 403, 429]) {
      expect(at(s).ok, `status ${s}`).toBe(true)
      expect(at(s).detail).toMatch(/bot wall/)
    }
  })

  it('fails a checkout that is up but erroring', () => {
    // The gap Stage G5 closes. The old rule was "anything that is not a 404 is
    // fine", so a Shopify checkout returning 503 read as healthy and this
    // probe — the only signal permitted to page the owner by SMS — would have
    // printed GOOD straight through a checkout outage.
    for (const s of [500, 502, 503, 504]) {
      expect(at(s).ok, `status ${s}`).toBe(false)
      expect(at(s).detail).toMatch(/erroring, not bot-walled/)
    }
  })

  it('fails a dead checkout URL', () => {
    expect(at(404).ok).toBe(false)
    expect(at(404).detail).toMatch(/checkout URL dead/)
  })

  it('fails when the chain never reached a checkout path', () => {
    // A password-protected store bounces to the root, and a 200 on the root is
    // the most misleading possible success.
    const v = classifyCheckoutStatus({ status: 200, finalUrl: 'https://xdipx.com/', body: 'Order summary' })
    expect(v.ok).toBe(false)
    expect(v.detail).toMatch(/did not route to a Shopify checkout page/)
  })

  it('fails a status it does not recognise, rather than passing by default', () => {
    // "Not recognised" must never mean "fine" on the money path. 410 is the one
    // that matters most here: this store has archived products before, and a
    // gone checkout is not a bot wall.
    for (const s of [410, 451, 418]) {
      expect(at(s).ok, `status ${s}`).toBe(false)
      expect(at(s).detail).toMatch(/unexpected status/)
    }
  })

  it('fails a transport error and keeps its reason', () => {
    const v = classifyCheckoutStatus({ status: 0, finalUrl: CHECKOUT, body: '', detail: 'ETIMEDOUT' })
    expect(v.ok).toBe(false)
    expect(v.detail).toBe('ETIMEDOUT')
  })

  it('passes a 200 with no render markers, and says why', () => {
    // Not every healthy render carries the markers, and failing on their absence
    // would make the HTTP tier duplicate the browser tier's job badly.
    const v = at(200, { body: '<html>something else</html>' })
    expect(v.ok).toBe(true)
    expect(v.detail).toMatch(/browser tier/)
  })
})
