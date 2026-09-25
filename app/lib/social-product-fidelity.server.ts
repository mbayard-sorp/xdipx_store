/**
 * Product-fidelity check for generated on-skin social imagery (ticket #11487).
 *
 * Owner report, verbatim (2026-09-25): "You've got a lot of product drift on
 * the rose images. The bodyscape is fine." He is separating the body/pose
 * work, which `social-vision-gate.server.ts` already judges, from the
 * PRODUCT rendering, which nothing checked at all.
 *
 * Verified by direct comparison, 2026-09-25 (ROMP 2.0, social_media_assets
 * 675 vs the bare product reference 97829B.jpg): the render turned a tight
 * closed bud with a raised tubular collar into an open spiral/swirl of
 * petals, and replaced the molded "ROMP" wordmark beneath the button with
 * garbled illegible pseudo-text. Shape, mouth geometry, brand mark, and
 * finish all drifted from the reference the generator was actually given.
 * docs/design-doctrine.md section 4 item 3: "hyperbole yes, misrepresentation
 * no. Shape, colour, finish and product identity stay faithful to the
 * reference image." Scale exaggeration is licensed; identity drift is not.
 *
 * REPORT ONLY, matching this ticket's DONE WHEN clause 2: this module never
 * blocks generation or ingestion. It records a distinct verdict a caller can
 * choose to act on once its verdicts have been reviewed against a real
 * sample of on-skin assets, the same "report first, gate later" path
 * `legibleText` took in `social-vision-gate.server.ts` (ticket #10279).
 *
 * FAILS CLOSED on completion, not on drift: a fetch that fails, a model call
 * that errors, or a response that does not parse all produce
 * `checkCompleted: false` with every dimension `null`, matching
 * `social-vision-gate.server.ts`'s "could not check" vs "checked and it's
 * fine" distinction. Unlike that module, a genuine drift finding does not
 * fail anything by itself; it is a report, not a gate.
 */

const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number]

export type FidelityDimension = 'silhouette' | 'colour' | 'finish' | 'brandMark'

export const FIDELITY_DIMENSIONS: readonly FidelityDimension[] = ['silhouette', 'colour', 'finish', 'brandMark']

/**
 * `brandMark` alone can be `'not-applicable'`: the bare reference itself may
 * carry no visible wordmark or logo (a plain silicone toy with no molded
 * text), in which case there is nothing to drift from and the render cannot
 * be faulted for it either way.
 */
export type FidelityRating = 'match' | 'drift'
export type BrandMarkRating = FidelityRating | 'not-applicable'

export interface ProductFidelityVerdict {
  silhouette: FidelityRating | null
  colour: FidelityRating | null
  finish: FidelityRating | null
  brandMark: BrandMarkRating | null
  /** Free-text reasoning, always present so a drift finding can explain itself. */
  notes: string
  checkedAt: string
  /**
   * True only when the model actually returned and parsed a real comparison.
   * False means every dimension above is `null`: the check never ran to
   * completion, not that it found a clean match.
   */
  checkCompleted: boolean
}

/** True when any comparable dimension drifted. `brandMark: 'not-applicable'` never counts as drift. */
export function hasFidelityDrift(verdict: ProductFidelityVerdict): boolean {
  if (!verdict.checkCompleted) return false
  return verdict.silhouette === 'drift'
    || verdict.colour === 'drift'
    || verdict.finish === 'drift'
    || verdict.brandMark === 'drift'
}

/**
 * Encode a verdict as `social_media_assets.tags` entries, the same
 * no-migration convention `formatCropBoxTag`/`sceneAxisTags` use. One tag per
 * dimension so a simple substring search finds drift, mirroring `axis:`.
 * Omits any dimension the check never completed (`null`) rather than writing
 * a misleading `fidelity:silhouette=null`.
 */
export function formatFidelityTags(verdict: ProductFidelityVerdict): string[] {
  if (!verdict.checkCompleted) return []
  const tags: string[] = []
  if (verdict.silhouette) tags.push(`fidelity:silhouette=${verdict.silhouette}`)
  if (verdict.colour) tags.push(`fidelity:colour=${verdict.colour}`)
  if (verdict.finish) tags.push(`fidelity:finish=${verdict.finish}`)
  if (verdict.brandMark) tags.push(`fidelity:brandMark=${verdict.brandMark}`)
  return tags
}

function failClosedVerdict(notes: string): ProductFidelityVerdict {
  return {
    silhouette: null,
    colour: null,
    finish: null,
    brandMark: null,
    notes,
    checkedAt: new Date().toISOString(),
    checkCompleted: false,
  }
}

interface RawFidelityResponse {
  silhouette: FidelityRating
  colour: FidelityRating
  finish: FidelityRating
  brandMark: BrandMarkRating
  notes: string
}

function isRating(v: unknown): v is FidelityRating {
  return v === 'match' || v === 'drift'
}
function isBrandMarkRating(v: unknown): v is BrandMarkRating {
  return isRating(v) || v === 'not-applicable'
}

/** Structural validation of a parsed model response before it is trusted. */
export function isValidFidelityShape(v: unknown): v is RawFidelityResponse {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (!isRating(o['silhouette'])) return false
  if (!isRating(o['colour'])) return false
  if (!isRating(o['finish'])) return false
  if (!isBrandMarkRating(o['brandMark'])) return false
  if (typeof o['notes'] !== 'string') return false
  return true
}

