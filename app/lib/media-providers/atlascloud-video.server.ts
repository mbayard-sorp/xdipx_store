/**
 * Atlas Cloud VIDEO adapter for the media-provider seam (ADR-016, 2026-09-23).
 *
 * Written from the live bake-off capture (docs/media-model-routing.md, section
 * "Atlas video bake-off 2026-09-23"), not from the docs pages:
 *
 *   Submit: POST {ATLAS_BASE}/model/generateVideo, flat JSON {model, ...params}.
 *           Same endpoint for every video model; `model` selects the backend.
 *           -> {code:200, data:{id, status:"processing", outputs:null, urls:{get}}}
 *   Poll:   GET  {ATLAS_BASE}/model/prediction/{id}
 *           data.status observed: processing, pending, completed. Documented:
 *           created, queued, processing, completed, succeeded, failed.
 *           InfiniteTalk reports `pending` AFTER processing, near the end, so
 *           anything that is not completed|succeeded|failed counts as running.
 *   Upload: POST {ATLAS_BASE}/model/uploadMedia, multipart field `file`
 *           -> data.download_url (public aliyuncs URL usable as image/audio input)
 *   Unknown model id: HTTP 400 {"code":400,"msg":"not found"}, no charge.
 *   Output: data.outputs[0], an aliyuncs mp4 that expires. The pipeline downloads
 *           and blobPuts it in the SAME poller tick that sees COMPLETED.
 *
 * submit() returns immediately with the prediction id; it never polls in
 * process (unlike the still-image client in app/lib/atlas.server.ts, whose
 * renders finish in ~30 s). A 10 s InfiniteTalk clip took 203 to 237 s wall.
 *
 * Input URLs: every bake-off request used uploadMedia URLs, so direct Blob URLs
 * are NOT proven for the video models (the still-image edit endpoint does accept
 * arbitrary public URLs, verified 2026-08-15). This adapter passes public https
 * URLs straight through and falls back to uploadMedia once when a submit is
 * rejected with a 4xx that is neither a content block nor an unknown model.
 * Non-https inputs (data: URIs) are always uploaded first.
 *
 * Server-only.
 */
import {
  ATLAS_BASE,
  atlasConfigured,
  atlasHeaders,
  classifyAtlasBlock,
  recordAtlasBlock,
  requireAtlasKey,
} from '~/lib/atlas.server'
import { VIDEO_MODELS, isVideoModelId } from '~/lib/fal-video.server'
import type {
  VideoGenInput,
  VideoGenResult,
  VideoProvider,
  VideoQueueHandle,
  VideoStatusResult,
} from './types'

/** Why a submit failed. The registry's mirror rule keys on this. */
export type AtlasSubmitFailureKind = 'content' | 'balance' | 'unknown_model' | 'rejected' | 'server'

export class AtlasVideoSubmitError extends Error {
  readonly kind: AtlasSubmitFailureKind
  readonly httpStatus: number
  constructor(kind: AtlasSubmitFailureKind, httpStatus: number, message: string) {
    super(message)
    this.name = 'AtlasVideoSubmitError'
    this.kind = kind
    this.httpStatus = httpStatus
  }
}

/**
 * Balance or credit exhaustion. The wording is UNVERIFIED (no exhaustion was
 * observed); 402 plus the usual vocabulary is the best available signal. A
 * miss here is harmless: every non-content submit error already fails over to
 * the mirror.
 */
export function isAtlasBalanceExhausted(status: number, body: string): boolean {
  if (status === 402) return true
  return /insufficient|balance|out of credit|no credit|credits? (?:exhausted|depleted)|recharge|top.?up|payment required/i.test(body)
}

function classifySubmitFailure(status: number, body: string): AtlasSubmitFailureKind {
  // Exactly the bake-off's unknown-model envelope. A looser "not found" match
  // would swallow an input-URL fetch failure, which should retry via upload.
  if (status === 400 && /"msg"\s*:\s*"not found"/i.test(body)) return 'unknown_model'
  if (isAtlasBalanceExhausted(status, body)) return 'balance'
  // A 4xx that the shared classifier reads as a refusal. 422 with no content
  // signal counts as a refusal there, matching fal and the image path.
  if (status >= 400 && status < 500 && classifyAtlasBlock(status, body).reason === 'content_policy') return 'content'
  if (status >= 500 || status === 429) return 'server'
  return 'rejected'
}

