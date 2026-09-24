/**
 * Atlas Cloud video adapter (ADR-016). Every request and response shape below
 * is copied from the 2026-09-23 bake-off capture (atlas-video-api.json, see
 * docs/media-model-routing.md "Atlas video bake-off 2026-09-23"). fetch is
 * mocked throughout: no test spends on Atlas.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logBlockMock = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('~/lib/token-log.server', () => ({ logGenerationBlock: logBlockMock }))

import {
  AtlasVideoSubmitError,
  atlasModelFor,
  atlascloudVideoProvider,
  buildAtlasVideoBody,
  getAtlasVideoResult,
  getAtlasVideoStatus,
  isAtlasBalanceExhausted,
  submitAtlasVideo,
} from './atlascloud-video.server'
import { ATLAS_BASE, ATLAS_USER_AGENT } from '~/lib/atlas.server'

const PLATE = 'https://atlas-img.oss-accelerate-overseas.aliyuncs.com/images/5019c18b-c5c7-4ff4-9729-0fd742daff85.jpg'
const AUDIO = 'https://atlas-img.oss-accelerate-overseas.aliyuncs.com/audio/60571cfb-ba6d-4438-8b39-4380efe3b5f5.mp3'
const ID = 'e13520f37f8d47e2a1979f1f5624fec3'
const PRED_URL = `https://api.atlascloud.ai/api/v1/model/prediction/${ID}`
const OUT = `https://atlas-media.oss-us-west-1.aliyuncs.com/assetd-history/v1/a/u/s/${ID}-87ff4a2e1afa196e.mp4`

/** The bake-off's submit response, verbatim in shape. */
function submitResponse(id = ID, getUrl = `https://api.atlascloud.ai/api/v1/model/prediction/${id}`) {
  return {
    code: 200,
    message: '',
    data: {
      id,
      model: 'atlascloud/infinitetalk',
      outputs: null,
      urls: { get: getUrl },
      has_nsfw_contents: null,
      status: 'processing',
      created_at: '0001-01-01T00:00:00Z',
      error: '',
      executionTime: 0,
      timings: { inference: 0 },
    },
  }
}

