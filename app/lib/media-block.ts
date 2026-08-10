/**
 * Classifier for image/video generation failures.
 *
 * WHY THIS EXISTS. The bake-off on 2026-08-10 found that a large part of the
 * catalog could not be rendered at all by the model then wired into the
 * scene-frame path: `nano-banana/edit` returned 422 content_policy for an
 * ordinary catalog vibrator at every safety_tolerance. None of that was visible
 * anywhere. `generate-image.server.ts` swallowed provider failures into a
 * `console.warn` and fell through to the next provider, so "how often does a
 * tasteful sexual-wellness brief get refused, and by which model" was a feeling
 * rather than a number.
 *
 * A refusal and an outage are not the same event and must not be counted
 * together: a refusal means route this surface to a different model, an outage
 * means retry. This module is the single place that tells them apart.
 *
 * PURE. No server-only imports, no I/O — so it is cheap to unit-test against
 * real captured provider payloads.
 */

/** Why a generation attempt failed. */
export type MediaFailureReason =
  | 'content_policy'  // the provider refused the content. Routing decision.
  | 'rate_limit'      // throttled. Retry later.
  | 'auth'            // bad or missing key. Config problem.
  | 'timeout'         // aborted or timed out. Retry.
  | 'server'          // provider 5xx. Retry.
  | 'unknown'

/** Which input the provider objected to, when it says. */
export type MediaFailureSurface = 'prompt' | 'image' | null

export interface MediaFailure {
  reason: MediaFailureReason
  surface: MediaFailureSurface
}

/** True when the provider refused the content rather than failing to serve it. */
export function isContentBlock(f: MediaFailure): boolean {
  return f.reason === 'content_policy'
}

/**
 * Provider-agnostic signals that a refusal happened. Kept broad on purpose:
 * fal surfaces a typed `content_policy_violation`, while Gemini only ever
 * returns prose, and a refusal miscounted as an outage is the failure mode this
 * whole module exists to prevent.
 */
const CONTENT_PATTERNS = [
  /content[_ ]policy/i,
  /content checker/i,
  /flagged by/i,
  /safety filter/i,
  /blocked by safety/i,
  /may have been filtered/i,
  /safety[_ ]?(?:violation|block)/i,
  /\bNSFW\b/i,
]

function surfaceFrom(body: string): MediaFailureSurface {
  // fal shape: {"detail":[{"loc":["body","prompt"], ...}]}
  if (/"loc"\s*:\s*\[[^\]]*"prompt"/i.test(body)) return 'prompt'
  if (/"loc"\s*:\s*\[[^\]]*"image[^"]*"/i.test(body)) return 'image'
  // Gemini prose fallback.
  if (/prompt may have been filtered/i.test(body)) return 'prompt'
  return null
}

/**
 * Classify from a raw provider response. `body` may be JSON or prose; it is
 * matched as text so an unexpected error shape degrades to 'unknown' instead of
 * throwing inside an error path.
 */
export function classifyProviderResponse(status: number, body: string): MediaFailure {
  const text = body ?? ''
  if (CONTENT_PATTERNS.some(re => re.test(text))) {
    return { reason: 'content_policy', surface: surfaceFrom(text) }
  }
  if (status === 429) return { reason: 'rate_limit', surface: null }
  if (status === 401 || status === 403) return { reason: 'auth', surface: null }
  if (status === 408 || status === 504) return { reason: 'timeout', surface: null }
  // 422 with no recognizable content signal is still most likely a refusal:
  // every 422 observed from fal in the bake-off was one, and providers reword
  // these messages without notice.
  if (status === 422) return { reason: 'content_policy', surface: surfaceFrom(text) }
  if (status >= 500) return { reason: 'server', surface: null }
  return { reason: 'unknown', surface: null }
}

/**
 * Classify from a thrown Error. Used on the Imagen path, which throws prose,
 * and for any caller that only has the exception.
 */
export function classifyMediaFailure(err: unknown): MediaFailure {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (CONTENT_PATTERNS.some(re => re.test(msg))) {
    return { reason: 'content_policy', surface: surfaceFrom(msg) }
  }
  if (/\b429\b|rate.?limit|too many requests/i.test(msg)) return { reason: 'rate_limit', surface: null }
  if (/\b401\b|\b403\b|unauthorized|forbidden|api key|FAL_KEY/i.test(msg)) return { reason: 'auth', surface: null }
  if (/timeout|timed out|aborted|ETIMEDOUT/i.test(msg)) return { reason: 'timeout', surface: null }
  if (/\b5\d\d\b/.test(msg)) return { reason: 'server', surface: null }
  return { reason: 'unknown', surface: null }
}

/**
 * Encoded into api_token_log.ref_id, because a dedicated blocks table would need
 * a migration and db/schema.ts is a protected path. Parsed back by
 * getMediaBlockRollup(). If this ever earns its own table, this pair of
 * functions is the seam to replace.
 */
export function encodeBlockRef(f: MediaFailure): string {
  return `${f.reason}/${f.surface ?? '-'}`
}

export function decodeBlockRef(ref: string | null): MediaFailure {
  // Note ''.split('/') is [''], not [], so a destructuring default would not
  // fire here. Empty segments must be normalized explicitly.
  const [rawReason, rawSurface] = (ref ?? '').split('/')
  const surface = rawSurface || '-'
  return {
    reason: (rawReason || 'unknown') as MediaFailureReason,
    surface: surface === '-' ? null : (surface as MediaFailureSurface),
  }
}
