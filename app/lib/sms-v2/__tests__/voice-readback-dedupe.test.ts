/**
 * voice-readback-dedupe.test.ts
 *
 * Regression tests for the redundant product readback on the IVR voice path.
 *
 * The adapter appended the productCard title + price and "Want me to text you
 * the link?" unconditionally, on top of prose that had usually already said
 * both. On call CAc0f0860abd080f9dd0ec3b39a3cd7585 the caller's last turn
 * before hanging up was:
 *
 *   "For a first time, I'd start with the Luster Anal Plug Set 3 Piece
 *    Beginner Kit at thirty nine ninety nine. Three graduated sizes means you
 *    go at your own pace, no guesswork on where to begin. Want me to text you
 *    that link too?  <break/>  Luster Anal Plug Set 3 Piece Beginner Kit,
 *    thirty-nine ninety-nine  <break/>  Want me to text you the link?"
 *
 * Product name twice, price twice, same question twice.
 */
import { describe, it, expect } from 'vitest'
import { proseNamesProduct, proseAsksToText } from '../adapters/voice.server'

// Verbatim from sms_turns id=1535, the last thing the caller heard.
const CALL_1535_PROSE =
  "For a first time, I'd start with the Luster Anal Plug Set 3 Piece Beginner Kit at thirty nine ninety nine. Three graduated sizes means you go at your own pace, no guesswork on where to begin. Want me to text you that link too?"

// Verbatim from sms_turns id=1532.
const CALL_1532_PROSE =
  "That's exactly what the We Vibe Chorus Pro is built for. It stays between you both during sex, powerful rumble for her while you both feel it together. Want me to text you the link?"

describe('proseNamesProduct', () => {
  it('catches the exact-title case that shipped the double readback', () => {
    expect(
      proseNamesProduct(CALL_1535_PROSE, 'Luster Anal Plug Set 3 Piece Beginner Kit'),
    ).toBe(true)
  })

  it('catches a paraphrase of a longer catalog title', () => {
    // Prose says "the We Vibe Chorus Pro"; the catalog title carries colorway
    // and category noise the model correctly dropped.
    expect(
      proseNamesProduct(CALL_1532_PROSE, 'Satin Black We Vibe Chorus Pro Couples Vibrator'),
    ).toBe(true)
  })

  it('does not fire when the prose never names the product', () => {
    expect(
      proseNamesProduct(
        'Good thinking. Most couples who go that route say lube makes everything better.',
        'Luster Anal Plug Set 3 Piece Beginner Kit',
      ),
    ).toBe(false)
  })

  it('does not fire on generic word overlap alone', () => {
    // "plug", "set", "kit", "beginner" are all stopwords — a sentence built
    // only from them must not suppress a real readback.
    expect(
      proseNamesProduct(
        'A beginner kit is a good place to start, and a plug set gives you options.',
        'Luster Anal Plug Set 3 Piece Beginner Kit',
      ),
    ).toBe(false)
  })

  it('handles an empty or punctuation-only title without matching', () => {
    expect(proseNamesProduct(CALL_1535_PROSE, '')).toBe(false)
    expect(proseNamesProduct(CALL_1535_PROSE, '--- ///')).toBe(false)
  })
})

describe('proseAsksToText', () => {
  it.each([
    'Want me to text you that link too?',
    'Want me to text you the link?',
    'Want me to send it over?',
    'Should I text that to you?',
  ])('detects "%s"', (prose) => {
    expect(proseAsksToText(prose)).toBe(true)
  })

  it('detects the ask inside the full turn prose', () => {
    expect(proseAsksToText(CALL_1535_PROSE)).toBe(true)
    expect(proseAsksToText(CALL_1532_PROSE)).toBe(true)
  })

  it('does not fire on prose with no link offer', () => {
    expect(
      proseAsksToText(
        'Good thinking. Have either of you tried anal play before?',
      ),
    ).toBe(false)
  })

  it('does not fire on an unrelated use of "send"', () => {
    expect(proseAsksToText('That one will send shivers everywhere.')).toBe(false)
  })
})
