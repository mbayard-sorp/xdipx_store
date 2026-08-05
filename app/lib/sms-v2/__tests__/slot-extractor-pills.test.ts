/**
 * app/lib/sms-v2/__tests__/slot-extractor-pills.test.ts
 *
 * Ticket #1265 (conv-audit B4b): the slot extractor must recognise every literal
 * quick-choice pill label the discovery gate emits, plus mood extraction and the
 * skip sentinel. Each test asserts a pill label produces its slot so the gate can
 * actually advance instead of looping on a tap that matches nothing.
 *
 * The Anthropic client is mocked so no real API calls fire.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractSlots, _setAnthropicClient } from '../slot-extractor.server'
import type { ExtractResult } from '../slot-extractor.server'
import {
  SKIP_SENTINEL,
  WHO_OPTS,
  MATTERS_OPTS,
} from '../discovery-gate.server'

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

const defaultMock = makeAnthropicMock()

beforeEach(() => {
  _setAnthropicClient(defaultMock as never)
  vi.clearAllMocks()
  _setAnthropicClient(defaultMock as never)
})

async function extract(text: string): Promise<ExtractResult> {
  return extractSlots({ text })
}

// ─── WHO pills ────────────────────────────────────────────────────────────────

describe('WHO quick-choice pills produce a slot', () => {
  it('"For us" → audience: couples', async () => {
    const r = await extract('For us')
    expect(r.slots.audience).toBe('couples')
  })

  it('"A gift" → audience: gift', async () => {
    const r = await extract('A gift')
    expect(r.slots.audience).toBe('gift')
  })

  it('bare "gift" → audience: gift', async () => {
    const r = await extract('gift')
    expect(r.slots.audience).toBe('gift')
  })

  it('"a gift for my husband" still resolves to for-him (gendered override wins)', async () => {
    const r = await extract('a gift for my husband')
    expect(r.slots.audience).toBe('for-him')
  })

  it('does not misfire on "gifted"', async () => {
    const r = await extract('gifted at picking toys')
    expect(r.slots.audience).toBeUndefined()
  })

  // "For me" and "For a partner" intentionally do NOT set audience: the 4-value
  // enum (for-her | for-him | couples | gift) cannot represent a self-purchase
  // or a partner of unknown gender, and the code deliberately asks a body-type
  // follow-up (inferWhoTrigger → solo) rather than guess. Documented, not a gap.
  it('"For me" does not fabricate an audience', async () => {
    const r = await extract('For me')
    expect(r.slots.audience).toBeUndefined()
  })
})

// ─── MATTERS pills ──────────────────────────────────────────────────────────

describe('MATTERS quick-choice pills produce a slot', () => {
  it('"Beginner-friendly" → matters includes beginner-friendly', async () => {
    const r = await extract('Beginner-friendly')
    expect(r.slots.matters).toContain('beginner-friendly')
  })

  it('"Discreet" → matters includes discreet-packaging', async () => {
    const r = await extract('Discreet')
    expect(r.slots.matters).toContain('discreet-packaging')
  })

  it('"Waterproof" → matters includes waterproof', async () => {
    const r = await extract('Waterproof')
    expect(r.slots.matters).toContain('waterproof')
  })

  it('"Hands-free" → matters includes hands-free', async () => {
    const r = await extract('Hands-free')
    expect(r.slots.matters).toContain('hands-free')
  })

  it('"Just show me" → mood includes the skip sentinel', async () => {
    const r = await extract('Just show me')
    expect(r.slots.mood).toContain(SKIP_SENTINEL)
  })

  it('"discreet motor" still maps to quiet, not discreet-packaging', async () => {
    const r = await extract('something with a discreet motor')
    expect(r.slots.matters).toContain('quiet')
    expect(r.slots.matters ?? []).not.toContain('discreet-packaging')
  })

  it('every MATTERS pill label produces at least one slot', async () => {
    for (const label of MATTERS_OPTS) {
      const r = await extract(label)
      const producedSlot =
        (r.slots.matters?.length ?? 0) > 0 || (r.slots.mood?.length ?? 0) > 0
      expect(producedSlot, `pill "${label}" produced no slot`).toBe(true)
    }
  })
})

// ─── Mood extraction + skip sentinel ──────────────────────────────────────────

describe('mood extraction', () => {
  it('"I want something playful" → mood includes playful', async () => {
    const r = await extract('I want something playful')
    expect(r.slots.mood).toContain('playful')
  })

  it('"feeling romantic tonight" → mood includes romantic', async () => {
    const r = await extract('feeling romantic tonight')
    expect(r.slots.mood).toContain('romantic')
  })

  it('"something adventurous and kinky" → mood includes adventurous', async () => {
    const r = await extract('something adventurous and kinky')
    expect(r.slots.mood).toContain('adventurous')
  })

  it('"just want to relax and unwind" → mood includes relaxing', async () => {
    const r = await extract('just want to relax and unwind')
    expect(r.slots.mood).toContain('relaxing')
  })

  it('"treat myself to something luxurious" → mood includes luxurious', async () => {
    const r = await extract('treat myself to something luxurious')
    expect(r.slots.mood).toContain('luxurious')
  })

  it('skip variants all produce the sentinel alone', async () => {
    for (const phrase of ['just show me', 'surprise me', 'you pick', 'whatever you recommend']) {
      const r = await extract(phrase)
      expect(r.slots.mood, `"${phrase}"`).toEqual([SKIP_SENTINEL])
    }
  })

  it('no mood words → mood undefined', async () => {
    const r = await extract('I need a vibrator')
    expect(r.slots.mood).toBeUndefined()
  })
})

// ─── The pill vocabularies stay in lockstep with the gate ─────────────────────

describe('pill vocabularies', () => {
  it('the WHO/MATTERS mirrors match what the gate advertises', () => {
    // Guard against the fixture drifting from the gate's real option lists.
    expect(WHO_OPTS).toEqual(['For me', 'For a partner', 'For us', 'A gift'])
    expect(MATTERS_OPTS).toEqual([
      'Beginner-friendly',
      'Discreet',
      'Waterproof',
      'Hands-free',
      'Just show me',
    ])
  })
})
