import { describe, it, expect } from 'vitest'
import { summarizeContentImpressions } from './gsc.server'

describe('summarizeContentImpressions', () => {
  it('sums impressions for /notebook/ and /compare/ pages separately', () => {
    const result = summarizeContentImpressions([
      { page: 'https://xdipx.com/notebook/a-post', impressions: 10 },
      { page: 'https://xdipx.com/notebook/b-post', impressions: 5 },
      { page: 'https://xdipx.com/compare/sleeve-vs-extender', impressions: 3 },
      { page: 'https://xdipx.com/products/some-vibrator', impressions: 100 },
    ])
    expect(result).toEqual({
      notebookImpressions: 15,
      compareImpressions: 3,
      totalImpressions: 18,
      pagesSeen: 3,
    })
  })

  it('reports an honest zero when no notebook/compare page is in the top 100', () => {
    const result = summarizeContentImpressions([
      { page: 'https://xdipx.com/products/some-vibrator', impressions: 100 },
      { page: 'https://xdipx.com/collections/wands', impressions: 40 },
    ])
    expect(result).toEqual({
      notebookImpressions: 0,
      compareImpressions: 0,
      totalImpressions: 0,
      pagesSeen: 0,
    })
  })

  it('treats a missing impressions field as 0, not NaN', () => {
    const result = summarizeContentImpressions([
      { page: 'https://xdipx.com/notebook/no-impressions-field' },
    ])
    expect(result).toEqual({
      notebookImpressions: 0,
      compareImpressions: 0,
      totalImpressions: 0,
      pagesSeen: 1,
    })
  })

  it('handles an empty array', () => {
    expect(summarizeContentImpressions([])).toEqual({
      notebookImpressions: 0,
      compareImpressions: 0,
      totalImpressions: 0,
      pagesSeen: 0,
    })
  })
})
