/**
 * Vision-gate hard check for generated social imagery (ticket #6763).
 *
 * Incident: social_posts #145, posted 2026-08-30, removed by the owner the
 * same day, reason: the cast member in the generated image had three arms.
 * No gate caught it, because `social-publish-gate.server.ts` is text-only by
 * design (its own header: "reviews strings, never opens the images") and
 * nothing else in `app/` actually opened the buffer. The "vision gate" was
 * doctrine (docs/design-doctrine.md:224, "Vision-gate hard check: hand
 * anatomy") and agent judgment, never code, on the unattended social path.
 *
 * This module is the code enforcement: a multimodal read of a generated
 * image returning a structured verdict on the doctrine's hard checks (limb
 * and digit count, hand anatomy, face/body integrity, extra or merged
 * limbs), recorded onto the asset's `social_media_assets` row so the publish
 * gate can refuse to PASS a draft whose media has no recorded verdict.
 *
 * Extended (ticket #10268) with three imagery-ceiling checks: nippleOccluded,
 * genitaliaAbsent, adultUnambiguous. The original four checks alone let a
 * bare torso or hip crop with no hands in frame pass trivially, so nothing
 * in the unattended path ever asked whether a generated frame stayed inside
 * docs/design-doctrine.md section 3.2a's exposure ceiling. Two owner-preview
 * generations broke that fence (full nudity) without the prompt ever asking
 * for it, which is why the check has to live on the produced pixels rather
 * than on prompt wording.
 *
 * Extended again (ticket #10279) with `legibleText`, a REPORT field rather
 * than a pass/fail check: it never gates `pass`. The owner ruled a
 * manufacturer's brand mark on a product we genuinely stock and feature is
 * fine, while packaging junk (barcodes, shipping labels, printed ingredient
 * paragraphs) and baked-in caption/watermark text are not, and that is a
 * policy call this module has no business making per-SKU. So the gate transcribes
 * whatever text it finds and leaves the pass/fail judgment to the caller.
 *
 * FAILS CLOSED throughout, matching social-publish-gate.server.ts's own
 * contract: a fetch that fails, a model call that errors, or a response that
 * does not parse as the expected shape all produce a FAILING verdict, never
 * a pass-by-default. "Could not check" and "checked and it's fine" are
 * different answers, and only the second one is `pass: true`.
 *
 * Reused (ticket #8691) by the Notebook hero generation path
 * (scripts/gen-notebook-art.ts) via `runVisionGateOnImage`, the buffer-based
 * core `runVisionGate` itself delegates to: that path holds a local,
 * not-yet-uploaded candidate buffer rather than a live url, but the same
 * doctrine checks apply, so it calls the same checks directly instead of
 * forking a second implementation.
 */

import { sql } from 'drizzle-orm'
import { socialMediaAssets } from '../../db/schema'
import { SONNET } from './models.server'
import { stripUrlQuery } from './social-asset-library.server'

/**
 * The doctrine's hard checks (docs/design-doctrine.md:224) plus the imagery-ceiling
 * checks added by ticket #10268: the original four catch anatomy defects, but nothing
 * checked whether a generated frame stayed inside section 3.2a's exposure ceiling.
 * A torso crop with no hands in it passed every anatomy check trivially, so two
 * owner-preview generations this session broke the fence (full nudity) without the
 * prompt ever asking for it.
 *
 * `anusNotVisible` (ticket #10477) is the owner's 2026-09-20 nudity definition
 * (nipples, labia, penis, anus) finished in pixels: the first three were
 * checked and the fourth was policed only as a caption-text regex. It is a
 * SEPARATE check rather than a widening of `genitaliaAbsent`, deliberately.
 * `genitaliaAbsent` carries the clause "no product is depicted in contact with
 * genitalia", and folding the anal region into `genitalia` would fail the
 * plug-between-the-cheeks placement that
 * docs/store-team/instagram-campaigns.md section 3.2c licenses at ceiling
 * tier. That doc keeps the anus line and the product-against-genitalia line as
 * separate stop-list entries for the same reason, and the publish gate's block
 * message names the failing check to the drafter, so a merged check would send
 * a re-brief for the wrong thing. Named for the organ, not the region: the
 * licensed frame shows the region.
 */
