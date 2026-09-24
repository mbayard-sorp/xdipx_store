/**
 * On-skin crops on the video path (ticket #10484).
 *
 * The owner cleared the on-skin register for Reels and video on 2026-09-20 and
 * uploaded a bodyReferencePhoto for every cast member. The video pipeline was
 * already holding that field in its hand (getApprovedCastMembers fetches it)
 * and returning `member.photoUrl` regardless, so a macro or close frame was
 * composed from a head-and-shoulders portrait and the model invented the whole
 * body, skin tone included, under a named persona's name. On this path that
 * invented body is then ANIMATED, which is why the gate here is a refusal and
 * not the stills path's silent portrait fallback.
 *
 * Covers: the crop resolving the body reference, the hard refusal at enqueue
 * when there is none, cropScale surviving validateScenes, and medium/wide
 * still resolving the portrait.
 *
 * Mocking follows video-scene-presenter.test.ts exactly (db/kv/team/blob/
 * sanity/shopify/runpod mocked, composeSceneFrame mocked so the frame stage
 * is reachable without network).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = {
  selectResults: [] as unknown[][],
  inserts: [] as Array<Record<string, unknown>>,
}

vi.mock('~/lib/db.server', () => {
  const selectChain = () => {
    const chain: Record<string, unknown> = {
      then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
        Promise.resolve(state.selectResults.shift() ?? []).then(resolve, reject),
    }
    chain['where'] = () => chain
    chain['orderBy'] = () => chain
    chain['limit'] = () => chain
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
const spendMock = vi.hoisted(() => vi.fn(async () => 0))
vi.mock('~/lib/team.server', () => ({ getTeamConfig: configMock, getTodaySpendCents: spendMock }))
vi.mock('~/lib/feed-processor.server', () => ({ getPipelineSetting: vi.fn().mockResolvedValue(null) }))
const blobPutMock = vi.hoisted(() => vi.fn(async (path: string) => ({ url: `https://blob.test/${path}` })))
vi.mock('~/lib/blob.server', () => ({ blobPut: blobPutMock, blobFetchToBuffer: vi.fn() }))
vi.mock('~/lib/token-log.server', () => ({ logVideoCost: vi.fn(), logImageCost: vi.fn() }))
const castMock = vi.hoisted(() => vi.fn())
const editorPhotoMock = vi.hoisted(() => vi.fn(async () => 'https://blob.test/emma.jpg'))
// Real presenterPhotoUrlForCrop semantics, not a stub: this IS the delegation
// under test, and a mock that always handed back the portrait would pass while
// the bug stayed in place.
const cropPhoto = vi.hoisted(() => (
  m: { photoUrl: string; bodyReferencePhotoUrl?: string | null },
  cropScale: string | null | undefined,
) => ((cropScale === 'macro' || cropScale === 'close') && m.bodyReferencePhotoUrl ? m.bodyReferencePhotoUrl : m.photoUrl))
vi.mock('~/lib/sanity.server', () => ({
  getEditorPhotoUrl: editorPhotoMock,
  getApprovedCastMembers: castMock,
  presenterPhotoUrlForCrop: cropPhoto,
}))
const productMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/shopify.server', () => ({ getProductByHandle: productMock }))
vi.mock('~/lib/ivr-voice.server', () => ({ getActiveIvrVoiceId: vi.fn().mockResolvedValue('voice-1') }))
vi.mock('~/lib/elevenlabs.server', () => ({ generateVoiceover: vi.fn(), generateVoiceoverWithTimestamps: vi.fn() }))
vi.mock('~/lib/video-assembly.server', () => ({
  extractPoster: vi.fn(),
  applyWatermark: vi.fn(),
  probeDurationSeconds: vi.fn(),
  muxAudio: vi.fn(),
  renderAspectMaster: vi.fn(),
  concatAndNormalize: vi.fn(),
  extractLastFrame: vi.fn(),
}))
vi.mock('~/lib/video-postpass.server', () => ({
  concatWithAudio: vi.fn(),
  runPostPass: vi.fn(),
  buildEndCard: vi.fn(),
}))
vi.mock('~/lib/runpod-video.server', () => ({
  submitRunpodVideo: vi.fn(),
  getRunpodStatus: vi.fn(),
  getRunpodResult: vi.fn(),
  runpodVideoConfigured: vi.fn(() => true),
  runpodWorkerModes: () => ['i2v', 't2v'],
  runpodWorkerSupportsMode: (m: string) => ['i2v', 't2v'].includes(m),
  cancelRunpod: vi.fn(),
}))
const composeSceneFrameMock = vi.hoisted(() => vi.fn())
const downloadFalAssetMock = vi.hoisted(() => vi.fn(async () => Buffer.from('fake-jpeg')))
vi.mock('~/lib/fal-video.server', async () => {
  const actual = await vi.importActual<typeof import('~/lib/fal-video.server')>('~/lib/fal-video.server')
  return { ...actual, composeSceneFrame: composeSceneFrameMock, downloadFalAsset: downloadFalAssetMock }
})

import { advanceInflightVideoJobs, enqueueVideoJob } from '~/lib/video-pipeline.server'

/** Maya has an owner-approved body reference. Ruth does not (yet). */
const MAYA = {
  slug: 'maya', name: 'Maya', role: null, photoUrl: 'https://blob.test/maya.jpg', photoAlt: null,
  shortBio: null, personaNotes: null, archetype: null, ageRange: null, description: null,
  emotionTags: [] as string[], editorialPhotoUrl: null, voiceId: 'voice-maya',
  bodyReferencePhotoUrl: 'https://blob.test/maya-body.jpg', skinToneNote: 'warm deep brown',
}
const RUTH = {
  ...MAYA,
  slug: 'ruth', name: 'Ruth', photoUrl: 'https://blob.test/ruth.jpg', voiceId: 'voice-ruth',
  bodyReferencePhotoUrl: null, skinToneNote: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  // Atlas tiers are refused as provider_not_configured without the key (ADR-016).
  vi.stubEnv('ATLAS_CLOUD_API_KEY', 'test-atlas-key')
  state.selectResults = []
  state.inserts = []
  configMock.mockResolvedValue({
    team: 'video', enabled: true, dailyCents: 2000, maxRunsPerDay: 1,
    autoApproveSuggestions: false, maxCostCents: 600, maxVariantsPerSet: 4,
  })
  castMock.mockResolvedValue([MAYA, RUTH])
  editorPhotoMock.mockResolvedValue('https://blob.test/emma.jpg')
  productMock.mockResolvedValue({ images: [{ url: 'https://blob.test/product.jpg' }] })
  composeSceneFrameMock.mockResolvedValue({
    urls: ['https://fal.test/candidate-0.jpg'],
    requestIds: ['req-1'],
    costKey: 'fal/scene-frame',
  })
})

