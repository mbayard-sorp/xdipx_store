import { describe, expect, it } from 'vitest'
import { validateProposeChips } from './emma-chat-tools.server'
import type { DiscoveryVocab } from './discovery.server'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function vocab(overrides: Partial<DiscoveryVocab> = {}): DiscoveryVocab {
  return {
    moods:     ['Sensual', 'Bold', 'Playful', 'Romantic'],
    audiences: ['Me', 'Us', 'Solo', 'Date Night', 'A Partner', 'Gift'],
    matters:   ['Body-Safe Silicone', 'Waterproof', 'Beginner-Friendly', 'Hands-Free', 'Travel-Size'],
    ...overrides,
  }
}

function chip(
  group: 'mood' | 'audience' | 'matters',
  value: string,
  action: 'add' | 'remove' = 'add',
) {
  return { group, value, action }
}

// ---------------------------------------------------------------------------
// Valid chip list
// ---------------------------------------------------------------------------

describe('validateProposeChips — valid input', () => {
  it('returns ok:true with all three groups represented', () => {
    const result = validateProposeChips(
      {
        reason: 'These match what you described.',
        chips: [
          chip('mood',     'Sensual'),
          chip('audience', 'Us'),
          chip('matters',  'Waterproof'),
        ],
      },
      vocab(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.validated).toHaveLength(3)
    expect(result.validated.map(c => c.group).sort()).toEqual(['audience', 'matters', 'mood'])
  })

  it('preserves action field on each validated chip', () => {
    const result = validateProposeChips(
      {
        reason: 'Removing a chip.',
        chips: [chip('mood', 'Bold', 'remove')],
      },
      vocab(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.validated[0]?.action).toBe('remove')
  })

  it('accepts exactly 6 chips', () => {
    const result = validateProposeChips(
      {
        reason: 'All six chips.',
        chips: [
          chip('mood',     'Sensual'),
          chip('mood',     'Bold'),
          chip('audience', 'Me'),
          chip('audience', 'Us'),
          chip('matters',  'Waterproof'),
          chip('matters',  'Hands-Free'),
        ],
      },
      vocab(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.validated).toHaveLength(6)
  })
})

// ---------------------------------------------------------------------------
// Unknown chip value — not in vocab
// ---------------------------------------------------------------------------

describe('validateProposeChips — unknown chip value', () => {
  it('rejects a chip whose value is not in the vocab, lists the bad value in reason', () => {
    const result = validateProposeChips(
      {
        reason: 'Try these.',
        chips: [chip('mood', 'NotARealMood')],
      },
      vocab(),
    )
    // Implementation rejects all chips → ok: false with reason listing the bad value.
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/NotARealMood/)
  })

  it('accepts valid chips and silently drops unknown ones (partial validation)', () => {
    // Mix of one valid + one invalid. The implementation collects into
    // validated/rejected arrays and only returns ok:false when validated.length===0.
    // So a mixed list returns ok:true with only the valid chip.
    const result = validateProposeChips(
      {
        reason: 'Mixed bag.',
        chips: [
          chip('mood', 'Sensual'),          // valid
          chip('mood', 'GhostMood'),        // not in vocab
        ],
      },
      vocab(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.validated).toHaveLength(1)
    expect(result.validated[0]?.value).toBe('Sensual')
  })
})

// ---------------------------------------------------------------------------
// Cap at 6 chips
// ---------------------------------------------------------------------------

describe('validateProposeChips — cap at 6', () => {
  it('returns ok:false with a reason when more than 6 chips are submitted', () => {
    const result = validateProposeChips(
      {
        reason: 'Too many.',
        chips: [
          chip('mood',     'Sensual'),
          chip('mood',     'Bold'),
          chip('mood',     'Playful'),
          chip('mood',     'Romantic'),
          chip('audience', 'Me'),
          chip('audience', 'Us'),
          chip('matters',  'Waterproof'),  // 7th chip
        ],
      },
      vocab(),
    )
    // Implementation returns ok:false immediately when rawChips.length > 6.
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/exceed/)
  })
})

// ---------------------------------------------------------------------------
// Case and whitespace normalization
// ---------------------------------------------------------------------------

describe('validateProposeChips — case/whitespace normalization', () => {
  it('accepts value with different casing because vocab comparison is lowercased', () => {
    // vocab has 'Sensual'; input 'sensual' (all lower) should pass because
    // the implementation lowercases both sides before comparing.
    const result = validateProposeChips(
      {
        reason: 'Casing test.',
        chips: [chip('mood', 'sensual')],
      },
      vocab(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The validated chip carries the original trimmed value (not normalized to Title Case).
    expect(result.validated[0]?.value).toBe('sensual')
  })

  it('strips surrounding whitespace from value before vocab lookup', () => {
    const result = validateProposeChips(
      {
        reason: 'Whitespace test.',
        chips: [chip('mood', '  Sensual  ')],
      },
      vocab(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.validated[0]?.value).toBe('Sensual')
  })
})

// ---------------------------------------------------------------------------
// Guard: missing reason
// ---------------------------------------------------------------------------

describe('validateProposeChips — guard cases', () => {
  it('returns ok:false when reason is missing', () => {
    const result = validateProposeChips(
      { chips: [chip('mood', 'Sensual')] },
      vocab(),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/reason/)
  })

  it('returns ok:false when chips array is empty', () => {
    const result = validateProposeChips(
      { reason: 'No chips.', chips: [] },
      vocab(),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/empty/)
  })
})
