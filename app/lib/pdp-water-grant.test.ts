import { describe, expect, it } from 'vitest'
import { findPdpWaterGrants, sentenceGrantsUnrestrictedPdpWater } from './pdp-water-grant'

describe('sentenceGrantsUnrestrictedPdpWater', () => {
  // The 3 live defect sentences from the content run 2074 audit (ticket
  // #22588), pinned verbatim as positive cases so recall does not regress.
  it('flags the live iroha-kushi-nadeshiko Emma\'s-take sentence (vendor adjective, no IP code)', () => {
    expect(sentenceGrantsUnrestrictedPdpWater("it's waterproof enough for the shower")).toBe(true)
  })

  it('flags the live iroha-mai-tsuru Emma\'s-take sentence (vendor adjective, no IP code)', () => {
    expect(
      sentenceGrantsUnrestrictedPdpWater(
        'Waterproof and washable, it lives in the shower as easily as the nightstand.',
      ),
    ).toBe(true)
  })

  it('flags the live womanizer-snap-crushed-berry sentence (IPX7 mark extended to shower)', () => {
    expect(sentenceGrantsUnrestrictedPdpWater('waterproof clears it for the shower')).toBe(true)
  })

  it('flags a bare depth figure promoted to a shower permission', () => {
    expect(
      sentenceGrantsUnrestrictedPdpWater('Rated to 20 inches underwater, it is perfectly safe for the shower.'),
    ).toBe(true)
  })

  it('does not flag a sentence with a restriction clause in the same sentence', () => {
    expect(
      sentenceGrantsUnrestrictedPdpWater(
        'Its IPX6 rating is splash-resistant, so keep it out of the shower and never submerge it.',
      ),
    ).toBe(false)
  })

  it('does not flag a sentence with no weak water basis', () => {
    expect(sentenceGrantsUnrestrictedPdpWater('Take it into the shower for a change of pace.')).toBe(false)
  })

  it('does not flag a sentence with no water-permission phrase', () => {
    expect(sentenceGrantsUnrestrictedPdpWater('This toy is waterproof and rated IPX7 by the manufacturer.')).toBe(
      false,
    )
  })

  it('does not flag a sink-rinse-only sentence that still mentions waterproof and shower', () => {
    expect(
      sentenceGrantsUnrestrictedPdpWater(
        'Waterproof for a sink rinse only, this is not shower-safe and should never go near the shower.',
      ),
    ).toBe(false)
  })

  it('does not flag an empty or missing sentence', () => {
    expect(sentenceGrantsUnrestrictedPdpWater('')).toBe(false)
    expect(sentenceGrantsUnrestrictedPdpWater(null)).toBe(false)
    expect(sentenceGrantsUnrestrictedPdpWater(undefined)).toBe(false)
  })
})

describe('findPdpWaterGrants', () => {
  it('reports the surface of each hit across description, tagline, and fullStory', () => {
    const hits = findPdpWaterGrants({
      handle: 'test-handle',
      description: 'A quiet, body-safe wand with a soft head.',
      tagline: "It's waterproof enough for the shower.",
      fullStory: 'Waterproof and washable, it lives in the shower as easily as the nightstand.',
    })
    expect(hits).toHaveLength(2)
    expect(hits.map(h => h.surface)).toEqual(['tagline', 'fullStory'])
  })

  it('strips HTML before scanning descriptionHtml-sourced text', () => {
    const hits = findPdpWaterGrants({
      handle: 'test-handle',
      description: '<p>Waterproof clears it for the <strong>shower</strong>.</p>',
    })
    expect(hits).toHaveLength(1)
    expect(hits[0]?.sentence).toContain('shower')
  })

  it('returns no hits for clean copy with a correctly-scoped restriction', () => {
    const hits = findPdpWaterGrants({
      handle: 'test-handle',
      description: 'Its IPX6 rating handles splashes and a quick rinse, but keep it out of the shower and the bath.',
      tagline: 'A quiet companion for the nightstand.',
      fullStory: null,
    })
    expect(hits).toHaveLength(0)
  })

  it('returns no hits when every surface is empty', () => {
    expect(findPdpWaterGrants({ handle: 'test-handle' })).toHaveLength(0)
  })
})
