/**
 * app/lib/sms-v2/__tests__/im-in-commit-pick-false-positive.test.ts
 *
 * Ticket #17212 (split off #17174, web chat a28ef201-5e2e-4182-b51e-70eda2d51efc,
 * 2026-10-22T06:13:03Z): the phrase-based COMMIT_PICK regex bank entry included
 * `i'?m\s+in` with no boundary beyond a bare `\b`, so it matched "I'm in" as a
 * SUBSTRING anywhere in a message. "Not quite it. Can you look again? (I'm in
 * the Air Pulse & Suction Vibrators collection)" classified as COMMIT_PICK at
 * 0.95 purely from that substring, when the customer is stating context, not
 * confirming a purchase.
 *
 * These assertions exercise the real REGEX_BANK via the public classifyIntent()
 * — a regex hit short-circuits before Haiku, so this is hermetic: no network,
 * no API key (mirrors ask-upsell-intent.test.ts's pattern).
 */
import { describe, it, expect } from 'vitest'
import { classifyIntent } from '../intent-classifier.server'

describe('classifyIntent — "I\'m in" substring false positive (#17212)', () => {
  it('does not classify a collection-context message containing "I\'m in" as COMMIT_PICK', async () => {
    const res = await classifyIntent(
      { stage: 'DISCOVERY' },
      "Not quite it. Can you look again? (I'm in the Air Pulse & Suction Vibrators collection)",
    )
    expect(res.intent).not.toBe('COMMIT_PICK')
  })

  it('does not fire on other ordinary uses of "I\'m in" embedded in a sentence', async () => {
    const noCommit = [
      "I'm in a rush, can you help quickly?",
      "I'm in the mood for something gentle tonight",
      "I'm in the middle of something, one sec",
    ]
    for (const text of noCommit) {
      const res = await classifyIntent({ stage: 'DISCOVERY' }, text)
      expect(res.intent).not.toBe('COMMIT_PICK')
    }
  })

  it('still classifies a bare standalone "I\'m in" as COMMIT_PICK, in any stage', async () => {
    for (const stage of ['DISCOVERY', 'PRESENTATION', 'OBJECTION'] as const) {
      for (const text of ["I'm in", "im in", "I'm in!", "I'm in."]) {
        const res = await classifyIntent({ stage }, text)
        expect(res.intent).toBe('COMMIT_PICK')
        expect(res.source).toBe('regex')
      }
    }
  })

  it('leaves the other phrase-bank COMMIT_PICK signals unchanged (regression guard)', async () => {
    const stillCommit = ["I'll take it", 'add to cart', 'buy it now', "I'll get it"]
    for (const text of stillCommit) {
      const res = await classifyIntent({ stage: 'DISCOVERY' }, text)
      expect(res.intent).toBe('COMMIT_PICK')
    }
  })
})
