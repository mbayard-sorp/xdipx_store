// Unit tests for token/image cost estimation (ticket #96): Opus rates exist,
// and the unknown-model fallback assumes the premium tier so spend estimates
// never lowball a daily budget gate.
import { describe, it, expect } from 'vitest'
import { estimateCostUsd, estimateImageCostUsd } from './model-pricing.server'

const MTOK = 1_000_000

function cost(model: string, source: 'batch' | 'sync' | 'agent-sdk' = 'sync') {
  return estimateCostUsd({
    model,
    source,
    inputTokens: MTOK,
    outputTokens: MTOK,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  })
}

describe('estimateCostUsd', () => {
  it('prices Opus at 15/75 per Mtok (was falling through to Sonnet, ~5x under)', () => {
    expect(cost('claude-opus-4-1')).toBe(90)
    expect(cost('claude-opus-4-1-20250805')).toBe(90)
    expect(cost('claude-opus-4-20250514')).toBe(90)
  })

  it('keeps Sonnet and Haiku rates unchanged', () => {
    expect(cost('claude-sonnet-4-6')).toBe(18)
    expect(cost('claude-sonnet-4-20250514')).toBe(18)
    expect(cost('claude-haiku-4-5-20251001')).toBe(6)
    expect(cost('claude-haiku-4-5')).toBe(6)
  })

  it('never lowballs an unknown model: fallback >= every known rate', () => {
    const unknown = cost('claude-mystery-9')
    for (const model of ['claude-opus-4-1', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']) {
      expect(unknown).toBeGreaterThanOrEqual(cost(model))
    }
    // Specifically the premium tier, matching the DEFAULT_VIDEO_RATE convention.
    expect(unknown).toBe(cost('claude-opus-4-1'))
  })

  it('halves batch-source cost and zeroes agent-sdk (Max subscription)', () => {
    expect(cost('claude-opus-4-1', 'batch')).toBe(45)
    expect(cost('claude-opus-4-1', 'agent-sdk')).toBe(0)
  })

  it('prices cache tokens off the input rate (1.25x write, 0.10x read)', () => {
    const c = estimateCostUsd({
      model: 'claude-opus-4-1',
      source: 'sync',
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: MTOK,
      cacheReadTokens: MTOK,
    })
    expect(c).toBe(15 * 1.25 + 15 * 0.1)
  })
})

describe('estimateImageCostUsd', () => {
  it('charges known models per image and never goes negative', () => {
    expect(estimateImageCostUsd('fal/flux-kontext-dev', 2)).toBe(0.05)
    expect(estimateImageCostUsd('fal/flux-dev', -3)).toBe(0)
  })

  it('falls back to a nonzero rate for unknown image models', () => {
    expect(estimateImageCostUsd('mystery/model', 1)).toBeGreaterThan(0)
  })
})
