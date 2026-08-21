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

import sharp from 'sharp'
import { recordFalBlock, readFalRequestId } from '~/lib/fal.server'
import { atlasConfigured, atlasGenerate } from '~/lib/atlas.server'

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

export type VideoModelId = 'veo31' | 'veo31-fast' | 'kling25-pro' | 'seedance2' | 'grok' | 'omnihuman' | 'sync-lipsync'

export interface VideoModelSpec {
  /** fal queue endpoint path. */
  falModel: string
  label: string
  tier: 'premium' | 'premium-fast' | 'standard' | 'avatar' | 'lipsync'
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
   * The model writes and speaks its OWN dialogue, in a voice that is not Emma's,
   * with words no gate has read (veo31, veo31-fast, seedance2, grok). This is a
   * strict subset of `nativeAudio`: it is the INVENTED half. It exists because
   * `nativeAudio` conflates two opposite things — a model performing OUR authored
   * ElevenLabs track (audio-driven: keep it) versus a model inventing its own
   * (overdub or strip it). The lipsync stage keys on this to decide whether the
   * clip's audio may ship as-is. Never set together with `audioDriven`.
   */
  inventsDialogue?: boolean
  /**
   * Audio-first model: consumes a speech track (audio_url) plus ONE identity
   * frame and performs it. Video length = audio length, so allowedDurations
   * does not apply (kept empty) and duration validation is skipped.
   */
  audioDriven?: boolean
  /**
   * Compound talking tier (spec §5 Phase 3): the clip stage renders the base
   * model, then the lipsync stage submits THIS model with the finished clip +
   * a TTS speech track. allowedDurations mirrors the base clip model's.
   */
  lipsync?: { baseClip: VideoModelId }
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
    inventsDialogue: true,
    allowedDurations: [4, 6, 8],
  },
  'veo31-fast': {
    falModel: 'fal-ai/veo3.1/fast/image-to-video',
    label: 'Veo 3.1 Fast (native audio)',
    tier: 'premium-fast',
    costKey: 'fal/veo3.1-fast',
    ratePerSecondUsd: 0.15,
    nativeAudio: true,
    inventsDialogue: true,
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
    inventsDialogue: true,
    allowedDurations: [4, 5, 6, 8, 10, 12],
  },
  // Grok Imagine 1.5 (bake-off 2026-08-17, ticket #3991): cleared the content
  // filter 8/8 on real catalog product including a raw Shopify packshot, the
  // class nano-banana / fal-hosted Seedream reject with 422 content_policy.
  // ~$0.14/s at 720p (55% under Seedance), ~30s renders, native audio ALWAYS
  // on. The image-to-video schema accepts any integer duration 1-15 (no enum),
  // has no aspect_ratio / negative_prompt param, and audio is unconditional —
  // buildInput emits only { prompt, image_url, duration, resolution }. Because
  // there is no aspect_ratio and product fidelity tracks the input frame's
  // resolution, the clip stage asserts the 9:16 full-res frame contract before
  // submit (assertSceneFrameContract).
  'grok': {
    falModel: 'xai/grok-imagine-video/v1.5/image-to-video',
    label: 'Grok Imagine 1.5 (native audio)',
    tier: 'standard',
    costKey: 'fal/grok-imagine-1.5',
    ratePerSecondUsd: 0.14, // pinned to 720p (480p $0.08, 720p $0.14, 1080p $0.25)
    nativeAudio: true,
    inventsDialogue: true,
    allowedDurations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
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
  // Mid-price talking tier: Kling clip + TTS + sync lipsync (~$0.12/s all-in
  // vs OmniHuman's $0.16/s). The clip stage renders kling25-pro from the
  // approved frame; the lipsync stage performs the presenterLine onto it. The
  // OmniHuman comment above predates this tier: talking heads that need full
  // performance stay audio-first, but this tier is the sanctioned lipsync path
  // for shorter spoken lines on a standard-tier budget.
  'sync-lipsync': {
    falModel: 'fal-ai/sync-lipsync',
    label: 'Kling 2.5 Pro + Sync lipsync (talking standard tier)',
    tier: 'lipsync',
    costKey: 'fal/sync-lipsync',
    ratePerSecondUsd: 0.05,
    nativeAudio: false,
    lipsync: { baseClip: 'kling25-pro' },
    allowedDurations: [5, 10],
  },
}

