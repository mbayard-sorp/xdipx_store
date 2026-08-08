import { describe, expect, it } from 'vitest'
import { buildQueryPatterns } from '~/lib/search.server'

// conv-p1-stt-fuzzy (ticket #623): voice queries arrive as raw Deepgram
// transcripts, and GROQ `match` only does word-prefix matching. buildQueryPatterns
// bridges the gap: mishearings ("loob", "flashlight"), clipped words ("dild"),
// and hyphen/space compound spellings ("strap on") must still emit a prefix
// pattern for the intended catalog word. These tests pin that contract against
// a representative set of transcripts, so a future edit to the dictionary can't
// silently drop a category.

/**
 * The intended catalog word is matched when the pattern set contains a prefix
 * pattern (`word*`) that `word` itself starts with — i.e. some produced token
 * is a case-insensitive prefix of the target. Mirrors how GROQ `match` treats
 * the emitted patterns.
 */
function matchesCategory(transcript: string, categoryWord: string): boolean {
  const target = categoryWord.toLowerCase()
  return buildQueryPatterns(transcript).some(p => {
    const prefix = p.endsWith('*') ? p.slice(0, -1) : p
    return target.startsWith(prefix) && prefix.length > 0
  })
}

describe('buildQueryPatterns — STT mishearings and synonyms', () => {
  // [transcript, intended catalog word]
  const cases: [string, string][] = [
    // lubricant
    ['lube', 'lubricant'],
    ['lubes', 'lubricant'],
    ['lubricant', 'lube'],
    ['loob', 'lubricant'],
    ['loobe', 'lubricant'],
    // vibrator
    ['vibrator', 'vibe'],
    ['vibe', 'vibrator'],
    ['vibrators', 'vibrator'],
    // dildo (clipped trailing vowel is common in STT)
    ['dildo', 'dildo'],
    ['dildos', 'dildo'],
    ['dild', 'dildo'],
    ['dildoe', 'dildo'],
    // bullet
    ['bullet', 'bullet'],
    ['bullit', 'bullet'],
    ['bullets', 'bullet'],
    // stroker / fleshlight
    ['fleshlight', 'fleshlight'],
    ['flashlight', 'fleshlight'],
    ['flashlight', 'stroker'],
    ['stroker', 'masturbator'],
    // wand
    ['wand', 'massager'],
    ['magic wand', 'wand'],
    // rabbit / anal
    ['rabbit', 'rabbit'],
    ['anal beads', 'beads'],
  ]

  it.each(cases)('transcript %j reaches catalog word %j', (transcript, word) => {
    expect(matchesCategory(transcript, word)).toBe(true)
  })
})

describe('buildQueryPatterns — hyphen / space compound spellings', () => {
  // All three spellings of a compound term must reach the same joined + spaced
  // catalog forms, since products may be titled either way.
  const compoundCases: [string, string[]][] = [
    ['strap-on', ['strapon', 'strap on']],
    ['strap on', ['strapon']],
    ['strapon', ['strap on']],
    ['cock ring', ['cockring']],
    ['cockring', ['cock ring']],
    ['butt plug', ['buttplug', 'plug']],
    ['buttplug', ['butt plug', 'plug']],
  ]

  it.each(compoundCases)('%j reaches %j', (transcript, expectedWords) => {
    for (const word of expectedWords) {
      expect(matchesCategory(transcript, word)).toBe(true)
    }
  })
})

describe('buildQueryPatterns — brand aliases', () => {
  const brandCases: [string, string][] = [
    ['womaniser', 'womanizer'],
    ['satisfier', 'satisfyer'],
    ['we vibe', 'we-vibe'],
    ['fun factory', 'fun factory'],
  ]

  it.each(brandCases)('brand transcript %j reaches %j', (transcript, brand) => {
    expect(matchesCategory(transcript, brand)).toBe(true)
  })
})

describe('buildQueryPatterns — invariants preserved', () => {
  it('always includes the original query as a prefix pattern', () => {
    expect(buildQueryPatterns('vibrator')).toContain('vibrator*')
  })

  it('returns an empty array for blank input', () => {
    expect(buildQueryPatterns('')).toEqual([])
    expect(buildQueryPatterns('   ')).toEqual([])
  })

  it('still covers plain pluralization in both directions', () => {
    // "dildos" -> singular "dildo*"; "candy"/"-ies" rule unaffected
    expect(buildQueryPatterns('dildos')).toContain('dildo*')
    expect(buildQueryPatterns('bunnies')).toContain('bunny*')
  })

  it('does not emit duplicate patterns', () => {
    const patterns = buildQueryPatterns('strap-on')
    expect(new Set(patterns).size).toBe(patterns.length)
  })
})
