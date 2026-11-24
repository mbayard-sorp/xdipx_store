// Unit tests for the frozen-safety-string allowlist (ticket #23880).
//
// routine-content-daily.md Step 5 item 3 says a safety enumeration is
// frozen exactly as published and the fresh-language rule does NOT apply to
// it, but check-fresh-language.ts had no mechanical exemption, so the
// mandated, verbatim IPX7 house wording reported as recycled language on
// every post that correctly reused it (run 2161; run 2175).
import { describe, it, expect } from 'vitest'
import { analyzeFreshness, type DraftInput, type PriorPost } from './fresh-language'
import {
  FROZEN_SAFETY_STRINGS,
  IPX7_HOUSE_WORDING,
  IPX4_HOUSE_WORDING,
  IPX56_JET_CODE_HOUSE_WORDING,
  stripFrozenStrings,
  stripFrozenStringsFromDoc,
} from './fresh-language-frozen-strings'

const h2 = (text: string) => ({ _type: 'block', style: 'h2', children: [{ text }] })
const p = (text: string) => ({ _type: 'block', style: 'normal', children: [{ text }] })

describe('stripFrozenStrings', () => {
  it('removes an exact frozen string, leaving surrounding prose untouched', () => {
    const text = `Before. ${IPX7_HOUSE_WORDING} After.`
    const out = stripFrozenStrings(text)
    expect(out).not.toContain('IPX7 covers immersion only')
    expect(out).toContain('Before.')
    expect(out).toContain('After.')
  })

  it('does not strip a paraphrase: changing one word still matches nothing (#23880 DONE WHEN b)', () => {
    const paraphrased = IPX7_HOUSE_WORDING.replace('one metre', 'one meter')
    expect(stripFrozenStrings(paraphrased)).toBe(paraphrased)
  })

  it('removes every occurrence when the frozen string repeats', () => {
    const text = `${IPX4_HOUSE_WORDING} ${IPX4_HOUSE_WORDING}`
    const out = stripFrozenStrings(text)
    expect(out).not.toContain('IPX4')
  })

  it('removes an exact occurrence of the IPX5/IPX6 jet-code house wording (ticket #24095)', () => {
    const text = `Before. ${IPX56_JET_CODE_HOUSE_WORDING} After.`
    const out = stripFrozenStrings(text)
    expect(out).not.toContain('jet codes')
    expect(out).toContain('Before.')
    expect(out).toContain('After.')
  })

  it('is a no-op on text with no frozen string', () => {
    expect(stripFrozenStrings('Totally unrelated sentence.')).toBe('Totally unrelated sentence.')
  })
})

describe('stripFrozenStringsFromDoc', () => {
  it('strips frozen strings out of title, excerpt, and body block text, preserving structure', () => {
    const doc: DraftInput = {
      title: `A title with ${IPX4_HOUSE_WORDING} inside`,
      excerpt: `An excerpt. ${IPX7_HOUSE_WORDING}`,
      body: [h2('A Heading'), p(`Some prose. ${IPX7_HOUSE_WORDING} More prose.`)],
    }
    const stripped = stripFrozenStringsFromDoc(doc)
    expect(stripped.title).not.toContain('IPX4')
    expect(stripped.excerpt).not.toContain('IPX7')
    const bodyBlocks = stripped.body as { _type: string; style?: string; children: { text: string }[] }[]
    expect(bodyBlocks[0]!.style).toBe('h2')
    expect(bodyBlocks[0]!.children[0]!.text).toBe('A Heading')
    expect(bodyBlocks[1]!.children[0]!.text).not.toContain('IPX7')
    expect(bodyBlocks[1]!.children[0]!.text).toContain('Some prose.')
    expect(bodyBlocks[1]!.children[0]!.text).toContain('More prose.')
  })

  it('leaves non-block body content (embeds, images) untouched', () => {
    const doc = { body: [{ _type: 'blogProductEmbed', productId: 'x' }] } as unknown as PriorPost
    const stripped = stripFrozenStringsFromDoc(doc)
    expect(stripped.body).toEqual([{ _type: 'blogProductEmbed', productId: 'x' }])
  })
})

