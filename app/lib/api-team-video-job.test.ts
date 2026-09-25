/**
 * Guard tests for POST /api/team/video-job's enqueue-set op and the new tier
 * validation. The pipeline itself is mocked; what's under test is the route
 * contract: field validation, the money gate, and exact pass-through to
 * enqueueVideoJobSet.
 *
 * Lives in app/lib rather than next to the route: anything in app/routes is
 * picked up by flatRoutes/typegen as a route module, tests included.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const gateMock = vi.hoisted(() => vi.fn())
const enqueueMock = vi.hoisted(() => vi.fn())
const enqueueSetMock = vi.hoisted(() => vi.fn())
const configMock = vi.hoisted(() => vi.fn())

vi.mock('~/lib/team.server', () => ({
  assertTeamAuth: vi.fn(),
  gate: gateMock,
  getTeamConfig: configMock,
  getValve: vi.fn().mockResolvedValue(false),
  VALVE_KEYS: { videoAutopublish: 'video_team_autopublish' },
}))
vi.mock('~/lib/video-pipeline.server', () => ({
  enqueueVideoJob: enqueueMock,
  enqueueVideoJobSet: enqueueSetMock,
  listVideoJobs: vi.fn().mockResolvedValue([]),
  estimateJobCostUsd: vi.fn().mockReturnValue(1),
  findReusableSceneFrame: vi.fn().mockResolvedValue(null),
  // Real (not mocked) semantics: 2+ scenes = multi-scene. None of THIS file's
  // fixtures carry scriptJson.scenes, so this always returns false here — the
  // multi-scene contract is covered separately in video-multi-scene.test.ts.
  isMultiSceneScript: (script: { scenes?: unknown[] }) => Array.isArray(script?.scenes) && script.scenes.length >= 2,
  // Real (not mocked) semantics, same grammar as the real module (ticket
  // #6586 moved this from a route-local const into video-pipeline.server so
  // the per-scene VideoSceneSpec.presenter validates against the identical
  // pattern — see that file's own PRESENTER_RE doc comment).
  PRESENTER_RE: /^(none|emma|friend:[a-z0-9-]+)$/,
}))
// Real presenterPhotoUrlForCrop semantics, not a stub (ticket #10484).
const cropPhoto = vi.hoisted(() => (
  m: { photoUrl: string; bodyReferencePhotoUrl?: string | null },
  cropScale: string | null | undefined,
) => ((cropScale === 'macro' || cropScale === 'close') && m.bodyReferencePhotoUrl ? m.bodyReferencePhotoUrl : m.photoUrl))
vi.mock('~/lib/sanity.server', () => ({ getApprovedCastMembers: vi.fn().mockResolvedValue([]), presenterPhotoUrlForCrop: cropPhoto }))
vi.mock('~/lib/feed-processor.server', () => ({ getPipelineSetting: vi.fn().mockResolvedValue(null) }))
vi.mock('~/lib/db.server', () => ({ db: { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) } }))
vi.mock('~/lib/api-error.server', () => ({
  apiError: (_scope: string, err: unknown) =>
    Response.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 }),
}))

import { action } from '~/routes/api.team.video-job'

function post(body: Record<string, unknown>): Promise<Response> {
  const request = new Request('http://localhost/api/team/video-job', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return action({ request, params: {}, context: {} } as never) as Promise<Response>
}

const validSet = {
  op: 'enqueue-set',
  productHandle: 'satin-wand',
  formula: 'myth-busting',
  presenter: 'none',
  modelTier: 'wan27-atlas',
  baseScriptJson: { framePrompt: 'archetype B', motionPrompt: 'slow push', voiceover: '{{hook}} explained' },
  durationSeconds: 5,
  targetPlatforms: ['instagram'],
  hooks: ['Hook one', 'Hook two', 'Hook three'],
}

beforeEach(() => {
  // Atlas tiers are refused as provider_not_configured without the key (ADR-016).
  vi.stubEnv('ATLAS_CLOUD_API_KEY', 'test-atlas-key')
  vi.stubEnv('WAVESPEED_API_KEY', '')
  vi.clearAllMocks()
  gateMock.mockResolvedValue({ ok: true })
  configMock.mockResolvedValue({ enabled: true, dailyCents: 2000, maxCostCents: 600, maxVariantsPerSet: 4 })
  enqueueSetMock.mockResolvedValue({
    variantGroupId: 'vg-1',
    totalEstCostUsd: 1.4,
    jobs: [{ jobId: 'j1', estCostUsd: 0.47, axes: { hook: 'Hook one' } }],
  })
  enqueueMock.mockResolvedValue({ jobId: 'j1', estCostUsd: 0.47 })
})

describe('enqueue-set', () => {
  it('passes validated fields through to enqueueVideoJobSet and returns its result', async () => {
    const res = await post(validSet)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ variantGroupId: 'vg-1' })
    expect(enqueueSetMock).toHaveBeenCalledWith(expect.objectContaining({
      productHandle: 'satin-wand',
      formula: 'myth-busting',
      modelTier: 'wan27-atlas',
      durationSeconds: 5,
      hooks: ['Hook one', 'Hook two', 'Hook three'],
      targetPlatforms: ['instagram'],
    }))
  })

  it('rejects an empty hooks array', async () => {
    const res = await post({ ...validSet, hooks: [] })
    expect(res.status).toBe(400)
    expect(enqueueSetMock).not.toHaveBeenCalled()
  })

  it('rejects malformed presenters entries', async () => {
    const res = await post({ ...validSet, presenters: ['emma', 'Robert; DROP'] })
    expect(res.status).toBe(400)
    expect(enqueueSetMock).not.toHaveBeenCalled()
  })

  it('returns 403 with the gate payload when the money gate says no', async () => {
    gateMock.mockResolvedValue({ ok: false, reason: 'over_budget' })
    const res = await post(validSet)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'gated', reason: 'over_budget' })
    expect(enqueueSetMock).not.toHaveBeenCalled()
  })
})

describe('talking-tier validation', () => {
  // sync-lipsync and omnihuman are retired with the rest of fal video (owner
  // direction 2026-08-26), so the surviving talking tier is italk-atlas
  // (ADR-016).
  afterEach(() => { vi.unstubAllEnvs() })

  it('rejects enqueue without presenterLine', async () => {
    const res = await post({
      op: 'enqueue',
      productHandle: 'satin-wand',
      formula: 'the-one-thing',
      presenter: 'emma',
      modelTier: 'italk-atlas',
      scriptJson: { framePrompt: 'archetype C', motionPrompt: 'hold', talkingHead: true },
      durationSeconds: 5,
      targetPlatforms: ['instagram'],
    })
    expect(res.status).toBe(400)
    expect(await res.text()).toMatch(/presenterLine/)
  })

  it('rejects enqueue with presenter none', async () => {
    const res = await post({
      op: 'enqueue',
      productHandle: 'satin-wand',
      formula: 'the-one-thing',
      presenter: 'none',
      modelTier: 'italk-atlas',
      scriptJson: { presenterLine: 'One thing matters.', framePrompt: 'C', motionPrompt: 'hold' },
      durationSeconds: 5,
      targetPlatforms: ['instagram'],
    })
    expect(res.status).toBe(400)
    expect(await res.text()).toMatch(/presenter/)
  })
})

/**
 * Tier eligibility (ticket #5727). Before this, an enqueue on a retired fal
 * tier spent fal money, and one on a retired RunPod tier billed a GPU boot
 * before failing. Both are now a 400 before the money gate and before any
 * provider call.
 */
