/**
 * Atlas Cloud client (api.atlascloud.ai) — the site's PRIMARY still-image
 * provider per owner direction 2026-08-15 (all-hands): fal.ai's failure rate on
 * this vertical made it unfit as the site pipeline. fal remains the video
 * pipeline, BiRefNet background removal, and the still-image FALLBACK when
 * Atlas is unconfigured or errors (see generate-image.server.ts ordering).
 *
 * API shape (verbatim from atlascloud.ai/docs, verified live 2026-08-15):
 *   Submit: POST https://api.atlascloud.ai/api/v1/model/generateImage
 *           { model, prompt, images?: string[], size? | aspect_ratio? }
 *   Poll:   GET  https://api.atlascloud.ai/api/v1/model/prediction/{id}
 *           data.status: created|queued|processing -> completed|succeeded|failed
 *   Auth:   Authorization: Bearer ${ATLAS_CLOUD_API_KEY}
 * Output URLs live 14 days; callers must re-host (Sanity/Shopify/Blob) as they
 * already do for fal's 24h URLs. Failed tasks are not billed.
 *
 * Model choice (POC 2026-08-15, kept in docs/media-model-routing.md):
 * bytedance/seedream-v4.5/edit passed the cast-presenter + insertable-toy
 * reference pairing that fal-ai/nano-banana/edit hard-422s on, held exact
 * product geometry from the reference photo (nano-banana-pro invented a
 * different product), honors exact free-form sizes (true 1080x1350-ratio
 * output), and takes 1-10 reference images in one stage — no qwen-plate
 * pre-pass needed. $0.036/image, 22-31s observed.
 */

const ATLAS_BASE = 'https://api.atlascloud.ai/api/v1'

/** Poll cadence/ceiling for the async prediction loop (observed 22-31s typical). */
const POLL_INTERVAL_MS = 2500
const POLL_TIMEOUT_MS = 240_000

/** Default text-to-image endpoint. */
const DEFAULT_ATLAS_T2I_MODEL =
  process.env['ATLAS_IMAGE_MODEL']?.trim() || 'bytedance/seedream-v4.5'

/**
 * Reference-conditioned endpoint used whenever any reference image is supplied
 * (1-10 refs in one `images` array — single-ref and multi-ref are the same
 * model here, unlike fal's Kontext/FLUX.2 split). Accepts URLs and data URIs
 * (both verified live 2026-08-15).
 */
const DEFAULT_ATLAS_EDIT_MODEL =
  process.env['ATLAS_EDIT_MODEL']?.trim() || 'bytedance/seedream-v4.5/edit'

/** Atlas model endpoint → cost key understood by model-pricing IMAGE_RATES. */
const ATLAS_COST_KEY: Record<string, string> = {
  'bytedance/seedream-v4.5':           'atlas/seedream-4.5',
  'bytedance/seedream-v4.5/edit':      'atlas/seedream-4.5-edit',
  'bytedance/seedream-v5.0-lite':      'atlas/seedream-5.0-lite',
  'bytedance/seedream-v5.0-lite/edit': 'atlas/seedream-5.0-lite-edit',
  'google/nano-banana-pro/edit':       'atlas/nano-banana-pro-edit',
  'black-forest-labs/flux-dev':        'atlas/flux-dev',
}

/**
 * Seedream rejects any size under 3,686,400 pixels ("image size must be at
 * least 3686400 pixels", verified live 2026-08-15), so every mapping below
 * sits at or above that floor. fal `image_size` enum → Atlas free-form size.
 */
const ATLAS_SIZE: Record<string, string> = {
  square_hd:      '2048*2048',
  square:         '2048*2048',
  portrait_4_3:   '1728*2304',
  portrait_16_9:  '1440*2560',
  landscape_4_3:  '2304*1728',
  landscape_16_9: '2560*1440',
}

const MIN_PIXEL_AREA = 3_686_400

/**
 * Resolve a caller's `imageSize` (fal enum or {width,height}) to an Atlas
 * `size` string, scaling explicit dimensions up to the provider's minimum
 * pixel area while preserving aspect. Throws on unmappable input rather than
 * silently generating the wrong aspect.
 */
