/**
 * upsell-voice-charter.test.ts
 *
 * Ticket #3218. Voice-charter regressions in the upsell closers and the
 * multi-result list:
 *   1. No fabricated social proof or lived-experience claims in any upsell
 *      closer variant (Emma is an AI guide with no lived experience and the
 *      store has no collective-sentiment data).
 *   2. Closers are keyed to the session pitch ordinal, so two different
 *      accessories pitched in one conversation never share a closer.
 *   3. The voice multi-result list is a natural spoken sentence, not a numbered
 *      "1. … 2. … 3. …" list read aloud.
 */
import { describe, it, expect } from 'vitest'
import {
  pickUpsellTemplate,
  renderCuratedUpsellTemplate,
  type UpsellTemplateChannel,
} from '../templates/upsell-templates'
import { buildMultiResultProse } from '../stages/discovery.server'
import type { IvrProductCard } from '~/lib/ivr-search.server'

const SLOTS = { name: 'Test Lube', price: '$19', pdpUrl: 'https://xdipx.com/products/test-lube' }
const CHANNELS: UpsellTemplateChannel[] = ['sms', 'voice', 'web']

// Collective-sentiment / lived-experience phrasings the charter bans.
const BANNED = [
  /folks tell me/i,
  /most folks/i,
  /people love/i,
  /the ones who skip/i,
  /regret/i,
  /send a friend home/i,
]

const BANK_SIZE = 5

describe('upsell closers — no fabricated proof (#3218)', () => {
  for (const channel of CHANNELS) {
    it(`${channel}: every variant is free of banned collective-sentiment phrasing`, () => {
      for (let i = 0; i < BANK_SIZE; i++) {
        const prose = pickUpsellTemplate(SLOTS, channel, i)
        for (const re of BANNED) {
          expect(prose, `variant ${i} on ${channel}: "${prose}"`).not.toMatch(re)
        }
      }
    })

    it(`${channel}: no em-dashes (brand rule)`, () => {
      for (let i = 0; i < BANK_SIZE; i++) {
        expect(pickUpsellTemplate(SLOTS, channel, i)).not.toContain('—')
      }
    })
  }
})

describe('upsell closer rotation keyed to pitch ordinal (#3218)', () => {
  it('consecutive pitches in a session get distinct closers', () => {
    const seen = new Set<string>()
    for (let i = 0; i < BANK_SIZE; i++) {
      seen.add(pickUpsellTemplate(SLOTS, 'voice', i))
    }
    expect(seen.size).toBe(BANK_SIZE)
  })

  it('wraps deterministically once the bank is exhausted', () => {
    expect(pickUpsellTemplate(SLOTS, 'sms', BANK_SIZE)).toBe(
      pickUpsellTemplate(SLOTS, 'sms', 0),
    )
  })
})

describe('renderCuratedUpsellTemplate — curated blurb framing (#3516)', () => {
  const SLOTS_C = { name: 'Refresh Toy Cleaner', price: '$10', pdpUrl: 'https://xdipx.com/products/refresh' }

  for (const channel of CHANNELS) {
    it(`${channel}: leads with the blurb and stays free of banned phrasing / em-dashes`, () => {
      const prose = renderCuratedUpsellTemplate(SLOTS_C, 'Keep it fresh so it lasts', channel)
      expect(prose).toContain('Keep it fresh so it lasts')
      expect(prose).toContain('Refresh Toy Cleaner')
      expect(prose).not.toContain('—')
      for (const re of BANNED) expect(prose).not.toMatch(re)
    })

    it(`${channel}: a blurb that ends on a question never yields two question marks (principle 11)`, () => {
      // The blurb is authored in a metafield this function does not control; a
      // rhetorical-question blurb must not collide with the "?" closer.
      const prose = renderCuratedUpsellTemplate(SLOTS_C, 'Ever wonder what that feels like?', channel)
      expect((prose.match(/\?/g) ?? []).length).toBeLessThanOrEqual(1)
    })
  }

  it('voice speaks no URL; sms drops the PDP URL on its own line', () => {
    const voice = renderCuratedUpsellTemplate(SLOTS_C, 'Smooth everything out', 'voice')
    expect(voice).not.toContain('https')
    expect(voice).not.toContain('/products/')
    const sms = renderCuratedUpsellTemplate(SLOTS_C, 'Smooth everything out', 'sms')
    expect(sms).toContain('https://xdipx.com/products/refresh')
  })
})

function card(title: string, handle: string, price: number): IvrProductCard {
  return {
    title,
    handle,
    category: 'lube',
    tagline: '',
    inStock: true,
    price,
    pctOff: 0,
    phrasing: 'msrp_only',
    variantId: 'gid://variant/1',
  }
}

const CARDS: IvrProductCard[] = [
  card('Prowler', 'prowler', 42),
  card('Prowler Plus', 'prowler-plus', 55),
  card('Revo Extreme', 'revo-extreme', 129),
]

describe('voice multi-result list is spoken, not numbered (#3218)', () => {
  const voice = buildMultiResultProse(CARDS, 'voice')

  it('has no numbered-list markers', () => {
    expect(voice).not.toMatch(/(^|\s)\d+\.\s/)
  })

  it('speaks every product name', () => {
    for (const c of CARDS) expect(voice).toContain(c.title)
  })

  it('carries no product URL or link label to read aloud', () => {
    expect(voice).not.toContain('/products/')
    expect(voice).not.toContain('https')
    expect(voice).not.toContain('Take a peek')
  })

  it('leaves the SMS numbered list unchanged (default channel)', () => {
    const sms = buildMultiResultProse(CARDS)
    expect(sms).toMatch(/^1\. /m)
    expect(sms).toContain('https://xdipx.com/products/prowler')
  })
})
