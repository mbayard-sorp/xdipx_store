/**
 * multi-result-links.test.ts
 *
 * conv-audit C7 regression. The deterministic multi-result list
 * (stages/discovery.server.ts buildMultiResultProse) used to emit a RELATIVE
 * Markdown link `[title](/products/handle)` plus an em-dash. On SMS that left a
 * bare relative path that was neither tappable nor iMessage-preview-able (the
 * splitter needs an absolute https URL alone on a line); on voice the path got
 * read aloud character by character.
 *
 * The fix emits an ABSOLUTE https://xdipx.com/products/{handle} URL inside a
 * whitelisted-CTA Markdown link on its own line, drops the em-dash, and teaches
 * the voice URL stripper to drop /products links and bare paths.
 */
import { describe, it, expect } from 'vitest'
import type { IvrProductCard } from '~/lib/ivr-search.server'
import type { StageResponse } from '../types.server'
import { buildMultiResultProse } from '../stages/discovery.server'
import { stripUrlsForVoice } from '../adapters/voice.server'
import { stageResponseToProcessResult } from '../stage-dispatch.server'

function card(title: string, handle: string, price: number): IvrProductCard {
  return {
    title,
    handle,
    category: 'vibrator',
    tagline: '',
    inStock: true,
    price,
    pctOff: 0,
    phrasing: 'msrp_only',
    variantId: 'gid://variant/1',
  }
}

const CARDS: IvrProductCard[] = [
  card('Cosmo Rocket', 'cosmo-rocket', 49.99),
  card('Nova Wand', 'nova-wand', 89.99),
  card('Cozy Plug', 'cozy-plug', 29.99),
]

/** Run the real SMS transform (Markdown strip + URL-on-own-line split). */
function smsSegmentBodies(prose: string): string[] {
  const resp: StageResponse = {
    stageOut: 'DISCOVERY',
    goalAchieved: false,
    segments: [{ prose }],
    stateWrites: {},
    telemetry: { intent: 'RESEARCH', intentConfidence: 1 },
  }
  return stageResponseToProcessResult(resp, false).replies.map((r) => r.body)
}

describe('buildMultiResultProse (conv-audit C7)', () => {
  const prose = buildMultiResultProse(CARDS)

  it('emits an absolute PDP URL for every result', () => {
    for (const c of CARDS) {
      expect(prose).toContain(`https://xdipx.com/products/${c.handle}`)
    }
  })

  it('never emits a relative (host-less) product link', () => {
    expect(prose).not.toMatch(/\]\(\/products\//)
  })

  it('drops the em-dash (brand rule)', () => {
    expect(prose).not.toContain('—')
  })

  it('puts each PDP link alone on its own line', () => {
    for (const c of CARDS) {
      const re = new RegExp(
        `^\\[Take a peek →\\]\\(https://xdipx\\.com/products/${c.handle}\\)$`,
        'm',
      )
      expect(prose).toMatch(re)
    }
  })
})

describe('multi-result SMS rendering (conv-audit C7)', () => {
  const bodies = smsSegmentBodies(buildMultiResultProse(CARDS))

  it('surfaces a tappable absolute URL alone in its own segment', () => {
    // splitProseAtUrl pulls the first url-on-own-line into its own bubble so
    // iMessage renders the OG preview. That segment body must be JUST the URL.
    expect(bodies).toContain('https://xdipx.com/products/cosmo-rocket')
  })

  it('leaves no Markdown syntax or relative path in any SMS segment', () => {
    for (const body of bodies) {
      expect(body).not.toContain('](')
      expect(body).not.toMatch(/(^|\s)\/products\//)
    }
    // Every product URL is present and absolute somewhere in the reply.
    const joined = bodies.join('\n')
    for (const c of CARDS) {
      expect(joined).toContain(`https://xdipx.com/products/${c.handle}`)
    }
  })
})

describe('stripUrlsForVoice (conv-audit C7)', () => {
  it('leaves no product path or URL when reading the multi-result list aloud', () => {
    const spoken = stripUrlsForVoice(buildMultiResultProse(CARDS))
    expect(spoken).not.toContain('/products/')
    expect(spoken).not.toContain('https')
    // The repeated CTA link label is dropped so a call does not hear
    // "Take a peek" once per result.
    expect(spoken).not.toContain('Take a peek')
    // Product names still get spoken.
    for (const c of CARDS) {
      expect(spoken).toContain(c.title)
    }
  })

  it('strips a bare relative /products path a stage emits as text', () => {
    const out = stripUrlsForVoice('Grab it here /products/cosmo-rocket now')
    expect(out).not.toContain('/products/')
  })

  it('only scopes the product-link rule to /products, sparing other link labels', () => {
    const out = stripUrlsForVoice('See [our guide](https://xdipx.com/faq) for more')
    expect(out).toContain('our guide')
    expect(out).not.toContain('https')
  })
})
