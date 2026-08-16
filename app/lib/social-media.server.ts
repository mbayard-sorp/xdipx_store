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

/**
 * Generate a cast-in-hand composite: an approved cast member holding and
 * showing the REAL product (owner ruling 2026-08-12).
 *
 * Why this is a separate function from the single-image path below, and not a
 * flag on it: a single reference image can hold exactly one thing. The
 * single-ref Kontext path preserves whichever reference it is given, so passing
 * the presenter preserves the presenter and *invents* the product. That is not
 * a tuning problem, it is the shape of the model call, and it produced a frame
 * where the cast member held a plausible pink cylinder that was no SKU at all.
 *
 * `composeSceneFrame` is the path built for this and already supports a 4:5
 * feed still. Stage 1 renders a packaging-free plate from the real Shopify
 * photo, so a manufacturer carton never reaches the presenter's hand; stage 2
 * composites presenter and plate together, holding cast identity from the
 * reference photo. Both references are supplied, so both survive.
 */
/**
 * Scale cues for a cast composite (ticket #2761).
 *
 * The first live two-stage run produced a correct Rosales in every respect
 * except size: a palm-sized toy rendered vase-sized in Maya's hand. Stage 1
 * renders the plate centered and large on a neutral field with no scale
 * context, and stage 2 composites it at roughly the plate's apparent size.
 * Nothing in either reference tells the model how big the object is in the
 * world.
 *
 * The cue is expressed **relative to the presenter's own hand**, never in
 * units, because the model has no unit sense but does understand a hand it is
 * already drawing. Templating these from the Nalpac dimension specs is the
 * better long-term answer and stays on #2761; these presets cover the catalog's
 * real shape classes today.
 */
export const PRODUCT_SCALES = {
  palm:     'The product is small and palm-sized: it sits entirely within her hand, no taller than her palm is wide, and her fingers wrap comfortably around it.',
  handheld: 'The product is handheld and slender: roughly as long as her hand from wrist to fingertip, and narrow enough that her fingers close around it easily.',
  forearm:  'The product is long-handled: roughly the length of her forearm from wrist to elbow, held near one end.',
  bottle:   'The product is a small bottle, about the height of her hand from wrist to fingertip and easily gripped in one hand.',
} as const

/**
 * Build a scale cue from the product's REAL dimensions (ticket #2761).
 *
 * The presets above are shape-class guesses, and a guess is what produced the
 * defect: a 4.7-inch bullet was briefed as `palm` ("no taller than her palm is
 * wide"), which is about 3.5 inches. The cue contradicted the reference photo,
 * so the model oscillated between too small and too big across candidates.
 *
 * The real numbers were in Shopify the whole time, in the `xdipx.specifications`
 * metafield ("Length: 4.7 inches"). Prefer them over a preset whenever they
 * exist.
 *
 * The cue states BOTH the measurement and a hand-relative anchor. Units alone
 * are weak because the model has no scale sense; the anchor alone is what the
 * presets already were. Together, one corrects the other.
 *
 * Anchors assume an adult hand of roughly 7.5in wrist to fingertip and a palm
 * of roughly 4in from wrist crease to finger base.
 */
export function scaleCueFromLengthInches(lengthIn: number): string {
  const L = `about ${lengthIn} inches long`
  if (lengthIn <= 2.5) {
    return `The product is small, ${L}: it disappears almost entirely inside her closed hand.`
  }
  if (lengthIn <= 4) {
    return `The product is ${L}: roughly the length of her palm from wrist crease to the base of her fingers, and it sits comfortably within her hand.`
  }
  if (lengthIn <= 6) {
    return `The product is ${L}: noticeably shorter than her whole hand, roughly two thirds of the distance from her wrist to her fingertips, so it reads as compact but not tiny when she holds it up.`
  }
  if (lengthIn <= 9) {
    return `The product is ${L}: roughly the length of her whole hand from wrist to fingertip.`
  }
  return `The product is ${L}: longer than her hand, roughly reaching from her wrist toward her elbow.`
}

/**
 * Pull a length in inches out of the `xdipx.specifications` metafield, whose
 * entries look like "Length: 4.7 inches". Returns null when there is no usable
 * length, so the caller falls back to a preset rather than inventing a number.
 */
