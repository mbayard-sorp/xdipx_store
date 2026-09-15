/**
 * ticket #9329: for logged-in-account checkouts, stamp the customer's own
 * email (from the Customer Account API self-auth session, the same one
 * api.cart.tsx already uses successfully for trackAddedToCart) onto the cart
 * as `_customer_email`, so it rides to order.note_attributes the same way
 * `_ref_code` already does. Guest checkouts are unaffected: no token means no
 * attribute, exactly like every other attribution field here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getCustomerTokenMock = vi.fn()
vi.mock('~/lib/customer-session.server', () => ({
  getCustomerToken: (...args: unknown[]) => getCustomerTokenMock(...args),
}))

const getCustomerProfileMock = vi.fn()
vi.mock('~/lib/shopify.server', () => ({
  getCustomerProfile: (...args: unknown[]) => getCustomerProfileMock(...args),
  setCartAttributes: vi.fn(),
}))

import { customerEmailCartAttr } from '~/lib/attribution-cart.server'

const fakeRequest = new Request('https://xdipx.com/')

beforeEach(() => {
  getCustomerTokenMock.mockReset()
  getCustomerProfileMock.mockReset()
})

describe('customerEmailCartAttr', () => {
  it('stamps _customer_email for a logged-in storefront-token customer', async () => {
    getCustomerTokenMock.mockResolvedValue({ token: 'tok_123', tokenType: 'storefront' })
    getCustomerProfileMock.mockResolvedValue({ email: 'shopper@example.com' })

    expect(await customerEmailCartAttr(fakeRequest)).toEqual([
      { key: '_customer_email', value: 'shopper@example.com' },
    ])
  })

  it('returns empty for a guest (no token)', async () => {
    getCustomerTokenMock.mockResolvedValue(null)

    expect(await customerEmailCartAttr(fakeRequest)).toEqual([])
    expect(getCustomerProfileMock).not.toHaveBeenCalled()
  })

  it('returns empty for a non-storefront token type', async () => {
    getCustomerTokenMock.mockResolvedValue({ token: 'tok_123', tokenType: 'account' })

    expect(await customerEmailCartAttr(fakeRequest)).toEqual([])
    expect(getCustomerProfileMock).not.toHaveBeenCalled()
  })

  it('returns empty, never throws, when the profile fetch fails', async () => {
    getCustomerTokenMock.mockResolvedValue({ token: 'tok_123', tokenType: 'storefront' })
    getCustomerProfileMock.mockRejectedValue(new Error('storefront API down'))

    await expect(customerEmailCartAttr(fakeRequest)).resolves.toEqual([])
  })

  it('returns empty when the profile has no email', async () => {
    getCustomerTokenMock.mockResolvedValue({ token: 'tok_123', tokenType: 'storefront' })
    getCustomerProfileMock.mockResolvedValue(null)

    expect(await customerEmailCartAttr(fakeRequest)).toEqual([])
  })
})
