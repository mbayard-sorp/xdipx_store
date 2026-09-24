/**
 * Wavespeed VIDEO adapter: the MIRROR for Atlas Cloud (ADR-016, 2026-09-23).
 *
 * Mirror rule (enforced in registry.server.ts, not here): Wavespeed is selected
 * only when Atlas is unconfigured, errors on submit (other than a content
 * block), or reports balance exhaustion. It is never load-balanced, and a
 * handle it issued is always polled back on Wavespeed (ownsHandle).
 *
 * UNVERIFIED. No Wavespeed call has been made from this repo and no key has
 * been exercised. Every shape below is from Wavespeed's public v3 docs as
 * remembered at build time, and Atlas's response envelope is a near copy of
 * it ({code, data:{id, status, outputs, urls:{get}, has_nsfw_contents}}),
 * which is the main reason to believe it. Specifically unverified:
 *   - base URL https://api.wavespeed.ai/api/v3 and submit at POST {base}/{model}
 *   - poll at GET {base}/predictions/{id}/result
 *   - status vocabulary created|processing|completed|failed
 *   - model ids wavespeed-ai/infinitetalk, wavespeed-ai/wan-2.2/speech-to-video,
 *     wavespeed-ai/wan-2.2/i2v-720p
 *   - field names (image, audio, prompt, resolution, duration, seed)
 *   - that public Vercel Blob URLs are accepted as inputs
 *   - pricing (the job's cost is estimated from the TIER's Atlas rate)
 * All of it lives in WAVESPEED_API and MODEL_ADAPTERS below, so a wrong guess
 * is a one-file fix. Verify with one cheap wan-2.2 i2v submit before relying
 * on the mirror.
 *
 * Server-only.
 */
import type {
  VideoGenInput,
  VideoGenResult,
  VideoProvider,
  VideoQueueHandle,
  VideoStatusResult,
} from './types'

/** Everything host- and path-shaped, in one place. UNVERIFIED (see header). */
export const WAVESPEED_API = {
  base: 'https://api.wavespeed.ai/api/v3',
  submitPath: (model: string) => `/${model}`,
  resultPath: (id: string) => `/predictions/${id}/result`,
} as const

const USER_AGENT = 'xdipx-store/1.0 (+https://xdipx.com)'

export function wavespeedConfigured(): boolean {
  return !!process.env['WAVESPEED_API_KEY']?.trim()
}

function requireKey(): string {
  const key = process.env['WAVESPEED_API_KEY']?.trim()
  if (!key) throw new Error('WAVESPEED_API_KEY env var is required for Wavespeed calls')
  return key
}

function headers(key: string, json = false): Record<string, string> {
  return {
    'Authorization': `Bearer ${key}`,
    'User-Agent': USER_AGENT,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  }
}

type BodyBuilder = (input: VideoGenInput) => Record<string, unknown>

interface WavespeedModelAdapter {
  /** Wavespeed model id (path segment). UNVERIFIED. */
  model: string
  audioDriven: boolean
  body: BodyBuilder
}

/** Wavespeed endpoints this adapter can call. Field names UNVERIFIED. */
const MODEL_ADAPTERS: Record<string, WavespeedModelAdapter> = {
  'wavespeed-ai/infinitetalk': {
    model: 'wavespeed-ai/infinitetalk',
    audioDriven: true,
    body: (input) => ({
      image: input.imageUrl,
      audio: input.audioUrl,
      ...(input.prompt ? { prompt: input.prompt } : {}),
      resolution: '720p',
      seed: -1,
    }),
  },
  'wavespeed-ai/wan-2.2/speech-to-video': {
    model: 'wavespeed-ai/wan-2.2/speech-to-video',
    audioDriven: true,
    body: (input) => ({
      image: input.imageUrl,
      audio: input.audioUrl,
      ...(input.prompt ? { prompt: input.prompt } : {}),
      resolution: '720p',
      seed: -1,
    }),
  },
  'wavespeed-ai/wan-2.2/i2v-720p': {
    model: 'wavespeed-ai/wan-2.2/i2v-720p',
    audioDriven: false,
    body: (input) => ({
      image: input.imageUrl,
      prompt: input.prompt,
      ...(input.negativePrompt ? { negative_prompt: input.negativePrompt } : {}),
      duration: input.durationSeconds,
      seed: -1,
    }),
  },
}

/**
 * Store tier id -> Wavespeed endpoint that mirrors it. Only like-for-like
 * pairs: grok-atlas (xAI's own voice) and wan27-atlas (a 2.7-class model)
 * have no mirror, so an Atlas outage parks those tiers rather than silently
 * downgrading them.
 */
const TIER_MIRRORS: Record<string, string> = {
  'italk-atlas': 'wavespeed-ai/infinitetalk',
  'wan22turbo-atlas': 'wavespeed-ai/wan-2.2/i2v-720p',
}

/** The Wavespeed endpoint that mirrors a tier, or null when none does. */
export function wavespeedMirrorFor(tierId: string): string | null {
  return TIER_MIRRORS[tierId] ?? null
}

