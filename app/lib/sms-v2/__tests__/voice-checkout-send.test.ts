/**
 * app/lib/sms-v2/__tests__/voice-checkout-send.test.ts
 *
 * Ticket #4299 — voice checkout never actually texted the cart link it promised.
 *
 * stageResponseToVoiceReply used to hand the checkout URL back on the reply as
 * VoiceReply.outboundSms and speak "I just texted you a secure checkout link"
 * unconditionally. Nothing downstream ever read outboundSms (the Fly bridge
 * reads only ssml/hangup), so every completed voice purchase claimed a text
 * that never left. The adapter now sends the SMS itself and only speaks the
 * confirmation on a confirmed send, mirroring the pending-PDP verified-send gate.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StageResponse } from '../types.server'

const h = vi.hoisted(() => ({ sendSms: vi.fn() }))

vi.mock('~/lib/twilio.server', () => ({
  sendSms: h.sendSms,
}))

import { stageResponseToVoiceReply } from '../adapters/voice.server'

const CART_URL = 'https://xdipx.com/checkout/abc123'
const CALLER = '+15550001111'

/** Minimal StageResponse whose single segment carries a checkout CTA. */
function checkoutStageResponse(): StageResponse {
  return {
    stageOut: 'POST_CHECKOUT',
    goalAchieved: true,
    segments: [{ prose: "You're all set.", cta: { kind: 'checkout', url: CART_URL } }],
    stateWrites: {},
    telemetry: { intent: 'CHECKOUT', intentConfidence: 1 },
  } as unknown as StageResponse
}

describe('voice checkout link — verified send (#4299)', () => {
  afterEach(() => {
    h.sendSms.mockReset()
  })

  it('actually sends the checkout URL by SMS to the caller', async () => {
    h.sendSms.mockResolvedValue('SM123')
    await stageResponseToVoiceReply(checkoutStageResponse(), CALLER)
    expect(h.sendSms).toHaveBeenCalledTimes(1)
    expect(h.sendSms).toHaveBeenCalledWith(CALLER, CART_URL)
  })

  it('speaks the "I just texted you" confirmation only on a confirmed send', async () => {
    h.sendSms.mockResolvedValue('SM123')
    const { reply } = await stageResponseToVoiceReply(checkoutStageResponse(), CALLER)
    expect(reply.ssml).toContain('I just texted you a secure checkout link')
    // A checkout CTA keeps the caller on the line to confirm receipt.
    expect(reply.hangup ?? false).toBe(false)
  })

  it('never claims the text was sent when the send throws — speaks an honest fallback', async () => {
    h.sendSms.mockRejectedValue(new Error('Twilio down'))
    const { reply } = await stageResponseToVoiceReply(checkoutStageResponse(), CALLER)
    expect(h.sendSms).toHaveBeenCalledWith(CALLER, CART_URL)
    expect(reply.ssml).not.toContain('I just texted you a secure checkout link')
    expect(reply.ssml).toContain("didn't want to go through")
    // Stay on the call after a failed send too, so the caller isn't hung up on.
    expect(reply.hangup ?? false).toBe(false)
  })

  it('does not leak an outboundSms field back on the reply (dead plumbing removed)', async () => {
    h.sendSms.mockResolvedValue('SM123')
    const { reply } = await stageResponseToVoiceReply(checkoutStageResponse(), CALLER)
    expect('outboundSms' in reply).toBe(false)
  })
})
