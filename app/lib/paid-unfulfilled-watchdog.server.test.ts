// Ticket #13155: the Shopify-fetch + blocker-filing glue. The age/weekend/
// cancelled/test decision itself is covered in paid-unfulfilled-watchdog.test.ts
// against the pure filter; this only checks that a stuck order files one
// blocker with the right dedupe key and verify arg, and that a non-stuck one
// (too fresh) files nothing.
import { afterEach, describe, expect, it, vi } from 'vitest'

const adminGraphQLMock = vi.fn()
vi.mock('~/lib/shopify.server', () => ({
  adminGraphQL: (...args: unknown[]) => adminGraphQLMock(...args),
}))

const fileBlockerMock = vi.fn()
vi.mock('~/lib/owner-blockers.server', () => ({
  fileBlocker: (...args: unknown[]) => fileBlockerMock(...args),
}))

import { checkPaidUnfulfilledOrders } from './paid-unfulfilled-watchdog.server'

describe('checkPaidUnfulfilledOrders', () => {
  afterEach(() => {
    adminGraphQLMock.mockReset()
    fileBlockerMock.mockReset()
  })

  it('files one blocker for a genuinely stuck order and skips a fresh one', async () => {
    const now = new Date('2026-10-07T12:00:00Z') // Wednesday noon
    adminGraphQLMock.mockResolvedValueOnce({
      orders: {
        nodes: [
          {
            id: 'gid://shopify/Order/1', name: '#1001',
            createdAt: '2026-10-05T00:00:00Z', // ~60h old: stuck
            cancelledAt: null, test: false,
            displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'UNFULFILLED',
          },
          {
            id: 'gid://shopify/Order/2', name: '#1002',
            createdAt: '2026-10-07T10:00:00Z', // 2h old: fresh, not stuck
            cancelledAt: null, test: false,
            displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'UNFULFILLED',
          },
        ],
      },
    })
    fileBlockerMock.mockResolvedValue({ id: 1, created: true })

    const result = await checkPaidUnfulfilledOrders(now)

    expect(result.scanned).toBe(2)
    expect(result.stuck.map(o => o.name)).toEqual(['#1001'])
    expect(result.filed).toEqual(['#1001'])
    expect(fileBlockerMock).toHaveBeenCalledTimes(1)
    const call = fileBlockerMock.mock.calls[0]![0] as Record<string, unknown>
    expect(call['dedupeKey']).toBe('paid-unfulfilled-#1001')
    expect(call['verifyProbe']).toBe('order_fulfilled')
    expect(call['verifyArg']).toBe('#1001|gid://shopify/Order/1')
    expect(call['category']).toBe('other')
    expect(call['priority']).toBe(1)
  })

  it('files nothing when no candidate is stuck', async () => {
    const now = new Date('2026-10-07T12:00:00Z')
    adminGraphQLMock.mockResolvedValueOnce({
      orders: { nodes: [{
        id: 'gid://shopify/Order/3', name: '#1003',
        createdAt: '2026-10-07T10:00:00Z',
        cancelledAt: null, test: false,
        displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'UNFULFILLED',
      }] },
    })

    const result = await checkPaidUnfulfilledOrders(now)

    expect(result.stuck).toEqual([])
    expect(result.filed).toEqual([])
    expect(fileBlockerMock).not.toHaveBeenCalled()
  })

  it('swallows a fileBlocker failure for one order rather than failing the whole sweep', async () => {
    const now = new Date('2026-10-07T12:00:00Z')
    adminGraphQLMock.mockResolvedValueOnce({
      orders: { nodes: [{
        id: 'gid://shopify/Order/4', name: '#1004',
        createdAt: '2026-10-05T00:00:00Z',
        cancelledAt: null, test: false,
        displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'UNFULFILLED',
      }] },
    })
    fileBlockerMock.mockRejectedValueOnce(new Error('db hiccup'))

    const result = await checkPaidUnfulfilledOrders(now)

    expect(result.stuck.map(o => o.name)).toEqual(['#1004'])
    expect(result.filed).toEqual([])
  })
})
