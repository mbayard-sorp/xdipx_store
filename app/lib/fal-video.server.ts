/**
 * fal.ai VIDEO client — queue API only. Image generation stays in fal.server.ts
 * (sync endpoint); this file owns the async video models plus the scene-frame
 * composition step that precedes every video spend.
 *
 * Queue protocol (https://fal.ai/docs/model-apis):
 *   POST https://queue.fal.run/{model}            -> { request_id, status_url, response_url }
 *   GET  {status_url}                             -> { status: IN_QUEUE|IN_PROGRESS|COMPLETED|... }
 *   GET  {response_url}                           -> model output (video.url etc)
 * We persist status_url/response_url from the submit response rather than
 * reconstructing them — nested model ids route status through the model's root
 * namespace and hand-built URLs get that wrong.
 *
 * fal-hosted output URLs live ~24h; download promptly and re-home to Blob.
 */

const FAL_QUEUE_ENDPOINT = 'https://queue.fal.run'
const FAL_SYNC_ENDPOINT = 'https://fal.run'

function requireKey(): string {
  const key = process.env['FAL_KEY']
  if (!key) throw new Error('FAL_KEY env var is required for fal.ai calls')
  return key
}

export function falVideoConfigured(): boolean {
  return !!process.env['FAL_KEY']?.trim()
}

// ---------------------------------------------------------------------------
// Model registry. Rates are approximate list prices (2026-07); adjust here when
// fal reprices. costKey must have a matching entry in model-pricing VIDEO_RATES.
// ---------------------------------------------------------------------------

export type VideoModelId = 'veo31' | 'veo31-fast' | 'kling25-pro' | 'seedance2' | 'omnihuman'

export interface VideoModelSpec {
  /** fal queue endpoint path. */
  falModel: string
  label: string
  tier: 'premium' | 'premium-fast' | 'standard' | 'avatar'
  /** Cost key understood by model-pricing VIDEO_RATES. */
  costKey: string
  ratePerSecondUsd: number
  /**
   * Whether the OUTPUT carries audio without a mux step. For generative models
   * that means the model invents dialogue/ambient; for audio-driven models it
   * means the input speech track is already embedded. Either way the lipsync
   * stage must not stomp it.
   */
  nativeAudio: boolean
  /**
   * Audio-first model: consumes a speech track (audio_url) plus ONE identity
   * frame and performs it. Video length = audio length, so allowedDurations
   * does not apply (kept empty) and duration validation is skipped.
   */
  audioDriven?: boolean
  /** Durations the model accepts, seconds. Empty for audio-driven models. */
  allowedDurations: number[]
}

export const VIDEO_MODELS: Record<VideoModelId, VideoModelSpec> = {
  'veo31': {
    falModel: 'fal-ai/veo3.1/image-to-video',
    label: 'Veo 3.1 (native audio)',
    tier: 'premium',
    costKey: 'fal/veo3.1',
    ratePerSecondUsd: 0.40,
    nativeAudio: true,
    allowedDurations: [4, 6, 8],
  },
  'veo31-fast': {
    falModel: 'fal-ai/veo3.1/fast/image-to-video',
    label: 'Veo 3.1 Fast (native audio)',
    tier: 'premium-fast',
    costKey: 'fal/veo3.1-fast',
    ratePerSecondUsd: 0.15,
    nativeAudio: true,
    allowedDurations: [4, 6, 8],
  },
  'kling25-pro': {
    falModel: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
    label: 'Kling 2.5 Turbo Pro',
    tier: 'standard',
    costKey: 'fal/kling-2.5-pro',
    ratePerSecondUsd: 0.07,
    nativeAudio: false,
    allowedDurations: [5, 10],
  },
  'seedance2': {
    falModel: 'bytedance/seedance-2.0/image-to-video',
    label: 'Seedance 2.0 (audio included)',
    tier: 'standard',
    costKey: 'fal/seedance-2.0',
    ratePerSecondUsd: 0.31,
    nativeAudio: true,
    allowedDurations: [4, 5, 6, 8, 10, 12],
  },
  // Talking heads are AUDIO-FIRST (proven 2026-07-24): TTS speech track + one
  // approved identity frame -> performed video. Never route talking heads
  // through Kling/LTX + sync-lipsync. 30s input-audio cap per render; longer
  // scripts split at beat boundaries and both halves render from the SAME frame.
  'omnihuman': {
    falModel: 'fal-ai/bytedance/omnihuman/v1.5',
    label: 'OmniHuman 1.5 (audio-driven avatar)',
    tier: 'avatar',
    costKey: 'fal/omnihuman-1.5',
    ratePerSecondUsd: 0.16,
    nativeAudio: true,
    audioDriven: true,
    allowedDurations: [],
  },
}

