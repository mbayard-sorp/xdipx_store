import { beforeEach, describe, expect, it, vi } from 'vitest'

// conv-audit B3: the live SMS discovery agent must be able to answer order-status
// and policy questions. These reach the DISCOVERY stage (SUPPORT/RESEARCH stages
// are never transitioned into), so the fix routes them through two new
// discovery-agent tools that wrap the existing order-status / kb-lookup handlers.
// Here we assert runDiscoveryTool dispatches to those handlers and maps their
// results and errors into the { ok, data|error } shape the Sonnet loop expects.

const { orderStatusLookup, kbLookup, OrderNotFoundError } = vi.hoisted(() => {
  // Real error class so the runner's `err instanceof OrderNotFoundError` holds.
  class OrderNotFoundError extends Error {
    constructor(message = 'No order found') {
      super(message)
      this.name = 'OrderNotFoundError'
    }
  }
  return { orderStatusLookup: vi.fn(), kbLookup: vi.fn(), OrderNotFoundError }
})

vi.mock('../tools/order-status.server', () => ({ orderStatusLookup, OrderNotFoundError }))
vi.mock('../tools/kb-lookup.server', () => ({ kbLookup }))

import { runDiscoveryTool, type DiscoveryAgentToolContext } from '../discovery-agent-tools.server'

const smsCtx: DiscoveryAgentToolContext = { phone: '+16025551234', channel: 'sms' }
const webCtx: DiscoveryAgentToolContext = { phone: 'web:sess-1', channel: 'web' }

beforeEach(() => {
  orderStatusLookup.mockReset()
  kbLookup.mockReset()
})

describe('runDiscoveryTool — orderStatus', () => {
  it('looks up the latest order by caller phone and returns the status', async () => {
    orderStatusLookup.mockResolvedValue({
      orderName: '#1042',
      status: 'shipped',
      trackingNumber: '1Z999',
      refundEligible: true,
      cancelEligible: false,
    })

    const res = await runDiscoveryTool('orderStatus', {}, smsCtx)

    expect(orderStatusLookup).toHaveBeenCalledWith({ phone: '+16025551234' })
    expect(res.ok).toBe(true)
    expect(res.data).toMatchObject({ orderName: '#1042', status: 'shipped' })
  })

  it('passes a stated order name through to the lookup', async () => {
    orderStatusLookup.mockResolvedValue({
      orderName: '#1042',
      status: 'delivered',
      refundEligible: false,
      cancelEligible: false,
    })

    await runDiscoveryTool('orderStatus', { orderName: '#1042' }, smsCtx)

    expect(orderStatusLookup).toHaveBeenCalledWith({ phone: '+16025551234', orderName: '#1042' })
  })

  it('short-circuits on web chat (no phone) with a hand-off error', async () => {
    const res = await runDiscoveryTool('orderStatus', {}, webCtx)

    expect(orderStatusLookup).not.toHaveBeenCalled()
    expect(res.ok).toBe(false)
    expect(res.error).toBe('no_caller_phone')
  })

  it('maps OrderNotFoundError to a structured order_not_found result, not a throw', async () => {
    orderStatusLookup.mockRejectedValue(new OrderNotFoundError())

    const res = await runDiscoveryTool('orderStatus', {}, smsCtx)

    expect(res.ok).toBe(false)
    expect(res.error).toBe('order_not_found')
  })

  it('turns an unexpected lookup failure into tool_failed instead of crashing', async () => {
    orderStatusLookup.mockRejectedValue(new Error('shopify 500'))

    const res = await runDiscoveryTool('orderStatus', {}, smsCtx)

    expect(res.ok).toBe(false)
    expect(res.error).toBe('tool_failed')
  })
})

describe('runDiscoveryTool — lookupPolicy', () => {
  it('answers a returns question from the knowledge base', async () => {
    kbLookup.mockResolvedValue({
      topic: 'returns',
      quickAnswer: 'Unopened items can be returned within 30 days.',
      sourceId: 'kb-1',
      sourceTitle: 'Returns Policy',
    })

    const res = await runDiscoveryTool(
      'lookupPolicy',
      { topic: 'returns', query: "what's your return policy" },
      smsCtx,
    )

    expect(kbLookup).toHaveBeenCalledWith({ topic: 'returns', query: "what's your return policy" })
    expect(res.ok).toBe(true)
    expect(res.data).toMatchObject({ quickAnswer: 'Unopened items can be returned within 30 days.' })
  })

  it('rejects a topic outside the allowed enum without calling the KB', async () => {
    const res = await runDiscoveryTool('lookupPolicy', { topic: 'weather' }, smsCtx)

    expect(kbLookup).not.toHaveBeenCalled()
    expect(res.ok).toBe(false)
    expect(res.error).toBe('invalid_topic')
  })

  it('returns not_found when the KB has no matching entry', async () => {
    kbLookup.mockResolvedValue(null)

    const res = await runDiscoveryTool('lookupPolicy', { topic: 'shipping' }, smsCtx)

    expect(res.ok).toBe(false)
    expect(res.error).toBe('not_found')
  })
})
