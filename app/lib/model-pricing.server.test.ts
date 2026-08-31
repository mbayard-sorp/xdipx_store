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
  estimateRunpodS2vRatePerSecondUsd,
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

/**
 * s2v pre-flight cost estimate (ticket #6585). Sharing i2v/t2v's 45x render
 * multiplier under-priced the s2v talking tier by ~1.81x against the
 * 2026-08-30 bake-off's fast8 measurement (14.2s clip / 19.3 min render =
 * ~81.5 render-seconds per clip-second) — the exact number the per-video
 * ceiling and daily budget gate read BEFORE any spend happens. Pinned apart
 * from the i2v/t2v estimate so they cannot silently re-converge.
 */
describe('s2v pre-flight cost estimate', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it("does not share i2v/t2v's render multiplier", () => {
    expect(estimateRunpodS2vRatePerSecondUsd()).not.toBeCloseTo(estimateRunpodRatePerSecondUsd(), 5)
    expect(estimateVideoCostUsd('runpod/wan22-s2v', 1)).not.toBeCloseTo(estimateVideoCostUsd('runpod/wan22', 1), 5)
  })

  it('meets or exceeds the fast8-measured rate (never lowball)', () => {
    // 14.2s clip / 19.3 min (1158s) render = ~81.5 render-seconds/clip-second,
    // at the default all-in GPU rate ($0.00053 x 1.5 fee = $0.000795/GPU-s).
    const measuredRatePerSecond = 0.000795 * (1158 / 14.2)
    expect(estimateRunpodS2vRatePerSecondUsd()).toBeGreaterThanOrEqual(measuredRatePerSecond)
  })

  it('is about 1.8x the i2v/t2v estimate at the shipped defaults (82 vs 45 render-seconds/clip-second)', () => {
    const ratio = estimateRunpodS2vRatePerSecondUsd() / estimateRunpodRatePerSecondUsd()
    expect(ratio).toBeCloseTo(82 / 45, 5)
  })

  it('widens from RUNPOD_S2V_RENDER_SECONDS_PER_CLIP_SECOND independently of the i2v multiplier', () => {
    vi.stubEnv('RUNPOD_S2V_RENDER_SECONDS_PER_CLIP_SECOND', '100')
    expect(estimateRunpodS2vRatePerSecondUsd()).toBeCloseTo(runpodAllInRatePerSecondUsd() * 100, 10)
    expect(estimateRunpodRatePerSecondUsd()).toBeCloseTo(runpodAllInRatePerSecondUsd() * 45, 10)
  })

  it('keeps the s2v estimate and its actual on the SAME all-in rate', () => {
    vi.stubEnv('RUNPOD_GPU_USD_PER_SEC', '0.001')
    vi.stubEnv('RUNPOD_FEE_MULTIPLIER', '2')
    vi.stubEnv('RUNPOD_S2V_RENDER_SECONDS_PER_CLIP_SECOND', '82')
    // 82 GPU-seconds assumed per clip-second, so one clip-second's s2v estimate
    // must equal 82 GPU-seconds of measured actual.
    expect(estimateRunpodS2vRatePerSecondUsd()).toBeCloseTo(computeRunpodActualCostUsd(82_000), 10)
  })
})