const scene = (overrides: Record<string, unknown> = {}) => ({
  slug: 'on-skin',
  framePrompt: 'the wand resting against a hip',
  motionPrompt: 'slow push in',
  durationSeconds: 5,
  ...overrides,
})

const baseEnqueueArgs = {
  productHandle: 'satin-wand',
  formula: 'myth-busting',
  presenter: 'friend:maya',
  modelTier: 'wan27-atlas' as const,
  durationSeconds: 5,
  targetPlatforms: ['instagram'],
}

describe('enqueueVideoJob, cropScale survives validateScenes (ticket #10484)', () => {
  it('preserves cropScale through normalization (it used to be silently dropped by the nine-key whitelist)', async () => {
    await enqueueVideoJob({
      ...baseEnqueueArgs,
      scriptJson: { scenes: [scene({ cropScale: 'close' }), scene({ cropScale: 'wide' })] },
    })
    const stored = state.inserts[0]!['scenesJson'] as { cropScale?: string }[]
    expect(stored[0]!.cropScale).toBe('close')
    expect(stored[1]!.cropScale).toBe('wide')
  })

  it('leaves cropScale off a scene that named none (existing jobs store byte-for-byte what they always did)', async () => {
    await enqueueVideoJob({
      ...baseEnqueueArgs,
      scriptJson: { scenes: [scene(), scene()] },
    })
    const stored = state.inserts[0]!['scenesJson'] as { cropScale?: string }[]
    expect(stored[0]!.cropScale).toBeUndefined()
  })

  it('rejects a cropScale outside the vocabulary rather than letting the typo read as "not on skin"', async () => {
    await expect(enqueueVideoJob({
      ...baseEnqueueArgs,
      scriptJson: { scenes: [scene({ cropScale: 'closeup' }), scene()] },
    })).rejects.toThrow(/scenes\[0\]\.cropScale must be one of/)
    expect(state.inserts).toHaveLength(0)
  })
})

