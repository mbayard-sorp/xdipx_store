/**
 * Ticket #11442: app/routes/api.pricing.audit-action.tsx had no dedicated
 * test file, confirmed via `find` both before and after PR #1332, which fixed
 * a marginAfter recompute bug there (edit-approve with a custom sell price
 * left marginAfter computed against the originally queued newSell instead of
 * the price actually applied). This file covers approve and edit-approve,
 * including that exact regression case, plus the route's other branches
 * (reject, validation, not-pending, Shopify failure).
 *
 * db.server, session.server, and shopify.server are all mocked; nothing here
 * touches the real database or Shopify.
 *
 * Lives in app/lib rather than next to the route: anything under app/routes
 * is picked up by flatRoutes/typegen as a route module, tests included (same
 * note as api-team-run.test.ts and its siblings).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireAdminMock = vi.hoisted(() => vi.fn(async () => {}))
const getAdminUserMock = vi.hoisted(() => vi.fn(async () => ({
  id: 1, neonAuthUserId: '', email: 'owner@xdipx.com', name: 'Owner',
})))
const updateVariantPricingMock = vi.hoisted(() => vi.fn(async () => {}))
const selectResult = vi.hoisted(() => ({ rows: [] as unknown[] }))
const updateCalls = vi.hoisted(() => [] as { values: Record<string, unknown> }[])

vi.mock('~/lib/session.server', () => ({
  requireAdmin: requireAdminMock,
  getAdminUser: getAdminUserMock,
}))
vi.mock('~/lib/db.server', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectResult.rows,
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => { updateCalls.push({ values }); return undefined },
      }),
    }),
  },
}))
vi.mock('~/lib/shopify.server', () => ({
  updateVariantPricing: updateVariantPricingMock,
}))

import { action } from '~/routes/api.pricing.audit-action'

function postForm(fields: Record<string, string>): Request {
  const body = new URLSearchParams(fields)
  return new Request('https://xdipx.com/api/pricing/audit-action', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
}

function pendingRow(over: Record<string, unknown> = {}) {
  return {
    id: 42,
    variantId: 'gid://shopify/ProductVariant/9001',
    sku: 'SKU-1',
    newSell: '20.00',
    newCompareAt: '25.00',
    newCost: '10.00',
    marginAfter: '0.5000',
    status: 'pending',
    rationale: 'daily pricing sweep',
    ...over,
  }
}

beforeEach(() => {
  requireAdminMock.mockClear()
  getAdminUserMock.mockClear()
  updateVariantPricingMock.mockClear()
  updateVariantPricingMock.mockResolvedValue(undefined)
  selectResult.rows = []
  updateCalls.length = 0
})

describe('api.pricing.audit-action', () => {
  it('requires admin auth before touching the database', async () => {
    selectResult.rows = [pendingRow()]
    await action({ request: postForm({ action: 'approve', auditId: '42' }) } as never)
    expect(requireAdminMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a request with no auditId', async () => {
    const res = await action({ request: postForm({ action: 'approve' }) } as never)
    const json = await (res as Response).json()
    expect(res).toBeInstanceOf(Response)
    expect((res as Response).status).toBe(400)
    expect(json.ok).toBe(false)
  })

  it('404s when the audit row does not exist', async () => {
    selectResult.rows = []
    const res = await action({ request: postForm({ action: 'approve', auditId: '999' }) } as never)
    expect((res as Response).status).toBe(404)
    expect(updateVariantPricingMock).not.toHaveBeenCalled()
  })

  it('refuses a row that is not pending (already applied or rejected)', async () => {
    selectResult.rows = [pendingRow({ status: 'applied' })]
    const res = await action({ request: postForm({ action: 'approve', auditId: '42' }) } as never)
    const json = await (res as Response).json()
    expect((res as Response).status).toBe(400)
    expect(json.error).toContain('already applied')
    expect(updateVariantPricingMock).not.toHaveBeenCalled()
  })

  it('reject sets status to rejected and never calls Shopify', async () => {
    selectResult.rows = [pendingRow()]
    const res = await action({ request: postForm({ action: 'reject', auditId: '42' }) } as never)
    const json = await (res as Response).json()
    expect(json).toEqual({ ok: true, status: 'rejected' })
    expect(updateVariantPricingMock).not.toHaveBeenCalled()
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0]!.values['status']).toBe('rejected')
  })

  it('plain approve applies the queued newSell as-is and recomputes marginAfter from it', async () => {
    selectResult.rows = [pendingRow()] // newSell 20.00, newCost 10.00 -> margin 0.5
    const res = await action({ request: postForm({ action: 'approve', auditId: '42' }) } as never)
    const json = await (res as Response).json()

    expect(json).toEqual({ ok: true, status: 'applied', appliedSell: '20.00' })
    expect(updateVariantPricingMock).toHaveBeenCalledWith(
      'gid://shopify/ProductVariant/9001', '20.00', '25.00',
    )
    expect(updateCalls).toHaveLength(1)
    const values = updateCalls[0]!.values
    expect(values['status']).toBe('applied')
    expect(values['newSell']).toBe('20.00')
    expect(values['marginAfter']).toBe('0.5')
  })

  // The exact regression PR #1332 fixed: edit-approve with a custom sell
  // price must recompute marginAfter from the price actually applied, not
  // the originally queued newSell the row was computed against.
  it('edit-approve recomputes marginAfter from the applied custom price, not the queued price', async () => {
    // Queued: newSell 20.00 against newCost 10.00 -> queued margin 0.5.
    // Applied: a human overrides to 15.00 -> correct margin is (15-10)/15.
    selectResult.rows = [pendingRow({ marginAfter: '0.5000' })]
    const res = await action({
      request: postForm({ action: 'edit-approve', auditId: '42', customSell: '15.00' }),
    } as never)
    const json = await (res as Response).json()

    expect(json).toEqual({ ok: true, status: 'applied', appliedSell: '15.00' })
    // Shopify gets the applied price, not the stale queued price.
    expect(updateVariantPricingMock).toHaveBeenCalledWith(
      'gid://shopify/ProductVariant/9001', '15.00', '25.00',
    )
    const values = updateCalls[0]!.values
    expect(values['newSell']).toBe('15.00')
    // (15 - 10) / 15 = 0.3333..., rounded to 4dp — must NOT be the stale 0.5
    // the row was queued with.
    expect(values['marginAfter']).toBe('0.3333')
    expect(values['marginAfter']).not.toBe('0.5000')
    expect(values['rationale']).toContain('$15.00')
  })

  it('edit-approve with an empty customSell falls back to the queued newSell', async () => {
    selectResult.rows = [pendingRow()]
    const res = await action({
      request: postForm({ action: 'edit-approve', auditId: '42', customSell: '' }),
    } as never)
    const json = await (res as Response).json()
    expect(json).toEqual({ ok: true, status: 'applied', appliedSell: '20.00' })
    const values = updateCalls[0]!.values
    expect(values['marginAfter']).toBe('0.5')
  })

  it('returns 500 and writes nothing when the Shopify update fails', async () => {
    selectResult.rows = [pendingRow()]
    updateVariantPricingMock.mockRejectedValueOnce(new Error('Shopify 422'))
    const res = await action({ request: postForm({ action: 'approve', auditId: '42' }) } as never)
    const json = await (res as Response).json()
    expect((res as Response).status).toBe(500)
    expect(json.error).toContain('Shopify 422')
    expect(updateCalls).toHaveLength(0)
  })

  it('rejects an unknown action', async () => {
    selectResult.rows = [pendingRow()]
    const res = await action({ request: postForm({ action: 'nonsense', auditId: '42' }) } as never)
    expect((res as Response).status).toBe(400)
  })
})
