/**
 * fal.ai client — currently used by scripts/remove-product-bg.ts for BiRefNet v2
 * background removal. Uses the synchronous /fal.run/{model} endpoint via fetch
 * (no SDK dependency). Auth: Authorization: Key ${FAL_KEY}.
 *
 * Docs: https://fal.ai/models/fal-ai/birefnet/v2
 */

const FAL_SYNC_ENDPOINT = 'https://fal.run'

export interface BirefnetResult {
  imageUrl: string
  contentType: string
}

function requireKey(): string {
  const key = process.env['FAL_KEY']
  if (!key) throw new Error('FAL_KEY env var is required for fal.ai calls')
  return key
}

/**
 * Run BiRefNet v2 against a publicly-fetchable image URL. Returns the URL of the
 * transparent PNG hosted by fal.ai (valid for ~24h; download promptly).
 */
export async function removeBackground(imageUrl: string): Promise<BirefnetResult> {
  const key = requireKey()
  const res = await fetch(`${FAL_SYNC_ENDPOINT}/fal-ai/birefnet/v2`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${key}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      image_url:         imageUrl,
      output_format:     'png',
      refine_foreground: true,
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`fal.ai BiRefNet error: ${res.status} ${text.slice(0, 400)}`)
  }

  const json = await res.json() as {
    image?: { url?: string; content_type?: string }
  }
  const url = json.image?.url
  if (!url) throw new Error('fal.ai BiRefNet response missing image.url')
  return { imageUrl: url, contentType: json.image?.content_type ?? 'image/png' }
}

// ---------------------------------------------------------------------------
// Text-to-image generation (primary generator for the homepage merch team).
//
// Google Imagen refuses a lot of this vertical's prompts ("blocked by safety
// filters"); fal's FLUX endpoints are far less restrictive, so fal is primary
// and Imagen is the fallback (see `generate-image.server.ts`). Same key/endpoint
// pattern as removeBackground above.
// ---------------------------------------------------------------------------

/** fal model endpoint → cost key understood by model-pricing IMAGE_RATES. */
const FAL_COST_KEY: Record<string, string> = {
  'fal-ai/flux/schnell':       'fal/flux-schnell',
  'fal-ai/flux/dev':           'fal/flux-dev',
  'fal-ai/flux-pro':           'fal/flux-pro',
  'fal-ai/flux-pro/kontext':   'fal/flux-kontext',
  'fal-ai/flux-kontext/dev':   'fal/flux-kontext-dev',
  'fal-ai/nano-banana':        'fal/nano-banana',
  'fal-ai/flux-2/lora/edit':   'fal/flux-2-edit',
}

/**
 * Image-conditioned model used whenever a reference image is supplied. The
 * open-weights dev endpoint, NOT flux-pro/kontext: the pro endpoint runs a
 * mandatory output safety checker that flags sex-toy product photos as NSFW
 * and returns solid-black frames (verified 2026-07-05). Dev accepts
 * enable_safety_checker:false like the other open FLUX endpoints.
 */
const FAL_KONTEXT_MODEL = 'fal-ai/flux-kontext/dev'

/**
 * Multi-reference edit model, used whenever two or more reference images must
 * appear faithfully in one scene (e.g. a vibrator plus its lube bottle in a
 * single drawer shot, charter v5.3 License C). Kontext dev takes only one
 * image_url, so it cannot composite multiple real products; this endpoint takes
 * an image_urls array.
 *
 * NOT `fal-ai/nano-banana/edit`, the other multi-ref option: it is Gemini Flash
 * Image behind a fal wrapper and carries Google's non-configurable IMAGE_SAFETY
 * output filter, which returned 422 content_policy for an ordinary catalog
 * vibrator at every safety_tolerance tested, on both raw packshots and clean
 * plates (bake-off 2026-08-10, docs/media-model-routing.md). It cannot render a
 * large part of the catalog. composeSceneFrame() in fal-video.server.ts moved
 * off it to this same endpoint for that reason; keep the two in step.
 */
