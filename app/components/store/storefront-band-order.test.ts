import { describe, it, expect } from 'vitest'
import { BAND_NAMES, DEFAULT_BAND_ORDER } from './StorefrontHome'

/**
 * The storefront's band order used to be implicit in the JSX. Now it is data,
 * which is what lets Sanity supply an order later. These tests pin the shipped
 * arrangement so that change cannot happen silently: the homepage's section
 * order is a locked shell (docs/homepage-team/redesign-v2-spec.md), and the
 * render-truth gate asserts against what this produces.
 */
describe('storefront band order', () => {
  it('renders the locked shell order', () => {
    expect(DEFAULT_BAND_ORDER).toEqual([
      'hero',
      'anchorGrid',
      'teamRails',
      'meetEmma',
      'wayfinder',
      'emmasEdit',
      'sensationMap',
      'couples',
      'stillDeciding',
      'notebook',
      'faq',
      'emailCapture',
    ])
  })

  it('leads with the hero', () => {
    // The hero carries the H1 and the LCP image. Anything else first moves the
    // largest paint element and breaks the zero-CLS contract the page is gated on.
    expect(DEFAULT_BAND_ORDER[0]).toBe('hero')
  })

  it('closes with the email capture', () => {
    // Locked in the original redesign brief: email is always last.
    expect(DEFAULT_BAND_ORDER.at(-1)).toBe('emailCapture')
  })

  it('renders every known band exactly once', () => {
    expect([...DEFAULT_BAND_ORDER].sort()).toEqual([...BAND_NAMES].sort())
    expect(new Set(DEFAULT_BAND_ORDER).size).toBe(DEFAULT_BAND_ORDER.length)
  })
})
