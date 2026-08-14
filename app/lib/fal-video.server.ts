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

import { recordFalBlock } from '~/lib/fal.server'

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
// cast member reference photo) together with the REAL product into one 9:16
// still. The chosen frame becomes the image-to-video first frame, so the
// expensive video generation starts from an already-correct scene instead of
// inventing one.
//
// TWO STAGES, for two measured reasons (bake-off 2026-08-10, see
// docs/media-model-routing.md):
//
//  1. Stage 1 renders a clean PRODUCT PLATE. Shopify packshots routinely include
//     the retail carton, and a one-shot composite puts the BOX in the
//     presenter's hand with the manufacturer's brand name legible on it, which
//     breaks the no-text-in-pixels rule and ships a competitor's logo. Isolating
//     the bare product first removed that failure class outright.
//  2. Stage 2 composites on FLUX.2 [dev] edit. The previous model here,
//     `fal-ai/nano-banana/edit`, is Gemini Flash Image behind a fal wrapper and
//     carries Google's non-configurable IMAGE_SAFETY output filter: it returned
//     422 content_policy for an ordinary catalog vibrator at EVERY
//     `safety_tolerance` from 6 down to 3, on both the raw packshot and a clean
//     plate. It could not render a large part of the catalog at all. FLUX.2 also
//     held the presenter's identity from a single reference photo, which the
//     alternatives did not.
//
// Talking-head frames pass no product and therefore skip stage 1 entirely.
// ---------------------------------------------------------------------------

/** Stage 1: isolate the real product onto a clean, packaging-free plate. */
const SCENE_PLATE_MODEL = 'fal-ai/qwen-image-edit-2511'
export const SCENE_PLATE_COST_KEY = 'fal/qwen-image-edit'

/** Stage 2: composite presenter + plate into the 9:16 candidate frames. */
const SCENE_FRAME_MODEL = 'fal-ai/flux-2/lora/edit'
export const SCENE_FRAME_COST_KEY = 'fal/flux-2-edit'

const PLATE_PROMPT =
  'Show only the bare product itself from the reference image, centered on a plain seamless ' +
  'neutral backdrop with bright high-key studio light and a crisp single shadow. Reproduce the ' +
  'product exactly: same shape, proportions, color, and finish. Remove all packaging, boxes, ' +
  'cartons, sleeves and inserts entirely. No text, no words, no letters, no watermark, no logo, ' +
  'no brand name.'

const PLATE_NEGATIVE =
  'packaging, retail box, carton, sleeve, insert, text, words, letters, watermark, logo, ' +
  'brand name, caption, second product, duplicate product'

/**
 * Stage-2 scale correction (ticket #2761). Stage 1 renders the plate centered
 * and large on a neutral field with no scale context, so stage 2 composites it
 * at roughly the plate's apparent size and the product reads oversized in the
 * presenter's hand (observed: a palm-sized sucking vibrator rendering
 * vase/watermelon-sized). The cue anchors the product to real-world proportion
 * relative to the person and their hand. It deliberately does NOT hard-code a
 * size ("palm-sized") — that would shrink a genuinely large product like a wand
 * — so the same cue reads correctly across products of different real sizes.
 * Appended only when a product is actually composited.
 */
const PRODUCT_SCALE_CUE =
  'Render the product at its true real-world size within the scene, scaled ' +
  'naturally relative to the person and their hand as a real object of its kind ' +
  'would be, neither enlarged nor shrunk to fill the frame. A handheld product ' +
  'sits in proportion within the hand and is not oversized.'

/**
 * Stage-2 output dimensions per caller-requested ratio. FLUX.2 edit takes explicit
 * pixel dimensions rather than fal's `aspect_ratio` string, so the ratio resolves
 * here. Pinning exact pixels also avoids the under-ratio drift the old
 * nano-banana path had ('4:5' came back 896x1152, which Instagram rejects as
 * taller than 4:5).
 */
const SCENE_FRAME_SIZES = {
  '9:16': { width: 1080, height: 1920 },
  '4:5': { width: 1080, height: 1350 },
  // Landscape Notebook hero (image-brief §0). The stage-2 model drifts ~1% off
  // requested pixels, so callers must resize to the exact target themselves.
  '4:3': { width: 1200, height: 900 },
} as const

export interface ComposeSceneFrameOpts {
  /** Scene direction. Product prominence and grounds come from the caller's prompt scaffold. */
  prompt: string
  /** Canonical presenter reference photo (Emma or castMember), publicly fetchable. */
  presenterImageUrl: string
  /** Real Shopify product photo, publicly fetchable. Omitted for talking-head frames, which never include the product. */
  productImageUrl?: string
  /** Additional publicly-fetchable reference images beyond presenter/product (e.g. a second product for a paired scene). */
  extraImageUrls?: string[]
  /** Candidate count (default 3, capped 4). */
  count?: number
  /** Frame ratio. Defaults to '9:16' (this function's original video-frame use); '4:5' for a feed/carousel still. */
  aspectRatio?: keyof typeof SCENE_FRAME_SIZES
}