describe('tier eligibility', () => {
  it('refuses a retired fal video tier', async () => {
    const res = await post({ ...validSet, op: 'enqueue-set', modelTier: 'kling25-pro' })
    expect(res.status).toBe(400)
    const json = await res.json() as { error: string; detail: string }
    expect(json.error).toBe('retired_provider')
    expect(json.detail).toMatch(/fal is images only/)
    expect(enqueueSetMock).not.toHaveBeenCalled()
  })

  it('refuses a deleted RunPod tier id as retired_provider, not unknown (ADR-016)', async () => {
    const res = await post({
      op: 'enqueue',
      productHandle: 'satin-wand',
      formula: 'the-one-thing',
      presenter: 'emma',
      modelTier: 'wan22-s2v',
      scriptJson: { presenterLine: 'One thing matters.', framePrompt: 'C', motionPrompt: 'hold' },
      targetPlatforms: ['instagram'],
    })
    expect(res.status).toBe(400)
    const json = await res.json() as { error: string; detail: string }
    expect(json.error).toBe('retired_provider')
    expect(json.detail).toMatch(/RunPod/)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('refuses an Atlas tier when neither Atlas nor its mirror is keyed', async () => {
    vi.stubEnv('ATLAS_CLOUD_API_KEY', '')
    const res = await post({ ...validSet, op: 'enqueue-set', modelTier: 'wan27-atlas' })
    expect(res.status).toBe(400)
    const json = await res.json() as { error: string; detail: string }
    expect(json.error).toBe('provider_not_configured')
    expect(json.detail).toMatch(/ATLAS_CLOUD_API_KEY/)
    expect(enqueueSetMock).not.toHaveBeenCalled()
  })

  it('refuses BEFORE the money gate, so an ineligible tier never consumes budget', async () => {
    await post({ ...validSet, op: 'enqueue-set', modelTier: 'veo31' })
    expect(gateMock).not.toHaveBeenCalled()
  })
})

describe('config', () => {
  it('exposes tones and maxVariantsPerSet', async () => {
    const res = await post({ op: 'config' })
    expect(res.status).toBe(200)
    const json = await res.json() as Record<string, unknown>
    expect(json['tones']).toEqual(['warm', 'playful', 'direct', 'hushed'])
    expect(json['maxVariantsPerSet']).toBe(4)
    expect(json['endcardEnabled']).toBe(false)
  })

  // This op IS the writers room's tier menu, so it must not advertise a tier
  // the room would then be refused for choosing (ticket #5727).
  it('advertises only tiers that can actually be enqueued', async () => {
    const res = await post({ op: 'config' })
    const json = await res.json() as { models: Record<string, unknown> }
    expect(Object.keys(json.models)).toEqual(['italk-atlas', 'grok-atlas', 'wan27-atlas', 'wan22turbo-atlas'])
    expect(json.models['wan22-i2v']).toBeUndefined()
    expect(json.models['sync-lipsync']).toBeUndefined()
    expect(json.models['veo31']).toBeUndefined()
  })
})

/**
 * Production mode (owner ruling 2026-09-23): the writers decide talking head
 * vs voiceover; the tier follows the mode unless named, and a named tier that
 * contradicts the mode is a 400.
 */
describe('production mode', () => {
  const single = {
    op: 'enqueue',
    productHandle: 'satin-wand',
    formula: 'myth-busting',
    presenter: 'friend:maya',
    targetPlatforms: ['instagram'],
  }
  const talkingScript = { presenterLine: 'This is the mini wand.', framePrompt: 'C', motionPrompt: 'hold' }
  const voiceoverScript = { voiceover: 'This is the mini wand.', framePrompt: 'C', motionPrompt: 'turn it slowly' }

  it('talking with no tier defaults to italk-atlas and passes the mode through', async () => {
    const res = await post({ ...single, mode: 'talking', scriptJson: talkingScript })
    expect(res.status).toBe(200)
    expect(enqueueMock).toHaveBeenCalledWith(expect.objectContaining({ modelTier: 'italk-atlas', mode: 'talking' }))
  })

  it('voiceover with no tier defaults to wan27-atlas', async () => {
    const res = await post({ ...single, mode: 'voiceover', durationSeconds: 5, scriptJson: voiceoverScript })
    expect(res.status).toBe(200)
    expect(enqueueMock).toHaveBeenCalledWith(expect.objectContaining({ modelTier: 'wan27-atlas', mode: 'voiceover' }))
  })

  it('a named tier wins when it fits the mode', async () => {
    const res = await post({ ...single, mode: 'voiceover', modelTier: 'wan22turbo-atlas', durationSeconds: 5, scriptJson: voiceoverScript })
    expect(res.status).toBe(200)
    expect(enqueueMock).toHaveBeenCalledWith(expect.objectContaining({ modelTier: 'wan22turbo-atlas' }))
  })

  it("400s talking on a silent tier, naming the mismatch", async () => {
    const res = await post({ ...single, mode: 'talking', modelTier: 'wan27-atlas', durationSeconds: 5, scriptJson: talkingScript })
    expect(res.status).toBe(400)
    const json = await res.json() as { error: string; detail: string }
    expect(json.error).toBe('mode_tier_mismatch')
    expect(json.detail).toMatch(/talking.*wan27-atlas is silent/)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('400s voiceover on an audio-driven tier, naming the mismatch', async () => {
    const res = await post({ ...single, mode: 'voiceover', modelTier: 'italk-atlas', scriptJson: { ...talkingScript, voiceover: 'x' } })
    expect(res.status).toBe(400)
    const json = await res.json() as { error: string; detail: string }
    expect(json.error).toBe('mode_tier_mismatch')
    expect(json.detail).toMatch(/voiceover.*italk-atlas performs the line on camera/)
  })

  it('400s voiceover with no voiceover line', async () => {
    const res = await post({ ...single, mode: 'voiceover', durationSeconds: 5, scriptJson: { framePrompt: 'C', motionPrompt: 'm' } })
    expect(res.status).toBe(400)
    expect(await res.text()).toMatch(/voiceover/)
  })

  it('400s an unknown mode', async () => {
    const res = await post({ ...single, mode: 'b-roll', scriptJson: talkingScript })
    expect(res.status).toBe(400)
    expect(await res.text()).toMatch(/talking\|voiceover/)
  })
})

describe('owner-only tiers', () => {
  it('refuses grok-atlas on the team API (routines never route it)', async () => {
    const res = await post({ ...validSet, modelTier: 'grok-atlas', durationSeconds: 10 })
    expect(res.status).toBe(400)
    const json = await res.json() as { error: string }
    expect(json.error).toBe('owner_only_tier')
    expect(enqueueSetMock).not.toHaveBeenCalled()
  })

  it('config reports grok-atlas as ownerOnly and publishes the mode defaults', async () => {
    const res = await post({ op: 'config' })
    const json = await res.json() as { models: Record<string, { ownerOnly: boolean }>; modes: string[]; defaultTierByMode: Record<string, string> }
    expect(json.models['grok-atlas']?.ownerOnly).toBe(true)
    expect(json.models['italk-atlas']?.ownerOnly).toBe(false)
    expect(json.modes).toEqual(['talking', 'voiceover'])
    expect(json.defaultTierByMode).toEqual({ talking: 'italk-atlas', voiceover: 'wan27-atlas' })
  })
})
