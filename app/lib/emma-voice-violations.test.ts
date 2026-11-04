import { describe, it, expect } from 'vitest'
import { scanEmmaVoiceText, findEmmaVoiceViolationNames, scanEmmaVoiceFields } from './emma-voice-violations'

describe('scanEmmaVoiceText — lived experience', () => {
  it('flags "I tried"', () => {
    expect(findEmmaVoiceViolationNames('I tried this last night.')).toContain('i-tried-tested')
  })

  it('flags "I love how substantial it feels in your hands" (#8102)', () => {
    expect(findEmmaVoiceViolationNames('I love how substantial it feels in your hands, like it was built to become a favorite.'))
      .toContain('i-love-like-how-it-feels')
  })

  it('flags "I own" and "my nightstand"', () => {
    expect(findEmmaVoiceViolationNames('I own one and it lives on my nightstand.')).toEqual(
      expect.arrayContaining(['i-own', 'my-place-things']),
    )
  })

  it('does not flag second-person or catalog-knowledge phrasing', () => {
    expect(findEmmaVoiceViolationNames("You'll love how this feels against your skin.")).toEqual([])
    expect(findEmmaVoiceViolationNames('Known for its quiet motor and reviewers describe it as travel-friendly.')).toEqual([])
    expect(findEmmaVoiceViolationNames("I'd pair this with a water-based lube.")).toEqual([])
  })
})

describe('scanEmmaVoiceText — self-narration trust', () => {
  it('flags "Trust me"', () => {
    expect(findEmmaVoiceViolationNames('Trust me, less effort often means way more pleasure here.')).toContain('trust-me')
  })

  it('flags "I know the catalog" and "I am unbiased"', () => {
    expect(findEmmaVoiceViolationNames('I know this catalog cold.')).toContain('i-know-the-catalog')
    expect(findEmmaVoiceViolationNames('I am unbiased about every brand here.')).toContain('i-am-unbiased')
  })
})

describe('scanEmmaVoiceText — em-dash and Emma byline', () => {
  it('flags a bare em-dash', () => {
    expect(findEmmaVoiceViolationNames('Quiet motor — built for travel.')).toContain('em-dash')
  })

  it('flags the "— Emma ·" byline but not a plain em-dash aside without it', () => {
    const names = findEmmaVoiceViolationNames('— Emma · keeping this close')
    expect(names).toContain('emma-byline')
    expect(names).toContain('em-dash') // the byline itself contains an em-dash too
  })

  it('does not flag a hyphen or en-dash range', () => {
    expect(findEmmaVoiceViolationNames('Battery life: 3-4 hours.')).toEqual([])
  })
})

describe('scanEmmaVoiceText — the Tantus P-spot full_story excerpt (#8102)', () => {
  it('flags all three documented violations in one block', () => {
    const text = 'this is my go-to recommendation, I love how substantial it feels in your hands, '
      + 'like it was built to become a favorite rather than a one-time experiment. '
      + 'Trust me, less effort often means way more pleasure here.'
    const categories = scanEmmaVoiceText(text).map(h => h.category)
    expect(categories).toEqual(expect.arrayContaining(['lived-experience', 'self-narration-trust']))
  })
})

describe('scanEmmaVoiceFields — per-field attribution', () => {
  it('attaches the field name to each hit', () => {
    const hits = scanEmmaVoiceFields({
      tagline:    '— Emma · keeping this close',
      full_story: 'I tried this and loved it.',
      works_for_him: null,
      seo_meta_description: 'A quiet, travel-friendly massager with three intensities.',
    })
    const byField = new Map(hits.map(h => [h.field, h.name]))
    expect(byField.get('tagline')).toBe('emma-byline')
    expect(hits.some(h => h.field === 'full_story' && h.category === 'lived-experience')).toBe(true)
    expect(hits.some(h => h.field === 'seo_meta_description')).toBe(false)
  })
})