const FAL_MULTI_REF_MODEL = 'fal-ai/flux-2/lora/edit'

/** fal image_size enum → Kontext resolution_mode/aspect (no image_size param). */
const KONTEXT_ASPECT: Record<string, string> = {
  square_hd:      '1:1',
  square:         '1:1',
  portrait_4_3:   '3:4',
  portrait_16_9:  '9:16',
  landscape_4_3:  '4:3',
  landscape_16_9: '16:9',
}

/**
 * Kontext resolution_mode aspects with their numeric ratio, used to map a
 * caller's `{width,height}` object to the nearest supported aspect. Deduped from
 * KONTEXT_ASPECT (square/square_hd both map to 1:1).
 */
const KONTEXT_ASPECT_RATIOS: ReadonlyArray<{ aspect: string; ratio: number }> = [
  { aspect: '9:16', ratio: 9 / 16 },
  { aspect: '3:4',  ratio: 3 / 4 },
  { aspect: '1:1',  ratio: 1 },
  { aspect: '4:3',  ratio: 4 / 3 },
  { aspect: '16:9', ratio: 16 / 9 },
]

/**
 * Resolve the Kontext `resolution_mode` for a caller's `imageSize`. The Kontext
 * endpoint has no `image_size` parameter, so it can only take a string aspect.
 * A `{width,height}` object used to fall through to a hardcoded `'16:9'`, which
 * silently generated the wrong aspect (a 4:3 brief came back 16:9 with no
 * error). Map the object form to the nearest supported aspect by ratio instead,
 * and throw on genuinely unmappable input rather than defaulting.
 */
export function kontextResolutionMode(
  imageSize: string | { width: number; height: number },
): string {
  if (typeof imageSize === 'string') {
    const aspect = KONTEXT_ASPECT[imageSize]
    if (!aspect) throw new Error(`fal Kontext: unmapped image_size "${imageSize}"`)
    return aspect
  }
  const { width, height } = imageSize
  if (!(width > 0) || !(height > 0)) {
    throw new Error(`fal Kontext: invalid image_size {width:${width},height:${height}}`)
  }
  const ratio = width / height
  return KONTEXT_ASPECT_RATIOS.reduce((best, cand) =>
    Math.abs(cand.ratio - ratio) < Math.abs(best.ratio - ratio) ? cand : best,
  ).aspect
}

/** Default endpoint: FLUX dev balances quality and cost for editorial scenes. */
const DEFAULT_FAL_IMAGE_MODEL = process.env['FAL_IMAGE_MODEL']?.trim() || 'fal-ai/flux/dev'

export interface FalGenerateOpts {
  prompt: string
  /** How many images (default 1, capped 4). */
  count?: number
  /** fal model endpoint; defaults to FAL_IMAGE_MODEL env or flux/dev. */
  model?: string
  /** fal image_size enum or {width,height}. Defaults to landscape 16:9. */
  imageSize?: string | { width: number; height: number }
  /**
   * Publicly fetchable reference image (e.g. a real Shopify product photo).
   * When set, generation routes to FLUX Kontext so the actual product appears
   * in the generated scene instead of a model-invented lookalike.
   */
  refImageUrl?: string
  /**
   * Two or more publicly fetchable reference images to composite faithfully
   * into one scene. When this holds more than one URL, generation routes to
   * FLUX.2 edit (image_urls) instead of single-ref Kontext. A single URL
   * here (or `refImageUrl`) keeps the unchanged Kontext single-ref path; when
   * both are set, `refImageUrls` wins if it is non-empty.
   */
  refImageUrls?: string[]
  /**
   * Attribution for block telemetry. Optional: a missing label still records
   * the block, just without an origin.
   */
  telemetry?: { feature?: string; caller?: string; sku?: string; productId?: string }
}

export interface FalGenerateResult {
  buffers: Buffer[]
  /** Cost key for model-pricing (e.g. 'fal/flux-dev'). */
  costKey: string
}

