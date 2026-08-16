/**
 * app/lib/sms-v2/__tests__/voice-template-idiom-sweep.test.ts
 *
 * Ticket #3519 (owner direction 2026-08-15). Asserts that every
 * voice-rendered template in app/lib/sms-v2/templates/ is safe to speak:
 * no raw URL, no emoji, and none of the SMS-only idioms ("reply", "tap",
 * "click") that read as garbage or dangle a half sentence once the voice
 * adapter's stripUrlsForVoice() removes the URL before TTS.
 *
 * Scope: the banks that take an explicit channel argument and render a
 * distinct 'voice' variant (support, cross-channel, upsell). AGE_GATE_REPLY
 * in compliance-templates.ts is a known separate exception: it is real TCPA
 * opt-in copy, shared verbatim across SMS and voice via the same GREETING/
 * CONSENT_GATE handlers, and rewriting it needs its own empathy + compliance
 * review — tracked as a follow-up, not fixed here.
 */
import { describe, expect, it } from 'vitest'
import { pickSupportTemplate, type SupportOrderSlots } from '../templates/support-templates'
import { pickCrossChannelTemplate, type CrossChannelSlots } from '../templates/cross-channel-templates'
import { pickUpsellTemplate, type UpsellTemplateSlots } from '../templates/upsell-templates'

// Matches a bare URL, or the SMS-only idioms that make no sense spoken aloud.
const VOICE_UNSAFE_RE = /https?:\/\/\S+|\breply\b|\btap\b|\bclick\b/i
const URL_RE = /https?:\/\/\S+/
const EMOJI_RE = /[\p{Extended_Pictographic}️]/u

function assertVoiceSafe(text: string) {
  expect(text).not.toMatch(URL_RE)
  expect(text).not.toMatch(EMOJI_RE)
  expect(text).not.toMatch(VOICE_UNSAFE_RE)
}

describe('voice-rendered templates never carry a URL, emoji, or SMS idiom (#3519)', () => {
  it('support: every status renders voice-safe across the full rotation', () => {
    const slots: SupportOrderSlots = {
      orderName: '#1042',
      trackingUrl: 'https://example.com/track/1Z999',
      trackingNumber: '1Z999',
      carrier: 'UPS',
      lastScan: 'Tuesday in Phoenix, AZ',
    }
    const statuses = ['paid', 'fulfilled', 'shipped', 'delivered'] as const
    for (const status of statuses) {
      // Sweep the rotation window so every variant in the bank gets checked,
      // not just whichever one the current second picks.
      for (let i = 0; i < 8; i++) {
        assertVoiceSafe(pickSupportTemplate(status, slots, 'voice'))
      }
    }
  })

  it('support shipped voice variant asks a real question instead of dangling a stripped URL', () => {
    const slots: SupportOrderSlots = {
      orderName: '#1042',
      trackingUrl: 'https://example.com/track/1Z999',
      carrier: 'UPS',
      lastScan: 'Tuesday in Phoenix, AZ',
    }
    const reply = pickSupportTemplate('shipped', slots, 'voice')
    expect(reply).toMatch(/\?\s*$/)
    expect(reply).not.toContain('Track it here')
  })

  it('cross-channel: voice bank renders safe and, when it offers a link, asks a real question', () => {
    const slots: CrossChannelSlots = { channelLabel: 'web chat', productTitle: 'Aurora Wand' }
    for (let i = 0; i < 6; i++) {
      const reply = pickCrossChannelTemplate(slots, 'voice')
      assertVoiceSafe(reply)
      if (/\btext\b/i.test(reply)) {
        expect(reply).toMatch(/\?\s*$/)
      }
    }
  })

  it('upsell: voice bank renders safe (regression guard for the existing split)', () => {
    const slots: UpsellTemplateSlots = {
      name: 'Aurora Wand',
      price: '$89.00',
      pdpUrl: 'https://xdipx.com/products/aurora-wand',
    }
    for (let i = 0; i < 5; i++) {
      assertVoiceSafe(pickUpsellTemplate(slots, 'voice', i))
    }
  })

  it('sms banks are unaffected: the link and the offer still ship on SMS', () => {
    const slots: SupportOrderSlots = { orderName: '#1042', trackingUrl: 'https://example.com/track/1Z999' }
    let sawUrl = false
    for (let i = 0; i < 8; i++) {
      if (pickSupportTemplate('shipped', slots, 'sms').includes('https://example.com/track/1Z999')) sawUrl = true
    }
    expect(sawUrl).toBe(true)
  })
})
