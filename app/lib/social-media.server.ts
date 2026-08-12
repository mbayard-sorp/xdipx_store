/**
 * Social image generation and asset provenance (ticket #2734).
 *
 * Why this file exists. `scripts/gen-homepage-image.ts` and
 * `scripts/gen-notebook-art.ts` gave the homepage and Notebook teams a way to
 * make editorial art. Social never got one, and the consequence was live: the
 * two Instagram posts that shipped 2026-08-09 carried real generated scenes,
 * and every draft written after them carried a bare Nalpac SKU packshot
 * (`77808A.jpg`, `77292A.jpg`, `96177A.jpg`) because a packshot was the only
 * image the routine could reach. `docs/emma-voice.md` retired packshot-only
 * stills entirely, filler included, on 2026-08-09. The team was shipping
 * imagery its own charter had just banned, for want of this module.
 *
 * Two exports, and the small one matters more:
 *
 *  - `generateAndUploadSocialImage()` generates via the shared provider stack
 *    and rehosts to Shopify Files. Rehosting is not optional: fal URLs expire
 *    in 24h and the Instagram Graph API fetches `image_url` server-side at
 *    publish time, so a draft scheduled for tomorrow against a raw fal URL
 *    publishes a 404. Shopify Files gives a permanent, public, JPEG-served CDN
 *    URL, which is exactly the contract `instagram.server.ts` needs.
 *
 *  - `isGeneratedSocialAsset()` is the provenance predicate. It is the
 *    deterministic gate that keeps a retired packshot off a live feed once
 *    posting stops being owner-reviewed, and it is deliberately a pure
 *    function of the URL: no network, no model, no judgment, callable from the
 *    publish path without a round trip. It FAILS CLOSED — anything it does not
 *    positively recognise as generated social art is not publishable.
 */

import { generateImage } from './generate-image.server'
import { uploadMoodImageToShopifyFiles } from './shopify.server'

/**
 * Filename prefixes that mark an asset as generated social art.
 *
 * `social-` is the convention mandated for new assets. `ig-` is grandfathered:
 * the 2026-08-09 hero shipped as `ig-pom-aloe-nightstand-drawer-v2.jpg`, and
 * that post is live and compliant, so the predicate must keep recognising it.
 */
const SOCIAL_ASSET_PREFIXES = ['social-', 'ig-'] as const

/** Licensed imagery archetypes, per the charter's social addendum. */
export type SocialArchetype = 'scene' | 'cast' | 'metaphor' | 'macro' | 'plate'

export const SOCIAL_ARCHETYPES: readonly SocialArchetype[] = [
  'scene', 'cast', 'metaphor', 'macro', 'plate',
]

/** Slug a fragment for use inside a filename. Never returns an empty string. */
function slugFragment(raw: string, fallback: string): string {
  const s = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s || fallback
}

/**
 * Build the canonical social asset filename:
 *   social-{handle}-{archetype}-{mood}-{yyyymmdd}[-{n}].jpg
 *
 * The name is not decoration. It is the reuse index the campaign key-art pool
 * is looked up by, and it is what `isGeneratedSocialAsset()` reads, so a
 * generated asset that skips this builder is indistinguishable from a packshot
 * and will be refused at publish time.
 */
export function buildSocialAssetFilename(opts: {
  handle: string
  archetype: SocialArchetype
  mood: string
  /** YYYY-MM-DD. Passed in rather than read from the clock so callers stay testable. */
  date: string
  /** 1-based slide index for a carousel; omitted for a single image. */
  slide?: number
}): string {
  const handle = slugFragment(opts.handle, 'untitled')
  const mood = slugFragment(opts.mood, 'editorial')
  const day = opts.date.replace(/-/g, '')
  const slide = opts.slide && opts.slide > 0 ? `-${opts.slide}` : ''
  return `social-${handle}-${opts.archetype}-${mood}-${day}${slide}.jpg`
}

