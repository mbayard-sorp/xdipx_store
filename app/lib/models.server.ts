/**
 * Central Anthropic model registry.
 *
 * One place to update when a model is retired or upgraded. Anthropic retires
 * older models on a rolling basis (e.g. claude-sonnet-4-20250514 was retired
 * 2026-06-15 and now returns an error). Import from here instead of hardcoding
 * model id strings so the next migration is a one-line change.
 *
 * Pricing for cost logging lives in model-pricing.server.ts and intentionally
 * keeps retired ids so historical api_token_log rows still price correctly.
 */

/** Mid-tier model: editorial copy, enrichment, SMS stages, chat. Same price as the retired Sonnet 4. */
export const SONNET = 'claude-sonnet-4-6'

/** Cheap/fast model: classifiers, slot extraction, IVR, summaries, log triage. */
export const HAIKU = 'claude-haiku-4-5-20251001'

export const MODELS = {
  sonnet: SONNET,
  haiku: HAIKU,
} as const
