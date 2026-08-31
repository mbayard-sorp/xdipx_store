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
 * FAILS CLOSED throughout, matching social-publish-gate.server.ts's own
 * contract: a fetch that fails, a model call that errors, or a response that
 * does not parse as the expected shape all produce a FAILING verdict, never
 * a pass-by-default. "Could not check" and "checked and it's fine" are
 * different answers, and only the second one is `pass: true`.
 */

import { sql } from 'drizzle-orm'
import { socialMediaAssets } from '../../db/schema'
import { SONNET } from './models.server'
import { stripUrlQuery } from './social-asset-library.server'

/** The doctrine's hard checks (docs/design-doctrine.md:224), one verdict each. */
export type VisionCheckName =
  | 'limbCount'
  | 'handAnatomy'
  | 'faceBodyIntegrity'
  | 'extraOrMergedLimbs'

export const VISION_CHECK_NAMES: readonly VisionCheckName[] = [
  'limbCount',
  'handAnatomy',
  'faceBodyIntegrity',
  'extraOrMergedLimbs',
]

export interface VisionVerdict {
  /** True only when every check below passed. */
  pass: boolean
  checks: Record<VisionCheckName, 'pass' | 'fail'>
  /** Free-text reasoning, always present so a block finding can explain itself. */
  notes: string
  checkedAt: string
}

/** A verdict that fails every check, used whenever the check could not run at all. */
function failClosedVerdict(notes: string): VisionVerdict {
  const checks = {} as Record<VisionCheckName, 'pass' | 'fail'>
  for (const name of VISION_CHECK_NAMES) checks[name] = 'fail'
  return { pass: false, checks, notes, checkedAt: new Date().toISOString() }
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
  return true
}

const VISION_SYSTEM_PROMPT = `You are a strict anatomy QA reviewer for AI-generated marketing imagery. You will be shown one image. Check ONLY these four things, matching docs/design-doctrine.md's vision-gate hard check:

1. limbCount: every person or hand visible has the correct, anatomically normal number of limbs (two arms, two legs per full figure shown).
2. handAnatomy: every visible hand has five fingers, normally proportioned and articulated, with no fused or missing digits.
3. faceBodyIntegrity: faces and bodies are coherent, not warped, duplicated, or melted together.
4. extraOrMergedLimbs: no extra, duplicated, or merged limbs anywhere in the frame (including partially visible limbs at the edge of frame).

Respond with ONLY a JSON object, no prose before or after, in exactly this shape:
{"pass": true|false, "checks": {"limbCount": "pass"|"fail", "handAnatomy": "pass"|"fail", "faceBodyIntegrity": "pass"|"fail", "extraOrMergedLimbs": "pass"|"fail"}, "notes": "one or two sentences on what you saw, especially for any fail"}

"pass" is true only when all four checks are "pass". If the image has no visible people or hands at all (a product-only shot), every check passes trivially and "pass" is true. When in doubt about a genuine anatomy defect, fail the check; this gate exists specifically to catch what a fast human scroll would catch.`

export interface VisionGateDeps {
  fetchImageBase64?: (url: string) => Promise<{ data: string; mediaType: string }>
  callVision?: (imageBase64: string, mediaType: string) => Promise<unknown>
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
  callVision: async (imageBase64, mediaType) => {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']?.trim() })
    const allowedMediaTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
    const media = (allowedMediaTypes as readonly string[]).includes(mediaType)
      ? (mediaType as (typeof allowedMediaTypes)[number])
      : 'image/jpeg'
    const msg = await client.messages.create({
      model: SONNET,
      max_tokens: 400,
      system: VISION_SYSTEM_PROMPT,
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
    return JSON.parse(cleaned)
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
 * Run the vision gate against one image url. Never throws: any failure along
 * the way (fetch, model call, malformed response) returns a failing verdict
 * rather than propagating, because a generation step that cannot complete
 * this check must treat that exactly like a real anatomy defect.
 */
export async function runVisionGate(imageUrl: string, deps?: VisionGateDeps): Promise<VisionVerdict> {
  const d = resolve(deps)
  try {
    const { data, mediaType } = await d.fetchImageBase64(imageUrl)
    const parsed = await d.callVision(data, mediaType)
    if (!isValidVerdictShape(parsed)) {
      return failClosedVerdict('Vision gate response did not match the expected verdict shape; failing closed.')
    }
    return { ...parsed, checkedAt: new Date().toISOString() }
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
