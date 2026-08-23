/**
 * Live-post feedback encoding (ticket #2738).
 *
 * Deliberately NOT a `.server.ts` module. These are pure string helpers and the
 * Social Studio renders a stored verdict in component code, so putting them in
 * `team.server.ts` broke the client build: React Router strips server-only
 * imports from `loader`, `action`, `middleware` and `headers`, and from nothing
 * else. A component that reaches into a `.server` module takes the whole module
 * with it. The writer that touches the database stays in `team.server.ts`; only
 * the encoding lives here, where both sides can reach it.
 *
 * The vocabulary is intentionally separate from `review_status`. That field is
 * the record of the decision that let a post ship, and `reviewSocialPost`
 * refuses posted rows on the principle that review is an editorial gate on
 * drafts rather than a way to relabel history. Asking "now that it is live, was
 * it any good" is a different question at a different time, so it gets its own
 * words and leaves the pre-publish verdict alone.
 */

export const LIVE_POST_VERDICTS = ['worked', 'off', 'pull'] as const
export type LivePostVerdict = (typeof LIVE_POST_VERDICTS)[number]

export function isLivePostVerdict(v: unknown): v is LivePostVerdict {
  return typeof v === 'string' && (LIVE_POST_VERDICTS as readonly string[]).includes(v)
}

/** `[live:worked] note` — greppable, parseable, and readable as plain text. */
const LIVE_FEEDBACK_RE = /^\[live:(worked|off|pull)\]\s*([\s\S]*)$/

/**
 * A gate stamp block carried behind the live verdict for burn-in (#4913,
 * `preserveGateStamp`). Cut from the note so the Studio shows the owner's
 * words, not the gate's. Kept as a plain regex here because this module is
 * client-safe and must not import the `.server` parser.
 * TODO(#4913 burn-in): remove with the stamp.
 */
const TRAILING_STAMP_RE = /\n\n\[publish-gate (?:PASS|REVISE|BLOCK|HOLD) by [\s\S]*$/

export function formatLiveFeedback(verdict: LivePostVerdict, note: string): string {
  const body = note.trim()
  return body ? `[live:${verdict}] ${body}` : `[live:${verdict}]`
}

/**
 * Parse a stored feedback string back into a verdict. Returns null for
 * pre-publish feedback, which has no tag, so the social retro can tell the two
 * kinds apart when it reads a row.
 */
export function parseLiveFeedback(
  feedback: string | null | undefined,
): { verdict: LivePostVerdict; note: string } | null {
  if (!feedback) return null
  const m = LIVE_FEEDBACK_RE.exec(feedback.trim())
  if (!m) return null
  return { verdict: m[1] as LivePostVerdict, note: (m[2] ?? '').replace(TRAILING_STAMP_RE, '').trim() }
}
