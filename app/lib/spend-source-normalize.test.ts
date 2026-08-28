/**
 * Ticket #5929: the Max-only spend endpoint normalises an unrecognised token
 * `source` to a zero-rated Max label, so a routine that mislabels its Max
 * usage can never inflate a team budget gate. Real API-key sources ('batch',
 * 'sync') and known Max aliases pass through unchanged. The premium-tier
 * default for a genuinely unknown source stays in estimateCostUsd, which every
 * in-app real-money caller goes through, so this narrowing cannot blind a gate
 * to real spend.
 */
import { describe, it, expect } from 'vitest'
import { normalizeSpendSource } from '~/lib/spend-source.server'
import { MAX_SUBSCRIPTION_SOURCES, estimateCostUsd } from '~/lib/model-pricing.server'

describe('normalizeSpendSource (ticket #5929)', () => {
  it('defaults a missing source to a Max-billed label', () => {
    expect(MAX_SUBSCRIPTION_SOURCES.has(normalizeSpendSource(undefined))).toBe(true)
  })

  it('passes known Max aliases through unchanged', () => {
    for (const src of MAX_SUBSCRIPTION_SOURCES) {
      expect(normalizeSpendSource(src)).toBe(src)
    }
  })

  it('passes real API-key sources through unchanged so they stay priced', () => {
    expect(normalizeSpendSource('batch')).toBe('batch')
    expect(normalizeSpendSource('sync')).toBe('sync')
  })

  it('normalises an unrecognised label (feature name, new alias) to a Max source', () => {
    // The exact shapes that produced phantom charges: a feature name in the
    // source column, and an unrecognised Max alias.
    for (const raw of ['social-drafts', 'strategy-dev', 'anthropic', 'something-new']) {
      expect(MAX_SUBSCRIPTION_SOURCES.has(normalizeSpendSource(raw))).toBe(true)
    }
  })

  it('the normalised unknown source then costs zero, closing the phantom-charge class', () => {
    const BIG = {
      model: 'claude-opus-4-8',
      inputTokens: 1_250_000,
      outputTokens: 330_000,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    }
    // The endpoint stores normalizeSpendSource(raw); estimateCostUsd then sees a
    // Max label and zero-rates it, instead of the $43.50 the raw 'social-drafts'
    // label would have booked.
    expect(estimateCostUsd({ ...BIG, source: normalizeSpendSource('social-drafts') })).toBe(0)
    // The premium-tier default is untouched for a truly unknown source reaching
    // estimateCostUsd directly (the in-app real-money path), so a gate is never
    // blinded to real spend.
    expect(estimateCostUsd({ ...BIG, source: 'social-drafts' })).toBeGreaterThan(0)
  })
})