export type VisionCheckName =
  | 'limbCount'
  | 'handAnatomy'
  | 'faceBodyIntegrity'
  | 'extraOrMergedLimbs'
  | 'nippleOccluded'
  | 'genitaliaAbsent'
  | 'anusNotVisible'
  | 'adultUnambiguous'

export const VISION_CHECK_NAMES: readonly VisionCheckName[] = [
  'limbCount',
  'handAnatomy',
  'faceBodyIntegrity',
  'extraOrMergedLimbs',
  'nippleOccluded',
  'genitaliaAbsent',
  'anusNotVisible',
  'adultUnambiguous',
]

export interface VisionVerdict {
  /** True only when every check below passed. */
  pass: boolean
  /**
   * `null` only on the specific `checkCompleted: false` case where the model
   * never returned a parseable verdict at all, even after a retry (ticket
   * #10990/#11004): there is no per-check read to report, real or fail-closed,
   * so the field says so rather than claiming a "fail" reading against pixels
   * nobody actually judged. Every other `checkCompleted: false` path (fetch
   * error, model-call error, malformed shape) keeps the pre-existing
   * all-`'fail'` fail-closed shape, unchanged.
   */
  checks: Record<VisionCheckName, 'pass' | 'fail'> | null
  /** Free-text reasoning, always present so a block finding can explain itself. */
  notes: string
  checkedAt: string
  /**
   * True only when the model actually returned and parsed a real verdict on
   * this image. False means the check itself never ran to completion (auth
   * failure, transport error, timeout, or a malformed response) and `pass:
   * false` here is the fail-closed default, not a genuine anatomy read.
   * Callers that bill for a judged image (ticket #8830) must key off this,
   * not `pass`: a real anatomy FAIL should still bill (the image was
   * produced and judged), a check that never completed should not (nothing
   * was evaluated, let alone kept).
   */
  checkCompleted: boolean
  /**
   * Ticket #10279: transcription of any legible text, wordmark, barcode, or
   * label found anywhere in the frame, or `''` when the check ran and found
   * none. This is a REPORT field, not a check: it never participates in
   * `pass` and has no entry in `checks`. The owner ruled a brand mark on a
   * product we genuinely stock and feature is fine, but packaging junk
   * (barcodes, shipping labels, printed ingredient text) and baked-in
   * caption/watermark text are not, and that is a per-case policy call this
   * gate cannot make, so it surfaces what it read and leaves pass/fail to
   * the caller. `null` means the check never ran at all (the fail-closed
   * path, same distinction `checkCompleted` draws for the pass/fail checks).
   */
  legibleText: string | null
  /**
   * Ticket #11477: transcription of any unbriefed mark, redness, bruising, or
   * abrasion visible on skin, or `''` when the check ran and found none. A
   * REPORT field, like `legibleText`: it never participates in `pass` and has
   * no entry in `checks`. Report-only on purpose (the ticket's own DONE WHEN):
   * the model already produces marks nobody briefed (asset 706, a bead strand
   * on a bare lower back with faint unbriefed pink-red streaks and blotches),
   * but 3.2c also requires "natural unretouched skin texture", so this needs
   * its verdicts reviewed against a run of real on-skin assets before it can
   * safely gate anything — a check that fails ordinary warm skin tone or
   * texture would be worse than the problem it exists to catch. `null` means
   * the check never ran at all, same distinction `legibleText` draws.
   */
  skinMarks: string | null
}

/** A verdict that fails every check, used whenever the check could not run at all. */
function failClosedVerdict(notes: string): VisionVerdict {
  const checks = {} as Record<VisionCheckName, 'pass' | 'fail'>
  for (const name of VISION_CHECK_NAMES) checks[name] = 'fail'
  return { pass: false, checks, notes, checkedAt: new Date().toISOString(), checkCompleted: false, legibleText: null, skinMarks: null }
}

/**
 * A verdict for the one case that is not "checked and it's fine" nor "checked
 * and it failed": the model answered in prose instead of JSON, twice (ticket
 * #10990/#11004). `failClosedVerdict` reports `checks: {...all 'fail'}`, which
 * reads as a genuine anatomy read to anything that inspects individual checks
 * instead of `checkCompleted`; this verdict reports `checks: null` instead, so
 * a caller that only looks at `checks` cannot mistake "never judged" for "judged
 * and rejected". `pass`/`checkCompleted` still fail closed exactly like
 * `failClosedVerdict`, so nothing that only reads those two fields needs to
 * change.
 */