export function isVideoModelId(v: unknown): v is VideoModelId {
  return typeof v === 'string' && v in VIDEO_MODELS
}

// ---------------------------------------------------------------------------
// Queue client
// ---------------------------------------------------------------------------

export interface QueueHandle {
  requestId: string
  statusUrl: string
  responseUrl: string
}

export type QueueStatus = 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'

export interface VideoRequestInput {
  prompt: string
  /** Publicly fetchable first-frame / reference image. */
  imageUrl: string
  durationSeconds: number
  /** 9:16 for the social master; models that take enums map internally. */
  aspect?: '9:16' | '16:9'
  generateAudio?: boolean
  negativePrompt?: string
  /** Speech track URL for audio-driven models (fal storage or other fetchable URL). */
  audioUrl?: string
}

/** Build the per-model input body. Each model family names params differently. */
function buildInput(model: VideoModelId, input: VideoRequestInput): Record<string, unknown> {
  const aspect = input.aspect ?? '9:16'
  switch (model) {
    case 'veo31':
    case 'veo31-fast':
      return {
        prompt: input.prompt,
        image_url: input.imageUrl,
        duration: `${input.durationSeconds}s`,
        aspect_ratio: aspect,
        resolution: '1080p',
        generate_audio: input.generateAudio ?? true,
        ...(input.negativePrompt ? { negative_prompt: input.negativePrompt } : {}),
      }
    case 'kling25-pro':
      return {
        prompt: input.prompt,
        image_url: input.imageUrl,
        duration: String(input.durationSeconds),
        ...(input.negativePrompt ? { negative_prompt: input.negativePrompt } : {}),
      }
    case 'seedance2':
      return {
        prompt: input.prompt,
        image_url: input.imageUrl,
        duration: input.durationSeconds,
        aspect_ratio: aspect,
        resolution: '720p',
        ...(input.negativePrompt ? { negative_prompt: input.negativePrompt } : {}),
      }
    case 'omnihuman':
      // Audio-first: no prompt, no duration. Video length = audio length.
      return {
        image_url: input.imageUrl,
        audio_url: input.audioUrl,
      }
  }
}

export async function submitVideoRequest(model: VideoModelId, input: VideoRequestInput): Promise<QueueHandle> {
  const key = requireKey()
  const spec = VIDEO_MODELS[model]
  if (spec.audioDriven) {
    if (!input.audioUrl) throw new Error(`${model} is audio-driven and requires audioUrl`)
  } else if (!spec.allowedDurations.includes(input.durationSeconds)) {
    throw new Error(`${model} does not support duration ${input.durationSeconds}s (allowed: ${spec.allowedDurations.join(', ')})`)
  }
  const res = await fetch(`${FAL_QUEUE_ENDPOINT}/${spec.falModel}`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildInput(model, input)),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`fal queue submit ${spec.falModel} error: ${res.status} ${text.slice(0, 400)}`)
  }
  const json = await res.json() as { request_id?: string; status_url?: string; response_url?: string }
  if (!json.request_id || !json.status_url || !json.response_url) {
    throw new Error(`fal queue submit ${spec.falModel} response missing request_id/status_url/response_url`)
  }
  return { requestId: json.request_id, statusUrl: json.status_url, responseUrl: json.response_url }
}

export async function getVideoRequestStatus(handle: QueueHandle): Promise<{ status: QueueStatus }> {
  const key = requireKey()
  const res = await fetch(handle.statusUrl, { headers: { 'Authorization': `Key ${key}` } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`fal queue status error: ${res.status} ${text.slice(0, 400)}`)
  }
  const json = await res.json() as { status?: string }
  const status = json.status
  if (status === 'IN_QUEUE' || status === 'IN_PROGRESS' || status === 'COMPLETED') return { status }
  // fal reports terminal failures under a few labels; collapse to FAILED.
  return { status: 'FAILED' }
}