describe('analyzeFreshness with frozen-string stripping applied (ticket #23880 DONE WHEN a)', () => {
  it('reports no overlap (exit-0 equivalent) when the only shared text is a frozen safety string', () => {
    const draft: DraftInput = {
      title: 'How do you choose a personal massager',
      body: [
        p('A printed ingress rating instead of an adjective.'),
        p(`IPX4 covers splashes only, so keep it out of the shower and never submerge it. ${IPX7_HOUSE_WORDING}`),
      ],
    }
    const prior: PriorPost = {
      slug: 'do-you-need-a-sex-toy-cleaner',
      body: [
        p('Soap and warm water cleans almost every sex toy, for entirely unrelated reasons.'),
        p(IPX7_HOUSE_WORDING),
      ],
    }

    // Without stripping, the IPX7 sentence alone produces real 6-gram hits.
    const unstripped = analyzeFreshness(draft, [prior])
    expect(unstripped.overlap).toBe(true)

    // With the frozen-string strip applied first (what check-fresh-language.ts now
    // does), the only shared language disappears and the check is clean.
    const stripped = analyzeFreshness(stripFrozenStringsFromDoc(draft), [stripFrozenStringsFromDoc(prior)])
    expect(stripped.overlap).toBe(false)
    expect(stripped.hits).toHaveLength(0)
  })

  it('still flags a genuine recycled phrase sitting right next to a frozen string', () => {
    const sharedTic = 'where does this need a caveat'
    const draft: DraftInput = {
      body: [p(`${IPX7_HOUSE_WORDING} And I wonder, ${sharedTic}, before we move on.`)],
    }
    const prior: PriorPost = {
      slug: 'prior',
      body: [p(`${IPX7_HOUSE_WORDING} So, ${sharedTic}, is worth asking.`)],
    }
    const report = analyzeFreshness(stripFrozenStringsFromDoc(draft), [stripFrozenStringsFromDoc(prior)])
    expect(report.overlap).toBe(true)
    expect(report.hits.some(h => h.ngram === sharedTic)).toBe(true)
    expect(report.hits.every(h => !h.ngram.includes('ipx7'))).toBe(true)
  })
})

describe('FROZEN_SAFETY_STRINGS', () => {
  it('contains the IPX7, IPX4, and IPX5/IPX6 jet-code house wordings', () => {
    expect(FROZEN_SAFETY_STRINGS).toContain(IPX7_HOUSE_WORDING)
    expect(FROZEN_SAFETY_STRINGS).toContain(IPX4_HOUSE_WORDING)
    expect(FROZEN_SAFETY_STRINGS).toContain(IPX56_JET_CODE_HOUSE_WORDING)
  })
})

describe('analyzeFreshness with the IPX5/IPX6 jet-code wording stripped (ticket #24095)', () => {
  it('reports no overlap when the only shared text is the jet-code frozen string', () => {
    const draft: DraftInput = {
      title: 'What makes a vibrator body safe',
      body: [
        p('A printed ingress rating instead of an adjective.'),
        p(IPX56_JET_CODE_HOUSE_WORDING),
      ],
    }
    const prior: PriorPost = {
      slug: 'how-often-should-you-clean-your-vibrator',
      body: [
        p('Cleaning cadence depends on how often you use it, for entirely unrelated reasons.'),
        p(IPX56_JET_CODE_HOUSE_WORDING),
      ],
    }

    const unstripped = analyzeFreshness(draft, [prior])
    expect(unstripped.overlap).toBe(true)

    const stripped = analyzeFreshness(stripFrozenStringsFromDoc(draft), [stripFrozenStringsFromDoc(prior)])
    expect(stripped.overlap).toBe(false)
    expect(stripped.hits).toHaveLength(0)
  })
})
