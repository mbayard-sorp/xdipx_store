import { describe, it, expect } from 'vitest'
import { classifyAiOrderSource, type AiSourceOrderNode } from './ai-source-orders.server'

function order(overrides: Partial<Pick<AiSourceOrderNode, 'customAttributes' | 'customerJourneySummary'>>): Pick<AiSourceOrderNode, 'customAttributes' | 'customerJourneySummary'> {
  return {
    customAttributes: [],
    customerJourneySummary: null,
    ...overrides,
  }
}

// ticket #12685: order #1008's exact shape — _utm_source=chatgpt.com, no
// usable customerJourneySummary signal — is the DONE WHEN's own test case.
describe('classifyAiOrderSource', () => {
  it('classifies chatgpt from _utm_source=chatgpt.com (order #1008\'s shape)', () => {
    expect(classifyAiOrderSource(order({
      customAttributes: [{ key: '_utm_source', value: 'chatgpt.com' }],
    }))).toBe('chatgpt')
  })

  it.each([
    ['chatgpt.com', 'chatgpt'],
    ['openai.com', 'openai'],
    ['perplexity.ai', 'perplexity'],
    ['copilot.microsoft.com', 'copilot'],
    ['bing.com', 'bing'],
    ['gemini.google.com', 'gemini'],
    ['claude.ai', 'claude'],
  ])('classifies %s as %s via _utm_source', (host, expected) => {
    expect(classifyAiOrderSource(order({
      customAttributes: [{ key: '_utm_source', value: host }],
    }))).toBe(expected)
  })

  it('falls back to the customer journey referrer when there is no _utm_source match', () => {
    expect(classifyAiOrderSource(order({
      customerJourneySummary: {
        firstVisit: null,
        lastVisit: { referrerUrl: 'https://chat.openai.com/c/abc', source: 'openai.com' },
      },
    }))).toBe('openai')
  })

  it('falls back to firstVisit when lastVisit has no match', () => {
    expect(classifyAiOrderSource(order({
      customerJourneySummary: {
        firstVisit: { referrerUrl: 'https://www.perplexity.ai/search?q=x', source: 'perplexity.ai' },
        lastVisit: { referrerUrl: 'https://xdipx.com/', source: 'https://xdipx.com/' },
      },
    }))).toBe('perplexity')
  })

  it('returns null for a non-AI utm_source and no matching journey signal', () => {
    expect(classifyAiOrderSource(order({
      customAttributes: [{ key: '_utm_source', value: 'google' }],
      customerJourneySummary: {
        firstVisit: { referrerUrl: 'https://www.google.com/', source: 'google' },
        lastVisit: null,
      },
    }))).toBeNull()
  })

  it('returns null when there is no attribution signal at all', () => {
    expect(classifyAiOrderSource(order({}))).toBeNull()
  })
})