export function isVideoModelId(v: unknown): v is VideoModelId {
  return typeof v === 'string' && v in VIDEO_MODELS
}

/**
 * What the lipsync stage does with a clip's audio, decided from the model spec
 * and whether the script carries voiceover text. Pure and exported so the
 * decision is unit-testable without a render.
 *
 *  - `authored`      the model's audio is OURS to keep: an audio-driven avatar
 *                    (OmniHuman) performing our ElevenLabs track, or a lipsync
 *                    compound tier. Muxing over it would stomp the performance.
 *  - `overdubbed`    a voiceover exists and the model's audio is not authored, so
 *                    Emma's ElevenLabs track REPLACES whatever the clip carried
 *                    (silent Kling OR an invented veo/seedance/grok track).
 *  - `stripped`      no voiceover, and the model invents its own dialogue. The
 *                    invented, non-Emma, ungated track must not ship, so it is
 *                    silenced.
 *  - `native-silent` no voiceover, and the model does not invent dialogue (Kling):
 *                    nothing to voice and nothing to strip.
 *
 * The bug this fixes: the old skip keyed on `nativeAudio`, which conflated
 * `authored` with `stripped`/`overdubbed`, so every veo/seedance/grok clip
 * skipped the mux and shipped model-invented speech on an owned channel.
 */
export type AudioPath = 'authored' | 'overdubbed' | 'stripped' | 'native-silent'

export function classifyAudioPath(spec: VideoModelSpec, hasVoiceover: boolean): AudioPath {
  if (spec.audioDriven || spec.lipsync) return 'authored'
  if (hasVoiceover) return 'overdubbed'
  if (spec.inventsDialogue) return 'stripped'
  return 'native-silent'
}

// ---------------------------------------------------------------------------
// Scene-frame contract for image-to-video submits (ticket #3991).
//
// Grok Imagine has no aspect_ratio param, so an image-to-video clip INHERITS
// the input frame's aspect ratio, and its product fidelity tracks the input
// frame's resolution. Bake-off evidence: a 464x688 re-encoded frame lost the
// product entirely by t=1.0s, while the same model from a clean 1584x2816 frame
// held it through 8s. So a degraded frame must fail BEFORE the paid submit, not
// after a wasted render. The frame is composed at 1080x1920 for 9:16
// (SCENE_FRAME_SIZES in this file), which is the full-resolution floor here.
// ---------------------------------------------------------------------------

/**
 * Acceptance floor for a 9:16 scene frame. The frame is composed at exactly
 * 1080x1920, but the stage-2 compositor drifts ~1% off requested pixels and the
 * stored frame is not resized, so the floor sits ~5% under the composed target:
 * it tolerates that drift while still rejecting the degraded class outright (the
 * bake-off's 464x688 frame is 43% of target and fails comfortably).
 */
export const SCENE_FRAME_MIN_WIDTH = 1024
export const SCENE_FRAME_MIN_HEIGHT = 1820
/** Aspect tolerance: the stage-2 compositor drifts ~1% off requested pixels. */
const SCENE_FRAME_ASPECT_TOLERANCE = 0.02

/**
 * Assert an image-to-video scene frame is 9:16 and at full resolution, throwing
 * a clear error otherwise. Pure and exported so the contract is unit-testable
 * without a network call or an image decode. (ticket #3991)
 */
