import { describe, expect, it } from 'vitest'
import { normalizeForTTS } from './tts-normalize'

describe('normalizeForTTS', () => {
  it('returns empty string for null/undefined/empty/whitespace', () => {
    expect(normalizeForTTS(null)).toBe('')
    expect(normalizeForTTS(undefined)).toBe('')
    expect(normalizeForTTS('')).toBe('')
    expect(normalizeForTTS('   ')).toBe('')
  })

  it('strips markdown markers', () => {
    expect(normalizeForTTS('**bold**')).toBe('bold')
    expect(normalizeForTTS('_italic_ and `code`')).toBe('italic and code')
    expect(normalizeForTTS('# Heading ~strike~')).toBe('Heading strike')
  })

  it('strips emoji', () => {
    expect(normalizeForTTS('Hey 🎉 there')).toBe('Hey there')
    expect(normalizeForTTS('love it 💜❤️')).toBe('love it')
  })

  it('normalizes smart quotes, em/en dashes, and ellipsis char', () => {
    expect(normalizeForTTS('\u201Chello\u201D')).toBe('hello')
    expect(normalizeForTTS('one \u2014 two')).toBe('one, two')
    expect(normalizeForTTS('pause \u2026 done')).toBe('pause... done')
  })

  it('rewrites xdipx.com using brand pronunciation', () => {
    expect(normalizeForTTS('Visit xdipx.com today')).toBe('Visit ex dip ex dot com today')
  })

  it('spells out generic domains letter-by-letter', () => {
    expect(normalizeForTTS('See example.com')).toBe('See e x a m p l e dot com')
  })

  it('preserves prices and common dotted tokens not in the TLD list', () => {
    expect(normalizeForTTS('Price is $25.99.')).toBe('Price is $25.99.')
    expect(normalizeForTTS('node.js is fine')).toBe('node.js is fine')
  })

  it('collapses repeated period/comma runs correctly', () => {
    expect(normalizeForTTS('wait..,really')).toBe('wait,really')
    expect(normalizeForTTS('hmm....')).toBe('hmm...')
    expect(normalizeForTTS('hmm...')).toBe('hmm...')
    expect(normalizeForTTS('wait..really')).toBe('wait.really')
  })

  it('collapses repeated exclamation/question runs', () => {
    expect(normalizeForTTS('wow!!!')).toBe('wow!')
    expect(normalizeForTTS('what???')).toBe('what?')
    expect(normalizeForTTS('really?!?')).toBe('really?!')
  })

  it('strips quotes, parens, brackets', () => {
    expect(normalizeForTTS('"hi" (there)')).toBe('hi there')
    expect(normalizeForTTS('[note] <tag>')).toBe('note tag')
  })

  it('strips orphan leading punctuation and space-before-punct', () => {
    expect(normalizeForTTS(' , hello')).toBe('hello')
    expect(normalizeForTTS('word ,')).toBe('word,')
    expect(normalizeForTTS('., , , hi')).toBe('hi')
  })

  it('converts word-internal hyphens to spaces', () => {
    expect(normalizeForTTS('ex-dip-ex')).toBe('ex dip ex')
  })

  it('preserves sentence punctuation used for prosody', () => {
    const out = normalizeForTTS('Hello, there. How are you? Great!')
    expect(out).toBe('Hello, there. How are you? Great!')
  })

  it('is idempotent', () => {
    const cases = [
      'Visit xdipx.com today!!',
      '**bold** and _italic_ with \u201Csmart\u201D quotes',
      'wait....,no',
      'ex-dip-ex',
      'Hey 🎉 — going to example.com now',
    ]
    for (const c of cases) {
      const once = normalizeForTTS(c)
      const twice = normalizeForTTS(once)
      expect(twice).toBe(once)
    }
  })
})
