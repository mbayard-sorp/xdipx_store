/**
 * The Klaviyo email-resolution fallback for review invites (ticket #19525).
 * All DB/Klaviyo side effects are an injected `ResolveDeps`, so this file
 * touches no network and no database — it covers the DONE WHEN clauses:
 * an order with an empty-email webhook gets one scheduled invite per
 * distinct product; replaying the same order does not duplicate; and a
 * Klaviyo miss is recorded with an attempt count rather than retried
 * forever.
 */
import { describe, expect, it, vi } from 'vitest'
import { resolveMissingEmailInvites, type ResolveDeps } from './review-klaviyo-fallback.server'
import type { FulfilledOrderMatch } from './klaviyo-order-email.server'

function fakeDeps(overrides: Partial<ResolveDeps> = {}): ResolveDeps & { createInviteCalls: unknown[] } {
  const createInviteCalls: unknown[] = []
  const deps: ResolveDeps = {
    listPendingOrderIds: async () => ['111'],
    resolveEmail: async (): Promise<FulfilledOrderMatch | null> => ({
      email: 'buyer@example.com',
      reviewerName: 'Jordan Rivera',
      lineItems: [
        { sku: 'SKU-A', productId: '1001' },
        { sku: 'SKU-A-VARIANT', productId: '1001' }, // same product, different SKU
        { sku: 'SKU-B', productId: '2002' },
      ],
    }),
    getInvitedProductIds: async () => new Set<string>(),
    createInvite: async (input) => {
      createInviteCalls.push(input)
      return {}
    },
    recordOutcome: vi.fn(async () => {}),
    countMissAttempts: async () => 0,
    inviteDelayDays: 7,
    ...overrides,
  }
  return { ...deps, createInviteCalls }
}

describe('resolveMissingEmailInvites', () => {
  it('creates one scheduled invite per distinct product for an order Klaviyo resolves', async () => {
    const deps = fakeDeps()
    const result = await resolveMissingEmailInvites(deps)

    expect(deps.createInviteCalls).toHaveLength(2) // SKU-A/1001 and SKU-B/2002, not 3
    expect(deps.createInviteCalls).toEqual([
      expect.objectContaining({ shopifyOrderId: '111', shopifyProductId: 'gid://shopify/Product/1001', reviewerEmail: 'buyer@example.com', reviewerName: 'Jordan Rivera' }),
      expect.objectContaining({ shopifyOrderId: '111', shopifyProductId: 'gid://shopify/Product/2002' }),
    ])
    for (const call of deps.createInviteCalls as { sendAfter?: Date }[]) {
      expect(call.sendAfter).toBeInstanceOf(Date)
    }
    expect(result).toEqual({ invited: 1, missed: 0, matchedNoLineItems: 0 })
    expect(deps.recordOutcome).toHaveBeenCalledWith('111', 'invited', expect.stringContaining('Klaviyo'))
  })

  it('never double-invites a product already in review_invites (replay safety)', async () => {
    const deps = fakeDeps({
      getInvitedProductIds: async () => new Set(['gid://shopify/Product/1001']),
    })
    await resolveMissingEmailInvites(deps)
    expect(deps.createInviteCalls).toHaveLength(1)
    expect(deps.createInviteCalls[0]).toMatchObject({ shopifyProductId: 'gid://shopify/Product/2002' })
  })

  it('falls back to "Customer" when Klaviyo has no profile name', async () => {
    const deps = fakeDeps({
      resolveEmail: async () => ({ email: 'buyer@example.com', reviewerName: null, lineItems: [{ sku: 'SKU-A', productId: '1001' }] }),
    })
    await resolveMissingEmailInvites(deps)
    expect(deps.createInviteCalls[0]).toMatchObject({ reviewerName: 'Customer' })
  })

  it('records a miss with the attempt count when Klaviyo has no matching event yet', async () => {
    const deps = fakeDeps({
      resolveEmail: async () => null,
      countMissAttempts: async () => 1, // two prior misses recorded
    })
    const result = await resolveMissingEmailInvites(deps)
    expect(deps.createInviteCalls).toHaveLength(0)
    expect(result).toEqual({ invited: 0, missed: 1, matchedNoLineItems: 0 })
    expect(deps.recordOutcome).toHaveBeenCalledWith('111', 'no_invite_created', 'klaviyo_miss_attempt_2_of_3')
  })

  it('records a distinct outcome when Klaviyo matches the order but it has no usable line items', async () => {
    const deps = fakeDeps({
      resolveEmail: async () => ({ email: 'buyer@example.com', reviewerName: null, lineItems: [] }),
    })
    const result = await resolveMissingEmailInvites(deps)
    expect(deps.createInviteCalls).toHaveLength(0)
    expect(result).toEqual({ invited: 0, missed: 0, matchedNoLineItems: 1 })
    expect(deps.recordOutcome).toHaveBeenCalledWith('111', 'no_invite_created', expect.stringContaining('no usable line items'))
  })

  it('one order failing does not stop the rest from resolving', async () => {
    const deps = fakeDeps({
      listPendingOrderIds: async () => ['111', '222'],
      resolveEmail: async (orderId) => {
        if (orderId === '111') throw new Error('klaviyo down')
        return { email: 'buyer2@example.com', reviewerName: null, lineItems: [{ sku: 'SKU-C', productId: '3003' }] }
      },
    })
    const result = await resolveMissingEmailInvites(deps)
    expect(result.invited).toBe(1)
    expect(deps.createInviteCalls).toHaveLength(1)
    expect(deps.createInviteCalls[0]).toMatchObject({ shopifyOrderId: '222' })
  })
})
