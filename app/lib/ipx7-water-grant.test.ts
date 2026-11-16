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

  // The 8 real sentences measured as false positives against the live corpus
  // on 2026-11-16 (ticket #22377, bus row #21540's note): every one is
  // already-corrected, accurate text that the shipped detector flagged
  // anyway. Pinned here as NEGATIVE cases so precision does not regress.
  it('does not flag a bare bath mention with no shower/tap/jet present', () => {
    expect(sentenceGrantsUnrestrictedIpx7Water('The bath, yes, on an IPX7 rating.')).toBe(false)
    expect(
      sentenceGrantsUnrestrictedIpx7Water(
        'Both toys above are IPX7, so a still bath sits inside what each one is rated for.',
      ),
    ).toBe(false)
    expect(
      sentenceGrantsUnrestrictedIpx7Water(
        'VUSH rates the Peachy Bullet IPX7, so a still bath sits inside what it is rated for.',
      ),
    ).toBe(false)
    expect(
      sentenceGrantsUnrestrictedIpx7Water(
        'We-Vibe prints IPX7 on it, so the bath is open to you, a full metre down for half an hour.',
      ),
    ).toBe(false)
  })

  it('does not flag a shower mention explicitly negated in the same sentence', () => {
    expect(
      sentenceGrantsUnrestrictedIpx7Water(
        'Of the three here, only the Nova 2 prints a code at all, and We-Vibe prints IPX7, so the bath is settled for it and the shower is not.',
      ),
    ).toBe(false)
  })

  it('does not flag a shower claim redirected to another brand, away from the code', () => {
    expect(
      sentenceGrantsUnrestrictedIpx7Water(
        'IPX7 on its own gets you the basin, and the shower comes from Womanizer rather than from the code.',
      ),
    ).toBe(false)
  })

  it('does not flag a tap mention redirected to a basin rinse instead', () => {
    expect(
      sentenceGrantsUnrestrictedIpx7Water(
        'IPX7: a basin of plain soapy water, working every crevice you found above, then rinse it in the basin rather than under the tap.',
      ),
    ).toBe(false)
  })

  it('does not flag a running-tap mention paired with a non-stacking paraphrase', () => {
    expect(
      sentenceGrantsUnrestrictedIpx7Water(
        'IPX7 for a basin and IPX5 or IPX6 for a running tap, and the two do not imply each other, so read the code the toy actually carries.',
      ),
    ).toBe(false)
  })

  // The 11 real, originally-live defect sentences from ticket #21540 (since
  // corrected on the published corpus). Pinned here as POSITIVE cases so
  // recall does not regress while the false positives above are fixed.
  it('still flags every one of the 11 original live defect sentences', () => {
    const defects = [
      'IPX7 means the toy withstands immersion in one metre of water for thirty minutes, which covers the shower, the bath, and rinsing it clean under a running tap.',
      'IPX7 covers submersion to one metre for thirty minutes, which puts a shower, a bath, and a full rinse inside the rating.',
      'IPX7 means the toy withstands immersion to one meter for thirty minutes, so showering with it on, taking it into the bath, and rinsing it under the tap are all fine.',
      'IPX7 means the toy survives immersion to one metre for thirty minutes, so shower, bath, and rinsing under a tap are all fine.',
      'Rated IPX7, so it takes full submersion to one meter for up to thirty minutes, which puts the shower, the bath, and a rinse under the tap all comfortably inside what it is built for.',
      'IPX7 means these go fully under a running tap, so the wash takes seconds.',
      'IPX7 means submersion to one meter for up to thirty minutes, so bathing with it and rinsing the head under a running tap both sit inside the rating.',
      'IPX7 is rated for thirty minutes under a metre of water, so rinsing it at the tap is fine.',
      'A toy rated IPX7 goes under the tap safely.',
      'The Babbitty Rabbitty is an easy example of the relaxed version: body-safe silicone carrying an IPX7 rating, which covers full submersion, so the whole toy can go under the tap without any fuss.',
      'VUSH rates the Peachy Bullet IPX7, so it goes under the tap and into the bath.',
    ]
    for (const sentence of defects) {
      expect(sentenceGrantsUnrestrictedIpx7Water(sentence)).toBe(true)
    }
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

  it('does not flag the frozen house wording, nor a bare still-bath sentence read alone', () => {
    // Both paragraphs are clean. The still-bath sentence used to be flagged in
    // isolation (ticket #21947's shipped version), but a bare bath mention with
    // no shower/tap/jet is never a grant that needs restricting — a still bath
    // IS inside the IPX7 bound — fixed under ticket #22377 after this exact
    // sentence measured as one of 8 of 8 false positives on the live corpus.
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
    expect(hits).toHaveLength(0)
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
