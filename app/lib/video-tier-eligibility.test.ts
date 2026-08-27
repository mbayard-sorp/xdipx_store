/**
 * Which video tiers may be selected for NEW work (ticket #5727).
 *
 * Two facts used to live only in prose and were therefore not facts at all:
 * that fal is retired for video (owner direction 2026-08-26) and that the
 * deployed RunPod worker image implements a specific, smaller set of modes
 * than this repo's handler source does. The config op handed the writers room
 * all eleven tiers, and an episode written on a retired tier or on s2v got all
 * the way to a claimed render before failing — at a fal invoice, or at a cold
 * GPU worker that rejects the mode after billing for its boot.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VIDEO_MODELS, tierIneligibility, eligibleVideoModelIds, type VideoModelId } from './fal-video.server'
import { runpodWorkerModes, runpodWorkerSupportsMode } from './runpod-video.server'

afterEach(() => { vi.unstubAllEnvs() })

describe('runpodWorkerModes', () => {
  it('defaults to what the DEPLOYED image implements, not what the repo source does', () => {
    // Endpoint 1cnxz75c71177q runs image eb2a126, whose handler accepts i2v
    // and t2v only. mode s2v landed in the repo four days later and has never
    // been deployed, so it must not be assumed available.
    expect(runpodWorkerModes()).toEqual(['i2v', 't2v'])
    expect(runpodWorkerSupportsMode('s2v')).toBe(false)
  })

  it('widens from RUNPOD_WORKER_MODES', () => {
    vi.stubEnv('RUNPOD_WORKER_MODES', 'i2v, t2v ,s2v')
    expect(runpodWorkerModes()).toEqual(['i2v', 't2v', 's2v'])
    expect(runpodWorkerSupportsMode('s2v')).toBe(true)
  })

  it('treats an unparseable value as a typo and falls back rather than bricking the lane', () => {
    vi.stubEnv('RUNPOD_WORKER_MODES', 'yes, please')
    expect(runpodWorkerModes()).toEqual(['i2v', 't2v'])
  })
})

describe('tierIneligibility', () => {
  it('retires every fal video tier', () => {
    const falTiers = (Object.keys(VIDEO_MODELS) as VideoModelId[]).filter(id => VIDEO_MODELS[id].legacy)
    expect(falTiers.length).toBeGreaterThan(0)
    for (const id of falTiers) {
      expect(tierIneligibility(id)?.code).toBe('retired_provider')
    }
  })

  it('allows the RunPod tiers whose mode the deployed image implements', () => {
    expect(tierIneligibility('wan22-i2v')).toBeNull()
    expect(tierIneligibility('wan22-t2v')).toBeNull()
  })

  it('refuses the s2v tier while the deployed image lacks the mode', () => {
    const why = tierIneligibility('wan22-s2v')
    expect(why?.code).toBe('worker_mode_unavailable')
    expect(why?.message).toMatch(/s2v/)
  })

  it('allows the s2v tier once the deployed image declares the mode', () => {
    vi.stubEnv('RUNPOD_WORKER_MODES', 'i2v,t2v,s2v')
    expect(tierIneligibility('wan22-s2v')).toBeNull()
  })

  it('never de-registers a tier: historical rows still resolve their spec', () => {
    // Enforcement is a refusal to SELECT, never a deletion from the registry —
    // /admin/usage and in-flight jobs read costKey and specs straight out of
    // VIDEO_MODELS, so removing an entry would break reading the past in order
    // to stop writing the future.
    expect(VIDEO_MODELS['veo31']).toBeTruthy()
    expect(VIDEO_MODELS['sync-lipsync']).toBeTruthy()
    expect(VIDEO_MODELS['omnihuman']).toBeTruthy()
  })
})

describe('eligibleVideoModelIds', () => {
  it('is exactly the two live wan22 tiers today', () => {
    expect(eligibleVideoModelIds()).toEqual(['wan22-i2v', 'wan22-t2v'])
  })

  it('includes the default tier — otherwise every enqueue that omits modelTier fails', () => {
    expect(eligibleVideoModelIds()).toContain('wan22-i2v')
  })

  it('leaves the program with NO talking tier until s2v is deployed, which is the honest state', () => {
    const talking = eligibleVideoModelIds().filter(id => VIDEO_MODELS[id].audioDriven || VIDEO_MODELS[id].lipsync)
    expect(talking).toEqual([])
  })
})
