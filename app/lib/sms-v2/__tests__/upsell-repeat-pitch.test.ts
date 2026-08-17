/**
 * app/lib/sms-v2/__tests__/upsell-repeat-pitch.test.ts
 *
 * Regression tests for ticket #3217 (repeat-pitch dedup) and #3516 (curated
 * attach intelligence + category-aware lube fallback).
 *
 * #3217: The UPSELL stage is a deterministic template path — it never runs the
 * conversation agent, so it never wrote its pitched accessory to
 * pitched_handles_log. The repeat-pitch guard was therefore blind to every
 * upsell (Jelle Plus pitched in turn 1560, re-pitched verbatim in 1562, with
 * search_repeated_pitch FALSE the whole time).
 *
 * #3516: pickAccessoryQuery returned 'anal lube' / 'water-based lube' on every
 * path and the stage hard-pinned productTypeDial='lube', so a caller asking for
 * cock rings four times was pitched four anal lubes (call CA27c5008a). The fix:
 * the pitched product's own curated xdipx.accessory_product_ids are the primary
 * upsell (spoken with their pairing_why blurb), and the lube fallback is
 * category-aware — a non-anal pitch never offers an anal lube.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('~/lib/shopify.server', () => ({
  // The optional MMS image fetch calls this; a null return makes it a no-op,
  // which the dedup / selection logic does not depend on.
  getProductByHandle: vi.fn(async () => null),
  // Default: no curated accessories, and an anal-appropriate pitched product
  // (MAIN is a p-spot toy) so the #3217 anal-lube dedup fixtures survive the
  // category filter. #3516 tests inject attachFn directly instead.
  getCuratedUpsellCandidates: vi.fn(async () => ({ pitchedTags: ['prostate', 'anal'], candidates: [] })),
}))
vi.mock('../templates/upsell-templates', () => ({
  pickUpsellTemplate: (p: { name: string; price: string }) => `Toss in ${p.name} for ${p.price}?`,
  renderCuratedUpsellTemplate: (p: { name: string; price: string }, blurb: string) =>
    `CURATED [${blurb}] ${p.name} ${p.price}`,
}))
vi.mock('../transitions.server', () => ({ resolveTransition: (_from: string, to: string) => to }))

import {
  executeUpsellStage,
  appendPitchedHandle,
  pickLubeFallback,
  isAnalLubeCard,
  type SearchForIvrFn,
  type AttachSourceFn,
} from '../stages/upsell.server'
import type { EmmaContext, IntentResult } from '../types.server'
import type { IvrProductCard } from '~/lib/ivr-search.server'

const MAIN = 'b-vibe-p-spot-curl'
const JELLE = 'wicked-jelle-plus-anal-lubricant-with-relaxants'
const FIST = 'fist-it-anal-relaxer'

function card(handle: string, title: string, price = 13.99, extra: Partial<IvrProductCard> = {}): IvrProductCard {
  return { handle, title, price, tagline: '', category: '', ...extra } as unknown as IvrProductCard
}

function ctx(pitchedHandlesLog: string[] | null, channel: 'sms' | 'voice' | 'web' = 'voice'): EmmaContext {
  return {
    channel,
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

/** attachFn stub: no curated accessories, anal-appropriate pitched product. */
const noCuratedAnal: AttachSourceFn = async () => ({ pitchedTags: ['prostate', 'anal'], candidates: [] })

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
    const res = await executeUpsellStage(ctx([MAIN]), intent, '', { searchFn, attachFn: noCuratedAnal })

    expect(res.stageOut).toBe('UPSELL')
    expect(res.segments[0]?.productCard?.handle).toBe(JELLE)
    expect(res.stateWrites.pitchedHandlesLog).toEqual([MAIN, JELLE])
  })

  it('does NOT re-pitch an accessory already in the log (the 1560→1562 bug)', async () => {
    const searchFn: SearchForIvrFn = async () => [
      card(JELLE, 'Jelle Plus Anal Lubricant'),
      card(FIST, 'Fist It Anal Relaxer', 26.99),
    ]
    const res = await executeUpsellStage(ctx([MAIN, JELLE]), intent, '', { searchFn, attachFn: noCuratedAnal })

    expect(res.segments[0]?.productCard?.handle).toBe(FIST)
    expect(res.segments[0]?.productCard?.handle).not.toBe(JELLE)
    expect(res.stateWrites.pitchedHandlesLog).toEqual([MAIN, JELLE, FIST])
    expect(res.telemetry.searchRepeatedPitch).toBeUndefined()
  })

  it('short-circuits to CHECKOUT and flags searchRepeatedPitch when every candidate is a repeat', async () => {
    const searchFn: SearchForIvrFn = async () => [card(JELLE, 'Jelle Plus Anal Lubricant')]
    const res = await executeUpsellStage(ctx([MAIN, JELLE]), intent, '', { searchFn, attachFn: noCuratedAnal })

    expect(res.stageOut).toBe('CHECKOUT')
    expect(res.segments[0]?.productCard).toBeUndefined()
    expect(res.telemetry.searchRepeatedPitch).toBe(true)
  })

  it('does not flag searchRepeatedPitch when the search simply returned nothing', async () => {
    const searchFn: SearchForIvrFn = async () => []
    const res = await executeUpsellStage(ctx([MAIN]), intent, '', { searchFn, attachFn: noCuratedAnal })

    expect(res.stageOut).toBe('CHECKOUT')
    expect(res.telemetry.searchRepeatedPitch).toBeUndefined()
  })
})