describe('enqueueVideoJob, on-skin crops are refused without a body reference (ticket #10484)', () => {
  it('refuses a close scene whose presenter has no bodyReferencePhoto, before any spend', async () => {
    await expect(enqueueVideoJob({
      ...baseEnqueueArgs,
      presenter: 'friend:ruth',
      scriptJson: { scenes: [scene({ cropScale: 'close' }), scene()] },
    })).rejects.toThrow(/no bodyReferencePhoto in Sanity/)
    expect(state.inserts).toHaveLength(0)
  })

  it('refuses a macro scene the same way, and names the crop and the presenter in the message', async () => {
    await expect(enqueueVideoJob({
      ...baseEnqueueArgs,
      presenter: 'friend:maya',
      scriptJson: { scenes: [scene(), scene({ cropScale: 'macro', presenter: 'friend:ruth' })] },
    })).rejects.toThrow(/scenes\[1\].*macro.*friend:ruth/s)
  })

  it('refuses when a CO-presenter lacks one (an on-skin two shot cannot pair a body reference with a portrait)', async () => {
    await expect(enqueueVideoJob({
      ...baseEnqueueArgs,
      scriptJson: { scenes: [scene({ cropScale: 'close', coPresenters: ['friend:ruth'] }), scene()] },
    })).rejects.toThrow(/friend:ruth.*no bodyReferencePhoto/s)
  })

  it('refuses an on-skin scene fronted by Emma (singleton.editor carries the portrait only)', async () => {
    await expect(enqueueVideoJob({
      ...baseEnqueueArgs,
      presenter: 'emma',
      scriptJson: { scenes: [scene({ cropScale: 'close' }), scene()] },
    })).rejects.toThrow(/singleton\.editor carries the portrait likeness only/)
  })

  it('accepts a close scene when the presenter DOES have a body reference', async () => {
    await enqueueVideoJob({
      ...baseEnqueueArgs,
      scriptJson: { scenes: [scene({ cropScale: 'close' }), scene()] },
    })
    expect(state.inserts).toHaveLength(1)
  })

  it('accepts medium and wide for a presenter with no body reference (the portrait is the right reference there)', async () => {
    await enqueueVideoJob({
      ...baseEnqueueArgs,
      presenter: 'friend:ruth',
      scriptJson: { scenes: [scene({ cropScale: 'medium' }), scene({ cropScale: 'wide' })] },
    })
    expect(state.inserts).toHaveLength(1)
  })

  it('refuses a single-scene job whose scriptJson.cropScale is on-skin and whose presenter has no body reference', async () => {
    await expect(enqueueVideoJob({
      ...baseEnqueueArgs,
      presenter: 'friend:ruth',
      scriptJson: { framePrompt: 'the wand against a hip', motionPrompt: 'slow push in', cropScale: 'close' },
    })).rejects.toThrow(/scriptJson.*no bodyReferencePhoto in Sanity/s)
    expect(state.inserts).toHaveLength(0)
  })

  it('accepts the same single-scene job for a presenter who has one', async () => {
    await enqueueVideoJob({
      ...baseEnqueueArgs,
      scriptJson: { framePrompt: 'the wand against a hip', motionPrompt: 'slow push in', cropScale: 'close' },
    })
    expect(state.inserts).toHaveLength(1)
  })

  it('rejects an unknown single-scene cropScale', async () => {
    await expect(enqueueVideoJob({
      ...baseEnqueueArgs,
      scriptJson: { framePrompt: 'x', motionPrompt: 'y', cropScale: 'tight' as never },
    })).rejects.toThrow(/scriptJson\.cropScale must be one of/)
  })
})

