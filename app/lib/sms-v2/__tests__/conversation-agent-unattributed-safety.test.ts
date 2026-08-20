/**
 * app/lib/sms-v2/__tests__/conversation-agent-unattributed-safety.test.ts
 *
 * Ticket #4300: a materials/body-safety claim may not be spoken to the customer
 * with no successful tool result behind it. The verified failure was sms_turns
 * 1575 (call CA538c0ee500af3da409a2375b3f79851c, voice, PRESENTATION): the
 * customer asked what lube is safe with a jelly plug, `lookupPolicy` returned
 * not_found, and Emma answered anyway ("water based lube is the safe call every
 * time. Silicone based can break down the material over time") — a confident,
 * specific safety claim with zero grounding, contradicting the system prompt's
 * own not_found instruction.
 *
 * isUnattributedSafetyClaim is the invariant that closes it: when lookupPolicy
 * returned not_found and nothing grounded a policy answer, a materials/safety
 * claim in the reply is ungrounded and the caller-facing reply is forced to the
 * human-handoff line. Heavy server-only imports are mocked so the pure guard can
 * be imported and exercised directly.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('~/lib/db.server', () => ({ db: {} }))
vi.mock('~/lib/shopify.server', () => ({}))
vi.mock('~/lib/ai-agent/prompt', () => ({ BRAND_VOICE: 'BRAND_VOICE_STUB' }))
vi.mock('../token-log.server', () => ({ logApiTokens: vi.fn() }))
vi.mock('../conversation-history.server', () => ({ loadConversationHistory: vi.fn(async () => []) }))
vi.mock('../slot-extractor.server', () => ({ extractSlots: vi.fn(async () => null) }))

import { isMaterialsSafetyClaim, isUnattributedSafetyClaim } from '../conversation-agent.server'

const NOT_FOUND = [{ name: 'lookupPolicy', ok: false, error: 'not_found' }]

// sms_turns 1575, verbatim shape: the ungrounded safety answer.
const turn1575 =
  'For a jelly plug, water based lube is the safe call every time. ' +
  'Silicone based can break down the material over time.'

describe('isMaterialsSafetyClaim (#4300)', () => {
  it('flags lube-type, degradation, and compatibility claims', () => {
    expect(isMaterialsSafetyClaim(turn1575)).toBe(true)
    expect(isMaterialsSafetyClaim('silicone lube can degrade that material')).toBe(true)
    expect(isMaterialsSafetyClaim('that lube is not compatible with the toy')).toBe(true)
    expect(isMaterialsSafetyClaim('this one is body-safe and non-porous')).toBe(true)
  })

  it('does not flag an ordinary non-safety reply', () => {
    expect(isMaterialsSafetyClaim('Got it, queuing that plug up for you.')).toBe(false)
    expect(isMaterialsSafetyClaim('What were you hoping it would do?')).toBe(false)
  })
})

describe('isUnattributedSafetyClaim (#4300)', () => {
  it('fires on the exact 1575 shape: safety claim after a lookupPolicy not_found', () => {
    expect(isUnattributedSafetyClaim(turn1575, NOT_FOUND)).toBe(true)
  })

  it('does NOT fire when lookupPolicy succeeded (the answer is grounded)', () => {
    const grounded = [
      { name: 'lookupPolicy', ok: false, error: 'not_found' },
      { name: 'lookupPolicy', ok: true },
    ]
    expect(isUnattributedSafetyClaim(turn1575, grounded)).toBe(false)
  })

  it('does NOT fire without a lookupPolicy not_found this turn', () => {
    expect(isUnattributedSafetyClaim(turn1575, [])).toBe(false)
    expect(
      isUnattributedSafetyClaim(turn1575, [{ name: 'searchProducts', ok: true }]),
    ).toBe(false)
  })

  it('does NOT fire when the reply makes no safety claim, even after a not_found', () => {
    expect(
      isUnattributedSafetyClaim('Happy to point you to the team on that. What else can I help with?', NOT_FOUND),
    ).toBe(false)
  })

  it('treats a non-not_found lookupPolicy failure as not this guard (leaves it alone)', () => {
    const otherError = [{ name: 'lookupPolicy', ok: false, error: 'kb_unavailable' }]
    expect(isUnattributedSafetyClaim(turn1575, otherError)).toBe(false)
  })
})
