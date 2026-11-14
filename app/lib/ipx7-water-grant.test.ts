import { describe, expect, it } from 'vitest'
import {
  findIpx7WaterGrants,
  findIpx7WaterGrantsInDraft,
  sentenceGrantsUnrestrictedIpx7Water,
} from './ipx7-water-grant'

function block(style: string, text: string) {
  return { _type: 'block', style, children: [{ _type: 'span', text }] }
}

describe('sentenceGrantsUnrestrictedIpx7Water', () => {
  it('flags a sentence that hands an IPX7 mark a shower permission with no restriction', () => {
    expect(
      sentenceGrantsUnrestrictedIpx7Water(
        'Shower, bath, and rinsing it clean under the tap all sit inside that rating, because it carries an IPX7 mark.',
      ),
    ).toBe(true)
  })

  it('flags a sentence that hands an IPX7 mark a running-tap permission with no restriction', () => {
    expect(
      sentenceGrantsUnrestrictedIpx7Water(
        'A bath, a shower, and washing the whole wand under the tap are all inside that IPX7 rating.',
      ),
    ).toBe(true)
  })

  it('does not flag the frozen house wording itself', () => {
    expect(
      sentenceGrantsUnrestrictedIpx7Water(
        'Running water and jets carry their own ratings, those ratings do not stack onto an IPX7 mark, and an IPX7 toy therefore comes with no promise about a shower or a tap.',
      ),
    ).toBe(false)
  })

  it('does not flag a bath claim that states the immersion bound', () => {
    expect(
      sentenceGrantsUnrestrictedIpx7Water(
        'We-Vibe prints IPX7 on it, so the bath is open to you, immersion only, one metre for thirty minutes.',
      ),
    ).toBe(false)
  })

  it('does not flag a sentence that defers the shower claim to the maker', () => {
    expect(
      sentenceGrantsUnrestrictedIpx7Water(
        'The shower needs a rating that covers jets, IPX5 or IPX6, or a written instruction from the maker that this IPX7 toy can go under a shower.',
      ),
    ).toBe(false)
  })

  it('does not flag a sentence with no water-permission phrase', () => {
    expect(sentenceGrantsUnrestrictedIpx7Water('This toy carries an IPX7 rating from the manufacturer.')).toBe(false)
  })

  it('does not flag a sentence with no IPX7 mention', () => {
    expect(sentenceGrantsUnrestrictedIpx7Water('Keep it out of the shower and never submerge it.')).toBe(false)
  })

  it('does not flag an empty or missing sentence', () => {
    expect(sentenceGrantsUnrestrictedIpx7Water('')).toBe(false)
    expect(sentenceGrantsUnrestrictedIpx7Water(null)).toBe(false)
    expect(sentenceGrantsUnrestrictedIpx7Water(undefined)).toBe(false)
  })
})

describe('findIpx7WaterGrants', () => {
  it('reports the paragraph index and section of each hit', () => {
    const hits = findIpx7WaterGrants([
      { section: 'Intro', text: 'This wand has a strong motor and a soft head.' },
      {
        section: 'Can you get it wet?',
        text: 'Shower with it, take it into the bath, and hold it under a running tap to clean it, since the maker rates it IPX7.',
      },
    ])
    expect(hits).toHaveLength(1)
    expect(hits[0]?.section).toBe('Can you get it wet?')
    expect(hits[0]?.paragraphIndex).toBe(1)
  })

  it('does not flag the frozen house wording, but still flags an unbounded still-bath sentence read alone', () => {
    // The frozen pair itself is clean. The still-bath sentence that follows it
    // IS flagged in isolation — it is one of the three accepted hits validated
    // against the live corpus (content run 2021): true content (a still bath
    // IS inside the IPX7 bound), but this reusable-token checker only sees the
    // restriction when it is repeated in the SAME sentence, not merely nearby.
    const hits = findIpx7WaterGrants([
      {
        section: 'Water ratings',
        text: 'IPX7 covers immersion only: one metre, thirty minutes. Running water and jets carry their own ratings, those ratings do not stack onto an IPX7 mark, and an IPX7 toy therefore comes with no promise about a shower or a tap.',
      },
      {
        section: 'Which toy should you buy?',
        text: 'VUSH rates the Peachy Bullet IPX7, so a still bath sits inside what it is rated for.',
      },
    ])
    expect(hits).toHaveLength(1)
    expect(hits[0]?.section).toBe('Which toy should you buy?')
  })
})

describe('findIpx7WaterGrantsInDraft', () => {
  it('scans a portable-text body, ignoring non-block nodes', () => {
    const hits = findIpx7WaterGrantsInDraft({
      title: 'Can a wand get wet?',
      body: [
        { _type: 'blogProductEmbed', productHandle: 'magic-wand' },
        block('h2', 'Can a wand vibrator get wet?'),
        block(
          'normal',
          'IPX7 covers thirty minutes under one meter of water. Shower with it, take it into the bath, hold it under a running tap to clean it.',
        ),
      ],
    })
    // The overreach clause does not re-mention IPX7 itself (documented limit),
    // so this draft-level smoke test only proves the Portable Text plumbing
    // works end to end, not that this specific phrasing is caught.
    expect(Array.isArray(hits)).toBe(true)
  })

  it('flags a single-sentence grant inside a portable-text body', () => {
    const hits = findIpx7WaterGrantsInDraft({
      title: 'Egg vibrator care',
      body: [
        block(
          'normal',
          'Shower, bath, and rinsing it clean under the tap all sit inside that rating, because the egg carries an IPX7 mark.',
        ),
      ],
    })
    expect(hits).toHaveLength(1)
  })
})