function incompleteVerdict(notes: string): VisionVerdict {
  return { pass: false, checks: null, notes, checkedAt: new Date().toISOString(), checkCompleted: false, legibleText: null, skinMarks: null }
}

/**
 * Thrown by `callVision` specifically when the model's response could not be
 * parsed as JSON, carrying the raw text (ticket #10990) so the caller can log
 * what actually came back and decide whether to retry, distinct from a
 * transport or auth error which is never worth retrying with a stricter
 * prompt.
 */
export class VisionParseError extends Error {
  constructor(
    message: string,
    public readonly rawText: string,
  ) {
    super(message)
    this.name = 'VisionParseError'
  }
}

/** Structural validation of a parsed model response before it is trusted as a verdict. */
export function isValidVerdictShape(v: unknown): v is Omit<VisionVerdict, 'checkedAt'> {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (typeof o['pass'] !== 'boolean') return false
  if (typeof o['notes'] !== 'string') return false
  const checks = o['checks']
  if (!checks || typeof checks !== 'object') return false
  const c = checks as Record<string, unknown>
  for (const name of VISION_CHECK_NAMES) {
    if (c[name] !== 'pass' && c[name] !== 'fail') return false
  }
  // Ticket #10279: legibleText is a report field, not a check, but a real
  // model response must always carry it as a string (possibly ''). A
  // response missing it, or carrying the wrong type, did not follow the
  // expected shape and fails closed like any other malformed response.
  if (typeof o['legibleText'] !== 'string') return false
  // Ticket #11477: skinMarks is a report field, same contract as legibleText.
  if (typeof o['skinMarks'] !== 'string') return false
  return true
}

/**
 * Exported so the calibration of `anusNotVisible` is testable as text
 * (ticket #10477). The check has two failure directions and only one of them
 * is obvious: missing a real anus, and over-firing on the licensed
 * plug-along-the-cleft frame that section 3.2c puts at ceiling tier. The
 * second is what a well-meaning later edit produces, and the only artifact
 * that decides it is this wording.
 */
