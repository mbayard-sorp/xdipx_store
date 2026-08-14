/**
 * upsell-topic-change.test.ts
 *
 * Regression tests for ticket #3214.
 *
 * On 2026-08-14 a caller bought a prostate massager, accepted a lube upsell,
 * and then asked for a cock ring. He asked four times across two calls
 * (sms_turns 1559, 1560, 1561 on call CA27c5008a90bd94db88bebaf429b727aa, and
 * 1562 on CA1a5c76c597e495c454daad50d470b5ad). The intent classifier tagged
 * every one of them NAME_ITEM at 0.95 confidence, so the signal was correct
 * and available on every turn.
 *
 * pickEffectiveStage only left UPSELL on UPSELL_ACCEPT / UPSELL_DECLINE /
 * COMMIT_PICK. NAME_ITEM fell through the switch and returned UPSELL unchanged,
 * so executeUpsellStage ran again — a handler that takes customer text as an
 * unused `_customerText` parameter and rebuilds its query from the ORIGINAL
 * pitched product. All four turns fired the identical
 * searchForIvr({ query: 'anal lube', productTypeDial: 'lube' }). A search for
 * "cock ring" never ran once. He hung up twice.
 *
 * The bug was never about the classifier. It was that a correct signal reached
 * a handler with no branch to act on it.
 */
import { describe, it, expect } from 'vitest'
import { pickEffectiveStage } from '../stage-dispatch.server'
import type { Intent, IntentResult } from '../types.server'

function intent(i: Intent, confidence = 0.95): IntentResult {
  return { intent: i, confidence, source: 'haiku' }
}

describe('pickEffectiveStage — leaving UPSELL (#3214)', () => {
  it('routes a named product to DISCOVERY instead of re-running the upsell', () => {
    // The exact turn: "Yeah. Do you have any cock ring recommendations?"
    expect(pickEffectiveStage('UPSELL', intent('NAME_ITEM'))).toBe('DISCOVERY')
  })

  it('routes a mid-upsell question to DISCOVERY', () => {
    // "is this safe with silicone?" was equally unhandled before the fix.
    expect(pickEffectiveStage('UPSELL', intent('RESEARCH'))).toBe('DISCOVERY')
  })

  it('routes mid-upsell pushback to OBJECTION', () => {
    expect(pickEffectiveStage('UPSELL', intent('OBJECTION'))).toBe('OBJECTION')
  })

  it('still hard-gates accept / decline / commit into CHECKOUT', () => {
    // The money path must not change: only these three reach CHECKOUT, and they
    // must keep reaching it deterministically.
    expect(pickEffectiveStage('UPSELL', intent('UPSELL_ACCEPT'))).toBe('CHECKOUT')
    expect(pickEffectiveStage('UPSELL', intent('UPSELL_DECLINE'))).toBe('CHECKOUT')
    expect(pickEffectiveStage('UPSELL', intent('COMMIT_PICK'))).toBe('CHECKOUT')
  })

  it('leaves a genuinely ambiguous reply in UPSELL', () => {
    // "oh" / filler should still wait for accept or decline rather than
    // bouncing the caller out of the pitch on noise.
    expect(pickEffectiveStage('UPSELL', intent('OFF_TOPIC', 0.6))).toBe('UPSELL')
  })

  it('does not disturb the other stages it was already routing', () => {
    expect(pickEffectiveStage('PRESENTATION', intent('COMMIT_PICK'))).toBe('UPSELL')
    expect(pickEffectiveStage('OBJECTION', intent('COMMIT_PICK'))).toBe('CHECKOUT')
    expect(pickEffectiveStage('GREETING', intent('AGE_CONFIRM'))).toBe('CONSENT_GATE')
    // NAME_ITEM inside DISCOVERY is decided by the handler, not pre-transitioned.
    expect(pickEffectiveStage('DISCOVERY', intent('NAME_ITEM'))).toBe('DISCOVERY')
  })
})
