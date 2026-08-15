/**
 * app/lib/sms-v2/__tests__/upsell-repeat-pitch.test.ts
 *
 * Regression tests for ticket #3217.
 *
 * The UPSELL stage is a deterministic template path — it never runs the
 * conversation agent, so it never wrote its pitched accessory to
 * pitched_handles_log. The repeat-pitch guard was therefore blind to every
 * upsell. On 2026-08-14 Emma pitched Jelle Plus Anal Lubricant in turn 1560 and
 * re-pitched it verbatim in turn 1562 of the next call, with
 * search_repeated_pitch FALSE the whole time, because the log for that phone
 * only ever held the single PRESENTATION-stage handle.
 *
 * The fix: append the accessory handle to pitched_handles_log on every pitch
 * turn, and filter searchForIvr results against that log so an already-pitched
 * accessory is never re-offered (and searchRepeatedPitch is recorded if the only
 * candidates left are repeats).
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('~/lib/shopify.server', () => ({
  // pickAccessoryQuery + the optional MMS image fetch both call this; a null
  // return makes pickAccessoryQuery fall back to 'water-based lube' and the
  // image lookup a no-op, neither of which the dedup logic depends on.
  getProductByHandle: vi.fn(async () => null),
}))
vi.mock('../templates/upsell-templates', () => ({
  pickUpsellTemplate: (p: { name: string; price: string }) => `Toss in ${p.name} for ${p.price}?`,
}))
vi.mock('../transitions.server', () => ({ resolveTransition: (_from: string, to: string) => to }))

import { executeUpsellStage, appendPitchedHandle, type SearchForIvrFn } from '../stages/upsell.server'
import type { EmmaContext, IntentResult } from '../types.server'
import type { IvrProductCard } from '~/lib/ivr-search.server'

const MAIN = 'b-vibe-p-spot-curl'
const JELLE = 'wicked-jelle-plus-anal-lubricant-with-relaxants'
const FIST = 'fist-it-anal-relaxer'

function card(handle: string, title: string, price = 13.99): IvrProductCard {
  return { handle, title, price, tagline: '' } as unknown as IvrProductCard
}

function ctx(pitchedHandlesLog: string[] | null): EmmaContext {
  return {
    channel: 'voice',
    conversation: {
      phone: '+16025550100',
      conversationId: 'conv-1',
      stage: 'UPSELL',
      currentPitchHandle: MAIN,
      currentUpsellHandle: null,
      lastQuoteUrl: null,
      pitchedHandlesLog,
    },
  } as unknown as EmmaContext
}

const intent: IntentResult = { intent: 'COMMIT_PICK', confidence: 0.95, source: 'haiku' }

describe('appendPitchedHandle (#3217)', () => {
  it('appends most-recent-last and caps at 10', () => {
    expect(appendPitchedHandle([MAIN], JELLE)).toEqual([MAIN, JELLE])
    const ten = Array.from({ length: 10 }, (_, i) => `h${i}`)
    const capped = appendPitchedHandle(ten, 'newest')
    expect(capped).toHaveLength(10)
    expect(capped[9]).toBe('newest')
    expect(capped[0]).toBe('h1') // oldest dropped
  })
})

describe('executeUpsellStage repeat-pitch dedup (#3217)', () => {
  it('records the pitched accessory in pitched_handles_log', async () => {
    const searchFn: SearchForIvrFn = async () => [card(JELLE, 'Jelle Plus Anal Lubricant')]
    const res = await executeUpsellStage(ctx([MAIN]), intent, '', { searchFn })

    expect(res.stageOut).toBe('UPSELL')
    expect(res.segments[0]?.productCard?.handle).toBe(JELLE)
    // The pitch is now on the log, appended after the presentation handle.
    expect(res.stateWrites.pitchedHandlesLog).toEqual([MAIN, JELLE])
  })

  it('does NOT re-pitch an accessory already in the log (the 1560→1562 bug)', async () => {
    // Jelle Plus was already pitched (turn 1560). searchForIvr surfaces it again
    // plus a fresh option; the stage must skip the repeat and pitch the fresh one.
    const searchFn: SearchForIvrFn = async () => [
      card(JELLE, 'Jelle Plus Anal Lubricant'),
      card(FIST, 'Fist It Anal Relaxer', 26.99),
    ]
    const res = await executeUpsellStage(ctx([MAIN, JELLE]), intent, '', { searchFn })

    expect(res.segments[0]?.productCard?.handle).toBe(FIST)
    expect(res.segments[0]?.productCard?.handle).not.toBe(JELLE)
    expect(res.stateWrites.pitchedHandlesLog).toEqual([MAIN, JELLE, FIST])
    expect(res.telemetry.searchRepeatedPitch).toBeUndefined() // a fresh pitch, not a repeat
  })

  it('short-circuits to CHECKOUT and flags searchRepeatedPitch when every candidate is a repeat', async () => {
    // The only lube search returns is one already pitched — do not re-offer it.
    const searchFn: SearchForIvrFn = async () => [card(JELLE, 'Jelle Plus Anal Lubricant')]
    const res = await executeUpsellStage(ctx([MAIN, JELLE]), intent, '', { searchFn })

    expect(res.stageOut).toBe('CHECKOUT')
    expect(res.segments[0]?.productCard).toBeUndefined()
    expect(res.telemetry.searchRepeatedPitch).toBe(true)
  })

  it('does not flag searchRepeatedPitch when the search simply returned nothing', async () => {
    const searchFn: SearchForIvrFn = async () => []
    const res = await executeUpsellStage(ctx([MAIN]), intent, '', { searchFn })

    expect(res.stageOut).toBe('CHECKOUT')
    expect(res.telemetry.searchRepeatedPitch).toBeUndefined()
  })
})