export function assertSceneFrameContract(
  width: number | null | undefined,
  height: number | null | undefined,
): void {
  if (!width || !height || width <= 0 || height <= 0) {
    throw new Error(
      `scene frame has unknown dimensions (${width}x${height}); refusing to submit an image-to-video job on an unverifiable frame`,
    )
  }
  if (width < SCENE_FRAME_MIN_WIDTH || height < SCENE_FRAME_MIN_HEIGHT) {
    throw new Error(
      `scene frame ${width}x${height} is below full resolution (min ${SCENE_FRAME_MIN_WIDTH}x${SCENE_FRAME_MIN_HEIGHT}); a degraded frame loses the product in image-to-video`,
    )
  }
  const target = 9 / 16
  const ratio = width / height
  if (Math.abs(ratio - target) > SCENE_FRAME_ASPECT_TOLERANCE) {
    throw new Error(
      `scene frame ${width}x${height} is not 9:16 (ratio ${ratio.toFixed(3)}, expected ~${target.toFixed(3)}); image-to-video inherits the input aspect ratio`,
    )
  }
}

/** Probe the pixel dimensions of an encoded image buffer. */
export async function probeImageDimensions(buf: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(buf).metadata()
  return { width: meta.width ?? 0, height: meta.height ?? 0 }
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
  /** Source clip URL for lipsync models (fal storage or other fetchable URL). */
  videoUrl?: string
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
    case 'grok':
      // Grok's image-to-video schema (ticket #3991) takes ONLY these four:
      // no aspect_ratio (inherited from the input frame), no negative_prompt,
      // no generate_audio (native audio is unconditional). Resolution is pinned
      // to 720p so the per-second-only cost model stays correct.
      return {
        prompt: input.prompt,
        image_url: input.imageUrl,
        duration: input.durationSeconds,
        resolution: '720p',
      }
    case 'omnihuman':
      // Audio-first: no prompt, no duration. Video length = audio length.
      return {
        image_url: input.imageUrl,
        audio_url: input.audioUrl,
      }
    case 'sync-lipsync':
      // Video + audio in, lip-synced video out. cut_off ends the output at the
      // shorter track, pairing with the speech-fits-duration enqueue guard.
      return {
        video_url: input.videoUrl,
        audio_url: input.audioUrl,
        sync_mode: 'cut_off',
      }
  }
}

