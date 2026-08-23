/**
 * The publish-gate stamp as it appears inside `social_posts.feedback`, split
 * from the owner's own note. Client-safe (no `.server` suffix): the review
 * card needs to show the owner ONLY the note and never the machine stamp as
 * editable text, and the server writers need the same regex to preserve the
 * stamp during the Phase 5 burn-in. One definition, two consumers.
 */
export const STAMP_RE =
  /^\[publish-gate (PASS|REVISE|BLOCK|HOLD) by ([^\]]+?) on (\d{4}-\d{2}-\d{2}), product: ([a-z0-9._-]+|none)\]/m

/** `{ stamp, rest }`: the stamp paragraph (through the first blank line) and everything else. */
export function splitGateStamp(
  feedback: string | null | undefined,
): { stamp: string | null; rest: string | null } {
  if (!feedback) return { stamp: null, rest: null }
  const m = STAMP_RE.exec(feedback)
  if (!m) return { stamp: null, rest: feedback }
  const start = m.index
  const blank = feedback.indexOf('\n\n', start)
  const end = blank === -1 ? feedback.length : blank
  const stamp = feedback.slice(start, end).trim()
  const rest = `${feedback.slice(0, start).trim()}\n\n${feedback.slice(end).trim()}`.trim()
  return { stamp: stamp || null, rest: rest.length > 0 ? rest : null }
}
