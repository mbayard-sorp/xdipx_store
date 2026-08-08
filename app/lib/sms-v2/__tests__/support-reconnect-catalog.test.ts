import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EmmaContext, IntentResult, StageResponse } from '~/lib/sms-v2/types.server'

// ticket #620: SUPPORT and RECONNECT are deterministic stages with no catalog
// access, so a product question ("do you sell X?") arriving mid-support was
// answered with an order-status template or a reconnect greeting. They now hand
// a NAME_ITEM (the classifier's product/category intent) to the shared catalog
// search (runCatalogLookup) so the customer gets real, MAP-priced results.

const runCatalogLookup = vi.fn<(...a: unknown[]) => Promise<StageResponse>>()
const orderStatusLookup = vi.fn()

vi.mock('~/lib/sms-v2/stages/discovery.server', () => ({ runCatalogLookup }))
vi.mock('~/lib/sms-v2/tools/order-status.server', () => ({
  orderStatusLookup,
  OrderNotFoundError: class OrderNotFoundError extends Error {},
}))

afterEach(() => {
  runCatalogLookup.mockReset()
  orderStatusLookup.mockReset()
})

const CATALOG_RESULT = {
  segments: [{ prose: 'Here are three that fit.' }],
} as unknown as StageResponse
const ctx = { conversation: { phone: '+15550000000' }, customer: null } as unknown as EmmaContext
const nameItem: IntentResult = { intent: 'NAME_ITEM', confidence: 0.9, source: 'regex' }
const supportIntent: IntentResult = { intent: 'SUPPORT', confidence: 0.9, source: 'regex' }

describe('SUPPORT stage catalog access (ticket #620)', () => {
  it('routes a NAME_ITEM product question to the shared catalog search', async () => {
    const { executeSupportStage } = await import('~/lib/sms-v2/stages/support.server')
    runCatalogLookup.mockResolvedValue(CATALOG_RESULT)

    const res = await executeSupportStage(ctx, nameItem, 'do you sell wands?')

    expect(runCatalogLookup).toHaveBeenCalledWith(ctx, nameItem, 'do you sell wands?')
    expect(orderStatusLookup).not.toHaveBeenCalled()
    expect(res).toBe(CATALOG_RESULT)
  })

  it('still does an order-status lookup for a genuine support intent', async () => {
    const { executeSupportStage } = await import('~/lib/sms-v2/stages/support.server')
    const { OrderNotFoundError } = await import('~/lib/sms-v2/tools/order-status.server')
    orderStatusLookup.mockRejectedValue(new OrderNotFoundError('none'))

    const res = await executeSupportStage(ctx, supportIntent, 'where is my order?')

    expect(orderStatusLookup).toHaveBeenCalledTimes(1)
    expect(runCatalogLookup).not.toHaveBeenCalled()
    expect(res.stateWrites).toMatchObject({ stage: 'SUPPORT' })
  })
})

describe('RECONNECT stage catalog access (ticket #620)', () => {
  it('routes a NAME_ITEM product question to the shared catalog search', async () => {
    const { executeReconnectStage } = await import('~/lib/sms-v2/stages/reconnect.server')
    runCatalogLookup.mockResolvedValue(CATALOG_RESULT)

    const res = await executeReconnectStage(ctx, nameItem, 'do you carry lube?')

    expect(runCatalogLookup).toHaveBeenCalledWith(ctx, nameItem, 'do you carry lube?')
    expect(res).toBe(CATALOG_RESULT)
  })
})
