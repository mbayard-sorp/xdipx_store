/**
 * The video mirror rule (ADR-016): Atlas first, Wavespeed only when Atlas is
 * unconfigured or its submit fails for a reason other than a content refusal,
 * only for tiers with a like-for-like mirror, and never load-balanced. fetch
 * is mocked; no provider is called.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/token-log.server', () => ({ logGenerationBlock: vi.fn(async () => {}) }))

import { isMirrorableSubmitError, providerForHandle, requireVideoProvider, submitVideoWithMirror, getVideoProvider } from './registry.server'
import { AtlasVideoSubmitError } from './atlascloud-video.server'

const FRAME = 'https://x.public.blob.vercel-storage.com/video/j/frame.jpg'
const SPEECH = 'https://x.public.blob.vercel-storage.com/video/j/speech-0.mp3'
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const atlasOk = (id = 'atlas000001') => json({ code: 200, data: { id, status: 'processing' } })
const wsOk = (id = 'ws00000001') => json({ code: 200, data: { id, status: 'created' } })
const talk = { prompt: '', imageUrl: FRAME, audioUrl: SPEECH, durationSeconds: 9 }

let fetchMock: ReturnType<typeof vi.fn>
const log = vi.fn()

beforeEach(() => {
  vi.stubEnv('ATLAS_CLOUD_API_KEY', 'atlas-key')
  vi.stubEnv('WAVESPEED_API_KEY', 'ws-key')
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  log.mockClear()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const hostOf = (i: number) => new URL(String(fetchMock.mock.calls[i]![0])).host

describe('submitVideoWithMirror', () => {
  it('never load-balances: a healthy Atlas takes the render and Wavespeed is not called', async () => {
    fetchMock.mockResolvedValueOnce(atlasOk())
    const r = await submitVideoWithMirror('italk-atlas', 'atlascloud', talk, { log })
    expect(r.providerId).toBe('atlascloud')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(hostOf(0)).toBe('api.atlascloud.ai')
  })

  it('fails over on balance exhaustion', async () => {
    fetchMock.mockResolvedValueOnce(json({ code: 402, msg: 'Insufficient balance' }, 402)).mockResolvedValueOnce(wsOk())
    const r = await submitVideoWithMirror('italk-atlas', 'atlascloud', talk, { log })
    expect(r.providerId).toBe('wavespeed')
    expect(hostOf(1)).toBe('api.wavespeed.ai')
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/using the wavespeed mirror/))
  })

  it('fails over on a 5xx submit', async () => {
    fetchMock.mockResolvedValueOnce(new Response('upstream down', { status: 503 })).mockResolvedValueOnce(wsOk())
    const r = await submitVideoWithMirror('wan22turbo-atlas', 'atlascloud', { prompt: 'p', imageUrl: FRAME, durationSeconds: 5 }, { log })
    expect(r.providerId).toBe('wavespeed')
  })

  it.each([502, 504, 524])('does not mirror a %i: the gateway may have lost an accepted render', async (code) => {
    fetchMock.mockResolvedValueOnce(new Response('gateway', { status: code }))
    await expect(submitVideoWithMirror('italk-atlas', 'atlascloud', talk, { log })).rejects.toThrow(String(code))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not mirror a network error after the POST (the render may be running)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed: socket hang up'))
    await expect(submitVideoWithMirror('italk-atlas', 'atlascloud', talk, { log })).rejects.toThrow(/socket hang up/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not mirror a 200 with no prediction id (ambiguous acceptance)', async () => {
    fetchMock.mockResolvedValueOnce(json({ code: 200, data: {} }))
    await expect(submitVideoWithMirror('italk-atlas', 'atlascloud', talk, { log })).rejects.toThrow(/missing data.id/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not mirror an input validation error (nothing was sent)', async () => {
    await expect(submitVideoWithMirror('italk-atlas', 'atlascloud', { prompt: '', imageUrl: FRAME, durationSeconds: 9 }, { log })).rejects.toThrow(/audioUrl/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not mirror an uploadMedia failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response('storage down', { status: 500 }))
    await expect(submitVideoWithMirror('wan22turbo-atlas', 'atlascloud', { prompt: 'p', imageUrl: 'data:image/jpeg;base64,AAAA', durationSeconds: 5 }, { log })).rejects.toThrow(/uploadMedia/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses the mirror when Atlas is unconfigured', async () => {
    vi.stubEnv('ATLAS_CLOUD_API_KEY', '')
    fetchMock.mockResolvedValueOnce(wsOk())
    const r = await submitVideoWithMirror('italk-atlas', 'atlascloud', talk, { log })
    expect(r.providerId).toBe('wavespeed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never shops a content refusal to the mirror', async () => {
    fetchMock.mockResolvedValueOnce(json({ code: 400, msg: 'content policy violation: nsfw' }, 400))
    await expect(submitVideoWithMirror('italk-atlas', 'atlascloud', talk, { log })).rejects.toThrow(/content/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('has no mirror for grok-atlas or wan27-atlas: the Atlas error surfaces', async () => {
    fetchMock.mockResolvedValueOnce(new Response('upstream down', { status: 503 }))
    await expect(submitVideoWithMirror('wan27-atlas', 'atlascloud', { prompt: 'p', imageUrl: FRAME, durationSeconds: 5 }, { log })).rejects.toThrow(/503/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces the Atlas error when the mirror is not keyed', async () => {
    vi.stubEnv('WAVESPEED_API_KEY', '')
    fetchMock.mockResolvedValueOnce(new Response('upstream down', { status: 503 }))
    await expect(submitVideoWithMirror('italk-atlas', 'atlascloud', talk, { log })).rejects.toThrow(/503/)
  })

  it('names both keys when neither provider is configured', async () => {
    vi.stubEnv('ATLAS_CLOUD_API_KEY', '')
    vi.stubEnv('WAVESPEED_API_KEY', '')
    await expect(submitVideoWithMirror('italk-atlas', 'atlascloud', talk, { log })).rejects.toThrow(/not configured.*mirror/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('provider resolution', () => {
  it('routes a persisted handle to the provider that issued it, whatever the spec says', () => {
    expect(providerForHandle({ requestId: 'w', statusUrl: 'https://api.wavespeed.ai/api/v3/predictions/w/result', responseUrl: '' }, 'atlascloud').id).toBe('wavespeed')
    expect(providerForHandle({ requestId: 'a', statusUrl: 'https://api.atlascloud.ai/api/v1/model/prediction/a', responseUrl: '' }, undefined).id).toBe('atlascloud')
    expect(providerForHandle({ requestId: 'f', statusUrl: 'https://queue.fal.run/x/requests/f', responseUrl: '' }, 'atlascloud').id).toBe('fal')
  })

  it('keeps fal resolvable for historical rows and refuses RunPod loudly', () => {
    expect(requireVideoProvider(undefined).id).toBe('fal')
    expect(getVideoProvider('fal')?.id).toBe('fal')
    expect(() => requireVideoProvider('runpod')).toThrow(/RunPod video is retired/)
    expect(() => providerForHandle({ requestId: 'r', statusUrl: 'https://api.runpod.ai/v2/ep/status/r', responseUrl: '' }, 'runpod')).toThrow(/retired/)
  })

  it('defaults video to Atlas', () => {
    expect(getVideoProvider()?.id).toBe('atlascloud')
  })
})

describe('isMirrorableSubmitError', () => {
  it('mirrors only a received, non-content, non-gateway Atlas error envelope', () => {
    expect(isMirrorableSubmitError(new AtlasVideoSubmitError('balance', 402, 'x'))).toBe(true)
    expect(isMirrorableSubmitError(new AtlasVideoSubmitError('server', 503, 'x'))).toBe(true)
    expect(isMirrorableSubmitError(new AtlasVideoSubmitError('unknown_model', 400, 'x'))).toBe(true)
    expect(isMirrorableSubmitError(new AtlasVideoSubmitError('content', 400, 'x'))).toBe(false)
    expect(isMirrorableSubmitError(new AtlasVideoSubmitError('server', 502, 'x'))).toBe(false)
    expect(isMirrorableSubmitError(new AtlasVideoSubmitError('server', 504, 'x'))).toBe(false)
    expect(isMirrorableSubmitError(new AtlasVideoSubmitError('server', 524, 'x'))).toBe(false)
    expect(isMirrorableSubmitError(new Error('fetch failed'))).toBe(false)
  })
})