/* ─── Per-model request bodies (shapes copied from the bake-off capture) ── */

type BodyBuilder = (atlasModel: string, input: VideoGenInput) => Record<string, unknown>

/**
 * The spoken-line clause for Grok, which has no dialogue field. Wording from
 * the bake-off, where the line was spoken verbatim in both runs.
 */
export function grokSpokenLineClause(line: string): string {
  return `She looks into the lens and says: "${line.replace(/"/g, "'").trim()}"`
}

const BODY_BUILDERS: Record<string, BodyBuilder> = {
  // {model, image, audio, prompt, resolution:"720p", seed}. Output length = audio length.
  'atlascloud/infinitetalk': (model, input) => ({
    model,
    image: input.imageUrl,
    audio: input.audioUrl,
    ...(input.prompt ? { prompt: input.prompt } : {}),
    resolution: '720p',
    seed: -1,
  }),
  // {model, prompt, image_url, duration, resolution:"720p", aspect_ratio:"9:16"}.
  // No dialogue field: the gated line rides inside the prompt.
  'xai/grok-imagine-video-v1.5/image-to-video': (model, input) => ({
    model,
    prompt: input.spokenLine?.trim()
      ? `${input.prompt.trim()} ${grokSpokenLineClause(input.spokenLine)}`.trim()
      : input.prompt,
    image_url: input.imageUrl,
    duration: input.durationSeconds,
    resolution: '720p',
    aspect_ratio: input.aspect ?? '9:16',
  }),
  // Uppercase "720P"; prompt_extend off so the brief is not rewritten.
  'alibaba/wan-2.7/image-to-video': (model, input) => ({
    model,
    image: input.imageUrl,
    prompt: input.prompt,
    ...(input.negativePrompt ? { negative_prompt: input.negativePrompt } : {}),
    resolution: '720P',
    duration: input.durationSeconds,
    prompt_extend: false,
    seed: -1,
  }),
  // Duration is 5 only.
  'atlascloud/wan-2.2-turbo/image-to-video': (model, input) => ({
    model,
    image: input.imageUrl,
    prompt: input.prompt,
    ...(input.negativePrompt ? { negative_prompt: input.negativePrompt } : {}),
    resolution: '720p',
    duration: input.durationSeconds,
    seed: -1,
  }),
}

/** Atlas model id for a store tier id, or null when the tier is not an Atlas tier. */
export function atlasModelFor(tierId: string): string | null {
  if (!isVideoModelId(tierId)) return null
  const spec = VIDEO_MODELS[tierId]
  if (spec.provider !== 'atlascloud' || !spec.providerModel) return null
  return BODY_BUILDERS[spec.providerModel] ? spec.providerModel : null
}

/** Build the exact submit body for a tier. Pure; exported for tests. */
export function buildAtlasVideoBody(tierId: string, input: VideoGenInput): Record<string, unknown> {
  const atlasModel = atlasModelFor(tierId)
  if (!atlasModel) throw new Error(`[atlascloud-video] "${tierId}" is not an Atlas video tier`)
  const spec = VIDEO_MODELS[tierId as keyof typeof VIDEO_MODELS]
  if (!input.imageUrl) throw new Error(`${tierId} requires imageUrl (the approved frame)`)
  if (spec.audioDriven) {
    if (!input.audioUrl) throw new Error(`${tierId} is audio-driven and requires audioUrl`)
  } else if (!spec.allowedDurations.includes(input.durationSeconds)) {
    throw new Error(`${tierId} does not support duration ${input.durationSeconds}s (allowed: ${spec.allowedDurations.join(', ')})`)
  }
  return BODY_BUILDERS[atlasModel]!(atlasModel, input)
}

/* ─── Upload (uploadMedia) ────────────────────────────────────────────── */

function guessContentType(url: string, kind: 'image' | 'audio'): string {
  const m = /^data:([^;,]+)/.exec(url)
  if (m) return m[1]!
  if (kind === 'audio') return /\.wav(\?|$)/i.test(url) ? 'audio/wav' : 'audio/mpeg'
  return /\.png(\?|$)/i.test(url) ? 'image/png' : 'image/jpeg'
}

