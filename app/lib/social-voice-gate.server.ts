/**
 * Voice-gate verdict contract for the draft-write boundary (ticket #3208).
 *
 * Context. Routine `routine-social-daily.md` Step 4a calls `emma-empathy-reviewer`
 * a MANDATORY gate: every draft passes it to a clean PASS, and a BLOCK drops the
 * draft. On the 2026-08-14 social run the gate could not be invoked at all (no
 * subagent-invocation tool in that execution context), so the routine substituted
 * a manual charter self-check and, honestly, said so. That is the exact failure
 * the independent pre-publish gate was built to remove for imagery: the drafting
 * agent grading its own homework. It matters more now that the owner has directed
 * his pre-publish approval click away, so machine gates carry the weight his click
 * used to.
 *
 * This is the fail-closed answer. `createDraftSocialPost` is the ONLY path a draft
 * reaches `social_posts` with `review_status='pending_review'`, and its only caller
 * is `POST /api/team/social-post {op:'draft'}`. Enforcing the verdict here, in a
 * server-side check the routine cannot be talked out of by its execution context,
 * means a draft cannot enter the review queue unless a real voice-gate PASS was
 * asserted for it. If the gate is unreachable, the routine has no PASS to send and
 * the write is refused, exactly as Step 4a requires.
 *
 * Honest scope note. `social_posts` has no column for a verdict today, and adding
 * one is a schema migration (an owner-authored, protected-path change). Until that
 * column exists the verdict is enforced at the boundary rather than persisted on
 * the row; the requirement — no draft without a PASS — is what this module makes
 * structural.
 */

/**
 * The three verdicts `emma-empathy-reviewer` returns (routine Step 4a). PASS is
 * the only one that ships: REVISE means redraft, BLOCK drops the draft.
 */
export const VOICE_GATE_VERDICTS = ['PASS', 'REVISE', 'BLOCK'] as const
export type VoiceGateVerdict = (typeof VOICE_GATE_VERDICTS)[number]

export interface VoiceGateVerdictInput {
  /** One of {@link VOICE_GATE_VERDICTS}. */
  verdict: VoiceGateVerdict
  /** Who produced the verdict, e.g. `emma-empathy-reviewer`. Non-empty. */
  reviewer: string
  /** Which addendum it was gated against (`social` | `linkedin`), when supplied. */
  addendum?: string
  /** Free-text notes the reviewer returned. */
  notes?: string
}

export type VoiceGateParse =
  | { ok: true; verdict: VoiceGateVerdictInput }
  | { ok: false; status: 400; error: string }

/**
 * Validate a `voiceGate` payload from the draft op. Fails closed: a missing,
 * malformed, or non-PASS verdict is a 400, so no draft row is created.
 *
 * Pure and side-effect-free so the boundary rule is unit-tested directly rather
 * than only through the route.
 */
export function parseVoiceGateVerdict(raw: unknown): VoiceGateParse {
  if (raw === undefined || raw === null) {
    return {
      ok: false,
      status: 400,
      error:
        'Bad Request: voiceGate verdict required. A draft cannot enter pending_review ' +
        'without a real emma-empathy-reviewer verdict (routine Step 4a). If the voice ' +
        'gate could not run this pass, do not draft.',
    }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 400, error: 'Bad Request: voiceGate must be an object' }
  }
  const g = raw as Record<string, unknown>

  if (typeof g['verdict'] !== 'string' || !(VOICE_GATE_VERDICTS as readonly string[]).includes(g['verdict'])) {
    return {
      ok: false,
      status: 400,
      error: `Bad Request: voiceGate.verdict must be one of ${VOICE_GATE_VERDICTS.join('|')}`,
    }
  }
  const verdict = g['verdict'] as VoiceGateVerdict

  if (typeof g['reviewer'] !== 'string' || g['reviewer'].trim() === '') {
    return {
      ok: false,
      status: 400,
      error: 'Bad Request: voiceGate.reviewer required (name the gate that produced the verdict)',
    }
  }

  if (verdict !== 'PASS') {
    return {
      ok: false,
      status: 400,
      error:
        `Bad Request: voice gate returned ${verdict}; only a PASS draft enters the review queue ` +
        '(routine Step 4a: a BLOCK drops the draft, a REVISE is redrafted before it is written).',
    }
  }

  const parsed: VoiceGateVerdictInput = { verdict, reviewer: g['reviewer'].trim() }
  if (typeof g['addendum'] === 'string') parsed.addendum = g['addendum']
  if (typeof g['notes'] === 'string') parsed.notes = g['notes']
  return { ok: true, verdict: parsed }
}