// ─── #3516 — category-aware lube fallback ─────────────────────────────────────

describe('pickLubeFallback (#3516 fallback matrix)', () => {
  it('anal-tagged pitch → anal lube, allowAnal true', () => {
    expect(pickLubeFallback(['anal', 'plug'])).toEqual({ query: 'anal lube', allowAnal: true })
    expect(pickLubeFallback(['prostate massager'])).toEqual({ query: 'anal lube', allowAnal: true })
    expect(pickLubeFallback(['butt plug'])).toEqual({ query: 'anal lube', allowAnal: true })
  })

  it('anal product_type_dial → anal lube even without an anal tag', () => {
    expect(pickLubeFallback([], 'anal')).toEqual({ query: 'anal lube', allowAnal: true })
  })

  it('non-anal pitch → water-based lube, allowAnal false', () => {
    expect(pickLubeFallback(['cock ring', 'silicone'])).toEqual({ query: 'water-based lube', allowAnal: false })
    expect(pickLubeFallback(['vibrator'], 'vibrator')).toEqual({ query: 'water-based lube', allowAnal: false })
    expect(pickLubeFallback([])).toEqual({ query: 'water-based lube', allowAnal: false })
  })
})

describe('isAnalLubeCard (#3516)', () => {
  it('flags anal / prostate / butt plug products', () => {
    expect(isAnalLubeCard(card('anal-glide', 'Anal Glide Lube'))).toBe(true)
    expect(isAnalLubeCard(card('p-spot', 'Prostate Primer'))).toBe(true)
    expect(isAnalLubeCard(card('bp', 'Silicone Butt Plug'))).toBe(true)
    expect(isAnalLubeCard(card('desc', 'Slippery', 13.99, { tagline: 'made for anal play' }))).toBe(true)
  })

  it('does not flag water-based lube or word-boundary false positives', () => {
    expect(isAnalLubeCard(card('sliquid-h2o', 'Sliquid H2O Water Based Lube'))).toBe(false)
    expect(isAnalLubeCard(card('analog', 'Analog Massage Oil'))).toBe(false) // "analog" is not "anal"
    expect(isAnalLubeCard(card('canal', 'Canal Street Warming Gel'))).toBe(false)
  })
})

describe('executeUpsellStage category-aware fallback (#3516 DONE WHEN 1)', () => {
  it('a NON-insertable pitch never offers anal lube, even when search surfaces one', async () => {
    // Cock-ring pitch (non-anal). Search surfaces an anal lube first (higher
    // margin) plus a water-based lube. The anal lube must be dropped.
    const attachFn: AttachSourceFn = async () => ({ pitchedTags: ['cock ring', 'silicone'], candidates: [] })
    const searchFn: SearchForIvrFn = async () => [
      card('anal-glide', 'Anal Glide Lube', 15.99),
      card('sliquid-h2o', 'Sliquid H2O Water Based Lube', 12.99),
    ]
    const res = await executeUpsellStage(ctx([MAIN]), intent, '', { searchFn, attachFn })

    expect(res.segments[0]?.productCard?.handle).toBe('sliquid-h2o')
    expect(res.segments[0]?.productCard?.handle).not.toBe('anal-glide')
  })

  it('short-circuits to CHECKOUT (no repeat flag) when the only lube found is anal for a non-anal pitch', async () => {
    const attachFn: AttachSourceFn = async () => ({ pitchedTags: ['cock ring'], candidates: [] })
    const searchFn: SearchForIvrFn = async () => [card('anal-glide', 'Anal Glide Lube', 15.99)]
    const res = await executeUpsellStage(ctx([MAIN]), intent, '', { searchFn, attachFn })

    expect(res.stageOut).toBe('CHECKOUT')
    expect(res.segments[0]?.productCard).toBeUndefined()
    // Filtered by category, not a repeat — do not mislabel it.
    expect(res.telemetry.searchRepeatedPitch).toBeUndefined()
  })

  it('an anal/insertable pitch still gets an anal lube', async () => {
    const attachFn: AttachSourceFn = async () => ({ pitchedTags: ['prostate', 'anal'], candidates: [] })
    const searchFn: SearchForIvrFn = async () => [card('anal-glide', 'Anal Glide Lube', 15.99)]
    const res = await executeUpsellStage(ctx([MAIN]), intent, '', { searchFn, attachFn })

    expect(res.stageOut).toBe('UPSELL')
    expect(res.segments[0]?.productCard?.handle).toBe('anal-glide')
  })
})

