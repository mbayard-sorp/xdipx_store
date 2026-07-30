import { describe, expect, it } from 'vitest'
import { BRAND_NAME, BRAND_TITLE, BRAND_DESCRIPTION } from '~/lib/brand'

/**
 * These strings are served to every crawler on every page, so the two ways they
 * can silently go wrong (a banned character, or quietly growing past what a
 * SERP will render) are pinned here rather than left to review.
 *
 * BRAND_TITLE shipped `xdipx — Sexual Wellness, Edited` to production for
 * months, em-dash and all, and an audit that flagged it did not get it fixed.
 */
describe('brand constants', () => {
  const ALL = { BRAND_NAME, BRAND_TITLE, BRAND_DESCRIPTION }

  it.each(Object.entries(ALL))('%s contains no em-dash', (_name, value) => {
    expect(value).not.toContain('—')
  })

  it.each(Object.entries(ALL))('%s contains no en-dash either', (_name, value) => {
    expect(value).not.toContain('–')
  })

  it('BRAND_TITLE fits the ~60 character SERP title cap', () => {
    expect(BRAND_TITLE.length).toBeLessThanOrEqual(60)
  })

  it('BRAND_DESCRIPTION fits the ~155 character SERP description cap', () => {
    expect(BRAND_DESCRIPTION.length).toBeLessThanOrEqual(155)
  })

  it('BRAND_NAME is the bare brand entity, not a tagline', () => {
    // It feeds schema.org Organization `name`. A tagline there is what made
    // Google resolve the brand to "xdipx — Sexual Wellness, Edited".
    expect(BRAND_NAME).toBe('xdipx')
    expect(BRAND_NAME).not.toContain('|')
  })

  it('spells the billing descriptor exactly XDIPX', () => {
    // Charter rule: the card statement always reads XDIPX, never a variant.
    expect(BRAND_DESCRIPTION).toContain('XDIPX')
  })

  it('BRAND_TITLE carries exactly one separator so composed titles stay clean', () => {
    // `_layout._index.tsx` composes `${deal.seoTitle} | ${BRAND_NAME}`. If a
    // second separator ever creeps into BRAND_TITLE and someone composes with
    // it instead, the legacy deal title becomes a double-pipe run-on.
    expect(BRAND_TITLE.split('|')).toHaveLength(2)
  })
})
