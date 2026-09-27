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
  isRetryFutileXError,
  X_CAPTION_MAX,
  T_CO_LENGTH,
  X_COST_PER_POST_USD,
  X_COST_PER_LINKED_POST_USD,
  X_VIDEO_MAX_DURATION_SEC,
  X_VIDEO_MAX_SIZE_BYTES,
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

describe('isRetryFutileXError (ticket #11155)', () => {
  it('matches the duration pre-flight refusal verbatim', () => {
    const detail = `Video is 141s; X accepts at most ${X_VIDEO_MAX_DURATION_SEC}s. Trim it or post it on Instagram only.`
    expect(isRetryFutileXError(detail)).toBe(true)
  })

  it('matches the size pre-flight refusal verbatim', () => {
    const detail = `Video is ${X_VIDEO_MAX_SIZE_BYTES + 1} bytes; X accepts at most ${X_VIDEO_MAX_SIZE_BYTES}.`
    expect(isRetryFutileXError(detail)).toBe(true)
  })

  it('does not match a transient upload failure', () => {
    expect(isRetryFutileXError('Video upload failed for https://cdn.example.com/clip.mp4: rate limited (429). Not posting without the video.')).toBe(false)
  })

  it('does not match a caption-length rejection', () => {
    expect(isRetryFutileXError(`Post is 300 characters as X counts them (limit ${X_CAPTION_MAX}). Links count as ${T_CO_LENGTH} regardless of real length.`)).toBe(false)
  })

  it('does not match an empty or unrelated detail', () => {
    expect(isRetryFutileXError('')).toBe(false)
    expect(isRetryFutileXError('Media upload failed for https://cdn.example.com/img.jpg. Not posting without the image.')).toBe(false)
  })
})
