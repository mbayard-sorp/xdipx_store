/**
 * Splits Emma's SMS reply into one or more deliverable segments. Each segment
 * is a Twilio <Message>: a body, plus an optional MMS image URL.
 *
 * Two split rules apply, in order:
 *
 *   1. Multi-product split (Emma-driven). Pitches separated by a line
 *      containing only "---" become separate segments. Taught in SMS_MODE.
 *
 *   2. URL-on-own-line split (mechanical). Within each post-`---` segment,
 *      a PDP URL on its own line is pulled into its OWN segment. iMessage
 *      auto-previews a URL only when the bubble contains JUST the URL —
 *      mixing prose with the URL suppresses the preview card. Splitting the
 *      URL into its own bubble triggers the rich preview reliably and lets
 *      us skip MMS attachments entirely (~10% the cost). The closing CTA
 *      ("👍 to add it" / "Sound right?") stays with the prose so the action
 *      ask is still visible above the preview card.
 *
 * Replies without any URL (commit acks, age-gate, STOP/HELP) pass through
 * as one plain-text segment.
 *
 * No mediaUrl is attached — iMessage's URL preview replaces the MMS image
 * we used to send, at a fraction of the cost. See commit 3209c0b for the
 * rationale and cost numbers.
 */

export interface SmsSegment {
  body: string
  mediaUrl?: string
}

const PDP_URL_LINE_RE = /^[ \t]*(https?:\/\/xdipx\.com\/products\/[a-z0-9][a-z0-9-]*)[ \t]*$/im
const SPLIT_RE = /\n\s*-{3,}\s*\n/g

/**
 * Pull a PDP URL out of prose when it sits on its own line, returning
 * `[textWithoutUrl, url]`. Returns `[prose]` unchanged when no URL line is
 * found, or `[url]` when the prose was just a URL by itself.
 *
 * Surrounding blank lines collapse so the prose still reads cleanly after
 * the URL is removed.
 */
export function splitProseAtUrl(prose: string): string[] {
  if (!prose) return [prose]
  const match = prose.match(PDP_URL_LINE_RE)
  if (!match || !match[1]) return [prose]
  const url = match[1]
  const remainder = prose
    .replace(PDP_URL_LINE_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!remainder) return [url]
  return [remainder, url]
}

/**
 * Split a reply into deliverable Twilio segments. Applies the multi-product
 * `---` split first, then the URL-on-own-line split inside each result.
 * Returns at least one segment.
 */
export async function splitSmsReplyForMms(reply: string): Promise<SmsSegment[]> {
  if (!reply) return [{ body: '' }]

  const rawSegments = reply.split(SPLIT_RE).map((s) => s.trim()).filter(Boolean)
  if (rawSegments.length === 0) return [{ body: reply.trim() }]

  return rawSegments.flatMap((body): SmsSegment[] =>
    splitProseAtUrl(body).map((part) => ({ body: part })),
  )
}
