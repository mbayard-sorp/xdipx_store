/**
 * What the review card shows when an owner action is REFUSED (ticket #5476).
 *
 * The bug this fixes: a refused Post-now looked identical to nothing happening.
 * The click worked, the server correctly refused the publish (an Instagram
 * caption carrying removal-tier vocabulary, per the manual-publish gate), and
 * the row correctly stayed a draft, but the only sign of it was a 12px red line
 * at the very bottom of a tall card. The owner read that as "the button is
 * broken" and lost trust in the queue.
 *
 * The fix is presentational, not behavioural: the deterministic checks are
 * unchanged and still refuse exactly what they refused before. This module only
 * decides WHICH refusal notices a card should render right now, so that decision
 * can be unit-tested in node without a DOM (the repo has no component-render
 * harness). The card maps the result to a prominent, dismissable banner beside
 * the buttons that were clicked.
 */

/** Which owner action was refused; drives placement and the plain-language heading. */
export type RefusalSource = 'post' | 'review' | 'apply'

export interface Refusal {
  source: RefusalSource
  /** Names the outcome plainly, e.g. "Not published", never a bare error line. */
  heading: string
  /**
   * The refusal reason verbatim from the server. For a Post-now lexicon refusal
   * this already names the offending term and the remedy the check computed
   * ("... carries removal-tier vocabulary: clitoris ... Rewrite in
   * mechanism-and-health framing ..."), so nothing here re-derives it.
   */
  message: string
  /** An optional one-click way to act on the refusal, e.g. open the Composer. */
  action?: { to: string; label: string }
}

/** The `{ ok, error }` shape a fetcher / apply-result carries, or nothing yet. */
export type ActionOutcome = { ok: boolean; error?: string } | null | undefined

/** Fallback copy so a heading never renders over an empty body. */
const DEFAULTS: Record<RefusalSource, { heading: string; message: string }> = {
  post: { heading: 'Not published', message: 'Something went wrong.' },
  review: { heading: 'Not saved', message: 'Something went wrong.' },
  apply: { heading: 'Rework failed', message: 'Could not apply your feedback.' },
}

export interface RefusalInputs {
  postId: number
  /** postFetcher.data — the Post-now result. */
  post: ActionOutcome
  /** fetcher.data — the Approve / Send back / Reject review result. */
  review: ActionOutcome
  /** applyResult — the "Apply my feedback now" result. */
  apply: ActionOutcome
  /** Per-source dismissal, so a notice survives until the owner clears it. */
  dismissed: { post: boolean; review: boolean; apply: boolean }
}

/** True only for an outcome that has resolved to a failure. */
function failed(outcome: ActionOutcome): outcome is { ok: false; error?: string } {
  return outcome?.ok === false
}

/**
 * The refusal banners to render, in visual order (the refused action first).
 * A dismissed or not-yet-failed source contributes nothing.
 */
export function refusalNoticesFor(input: RefusalInputs): Refusal[] {
  const out: Refusal[] = []

  if (failed(input.post) && !input.dismissed.post) {
    out.push({
      source: 'post',
      heading: DEFAULTS.post.heading,
      message: input.post.error?.trim() || DEFAULTS.post.message,
      // The offending word is in the message; this is the one-click path to fix
      // it, rather than making the owner hunt for it in the caption.
      action: { to: `/admin/socials/compose/${input.postId}`, label: 'Rewrite the caption in the Composer →' },
    })
  }

  if (failed(input.review) && !input.dismissed.review) {
    out.push({
      source: 'review',
      heading: DEFAULTS.review.heading,
      message: input.review.error?.trim() || DEFAULTS.review.message,
    })
  }

  if (failed(input.apply) && !input.dismissed.apply) {
    out.push({
      source: 'apply',
      heading: DEFAULTS.apply.heading,
      message: input.apply.error?.trim() || DEFAULTS.apply.message,
    })
  }

  return out
}
