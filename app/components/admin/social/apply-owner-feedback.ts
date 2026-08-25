/**
 * Client-side orchestration for "Apply my feedback now" (ticket #5414).
 *
 * Chains three named intents on /api/admin/social-rework so a single click
 * reworks the caption (and optionally the image) from the feedback the owner
 * just typed and files the result as a fresh reviewable row, instead of
 * waiting for the next drafting routine pass (14:00 / 22:00 UTC, "sat
 * unactioned for up to a day"). Shared by PostPreviewCard and the Composer
 * inspector so the sequencing and failure messages match on both surfaces.
 *
 * Any step failing stops the chain and returns its reason verbatim: nothing
 * here should ever look like it worked when it did not. No step approves or
 * publishes anything; the filed row always lands at pending_review.
 */

export interface ApplyFeedbackResult {
  ok: boolean
  id?: number
  error?: string
}

async function postRework(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch('/api/admin/social-rework', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json().catch(() => ({ ok: false, error: 'The server sent back something unreadable.' }))
}

export async function applyOwnerFeedback(opts: {
  postId: number
  feedback: string
  /** Also redraw the image from this feedback; bills the social image budget. */
  alsoRegenerateImage: boolean
  mediaUrls: string[]
  imageBrief?: string | null
  subject?: string | null
  scheduledFor?: string | null
}): Promise<ApplyFeedbackResult> {
  const captionRes = await postRework({ intent: 'rework-caption', postId: opts.postId, feedback: opts.feedback })
  if (!captionRes['ok']) {
    return { ok: false, error: String(captionRes['error'] ?? 'Could not redraft the caption from your feedback.') }
  }

  let mediaUrls = opts.mediaUrls
  if (opts.alsoRegenerateImage) {
    const imageRes = await postRework({ intent: 'regenerate-image', postId: opts.postId, feedback: opts.feedback })
    if (!imageRes['ok']) {
      return {
        ok: false,
        error: String(imageRes['message'] ?? imageRes['error'] ?? 'Could not regenerate the image from your feedback.'),
      }
    }
    const url = String(imageRes['url'] ?? '')
    if (url) mediaUrls = [url, ...mediaUrls.slice(1)]
  }

  const rowRes = await postRework({
    intent: 'create-rework-row',
    fromPostId: opts.postId,
    caption: captionRes['caption'],
    altText: captionRes['altText'] ?? null,
    mediaUrls,
    imageBrief: opts.imageBrief ?? null,
    subject: opts.subject ?? null,
    scheduledFor: opts.scheduledFor ?? null,
  })
  if (!rowRes['ok']) {
    return { ok: false, error: String(rowRes['error'] ?? 'Could not file the reworked draft.') }
  }
  return { ok: true, id: Number(rowRes['id']) }
}
