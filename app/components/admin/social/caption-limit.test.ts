/**
 * Regression guard for the stalled X review queue.
 *
 * The Social Studio's Approve button counted raw `caption.length` against X's
 * 280 ceiling. Every X draft the team writes carries one or two ~90-character
 * PDP URLs, so real drafts measured 375-497 raw and 262-279 as X counts them:
 * the publish gate passed them, X would have accepted them, and the owner's
 * Approve button was disabled on all of them. These assert the review UI now
 * measures a caption the same way the gate and the publisher do.
 */

import { describe, it, expect } from 'vitest'
import {
  captionOverPlatformLimit,
  platformCaptionLength,
  LINKEDIN_CAPTION_MAX,
} from './types'
import { X_CAPTION_MAX } from '~/lib/social-publish/x-limits'

/** Draft #82 verbatim: 491 raw characters, 275 as X counts it. */
const REAL_X_DRAFT =
  'the mini wand that actually rumbles: deep, spread-out, small enough to close ' +
  'your hand around. silicone body, so pair it with water-based lube, not ' +
  'silicone. maya holds the plum and rose-gold one in morning light.\n\n' +
  'wand: https://xdipx.com/products/zola-rechargeable-silicone-mini-wand?utm_source=x&utm_medium=social&utm_campaign=vibrator-field-guide\n' +
  'lube: https://xdipx.com/products/jo-h2o-original-water-based-lubricant-8-oz?utm_source=x&utm_medium=social&utm_campaign=vibrator-field-guide\n'

describe('captionOverPlatformLimit', () => {
  it('approves a real two-link X draft that raw .length would have blocked', () => {
    expect(REAL_X_DRAFT.length).toBeGreaterThan(X_CAPTION_MAX)
    expect(platformCaptionLength('x', REAL_X_DRAFT)).toBeLessThanOrEqual(X_CAPTION_MAX)
    expect(captionOverPlatformLimit('x', REAL_X_DRAFT)).toBe(false)
  })

  it('still blocks an X caption that is genuinely too long', () => {
    const tooLong = 'a'.repeat(X_CAPTION_MAX + 1)
    expect(captionOverPlatformLimit('x', tooLong)).toBe(true)
  })

  it('counts link weight, not link length, on X', () => {
    // 200 plain characters plus one 100-character URL: 300 raw, 223 to X.
    const caption = 'a'.repeat(200) + ' https://xdipx.com/products/' + 'b'.repeat(72)
    expect(caption.length).toBeGreaterThan(X_CAPTION_MAX)
    expect(platformCaptionLength('x', caption)).toBe(224)
    expect(captionOverPlatformLimit('x', caption)).toBe(false)
  })

  it('leaves LinkedIn on plain character count', () => {
    expect(captionOverPlatformLimit('linkedin', 'x'.repeat(LINKEDIN_CAPTION_MAX))).toBe(false)
    expect(captionOverPlatformLimit('linkedin', 'x'.repeat(LINKEDIN_CAPTION_MAX + 1))).toBe(true)
  })

  it('does not cap platforms that have no ceiling in this UI', () => {
    expect(captionOverPlatformLimit('instagram', 'x'.repeat(5000))).toBe(false)
    expect(platformCaptionLength('instagram', 'x'.repeat(5000))).toBe(5000)
  })
})