async function readInput(url: string): Promise<Buffer> {
  const dataUri = /^data:[^;,]+;base64,(.*)$/s.exec(url)
  if (dataUri) return Buffer.from(dataUri[1]!, 'base64')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`[atlascloud-video] could not read input for upload: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/** Upload one input to Atlas storage; returns the public download_url. */
export async function atlasUploadMedia(url: string, kind: 'image' | 'audio'): Promise<string> {
  const key = requireAtlasKey()
  const buf = await readInput(url)
  const contentType = guessContentType(url, kind)
  const ext = contentType.split('/')[1]?.replace('mpeg', 'mp3') ?? 'bin'
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(buf)], { type: contentType }), `${kind}.${ext}`)
  const res = await fetch(`${ATLAS_BASE}/model/uploadMedia`, {
    method: 'POST',
    headers: atlasHeaders(key),
    body: form,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`[atlascloud-video] uploadMedia ${kind} error: ${res.status} ${text.slice(0, 300)}`)
  }
  const json = await res.json() as { data?: { download_url?: string } }
  const out = json.data?.download_url
  if (!out) throw new Error('[atlascloud-video] uploadMedia response missing data.download_url')
  return out
}

async function rehostInputs(input: VideoGenInput, force: boolean): Promise<VideoGenInput> {
  const needs = (u: string | undefined) => !!u && (force || !/^https:\/\//i.test(u))
  return {
    ...input,
    imageUrl: needs(input.imageUrl) ? await atlasUploadMedia(input.imageUrl, 'image') : input.imageUrl,
    ...(input.audioUrl
      ? { audioUrl: needs(input.audioUrl) ? await atlasUploadMedia(input.audioUrl, 'audio') : input.audioUrl }
      : {}),
  }
}

/* ─── Submit / status / result ────────────────────────────────────────── */

const PREDICTION_ID_RE = /^[A-Za-z0-9_-]{6,128}$/

/**
 * Handle URLs are built from the id, never taken from the response's
 * `urls.get`: the poller sends the bearer key to statusUrl, so a response that
 * named a foreign host must not be able to redirect the key.
 */
function handleFor(id: string): VideoQueueHandle {
  if (!PREDICTION_ID_RE.test(id)) throw new Error(`[atlascloud-video] unexpected prediction id "${id.slice(0, 80)}"`)
  const url = `${ATLAS_BASE}/model/prediction/${id}`
  return { requestId: id, statusUrl: url, responseUrl: url }
}

async function postGenerate(key: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${ATLAS_BASE}/model/generateVideo`, {
    method: 'POST',
    headers: atlasHeaders(key, true),
    body: JSON.stringify(body),
  })
}

export async function submitAtlasVideo(tierId: string, input: VideoGenInput): Promise<VideoQueueHandle> {
  const key = requireAtlasKey()
  const atlasModel = atlasModelFor(tierId) ?? tierId
  let prepared = await rehostInputs(input, false)
  let res = await postGenerate(key, buildAtlasVideoBody(tierId, prepared))
  let text = res.ok ? '' : await res.text().catch(() => '')

  if (!res.ok && res.status >= 400 && res.status < 500 && classifySubmitFailure(res.status, text) === 'rejected') {
    // Direct URLs were refused (the untested half of the input contract). One
    // retry through uploadMedia; a rejected submit is not billed.
    prepared = await rehostInputs(input, true)
    res = await postGenerate(key, buildAtlasVideoBody(tierId, prepared))
    text = res.ok ? '' : await res.text().catch(() => '')
  }

  if (!res.ok) {
    const kind = classifySubmitFailure(res.status, text)
    if (kind === 'content') await recordAtlasBlock(atlasModel, res.status, text, 1, { caller: 'video-pipeline', feature: 'video-clip' })
    throw new AtlasVideoSubmitError(kind, res.status, `atlas ${atlasModel} submit error (${kind}): ${res.status} ${text.slice(0, 400)}`)
  }
  const json = await res.json() as { code?: number; msg?: string; message?: string; data?: { id?: string } }
  // Atlas sometimes answers HTTP 200 with an error envelope in `code`.
  if (typeof json.code === 'number' && json.code >= 400) {
    const msg = json.msg ?? json.message ?? JSON.stringify(json).slice(0, 400)
    const kind = classifySubmitFailure(json.code, msg)
    if (kind === 'content') await recordAtlasBlock(atlasModel, json.code, msg, 1, { caller: 'video-pipeline', feature: 'video-clip' })
    throw new AtlasVideoSubmitError(kind, json.code, `atlas ${atlasModel} submit error (${kind}): ${json.code} ${msg}`)
  }
  const id = json.data?.id
  // A 200 with no id is ambiguous (the render may have been accepted), so it is
  // a plain Error, which the registry never mirrors.
  if (!id) throw new Error(`atlas ${atlasModel} submit response missing data.id`)
  return handleFor(id)
}

