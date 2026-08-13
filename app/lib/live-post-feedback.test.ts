// Live-post feedback encoding (ticket #2738).
//
// The owner reviews posts after they are live instead of approving them before
// they ship, so his verdict has to survive a round trip through the one text
// column available and come back out distinguishable from pre-publish feedback.
// These tests cover that round trip; the DB writer itself is exercised by the
// admin route.
import { describe, it, expect } from 'vitest'
import {
  LIVE_POST_VERDICTS,
  isLivePostVerdict,
  formatLiveFeedback,
  parseLiveFeedback,
} from './team.server'

describe('live post verdicts', () => {
  it('accepts only the three real verdicts', () => {
    expect(LIVE_POST_VERDICTS).toEqual(['worked', 'off', 'pull'])
    for (const v of LIVE_POST_VERDICTS) expect(isLivePostVerdict(v)).toBe(true)
  })

  it('rejects the pre-publish review vocabulary, which is a different question', () => {
    // A posted row's review_status is the record of the decision that let it
    // ship. Reusing those words here would relabel history.
    expect(isLivePostVerdict('approved')).toBe(false)
    expect(isLivePostVerdict('needs_changes')).toBe(false)
    expect(isLivePostVerdict('rejected')).toBe(false)
    expect(isLivePostVerdict('pending_review')).toBe(false)
    expect(isLivePostVerdict(undefined)).toBe(false)
    expect(isLivePostVerdict(null)).toBe(false)
    expect(isLivePostVerdict(3)).toBe(false)
  })
})

describe('formatLiveFeedback / parseLiveFeedback', () => {
  it('round-trips a verdict and a note', () => {
    const stored = formatLiveFeedback('off', 'too salesy, reads like an offer')
    expect(stored).toBe('[live:off] too salesy, reads like an offer')
    expect(parseLiveFeedback(stored)).toEqual({
      verdict: 'off',
      note: 'too salesy, reads like an offer',
    })
  })

  it('round-trips a bare verdict with no note', () => {
    // "This worked" is one click and needs no explanation.
    const stored = formatLiveFeedback('worked', '')
    expect(stored).toBe('[live:worked]')
    expect(parseLiveFeedback(stored)).toEqual({ verdict: 'worked', note: '' })
  })

  it('returns null for pre-publish feedback so the retro can tell them apart', () => {
    expect(parseLiveFeedback('Superseded by the 2026-08-08 voice codify')).toBeNull()
    expect(parseLiveFeedback('')).toBeNull()
    expect(parseLiveFeedback(null)).toBeNull()
    expect(parseLiveFeedback(undefined)).toBeNull()
  })

  it('does not mistake a lookalike tag for a verdict', () => {
    expect(parseLiveFeedback('[live:great] nope')).toBeNull()
    expect(parseLiveFeedback('the customer said [live:off] in a comment')).toBeNull()
  })

  it('survives multi-line notes and surrounding whitespace', () => {
    const stored = formatLiveFeedback('pull', '  wrong product\nout of stock  ')
    expect(parseLiveFeedback(stored)).toEqual({
      verdict: 'pull',
      note: 'wrong product\nout of stock',
    })
  })

  it('keeps the note readable as plain text for anyone reading the column raw', () => {
    // The retro quotes feedback verbatim to the owner, so the stored form has
    // to stay human-legible rather than becoming an encoding.
    expect(formatLiveFeedback('worked', 'more of this')).toBe('[live:worked] more of this')
  })
})