export function lengthInchesFromSpecifications(specs: readonly string[] | null | undefined): number | null {
  if (!specs) return null
  for (const line of specs) {
    const m = /length\s*:\s*([\d.]+)\s*(?:in|inch|inches)\b/i.exec(line)
    if (m) {
      const n = Number.parseFloat(m[1]!)
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  return null
}

export type ProductScale = keyof typeof PRODUCT_SCALES

export function isProductScale(v: unknown): v is ProductScale {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PRODUCT_SCALES, v)
}

/**
 * Append the scale clause to a composite prompt.
 *
 * Appended rather than prepended: the trailing negative-prompt block is what
 * callers tend to end on, and a scale cue buried before a long negative list
 * gets less weight than one stated right after the scene. Kept as its own
 * exported function so the rule is testable without spending a generation.
 */
export function withProductScale(prompt: string, scale: ProductScale | string): string {
  const clause = isProductScale(scale) ? PRODUCT_SCALES[scale] : scale.trim()
  if (!clause) return prompt
  return `${prompt.trim()} ${clause}`
}

export interface GenerateCastCompositeOpts {
  prompt: string
  /** Product handle, for the filename. */
  handle: string
  /** Short mood token for the filename. */
  mood: string
  /** YYYY-MM-DD. */
  date: string
  slide?: number
  /** Approved castMember reference photo. Identity comes from this, never from the prompt. */
  presenterImageUrl: string
  /** Real Shopify product photo. Stage 1 turns it into an unlabeled plate. */
  productImageUrl: string
  /**
   * Extra references handed to stage 2 alongside the plate.
   *
   * Exists because of a measured failure (#3045): one run produced two
   * candidates that disagreed about the product's silhouette. Both came from a
   * single composeSceneFrame call and therefore shared ONE stage-1 plate, so a
   * bad plate cannot explain it. The drift is stage 2 re-interpreting the plate
   * per candidate rather than compositing it. Passing the real packshot here
   * gives stage 2 a second, unambiguous look at the true shape.
   */
  extraImageUrls?: string[]
  /**
   * How big the product is, relative to the presenter's hand. Required, because
   * omitting it is what produced a vase-sized palm toy: a silent default would
   * be wrong for most of the catalog and wrong invisibly.
   */
  scale: ProductScale | string
  /** Candidate count (1-4). More candidates is the cheap way to survive hand anatomy. */
  count?: number
  caller?: string
}

export interface GenerateCastCompositeResult {
  /** Permanent Shopify Files CDN URLs, one per surviving candidate. */
  urls: string[]
  filenames: string[]
  /** Cost keys billed, so the caller can log spend for both stages. */
  costs: { costKey: string; count: number }[]
  /**
   * fal request id per surviving candidate, index-aligned with `urls` and
   * `filenames`. Each candidate is its own fal request (ticket #3045), so the
   * id names the one image at that filename. Pass into the spend row's
   * requestId (with the filename as refId) to make a fal request id resolvable
   * to its file. undefined at a position when fal omitted the header.
   */
  requestIds: (string | undefined)[]
  /** fal request id of the stage-1 plate call, when a plate was built. */
  plateRequestId?: string
}

export async function generateCastComposite(
  opts: GenerateCastCompositeOpts,
): Promise<GenerateCastCompositeResult> {
  const { composeSceneFrame } = await import('./fal-video.server')

  const frame = await composeSceneFrame({
    prompt: withProductScale(opts.prompt, opts.scale),
    presenterImageUrl: opts.presenterImageUrl,
    productImageUrl: opts.productImageUrl,
    ...(opts.extraImageUrls?.length ? { extraImageUrls: opts.extraImageUrls } : {}),
    // 4:5 is the feed/grid still. The default is 9:16, which is a video frame
    // and would be cropped to nothing in a profile grid.
    aspectRatio: '4:5',
    count: opts.count ?? 2,
  })

  const costs: { costKey: string; count: number }[] = [
    { costKey: frame.costKey, count: frame.urls.length },
    ...(frame.plate ? [frame.plate] : []),
  ]

  // Rehost every candidate: fal URLs expire in ~24h and Instagram fetches the
  // image server-side at publish time.
  const urls: string[] = []
  const filenames: string[] = []
  const requestIds: (string | undefined)[] = []
  for (const [i, falUrl] of frame.urls.entries()) {
    const filename = buildSocialAssetFilename({
      handle: opts.handle,
      archetype: 'cast',
      mood: opts.mood,
      date: opts.date,
      slide: opts.slide ?? i + 1,
    })
    const res = await fetch(falUrl)
    if (!res.ok) continue
    const buffer = Buffer.from(await res.arrayBuffer())
    urls.push(await uploadMoodImageToShopifyFiles(buffer, filename))
    filenames.push(filename)
    // Keep aligned with the surviving urls/filenames (a fetch failure above
    // skips both this filename and its request id).
    requestIds.push(frame.requestIds[i])
  }

  return {
    urls,
    filenames,
    costs,
    requestIds,
    ...(frame.plateRequestId ? { plateRequestId: frame.plateRequestId } : {}),
  }
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
  only?: 'atlas' | 'fal' | 'imagen'
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
  provider: 'atlas' | 'fal' | 'imagen' | 'none'
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