export const VISION_SYSTEM_PROMPT = `You are a strict content-safety QA reviewer for AI-generated marketing imagery on a mainstream sexual-wellness storefront. You will be shown one image. Check these eight things, matching docs/design-doctrine.md's vision-gate hard check plus the imagery-ceiling checks, PLUS two report-only items at the end:

1. limbCount: every person or hand visible has the correct, anatomically normal number of limbs (two arms, two legs per full figure shown).
2. handAnatomy: every visible hand has five fingers, normally proportioned and articulated, with no fused or missing digits.
3. faceBodyIntegrity: faces and bodies are coherent, not warped, duplicated, or melted together.
4. extraOrMergedLimbs: no extra, duplicated, or merged limbs anywhere in the frame (including partially visible limbs at the edge of frame).
5. nippleOccluded: no nipple or areola is visible or outlined anywhere in frame, including through sheer or wet fabric. Fail if any nipple or areola is visible or outlined.
6. genitaliaAbsent: no labia or penis is visible or outlined, no product is depicted in contact with genitalia, and no fluid is depicted on or near genitalia. Fail if any of these is present.
7. anusNotVisible: no anus is visible or outlined anywhere in frame. Bare buttocks, the visible line of the gluteal cleft, and a product laid along, across or beside the cleft are all PERMITTED and must pass this check: a bare rear is not a failure, and the crease between the buttocks is not a failure. Fail ONLY when the anus itself is depicted, or when its shape is discernibly outlined, including when the buttocks are parted or spread by a pose, by a hand, or by a product, when a product's insertable portion is shown entering or seated in the body, or when it reads through sheer or wet fabric. Judge the anus, not the cleft. If you are uncertain whether a shadow in the cleft is the anus or a shadow, fail.
8. adultUnambiguous: the depicted person, if any, is unambiguously an adult. Judge this on ambiguity, not on apparent intent, and judge it explicitly even on a faceless body crop where the usual facial age markers are absent. Fail (do not pass) if there is any genuine uncertainty about adulthood.

REPORT ONLY, not a check, does not affect "pass": legibleText. Read the whole frame for any legible text: brand wordmarks, barcodes, shipping labels, printed ingredient text, captions, watermarks, anything with readable letters or numbers. Transcribe everything legible into one string, or return "" if there is none. This ALSO covers marks that are not cleanly readable: a molded or embossed logo area, a button, or a label surface that shows dot-and-dash shapes, garbled or partially-formed characters, or an illegible pseudo-text pattern where readable lettering is clearly attempted but the exact letters cannot be made out. Do not return "" just because you cannot read it cleanly; describe what you see instead (for example "garbled illegible marks beneath a circular button, resembling text but not readable" or "dot-and-dash pseudo-text on the product body"). Only return "" when there is truly no text or text-like mark anywhere in the frame. Never judge whether the text is acceptable; that is a policy decision made elsewhere with more context than you have (for example a manufacturer's wordmark on a product actually being sold is allowed, while a barcode or shipping label is not, and you cannot tell those apart from pixels alone in every case). Just report what you read, or what you see attempted.

REPORT ONLY, not a check, does not affect "pass": skinMarks. Look at every patch of bare skin in the frame for a mark that was not asked for: redness, a bruise, a scrape or abrasion, a welt, or a streak or blotch of discoloration. This is NOT about ordinary skin: natural skin tone, texture, freckles, moles, veins, tan lines, and normal warmth or flush from lighting are not marks and must not be reported. Report only something that reads as an injury or an impact mark on the skin itself: for example "faint pink-red streaks and blotches across the lower back and flank" or "a red welt across the outer thigh". Describe what you see and roughly where on the body, or return "" if bare skin is visible and carries nothing of the kind, or if no skin is visible at all. Never judge whether a reported mark makes the image unacceptable; that is a policy decision made elsewhere, which is exactly why this is report-only and not one of the eight checks above.

Respond with ONLY a JSON object, no prose before or after, in exactly this shape:
{"pass": true|false, "checks": {"limbCount": "pass"|"fail", "handAnatomy": "pass"|"fail", "faceBodyIntegrity": "pass"|"fail", "extraOrMergedLimbs": "pass"|"fail", "nippleOccluded": "pass"|"fail", "genitaliaAbsent": "pass"|"fail", "anusNotVisible": "pass"|"fail", "adultUnambiguous": "pass"|"fail"}, "notes": "one or two sentences on what you saw, especially for any fail", "legibleText": "<transcription of any legible text found, or empty string if none>", "skinMarks": "<description of any unbriefed mark on skin, or empty string if none>"}

"pass" is true only when all eight checks in "checks" are "pass"; neither "legibleText" nor "skinMarks" ever affects "pass". If the image has no visible people or hands at all (a product-only shot), checks 1-4 pass trivially; checks 5-8 still apply to any depicted skin or body part even without hands or a face; legibleText still applies to any text in the frame regardless, and skinMarks still applies to any bare skin in the frame regardless. When in doubt about a genuine anatomy defect or an exposure/age-ambiguity issue, fail the check; this gate exists specifically to catch what a fast human scroll would catch, and a false block costs one regeneration while a false pass can publish something it must not. "legibleText" and "skinMarks" are always present in your response, even when they are "".`

export interface VisionCallOpts {
  /**
   * Ticket #10990: set on the single retry after a JSON parse failure. The
   * default implementation appends a "reply with the JSON object only"
   * instruction and lowers temperature, on the theory that a prose reply is a
   * formatting slip, not a content re-read, so the retry should nudge format
   * rather than re-ask the substantive question.
   */
  strict?: boolean
}

export interface VisionGateDeps {
  fetchImageBase64?: (url: string) => Promise<{ data: string; mediaType: string }>
  callVision?: (imageBase64: string, mediaType: string, opts?: VisionCallOpts) => Promise<unknown>
  updateVerdict?: (assetId: number, verdict: VisionVerdict) => Promise<void>
  lookupVerdictByUrl?: (bareUrl: string) => Promise<VisionVerdict | null>
}

