/**
 * Unified image generation with provider fallback + cost logging.
 *
 * Order: fal.ai (primary, least restrictive for this vertical) → Google Imagen
 * (fallback) → empty result (caller uses an existing catalog photo). Every
 * successful generation logs per-image spend to api_token_log via logImageCost
 * so it shows on /admin/usage and counts against the team's daily $ budget.
 *
 * This is the single entry point the media-manager / homepage team uses — never
 * call fal/imagen directly for net-new homepage art.
 *
 * Server-only.
 */

import { falConfigured, falGenerate } from '~/lib/fal.server'
import { defaultMoodPrompt, generateMoodImage } from '~/lib/imagen.server'
import { logImageCost } from '~/lib/token-log.server'

/**
 * Aspect-ratio string (as the admin/Studio callers speak it) → fal `image_size`
 * enum. Callers that only know '1:1' or '9:16' would otherwise silently get
 * fal's landscape-16:9 default.
 */
const FAL_IMAGE_SIZE_BY_ASPECT: Record<string, string> = {
  '1:1':  'square_hd',
  '4:3':  'landscape_4_3',
  '3:4':  'portrait_4_3',
  '16:9': 'landscape_16_9',
  '9:16': 'portrait_16_9',
}

export function falImageSizeForAspect(aspect: string): string | undefined {
  return FAL_IMAGE_SIZE_BY_ASPECT[aspect]
}

/**
 * fal's image inputs accept data URIs, so a caller holding raw bytes (the admin
 * routes fetch reference photos server-side rather than handing fal a CDN URL)
 * can still reach the image-conditioned FLUX Kontext path instead of dropping
 * to the Imagen fallback.
 */
function bufferToDataUri(buf: Buffer | undefined, mimeType = 'image/jpeg'): string | undefined {
  if (!buf?.length) return undefined
  return `data:${mimeType};base64,${buf.toString('base64')}`
}

export interface GenerateImageOpts {
  /**
   * The scene/art prompt (tasteful, editorial — see Emma voice rules). Optional
   * only when `categories` is supplied: the category mood brief is then used for
   * both providers so fal is still tried first.
   */
  prompt?: string
  /** Imagen mood mapping hint; also the prompt source when `prompt` is omitted. */
  categories?: string[]
  /** How many images (default 1, capped 4). */
  count?: number
  /** Cost-log feature label. Default 'homepage-images'. */
  feature?: string
  /** Free-form origin for the cost row, e.g. 'merch-routine/hero'. */
  caller?: string
  productId?: string
  sku?: string
  /**
   * Reference product images. Imagen reproduces the exact product from these;
   * on the fal path the first buffer is inlined as a data URI and routes to
   * FLUX Kontext.
   */
  referenceImageBuffers?: Buffer[]
  /**
   * Improvement mode: the original image to edit, where the prompt describes
   * only what should change. Routes to FLUX Kontext on the fal path (its native
   * edit behavior) and to Imagen's keep-the-product-identical mode on fallback.
   */
  originalImageBuffer?: Buffer
  /**
   * Aspect ratio as '1:1' | '4:3' | '3:4' | '16:9' | '9:16'. Resolved to a fal
   * `image_size` when `imageSize` is not given explicitly. Ignored by Imagen,
   * which no longer honours an aspect parameter.
   */
  aspectRatio?: string
  /**
   * Publicly fetchable reference image URL (real Shopify product photo). On
   * the fal path this routes to FLUX Kontext so the actual product appears in
   * the generated scene instead of a model-invented lookalike.
   */
  refImageUrl?: string
  /** Force a provider (testing). Default tries fal then imagen. */
  only?: 'fal' | 'imagen'
  /**
   * fal image_size enum or explicit {width,height} (fal path only; Imagen
   * keeps its own default aspect). Defaults to fal's landscape 16:9.
   */
  imageSize?: string | { width: number; height: number }
  /**
   * Whether this call should log its own spend row via logImageCost. Default
   * true. Set false when the caller owns the spend row instead (e.g. the
   * homepage-team CLI posts /api/homepage-team/spend itself — logging here
   * too would double-count the cost and trip the daily $ cap at half budget).
   */
  logCost?: boolean
}

export interface GenerateImageResult {
  buffers: Buffer[]
  provider: 'fal' | 'imagen' | 'none'
  /** Cost key / model used (e.g. 'fal/flux-dev', 'imagen', 'none'). */
  model: string
}

const EMPTY: GenerateImageResult = { buffers: [], provider: 'none', model: 'none' }

/**
 * Generate images, trying fal first then Imagen. Returns an empty result (never
 * throws) when both providers fail or are unavailable, so callers can fall back
 * to an existing catalog photo.
 */
export async function generateImage(opts: GenerateImageOpts): Promise<GenerateImageResult> {
  const count = Math.min(Math.max(1, opts.count ?? 1), 4)
  const feature = opts.feature ?? 'homepage-images'
  const logCost = opts.logCost ?? true
  const logBase = {
    feature,
    ...(opts.caller ? { caller: opts.caller } : {}),
    ...(opts.productId ? { productId: opts.productId } : {}),
    ...(opts.sku ? { sku: opts.sku } : {}),
  }

  // A caller may supply categories only (the legacy Imagen signature). Build the
  // same mood brief for fal so those callers stop skipping the primary provider.
  const prompt = opts.prompt?.trim() || defaultMoodPrompt(opts.categories ?? [])

  // Prefer an explicit URL, then improvement mode's original, then the first
  // product reference — any of them routes fal to the Kontext edit endpoint.
  const refImageUrl =
    opts.refImageUrl
    ?? bufferToDataUri(opts.originalImageBuffer)
    ?? bufferToDataUri(opts.referenceImageBuffers?.[0])

  const imageSize =
    opts.imageSize
    ?? (opts.aspectRatio ? falImageSizeForAspect(opts.aspectRatio) : undefined)

  // 1. fal.ai — primary (skip if only:'imagen' or unconfigured).
  if (opts.only !== 'imagen' && falConfigured()) {
    try {
      const { buffers, costKey } = await falGenerate({
        prompt,
        count,
        ...(refImageUrl ? { refImageUrl } : {}),
        ...(imageSize ? { imageSize } : {}),
      })
      if (buffers.length) {
        if (logCost) void logImageCost({ ...logBase, model: costKey, count: buffers.length })
        return { buffers, provider: 'fal', model: costKey }
      }
    } catch (err) {
      console.warn('[generate-image] fal.ai failed, falling back to Imagen:', err)
    }
  }

  // 2. Google Imagen — fallback (skip if only:'fal').
  if (opts.only !== 'fal') {
    try {
      const buffers = await generateMoodImage({
        categories: opts.categories ?? [],
        prompt,
        count,
        ...(opts.referenceImageBuffers ? { referenceImageBuffers: opts.referenceImageBuffers } : {}),
        ...(opts.originalImageBuffer ? { originalImageBuffer: opts.originalImageBuffer } : {}),
      })
      if (buffers.length) {
        if (logCost) void logImageCost({ ...logBase, model: 'imagen', count: buffers.length })
        return { buffers, provider: 'imagen', model: 'imagen' }
      }
    } catch (err) {
      console.warn('[generate-image] Imagen failed/blocked:', err)
    }
  }

  // 3. Both unavailable — caller uses an existing catalog photo.
  return EMPTY
}