export interface VideoResult {
  videoUrl: string
  contentType: string
}

export async function getVideoRequestResult(handle: QueueHandle): Promise<VideoResult> {
  const key = requireKey()
  const res = await fetch(handle.responseUrl, { headers: { 'Authorization': `Key ${key}` } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`fal queue result error: ${res.status} ${text.slice(0, 400)}`)
  }
  const json = await res.json() as { video?: { url?: string; content_type?: string } }
  const url = json.video?.url
  if (!url) throw new Error('fal queue result missing video.url')
  return { videoUrl: url, contentType: json.video?.content_type ?? 'video/mp4' }
}

/** Download a fal-hosted asset (ephemeral ~24h) into a Buffer. */
export async function downloadFalAsset(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fal asset download failed: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * Upload a buffer to fal storage (initiate -> PUT -> file_url). Audio-driven
 * models need their speech track on a fal-fetchable URL; Blob URLs work too,
 * but fal storage keeps the input in-house and avoids public exposure.
 */
export async function uploadToFalStorage(buf: Buffer, contentType: string, fileName: string): Promise<string> {
  const key = requireKey()
  const init = await fetch('https://rest.alpha.fal.ai/storage/upload/initiate', {
    method: 'POST',
    headers: { 'Authorization': `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_type: contentType, file_name: fileName }),
  })
  if (!init.ok) {
    const text = await init.text().catch(() => '')
    throw new Error(`fal storage initiate error: ${init.status} ${text.slice(0, 200)}`)
  }
  const j = await init.json() as { upload_url?: string; file_url?: string }
  if (!j.upload_url || !j.file_url) throw new Error('fal storage initiate response missing upload_url/file_url')
  const put = await fetch(j.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: new Uint8Array(buf),
  })
  if (!put.ok) throw new Error(`fal storage PUT error: ${put.status}`)
  return j.file_url
}

// ---------------------------------------------------------------------------
// Scene-frame composition — the drift guard. Composes the presenter (Emma or a
// cast member reference photo) together with the REAL product photo into one
// 9:16 still via nano-banana multi-image edit. The chosen frame becomes the
// image-to-video first frame, so the expensive video generation starts from an
// already-correct scene instead of inventing one.
// ---------------------------------------------------------------------------

const SCENE_FRAME_MODEL = 'fal-ai/nano-banana/edit'
export const SCENE_FRAME_COST_KEY = 'fal/nano-banana'

export interface ComposeSceneFrameOpts {
  /** Scene direction. Product prominence and grounds come from the caller's prompt scaffold. */
  prompt: string
  /** Canonical presenter reference photo (Emma or castMember), publicly fetchable. */
  presenterImageUrl: string
  /** Real Shopify product photo, publicly fetchable. Omitted for talking-head frames, which never include the product. */
  productImageUrl?: string
  /** Candidate count (default 3, capped 4). */
  count?: number
}

export interface SceneFrameResult {
  /** fal-hosted candidate URLs (~24h TTL). Persist via downloadFalAsset + Blob promptly. */
  urls: string[]
  costKey: string
}

export async function composeSceneFrame(opts: ComposeSceneFrameOpts): Promise<SceneFrameResult> {
  const key = requireKey()
  const count = Math.min(Math.max(1, opts.count ?? 3), 4)
  const res = await fetch(`${FAL_SYNC_ENDPOINT}/${SCENE_FRAME_MODEL}`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: opts.prompt,
      image_urls: [opts.presenterImageUrl, ...(opts.productImageUrl ? [opts.productImageUrl] : [])],
      num_images: count,
      aspect_ratio: '9:16',
      output_format: 'jpeg',
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`fal.ai ${SCENE_FRAME_MODEL} error: ${res.status} ${text.slice(0, 400)}`)
  }
  const json = await res.json() as { images?: { url?: string }[] }
  const urls = (json.images ?? []).map(i => i.url).filter((u): u is string => !!u)
  if (!urls.length) throw new Error(`fal.ai ${SCENE_FRAME_MODEL} returned no images`)
  return { urls, costKey: SCENE_FRAME_COST_KEY }
}