function adapterFor(modelId: string): WavespeedModelAdapter | null {
  return MODEL_ADAPTERS[TIER_MIRRORS[modelId] ?? modelId] ?? null
}

/** Build the submit body. Pure; exported for tests. Accepts a tier id or a Wavespeed model id. */
export function buildWavespeedVideoBody(modelId: string, input: VideoGenInput): { model: string; body: Record<string, unknown> } {
  const a = adapterFor(modelId)
  if (!a) throw new Error(`[wavespeed-video] no Wavespeed endpoint for "${modelId}"`)
  if (!input.imageUrl) throw new Error(`[wavespeed-video] ${a.model} requires imageUrl`)
  if (a.audioDriven && !input.audioUrl) throw new Error(`[wavespeed-video] ${a.model} is audio-driven and requires audioUrl`)
  return { model: a.model, body: a.body(input) }
}

const PREDICTION_ID_RE = /^[A-Za-z0-9_-]{6,128}$/

/** Handle URLs are built from the id, never taken from the response (the key goes to statusUrl). */
function handleFor(id: string): VideoQueueHandle {
  if (!PREDICTION_ID_RE.test(id)) throw new Error(`[wavespeed-video] unexpected prediction id "${id.slice(0, 80)}"`)
  const url = `${WAVESPEED_API.base}${WAVESPEED_API.resultPath(id)}`
  return { requestId: id, statusUrl: url, responseUrl: url }
}

export async function submitWavespeedVideo(modelId: string, input: VideoGenInput): Promise<VideoQueueHandle> {
  const key = requireKey()
  const { model, body } = buildWavespeedVideoBody(modelId, input)
  const res = await fetch(`${WAVESPEED_API.base}${WAVESPEED_API.submitPath(model)}`, {
    method: 'POST',
    headers: headers(key, true),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`wavespeed ${model} submit error: ${res.status} ${text.slice(0, 400)}`)
  }
  const json = await res.json() as { code?: number; message?: string; data?: { id?: string } }
  if (typeof json.code === 'number' && json.code >= 400) {
    throw new Error(`wavespeed ${model} submit error: ${json.code} ${json.message ?? ''}`.trim())
  }
  const id = json.data?.id
  if (!id) throw new Error(`wavespeed ${model} submit response missing data.id`)
  return handleFor(id)
}

interface WavespeedPrediction {
  status?: string
  outputs?: string[] | null
  error?: unknown
}

async function getPrediction(handle: VideoQueueHandle): Promise<{ http: number; data: WavespeedPrediction | null; text: string }> {
  const key = requireKey()
  const res = await fetch(handleFor(handle.requestId).statusUrl, { headers: headers(key) })
  if (!res.ok) return { http: res.status, data: null, text: await res.text().catch(() => '') }
  const json = await res.json() as { data?: WavespeedPrediction }
  return { http: res.status, data: json.data ?? (json as WavespeedPrediction), text: '' }
}

export async function getWavespeedVideoStatus(handle: VideoQueueHandle): Promise<VideoStatusResult> {
  const { http, data, text } = await getPrediction(handle)
  if (!data) {
    if (http === 429 || http >= 500) return { status: 'IN_PROGRESS' }
    throw new Error(`wavespeed prediction ${handle.requestId} status error: ${http} ${text.slice(0, 300)}`)
  }
  const s = (data.status ?? '').toLowerCase()
  if (s === 'completed' || s === 'succeeded') return { status: 'COMPLETED' }
  if (s === 'failed') {
    const msg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error ?? '')
    return { status: 'FAILED', error: `wavespeed: ${(msg || 'failed with no message').slice(0, 400)}` }
  }
  if (s === 'created' || s === 'queued') return { status: 'IN_QUEUE' }
  return { status: 'IN_PROGRESS' }
}

export async function getWavespeedVideoResult(handle: VideoQueueHandle): Promise<VideoGenResult> {
  const { http, data, text } = await getPrediction(handle)
  if (!data) throw new Error(`wavespeed prediction ${handle.requestId} result error: ${http} ${text.slice(0, 300)}`)
  const s = (data.status ?? '').toLowerCase()
  if (s !== 'completed' && s !== 'succeeded') {
    throw new Error(`wavespeed prediction ${handle.requestId} is not complete (status ${data.status ?? 'none'})`)
  }
  const url = (data.outputs ?? []).find((u): u is string => typeof u === 'string' && !!u)
  if (!url) throw new Error(`wavespeed prediction ${handle.requestId} completed with no outputs`)
  return { videoUrl: url, contentType: 'video/mp4' }
}

export const wavespeedVideoProvider: VideoProvider = {
  id: 'wavespeed',
  supportsAudioDriven: true,
  configured: () => wavespeedConfigured(),
  supportsModel: (modelId: string) => adapterFor(modelId) != null,
  ownsHandle: (handle: VideoQueueHandle) => handle.statusUrl.startsWith(`${WAVESPEED_API.base}/`),
  submit: (modelId, input) => submitWavespeedVideo(modelId, input),
  status: (handle) => getWavespeedVideoStatus(handle),
  result: (handle) => getWavespeedVideoResult(handle),
}
