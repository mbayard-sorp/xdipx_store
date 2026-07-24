import { describe, it, expect } from 'vitest'
import {
  TTS_CHARS_PER_SECOND,
  AVATAR_TTS_CHARS_PER_SECOND,
  AVATAR_PART_MAX_SECONDS,
  AVATAR_MAX_SPEECH_SECONDS,
  estimateSpeechSeconds,
  estimateAvatarSpeechSeconds,
  splitSentences,
  splitPresenterLine,
  captionPhrases,
} from './avatar-script'

const PART_BUDGET_CHARS = AVATAR_PART_MAX_SECONDS * AVATAR_TTS_CHARS_PER_SECOND

const shortLine = 'Ten seconds, I will fix it. Store it in the pouch it came with.'

// ~555 chars: well over one 24s part budget at the conservative avatar rate,
// forcing a multi-part split at sentence boundaries.
const longLine =
  'I get paid to shop for your pleasure. Yes, that is a real job. Yes, I will not shut up about it. ' +
  'The world is a little short on joy and I get to go stock it, reading every review and every spec so you never have to guess. ' +
  'My whole job is being picky, so there is nothing you need to figure out. There are no wrong answers here, ever. ' +
  'Everything I am talking about lives at ex dip ex dot com, and my DMs are right there on the site. ' +
  'Slide in whenever a question feels too awkward for the group chat, because nothing is too awkward for me. I always answer.'

describe('estimateSpeechSeconds', () => {
  it('uses the b-roll chars-per-second rate, rounded up', () => {
    expect(estimateSpeechSeconds('a'.repeat(15))).toBe(1)
    expect(estimateSpeechSeconds('a'.repeat(16))).toBe(2)
    expect(estimateSpeechSeconds('  trimmed  ')).toBe(Math.ceil('trimmed'.length / TTS_CHARS_PER_SECOND))
  })
})

describe('estimateAvatarSpeechSeconds', () => {
  it('uses the conservative avatar rate, rounded up', () => {
    expect(AVATAR_TTS_CHARS_PER_SECOND).toBeLessThan(TTS_CHARS_PER_SECOND)
    expect(estimateAvatarSpeechSeconds('a'.repeat(12))).toBe(1)
    expect(estimateAvatarSpeechSeconds('a'.repeat(13))).toBe(2)
    expect(estimateAvatarSpeechSeconds('  trimmed  ')).toBe(Math.ceil('trimmed'.length / AVATAR_TTS_CHARS_PER_SECOND))
  })

  it('estimates higher than the b-roll rate for the same script', () => {
    expect(estimateAvatarSpeechSeconds(longLine)).toBeGreaterThan(estimateSpeechSeconds(longLine))
  })
})

describe('splitSentences', () => {
  it('splits on terminal punctuation and keeps it', () => {
    expect(splitSentences('One. Two! Three? Four')).toEqual(['One.', 'Two!', 'Three?', 'Four'])
  })
})

describe('splitPresenterLine', () => {
  it('returns a single part when the read fits the part budget', () => {
    expect(splitPresenterLine(shortLine)).toEqual([shortLine])
  })

  it('returns empty for blank input', () => {
    expect(splitPresenterLine('   ')).toEqual([])
  })

  it('splits an over-budget line at sentence boundaries', () => {
    expect(estimateAvatarSpeechSeconds(longLine)).toBeGreaterThan(AVATAR_PART_MAX_SECONDS)
    const parts = splitPresenterLine(longLine)
    expect(parts.length).toBeGreaterThan(1)
    // No mid-sentence cuts when every sentence fits the budget: each part ends
    // where a sentence ends.
    for (const part of parts) {
      expect(part.endsWith('.') || part.endsWith('!') || part.endsWith('?')).toBe(true)
    }
    // Nothing lost or reordered.
    expect(parts.join(' ')).toBe(longLine)
  })

  it('never returns a part over the per-part budget', () => {
    for (const part of splitPresenterLine(longLine)) {
      expect(estimateAvatarSpeechSeconds(part)).toBeLessThanOrEqual(AVATAR_PART_MAX_SECONDS)
    }
  })

  it('falls back to comma boundaries for a single long sentence', () => {
    const clause = 'this clause keeps going with plenty of words to fill the space'
    const runOn = `${Array.from({ length: 8 }, () => clause).join(', ')}.`
    expect(splitSentences(runOn)).toHaveLength(1)
    const parts = splitPresenterLine(runOn)
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) {
      expect(estimateAvatarSpeechSeconds(part)).toBeLessThanOrEqual(AVATAR_PART_MAX_SECONDS)
    }
    // Splits land at clause boundaries: every part but the last ends on a comma.
    for (const part of parts.slice(0, -1)) expect(part.endsWith(',')).toBe(true)
    expect(parts.join(' ')).toBe(runOn)
  })

  it('falls back to word boundaries for a single long comma-less sentence', () => {
    const runOn = 'word '.repeat(120).trim()
    expect(runOn.length).toBeGreaterThan(PART_BUDGET_CHARS)
    const parts = splitPresenterLine(runOn)
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) {
      expect(estimateAvatarSpeechSeconds(part)).toBeLessThanOrEqual(AVATAR_PART_MAX_SECONDS)
      expect(part.startsWith('word')).toBe(true)
    }
    expect(parts.join(' ')).toBe(runOn)
  })

  it('caps even a degenerate single word at the budget', () => {
    const blob = 'a'.repeat(PART_BUDGET_CHARS * 2 + 10)
    for (const part of splitPresenterLine(blob)) {
      expect(estimateAvatarSpeechSeconds(part)).toBeLessThanOrEqual(AVATAR_PART_MAX_SECONDS)
    }
  })

  it('a max-cap script splits into at most two renderable parts', () => {
    // 35s worth of chars in even sentences: worst case allowed through enqueue.
    const sentence = 'This sentence is close to fifty characters long.'
    const maxChars = AVATAR_MAX_SPEECH_SECONDS * AVATAR_TTS_CHARS_PER_SECOND
    const sentences: string[] = []
    while (sentences.join(' ').length + sentence.length <= maxChars) sentences.push(sentence)
    const script = sentences.join(' ')
    const parts = splitPresenterLine(script)
    expect(parts.length).toBeLessThanOrEqual(2)
    for (const part of parts) {
      expect(estimateAvatarSpeechSeconds(part)).toBeLessThanOrEqual(AVATAR_PART_MAX_SECONDS)
    }
  })
})

describe('captionPhrases', () => {
  it('keeps short sentences intact', () => {
    expect(captionPhrases('Ten seconds. I will fix it.')).toEqual(['Ten seconds.', 'I will fix it.'])
  })

  it('splits long sentences at commas, then words, under the cap', () => {
    const phrases = captionPhrases(longLine)
    expect(phrases.length).toBeGreaterThan(4)
    for (const p of phrases) expect(p.length).toBeLessThanOrEqual(42)
  })

  it('drops no words', () => {
    const words = longLine.split(/\s+/).length
    const phraseWords = captionPhrases(longLine).join(' ').split(/\s+/).length
    expect(phraseWords).toBe(words)
  })
})
