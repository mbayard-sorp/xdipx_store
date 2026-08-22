/**
 * Ticket #4871: the IP-code FAQ remediation must (a) correct the three confirmed
 * self-contradictory / factually-wrong FAQ answers, and (c) leave zero
 * "unrestricted shower/bath" FAQ answers across the 24 fixer handles. These
 * tests pin the pure audit predicate and the exact-match patch planner, and
 * prove every correction's stale answer is flagged while every replacement is
 * clean, so the script's live sweep is trustworthy.
 */
import { describe, it, expect } from 'vitest'
import {
  faqGrantsUnrestrictedWater,
  planFaqAnswerPatch,
  FAQ_ANSWER_CORRECTIONS,
} from './ipx-faq-remediation'

describe('faqGrantsUnrestrictedWater', () => {
  it('flags every confirmed stale answer as an unrestricted grant', () => {
    for (const c of FAQ_ANSWER_CORRECTIONS) {
      expect(faqGrantsUnrestrictedWater(c.oldAnswer), c.handle).toBe(true)
    }
  })

  it('passes every corrected replacement (no unrestricted grant remains)', () => {
    for (const c of FAQ_ANSWER_CORRECTIONS) {
      expect(faqGrantsUnrestrictedWater(c.newAnswer), c.handle).toBe(false)
    }
  })

  it('does not flag answers that grant water use WITH a restriction clause', () => {
    // Real live answers from other fixer handles: each grants shower/bath but
    // carries an explicit submersion/bath restriction, so they are out of scope
    // for this defect class (the ticket confirmed only the three above).
    const restricted = [
      "It's IPX6 waterproof, which means it's shower-safe and handles splashing perfectly. Just don't fully submerge it in water like a bath.",
      'Yes, it’s splashproof with IPX6 rating, so shower play is totally fine. Just avoid full submersion in the bath since it’s designed to handle splashes rather than being completely waterproof.',
      'The motor housing is IPX4 waterproof, so light splashing is fine, but don’t submerge it. The shower might be pushing it. Stick to dry spaces for the best experience and longest lifespan.',
      'It has an IPX6 waterproof rating, so shower play is totally fine. Just avoid fully submerging it in bath water since IPX6 protects against water jets but not complete immersion.',
      'The IPX4 rating means it handles direct water spray comfortably, so shower use is fine. IPX4 does not mean fully submersible, so bath soak use is not recommended.',
      'It carries an IPX4 splashproof rating, meaning it handles water spray and light moisture comfortably, including shower use. It is not designed for full submersion, so keep it above the waterline during bath play.',
    ]
    for (const a of restricted) {
      expect(faqGrantsUnrestrictedWater(a), a.slice(0, 40)).toBe(false)
    }
  })

  it('does not flag benign non-water-safety answers (suction-cup-on-shower-wall, cleaning)', () => {
    const benign = [
      "Really strong. I've had mine stuck to my shower wall for months through some pretty enthusiastic sessions, and it's never budged.",
      'Rinse with warm water and a dedicated toy cleaner after every use. The IPX5 splashproof rating means running water is fine; full submersion is not.',
      'The cosmic pink is pretty bold, so discrete it is not.',
    ]
    for (const a of benign) {
      expect(faqGrantsUnrestrictedWater(a), a.slice(0, 40)).toBe(false)
    }
  })

  it('handles empty / null answers', () => {
    expect(faqGrantsUnrestrictedWater('')).toBe(false)
    expect(faqGrantsUnrestrictedWater(null)).toBe(false)
    expect(faqGrantsUnrestrictedWater(undefined)).toBe(false)
  })
})

describe('planFaqAnswerPatch', () => {
  const faqs = [
    { _key: 'k1', answer: 'stale shower answer' },
    { _key: 'k2', answer: 'unrelated answer' },
  ]

  it('returns the matching entry key for an exact old-answer match', () => {
    expect(planFaqAnswerPatch(faqs, 'stale shower answer', 'fixed answer')).toEqual({ status: 'patch', key: 'k1' })
  })

  it('is idempotent: reports already-applied when the new answer is present', () => {
    const done = [{ _key: 'k1', answer: 'fixed answer' }]
    expect(planFaqAnswerPatch(done, 'stale shower answer', 'fixed answer')).toEqual({ status: 'already' })
  })

  it('reports not_found when the old answer has drifted (no fuzzy match)', () => {
    expect(planFaqAnswerPatch(faqs, 'some drifted text', 'fixed answer')).toEqual({ status: 'not_found' })
  })

  it('reports not_found when the matching entry has no _key', () => {
    expect(planFaqAnswerPatch([{ answer: 'stale shower answer' }], 'stale shower answer', 'fixed answer'))
      .toEqual({ status: 'not_found' })
  })
})
