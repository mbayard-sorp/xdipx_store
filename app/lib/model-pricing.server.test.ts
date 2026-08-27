// Unit tests for token/image cost estimation (ticket #96): Opus rates exist,
// and the unknown-model fallback assumes the premium tier so spend estimates
// never lowball a daily budget gate.
import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  estimateCostUsd,
  estimateImageCostUsd,
  estimateVideoCostUsd,
  computeRunpodActualCostUsd,
  runpodAllInRatePerSecondUsd,
  estimateRunpodRatePerSecondUsd,
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
})

/**
 * RunPod all-in pricing (ticket #5726). Recorded video spend used to be the
 * GPU line alone at the CHEAPER pool's rate, and only for jobs that completed:
 * measured 2026-08-22..24, api_token_log held $0.2654 against a $1.572
 * invoice. Both halves of that gap are pinned here.
 */
describe('runpod pricing', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('bills the platform fee on top of the GPU line, not the GPU line alone', () => {
    vi.stubEnv('RUNPOD_GPU_USD_PER_SEC', '0.001')
    vi.stubEnv('RUNPOD_FEE_MULTIPLIER', '1.5')
    expect(runpodAllInRatePerSecondUsd()).toBeCloseTo(0.0015, 10)
    // 100 GPU-seconds: $0.10 of GPU, $0.15 all-in.
    expect(computeRunpodActualCostUsd(100_000)).toBeCloseTo(0.15, 5)
  })

  it('defaults to the more expensive pool the endpoint can schedule (never lowball)', () => {
    // No env: ADA_48_PRO at ~0.00053/s times the 1.5 fee multiplier.
    expect(runpodAllInRatePerSecondUsd()).toBeCloseTo(0.000795, 10)
  })

  it('refuses a fee multiplier below 1, which would discount real spend', () => {
    vi.stubEnv('RUNPOD_GPU_USD_PER_SEC', '0.001')
    vi.stubEnv('RUNPOD_FEE_MULTIPLIER', '0.4')
    expect(runpodAllInRatePerSecondUsd()).toBeCloseTo(0.0015, 10)
  })

  it('ignores a nonsense GPU rate rather than honoring it', () => {
    vi.stubEnv('RUNPOD_GPU_USD_PER_SEC', 'free')
    expect(runpodAllInRatePerSecondUsd()).toBeCloseTo(0.000795, 10)
    vi.stubEnv('RUNPOD_GPU_USD_PER_SEC', '-1')
    expect(runpodAllInRatePerSecondUsd()).toBeCloseTo(0.000795, 10)
  })

  it('never goes negative on a nonsense executionTime', () => {
    expect(computeRunpodActualCostUsd(-5000)).toBe(0)
    expect(computeRunpodActualCostUsd(0)).toBe(0)
  })

  it('keeps the estimate and the actual on the SAME all-in rate', () => {
    vi.stubEnv('RUNPOD_GPU_USD_PER_SEC', '0.001')
    vi.stubEnv('RUNPOD_FEE_MULTIPLIER', '2')
    // 45 GPU-seconds assumed per clip-second, so one clip-second's estimate
    // must equal 45 GPU-seconds of measured actual. If these ever diverge the
    // poll branch's estimate-reversal leaves a residue on the job row.
    expect(estimateRunpodRatePerSecondUsd()).toBeCloseTo(computeRunpodActualCostUsd(45_000), 10)
  })

  it('prices a 60s episode inside the $6 per-video ceiling at the default rate', () => {
    expect(estimateVideoCostUsd('runpod/wan22', 60)).toBeLessThan(6)
  })
})
