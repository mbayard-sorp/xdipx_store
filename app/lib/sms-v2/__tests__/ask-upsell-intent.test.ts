/**
 * ask-upsell-intent.test.ts
 *
 * Ticket #3909 (split out of #3516 BUILD item 3): an ASK-TO-BE-UPSOLD path so
 * utterances like "what pairs with this", "what else do I need", "what goes
 * with it", "what should I add" reach the deterministic UPSELL pitch from ANY
 * stage, instead of falling to RESEARCH / OFF_TOPIC.
 *
 * Two surfaces are covered:
 *   1. The high-precision REGEX_BANK entry, exercised through the public
 *      classifyIntent(). A regex hit short-circuits before Haiku, so these
 *      assertions are hermetic — no network, no API key.
 *   2. pickEffectiveStage routing, including the no-currentPitchHandle guard.
 */
import { describe, it, expect } from 'vitest'
import { classifyIntent } from '../intent-classifier.server'
import { pickEffectiveStage } from '../stage-dispatch.server'
import type { Intent, IntentResult, Stage } from '../types.server'

function intent(i: Intent, confidence = 0.95): IntentResult {
  return { intent: i, confidence, source: 'haiku' }
}

describe('classifyIntent — ASK_UPSELL regex bank (#3909)', () => {
  const asks = [
    'what pairs with this',
    'what pairs with it',
    'what goes with it',
    'what goes with this',
    'what goes well with this',
    'what else do I need',
    'what else should I get',
    'what should I add',
    'anything else I need',
    'what accessories go with this',
    'any add-ons?',
  ]

  for (const text of asks) {
    it(`classifies "${text}" as ASK_UPSELL via regex (0.95, any stage)`, async () => {
      // PRESENTATION and UPSELL are the stages the ticket names; the entry is
      // stage-agnostic, so assert it fires in both.
      for (const stage of ['PRESENTATION', 'UPSELL'] as const) {
        const res = await classifyIntent({ stage }, text)
        expect(res.intent).toBe('ASK_UPSELL')
        expect(res.source).toBe('regex')
        expect(res.confidence).toBe(0.95)
      }
    })
  }

  it('does not steal a plain product lookup', async () => {
    const res = await classifyIntent({ stage: 'DISCOVERY' }, 'show me a wand')
    expect(res.intent).toBe('NAME_ITEM')
  })

  it('does not steal a buy signal', async () => {
    const res = await classifyIntent({ stage: 'UPSELL' }, 'add to cart')
    expect(res.intent).toBe('COMMIT_PICK')
  })

  it('does not fire on an unrelated bare affirmation in UPSELL', async () => {
    const res = await classifyIntent({ stage: 'UPSELL' }, 'yes')
    expect(res.intent).toBe('UPSELL_ACCEPT')
  })
})

describe('pickEffectiveStage — ASK_UPSELL routing (#3909)', () => {
  const pitched = 'aurora-wand'

  it('routes ASK_UPSELL to UPSELL from any stage when a pitch is set', () => {
    for (const stage of ['PRESENTATION', 'CHECKOUT', 'UPSELL', 'DISCOVERY', 'POST_PURCHASE'] as Stage[]) {
      expect(pickEffectiveStage(stage, intent('ASK_UPSELL'), pitched)).toBe('UPSELL')
    }
  })

  it('routes ASK_UPSELL to DISCOVERY when there is no product to pair against', () => {
    // null and undefined currentPitchHandle both mean "nothing pitched yet".
    expect(pickEffectiveStage('PRESENTATION', intent('ASK_UPSELL'), null)).toBe('DISCOVERY')
    expect(pickEffectiveStage('CHECKOUT', intent('ASK_UPSELL'))).toBe('DISCOVERY')
    expect(pickEffectiveStage('DISCOVERY', intent('ASK_UPSELL'), '')).toBe('DISCOVERY')
  })

  it('leaves the existing routing untouched (regression guard)', () => {
    // A currentPitchHandle argument must not change any non-ASK_UPSELL routing.
    expect(pickEffectiveStage('UPSELL', intent('NAME_ITEM'), pitched)).toBe('DISCOVERY')
    expect(pickEffectiveStage('UPSELL', intent('UPSELL_ACCEPT'), pitched)).toBe('CHECKOUT')
    expect(pickEffectiveStage('PRESENTATION', intent('COMMIT_PICK'), pitched)).toBe('UPSELL')
    expect(pickEffectiveStage('GREETING', intent('AGE_CONFIRM'), null)).toBe('CONSENT_GATE')
    expect(pickEffectiveStage('UPSELL', intent('OFF_TOPIC', 0.6), pitched)).toBe('UPSELL')
  })
})
