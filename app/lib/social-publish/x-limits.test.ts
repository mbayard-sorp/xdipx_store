// X post length and cost arithmetic.
//
// Both rules decide something expensive. Length decides whether a post is
// rejected AFTER its media upload has been billed, and cost decides when the
// month's spend ceiling stops the publisher. Neither is complicated; both are
// easy to get subtly wrong, which is why they are pure functions with tests
// rather than inline expressions at the call site.
import { describe, it, expect } from 'vitest'
import {
  weightedTweetLength,
  captionHasLink,
  estimateXPostCostUsd,
  estimateXSpendUsd,
  X_CAPTION_MAX,
  T_CO_LENGTH,
  X_COST_PER_POST_USD,
  X_COST_PER_LINKED_POST_USD,
} from './x-limits'

const PDP = 'https://xdipx.com/products/some-quite-long-product-handle-here'

describe('weightedTweetLength', () => {
  it('counts a plain caption as its own length', () => {
    expect(weightedTweetLength('hello there')).toBe(11)
  })

  it('counts a link at t.co width, not its real length', () => {
    // The real URL is far longer than 23; X bills it at 23.
    expect(PDP.length).toBeGreaterThan(T_CO_LENGTH)
    expect(weightedTweetLength(PDP)).toBe(T_CO_LENGTH)
  })

  it('weights each link separately alongside surrounding text', () => {
    const caption = `a b ${PDP} c d ${PDP}`
    // 'a b ' + 'c d ' plus the two links, with the spaces around them retained.
    const textOnly = caption.replace(/https?:\/\/\S+/g, '').length
    expect(weightedTweetLength(caption)).toBe(textOnly + 2 * T_CO_LENGTH)
  })

  it('accepts a caption that only fits once links are weighted', () => {
    // 270 characters of text plus a 60-character URL is 330 raw, which a naive
    // length check would reject, and 293 weighted... still too long. Trim to a
    // case that is over raw and under weighted.
    const caption = `${'x'.repeat(250)} ${PDP}`
    expect(caption.length).toBeGreaterThan(X_CAPTION_MAX)
    expect(weightedTweetLength(caption)).toBeLessThanOrEqual(X_CAPTION_MAX)
  })
})

describe('captionHasLink', () => {
  it('is true for http and https', () => {
    expect(captionHasLink('see https://xdipx.com')).toBe(true)
    expect(captionHasLink('see http://xdipx.com')).toBe(true)
  })

  it('is false for a bare domain with no scheme', () => {
    // Deliberate: X only rewrites and bills what it recognises as a link, and
    // the cost tier follows X's behaviour rather than our intent.
    expect(captionHasLink('see xdipx.com')).toBe(false)
  })

  it('does not leak regex state between calls', () => {
    // The module-level regex carries /g. If lastIndex is not reset, the second
    // identical call returns the wrong answer.
    const caption = 'go to https://xdipx.com now'
    expect(captionHasLink(caption)).toBe(true)
    expect(captionHasLink(caption)).toBe(true)
  })
})

describe('cost', () => {
  it('charges the linked tier for a caption with a link', () => {
    expect(estimateXPostCostUsd(`look ${PDP}`)).toBe(X_COST_PER_LINKED_POST_USD)
  })

  it('charges the plain tier otherwise', () => {
    expect(estimateXPostCostUsd('no link here')).toBe(X_COST_PER_POST_USD)
  })

  it('sums a month of mixed posts', () => {
    const spend = estimateXSpendUsd([`a ${PDP}`, 'b', `c ${PDP}`])
    expect(spend).toBeCloseTo(2 * X_COST_PER_LINKED_POST_USD + X_COST_PER_POST_USD, 10)
  })

  it('is zero for an empty month', () => {
    expect(estimateXSpendUsd([])).toBe(0)
  })

  it('makes a linked post cost more than 13x a plain one', () => {
    // The whole reason the tiers are modelled rather than averaged. If this
    // ratio ever collapses, the spend guard is over-engineered and can go.
    expect(X_COST_PER_LINKED_POST_USD / X_COST_PER_POST_USD).toBeGreaterThan(13)
  })
})
