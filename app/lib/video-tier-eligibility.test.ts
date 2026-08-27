/**
 * Tier eligibility for new work (audit findings 3 & 4): retired fal tiers and
 * undeployed RunPod worker modes are refused for selection, while staying
 * registered so historical jobs resolve. submitRunpodVideo refuses an
 * undeclared mode before the HTTP call. The program has no talking tier today,
 * pinned here as the honest state.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  VIDEO_MODELS,
  resolveWorkerModes,
  tierIneligibility,
  eligibleVideoTiers,
  type VideoModelId,
} from './fal-video.server'
import { submitRunpodVideo } from './runpod-video.server'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('resolveWorkerModes', () => {
  it('defaults to i2v,t2v when unset', () => {
    expect([...resolveWorkerModes()].sort()).toEqual(['i2v', 't2v'])
  })
  it('parses a comma-separated env, lowercased and trimmed', () => {
    vi.stubEnv('RUNPOD_WORKER_MODES', ' I2V , S2V ')
    expect([...resolveWorkerModes()].sort()).toEqual(['i2v', 's2v'])
  })
  it('drops unknown tokens', () => {
    vi.stubEnv('RUNPOD_WORKER_MODES', 'i2v,bogus,t2v')
    expect([...resolveWorkerModes()].sort()).toEqual(['i2v', 't2v'])
  })
  it('falls back to the default when the env names nothing valid', () => {
    vi.stubEnv('RUNPOD_WORKER_MODES', 'bogus,nope')
    expect([...resolveWorkerModes()].sort()).toEqual(['i2v', 't2v'])
  })
})

describe('tierIneligibility', () => {
  it('refuses every retired fal tier', () => {
    for (const id of ['veo31', 'veo31-fast', 'kling25-pro', 'seedance2', 'grok', 'omnihuman', 'sync-lipsync'] as VideoModelId[]) {
      expect(tierIneligibility(id)).toMatch(/retired fal tier/)
    }
  })
  it('allows the deployed RunPod i2v/t2v tiers', () => {
    expect(tierIneligibility('wan22-i2v')).toBeNull()
    expect(tierIneligibility('wan22-t2v')).toBeNull()
  })
  it('refuses the undeployed s2v tier by default', () => {
    expect(tierIneligibility('wan22-s2v')).toMatch(/worker mode 's2v'/)
  })
  it('allows s2v once the deployed image declares it', () => {
    vi.stubEnv('RUNPOD_WORKER_MODES', 'i2v,t2v,s2v')
    expect(tierIneligibility('wan22-s2v')).toBeNull()
  })
  it('reports an unknown tier', () => {
    expect(tierIneligibility('nope' as VideoModelId)).toMatch(/unknown tier/)
  })
})

describe('eligibleVideoTiers', () => {
  it('is exactly the two deployed RunPod modes today', () => {
    expect(eligibleVideoTiers()).toEqual(['wan22-i2v', 'wan22-t2v'])
  })
  it('the program has NO talking tier: no eligible tier is audio-driven or lipsync', () => {
    for (const id of eligibleVideoTiers()) {
      const spec = VIDEO_MODELS[id]
      expect(spec.audioDriven).toBeFalsy()
      expect(spec.lipsync).toBeFalsy()
    }
  })
  it('registration is untouched: every historical tier still resolves', () => {
    for (const id of ['veo31', 'kling25-pro', 'wan22-s2v'] as VideoModelId[]) {
      expect(VIDEO_MODELS[id]).toBeDefined()
    }
  })
})

describe('submitRunpodVideo mode capability guard', () => {
  it('refuses an undeployed mode before any HTTP call', async () => {
    vi.stubEnv('RUNPOD_API_KEY', 'k')
    vi.stubEnv('RUNPOD_VIDEO_ENDPOINT_ID', 'ep-1')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(submitRunpodVideo({
      prompt: 'x',
      imageUrl: 'https://example.com/f.jpg',
      audioUrl: 'https://example.com/a.mp3',
      durationSeconds: 5,
      mode: 's2v',
      blobPathPrefix: 'video/1',
    })).rejects.toThrow(/mode 's2v' is not deployed/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
