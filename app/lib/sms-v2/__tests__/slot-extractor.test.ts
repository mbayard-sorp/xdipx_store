/**
 * app/lib/sms-v2/__tests__/slot-extractor.test.ts
 *
 * Vitest unit tests for extractSlots().
 *
 * The Anthropic client is mocked via _setAnthropicClient so no real API
 * calls are made. Tests that exercise the Haiku branch set up a mock
 * factory that returns controlled JSON.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractSlots, _setAnthropicClient } from '../slot-extractor.server'
import type { ExtractResult } from '../slot-extractor.server'

// ---------------------------------------------------------------------------
// Anthropic mock factory
// ---------------------------------------------------------------------------

function makeAnthropicMock(
  audienceJson: string = JSON.stringify({ audience: null, confidence: 0 }),
) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: audienceJson }],
      }),
    },
  }
}

// Default: Haiku never provides an audience
const defaultMock = makeAnthropicMock()

beforeEach(() => {
  _setAnthropicClient(defaultMock as never)
  vi.clearAllMocks()
  // Restore default mock after each test resets call counts
  _setAnthropicClient(defaultMock as never)
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function extract(text: string): Promise<ExtractResult> {
  return extractSlots({ text })
}

// ---------------------------------------------------------------------------
// Category extraction
// ---------------------------------------------------------------------------

describe('category extraction', () => {
  it('"I want a sexy outfit" → category: wear', async () => {
    const r = await extract('I want a sexy outfit')
    expect(r.slots.category).toBe('wear')
  })

  it('"looking for lingerie for myself" → category: wear, subtype: bodysuit-teddy', async () => {
    const r = await extract('looking for lingerie for myself')
    expect(r.slots.category).toBe('wear')
    expect(r.slots.subtype).toBe('bodysuit-teddy')
  })

  it('"a plug for my boyfriend" → category: anal, subtype: plug, audience: for-him', async () => {
    const r = await extract('a plug for my boyfriend')
    expect(r.slots.category).toBe('anal')
    expect(r.slots.subtype).toBe('plug')
    expect(r.slots.audience).toBe('for-him')
  })

  it('"recommend a dildo for my girlfriend" → category: dildo, audience: for-her', async () => {
    const r = await extract('recommend a dildo for my girlfriend')
    expect(r.slots.category).toBe('dildo')
    expect(r.slots.audience).toBe('for-her')
  })

  it('"magic wand replacement" → category: vibrator, subtype: wand', async () => {
    const r = await extract('magic wand replacement')
    expect(r.slots.category).toBe('vibrator')
    expect(r.slots.subtype).toBe('wand')
  })

  it('"harness for me, my partner wears it" → category: harness', async () => {
    const r = await extract('harness for me, my partner wears it')
    expect(r.slots.category).toBe('harness')
  })

  it('"anal beads, never tried before" → category: anal, subtype: beads, experience: first-time', async () => {
    const r = await extract('anal beads, never tried before')
    expect(r.slots.category).toBe('anal')
    expect(r.slots.subtype).toBe('beads')
    expect(r.slots.experience).toBe('first-time')
  })

  it('"show me waterproof rechargeable rabbit" → category: vibrator, subtype: rabbit, matters includes waterproof and rechargeable', async () => {
    const r = await extract('show me waterproof rechargeable rabbit')
    expect(r.slots.category).toBe('vibrator')
    expect(r.slots.subtype).toBe('rabbit')
    expect(r.slots.matters).toContain('waterproof')
    expect(r.slots.matters).toContain('rechargeable')
  })
})

// ---------------------------------------------------------------------------
// Experience extraction
// ---------------------------------------------------------------------------

describe('experience extraction', () => {
  it('"first time toy for couples" → audience: couples, experience: first-time', async () => {
    const r = await extract('first time toy for couples')
    expect(r.slots.audience).toBe('couples')
    expect(r.slots.experience).toBe('first-time')
  })

  it('"first time" alone → experience: first-time, vulnerabilitySignaled: falsy', async () => {
    const r = await extract('first time')
    expect(r.slots.experience).toBe('first-time')
    expect(r.slots.vulnerabilitySignaled).toBeFalsy()
  })
})

// ---------------------------------------------------------------------------
// Beginner → first-time + matters:beginner-friendly
// ---------------------------------------------------------------------------

describe('beginner keyword', () => {
  it('"want a beginner dildo" → category: dildo, experience: first-time, matters includes beginner-friendly', async () => {
    const r = await extract('want a beginner dildo')
    expect(r.slots.category).toBe('dildo')
    expect(r.slots.experience).toBe('first-time')
    expect(r.slots.matters).toContain('beginner-friendly')
  })
})

// ---------------------------------------------------------------------------
// Advice request
// ---------------------------------------------------------------------------

describe('advice request extraction', () => {
  it('"what\'s the difference between water and silicone lube" → category: lube, isAdviceRequest: true', async () => {
    const r = await extract("what's the difference between water and silicone lube")
    expect(r.slots.category).toBe('lube')
    expect(r.slots.isAdviceRequest).toBe(true)
  })

  it('"tell me about lube" → category: lube, isAdviceRequest: true', async () => {
    const r = await extract('tell me about lube')
    expect(r.slots.category).toBe('lube')
    expect(r.slots.isAdviceRequest).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Lube subtypes
// ---------------------------------------------------------------------------

describe('lube subtype extraction', () => {
  it('"warming lube please" → category: lube, subtype: warming-cooling, matters includes warming', async () => {
    const r = await extract('warming lube please')
    expect(r.slots.category).toBe('lube')
    expect(r.slots.subtype).toBe('warming-cooling')
    expect(r.slots.matters).toContain('warming')
  })

  it('"water based lube" → category: lube, subtype: water-based', async () => {
    const r = await extract('water based lube')
    expect(r.slots.category).toBe('lube')
    expect(r.slots.subtype).toBe('water-based')
  })

  it('"silicone based lube" → category: lube, subtype: silicone-based', async () => {
    const r = await extract('silicone based lube')
    expect(r.slots.category).toBe('lube')
    expect(r.slots.subtype).toBe('silicone-based')
  })
})

// ---------------------------------------------------------------------------
// Price extraction
// ---------------------------------------------------------------------------

describe('price extraction', () => {
  it('"quiet vibrator under $50" → category: vibrator, priceMax: 50, matters includes quiet', async () => {
    const r = await extract('quiet vibrator under $50')
    expect(r.slots.category).toBe('vibrator')
    expect(r.slots.priceMax).toBe(50)
    expect(r.slots.matters).toContain('quiet')
  })

  it('"something under $100" → priceMax: 100', async () => {
    const r = await extract('something under $100')
    expect(r.slots.priceMax).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// Audience extraction
// ---------------------------------------------------------------------------

describe('audience extraction', () => {
  it('"what should I get for my husband" → audience: for-him', async () => {
    const r = await extract('what should I get for my husband')
    expect(r.slots.audience).toBe('for-him')
  })

  it('"buying a gift for a friend" → audience: gift, giftWithNoRecipientHint: true', async () => {
    const r = await extract('buying a gift for a friend')
    expect(r.slots.audience).toBe('gift')
    expect(r.slots.giftWithNoRecipientHint).toBe(true)
  })

  it('"buying a gift for my husband" → audience: for-him, giftWithNoRecipientHint falsy', async () => {
    const r = await extract('buying a gift for my husband')
    expect(r.slots.audience).toBe('for-him')
    expect(r.slots.giftWithNoRecipientHint).toBeFalsy()
  })
})

// ---------------------------------------------------------------------------
// Vulnerability markers
// ---------------------------------------------------------------------------

describe('vulnerability markers', () => {
  it('"I\'m embarrassed but I want to try a vibrator" → category: vibrator, vulnerabilitySignaled: true', async () => {
    const r = await extract("I'm embarrassed but I want to try a vibrator")
    expect(r.slots.category).toBe('vibrator')
    expect(r.slots.vulnerabilitySignaled).toBe(true)
  })

  it('"just got divorced and want to feel something" → vulnerabilitySignaled: true', async () => {
    const r = await extract('just got divorced and want to feel something')
    expect(r.slots.vulnerabilitySignaled).toBe(true)
  })

  it('"after my surgery I haven\'t been able to" → vulnerabilitySignaled: true', async () => {
    const r = await extract("after my surgery I haven't been able to")
    expect(r.slots.vulnerabilitySignaled).toBe(true)
  })

  it('"first time" alone (no other markers) → experience: first-time, vulnerabilitySignaled falsy', async () => {
    const r = await extract('first time')
    expect(r.slots.experience).toBe('first-time')
    expect(r.slots.vulnerabilitySignaled).toBeFalsy()
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('"help me pick" → empty slots', async () => {
    const r = await extract('help me pick')
    expect(r.slots.category).toBeUndefined()
    expect(r.slots.audience).toBeUndefined()
    expect(r.slots.experience).toBeUndefined()
  })

  it('empty string → empty slots', async () => {
    const r = await extract('')
    expect(r.slots).toEqual({})
    expect(r.haikuCalled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Haiku invocation logic
// ---------------------------------------------------------------------------

describe('Haiku invocation', () => {
  it('calls Haiku for "I want a plug" (high-stakes anal, no audience)', async () => {
    const mock = makeAnthropicMock(
      JSON.stringify({ audience: 'for-her', confidence: 0.85 }),
    )
    _setAnthropicClient(mock as never)

    const r = await extract('I want a plug')

    expect(mock.messages.create).toHaveBeenCalledTimes(1)
    expect(r.haikuCalled).toBe(true)
    expect(r.slots.category).toBe('anal')
    expect(r.slots.subtype).toBe('plug')
    // Haiku returned for-her with 0.85 confidence
    expect(r.slots.audience).toBe('for-her')
    expect(r.source).toBe('mixed')
  })

  it('does NOT call Haiku for "I want a vibrator" (not high-stakes)', async () => {
    const mock = makeAnthropicMock(
      JSON.stringify({ audience: 'for-her', confidence: 0.9 }),
    )
    _setAnthropicClient(mock as never)

    const r = await extract('I want a vibrator')

    expect(mock.messages.create).not.toHaveBeenCalled()
    expect(r.haikuCalled).toBe(false)
    expect(r.slots.category).toBe('vibrator')
    expect(r.source).toBe('regex')
  })

  it('does NOT call Haiku when audience already resolved by regex for a high-stakes category', async () => {
    const mock = makeAnthropicMock(
      JSON.stringify({ audience: 'for-him', confidence: 0.9 }),
    )
    _setAnthropicClient(mock as never)

    const r = await extract('a dildo for my girlfriend')

    expect(mock.messages.create).not.toHaveBeenCalled()
    expect(r.haikuCalled).toBe(false)
    expect(r.slots.audience).toBe('for-her')
  })

  it('Haiku confidence below 0.7 → audience not set', async () => {
    const mock = makeAnthropicMock(
      JSON.stringify({ audience: 'for-him', confidence: 0.5 }),
    )
    _setAnthropicClient(mock as never)

    const r = await extract('I want a harness')

    expect(r.haikuCalled).toBe(true)
    // Low confidence — audience should remain unset
    expect(r.slots.audience).toBeUndefined()
  })

  it('Haiku failure is swallowed; falls back to regex-only result', async () => {
    const mock = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error('network error')),
      },
    }
    _setAnthropicClient(mock as never)

    // "a sexy outfit" → category: wear (high-stakes, no audience) → Haiku fires and throws
    // Should not throw; haikuCalled is true, audience remains unset
    const r = await extract('I want a sexy outfit')
    expect(r.haikuCalled).toBe(true)
    expect(r.slots.category).toBe('wear')
    // No audience from Haiku (error)
    expect(r.slots.audience).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Source telemetry
// ---------------------------------------------------------------------------

describe('source telemetry', () => {
  it('pure regex match returns source: regex', async () => {
    const r = await extract('quiet vibrator under $50')
    expect(r.source).toBe('regex')
    expect(r.haikuCalled).toBe(false)
  })

  it('Haiku adds audience → source: mixed', async () => {
    const mock = makeAnthropicMock(
      JSON.stringify({ audience: 'couples', confidence: 0.8 }),
    )
    _setAnthropicClient(mock as never)

    const r = await extract('need a dildo for us')
    // "us" regex → couples; should not need Haiku
    // Actually "for us" → couples via regex; Haiku not called for dildo+couples
    // Test with a text that truly needs Haiku
    const r2 = await extractSlots({ text: 'show me a nice dildo' })
    expect(r2.haikuCalled).toBe(true)
    expect(r2.source).toBe('mixed')
    void r // suppress unused warning
  })
})
