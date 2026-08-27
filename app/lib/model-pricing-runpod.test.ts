/**
 * RunPod cost model (this ticket): the ESTIMATE and the ACTUAL must build on
 * ONE all-in $/GPU-second (raw GPU rate x platform-fee multiplier), the default
 * must assume the DEARER schedulable pool, and both must include the platform
 * fee. Recording spend against a cheaper card with no fee is what let
 * api_token_log fall several times below the real RunPod invoice.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  runpodAllInRatePerGpuSecondUsd,
  estimateRunpodRatePerSecondUsd,
  computeRunpodActualCostUsd,
} from './model-pricing.server'

afterEach(() => {
  vi.unstubAllEnvs()
})

const RENDER_SECONDS_PER_CLIP_SECOND = 45

describe('runpod all-in rate', () => {
  it('defaults to the dearer ADA_48_PRO pool times the 1.5 fee multiplier', () => {
    // 0.00053 (L40S serverless flex) x 1.5 (platform fee + disk) = 0.000795.
    expect(runpodAllInRatePerGpuSecondUsd()).toBeCloseTo(0.000795, 9)
  })

  it('is dearer than the old ADA_24 (RTX 4090, 0.00031) no-fee rate', () => {
    expect(runpodAllInRatePerGpuSecondUsd()).toBeGreaterThan(0.00031)
  })

  it('applies the raw GPU rate and the fee multiplier from env', () => {
    vi.stubEnv('RUNPOD_GPU_USD_PER_SEC', '0.001')
    vi.stubEnv('RUNPOD_FEE_MULTIPLIER', '2')
    expect(runpodAllInRatePerGpuSecondUsd()).toBeCloseTo(0.002, 9)
  })

  it('uses the default 1.5 fee when the multiplier is unset', () => {
    vi.stubEnv('RUNPOD_GPU_USD_PER_SEC', '0.001')
    expect(runpodAllInRatePerGpuSecondUsd()).toBeCloseTo(0.0015, 9)
  })

  it('ignores a fee multiplier below 1 (a fee never shrinks the raw rate)', () => {
    vi.stubEnv('RUNPOD_GPU_USD_PER_SEC', '0.001')
    vi.stubEnv('RUNPOD_FEE_MULTIPLIER', '0.5')
    expect(runpodAllInRatePerGpuSecondUsd()).toBeCloseTo(0.0015, 9)
  })
})

describe('estimate and actual share the all-in rate', () => {
  // computeRunpodActualCostUsd rounds to 5dp, so probe with 1000 GPU-seconds
  // (1_000_000 ms) where the rounding is far below the signal, then divide back
  // to a per-GPU-second rate.
  it('the actual is the all-in rate times measured GPU-seconds', () => {
    const rate = runpodAllInRatePerGpuSecondUsd()
    expect(computeRunpodActualCostUsd(1_000_000)).toBeCloseTo(rate * 1000, 5)
  })

  it('the estimate is the all-in rate scaled by the render multiplier', () => {
    expect(estimateRunpodRatePerSecondUsd()).toBeCloseTo(
      runpodAllInRatePerGpuSecondUsd() * RENDER_SECONDS_PER_CLIP_SECOND,
      9,
    )
  })

  it('estimate/actual never drift onto different rates under any env', () => {
    vi.stubEnv('RUNPOD_GPU_USD_PER_SEC', '0.00072')
    vi.stubEnv('RUNPOD_FEE_MULTIPLIER', '1.8')
    // estimate-per-clip-second / render-multiplier == actual-per-gpu-second.
    const rateFromEstimate = estimateRunpodRatePerSecondUsd() / RENDER_SECONDS_PER_CLIP_SECOND
    const rateFromActual = computeRunpodActualCostUsd(1_000_000) / 1000
    expect(rateFromEstimate).toBeCloseTo(rateFromActual, 7)
    expect(rateFromActual).toBeCloseTo(0.00072 * 1.8, 7)
  })

  it('actual scales linearly with measured GPU-seconds and is never negative', () => {
    const one = computeRunpodActualCostUsd(1_000_000)
    const ten = computeRunpodActualCostUsd(10_000_000)
    expect(ten).toBeCloseTo(one * 10, 4)
    expect(computeRunpodActualCostUsd(-500)).toBe(0)
    expect(computeRunpodActualCostUsd(0)).toBe(0)
  })
})
