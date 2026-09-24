/**
 * Which video tiers may be selected for NEW work (ticket #5727).
 *
 * Retirement used to live only in prose and was therefore not a fact at all:
 * fal is retired for video (owner direction 2026-08-26), and the RunPod tiers
 * are retired and deleted (ADR-016). The config op handed the writers room
 * every tier, and an episode written on a retired tier got all the way to a
 * claimed render before failing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VIDEO_MODELS, tierIneligibility, eligibleVideoModelIds, RETIRED_VIDEO_TIER_IDS, type VideoModelId } from './fal-video.server'

afterEach(() => { vi.unstubAllEnvs() })

const ATLAS_TIERS: VideoModelId[] = ['italk-atlas', 'grok-atlas', 'wan27-atlas', 'wan22turbo-atlas']

function keys(atlas: string, wavespeed = ''): void {
  vi.stubEnv('ATLAS_CLOUD_API_KEY', atlas)
  vi.stubEnv('WAVESPEED_API_KEY', wavespeed)
}

describe('tierIneligibility', () => {
  it('retires every fal video tier', () => {
    const falTiers = (Object.keys(VIDEO_MODELS) as VideoModelId[]).filter(id => VIDEO_MODELS[id].legacy)
    expect(falTiers.length).toBeGreaterThan(0)
    for (const id of falTiers) {
      expect(tierIneligibility(id)?.code).toBe('retired_provider')
    }
  })

  it('refuses every deleted RunPod tier id a historical row may carry (ADR-016)', () => {
    for (const id of RETIRED_VIDEO_TIER_IDS) {
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
    expect(tierIneligibility('italk-atlas')).toBeNull()
    expect(tierIneligibility('wan22turbo-atlas')).toBeNull()
    // No like-for-like mirror: an Atlas outage parks these rather than downgrading them.
    expect(tierIneligibility('grok-atlas')?.code).toBe('provider_not_configured')
    expect(tierIneligibility('wan27-atlas')?.code).toBe('provider_not_configured')
  })

  it('keeps the fal tiers registered: historical rows still resolve their spec', () => {
    // Enforcement for fal is a refusal to SELECT, not a deletion from the
    // registry: /admin/usage and in-flight jobs read costKey and specs straight
    // out of VIDEO_MODELS. The RunPod tiers are the one deliberate exception
    // (ADR-016 Phase 4), covered by RETIRED_VIDEO_TIER_IDS above.
    expect(VIDEO_MODELS['veo31']).toBeTruthy()
    expect(VIDEO_MODELS['sync-lipsync']).toBeTruthy()
    expect(VIDEO_MODELS['omnihuman']).toBeTruthy()
  })
})

describe('eligibleVideoModelIds', () => {
  it('is exactly the four Atlas tiers when Atlas is keyed', () => {
    keys('atlas-key')
    expect(eligibleVideoModelIds()).toEqual(['italk-atlas', 'grok-atlas', 'wan27-atlas', 'wan22turbo-atlas'])
  })

  it('is empty when no video provider is keyed, which is the honest state', () => {
    keys('')
    expect(eligibleVideoModelIds()).toEqual([])
  })

  it('offers a talking tier again: InfiniteTalk, the audio-driven default', () => {
    keys('atlas-key')
    const talking = eligibleVideoModelIds().filter(id => VIDEO_MODELS[id].audioDriven || VIDEO_MODELS[id].lipsync)
    expect(talking).toEqual(['italk-atlas'])
  })
})
