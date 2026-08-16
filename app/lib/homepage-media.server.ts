/**
 * fal.ai / Imagen -> Sanity bridge for the autonomous homepage merchandising
 * team. The FIRST call site of `generateImage()` — everything upstream
 * (fal.server.ts, imagen.server.ts, generate-image.server.ts) already existed
 * with no way to land a generated image on a homepage surface.
 *
 * Flow: generate (no internal cost log — the CLI caller owns the spend row)
 * -> upload the winning buffer to a Sanity image asset -> patch it onto the
 * requested target -> return a manifest. Never gates or logs spend itself;
 * that stays single-sourced in scripts/gen-homepage-image.ts.
 *
 * Server-only.
 */

import { generateImage, type GenerateImageOpts } from '~/lib/generate-image.server'
import { uploadBufferToSanity, sanityImageRef, updateCmsBlock, updateCmsTileImage, updateCmsPromoImage } from '~/lib/sanity.server'

export type HomepageMediaTarget =
  | { kind: 'blockImage'; blockKey: string }
  | { kind: 'tileImage'; blockKey: string; tileKey: string }
  | { kind: 'promoImage'; blockKey: string }

export interface GenerateAndPlaceHomepageImageOpts {
  /** The scene/art prompt (tasteful, editorial — see Emma voice rules). */
  prompt: string
  /** Alt text stored alongside the image asset. */
  alt: string
  target: HomepageMediaTarget
  /**
   * Sanity document to patch. Defaults to the homepage singleton; the
   * merchandising team passes 'singleton.panelDeck', 'categoryPage-*', or
   * 'dropPage-*' ids to place art on the deck and the merchandised pages.
   * Spend attribution is unchanged (feature stays 'homepage-images') — all
   * surfaces bill the same homepage-team image budget.
   */
  docId?: string
  /** Free-form origin for the cost row, e.g. 'media-manager/wayfinder'. */
  caller?: string
  /** Extra generateImage() overrides (e.g. `only: 'fal'`). */
  gen?: Partial<GenerateImageOpts>
}

export interface HomepageMediaManifest {
  provider: 'atlas' | 'fal' | 'imagen' | 'none'
  model: string
  assetId?: string
  url?: string
  target: HomepageMediaTarget
  alt: string
  placed: boolean
}

/**
 * Generate an editorial image and place it on a homepage surface. Returns
 * `placed:false` (no throw) when generation comes back empty, so callers can
 * fall back to an existing photo instead of leaving a gray box.
 */
export async function generateAndPlaceHomepageImage(
  opts: GenerateAndPlaceHomepageImageOpts,
): Promise<HomepageMediaManifest> {
  const res = await generateImage({
    prompt: opts.prompt,
    count: 1,
    feature: 'homepage-images',
    caller: opts.caller ?? 'media-manager',
    // The CLI owns the spend row (POST /api/homepage-team/spend) — logging
    // here too would double-count the cost against the daily $ budget.
    logCost: false,
    ...opts.gen,
  })

  if (!res.buffers.length) {
    return { provider: res.provider, model: res.model, target: opts.target, alt: opts.alt, placed: false }
  }

  const filename = `homepage-${opts.target.blockKey}-${Date.now()}.png`
  const { assetId, url } = await uploadBufferToSanity(res.buffers[0]!, filename, 'image/png')

  const docId = opts.docId ?? 'singleton.homepage'
  switch (opts.target.kind) {
    case 'blockImage':
      await updateCmsBlock(opts.target.blockKey, { image: sanityImageRef(assetId, opts.alt) }, docId)
      break
    case 'tileImage':
      await updateCmsTileImage(opts.target.blockKey, opts.target.tileKey, assetId, opts.alt, docId)
      break
    case 'promoImage':
      await updateCmsPromoImage(opts.target.blockKey, assetId, opts.alt, docId)
      break
  }

  return {
    provider: res.provider,
    model: res.model,
    assetId,
    url,
    target: opts.target,
    alt: opts.alt,
    placed: true,
  }
}