export const PRODUCT_FIDELITY_SYSTEM_PROMPT = `You are a strict product-fidelity QA reviewer for AI-generated marketing imagery on a sexual-wellness storefront. You will be shown TWO images: first, a GENERATED photo of a person or scene featuring a product; second, the REAL BARE PRODUCT REFERENCE photo the generator was given to work from. Your job is to compare the product AS RENDERED in the first image against the real product in the second image, and report whether it stayed faithful or drifted. You are not judging the person, pose, or scene at all, only the product.

Rate four dimensions, each "match" or "drift" (brandMark may also be "not-applicable"):
1. silhouette: the product's overall shape and geometry (for example a closed bud vs an open spiral of petals, a cylinder vs a curved wand, a rounded head vs a pointed one). Scale (how big the product looks relative to a hand or body) is NOT part of this check and some exaggeration there is expected; judge shape only.
2. colour: the product's actual colour and saturation, not the ambient lighting of the scene.
3. finish: the product's surface finish (matte vs glossy, smooth vs textured), as it actually is versus how it renders.
4. brandMark: any molded, printed, or embossed brand wordmark or logo on the product itself. "match" means the mark reads as the same real mark (or close enough to be recognized); "drift" means the mark is garbled, replaced by illegible pseudo-text, wrong, or missing where the reference clearly shows one; "not-applicable" means the reference product itself carries no visible wordmark or logo to compare.

Respond with ONLY a JSON object, no prose before or after, in exactly this shape:
{"silhouette": "match"|"drift", "colour": "match"|"drift", "finish": "match"|"drift", "brandMark": "match"|"drift"|"not-applicable", "notes": "one or two sentences on what you saw, especially for any drift"}

When in doubt on a genuine identity question (a different shape, a different mark), call it "drift"; hyperbole in scale or framing is not drift, but a different product identity is. "notes" is always present.`

export interface FidelityCallOpts {
  strict?: boolean
}

export interface ProductFidelityDeps {
  fetchImageBase64?: (url: string) => Promise<{ data: string; mediaType: string }>
  callVision?: (
    renderedImage: { data: string; mediaType: string },
    referenceImage: { data: string; mediaType: string },
    opts?: FidelityCallOpts,
  ) => Promise<unknown>
}

async function defaultFetchImageBase64(url: string): Promise<{ data: string; mediaType: string }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch ${url} failed: HTTP ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  const mediaType = (res.headers.get('content-type') ?? '').split(';')[0] || 'image/jpeg'
  return { data: buffer.toString('base64'), mediaType }
}

function mediaTypeOf(mediaType: string): AllowedMediaType {
  return (ALLOWED_MEDIA_TYPES as readonly string[]).includes(mediaType)
    ? (mediaType as AllowedMediaType)
    : 'image/jpeg'
}

const defaultDeps: Required<ProductFidelityDeps> = {
  fetchImageBase64: defaultFetchImageBase64,
  callVision: async (renderedImage, referenceImage, opts) => {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const { SONNET } = await import('./models.server')
    const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']?.trim() })
    const strict = opts?.strict === true
    const msg = await client.messages.create({
      model: SONNET,
      max_tokens: 300,
      system: strict
        ? `${PRODUCT_FIDELITY_SYSTEM_PROMPT}\n\nReply with the JSON object only. No prose, no explanation, no markdown fence: the first character of your reply must be "{" and the last must be "}".`
        : PRODUCT_FIDELITY_SYSTEM_PROMPT,
      ...(strict ? { temperature: 0 } : {}),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'GENERATED image (judge the product in this one):' },
            { type: 'image', source: { type: 'base64', media_type: mediaTypeOf(renderedImage.mediaType), data: renderedImage.data } },
            { type: 'text', text: 'REAL BARE PRODUCT REFERENCE (compare against this one):' },
            { type: 'image', source: { type: 'base64', media_type: mediaTypeOf(referenceImage.mediaType), data: referenceImage.data } },
            { type: 'text', text: 'Return the JSON verdict now.' },
          ],
        },
      ],
    })
    const block = msg.content[0]
    if (block?.type !== 'text') throw new Error('product-fidelity check: unexpected response block type')
    const cleaned = block.text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
    return JSON.parse(cleaned)
  },
}

function resolve(deps?: ProductFidelityDeps): Required<ProductFidelityDeps> {
  return { ...defaultDeps, ...(deps ?? {}) }
}

/**
 * Run the product-fidelity check against an already-decoded rendered image
 * and reference image. Never throws: any failure (malformed response, model
 * error) returns `checkCompleted: false` rather than propagating, matching
 * `runVisionGateOnImage`'s contract.
 */
export async function runProductFidelityCheckOnImages(
  renderedImage: { data: string; mediaType: string },
  referenceImage: { data: string; mediaType: string },
  deps?: ProductFidelityDeps,
): Promise<ProductFidelityVerdict> {
  const d = resolve(deps)
  try {
    const parsed = await d.callVision(renderedImage, referenceImage)
    if (!isValidFidelityShape(parsed)) {
      return failClosedVerdict('Product-fidelity response did not match the expected shape; failing closed.')
    }
    return { ...parsed, checkedAt: new Date().toISOString(), checkCompleted: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return failClosedVerdict(`Product-fidelity check could not complete: ${message}`)
  }
}

/**
 * Run the product-fidelity check against a rendered image url and the bare
 * product reference url the generator was actually given (ticket #11487).
 * Never throws.
 */
export async function runProductFidelityCheck(
  renderedImageUrl: string,
  referenceImageUrl: string,
  deps?: ProductFidelityDeps,
): Promise<ProductFidelityVerdict> {
  const d = resolve(deps)
  try {
    const [rendered, reference] = await Promise.all([
      d.fetchImageBase64(renderedImageUrl),
      d.fetchImageBase64(referenceImageUrl),
    ])
    return await runProductFidelityCheckOnImages(rendered, reference, deps)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return failClosedVerdict(`Product-fidelity check could not complete: ${message}`)
  }
}