function prediction(status: string, extra: Record<string, unknown> = {}) {
  return {
    code: 200,
    message: 'success',
    data: { id: ID, model: 'atlascloud/infinitetalk', outputs: null, urls: { get: PRED_URL }, has_nsfw_contents: null, status, error: '', ...extra },
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.stubEnv('ATLAS_CLOUD_API_KEY', 'test-atlas-key')
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  logBlockMock.mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('buildAtlasVideoBody (request shapes from the capture)', () => {
  it('InfiniteTalk: {model, image, audio, prompt, resolution:"720p", seed:-1}', () => {
    expect(buildAtlasVideoBody('infinitetalk-atlas', {
      prompt: 'A woman talking to her phone camera', imageUrl: PLATE, audioUrl: AUDIO, durationSeconds: 10,
    })).toEqual({
      model: 'atlascloud/infinitetalk',
      image: PLATE,
      audio: AUDIO,
      prompt: 'A woman talking to her phone camera',
      resolution: '720p',
      seed: -1,
    })
  })

  it('Grok: image_url + duration + 720p + 9:16, and the spoken line rides inside the prompt', () => {
    const body = buildAtlasVideoBody('grok-atlas', {
      prompt: 'Handheld-phone selfie video, static framing.',
      imageUrl: PLATE,
      durationSeconds: 10,
      spokenLine: 'This is the mini wand.',
    })
    expect(body).toEqual({
      model: 'xai/grok-imagine-video-v1.5/image-to-video',
      prompt: 'Handheld-phone selfie video, static framing. She looks into the lens and says: "This is the mini wand."',
      image_url: PLATE,
      duration: 10,
      resolution: '720p',
      aspect_ratio: '9:16',
    })
    expect(body).not.toHaveProperty('image')
    expect(body).not.toHaveProperty('dialogue')
  })

  it('Wan 2.7: uppercase 720P, prompt_extend false, negative prompt passed', () => {
    expect(buildAtlasVideoBody('wan27-atlas', {
      prompt: 'she turns the wand slowly', negativePrompt: 'text, letters', imageUrl: PLATE, durationSeconds: 5,
    })).toEqual({
      model: 'alibaba/wan-2.7/image-to-video',
      image: PLATE,
      prompt: 'she turns the wand slowly',
      negative_prompt: 'text, letters',
      resolution: '720P',
      duration: 5,
      prompt_extend: false,
      seed: -1,
    })
  })

  it('Wan 2.2 Turbo: lowercase 720p, 5 s', () => {
    expect(buildAtlasVideoBody('wan22turbo-atlas', { prompt: 'p', imageUrl: PLATE, durationSeconds: 5 })).toEqual({
      model: 'atlascloud/wan-2.2-turbo/image-to-video',
      image: PLATE,
      prompt: 'p',
      resolution: '720p',
      duration: 5,
      seed: -1,
    })
  })

  it('refuses before any network: no audio on InfiniteTalk, a bad duration, a non-Atlas tier', () => {
    expect(() => buildAtlasVideoBody('infinitetalk-atlas', { prompt: '', imageUrl: PLATE, durationSeconds: 10 })).toThrow(/audioUrl/)
    expect(() => buildAtlasVideoBody('wan22turbo-atlas', { prompt: 'p', imageUrl: PLATE, durationSeconds: 8 })).toThrow(/duration 8s/)
    expect(() => buildAtlasVideoBody('wan22-i2v', { prompt: 'p', imageUrl: PLATE, durationSeconds: 5 })).toThrow(/not an Atlas video tier/)
    expect(atlasModelFor('omnihuman')).toBeNull()
    expect(atlasModelFor('grok')).toBeNull() // the fal Grok tier is not the Atlas one
  })
})

describe('submitAtlasVideo', () => {
  it('POSTs generateVideo with bearer auth, an explicit User-Agent, and the flat body; returns the handle at once', async () => {
    fetchMock.mockResolvedValueOnce(json(submitResponse()))

    const handle = await submitAtlasVideo('infinitetalk-atlas', {
      prompt: 'talking', imageUrl: PLATE, audioUrl: AUDIO, durationSeconds: 10,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1) // no in-process polling
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.atlascloud.ai/api/v1/model/generateVideo')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer test-atlas-key')
    expect(headers['User-Agent']).toBe(ATLAS_USER_AGENT)
    expect(headers['User-Agent']).not.toMatch(/python-urllib/i)
    expect(headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'atlascloud/infinitetalk', image: PLATE, audio: AUDIO })
    expect(handle).toEqual({ requestId: ID, statusUrl: PRED_URL, responseUrl: PRED_URL })
  })

  it('builds the poll URL from the id and ignores a foreign urls.get (the key is sent to statusUrl)', async () => {
    fetchMock.mockResolvedValueOnce(json(submitResponse(ID, 'https://evil.example/steal')))
    const handle = await submitAtlasVideo('wan27-atlas', { prompt: 'p', imageUrl: PLATE, durationSeconds: 5 })
    expect(handle.statusUrl).toBe(PRED_URL)
    expect(handle.statusUrl.startsWith(ATLAS_BASE)).toBe(true)
  })

  it('classifies the unknown-model 400 and does not retry through upload', async () => {
    fetchMock.mockResolvedValueOnce(json({ code: 400, msg: 'not found' }, 400))
    const err = await submitAtlasVideo('wan27-atlas', { prompt: 'p', imageUrl: PLATE, durationSeconds: 5 }).catch(e => e)
    expect(err).toBeInstanceOf(AtlasVideoSubmitError)
    expect((err as AtlasVideoSubmitError).kind).toBe('unknown_model')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('routes a content refusal through the Atlas block telemetry and marks it content', async () => {
    fetchMock.mockResolvedValueOnce(json({ code: 400, msg: 'content policy violation: nsfw detected in image' }, 400))
    const err = await submitAtlasVideo('grok-atlas', { prompt: 'p', imageUrl: PLATE, durationSeconds: 5 }).catch(e => e)
    expect((err as AtlasVideoSubmitError).kind).toBe('content')
    expect(logBlockMock).toHaveBeenCalledWith(expect.objectContaining({ reason: 'content_policy', model: 'xai/grok-imagine-video-v1.5/image-to-video' }))
  })

  it('marks balance exhaustion so the registry can fail over to the mirror', async () => {
    fetchMock.mockResolvedValueOnce(json({ code: 402, msg: 'Insufficient balance' }, 402))
    const err = await submitAtlasVideo('infinitetalk-atlas', { prompt: '', imageUrl: PLATE, audioUrl: AUDIO, durationSeconds: 9 }).catch(e => e)
    expect((err as AtlasVideoSubmitError).kind).toBe('balance')
    expect(isAtlasBalanceExhausted(200, 'your account balance is insufficient')).toBe(true)
    expect(isAtlasBalanceExhausted(400, 'bad request')).toBe(false)
  })

  it('on a rejected direct URL, re-hosts image and audio through uploadMedia once and resubmits', async () => {
    const blobFrame = 'https://x.public.blob.vercel-storage.com/video/j/frame.jpg'
    const blobAudio = 'https://x.public.blob.vercel-storage.com/video/j/speech-0.mp3'
    fetchMock
      .mockResolvedValueOnce(json({ code: 400, msg: 'failed to download image from url' }, 400)) // direct submit refused
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2]))) // read frame
      .mockResolvedValueOnce(json({ code: 200, message: 'success', data: { type: 'image', download_url: PLATE } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([3, 4]))) // read audio
      .mockResolvedValueOnce(json({ code: 200, message: 'success', data: { type: 'audio', download_url: AUDIO } }))
      .mockResolvedValueOnce(json(submitResponse()))

    const handle = await submitAtlasVideo('infinitetalk-atlas', { prompt: '', imageUrl: blobFrame, audioUrl: blobAudio, durationSeconds: 9 })

    expect(handle.requestId).toBe(ID)
    const urls = fetchMock.mock.calls.map(c => c[0])
    expect(urls.filter(u => u === 'https://api.atlascloud.ai/api/v1/model/uploadMedia')).toHaveLength(2)
    const uploadInit = fetchMock.mock.calls[2]![1] as RequestInit
    expect(uploadInit.body).toBeInstanceOf(FormData)
    expect((uploadInit.body as FormData).get('file')).toBeTruthy()
    expect((uploadInit.headers as Record<string, string>)['User-Agent']).toBe(ATLAS_USER_AGENT)
    const resubmit = JSON.parse(String((fetchMock.mock.calls[5]![1] as RequestInit).body))
    expect(resubmit).toMatchObject({ image: PLATE, audio: AUDIO })
  })

  it('uploads a data: URI before the first submit (never passed straight through)', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ code: 200, message: 'success', data: { type: 'image', download_url: PLATE } }))
      .mockResolvedValueOnce(json(submitResponse()))
    await submitAtlasVideo('wan27-atlas', { prompt: 'p', imageUrl: 'data:image/jpeg;base64,AAAA', durationSeconds: 5 })
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.atlascloud.ai/api/v1/model/uploadMedia')
    expect(JSON.parse(String((fetchMock.mock.calls[1]![1] as RequestInit).body)).image).toBe(PLATE)
  })

  it('treats an HTTP 200 carrying an error code as a failure', async () => {
    fetchMock.mockResolvedValueOnce(json({ code: 500, msg: 'internal error' }))
    const err = await submitAtlasVideo('wan27-atlas', { prompt: 'p', imageUrl: PLATE, durationSeconds: 5 }).catch(e => e)
    expect((err as AtlasVideoSubmitError).kind).toBe('server')
  })
})

