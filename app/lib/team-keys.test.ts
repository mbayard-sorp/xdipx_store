// Unit tests for the per-team spend/image attribution helpers behind the
// budget gate (tickets #3678/#3390/#581): feature -> team mapping including
// the notebook-images override, per-team image feature sets, and the KV key
// shapes the write-through counters and gate() must agree on.
import { describe, it, expect } from 'vitest'
import {
  teamFromFeature,
  imageTeamFromFeature,
  extraSpendFeaturesForTeam,
  teamImagesKvKey,
  teamSpendKvKey,
  TEAM_IMAGE_FEATURES,
  AUTO_PUBLISH_PLATFORMS,
  SOCIAL_PLATFORMS,
  isManualPublishPlatform,
  FEATURE_TEAM_OVERRIDES,
  TEAM_IDS,
  SOCIAL_MAX_IMAGES_DEFAULT,
} from './team-keys'

describe('teamFromFeature', () => {
  it('maps team-prefixed features to their team', () => {
    expect(teamFromFeature('homepage-images')).toBe('homepage')
    expect(teamFromFeature('social-images')).toBe('social')
    expect(teamFromFeature('content-blog')).toBe('content')
    expect(teamFromFeature('video-clip')).toBe('video')
  })

  it('maps notebook-images to content via the override (ticket #581)', () => {
    expect(teamFromFeature('notebook-images')).toBe('content')
  })

  it('returns null for non-team features', () => {
    expect(teamFromFeature('enrichment')).toBeNull()
    expect(teamFromFeature('sms')).toBeNull()
    expect(teamFromFeature('media-blocks')).toBeNull()
    expect(teamFromFeature('emma-chat')).toBeNull()
  })
})

describe('imageTeamFromFeature', () => {
  it('routes each image feature to the team whose cap it counts against', () => {
    expect(imageTeamFromFeature('homepage-images')).toBe('homepage')
    expect(imageTeamFromFeature('notebook-images')).toBe('content')
    expect(imageTeamFromFeature('content-images')).toBe('content')
    expect(imageTeamFromFeature('social-images')).toBe('social')
  })

  it('returns null for non-image features (no counter bump)', () => {
    expect(imageTeamFromFeature('homepage-merchandise')).toBeNull()
    expect(imageTeamFromFeature('video-cast')).toBeNull()
    expect(imageTeamFromFeature('media-blocks')).toBeNull()
  })

  it('social images never count against the homepage feature (ticket #3678)', () => {
    expect(TEAM_IMAGE_FEATURES.social).not.toContain('homepage-images')
  })
})

describe('extraSpendFeaturesForTeam', () => {
  it('gives content its override features and other teams none', () => {
    expect(extraSpendFeaturesForTeam('content')).toEqual(['notebook-images'])
    expect(extraSpendFeaturesForTeam('homepage')).toEqual([])
    expect(extraSpendFeaturesForTeam('social')).toEqual([])
  })

  it('every override points at a real team id', () => {
    for (const team of Object.values(FEATURE_TEAM_OVERRIDES)) {
      expect(TEAM_IDS).toContain(team)
    }
  })
})

describe('KV counter keys', () => {
  it('keeps the homepage image key byte-identical to the pre-#3678 shape', () => {
    // The write-through counter and the gate seeded this exact key before the
    // per-team generalization; changing it would orphan live counters.
    expect(teamImagesKvKey('homepage', '2026-08-16')).toBe('team:images:homepage:2026-08-16')
  })

  it('namespaces image counters per team', () => {
    expect(teamImagesKvKey('social', '2026-08-16')).toBe('team:images:social:2026-08-16')
    expect(teamImagesKvKey('content', '2026-08-16')).toBe('team:images:content:2026-08-16')
  })

  it('spend keys are unchanged', () => {
    expect(teamSpendKvKey('content', '2026-08-16')).toBe('team:spend:content:2026-08-16')
  })
})

describe('social image cap default', () => {
  it('equals the retired LOCAL_IMAGE_CAP_FALLBACK so wiring the key raises nothing', () => {
    expect(SOCIAL_MAX_IMAGES_DEFAULT).toBe(12)
  })
})

describe('isManualPublishPlatform', () => {
  it('treats only the platforms with real plumbing as automatic', () => {
    expect(isManualPublishPlatform('instagram')).toBe(false)
    expect(isManualPublishPlatform('x')).toBe(false)
  })

  it('treats every other social platform as hand-posted', () => {
    // tiktok and youtube have registry adapters, but they are not_configured
    // stubs and the hourly job does not run them, so a draft for one can no
    // more leave the queue on its own than a LinkedIn draft can.
    for (const p of ['linkedin', 'tiktok', 'youtube', 'facebook']) {
      expect(isManualPublishPlatform(p)).toBe(true)
    }
  })

  it('every auto-publish platform is a real social platform', () => {
    for (const p of AUTO_PUBLISH_PLATFORMS) {
      expect(SOCIAL_PLATFORMS).toContain(p)
    }
  })
})
