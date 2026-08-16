import { describe, expect, it } from 'vitest'
import { normalizeForTTS, ssmlToSpokenText } from './tts-normalize'

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

describe('ssmlToSpokenText', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(ssmlToSpokenText(null)).toBe('')
    expect(ssmlToSpokenText(undefined)).toBe('')
    expect(ssmlToSpokenText('')).toBe('')
  })

  it('strips speak and break tags and decodes entities', () => {
    // Verbatim shape of a stored v2 voice turn. The bridge used to strip the
    // tags and hand "&apos;" to ElevenLabs, which read it aloud.
    expect(
      ssmlToSpokenText(
        '<speak>It&apos;s water based so it&apos;s safe with that plug. <break time="300ms"/> Want me to text you the link?</speak>',
      ),
    ).toBe("It's water based so it's safe with that plug. Want me to text you the link?")
  })

  it('decodes all five XML entities without double-decoding &amp;', () => {
    expect(ssmlToSpokenText('<speak>Tom &amp; Jerry say &quot;hi&quot;</speak>')).toBe(
      'Tom & Jerry say hi',
    )
    // "&amp;apos;" must decode to the literal text "&apos;"-as-ampersand-form,
    // never collapse twice into an apostrophe.
    expect(ssmlToSpokenText('a &amp;apos; b')).toBe('a &apos; b')
  })

  it('normalizes what survives reassembly (em-dashes, emoji, markdown)', () => {
    expect(ssmlToSpokenText('<speak>Great pick — you&apos;ll love it ❤️</speak>')).toBe(
      "Great pick, you'll love it",
    )
  })

  it('handles numeric apostrophe entities', () => {
    expect(ssmlToSpokenText('<speak>it&#39;s here</speak>')).toBe("it's here")
  })
})