export function atlasSize(imageSize: string | { width: number; height: number }): string {
  if (typeof imageSize === 'string') {
    const mapped = ATLAS_SIZE[imageSize]
    if (!mapped) throw new Error(`atlas: unmapped image_size "${imageSize}"`)
    return mapped
  }
  const { width, height } = imageSize
  if (!(width > 0) || !(height > 0)) {
    throw new Error(`atlas: invalid image_size {width:${width},height:${height}}`)
  }
  const scale = Math.max(1, Math.sqrt(MIN_PIXEL_AREA / (width * height)))
  // Round to even numbers; some diffusion backends reject odd dimensions.
  const w = 2 * Math.ceil((width * scale) / 2)
  const h = 2 * Math.ceil((height * scale) / 2)
  return `${w}*${h}`
}

export interface AtlasGenerateOpts {
  prompt: string
  /** How many images (default 1, capped 4; issued as parallel single requests). */
  count?: number
  /** Atlas model endpoint; defaults route by reference count (see above). */
  model?: string
  /** fal image_size enum or {width,height}; mapped to Atlas free-form size. */
  imageSize?: string | { width: number; height: number }
  /** Single reference image (URL or data URI); routes to the edit endpoint. */
  refImageUrl?: string
  /** Multiple reference images; wins over refImageUrl when non-empty. Cap 10. */
  refImageUrls?: string[]
  /**
   * When false, skip downloading the output URLs to Buffers and return
   * `buffers: []`. Callers that only need the hosted URLs (Atlas URLs live 14
   * days and are publicly fetchable) avoid a wasteful download round-trip.
   * Defaults to true so existing callers keep getting Buffers unchanged.
   */
  download?: boolean
  /** Attribution for block telemetry, same shape as the fal client's. */
  telemetry?: { feature?: string; caller?: string; sku?: string; productId?: string }
}

export interface AtlasGenerateResult {
  buffers: Buffer[]
  /** Hosted output URLs (14-day TTL), index-aligned with `requestIds` and, when
   *  downloaded, with `buffers`. Always populated. */
  urls: string[]
  /** Prediction id per output URL, index-aligned with `urls`. Each image is its
   *  own single prediction, so this identifies one image, not a batch. */
  requestIds: (string | undefined)[]
  /** Cost key for model-pricing (e.g. 'atlas/seedream-4.5-edit'). */
  costKey: string
  /** Prediction id of the FIRST request in this batch, for spend tracing. */
  requestId?: string
}

export function atlasConfigured(): boolean {
  return !!process.env['ATLAS_CLOUD_API_KEY']?.trim()
}

function requireKey(): string {
  const key = process.env['ATLAS_CLOUD_API_KEY']?.trim()
  if (!key) throw new Error('ATLAS_CLOUD_API_KEY env var is required for Atlas Cloud calls')
  return key
}

/**
 * Classify and record a failed Atlas request. BEST-EFFORT and fully swallowed,
 * mirroring recordFalBlock: telemetry must never replace the caller's real
 * error. Atlas reports content blocks as a `failed` prediction with a policy
 * message rather than an HTTP 4xx, so callers pass the synthetic status 422
 * for those (classifyProviderResponse treats 422 as a refusal).
 */
async function recordAtlasBlock(
  model: string,
  status: number,
  body: string,
  count: number,
  telemetry?: AtlasGenerateOpts['telemetry'],
): Promise<void> {
  try {
    const { classifyProviderResponse } = await import('~/lib/media-block')
    const { logGenerationBlock } = await import('~/lib/token-log.server')
    const { reason, surface } = classifyProviderResponse(status, body)
    await logGenerationBlock({
      model,
      reason,
      surface,
      count,
      ...(telemetry?.caller ? { caller: telemetry.caller } : {}),
      ...(telemetry?.feature ? { ofFeature: telemetry.feature } : {}),
      ...(telemetry?.sku ? { sku: telemetry.sku } : {}),
      ...(telemetry?.productId ? { productId: telemetry.productId } : {}),
    })
  } catch {
    // Never mask the caller's error with a telemetry failure.
  }
}

interface AtlasPrediction {
  id?: string
  status?: string
  outputs?: string[]
  output?: string[]
  error?: unknown
}

