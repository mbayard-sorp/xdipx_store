/**
 * Ticket #12912. SKU 96203 is the documented cost of trusting an ambiguous
 * read as bare: the model briefed from a carton and invented a stalk and
 * club that do not exist. These tests pin the fail-closed contract — only
 * the exact 'bare-text-free' label ever writes a url — and the carton
 * refusal specifically, since that's the ticket's own named failure mode.
 */
import { describe, expect, it } from 'vitest'
import {
  VISION_BARE_REFERENCE_LABELS,
  VISION_BARE_REFERENCE_SYSTEM_PROMPT,
  decideBareReferenceFromVisionLabel,
  parseVisionBareReferenceLabel,
} from '~/lib/bare-reference-vision-check'

const IMG = 'https://cdn.shopify.com/files/96203-product.jpg'

describe('decideBareReferenceFromVisionLabel — only bare-text-free writes a url', () => {
  it('writes the url for bare-text-free', () => {
    const d = decideBareReferenceFromVisionLabel('bare-text-free', IMG)
    expect(d.url).toBe(IMG)
    expect(d.reason).toContain('confirmed bare')
  })

  it.each(VISION_BARE_REFERENCE_LABELS.filter(l => l !== 'bare-text-free'))(
    'keeps url null for %s',
    (label) => {
      const d = decideBareReferenceFromVisionLabel(label, IMG)
      expect(d.url).toBeNull()
      expect(d.reason).toContain('vision check:')
    },
  )

  it('never loosens the carton refusal: SKU 96203 is the documented cost of getting this wrong', () => {
    const d = decideBareReferenceFromVisionLabel('carton', IMG)
    expect(d.url).toBeNull()
    expect(d.reason).toMatch(/carton|packaging/)
  })
})

describe('parseVisionBareReferenceLabel — exact match', () => {
  it.each(VISION_BARE_REFERENCE_LABELS)('parses the exact label token %s', (label) => {
    expect(parseVisionBareReferenceLabel(label)).toBe(label)
    expect(parseVisionBareReferenceLabel(label.toUpperCase())).toBe(label)
    expect(parseVisionBareReferenceLabel(`${label}.`)).toBe(label)
  })
})

describe('parseVisionBareReferenceLabel — fuzzy fallback, fail-closed', () => {
  it('reads a carton description as carton', () => {
    expect(parseVisionBareReferenceLabel('This shows the retail packaging / box.')).toBe('carton')
  })

  it('reads a lifestyle description as lifestyle', () => {
    expect(parseVisionBareReferenceLabel('A model is holding the product in a styled scene.')).toBe('lifestyle')
  })

  it('reads a wordmark description as bare-with-label', () => {
    expect(parseVisionBareReferenceLabel('Bare product but has a visible brand logo on it.')).toBe('bare-with-label')
  })

  it('reads an AI-generated description as ai-generated-or-other', () => {
    expect(parseVisionBareReferenceLabel('This looks AI-generated / synthetic.')).toBe('ai-generated-or-other')
  })

  it('falls back to the non-writing bucket for total gibberish, never to bare-text-free', () => {
    expect(parseVisionBareReferenceLabel('asdkjh qweop')).toBe('ai-generated-or-other')
    expect(parseVisionBareReferenceLabel('')).toBe('ai-generated-or-other')
    expect(parseVisionBareReferenceLabel('I cannot determine this with confidence.')).toBe('ai-generated-or-other')
  })

  it('carton takes precedence over an incidental "bare" mention', () => {
    // A reply that hedges ("the bare product would be nice, but this is the
    // carton") must not fall through to bare-text-free on the word "bare".
    expect(parseVisionBareReferenceLabel('the bare product would be nice, but this is the carton')).toBe('carton')
  })
})

describe('VISION_BARE_REFERENCE_SYSTEM_PROMPT', () => {
  it('lists all five labels verbatim, so the model and the parser share one vocabulary', () => {
    for (const label of VISION_BARE_REFERENCE_LABELS) {
      expect(VISION_BARE_REFERENCE_SYSTEM_PROMPT).toContain(label)
    }
  })
})
