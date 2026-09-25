/**
 * Owner image-feedback vocabulary (ticket #11551). Shared by the library UI,
 * the admin write path and the team read endpoint so they cannot drift. One
 * chip per lever the social team controls. Not server-only on purpose: the
 * grid popover renders these chips.
 */

export const FEEDBACK_VERDICTS = ['up', 'down'] as const
export type FeedbackVerdict = typeof FEEDBACK_VERDICTS[number]

export const DOWN_REASONS = [
  { value: 'product-drift', label: 'Product drift' },
  { value: 'pose-or-composition', label: 'Pose or composition' },
  { value: 'crop-too-tight', label: 'Crop too tight' },
  { value: 'crop-too-loose', label: 'Crop too loose' },
  { value: 'skin-treatment-off', label: 'Skin treatment off' },
  { value: 'over-the-ceiling', label: 'Over the ceiling' },
  { value: 'too-tame', label: 'Too tame' },
  { value: 'lighting-or-colour', label: 'Lighting or colour' },
  { value: 'cast-off-model', label: 'Cast off model' },
  { value: 'scene-or-location', label: 'Scene or location' },
  { value: 'ai-artifact', label: 'AI artifact' },
  { value: 'text-or-watermark', label: 'Text or watermark' },
  { value: 'other', label: 'Other' },
] as const

export const UP_REASONS = [
  { value: 'on-message', label: 'On message' },
  { value: 'more-like-this', label: 'More like this' },
  { value: 'product-faithful', label: 'Product faithful' },
  { value: 'composition', label: 'Composition' },
  { value: 'skin-treatment', label: 'Skin treatment' },
  { value: 'lighting', label: 'Lighting' },
  { value: 'cast-on-model', label: 'Cast on model' },
] as const

export type DownReason = typeof DOWN_REASONS[number]['value']
export type UpReason = typeof UP_REASONS[number]['value']

export const FEEDBACK_REASONS: Record<FeedbackVerdict, ReadonlyArray<{ value: string; label: string }>> = {
  up: UP_REASONS,
  down: DOWN_REASONS,
}

/** Library grid filter values (`?feedback=`). */
export const FEEDBACK_FILTERS = ['loved', 'rejected', 'unrated'] as const
export type FeedbackFilter = typeof FEEDBACK_FILTERS[number]

export function isFeedbackVerdict(v: unknown): v is FeedbackVerdict {
  return v === 'up' || v === 'down'
}

export function isFeedbackFilter(v: unknown): v is FeedbackFilter {
  return typeof v === 'string' && (FEEDBACK_FILTERS as readonly string[]).includes(v)
}

/** True when `reason` belongs to the vocabulary for `verdict`. */
export function isReasonFor(verdict: FeedbackVerdict, reason: string): boolean {
  return FEEDBACK_REASONS[verdict].some(r => r.value === reason)
}

export const NOTE_MAX = 1000