describe('getAtlasVideoStatus (status mapping)', () => {
  const handle = { requestId: ID, statusUrl: PRED_URL, responseUrl: PRED_URL }

  it.each([
    ['created', 'IN_QUEUE'],
    ['queued', 'IN_QUEUE'],
    ['processing', 'IN_PROGRESS'],
    // InfiniteTalk reported pending AFTER processing, near the end.
    ['pending', 'IN_PROGRESS'],
    ['some-new-state', 'IN_PROGRESS'],
    ['completed', 'COMPLETED'],
    ['succeeded', 'COMPLETED'],
  ])('%s -> %s', async (atlas, ours) => {
    fetchMock.mockResolvedValueOnce(json(prediction(atlas)))
    expect((await getAtlasVideoStatus(handle)).status).toBe(ours)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(PRED_URL)
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(ATLAS_USER_AGENT)
  })

  it('failed -> FAILED with the provider message, recorded through the Atlas block telemetry', async () => {
    fetchMock.mockResolvedValueOnce(json(prediction('failed', { error: 'Content moderation: the input image was flagged as nsfw' })))
    const s = await getAtlasVideoStatus(handle)
    expect(s.status).toBe('FAILED')
    expect(s.error).toMatch(/flagged as nsfw/)
    expect(logBlockMock).toHaveBeenCalledWith(expect.objectContaining({ reason: 'content_policy', model: 'atlascloud/infinitetalk' }))
  })

  it('a non-content failure is recorded as a server fault, not a refusal', async () => {
    fetchMock.mockResolvedValueOnce(json(prediction('failed', { error: 'CUDA out of memory' })))
    const s = await getAtlasVideoStatus(handle)
    expect(s.status).toBe('FAILED')
    expect(logBlockMock).toHaveBeenCalledWith(expect.objectContaining({ reason: 'server' }))
  })

  it('a 5xx or 429 on the poll is transient (still running); a 404 throws', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
    expect((await getAtlasVideoStatus(handle)).status).toBe('IN_PROGRESS')
    fetchMock.mockResolvedValueOnce(new Response('slow down', { status: 429 }))
    expect((await getAtlasVideoStatus(handle)).status).toBe('IN_PROGRESS')
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 404 }))
    await expect(getAtlasVideoStatus(handle)).rejects.toThrow(/404/)
  })
})

