// The card-art doctrine gate on the discovery data path (run 2212).
//
// How the class this pins produces the pixel it prevents, in one sentence
// (run 1703's rule): design-doctrine.md §4.3 forbids an unreviewed supplier
// packshot from rendering as card art, `xdipx.card_art_blocked` is how a
// reviewer says "not this frame", and the homepage hero and every homepage rail
// read their image URL from the discovery index -- so if the index never reads
// that metafield, the flagged frame is the pixel that renders, in the largest
// image on the page.
//
// Four axes, because a guard that pins a value and a count still does not pin a
// placement (ticket #22810):
//   WHAT      -- the gate returns the mood image, or nothing, never the frame.
//   WHERE     -- both discovery projection sites route through it, not one.
//   HOW MANY  -- no direct `featuredImage` -> `imageUrl` assignment survives.
//   HOW MUCH  -- both GraphQL queries actually SELECT the two metafields,
//                without which the gate reads `undefined` and never fires,
//                which is the silent failure a behavioural test cannot see.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { gateCardArtFrame, isCardArtBlocked } from '~/lib/card-art-gate'

const FRAME = { url: 'https://cdn.shopify.com/92268A.jpg', altText: 'packshot' }
const SOURCE = readFileSync(new URL('./discovery.server.ts', import.meta.url), 'utf8')

describe('gateCardArtFrame', () => {
  it('passes the frame through untouched when the product is not blocked', () => {
    expect(gateCardArtFrame(FRAME, { cardArtBlocked: null, moodImageUrl: null })).toEqual(FRAME)
    expect(gateCardArtFrame(FRAME, { cardArtBlocked: 'false', moodImageUrl: null })).toEqual(FRAME)
    expect(gateCardArtFrame(FRAME, { cardArtBlocked: undefined, moodImageUrl: null })).toEqual(FRAME)
  })

  it('returns the reviewed mood image when the product is blocked, with a null alt', () => {
    // Null and not '': both card renderers read `imageAlt ?? title`, and an
    // empty string is not nullish, so '' would ship an empty `alt` on exactly
    // the products a reviewer has already looked at.
    expect(
      gateCardArtFrame(FRAME, { cardArtBlocked: 'true', moodImageUrl: 'https://cdn.shopify.com/mood.jpg' }),
    ).toEqual({ url: 'https://cdn.shopify.com/mood.jpg', altText: null })
  })

  it('returns NO image when blocked with no mood image, never the flagged frame', () => {
    // Hard rule #12616: a missing content field degrades toward the doctrine
    // requirement, not away from it.
    expect(gateCardArtFrame(FRAME, { cardArtBlocked: 'true', moodImageUrl: null })).toEqual({
      url: null,
      altText: null,
    })
    expect(gateCardArtFrame(FRAME, { cardArtBlocked: 'true', moodImageUrl: '   ' })).toEqual({
      url: null,
      altText: null,
    })
  })

  it('blocks only on the exact string Shopify writes for a checked boolean', () => {
    // Other shapes of the same defect (#16885): a truthy-but-wrong value must
    // not block, or every product with a stray value loses its card art.
    expect(isCardArtBlocked('true')).toBe(true)
    for (const raw of ['TRUE', 'True', '1', 'yes', 'on', '', ' true', 'true ', null, undefined]) {
      expect(isCardArtBlocked(raw)).toBe(false)
    }
  })
})

describe('the discovery index applies the gate on every projection site', () => {
  it('routes both projections through gateCardArtFrame', () => {
    // WHERE + HOW MANY. Two sites project a DiscoveryProduct:
    // nodeToDiscoveryProduct() (the catalog crawl) and fetchHonoraryProducts()
    // (collection-pin honorary fallbacks). Run 2212 found the gate missing from
    // both; a fix that reached only one is the exact #22810 shape.
    const calls = SOURCE.match(/gateCardArtFrame\(/g) ?? []
    expect(calls).toHaveLength(2)
  })

  it('leaves no direct featuredImage-to-imageUrl assignment behind', () => {
    // The pattern the fix removes, matched loosely enough to catch it coming
    // back in another spelling (`n.`, `node.`, optional chaining, either field).
    const direct = SOURCE.match(/image(?:Url|Alt)\s*:\s*\w+\.featuredImage/g) ?? []
    expect(direct).toEqual([])
  })

  it('selects card_art_blocked and mood_image_url in every query that reads featuredImage', () => {
    // HOW MUCH, and the load-bearing one. A behavioural test over a hand-built
    // node passes even when the live query never asks Shopify for the
    // metafield, in which case the gate reads `undefined` and never fires: the
    // fix would be green and the pixel would be unchanged. So pin the selection
    // itself, once per query that carries a featuredImage selection.
    const queriesWithFeaturedImage = (SOURCE.match(/featuredImage\s*\{/g) ?? []).length
    expect(queriesWithFeaturedImage).toBe(2)
    expect((SOURCE.match(/key:\s*"card_art_blocked"/g) ?? []).length).toBe(queriesWithFeaturedImage)
    expect((SOURCE.match(/key:\s*"mood_image_url"/g) ?? []).length).toBe(queriesWithFeaturedImage)
  })
})