export interface SceneFrameResult {
  /** fal-hosted candidate URLs (~24h TTL). Persist via downloadFalAsset + Blob promptly. */
  urls: string[]
  /** Stage-2 compositor model, billed once per returned candidate. */
  costKey: string
  /**
   * Stage-1 plate spend, when a plate was built. Separate from `costKey` because
   * it is a single image on a different model, and the caller owns cost logging.
   */
  plate?: { costKey: string; count: number }
}

/**
 * Stage 1. Returns a fal-hosted URL for the packaging-free product plate.
 * Throws on failure so the caller surfaces a composition error rather than
 * silently falling back to the packshot, which is what put boxes in frame.
 */
async function composeProductPlate(productImageUrl: string): Promise<string> {
  const key = requireKey()
  const res = await fetch(`${FAL_SYNC_ENDPOINT}/${SCENE_PLATE_MODEL}`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: PLATE_PROMPT,
      negative_prompt: PLATE_NEGATIVE,
      image_urls: [productImageUrl],
      num_images: 1,
      image_size: 'square_hd',
      enable_safety_checker: false,
      output_format: 'jpeg',
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    await recordFalBlock(SCENE_PLATE_MODEL, res.status, text, 1, {
      feature: 'video-frames', caller: 'composeProductPlate',
    })
    throw new Error(`fal.ai ${SCENE_PLATE_MODEL} error: ${res.status} ${text.slice(0, 400)}`)
  }
  const json = await res.json() as { images?: { url?: string }[] }
  const url = json.images?.[0]?.url
  if (!url) throw new Error(`fal.ai ${SCENE_PLATE_MODEL} returned no product plate`)
  return url
}

/**
 * Stage 2, one candidate. Returns a single fal-hosted composite URL, or throws.
 *
 * Each candidate is its own single-image request rather than one `num_images:N`
 * call (ticket #3045). A batched call re-interprets the shared stage-1 plate
 * independently per image, so two candidates from ONE run disagreed about the
 * product's silhouette and size — one faithful to the packshot, one a different
 * object. Re-anchoring each candidate in its own request holds the product
 * steadier across the set. Cost is unchanged: the compositor is billed per
 * returned candidate either way.
 */
async function composeOneSceneFrame(
  key: string,
  imageUrls: string[],
  prompt: string,
  imageSize: { readonly width: number; readonly height: number },
): Promise<string> {
  const res = await fetch(`${FAL_SYNC_ENDPOINT}/${SCENE_FRAME_MODEL}`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      image_urls: imageUrls,
      num_images: 1,
      image_size: imageSize,
      enable_safety_checker: false,
      output_format: 'jpeg',
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    await recordFalBlock(SCENE_FRAME_MODEL, res.status, text, 1, {
      feature: 'video-frames', caller: 'composeSceneFrame',
    })
    throw new Error(`fal.ai ${SCENE_FRAME_MODEL} error: ${res.status} ${text.slice(0, 400)}`)
  }
  const json = await res.json() as { images?: { url?: string }[] }
  const url = json.images?.[0]?.url
  if (!url) throw new Error(`fal.ai ${SCENE_FRAME_MODEL} returned no images`)
  return url
}

export async function composeSceneFrame(opts: ComposeSceneFrameOpts): Promise<SceneFrameResult> {
  const key = requireKey()
  const count = Math.min(Math.max(1, opts.count ?? 3), 4)

  // Stage 1. Skipped for talking-head frames (no product) and for the
  // no-presenter caller, which passes the product photo as its own base — there
  // is nothing to composite it against, so a plate would just be wasted spend.
  const needsPlate = !!opts.productImageUrl && opts.productImageUrl !== opts.presenterImageUrl
  const productRef = needsPlate ? await composeProductPlate(opts.productImageUrl!) : opts.productImageUrl

  // Anchor the composited product to real-world scale (ticket #2761). Applied
  // only to a genuine presenter+product composite (needsPlate): a talking-head
  // frame has no product, and the no-presenter base has no hand to scale against.
  const framePrompt = needsPlate ? `${opts.prompt} ${PRODUCT_SCALE_CUE}` : opts.prompt

  const imageUrls = [
    opts.presenterImageUrl,
    ...(productRef ? [productRef] : []),
    ...(opts.extraImageUrls ?? []),
  ]
  const imageSize = SCENE_FRAME_SIZES[opts.aspectRatio ?? '9:16']

  // Stage 2. One single-image request per candidate (ticket #3045), run in
  // parallel. A partial set is still useful for review, so tolerate individual
  // candidate failures and only throw when EVERY candidate failed.
  const settled = await Promise.allSettled(
    Array.from({ length: count }, () => composeOneSceneFrame(key, imageUrls, framePrompt, imageSize)),
  )
  const urls = settled
    .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
    .map(r => r.value)
  if (!urls.length) {
    const firstRejected = settled.find(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    )
    throw firstRejected?.reason instanceof Error
      ? firstRejected.reason
      : new Error(`fal.ai ${SCENE_FRAME_MODEL} returned no images`)
  }
  return {
    urls,
    costKey: SCENE_FRAME_COST_KEY,
    ...(needsPlate ? { plate: { costKey: SCENE_PLATE_COST_KEY, count: 1 } } : {}),
  }
}