describe('getAtlasVideoResult', () => {
  const handle = { requestId: ID, statusUrl: PRED_URL, responseUrl: PRED_URL }

  it('returns data.outputs[0] as the video URL', async () => {
    fetchMock.mockResolvedValueOnce(json(prediction('completed', { outputs: [OUT], price: '0.600294' })))
    expect(await getAtlasVideoResult(handle)).toEqual({ videoUrl: OUT, contentType: 'video/mp4' })
  })

  it('throws on a completed prediction with no outputs, or one that is not complete', async () => {
    fetchMock.mockResolvedValueOnce(json(prediction('completed', { outputs: [] })))
    await expect(getAtlasVideoResult(handle)).rejects.toThrow(/no outputs/)
    fetchMock.mockResolvedValueOnce(json(prediction('processing')))
    await expect(getAtlasVideoResult(handle)).rejects.toThrow(/not complete/)
  })
})

describe('atlascloudVideoProvider', () => {
  it('is configured only with the key, supports the Atlas tiers, and owns Atlas handles', () => {
    expect(atlascloudVideoProvider.configured()).toBe(true)
    vi.stubEnv('ATLAS_CLOUD_API_KEY', '')
    expect(atlascloudVideoProvider.configured()).toBe(false)
    expect(atlascloudVideoProvider.supportsAudioDriven).toBe(true)
    expect(atlascloudVideoProvider.supportsModel?.('infinitetalk-atlas')).toBe(true)
    expect(atlascloudVideoProvider.supportsModel?.('wan22-i2v')).toBe(false)
    expect(atlascloudVideoProvider.ownsHandle?.({ requestId: ID, statusUrl: PRED_URL, responseUrl: PRED_URL })).toBe(true)
    expect(atlascloudVideoProvider.ownsHandle?.({ requestId: 'x', statusUrl: 'https://queue.fal.run/a/requests/x', responseUrl: '' })).toBe(false)
  })
})
