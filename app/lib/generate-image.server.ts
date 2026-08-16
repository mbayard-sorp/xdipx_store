/**
 * Unified image generation with provider fallback + cost logging.
 *
 * Order: Atlas Cloud (primary per owner direction 2026-08-15 — fal's failure
 * rate on this vertical made it unfit as the site pipeline) → fal.ai
 * (fallback) → Google Imagen (last resort) → empty result (caller uses an
 * existing catalog photo). Every successful generation logs per-image spend to
 * api_token_log via logImageCost so it shows on /admin/usage and counts
 * against the team's daily $ budget.
 *
 * This is the single entry point the media-manager / homepage team uses — never
 * call atlas/fal/imagen directly for net-new homepage art.
 *
 * Server-only.
 */

import { atlasConfigured, atlasGenerate } from '~/lib/atlas.server'
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
  /**
   * Two or more publicly fetchable reference image URLs to composite into one
   * scene (e.g. product plus a second product in the same shot). On the fal
   * path more than one URL routes to FLUX.2 edit; a single URL behaves
   * like `refImageUrl`. The Imagen fallback ignores these (it uses
   * `referenceImageBuffers`).
   */
  refImageUrls?: string[]
  /** Force a provider (testing). Default tries atlas, then fal, then imagen. */
  only?: 'atlas' | 'fal' | 'imagen'
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
  provider: 'atlas' | 'fal' | 'imagen' | 'none'
  /** Cost key / model used (e.g. 'atlas/seedream-4.5-edit', 'fal/flux-dev', 'imagen', 'none'). */
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

  // 1. Atlas Cloud — primary (skip if forced to another provider or unconfigured).
  // Unlike fal there is no single/multi reference model split: any reference
  // routes to the same edit endpoint, so refImageUrl and refImageUrls merge.
  if ((opts.only === undefined || opts.only === 'atlas') && atlasConfigured()) {
    try {
      const { buffers, costKey, requestId } = await atlasGenerate({
        prompt,
        count,
        ...(opts.refImageUrls?.length ? { refImageUrls: opts.refImageUrls } : {}),
        ...(refImageUrl ? { refImageUrl } : {}),
        ...(imageSize ? { imageSize } : {}),
        telemetry: {
          feature,
          ...(opts.caller ? { caller: opts.caller } : {}),
          ...(opts.sku ? { sku: opts.sku } : {}),
          ...(opts.productId ? { productId: opts.productId } : {}),
        },
      })
      if (buffers.length) {
        if (logCost) void logImageCost({ ...logBase, model: costKey, count: buffers.length, ...(requestId ? { requestId } : {}) })
        return { buffers, provider: 'atlas', model: costKey }
      }
    } catch (err) {
      console.warn('[generate-image] Atlas Cloud failed, falling back to fal:', err)
    }
  }

  // 2. fal.ai — fallback (skip if only:'imagen'/'atlas' or unconfigured).
  if (opts.only !== 'imagen' && opts.only !== 'atlas' && falConfigured()) {
    try {
      const { buffers, costKey, requestId } = await falGenerate({
        prompt,
        count,
        ...(opts.refImageUrls?.length ? { refImageUrls: opts.refImageUrls } : {}),
        ...(refImageUrl ? { refImageUrl } : {}),
        ...(imageSize ? { imageSize } : {}),
        // falGenerate records its own blocks; this only attributes them.
        telemetry: {
          feature,
          ...(opts.caller ? { caller: opts.caller } : {}),
          ...(opts.sku ? { sku: opts.sku } : {}),
          ...(opts.productId ? { productId: opts.productId } : {}),
        },
      })
      if (buffers.length) {
        // With count > 1 this single fal request returns N images under one
        // request_id, so the id identifies this batch of images, not one of them.
        if (logCost) void logImageCost({ ...logBase, model: costKey, count: buffers.length, ...(requestId ? { requestId } : {}) })
        return { buffers, provider: 'fal', model: costKey }
      }
    } catch (err) {
      console.warn('[generate-image] fal.ai failed, falling back to Imagen:', err)
    }
  }

  // 3. Google Imagen — last resort (skip if forced to another provider).
  if (opts.only !== 'fal' && opts.only !== 'atlas') {
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
      // fal self-reports its blocks inside falGenerate; Imagen throws prose, so
      // it is classified and recorded here. Without this the fallback provider's
      // refusals stayed invisible, which is most of what an operator hits.
      const { classifyMediaFailure } = await import('~/lib/media-block')
      const { logGenerationBlock } = await import('~/lib/token-log.server')
      const { reason, surface } = classifyMediaFailure(err)
      void logGenerationBlock({
        model: 'imagen',
        reason,
        surface,
        count,
        ofFeature: feature,
        ...(opts.caller ? { caller: opts.caller } : {}),
        ...(opts.sku ? { sku: opts.sku } : {}),
        ...(opts.productId ? { productId: opts.productId } : {}),
      })
    }
  }

  // 4. All providers unavailable — caller uses an existing catalog photo.
  return EMPTY
}