function unwrap(json: unknown): AtlasPrediction {
  const obj = json as { data?: AtlasPrediction } & AtlasPrediction
  return obj?.data ?? obj ?? {}
}

/** Submit one generation and poll it to completion; returns output URLs. */
async function runOne(
  key: string,
  model: string,
  body: Record<string, unknown>,
  telemetry?: AtlasGenerateOpts['telemetry'],
): Promise<{ urls: string[]; predictionId?: string }> {
  const res = await fetch(`${ATLAS_BASE}/model/generateImage`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    await recordAtlasBlock(model, res.status, text, 1, telemetry)
    throw new Error(`atlas ${model} error: ${res.status} ${text.slice(0, 400)}`)
  }
  const submitted = unwrap(await res.json())
  const predictionId = submitted.id
  if (!predictionId) throw new Error(`atlas ${model} submit response missing prediction id`)

  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    const poll = await fetch(`${ATLAS_BASE}/model/prediction/${predictionId}`, {
      headers: { 'Authorization': `Bearer ${key}` },
    })
    if (!poll.ok) continue // transient poll failure; the prediction is still running
    const pred = unwrap(await poll.json())
    // Doc pages disagree on the vocabulary (completed vs succeeded); accept both.
    if (pred.status === 'completed' || pred.status === 'succeeded') {
      const urls = (pred.outputs ?? pred.output ?? []).filter((u): u is string => !!u)
      if (!urls.length) throw new Error(`atlas ${model} completed with no outputs`)
      return { urls, predictionId }
    }
    if (pred.status === 'failed') {
      const message = typeof pred.error === 'string' ? pred.error : JSON.stringify(pred.error ?? pred)
      // Content blocks surface here as prose, not as an HTTP status.
      await recordAtlasBlock(model, 422, message, 1, telemetry)
      throw new Error(`atlas ${model} failed: ${message.slice(0, 400)}`)
    }
  }
  throw new Error(`atlas ${model} timed out after ${POLL_TIMEOUT_MS / 1000}s (prediction ${predictionId})`)
}

/**
 * Generate `count` images from `prompt`, returning them as Buffers (matching
 * the fal/Imagen wrapper shape). Throws on any failure so generate-image can
 * fall back to fal. Any reference image routes to the edit endpoint; there is
 * no single/multi model split on this provider.
 */
export async function atlasGenerate(opts: AtlasGenerateOpts): Promise<AtlasGenerateResult> {
  const key = requireKey()
  const count = Math.min(Math.max(1, opts.count ?? 1), 4)

  const refs = (opts.refImageUrls?.length
    ? opts.refImageUrls
    : (opts.refImageUrl ? [opts.refImageUrl] : [])
  ).slice(0, 10)

  const model = opts.model?.trim()
    || (refs.length ? DEFAULT_ATLAS_EDIT_MODEL : DEFAULT_ATLAS_T2I_MODEL)

  const size = atlasSize(opts.imageSize ?? 'landscape_16_9')

  const body: Record<string, unknown> = {
    model,
    prompt: opts.prompt,
    size,
    ...(refs.length ? { images: refs } : {}),
  }

  // No documented num_images param on the Seedream endpoints; a multi-image
  // call is issued as `count` parallel single generations instead.
  const runs = await Promise.all(
    Array.from({ length: count }, () => runOne(key, model, body, opts.telemetry)),
  )

  // Flatten to output URLs while keeping each URL's originating prediction id
  // index-aligned (a run can in principle return more than one URL).
  const urls: string[] = []
  const requestIds: (string | undefined)[] = []
  for (const r of runs) {
    for (const u of r.urls) {
      urls.push(u)
      requestIds.push(r.predictionId)
    }
  }

  const buffers = opts.download === false
    ? []
    : await Promise.all(
        urls.map(async url => {
          const r = await fetch(url)
          if (!r.ok) throw new Error(`atlas image download failed: ${r.status}`)
          return Buffer.from(await r.arrayBuffer())
        }),
      )

  const requestId = runs[0]?.predictionId
  return {
    buffers,
    urls,
    requestIds,
    costKey: ATLAS_COST_KEY[model] ?? 'atlas/seedream-4.5',
    ...(requestId ? { requestId } : {}),
  }
}