export function falConfigured(): boolean {
  return !!process.env['FAL_KEY']?.trim()
}

/**
 * Classify and record a non-OK fal response. BEST-EFFORT and fully swallowed:
 * telemetry must never replace the caller's real error, so a logging failure
 * here is invisible and the original throw still happens.
 */
export async function recordFalBlock(
  model: string,
  status: number,
  body: string,
  count: number,
  telemetry?: { feature?: string; caller?: string; sku?: string; productId?: string },
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

/**
 * Generate `count` images from `prompt` via fal's sync endpoint, returning them
 * as Buffers (matching the Imagen wrapper's shape). Throws on any failure so the
 * caller can fall back to Imagen.
 */
export async function falGenerate(opts: FalGenerateOpts): Promise<FalGenerateResult> {
  const key = requireKey()
  const count = Math.min(Math.max(1, opts.count ?? 1), 4)
  const image_size = opts.imageSize ?? 'landscape_16_9'

  // Normalise the reference images. `refImageUrls` wins when non-empty, else a
  // single `refImageUrl` (kept for backward compatibility). More than one ref
  // means a multi-product composite; exactly one keeps the unchanged Kontext
  // single-ref path; none is plain text-to-image.
  const refs = opts.refImageUrls?.length
    ? opts.refImageUrls
    : (opts.refImageUrl ? [opts.refImageUrl] : [])
  const multiRef = refs.length > 1
  const singleRef = refs.length === 1

  const model = multiRef
    ? (opts.model?.trim() || FAL_MULTI_REF_MODEL)
    : singleRef
      ? (opts.model?.trim() || FAL_KONTEXT_MODEL)
      : (opts.model?.trim() || DEFAULT_FAL_IMAGE_MODEL)

  // FLUX.2 edit takes an image_urls array + image_size, same shape as the
  // text-to-image endpoints and the same call composeSceneFrame() makes. Kontext
  // dev is the odd one out: image_url + resolution_mode, no image_size param.
  // Same sync endpoint pattern otherwise.
  // Pin JPEG on all three branches. Instagram Graph API image containers require
  // JPEG; leaving output_format to the provider default lets a silent PNG reach
  // an image_url the IG container step then rejects (composeSceneFrame() in
  // fal-video.server.ts already pins it for the same reason).
  const body = multiRef
    ? {
        prompt:                opts.prompt,
        image_urls:            refs,
        num_images:            count,
        image_size,
        output_format:         'jpeg',
        enable_safety_checker: false,
      }
    : singleRef
      ? {
          prompt:                opts.prompt,
          image_url:             refs[0],
          num_images:            count,
          resolution_mode:       kontextResolutionMode(image_size),
          output_format:         'jpeg',
          enable_safety_checker: false,
        }
      : {
          prompt:                opts.prompt,
          num_images:            count,
          image_size,
          output_format:         'jpeg',
          enable_safety_checker: false,
        }

  const res = await fetch(`${FAL_SYNC_ENDPOINT}/${model}`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${key}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    // Recorded here rather than in each caller so every path through fal
    // (homepage stills, ad creative, scripts) is counted by one hook, and at
    // the only point where the status code and raw body are both available.
    await recordFalBlock(model, res.status, text, count, opts.telemetry)
    throw new Error(`fal.ai ${model} error: ${res.status} ${text.slice(0, 400)}`)
  }

  const json = await res.json() as { images?: { url?: string }[] }
  const urls = (json.images ?? []).map(i => i.url).filter((u): u is string => !!u)
  if (!urls.length) throw new Error(`fal.ai ${model} returned no images`)

  const buffers = await Promise.all(
    urls.map(async url => {
      const r = await fetch(url)
      if (!r.ok) throw new Error(`fal.ai image download failed: ${r.status}`)
      return Buffer.from(await r.arrayBuffer())
    }),
  )

  return { buffers, costKey: FAL_COST_KEY[model] ?? 'fal/flux-dev' }
}
