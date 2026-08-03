/**
 * voice-price-speech.test.ts
 *
 * Regression tests for priceToSpokenWords in adapters/voice.server.ts.
 *
 * The v2 voice path spoke product-card prices verbatim ("$155.99"), which
 * ElevenLabs reads as digits and a literal decimal point. The IVR channel
 * rules have always required prices as words; only the v1 path enforced it.
 */
import { describe, it, expect } from 'vitest'
import { priceToSpokenWords } from '../adapters/voice.server'

describe('priceToSpokenWords', () => {
  it.each([
    ['$155.99', 'one hundred fifty-five ninety-nine'],
    ['$24.99', 'twenty-four ninety-nine'],
    ['$9.99', 'nine ninety-nine'],
    ['$19.95', 'nineteen ninety-five'],
    ['$100.00', 'one hundred dollars'],
    ['$43.00', 'forty-three dollars'],
    ['$8', 'eight dollars'],
    ['$70.05', 'seventy oh five'],
  ])('%s → "%s"', (input, expected) => {
    expect(priceToSpokenWords(input)).toBe(expected)
  })

  it('accepts a bare number as well as a formatted string', () => {
    expect(priceToSpokenWords(155.99)).toBe('one hundred fifty-five ninety-nine')
  })

  it('never emits a digit for an in-range price', () => {
    for (const cents of [0, 5, 49, 99]) {
      for (const dollars of [1, 9, 20, 99, 155, 499]) {
        const spoken = priceToSpokenWords(dollars + cents / 100)
        expect(spoken).not.toMatch(/\d/)
      }
    }
  })

  it('leaves out-of-range input untouched rather than mangling it', () => {
    expect(priceToSpokenWords('$1200.00')).toBe('$1200.00')
  })
})
