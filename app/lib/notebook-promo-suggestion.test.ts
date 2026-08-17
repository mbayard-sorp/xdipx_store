import { describe, expect, it } from 'vitest'
import {
  buildNotebookPromoSuggestion,
  notebookPromoDedupeKey,
} from './notebook-promo-suggestion'

describe('notebook promo suggestion (ticket #3735)', () => {
  it('files to the social team as a campaign with the notebook-promo dedupe key', () => {
    const s = buildNotebookPromoSuggestion({
      slug: 'how-air-pulsation-works',
      title: 'How Air Pulsation Actually Works',
      category: 'Mechanism Plainly',
    })
    expect(s.team).toBe('social')
    expect(s.kind).toBe('campaign')
    expect(s.dedupeKey).toBe('notebook-promo:how-air-pulsation-works')
    expect(s.suggestion).toContain('How Air Pulsation Actually Works')
    expect(s.suggestion).toContain('https://xdipx.com/notebook/how-air-pulsation-works')
    expect(s.suggestion).toContain('Mechanism Plainly')
  })

  it('is duplicate-safe by construction: same slug always yields the same dedupe key', () => {
    expect(notebookPromoDedupeKey('a-post')).toBe(notebookPromoDedupeKey('a-post'))
    expect(notebookPromoDedupeKey('a-post')).not.toBe(notebookPromoDedupeKey('b-post'))
  })

  it('degrades to the slug when title and category are unknown', () => {
    const s = buildNotebookPromoSuggestion({ slug: 'mystery-post' })
    expect(s.suggestion).toContain('"mystery-post"')
    expect(s.suggestion).toContain('uncategorized')
  })
})