const jobRow = (overrides: Record<string, unknown> = {}) => ({
  id: 42,
  jobId: 'job-on-skin',
  productHandle: 'satin-wand',
  shopifyProductGid: null,
  formula: 'myth-busting',
  presenter: 'friend:maya',
  scriptJson: {} as Record<string, unknown>,
  aiDisclosure: true,
  modelTier: 'wan27-atlas',
  targetPlatforms: ['instagram'],
  stage: 'scene_frame',
  status: 'queued',
  providerRequestIds: {} as Record<string, unknown>,
  sceneFrameAssetId: null,
  finalAssetId: null,
  posterAssetId: null,
  costUsd: '0',
  metricsJson: null,
  variantGroupId: null,
  variantAxes: null,
  error: null,
  team: 'video',
  runId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  completedAt: null,
  scenesJson: null as unknown,
  sceneStateJson: null as unknown,
  ...overrides,
})

const multiSceneRow = (cropScale?: string) => jobRow({
  scenesJson: [
    { slug: 'on-skin', framePrompt: 'the wand resting against a hip', motionPrompt: 'push in', durationSeconds: 5, continuity: 'own-frame', ...(cropScale ? { cropScale } : {}) },
    { slug: 'later', framePrompt: 'b', motionPrompt: 'hold', durationSeconds: 5, continuity: 'last-frame' },
  ],
  sceneStateJson: [{ status: 'pending' }, { status: 'pending' }],
})

describe('scene_frame stage, which reference an on-skin crop composes from (ticket #10484)', () => {
  it('multi-scene: a close scene composes from the cast member\'s bodyReferencePhoto, not the portrait', async () => {
    state.selectResults = [[multiSceneRow('close')]]

    const result = await advanceInflightVideoJobs()

    expect(result.failed).toBe(0)
    expect(composeSceneFrameMock).toHaveBeenCalledWith(expect.objectContaining({
      presenterImageUrl: 'https://blob.test/maya-body.jpg',
    }))
  })

  it('multi-scene: a medium scene still composes from the portrait', async () => {
    state.selectResults = [[multiSceneRow('medium')]]

    await advanceInflightVideoJobs()

    expect(composeSceneFrameMock).toHaveBeenCalledWith(expect.objectContaining({
      presenterImageUrl: 'https://blob.test/maya.jpg',
    }))
  })

  it('multi-scene: a scene with no cropScale composes from the portrait (unchanged behavior)', async () => {
    state.selectResults = [[multiSceneRow()]]

    await advanceInflightVideoJobs()

    expect(composeSceneFrameMock).toHaveBeenCalledWith(expect.objectContaining({
      presenterImageUrl: 'https://blob.test/maya.jpg',
    }))
  })

  it('multi-scene: states the cast member\'s skin tone in the frame prompt rather than leaving it to the model', async () => {
    state.selectResults = [[multiSceneRow('close')]]

    await advanceInflightVideoJobs()

    const call = composeSceneFrameMock.mock.calls[0]![0] as { prompt: string }
    expect(call.prompt).toContain('Skin tone: warm deep brown.')
    expect(call.prompt).toContain('the wand resting against a hip')
  })

  it('single-scene: scriptJson.cropScale close composes from the bodyReferencePhoto', async () => {
    state.selectResults = [[jobRow({
      scriptJson: { framePrompt: 'the wand against a hip', motionPrompt: 'push in', cropScale: 'close' },
    })]]

    const result = await advanceInflightVideoJobs()

    expect(result.failed).toBe(0)
    expect(composeSceneFrameMock).toHaveBeenCalledWith(expect.objectContaining({
      presenterImageUrl: 'https://blob.test/maya-body.jpg',
    }))
  })

  it('single-scene: no cropScale composes from the portrait (unchanged behavior)', async () => {
    state.selectResults = [[jobRow({
      scriptJson: { framePrompt: 'the wand on a cream surface', motionPrompt: 'push in' },
    })]]

    await advanceInflightVideoJobs()

    expect(composeSceneFrameMock).toHaveBeenCalledWith(expect.objectContaining({
      presenterImageUrl: 'https://blob.test/maya.jpg',
    }))
  })

  // Parity with the multi-scene skin-tone assertion above (ticket #10500):
  // withSkinToneNote is wired at both call sites, but only the multi-scene
  // one was test-covered, so a future refactor could silently drop the
  // single-scene one without a red test.
  it('single-scene: states the cast member\'s skin tone in the frame prompt rather than leaving it to the model', async () => {
    state.selectResults = [[jobRow({
      scriptJson: { framePrompt: 'the wand against a hip', motionPrompt: 'push in', cropScale: 'close' },
    })]]

    await advanceInflightVideoJobs()

    const call = composeSceneFrameMock.mock.calls[0]![0] as { prompt: string }
    expect(call.prompt).toContain('Skin tone: warm deep brown.')
    expect(call.prompt).toContain('the wand against a hip')
  })
})

