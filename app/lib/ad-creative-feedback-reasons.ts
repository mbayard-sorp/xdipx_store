/**
 * Owner feedback vocabulary for ad creatives (Ad Studio v2, wires section 5.7).
 * Shared by the Ad Studio UI, the admin write path and the team read endpoint
 * so they cannot drift. Same exported shape as social-asset-feedback-reasons.ts.
 * Not server-only on purpose: the rating sheet renders these chips.
 */

export const FEEDBACK_VERDICTS = ['up', 'down'] as const
export type FeedbackVerdict = typeof FEEDBACK_VERDICTS[number]

export const UP_REASONS = [
  { value: 'on-policy', label: 'On policy' },
  { value: 'scroll-stopping', label: 'Scroll-stopping' },
  { value: 'hook-lands', label: 'Hook lands' },
  { value: 'product-faithful', label: 'Product faithful' },
  { value: 'more-like-this', label: 'More like this' },
] as const

export const DOWN_REASONS = [
  { value: 'off-policy', label: 'Off policy' },
  { value: 'too-tame', label: 'Too tame' },
  { value: 'weak-hook', label: 'Weak hook' },
  { value: 'product-drift', label: 'Product drift' },
  { value: 'text-legibility', label: 'Text legibility' },
  { value: 'wrong-format', label: 'Wrong format' },
  { value: 'other', label: 'Other' },
] as const

export type DownReason = typeof DOWN_REASONS[number]['value']
export type UpReason = typeof UP_REASONS[number]['value']

export const FEEDBACK_REASONS: Record<FeedbackVerdict, ReadonlyArray<{ value: string; label: string }>> = {
  up: UP_REASONS,
  down: DOWN_REASONS,
}

/** Rating filter values (`?rating=`), same as the library's `?feedback=`. */
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
