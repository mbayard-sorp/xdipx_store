/**
 * Tunable runtime limits. All values env-overridable so we can adjust in
 * prod without redeploy (Fly secrets → restart).
 */

export const IVR_LIMITS = {
  /** After greeting, how long we wait for the caller to say anything. */
  initialSilenceMs: Number(process.env['IVR_INITIAL_SILENCE_MS'] ?? 12_000),
  /** Between caller turns (after Claude finishes replying). */
  interTurnSilenceMs: Number(process.env['IVR_INTER_TURN_SILENCE_MS'] ?? 20_000),
  /** Hard cap on total call length. */
  maxCallDurationMs: Number(process.env['IVR_MAX_CALL_DURATION_MS'] ?? 300_000),
  /** Runaway-loop guard: cap total prompt events per call. */
  maxPrompts: Number(process.env['IVR_MAX_PROMPTS'] ?? 30),
  /** "Still there?" prompts sent before we hang up on silence. */
  reEngageAttempts: Number(process.env['IVR_RE_ENGAGE_ATTEMPTS'] ?? 2),
  /** Soft token budget: once crossed, Claude is nudged to wrap up politely. */
  softTokenBudget: Number(process.env['IVR_SOFT_TOKEN_BUDGET'] ?? 40_000),
  /** Hard latency SLO; exceeding this on first-token logs a warning. */
  firstTokenSloMs: Number(process.env['IVR_FIRST_TOKEN_SLO_MS'] ?? 1500),
}

export type CallEndReason =
  | 'user_hangup'
  | 'silent_caller'
  | 'max_duration'
  | 'max_prompts'
  | 'error'
  | 'anonymous'
  | 'rate_limited'
  | 'after_hours'
