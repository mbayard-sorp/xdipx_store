/**
 * enqueueVideoJobSet contract tests: the variant cap, the set-level budget
 * check running BEFORE any insert, sibling rows sharing one variant_group_id,
 * and frame reuse zeroing the frame cost in the set estimate.
 *
 * Everything with a side effect (db, kv, blob, providers) is mocked; the
 * estimate math runs the real model-pricing rates.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = {
  selectResults: [] as unknown[][],
  inserts: [] as Array<Record<string, unknown>>,
}

vi.mock('~/lib/db.server', () => {
  const selectChain = () => {
    const chain: Record<string, unknown> = {}
    chain['where'] = () => chain
    chain['orderBy'] = () => chain
    chain['limit'] = () => Promise.resolve(state.selectResults.shift() ?? [])
    return chain
  }
  return {
    db: {
      select: () => ({ from: () => selectChain() }),
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          state.inserts.push(v)
          const p = Promise.resolve([{ id: state.inserts.length }]) as Promise<unknown> & { returning?: () => Promise<unknown> }
          p.returning = () => Promise.resolve([{ id: state.inserts.length }])
          return p
        },
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    },
  }
})
vi.mock('~/lib/kv.server', () => ({
  kvSet: vi.fn(),
  kvDel: vi.fn(),
  KV_KEYS: { videoPollerIdle: 'video:poller:idle' },
}))
const configMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/team.server', () => ({ getTeamConfig: configMock }))
vi.mock('~/lib/feed-processor.server', () => ({ getPipelineSetting: vi.fn().mockResolvedValue(null) }))
vi.mock('~/lib/blob.server', () => ({ blobPut: vi.fn(), blobFetchToBuffer: vi.fn() }))
vi.mock('~/lib/token-log.server', () => ({ logVideoCost: vi.fn(), logImageCost: vi.fn() }))
vi.mock('~/lib/sanity.server', () => ({ getEditorPhotoUrl: vi.fn(), getApprovedCastMembers: vi.fn().mockResolvedValue([]) }))
vi.mock('~/lib/shopify.server', () => ({ getProductByHandle: vi.fn() }))
vi.mock('~/lib/ivr-voice.server', () => ({ getActiveIvrVoiceId: vi.fn().mockResolvedValue('voice-1') }))
vi.mock('~/lib/elevenlabs.server', () => ({ generateVoiceover: vi.fn(), generateVoiceoverWithTimestamps: vi.fn() }))
vi.mock('~/lib/video-assembly.server', () => ({
  extractPoster: vi.fn(),
  applyWatermark: vi.fn(),
  probeDurationSeconds: vi.fn(),
  muxAudio: vi.fn(),
  renderAspectMaster: vi.fn(),
}))
vi.mock('~/lib/video-postpass.server', () => ({
  concatWithAudio: vi.fn(),
  runPostPass: vi.fn(),
  buildEndCard: vi.fn(),
}))

import { enqueueVideoJobSet, estimateJobCostUsd } from '~/lib/video-pipeline.server'
import { estimateAvatarSpeechSeconds } from '~/lib/avatar-script'

const baseArgs = {
  productHandle: 'satin-wand',
  formula: 'myth-busting',
  presenter: 'none',
  baseScriptJson: { framePrompt: 'archetype B', motionPrompt: 'slow push', voiceover: '{{hook}}' },
  modelTier: 'kling25-pro' as const,
  durationSeconds: 5,
  targetPlatforms: ['instagram'],
  hooks: ['Hook one', 'Hook two', 'Hook three'],
}

beforeEach(() => {
  vi.clearAllMocks()
  state.selectResults = []
  state.inserts = []
  configMock.mockResolvedValue({
    team: 'video', enabled: true, dailyCents: 2000, maxRunsPerDay: 1,
    autoApproveSuggestions: false, maxCostCents: 600, maxVariantsPerSet: 4,
  })
})

describe('enqueueVideoJobSet', () => {
  it('inserts one row per hook, all sharing a variant_group_id with per-row axes', async () => {
    const result = await enqueueVideoJobSet(baseArgs)
    expect(result.jobs).toHaveLength(3)
    expect(state.inserts).toHaveLength(3)
    const groupIds = new Set(state.inserts.map(r => r['variantGroupId']))
    expect(groupIds.size).toBe(1)
    expect([...groupIds][0]).toBe(result.variantGroupId)
    expect(state.inserts.map(r => (r['variantAxes'] as { hook: string }).hook)).toEqual(['Hook one', 'Hook two', 'Hook three'])
    const perJob = estimateJobCostUsd('kling25-pro', 5, { reuseFrame: false })
    expect(result.totalEstCostUsd).toBeCloseTo(perJob * 3, 4)
  })

  it('rejects a set over the variants-per-set cap before any insert', async () => {
    configMock.mockResolvedValue({
      team: 'video', enabled: true, dailyCents: 2000, maxRunsPerDay: 1,
      autoApproveSuggestions: false, maxCostCents: 600, maxVariantsPerSet: 2,
    })
    await expect(enqueueVideoJobSet(baseArgs)).rejects.toThrow(/cap/)
    expect(state.inserts).toHaveLength(0)
  })

  it('rejects when the set estimate exceeds ceiling x cap, before any insert', async () => {
    configMock.mockResolvedValue({
      team: 'video', enabled: true, dailyCents: 2000, maxRunsPerDay: 1,
      autoApproveSuggestions: false, maxCostCents: 30, maxVariantsPerSet: 4,
    })
    await expect(enqueueVideoJobSet(baseArgs)).rejects.toThrow(/set budget/i)
    expect(state.inserts).toHaveLength(0)
  })

  it('zeroes the frame cost for variants whose scene already has an approved frame', async () => {
    const line = 'Short spoken line about {{hook}}.'
    // One findReusableSceneFrame lookup per variant (set estimate); the
    // enqueue itself does not re-query in this path.
    state.selectResults = [[{ frameId: 55 }], [{ frameId: 55 }]]
    const result = await enqueueVideoJobSet({
      ...baseArgs,
      presenter: 'emma',
      modelTier: 'omnihuman',
      durationSeconds: 0,
      hooks: ['now', 'later'],
      baseScriptJson: { presenterLine: line, talkingHead: true, sceneSlug: 'couch-cozy', framePrompt: 'C' },
    })
    const expected = ['now', 'later'].reduce((sum, hook) => {
      const speech = estimateAvatarSpeechSeconds(line.split('{{hook}}').join(hook))
      return sum + estimateJobCostUsd('omnihuman', 0, { speechSeconds: speech, reuseFrame: true })
    }, 0)
    expect(result.totalEstCostUsd).toBeCloseTo(expected, 4)
    expect(state.inserts).toHaveLength(2)
  })
})

describe('estimateJobCostUsd — Grok Imagine tier (ticket #3991)', () => {
  it('prices the clip at 0.14/s; reused frame leaves exactly 0.14*duration', () => {
    // reuseFrame zeroes the frame cost, so the estimate is the pure clip cost.
    expect(estimateJobCostUsd('grok', 8, { reuseFrame: true })).toBeCloseTo(1.12, 5)
    expect(estimateJobCostUsd('grok', 5, { reuseFrame: true })).toBeCloseTo(0.7, 5)
  })

  it('adds the frame cost when a frame must be composed', () => {
    expect(estimateJobCostUsd('grok', 8, { reuseFrame: false })).toBeGreaterThan(1.12)
  })
})
