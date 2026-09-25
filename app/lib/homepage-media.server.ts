/**
 * fal.ai / Imagen -> Sanity bridge for the autonomous homepage merchandising
 * team. The FIRST call site of `generateImage()` — everything upstream
 * (fal.server.ts, imagen.server.ts, generate-image.server.ts) already existed
 * with no way to land a generated image on a homepage surface.
 *
 * Flow: generate (no internal cost log — the CLI caller owns the spend row)
 * -> anatomy/imagery-ceiling vision gate (ticket #10483) -> upload the
 * winning buffer to a Sanity image asset -> patch it onto the requested
 * target -> return a manifest. Never logs spend itself; that stays
 * single-sourced in scripts/gen-homepage-image.ts.
 *
 * The vision gate closes a real gap, not a theoretical one:
 * .claude/agents/homepage-art-director.md asserted media-manager "scores
 * every generated image against the doctrine section 4 checklist before
 * upload", but no owned surface actually ran one — the check existed only on
 * the social path (app/lib/social-vision-gate.server.ts) and the Notebook
 * hero path (scripts/gen-notebook-art.ts). Reuses the same buffer-based gate
 * those paths use (app/lib/vision-gate-buffer.server.ts) rather than forking
 * a second implementation, at the same two-attempt budget
 * (docs/homepage-team/mission-brief.md:142). A candidate that fails every
 * attempt is never uploaded or placed, but the last attempt's billed
 * generation still stands: `placed:false` here still carries a real
 * `provider`, so the caller's existing "bill whenever provider !== 'none'"
 * invariant (#887) still fires — a gate-rejected candidate was still
 * generated and billed by the provider.
 */

import { generateImage, type GenerateImageOpts } from '~/lib/generate-image.server'
import { uploadBufferToSanity, sanityImageRef, updateCmsBlock, updateCmsTileImage, updateCmsPromoImage } from '~/lib/sanity.server'
import { gateImageBuffer } from '~/lib/vision-gate-buffer.server'

/** Matches the Notebook hero path's own budget (gen-notebook-art.ts's HERO_VISION_MAX_ATTEMPTS)
 *  and generateWithVisionGate's default, so vision-gate behavior is consistent across surfaces. */
const HOMEPAGE_VISION_MAX_ATTEMPTS = 2

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
  /** Why `placed` is false — set when generation came back empty, the vision
   *  gate rejected every attempt, or upload/placement failed. Absent on success. */
  reason?: string
}

/**
 * Generate an editorial image and place it on a homepage surface. Returns
 * `placed:false` (no throw) when generation comes back empty (provider 'none'),
 * OR when the vision gate rejects every candidate within budget, OR when
 * upload/placement fails after a billed generation (provider set), so callers
 * can fall back to an existing photo instead of leaving a gray box — and
 * still post the spend row for the billed case (#887).
 */
export async function generateAndPlaceHomepageImage(
  opts: GenerateAndPlaceHomepageImageOpts,
): Promise<HomepageMediaManifest> {
  async function generateOnce() {
    return generateImage({
      prompt: opts.prompt,
      count: 1,
      feature: 'homepage-images',
      caller: opts.caller ?? 'media-manager',
      // The CLI owns the spend row (POST /api/homepage-team/spend) — logging
      // here too would double-count the cost against the daily $ budget.
      logCost: false,
      ...opts.gen,
    })
  }

  let res = await generateOnce()
  if (!res.buffers.length) {
    return { provider: res.provider, model: res.model, target: opts.target, alt: opts.alt, placed: false }
  }

  // Anatomy / imagery-ceiling vision gate (ticket #10483): every candidate is
  // checked before it can reach Sanity, closing the gap where this chokepoint
  // had no code-enforced gate at all despite .claude/agents/homepage-art-director.md
  // claiming one. A failing verdict regenerates within the same two-attempt
  // budget the Notebook hero and social paths use; exhausting it holds the
  // surface unplaced rather than shipping an uncaught defect.
  let candidate = res.buffers[0]!
  let rejectNotes = ''
  let gated = false
  for (let attempt = 1; attempt <= HOMEPAGE_VISION_MAX_ATTEMPTS; attempt++) {
    const verdict = await gateImageBuffer(candidate)
    if (verdict.pass) {
      gated = true
      break
    }
    rejectNotes = verdict.notes || 'vision gate rejected the candidate'
    console.error(`[homepage-media] vision gate rejected candidate on attempt ${attempt}/${HOMEPAGE_VISION_MAX_ATTEMPTS}: ${rejectNotes}`)
    if (attempt >= HOMEPAGE_VISION_MAX_ATTEMPTS) break
    res = await generateOnce()
    if (!res.buffers.length) {
      return { provider: res.provider, model: res.model, target: opts.target, alt: opts.alt, placed: false }
    }
    candidate = res.buffers[0]!
  }

  if (!gated) {
    // Every candidate was actually generated and judged (billed by the
    // provider), just never one that passed — `provider` stays real here so
    // the caller's existing "bill whenever provider !== 'none'" invariant
    // (#887) still fires for this rejected-but-billed generation.
    return {
      provider: res.provider,
      model: res.model,
      target: opts.target,
      alt: opts.alt,
      placed: false,
      reason: `vision gate rejected every candidate: ${rejectNotes}`,
    }
  }

  // Upload/placement failure must not throw past this point: the generation
  // above is already billed by the provider, and an exception here used to
  // unwind the CLI before it posted the spend row, so the billed image never
  // counted against the daily $ or image cap (#887). `placed:false` with a
  // real provider tells the caller "billed but unplaced" — it must still post
  // spend.
  try {
    const filename = `homepage-${opts.target.blockKey}-${Date.now()}.png`
    const { assetId, url } = await uploadBufferToSanity(candidate, filename, 'image/png')

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
  } catch (err) {
    console.error('[homepage-media] upload/placement failed (generation billed, unplaced):', err)
    return {
      provider: res.provider,
      model: res.model,
      target: opts.target,
      alt: opts.alt,
      placed: false,
      reason: `upload/placement failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
