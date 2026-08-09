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
import { generateMoodImage } from '~/lib/imagen.server'
import { logImageCost } from '~/lib/token-log.server'

export interface GenerateImageOpts {
  /** The scene/art prompt (tasteful, editorial — see Emma voice rules). */
  prompt: string
  /** Imagen mood mapping hint (only used on the Imagen fallback path). */
  categories?: string[]
  /** How many images (default 1, capped 4). */
  count?: number
  /** Cost-log feature label. Default 'homepage-images'. */
  feature?: string
  /** Free-form origin for the cost row, e.g. 'merch-routine/hero'. */
  caller?: string
  productId?: string
  sku?: string
  /** Reference product images (Imagen path reproduces the exact product). */
  referenceImageBuffers?: Buffer[]
  /**
   * Publicly fetchable reference image URL (real Shopify product photo). On
   * the fal path this routes to FLUX Kontext so the actual product appears in
   * the generated scene instead of a model-invented lookalike.
   */
  refImageUrl?: string
  /**
   * Two or more publicly fetchable reference image URLs to composite into one
   * scene (e.g. product plus a second product in the same shot). On the fal
   * path more than one URL routes to nano-banana/edit; a single URL behaves
   * like `refImageUrl`. The Imagen fallback ignores these (it uses
   * `referenceImageBuffers`).
   */
  refImageUrls?: string[]
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

  // 1. fal.ai — primary (skip if only:'imagen' or unconfigured).
  if (opts.only !== 'imagen' && falConfigured()) {
    try {
      const { buffers, costKey } = await falGenerate({
        prompt: opts.prompt,
        count,
        ...(opts.refImageUrls?.length ? { refImageUrls: opts.refImageUrls } : {}),
        ...(opts.refImageUrl ? { refImageUrl: opts.refImageUrl } : {}),
        ...(opts.imageSize ? { imageSize: opts.imageSize } : {}),
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
        prompt: opts.prompt,
        count,
        ...(opts.referenceImageBuffers ? { referenceImageBuffers: opts.referenceImageBuffers } : {}),
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
