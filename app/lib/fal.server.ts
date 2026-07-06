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
}

/**
 * Image-conditioned model used whenever a reference image is supplied. The
 * open-weights dev endpoint, NOT flux-pro/kontext: the pro endpoint runs a
 * mandatory output safety checker that flags sex-toy product photos as NSFW
 * and returns solid-black frames (verified 2026-07-05). Dev accepts
 * enable_safety_checker:false like the other open FLUX endpoints.
 */
const FAL_KONTEXT_MODEL = 'fal-ai/flux-kontext/dev'

/** fal image_size enum → Kontext resolution_mode/aspect (no image_size param). */
const KONTEXT_ASPECT: Record<string, string> = {
  square_hd:      '1:1',
  square:         '1:1',
  portrait_4_3:   '3:4',
  portrait_16_9:  '9:16',
  landscape_4_3:  '4:3',
  landscape_16_9: '16:9',
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
 * Generate `count` images from `prompt` via fal's sync endpoint, returning them
 * as Buffers (matching the Imagen wrapper's shape). Throws on any failure so the
 * caller can fall back to Imagen.
 */
export async function falGenerate(opts: FalGenerateOpts): Promise<FalGenerateResult> {
  const key = requireKey()
  const model = opts.refImageUrl
    ? (opts.model?.trim() || FAL_KONTEXT_MODEL)
    : (opts.model?.trim() || DEFAULT_FAL_IMAGE_MODEL)
  const count = Math.min(Math.max(1, opts.count ?? 1), 4)
  const image_size = opts.imageSize ?? 'landscape_16_9'

  // Kontext dev takes image_url + resolution_mode; the text-to-image endpoints
  // take image_size. Same sync endpoint pattern otherwise.
  const body = opts.refImageUrl
    ? {
        prompt:                opts.prompt,
        image_url:             opts.refImageUrl,
        num_images:            count,
        resolution_mode:       typeof image_size === 'string' ? (KONTEXT_ASPECT[image_size] ?? '16:9') : '16:9',
        enable_safety_checker: false,
      }
    : {
        prompt:                opts.prompt,
        num_images:            count,
        image_size,
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
