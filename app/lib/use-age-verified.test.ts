// @vitest-environment jsdom
//
// Regression tests for ticket #3424: localStorage.setItem was called
// unguarded while readVerified was try/caught, so a throwing setItem
// (private browsing, quota exceeded) killed the confirm() click handler
// before state flipped, permanently locking the visitor out of their cart.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readVerified, writeVerified } from './use-age-verified'

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('writeVerified', () => {
  it('persists a verification readVerified accepts', () => {
    expect(readVerified()).toBe(false)
    writeVerified()
    expect(readVerified()).toBe(true)
  })

  it('does not throw when localStorage.setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    expect(() => writeVerified()).not.toThrow()
  })
})

describe('readVerified', () => {
  it('returns false on garbage payloads instead of throwing', () => {
    window.localStorage.setItem('xdipx_age_verified', 'not json')
    expect(readVerified()).toBe(false)
  })

  it('expires a verification older than 30 days', () => {
    window.localStorage.setItem(
      'xdipx_age_verified',
      JSON.stringify({
        verified: true,
        timestamp: Date.now() - 31 * 24 * 60 * 60 * 1000,
        version: '1.0',
      }),
    )
    expect(readVerified()).toBe(false)
  })
})
