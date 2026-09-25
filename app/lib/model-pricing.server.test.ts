// Unit tests for token/image cost estimation (ticket #96): Opus rates exist,
// and the unknown-model fallback assumes the premium tier so spend estimates
// never lowball a daily budget gate.
import { describe, it, expect } from 'vitest'
import {
  estimateCostUsd,
  estimateImageCostUsd,
  estimateVideoCostUsd,
} from './model-pricing.server'

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

describe('estimateVideoCostUsd', () => {
  it('prices the Grok Imagine tier at 0.14/s (ticket #3991)', () => {
    expect(estimateVideoCostUsd('fal/grok-imagine-1.5', 8)).toBe(1.12)
    expect(estimateVideoCostUsd('fal/grok-imagine-1.5', 1)).toBe(0.14)
  })

  it('never goes negative and falls back to premium for unknown video models', () => {
    expect(estimateVideoCostUsd('fal/grok-imagine-1.5', -5)).toBe(0)
    expect(estimateVideoCostUsd('mystery/video', 1)).toBeGreaterThan(0)
  })

  // ADR-016 bake-off 2026-09-23. A missing row would fall through to the
  // 0.40/s premium fallback and overprice every Atlas job ~3x to 20x.
  it('prices the Atlas tiers from the bake-off, not the premium fallback', () => {
    expect(estimateVideoCostUsd('atlascloud/infinitetalk', 10)).toBe(0.6)       // ~$0.60 per 10 s observed
    expect(estimateVideoCostUsd('atlascloud/grok-imagine-1.5', 10)).toBe(1.41)  // data.price for 10 s at 720p
    expect(estimateVideoCostUsd('atlascloud/wan-2.7-i2v', 5)).toBe(0.5)         // data.price for 5 s at 720P
    expect(estimateVideoCostUsd('atlascloud/wan-2.2-turbo-i2v', 5)).toBe(0.1)   // list $0.02/s
  })
})

/**
 * Retired RunPod cost keys (ADR-016). Historical api_token_log and video_jobs
 * rows name them, so they stay priced at their last default estimate rather
 * than falling through to the premium DEFAULT_VIDEO_RATE.
 */
describe('retired runpod cost keys', () => {
  it('still resolve for historical rows at their last default estimate', () => {
    expect(estimateVideoCostUsd('runpod/wan22', 1)).toBeCloseTo(0.035775, 4)
    expect(estimateVideoCostUsd('runpod/wan22-s2v', 1)).toBeCloseTo(0.06519, 4)
  })
})
