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
import { VIDEO_MODELS, tierIneligibility, eligibleVideoModelIds, workerModeIneligibility, type VideoModelId } from './fal-video.server'
import { runpodWorkerModes, runpodWorkerSupportsMode } from './runpod-video.server'

afterEach(() => { vi.unstubAllEnvs() })

const ATLAS_TIERS: VideoModelId[] = ['infinitetalk-atlas', 'grok-atlas', 'wan27-atlas', 'wan22turbo-atlas']
const RUNPOD_TIERS: VideoModelId[] = ['wan22-i2v', 'wan22-t2v', 'wan22-s2v']

function keys(atlas: string, wavespeed = ''): void {
  vi.stubEnv('ATLAS_CLOUD_API_KEY', atlas)
  vi.stubEnv('WAVESPEED_API_KEY', wavespeed)
}

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

  it('retires every RunPod tier (ADR-016), whatever modes the worker declares', () => {
    vi.stubEnv('RUNPOD_WORKER_MODES', 'i2v,t2v,s2v')
    for (const id of RUNPOD_TIERS) {
      const why = tierIneligibility(id)
      expect(why?.code).toBe('retired_provider')
      expect(why?.message).toMatch(/RunPod/)
    }
  })

  it('allows every Atlas tier when the Atlas key is set', () => {
    keys('atlas-key')
    for (const id of ATLAS_TIERS) expect(tierIneligibility(id)).toBeNull()
  })

  it('refuses every Atlas tier as provider_not_configured when no key is set', () => {
    keys('')
    for (const id of ATLAS_TIERS) {
      const why = tierIneligibility(id)
      expect(why?.code).toBe('provider_not_configured')
      expect(why?.message).toMatch(/ATLAS_CLOUD_API_KEY/)
    }
  })

  it('keeps a mirrored Atlas tier eligible on the Wavespeed key alone, and only those', () => {
    keys('', 'ws-key')
    expect(tierIneligibility('infinitetalk-atlas')).toBeNull()
    expect(tierIneligibility('wan22turbo-atlas')).toBeNull()
    // No like-for-like mirror: an Atlas outage parks these rather than downgrading them.
    expect(tierIneligibility('grok-atlas')?.code).toBe('provider_not_configured')
    expect(tierIneligibility('wan27-atlas')?.code).toBe('provider_not_configured')
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

describe('required worker mode is declared, not inferred (ticket #5934)', () => {
  // The worker-mode check survives as workerModeIneligibility until Phase 4
  // deletes RunPod; tierIneligibility no longer reaches it (every RunPod tier
  // is retired first).
  it('checks each runpod tier against the mode it actually submits', () => {
    expect(VIDEO_MODELS['wan22-i2v'].workerMode).toBe('i2v')
    expect(VIDEO_MODELS['wan22-t2v'].workerMode).toBe('t2v')
    expect(VIDEO_MODELS['wan22-s2v'].workerMode).toBe('s2v')
  })

  it('still names the missing mode when asked directly', () => {
    vi.stubEnv('RUNPOD_WORKER_MODES', 'i2v')
    expect(workerModeIneligibility('wan22-i2v')).toBeNull()
    expect(workerModeIneligibility('wan22-t2v')?.code).toBe('worker_mode_unavailable')
  })
})

describe('eligibleVideoModelIds', () => {
  it('is exactly the four Atlas tiers when Atlas is keyed', () => {
    keys('atlas-key')
    expect(eligibleVideoModelIds()).toEqual(['infinitetalk-atlas', 'grok-atlas', 'wan27-atlas', 'wan22turbo-atlas'])
  })

  it('is empty when no video provider is keyed, which is the honest state', () => {
    keys('')
    expect(eligibleVideoModelIds()).toEqual([])
  })

  it('offers a talking tier again: InfiniteTalk, the audio-driven default', () => {
    keys('atlas-key')
    const talking = eligibleVideoModelIds().filter(id => VIDEO_MODELS[id].audioDriven || VIDEO_MODELS[id].lipsync)
    expect(talking).toEqual(['infinitetalk-atlas'])
  })
})