interface AtlasPredictionData {
  id?: string
  model?: string
  status?: string
  outputs?: string[] | null
  error?: unknown
}

async function getPrediction(handle: VideoQueueHandle): Promise<{ http: number; data: AtlasPredictionData | null; text: string }> {
  const key = requireAtlasKey()
  const res = await fetch(handleFor(handle.requestId).statusUrl, { headers: atlasHeaders(key) })
  if (!res.ok) return { http: res.status, data: null, text: await res.text().catch(() => '') }
  const json = await res.json() as { data?: AtlasPredictionData }
  return { http: res.status, data: json.data ?? (json as AtlasPredictionData), text: '' }
}

function errorText(err: unknown): string {
  if (typeof err === 'string') return err
  if (err == null) return ''
  return JSON.stringify(err)
}

export async function getAtlasVideoStatus(handle: VideoQueueHandle): Promise<VideoStatusResult> {
  const { http, data, text } = await getPrediction(handle)
  if (!data) {
    // 429/5xx is transient: the prediction is still running on their side.
    if (http === 429 || http >= 500) return { status: 'IN_PROGRESS' }
    throw new Error(`atlas prediction ${handle.requestId} status error: ${http} ${text.slice(0, 300)}`)
  }
  const s = (data.status ?? '').toLowerCase()
  if (s === 'completed' || s === 'succeeded') return { status: 'COMPLETED' }
  if (s === 'failed') {
    const message = errorText(data.error) || 'failed with no message'
    // Synthetic 500, not 422: a failed video render is often a GPU/runtime
    // fault, and 422 would read every failure as a refusal. Content wording
    // still classifies as content_policy through the shared patterns.
    await recordAtlasBlock(data.model ?? 'atlascloud/video', 500, message, 1, { caller: 'video-pipeline', feature: 'video-clip' })
    return { status: 'FAILED', error: `atlas: ${message.slice(0, 400)}` }
  }
  if (s === 'created' || s === 'queued') return { status: 'IN_QUEUE' }
  // processing, pending (InfiniteTalk reports it after processing), or any
  // value not yet seen: still running.
  return { status: 'IN_PROGRESS' }
}

export async function getAtlasVideoResult(handle: VideoQueueHandle): Promise<VideoGenResult> {
  const { http, data, text } = await getPrediction(handle)
  if (!data) throw new Error(`atlas prediction ${handle.requestId} result error: ${http} ${text.slice(0, 300)}`)
  const s = (data.status ?? '').toLowerCase()
  if (s !== 'completed' && s !== 'succeeded') {
    throw new Error(`atlas prediction ${handle.requestId} is not complete (status ${data.status ?? 'none'})`)
  }
  const url = (data.outputs ?? []).find((u): u is string => typeof u === 'string' && !!u)
  if (!url) throw new Error(`atlas prediction ${handle.requestId} completed with no outputs`)
  return { videoUrl: url, contentType: 'video/mp4' }
}

export const atlascloudVideoProvider: VideoProvider = {
  id: 'atlascloud',
  // InfiniteTalk: image + ElevenLabs speech track -> performed clip.
  supportsAudioDriven: true,
  configured: () => atlasConfigured(),
  supportsModel: (modelId: string) => atlasModelFor(modelId) != null,
  ownsHandle: (handle: VideoQueueHandle) => handle.statusUrl.startsWith(`${ATLAS_BASE}/`),
  submit: (modelId, input) => submitAtlasVideo(modelId, input),
  status: (handle) => getAtlasVideoStatus(handle),
  result: (handle) => getAtlasVideoResult(handle),
}