/**
 * TOCTOU re-assertion at the frame stage (ticket #10500). #10484's gate only
 * ran at enqueue; if a castMember's bodyReferencePhoto is removed or unset in
 * Sanity between enqueue and the frame stage, resolvePresenterReference used
 * to fall back to the portrait silently and the render proceeded — the exact
 * failure #10484 exists to prevent, just moved one stage later. These tests
 * never call enqueueVideoJob: the job row is injected directly at the frame
 * stage (as the suite above already does), and the cast mock is the one that
 * simulates "the reference is gone by the time this stage runs".
 */
describe('scene_frame stage re-asserts the body-reference gate (ticket #10500, TOCTOU on #10484)', () => {
  it('single-scene: fails the job rather than composing from the portrait when the body reference is gone', async () => {
    castMock.mockResolvedValue([{ ...MAYA, bodyReferencePhotoUrl: null }, RUTH])
    state.selectResults = [[jobRow({
      scriptJson: { framePrompt: 'the wand against a hip', motionPrompt: 'push in', cropScale: 'close' },
    })]]

    const result = await advanceInflightVideoJobs()

    expect(result.failed).toBe(1)
    expect(composeSceneFrameMock).not.toHaveBeenCalled()
  })

  it('multi-scene: fails the job rather than composing from the portrait when the body reference is gone', async () => {
    castMock.mockResolvedValue([{ ...MAYA, bodyReferencePhotoUrl: null }, RUTH])
    state.selectResults = [[multiSceneRow('close')]]

    const result = await advanceInflightVideoJobs()

    expect(result.failed).toBe(1)
    expect(composeSceneFrameMock).not.toHaveBeenCalled()
  })

  it('single-scene: a medium crop still composes fine with no body reference (only on-skin crops are gated)', async () => {
    castMock.mockResolvedValue([{ ...MAYA, bodyReferencePhotoUrl: null }, RUTH])
    state.selectResults = [[jobRow({
      scriptJson: { framePrompt: 'the wand on a cream surface', motionPrompt: 'push in', cropScale: 'medium' },
    })]]

    const result = await advanceInflightVideoJobs()

    expect(result.failed).toBe(0)
    expect(composeSceneFrameMock).toHaveBeenCalledWith(expect.objectContaining({
      presenterImageUrl: 'https://blob.test/maya.jpg',
    }))
  })
})
