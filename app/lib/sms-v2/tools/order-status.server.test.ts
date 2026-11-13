import { beforeEach, describe, expect, it, vi } from 'vitest'

// Ticket #21797 (split off #21753): orderStatusLookupImpl must resolve an
// order by orderName directly, without touching the Shopify Customer object
// via findCustomerByPhone, whenever an orderName is already in hand —
// findCustomerByPhone needs Protected Customer Data access this store's
// Shopify plan does not have, and it throws a hard Admin API error rather
// than returning null when that access is denied (confirmed live, #21753).

const { findCustomerByPhone, adminGraphQL, shopifyAdmin } = vi.hoisted(() => ({
  findCustomerByPhone: vi.fn(),
  adminGraphQL: vi.fn(),
  shopifyAdmin: vi.fn(),
}))

vi.mock('~/lib/shopify.server', () => ({ findCustomerByPhone, adminGraphQL, shopifyAdmin }))

import { orderStatusLookup, OrderNotFoundError } from './order-status.server'

const SHOPIFY_ORDER = {
  id: 'gid://shopify/Order/1',
  name: '#1042',
  displayFinancialStatus: 'PAID',
  displayFulfillmentStatus: 'UNFULFILLED',
  processedAt: '2026-11-01T00:00:00Z',
  cancelledAt: null,
  refunds: [],
  fulfillments: [],
}

const REST_ORDER = {
  id: 1,
  name: '#1042',
  financial_status: 'paid',
  fulfillment_status: null,
  processed_at: '2026-11-01T00:00:00Z',
  cancelled_at: null,
  refunds: [],
  fulfillments: [],
}

beforeEach(() => {
  findCustomerByPhone.mockReset()
  adminGraphQL.mockReset()
  shopifyAdmin.mockReset()
})

describe('orderStatusLookup — orderName-first precedence (ticket #21797)', () => {
  it('resolves by orderName without ever calling findCustomerByPhone when phone and orderName are both given', async () => {
    adminGraphQL.mockResolvedValue({ orders: { nodes: [SHOPIFY_ORDER] } })

    const result = await orderStatusLookup({ phone: '+16025551234', orderName: '#1042' })

    expect(result.orderName).toBe('#1042')
    expect(findCustomerByPhone).not.toHaveBeenCalled()
    expect(adminGraphQL).toHaveBeenCalledWith(
      expect.stringContaining('OrderByName'),
      { q: 'name:#1042' },
    )
  })

  it('still resolves by orderName even when findCustomerByPhone would throw a hard Customer-object error', async () => {
    findCustomerByPhone.mockRejectedValue(
      new Error('This app is not approved to access the Customer object'),
    )
    adminGraphQL.mockResolvedValue({ orders: { nodes: [SHOPIFY_ORDER] } })

    const result = await orderStatusLookup({ phone: '+16025551234', orderName: '#1042' })

    expect(result.orderName).toBe('#1042')
    expect(findCustomerByPhone).not.toHaveBeenCalled()
  })

  it('falls back to phone-based customer resolution when no orderName is given', async () => {
    findCustomerByPhone.mockResolvedValue({
      id: 'gid://shopify/Customer/42',
      email: null,
      firstName: null,
      lastName: null,
      defaultAddress: null,
    })
    shopifyAdmin.mockResolvedValue({ orders: [REST_ORDER] })

    const result = await orderStatusLookup({ phone: '+16025551234' })

    expect(result.orderName).toBe('#1042')
    expect(findCustomerByPhone).toHaveBeenCalledWith('+16025551234')
    expect(adminGraphQL).not.toHaveBeenCalled()
  })

  it('still scopes to the customer when a customerGid is given alongside orderName', async () => {
    shopifyAdmin.mockResolvedValue({ orders: [REST_ORDER] })

    const result = await orderStatusLookup({
      customerGid: 'gid://shopify/Customer/42',
      orderName: '#1042',
    })

    expect(result.orderName).toBe('#1042')
    expect(findCustomerByPhone).not.toHaveBeenCalled()
    expect(shopifyAdmin).toHaveBeenCalledWith(expect.stringContaining('/customers/42/orders.json'))
  })

  it('throws OrderNotFoundError when the orderName does not resolve to any order', async () => {
    adminGraphQL.mockResolvedValue({ orders: { nodes: [] } })

    await expect(
      orderStatusLookup({ phone: '+16025551234', orderName: '#9999' }),
    ).rejects.toThrow(OrderNotFoundError)
    expect(findCustomerByPhone).not.toHaveBeenCalled()
  })
})