const defaultDeps: Required<VisionGateDeps> = {
  fetchImageBase64: async (url) => {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`fetch ${url} failed: HTTP ${res.status}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    const mediaType = (res.headers.get('content-type') ?? '').split(';')[0] || 'image/jpeg'
    return { data: buffer.toString('base64'), mediaType }
  },
  callVision: async (imageBase64, mediaType, opts) => {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']?.trim() })
    const allowedMediaTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
    const media = (allowedMediaTypes as readonly string[]).includes(mediaType)
      ? (mediaType as (typeof allowedMediaTypes)[number])
      : 'image/jpeg'
    const strict = opts?.strict === true
    const msg = await client.messages.create({
      model: SONNET,
      max_tokens: 400,
      system: strict
        ? `${VISION_SYSTEM_PROMPT}\n\nReply with the JSON object only. No prose, no explanation, no markdown fence: the first character of your reply must be "{" and the last must be "}".`
        : VISION_SYSTEM_PROMPT,
      // Ticket #10990: the retry lowers temperature toward deterministic
      // formatting rather than re-asking the substantive question; the first
      // attempt keeps the SDK default.
      ...(strict ? { temperature: 0 } : {}),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: media, data: imageBase64 } },
            { type: 'text', text: 'Return the JSON verdict now.' },
          ],
        },
      ],
    })
    const block = msg.content[0]
    if (block?.type !== 'text') throw new Error('vision gate: unexpected response block type')
    // Model sometimes wraps JSON in a fence despite instructions; strip it.
    const cleaned = block.text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
    try {
      return JSON.parse(cleaned)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new VisionParseError(message, block.text)
    }
  },
  updateVerdict: async (assetId, verdict) => {
    const { db } = await import('./db.server')
    await db
      .update(socialMediaAssets)
      .set({ visionVerdict: verdict, visionVerdictAt: new Date() })
      .where(sql`${socialMediaAssets.id} = ${assetId}`)
  },
  lookupVerdictByUrl: async (bareUrl) => {
    const { db } = await import('./db.server')
    const rows = await db
      .select({ visionVerdict: socialMediaAssets.visionVerdict })
      .from(socialMediaAssets)
      .where(sql`split_part(split_part(${socialMediaAssets.url}, '?', 1), '#', 1) = ${bareUrl}`)
      .limit(1)
    return rows[0]?.visionVerdict ?? null
  },
}

function resolve(deps?: VisionGateDeps): Required<VisionGateDeps> {
  return { ...defaultDeps, ...(deps ?? {}) }
}

/**
 * The three checks that together implement the owner's 2026-09-20 nudity
 * definition (ticket #11468). These are the ones a single confident-but-wrong
 * model read can turn into an account-banning false pass, so they are the
 * ones a second independent read has to confirm before `pass:true` reaches a
 * caller — see `confirmExposureChecks`.
 */
export const EXPOSURE_CHECK_NAMES: readonly VisionCheckName[] = ['nippleOccluded', 'genitaliaAbsent', 'anusNotVisible']

/** One model call, parsed into a verdict, with the existing JSON-parse-failure retry. Never throws. */
async function getOneVerdict(
  image: { data: string; mediaType: string },
  d: Required<VisionGateDeps>,
): Promise<VisionVerdict> {
  try {
    const parsed = await d.callVision(image.data, image.mediaType)
    if (!isValidVerdictShape(parsed)) {
      return failClosedVerdict('Vision gate response did not match the expected verdict shape; failing closed.')
    }
    return { ...parsed, checkedAt: new Date().toISOString(), checkCompleted: true }
  } catch (err) {
    if (err instanceof VisionParseError) {
      // A prose reply is a formatting slip, not a real refusal (ticket
      // #10990/#11004): log the raw text (part c of the fix) and retry once
      // with a stricter prompt before treating it as anything terminal.
      console.error('[social-vision-gate] response was not valid JSON, retrying once with a stricter prompt', {
        message: err.message,
        rawText: err.rawText,
      })
      try {
        const retried = await d.callVision(image.data, image.mediaType, { strict: true })
        if (!isValidVerdictShape(retried)) {
          return failClosedVerdict('Vision gate response did not match the expected verdict shape after a strict retry; failing closed.')
        }
        return { ...retried, checkedAt: new Date().toISOString(), checkCompleted: true }
      } catch (retryErr) {
        if (retryErr instanceof VisionParseError) {
          console.error('[social-vision-gate] response still not valid JSON after strict retry', {
            message: retryErr.message,
            rawText: retryErr.rawText,
          })
          // Not a genuine anatomy read in either direction: no verdict was ever
          // reached, so `checks` says so (null) rather than claiming a 'fail'
          // read against pixels nobody actually judged.
          return incompleteVerdict(`Vision gate check could not parse a JSON verdict after a strict retry: ${retryErr.message}`)
        }
        const message = retryErr instanceof Error ? retryErr.message : String(retryErr)
        return failClosedVerdict(`Vision gate check could not complete: ${message}`)
      }
    }
    const message = err instanceof Error ? err.message : String(err)
    return failClosedVerdict(`Vision gate check could not complete: ${message}`)
  }
}

/**
 * Confirm a clean exposure read with a second, independent model call before
 * trusting it (ticket #11468, P0).
 *
 * Incident: two verdicts pulled directly from production both read
 * `pass:true` on `nippleOccluded`/`genitaliaAbsent` while describing a frame
 * that did not match the actual pixels (asset 675: "no nipples... visible"
 * against a frame with a plainly visible nipple; asset 698: "wearing
 * underwear" against a bare hip with a linen throw). In both cases the model
 * produced a specific, confident, factually WRONG description and graded
 * against that description rather than the image — a single hallucinated
 * read is exactly what one model call cannot catch on its own, because
 * `notes` and `checks` come from the same pass and agree with each other by
 * construction.
 *
 * A second, independently-sampled call (fresh context, no memory of the
 * first call's answer) is unlikely to hallucinate the identical specific
 * error twice, so REQUIRING the two to agree on the three checks the owner's
 * nudity definition turns on converts one confident mistake into two
 * mistakes that have to coincide. Only runs when the first read is already
 * clean on all three (the risky case — a first-pass FAIL already fails
 * closed correctly and costs nothing extra to confirm), so this doubles
 * model spend only on the images that would otherwise ship. On disagreement,
 * or when the confirmation call itself cannot produce a valid verdict, this
 * fails closed: the two disagreeing checks flip to `'fail'`, `pass` becomes
 * `false`, and `notes` carries both reads so a human reviewing the block can
 * see exactly what the two calls disagreed about.
 */
async function confirmExposureChecks(
  image: { data: string; mediaType: string },
  first: VisionVerdict,
  d: Required<VisionGateDeps>,
): Promise<VisionVerdict> {
  if (!first.checkCompleted || !first.checks) return first
  const allClean = EXPOSURE_CHECK_NAMES.every((name) => first.checks![name] === 'pass')
  if (!allClean) return first

  const second = await getOneVerdict(image, d)
  if (!second.checkCompleted || !second.checks) {
    return {
      ...first,
      pass: false,
      checks: { ...first.checks, ...Object.fromEntries(EXPOSURE_CHECK_NAMES.map((n) => [n, 'fail' as const])) },
      notes: `Exposure confirmation pass could not complete (${second.notes}); failing closed rather than trusting a single read. First read: ${first.notes}`,
    }
  }

  const disagreements = EXPOSURE_CHECK_NAMES.filter((name) => second.checks![name] !== first.checks![name])
  if (disagreements.length === 0) return first

  console.error('[social-vision-gate] exposure confirmation pass disagreed with the first read; failing closed', {
    disagreements, firstChecks: first.checks, secondChecks: second.checks,
  })
  return {
    ...first,
    pass: false,
    checks: {
      ...first.checks,
      ...Object.fromEntries(disagreements.map((n) => [n, 'fail' as const])),
    },
    notes: `Exposure confirmation disagreement on ${disagreements.join(', ')}; failing closed. First read: "${first.notes}" Second read: "${second.notes}"`,
  }
}

/**
 * Run the vision gate against an already-decoded image (base64 data plus its
 * media type). Shared core for `runVisionGate` (url-based, fetches first) and
 * any caller that already holds the image bytes in memory, e.g. a local
 * generation buffer that has not been uploaded anywhere yet (the Notebook
 * hero path, gen-notebook-art.ts). Never throws, same fail-closed contract.
 */
export async function runVisionGateOnImage(
  image: { data: string; mediaType: string },
  deps?: VisionGateDeps,
): Promise<VisionVerdict> {
  const d = resolve(deps)
  const first = await getOneVerdict(image, d)
  return confirmExposureChecks(image, first, d)
}

/**
 * Run the vision gate against one image url. Never throws: any failure along
 * the way (fetch, model call, malformed response) returns a failing verdict
 * rather than propagating, because a generation step that cannot complete
 * this check must treat that exactly like a real anatomy defect.
 */
export async function runVisionGate(imageUrl: string, deps?: VisionGateDeps): Promise<VisionVerdict> {
  try {
    const { data, mediaType } = await resolve(deps).fetchImageBase64(imageUrl)
    return await runVisionGateOnImage({ data, mediaType }, deps)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return failClosedVerdict(`Vision gate check could not complete: ${message}`)
  }
}

/** Persist a verdict onto its asset's `social_media_assets` row. Never throws (logs, non-fatal). */
export async function recordVisionVerdict(
  assetId: number,
  verdict: VisionVerdict,
  deps?: VisionGateDeps,
): Promise<void> {
  try {
    await resolve(deps).updateVerdict(assetId, verdict)
  } catch (err) {
    console.error(`[social-vision-gate] failed to record verdict for asset ${assetId} (non-fatal)`, err)
  }
}

/**
 * Re-run the vision gate against an EXISTING asset's own url and record the
 * fresh result onto its row (ticket #10560/#10511: nothing before this could
 * refresh a stored verdict; it was written once at generation and stayed
 * whatever it was, so every check ever added to `VISION_CHECK_NAMES`
 * invalidated stored verdicts with no way to clear the backlog short of
 * throwing away a possibly-fine, already-paid-for frame and regenerating).
 *
 * Deliberately thin: fetch, judge, record, return. It never overwrites a
 * verdict without also recording it in full (the same `recordVisionVerdict`
 * write every generation path uses), so a re-gate can surface a genuine FAIL
 * but can never launder one — the caller (a publish-time re-check) always
 * reads back the complete new verdict, not a caller-asserted "it's fine now".
 */
export async function regateAsset(
  assetId: number,
  url: string,
  deps?: VisionGateDeps,
): Promise<VisionVerdict> {
  const verdict = await runVisionGate(url, deps)
  await recordVisionVerdict(assetId, verdict, deps)
  return verdict
}

/** The recorded verdict for a media url, or null when no library row carries one. */
export async function getVisionVerdictByUrl(url: string, deps?: VisionGateDeps): Promise<VisionVerdict | null> {
  const bare = stripUrlQuery(url)
  if (!bare) return null
  try {
    return await resolve(deps).lookupVerdictByUrl(bare)
  } catch (err) {
    console.error(`[social-vision-gate] verdict lookup failed, treating as missing: ${url}`, err)
    return null
  }
}

export interface GenerateWithVisionGateDeps {
  /** One generation + rehost + library-ingest attempt. Null means a true generation miss (nothing to gate). */
  generate: () => Promise<{ url: string; assetId: number | null } | null>
  runGate: (url: string) => Promise<VisionVerdict>
  recordVerdict: (assetId: number, verdict: VisionVerdict) => Promise<void>
  /** Homepage lane's own two-attempt budget (docs/homepage-team/mission-brief.md:142). Default 2. */
  maxAttempts?: number
}

export interface GenerateWithVisionGateResult {
  /** The passing candidate's url, or null when generation missed or the budget was exhausted. */
  url: string | null
  assetId: number | null
  verdict: VisionVerdict | null
  attempts: number
}

/**
 * Generate-and-check loop shared by every single-candidate social image
 * generator. Regenerates on a failing verdict up to `maxAttempts` (default
 * 2, matching the homepage lane's own vision-gate budget so behaviour is
 * consistent across surfaces), and never returns a failing candidate's url:
 * a rejected asset's row stays in the library for provenance (rows are never
 * deleted) but is never handed back as publishable.
 */
export async function generateWithVisionGate(
  deps: GenerateWithVisionGateDeps,
): Promise<GenerateWithVisionGateResult> {
  const maxAttempts = deps.maxAttempts ?? 2
  let lastVerdict: VisionVerdict | null = null
  let lastAssetId: number | null = null
  let attempts = 0

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt
    const generated = await deps.generate()
    if (!generated) break

    lastAssetId = generated.assetId
    const verdict = await deps.runGate(generated.url)
    lastVerdict = verdict
    if (generated.assetId != null) {
      await deps.recordVerdict(generated.assetId, verdict)
    }
    if (verdict.pass) {
      return { url: generated.url, assetId: generated.assetId, verdict, attempts }
    }
    // Falls through: loop regenerates unless the budget is exhausted.
  }

  return { url: null, assetId: lastAssetId, verdict: lastVerdict, attempts }
}