export async function submitVideoRequest(model: VideoModelId, input: VideoRequestInput): Promise<QueueHandle> {
  const key = requireKey()
  const spec = VIDEO_MODELS[model]
  if (spec.lipsync) {
    // Output length = the shorter input track; duration validation happened
    // when the base clip was submitted.
    if (!input.videoUrl) throw new Error(`${model} requires videoUrl (the source clip)`)
    if (!input.audioUrl) throw new Error(`${model} requires audioUrl (the speech track)`)
  } else if (spec.audioDriven) {
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
 * No-packshot-carton rule for the Atlas one-stage path (#3570). The fal route
 * enforces this with a dedicated stage-1 plate that strips packaging; Atlas
 * skips that stage, so the rule moves into the composite prompt. Mirrors
 * PLATE_PROMPT/PLATE_NEGATIVE: reproduce the bare product from its reference,
 * never the retail box or any brand text on it.
 */
const ATLAS_NO_CARTON_CLAUSE =
  'Show the bare product itself exactly as it appears in its reference image, ' +
  'with the same shape, proportions, color, and finish. Do not show any ' +
  'packaging, retail box, carton, sleeve, or insert, and no text, words, ' +
  'letters, watermark, logo, or brand name on the product or anywhere in the frame.'

/**
 * Ratio-anchored scale clause (ticket #4536, split from #3997). PRODUCT_SCALE_CUE
 * asks for "true real-world size" in the abstract, and the 2026-08-17 scene-frame
 * run proved that insufficient: a packshot carries no scale reference, so an
 * unanchored composite still rendered a palm-sized product at roughly twice life
 * size. This clause anchors the product to a ratio between two things both
 * present in the frame — the presenter's face and their hand — which the model
 * can measure against, and it was the variant that also gave the truest colour of
 * the three tested. Presenter-neutral on purpose: cast members can be any gender,
 * so it never says "her"/"she".
 */
export const PRODUCT_SCALE_RATIO_ANCHOR =
  'Anchor the product size to what is visible in the frame: the product is no ' +
  "wider than one third the width of the presenter's face and clearly smaller " +
  'than their hand.'

/**
 * The full clause suffix appended to a composite prompt whenever a real product
 * is composited into the scene. Shared by both compose paths so the scale rules
 * cannot drift between them, and exported so a unit test can assert the
 * ratio-anchor clause is always present (ticket #4536). Both paths carry the
 * real-world-size cue and the ratio anchor; only the Atlas one-stage path also
 * carries ATLAS_NO_CARTON_CLAUSE, because the fal two-stage path already strips
 * the carton in its stage-1 plate.
 */
export function compositeProductClauses(path: 'fal' | 'atlas'): string {
  const scale = `${PRODUCT_SCALE_CUE} ${PRODUCT_SCALE_RATIO_ANCHOR}`
  return path === 'atlas' ? `${scale} ${ATLAS_NO_CARTON_CLAUSE}` : scale
}

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
  // X timeline still. X renders a single image at 16:9 and crops anything
  // taller, and a 4:5 composite centre-cropped to 16:9 keeps only 1080x608:
  // 45% of the height, with the hand-and-product band among the 55% discarded.
  // Owner direction 2026-08-19 puts a cast member in every X image, so the cast
  // path needs a real 16:9 rather than a crop of the Instagram frame.
  '16:9': { width: 1600, height: 900 },
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
  /**
   * fal request id per candidate, index-aligned with `urls`. Each candidate is
   * its own single-image fal request (ticket #3045), so the id identifies one
   * frame, not a batch. undefined at a position when the header was absent.
   * Thread into logImageCost({ requestId }) so an owner can trace a frame back
   * to its generation without decoding a UUIDv7 timestamp.
   */
  requestIds: (string | undefined)[]
  /** Stage-2 compositor model, billed once per returned candidate. */
  costKey: string
  /**
   * Stage-1 plate spend, when a plate was built. Separate from `costKey` because
   * it is a single image on a different model, and the caller owns cost logging.
   */
  plate?: { costKey: string; count: number }
  /** fal request id of the stage-1 plate call, when a plate was built. */
  plateRequestId?: string
}

/**
 * Stage 1. Returns a fal-hosted URL for the packaging-free product plate.
 * Throws on failure so the caller surfaces a composition error rather than
 * silently falling back to the packshot, which is what put boxes in frame.
 */
async function composeProductPlate(productImageUrl: string): Promise<{ url: string; requestId?: string }> {
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
  const requestId = readFalRequestId(res)
  const json = await res.json() as { images?: { url?: string }[] }
  const url = json.images?.[0]?.url
  if (!url) throw new Error(`fal.ai ${SCENE_PLATE_MODEL} returned no product plate`)
  return { url, ...(requestId ? { requestId } : {}) }
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
): Promise<{ url: string; requestId?: string }> {
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
  const requestId = readFalRequestId(res)
  const json = await res.json() as { images?: { url?: string }[] }
  const url = json.images?.[0]?.url
  if (!url) throw new Error(`fal.ai ${SCENE_FRAME_MODEL} returned no images`)
  return { url, ...(requestId ? { requestId } : {}) }
}

/**
 * Atlas Cloud one-stage composite (bytedance/seedream-v4.5/edit). Phase 2 of the
 * Atlas migration (ticket #3570): seedream holds the product's geometry from the
 * reference photo AND composites the presenter in a single call, so it collapses
 * fal's two-stage qwen-plate + FLUX.2-edit route to one atlasGenerate call — no
 * plate pre-pass. The two-stage fal path stays as the fallback in
 * composeSceneFrame() when Atlas is unconfigured or errors.
 *
 * The plate pre-pass existed to keep the retail carton out of frame. Skipping it
 * here means the no-packshot-carton rule moves into the prompt (ATLAS_NO_CARTON_CLAUSE),
 * relying on seedream honoring it plus the ref geometry. Verify with a
 * branded-carton product in output review (a DONE-WHEN check on #3570).
 */
async function composeSceneFrameAtlas(opts: ComposeSceneFrameOpts): Promise<SceneFrameResult> {
  const count = Math.min(Math.max(1, opts.count ?? 3), 4)

  // A talking-head frame or a no-presenter base (product photo IS the base)
  // composites no separate product, so it gets neither the scale cue nor the
  // carton clause — same conditions as the fal path's `needsPlate`.
  const hasProduct = !!opts.productImageUrl && opts.productImageUrl !== opts.presenterImageUrl
  const framePrompt = hasProduct
    ? `${opts.prompt} ${compositeProductClauses('atlas')}`
    : opts.prompt

  const refImageUrls = [
    opts.presenterImageUrl,
    ...(hasProduct ? [opts.productImageUrl!] : []),
    ...(opts.extraImageUrls ?? []),
  ]
  const imageSize = SCENE_FRAME_SIZES[opts.aspectRatio ?? '9:16']

  const result = await atlasGenerate({
    prompt: framePrompt,
    count,
    refImageUrls,
    imageSize,
    // Only the hosted URLs are needed here; callers persist them to Blob/Sanity
    // promptly (Atlas URLs live 14 days), exactly as they did with fal's URLs.
    download: false,
    telemetry: { feature: 'video-frames', caller: 'composeSceneFrame:atlas' },
  })

  if (!result.urls.length) throw new Error('atlas composeSceneFrame returned no images')

  // One stage, so no plate spend. costKey is the Atlas edit key
  // ('atlas/seedream-4.5-edit'), already priced in model-pricing IMAGE_RATES.
  return {
    urls: result.urls,
    requestIds: result.requestIds,
    costKey: result.costKey,
  }
}

/**
 * Compose a scene frame. Atlas Cloud one-stage is the primary path (ticket
 * #3570); the fal two-stage path is the fallback when Atlas is unconfigured or
 * throws. The signature and SceneFrameResult contract are identical on both, so
 * callers are provider-agnostic — only `costKey` and the absence of `plate`
 * distinguish an Atlas result.
 */
export async function composeSceneFrame(opts: ComposeSceneFrameOpts): Promise<SceneFrameResult> {
  if (atlasConfigured()) {
    try {
      return await composeSceneFrameAtlas(opts)
    } catch (err) {
      // Fall back to the fal two-stage path rather than failing the frame. The
      // fallback is the whole reason the qwen-plate + FLUX.2 route is kept.
      console.error('[composeSceneFrame] Atlas one-stage failed, falling back to fal two-stage:', err)
    }
  }
  return composeSceneFrameFal(opts)
}

async function composeSceneFrameFal(opts: ComposeSceneFrameOpts): Promise<SceneFrameResult> {
  const key = requireKey()
  const count = Math.min(Math.max(1, opts.count ?? 3), 4)

  // Stage 1. Skipped for talking-head frames (no product) and for the
  // no-presenter caller, which passes the product photo as its own base — there
  // is nothing to composite it against, so a plate would just be wasted spend.
  const needsPlate = !!opts.productImageUrl && opts.productImageUrl !== opts.presenterImageUrl
  const plate = needsPlate ? await composeProductPlate(opts.productImageUrl!) : undefined
  const productRef = plate ? plate.url : opts.productImageUrl

  // Anchor the composited product to real-world scale (ticket #2761). Applied
  // only to a genuine presenter+product composite (needsPlate): a talking-head
  // frame has no product, and the no-presenter base has no hand to scale against.
  const framePrompt = needsPlate ? `${opts.prompt} ${compositeProductClauses('fal')}` : opts.prompt

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
  const fulfilled = settled
    .filter((r): r is PromiseFulfilledResult<{ url: string; requestId?: string }> => r.status === 'fulfilled')
    .map(r => r.value)
  if (!fulfilled.length) {
    const firstRejected = settled.find(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    )
    throw firstRejected?.reason instanceof Error
      ? firstRejected.reason
      : new Error(`fal.ai ${SCENE_FRAME_MODEL} returned no images`)
  }
  return {
    urls: fulfilled.map(f => f.url),
    requestIds: fulfilled.map(f => f.requestId),
    costKey: SCENE_FRAME_COST_KEY,
    ...(plate ? { plate: { costKey: SCENE_PLATE_COST_KEY, count: 1 } } : {}),
    ...(plate?.requestId ? { plateRequestId: plate.requestId } : {}),
  }
}
