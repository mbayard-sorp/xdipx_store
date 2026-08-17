/**
 * email-delivery.test.ts
 *
 * Ticket #3914 (non-protected slice of #3517). Covers the email-delivery
 * helper and its Emma-voice templates:
 *   - email extraction / validation (valid, invalid, none present)
 *   - the capture -> confirm state transition
 *   - the Klaviyo event payload, asserted against the REAL trackStartedCheckout
 *     signature (routine-dev-daily §3d), plus the config gating that keeps it
 *     from sending when Klaviyo is unconfigured
 *   - template voice-safety and slot filling
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the Klaviyo layer so no network call happens and we can spy on the exact
// payload. The mock preserves the real type, so the payload assertions below
// still type-check against trackStartedCheckout's true signature.
vi.mock('~/lib/klaviyo.server', () => ({
  trackStartedCheckout: vi.fn(async () => {}),
}))

import { trackStartedCheckout } from '~/lib/klaviyo.server'
import {
  extractEmail,
  isValidEmail,
  captureEmailFromText,
  resolveEmailConfirmation,
  sendCartLinkEmail,
  isEmailDeliveryConfigured,
  EMPTY_EMAIL_DELIVERY_STATE,
} from '../email-delivery.server'
import {
  emailChoiceTemplate,
  addressCaptureTemplate,
  addressConfirmTemplate,
} from '../templates/email-delivery-templates'

describe('email extraction + validation (#3914)', () => {
  it('validates a well-formed address', () => {
    expect(isValidEmail('sam@example.com')).toBe(true)
    expect(isValidEmail('  sam.doe+tag@sub.example.co.uk  ')).toBe(true)
  })

  it('rejects malformed addresses', () => {
    for (const bad of ['sam@', '@example.com', 'sam example.com', 'sam@example', 'sam@@example.com', '']) {
      expect(isValidEmail(bad)).toBe(false)
    }
  })

  it('extracts an address from free text, normalized to lower-case', () => {
    expect(extractEmail('sure, send it to Sam@Example.com please')).toBe('sam@example.com')
  })

  it('returns null when no address is present', () => {
    expect(extractEmail('just text me the link')).toBeNull()
  })
})

describe('capture -> confirm state machine (#3914)', () => {
  it('captures a valid address into pending_confirm', () => {
    expect(captureEmailFromText('use sam@example.com')).toEqual({
      status: 'pending_confirm',
      email: 'sam@example.com',
    })
  })

  it('stays empty when the text has no valid address', () => {
    expect(captureEmailFromText('nah just text it')).toEqual(EMPTY_EMAIL_DELIVERY_STATE)
  })

  it('confirms from pending_confirm on an affirmative reply', () => {
    const captured = captureEmailFromText('sam@example.com')
    expect(resolveEmailConfirmation(captured, true)).toEqual({
      status: 'confirmed',
      email: 'sam@example.com',
    })
  })

  it('clears on a negative reply so the caller re-asks', () => {
    const captured = captureEmailFromText('sam@example.com')
    expect(resolveEmailConfirmation(captured, false)).toEqual(EMPTY_EMAIL_DELIVERY_STATE)
  })

  it('never fabricates a confirmed state from empty (a stray yes)', () => {
    expect(resolveEmailConfirmation(EMPTY_EMAIL_DELIVERY_STATE, true)).toEqual(EMPTY_EMAIL_DELIVERY_STATE)
  })
})

describe('sendCartLinkEmail — Klaviyo payload + gating (#3914)', () => {
  const OLD_KEY = process.env['KLAVIYO_API_KEY']

  beforeEach(() => {
    vi.mocked(trackStartedCheckout).mockClear()
  })
  afterEach(() => {
    if (OLD_KEY === undefined) delete process.env['KLAVIYO_API_KEY']
    else process.env['KLAVIYO_API_KEY'] = OLD_KEY
  })

  it('calls trackStartedCheckout with a payload matching its real signature', async () => {
    process.env['KLAVIYO_API_KEY'] = 'pk_test_123'
    expect(isEmailDeliveryConfigured()).toBe(true)

    const res = await sendCartLinkEmail({
      email: 'sam@example.com',
      cartUrl: 'https://xdipx.com/cart/c/abc123',
      items: [
        { productHandle: 'aurora-wand', productTitle: 'Aurora Wand', price: 89, quantity: 1 },
        { productHandle: 'silk-lube', productTitle: 'Silk Lube', price: 12, quantity: 2 },
      ],
    })

    expect(res).toEqual({ sent: true })
    expect(trackStartedCheckout).toHaveBeenCalledTimes(1)

    const [email, params] = vi.mocked(trackStartedCheckout).mock.calls[0]!
    // Compile-time proof the payload matches the real parameter type — if
    // trackStartedCheckout's signature changes, this stops compiling.
    const typed: Parameters<typeof trackStartedCheckout>[1] = params
    expect(email).toBe('sam@example.com')
    expect(typed.cartId).toBe('https://xdipx.com/cart/c/abc123')
    expect(typed.currency).toBe('USD')
    expect(typed.value).toBe(89 * 1 + 12 * 2) // 113
    expect(typed.items).toHaveLength(2)
  })

  it('does not send when Klaviyo is unconfigured', async () => {
    delete process.env['KLAVIYO_API_KEY']
    expect(isEmailDeliveryConfigured()).toBe(false)

    const res = await sendCartLinkEmail({
      email: 'sam@example.com',
      cartUrl: 'https://xdipx.com/cart/c/abc123',
      items: [{ productHandle: 'aurora-wand', price: 89, quantity: 1 }],
    })

    expect(res).toEqual({ sent: false, reason: 'klaviyo-unconfigured' })
    expect(trackStartedCheckout).not.toHaveBeenCalled()
  })

  it('does not send to an invalid address', async () => {
    process.env['KLAVIYO_API_KEY'] = 'pk_test_123'
    const res = await sendCartLinkEmail({
      email: 'not-an-email',
      cartUrl: 'https://xdipx.com/cart/c/abc123',
      items: [],
    })
    expect(res).toEqual({ sent: false, reason: 'invalid-email' })
    expect(trackStartedCheckout).not.toHaveBeenCalled()
  })
})

describe('email-delivery templates (#3914)', () => {
  const NO_EM_DASH = /—/
  const VOICE_UNSAFE = /https?:\/\/\S+|\breply\b|\btap\b|\bclick\b/i
  const EMOJI = /[\p{Extended_Pictographic}️]/u

  it('offers all three delivery options and never uses an em-dash', () => {
    for (let i = 0; i < 6; i++) {
      const sms = emailChoiceTemplate('sms', i)
      const voice = emailChoiceTemplate('voice', i)
      for (const t of [sms, voice]) {
        expect(t).not.toMatch(NO_EM_DASH)
        expect(t.toLowerCase()).toContain('text')
        expect(t.toLowerCase()).toContain('email')
        expect(t.toLowerCase()).toContain('cart')
      }
    }
  })

  it('voice variants are safe to speak (no URL, emoji, or SMS idioms) and ask a question', () => {
    for (let i = 0; i < 6; i++) {
      const voices = [
        emailChoiceTemplate('voice', i),
        addressCaptureTemplate('voice', i),
        addressConfirmTemplate({ email: 'sam@example.com' }, 'voice', i),
      ]
      for (const v of voices) {
        expect(v).not.toMatch(VOICE_UNSAFE)
        expect(v).not.toMatch(EMOJI)
        expect(v).not.toMatch(NO_EM_DASH)
        expect(v.trim()).toMatch(/\?\s*$/)
      }
    }
  })

  it('confirm template reads the captured address back', () => {
    for (let i = 0; i < 6; i++) {
      expect(addressConfirmTemplate({ email: 'sam@example.com' }, 'sms', i)).toContain('sam@example.com')
    }
  })
})
