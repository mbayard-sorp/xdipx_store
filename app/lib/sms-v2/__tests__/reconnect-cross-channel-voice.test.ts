/**
 * app/lib/sms-v2/__tests__/reconnect-cross-channel-voice.test.ts
 *
 * Ticket #3519 item 2. The RECONNECT cross-channel hint used to offer
 * "I can send you the link" with no productCard behind it, so a caller's
 * "yes" had nothing to act on. RECONNECT now attaches a productCard so the
 * voice adapter's permission gate (productCard.pdpUrl) can actually arm and
 * fulfil the offer, and picks the channel-appropriate template.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EmmaContext, IntentResult } from '~/lib/sms-v2/types.server'

const getCrossChannelHint = vi.fn()
const runCatalogLookup = vi.fn()

vi.mock('~/lib/sms-v2/cross-channel.server', () => ({ getCrossChannelHint }))
vi.mock('~/lib/sms-v2/stages/discovery.server', () => ({ runCatalogLookup }))

afterEach(() => {
  getCrossChannelHint.mockReset()
  runCatalogLookup.mockReset()
})

const otherStageIntent: IntentResult = { intent: 'OFF_TOPIC', confidence: 0.5, source: 'fallback' }

const productHint = {
  otherChannel: 'web',
  topic: { kind: 'product' as const, handle: 'aurora-wand', title: 'Aurora Wand' },
}

describe('RECONNECT cross-channel hint attaches a real productCard (#3519)', () => {
  it('SMS: prose can mention the link, and productCard carries the real pdpUrl', async () => {
    getCrossChannelHint.mockReturnValue(productHint)
    const { executeReconnectStage } = await import('~/lib/sms-v2/stages/reconnect.server')

    const ctx = { channel: 'sms', conversation: { phone: '+15550000000' }, customer: null } as unknown as EmmaContext
    const res = await executeReconnectStage(ctx, otherStageIntent, 'hey')

    expect(res.segments[0]?.productCard).toMatchObject({
      handle: 'aurora-wand',
      title: 'Aurora Wand',
      pdpUrl: 'https://xdipx.com/products/aurora-wand',
    })
  })

  it('voice: prose never says "link" without also asking a real question', async () => {
    getCrossChannelHint.mockReturnValue(productHint)
    const { executeReconnectStage } = await import('~/lib/sms-v2/stages/reconnect.server')

    const ctx = { channel: 'voice', conversation: { phone: '+15550000000' }, customer: null } as unknown as EmmaContext
    const res = await executeReconnectStage(ctx, otherStageIntent, 'hey')

    const prose = res.segments[0]?.prose ?? ''
    expect(prose).not.toMatch(/https?:\/\//)
    if (/\blink\b/i.test(prose)) {
      expect(prose).toMatch(/\?\s*$/)
    }
    expect(res.segments[0]?.productCard?.pdpUrl).toBe('https://xdipx.com/products/aurora-wand')
  })
})