// ─── #3516 — curated attach primary path ──────────────────────────────────────

describe('executeUpsellStage curated attach primary (#3516 DONE WHEN 2)', () => {
  it('pitches the curated accessory with its pairing_why blurb, without searching', async () => {
    const searchFn = vi.fn(async () => [card('some-lube', 'Some Lube')])
    const attachFn: AttachSourceFn = async () => ({
      pitchedTags: ['cock ring'],
      candidates: [
        { handle: 'toy-cleaner', title: 'Refresh Toy Cleaner', price: 9.99, inStock: true, pairingWhy: 'Keep it fresh so it lasts.' },
      ],
    })
    const res = await executeUpsellStage(ctx([MAIN]), intent, '', { searchFn: searchFn as unknown as SearchForIvrFn, attachFn })

    expect(res.stageOut).toBe('UPSELL')
    expect(res.segments[0]?.productCard?.handle).toBe('toy-cleaner')
    // Curated prose used the blurb, not the generic rotating template.
    expect(res.segments[0]?.prose).toContain('Keep it fresh so it lasts.')
    expect(res.segments[0]?.prose).toContain('CURATED')
    // The curated path never falls through to search.
    expect(searchFn).not.toHaveBeenCalled()
    expect(res.stateWrites.pitchedHandlesLog).toEqual([MAIN, 'toy-cleaner'])
  })

  it('a curated accessory with no blurb still gets pitched via the generic template', async () => {
    const searchFn = vi.fn(async () => [] as IvrProductCard[])
    const attachFn: AttachSourceFn = async () => ({
      pitchedTags: ['cock ring'],
      candidates: [{ handle: 'warming-gel', title: 'Warming Gel', price: 11.0, inStock: true }],
    })
    const res = await executeUpsellStage(ctx([MAIN]), intent, '', { searchFn: searchFn as unknown as SearchForIvrFn, attachFn })

    expect(res.segments[0]?.productCard?.handle).toBe('warming-gel')
    expect(res.segments[0]?.prose).toContain('Warming Gel')
    expect(res.segments[0]?.prose).not.toContain('CURATED')
    expect(searchFn).not.toHaveBeenCalled()
  })

  it('skips out-of-stock and already-pitched curated candidates and falls back to search', async () => {
    const searchFn: SearchForIvrFn = async () => [card('sliquid-h2o', 'Sliquid H2O Water Based Lube', 12.99)]
    const attachFn: AttachSourceFn = async () => ({
      pitchedTags: ['cock ring'],
      candidates: [
        { handle: 'oos-cleaner', title: 'Out Of Stock Cleaner', price: 9.99, inStock: false, pairingWhy: 'x' },
        { handle: 'already', title: 'Already Pitched', price: 8.0, inStock: true, pairingWhy: 'y' },
      ],
    })
    const res = await executeUpsellStage(ctx([MAIN, 'already']), intent, '', { searchFn, attachFn })

    // Both curated candidates are unavailable → category-aware lube fallback.
    expect(res.segments[0]?.productCard?.handle).toBe('sliquid-h2o')
  })

  it('web channel curated pitch carries tap-chip pill options', async () => {
    const attachFn: AttachSourceFn = async () => ({
      pitchedTags: ['cock ring'],
      candidates: [{ handle: 'toy-cleaner', title: 'Refresh Toy Cleaner', price: 9.99, inStock: true, pairingWhy: 'Keep it fresh.' }],
    })
    const res = await executeUpsellStage(ctx(null, 'web'), intent, '', { attachFn })
    expect(res.segments[0]?.pillOptions).toEqual(['Add it', 'No thanks'])
  })
})
