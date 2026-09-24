import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EmmaContext, IntentResult } from '~/lib/sms-v2/types.server'

// ticket #11335: the first turn back into RECONNECT can itself be a direct,
// answerable question ("what's your phone number?") rather than small talk.
// The old handler special-cased only NAME_ITEM and a cross-channel hint, so
// every other intent (including a plainly-worded question) fell straight to
// the generic welcome-back template with the customer's actual message
// discarded. Reproduces the production turn sms_turns id 1628-1629
// (conversation_id bdc2f315-31d3-41ee-8a57-d5ce83c1e061, 2026-09-24).

const orderStatusLookup = vi.fn()

vi.mock('~/lib/sms-v2/tools/order-status.server', () => ({
  orderStatusLookup,
  OrderNotFoundError: class OrderNotFoundError extends Error {},
}))

afterEach(() => {
  orderStatusLookup.mockReset()
})

const ctx = { conversation: { phone: '+15550000000' }, customer: null } as unknown as EmmaContext

describe('RECONNECT direct-question handling (ticket #11335)', () => {
  it('answers the reconnect turn from sms_turns 1628-1629 with real contact info, not the generic greeting', async () => {
    const { executeReconnectStage } = await import('~/lib/sms-v2/stages/reconnect.server')
    const researchIntent: IntentResult = { intent: 'RESEARCH', confidence: 0.85, source: 'regex' }

    const res = await executeReconnectStage(ctx, researchIntent, "Hi Emma, whats your phone number?")

    const prose = res.segments[0]?.prose ?? ''
    expect(prose).toMatch(/hello@xdipx\.com/)
    expect(prose).toMatch(/\(623\) 900-1188/)
    expect(prose).not.toBe('Welcome back. What can I help you find?')
    expect(res.stateWrites).toMatchObject({ stage: 'DISCOVERY' })
  })

  it('routes a SUPPORT-classified reconnect turn to the real order-status stage instead of the generic greeting', async () => {
    const { executeReconnectStage } = await import('~/lib/sms-v2/stages/reconnect.server')
    const { OrderNotFoundError } = await import('~/lib/sms-v2/tools/order-status.server')
    orderStatusLookup.mockRejectedValue(new OrderNotFoundError('none'))
    const supportIntent: IntentResult = { intent: 'SUPPORT', confidence: 0.9, source: 'regex' }

    const res = await executeReconnectStage(ctx, supportIntent, 'where is my order?')

    expect(orderStatusLookup).toHaveBeenCalledTimes(1)
    expect(res.stateWrites).toMatchObject({ stage: 'SUPPORT' })
  })
})
