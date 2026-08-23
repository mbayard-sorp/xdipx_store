import { describe, it, expect } from 'vitest'
import { parseFeedback } from './parse-feedback'

describe('parseFeedback', () => {
  it('returns all-null for null / undefined / empty / whitespace', () => {
    for (const v of [null, undefined, '', '   ']) {
      const p = parseFeedback(v)
      expect(p.gateVerdict).toBeNull()
      expect(p.liveVerdict).toBeNull()
      expect(p.stockGuard).toBeNull()
      expect(p.ownerNotes).toBeNull()
    }
  })

  it('parses a publish-gate PASS stamp with notes and a product handle', () => {
    const p = parseFeedback(
      '[publish-gate PASS by social-publish-gate on 2026-08-20, product: rabbit-vibe]\nClean claims, on-brand.',
    )
    expect(p.gateVerdict).toBe('PASS')
    expect(p.gateReviewer).toBe('social-publish-gate')
    expect(p.gateDate).toBe('2026-08-20')
    expect(p.gateProductHandle).toBe('rabbit-vibe')
    expect(p.gateNotes).toBe('Clean claims, on-brand.')
    expect(p.liveVerdict).toBeNull()
  })

  it('maps a "none" product token to null', () => {
    const p = parseFeedback('[publish-gate BLOCK by gate on 2026-08-01, product: none]\nUnverifiable claim.')
    expect(p.gateVerdict).toBe('BLOCK')
    expect(p.gateProductHandle).toBeNull()
    expect(p.gateNotes).toBe('Unverifiable claim.')
  })

  it('handles a gate stamp with no trailing notes', () => {
    const p = parseFeedback('[publish-gate HOLD by gate on 2026-08-01, product: none]')
    expect(p.gateVerdict).toBe('HOLD')
    expect(p.gateNotes).toBeNull()
  })

  it('parses a live-feedback tag with a note', () => {
    const p = parseFeedback('[live:off] Engagement was flat, wrong hook.')
    expect(p.liveVerdict).toBe('off')
    expect(p.liveNote).toBe('Engagement was flat, wrong hook.')
    expect(p.gateVerdict).toBeNull()
  })

  it('parses a live-feedback tag with no note ("worked")', () => {
    const p = parseFeedback('[live:worked]')
    expect(p.liveVerdict).toBe('worked')
    expect(p.liveNote).toBeNull()
  })

  it('parses a stock-guard tag', () => {
    const p = parseFeedback('[stock-guard] Linked product gid://shopify/Product/999 is out of stock.')
    expect(p.stockGuard).toBe('Linked product gid://shopify/Product/999 is out of stock.')
    expect(p.gateVerdict).toBeNull()
    expect(p.liveVerdict).toBeNull()
  })

  it('treats untagged text as a plain owner note', () => {
    const p = parseFeedback('Swap the caption hook, this reads flat.')
    expect(p.ownerNotes).toBe('Swap the caption hook, this reads flat.')
    expect(p.gateVerdict).toBeNull()
    expect(p.liveVerdict).toBeNull()
    expect(p.stockGuard).toBeNull()
  })
})