/**
 * Is this media URL generated social art, rather than a raw catalog packshot?
 *
 * Fails closed by design. A bare Nalpac packshot (`.../files/77292A.jpg`) and
 * anything else unrecognised both return false, so the publish path's default
 * answer to "may this ship" is no. Query strings are ignored: Shopify appends
 * `?v=<epoch>` to every CDN URL.
 */
export function isGeneratedSocialAsset(url: string): boolean {
  if (!url) return false
  // Take the path's last segment, dropping any ?query and #fragment. Parsing as
  // a URL would throw on the relative or malformed values a draft can carry, so
  // this stays string-only.
  const path = url.split(/[?#]/)[0] ?? ''
  const basename = (path.split('/').pop() ?? '').toLowerCase()
  if (!basename) return false
  return SOCIAL_ASSET_PREFIXES.some(prefix => basename.startsWith(prefix))
}

/**
 * Every media URL on a post must be generated social art. A carousel is only
 * as publishable as its worst slide, so this is an `every`, not a `some`.
 * An empty list is not publishable: an Instagram post with no media cannot be
 * published at all, and treating "nothing to check" as a pass would invert the
 * fail-closed contract above.
 */
export function allMediaAreGeneratedSocialAssets(urls: readonly string[] | null | undefined): boolean {
  if (!urls || urls.length === 0) return false
  return urls.every(isGeneratedSocialAsset)
}

export interface GenerateSocialImageOpts {
  prompt: string
  /** Product handle (or campaign slug for a product-free post) for the filename. */
  handle: string
  archetype: SocialArchetype
  /** Short mood token for the filename, e.g. 'nightstand' or 'warm-daylight'. */
  mood: string
  /** YYYY-MM-DD. */
  date: string
  slide?: number
  /**
   * Real product photo. Routes fal to the Kontext edit endpoint so the actual
   * SKU appears in the scene instead of a model-invented lookalike. Omit only
   * for genuinely product-free art (metaphor hooks, typography plates).
   */
  refImageUrl?: string
  /**
   * fal image_size. Instagram feed art is `portrait_4_5`-shaped: the profile
   * grid crops tiles to 3:4, so the subject has to survive both that and a 1:1
   * centre crop. TikTok wants `portrait_16_9`.
   */
  imageSize?: string
  only?: 'fal' | 'imagen'
  caller?: string
  /**
   * Leave false when the caller owns the spend row (the CLI does), so the cost
   * is not counted twice against the social team's daily cap.
   */
  logCost?: boolean
}

export interface GenerateSocialImageResult {
  /** Permanent Shopify Files CDN URL, or null when generation produced nothing. */
  url: string | null
  filename: string
  provider: 'fal' | 'imagen' | 'none'
  model: string
}

/**
 * Generate one social image and rehost it to Shopify Files.
 *
 * Never throws on a generation miss: a provider that returns nothing yields
 * `url: null` so the caller can fall back to a pool asset and report honestly,
 * matching `generateImage`'s own contract.
 */
export async function generateAndUploadSocialImage(
  opts: GenerateSocialImageOpts,
): Promise<GenerateSocialImageResult> {
  const filename = buildSocialAssetFilename({
    handle: opts.handle,
    archetype: opts.archetype,
    mood: opts.mood,
    date: opts.date,
    ...(opts.slide ? { slide: opts.slide } : {}),
  })

  const result = await generateImage({
    prompt: opts.prompt,
    count: 1,
    // The social team's own spend feature. Nothing emitted this before, which
    // is why social image spend was invisible to the budget gate: it sums
    // `feature LIKE 'social-%'`.
    feature: 'social-images',
    caller: opts.caller ?? 'social-media-manager',
    logCost: opts.logCost ?? false,
    ...(opts.refImageUrl ? { refImageUrl: opts.refImageUrl } : {}),
    ...(opts.imageSize ? { imageSize: opts.imageSize } : {}),
    ...(opts.only ? { only: opts.only } : {}),
  })

  const buffer = result.buffers[0]
  if (!buffer) return { url: null, filename, provider: 'none', model: result.model }

  const url = await uploadMoodImageToShopifyFiles(buffer, filename)
  return { url, filename, provider: result.provider, model: result.model }
}
