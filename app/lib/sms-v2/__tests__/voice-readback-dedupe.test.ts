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
import {
  proseNamesProduct,
  proseAsksToText,
  proseEndsWithQuestion,
  pendingLinkDecision,
} from '../adapters/voice.server'

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

describe('proseNamesProduct — trailing feature qualifiers', () => {
  it('suppresses the readback when the pitch omits a trailing qualifier', () => {
    // Verbatim class from call CAedd1e7db: prose named "We Vibe Chorus
    // Adjustable Couples Vibrator", card title carried "with Touch Control".
    // At the old 0.6 threshold this scored 2/4 and the caller heard the full
    // title again — with a different price.
    expect(
      proseNamesProduct(
        'The We Vibe Chorus Adjustable Couples Vibrator is worth a close look. It fits between you both during sex.',
        'Chorus Adjustable Couples Vibrator with Touch Control',
      ),
    ).toBe(true)
  })
})

describe('proseEndsWithQuestion', () => {
  // All five voice upsell closers end on a question. The adapter used to
  // stack "Want me to text you the link?" after every one of them — two
  // different questions in one breath, on every single voice upsell turn.
  it.each([
    'Real talk, the right pairing changes how everything else feels. It runs about eleven ninety nine. Want me to add it?',
    'Should I include it?',
    'Add it for you?',
    'Want me to toss it in?',
    'Should I add it?',
  ])('detects the upsell closer "%s"', (prose) => {
    expect(proseEndsWithQuestion(prose)).toBe(true)
  })

  it('does not fire on declarative prose', () => {
    expect(proseEndsWithQuestion('It arrives in discreet packaging.')).toBe(false)
  })

  it('does not fire when a question is mid-prose but the turn ends declaratively', () => {
    expect(
      proseEndsWithQuestion('Want to know the best part? It charges in an hour.'),
    ).toBe(false)
  })
})

describe('pendingLinkDecision', () => {
  it.each(['Yes.', 'yeah', 'Sure', 'okay', 'Text me the link', 'send it'])(
    'bare permission "%s" sends the pending link',
    (text) => {
      expect(pendingLinkDecision(text)).toBe('send')
    },
  )

  it.each(['No', 'nope', 'not right now', 'never mind'])(
    'refusal "%s" declines',
    (text) => {
      expect(pendingLinkDecision(text)).toBe('decline')
    },
  )

  // The owner-reported confusion: "Yes. Add it." answered with "Just texted
  // it." The add belongs to the stage machine (UPSELL_ACCEPT mints the real
  // cart); the gate must step aside.
  it.each([
    'Yes. Add it.',
    'Yeah. Add it to my bag.',
    'Text me the link to both.',
    'add it to the cart',
    'I will buy it',
  ])('commerce action "%s" passes to the stage machine', (text) => {
    expect(pendingLinkDecision(text)).toBe('pass')
  })

  it.each([
    'Do you have any cock ring recommendations?',
    'How much is it?',
    'What about something for my wife?',
  ])('a new request "%s" passes to the stage machine', (text) => {
    expect(pendingLinkDecision(text)).toBe('pass')
  })
})
