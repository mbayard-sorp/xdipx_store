/**
 * app/lib/sms-v2/templates/research-templates.ts
 *
 * Deterministic FALLBACK templates for the RESEARCH stage.
 * Used when the fabrication validator catches an unknown product name
 * in the LLM output.
 *
 * Voice: Emma, curious and helpful. No em-dashes. No pitch-style closes.
 * No "I'll take it", no "ready to grab", no countdown language.
 *
 * No slots required. These are generic redirects that ask the customer
 * to clarify what they are comparing so we can pull real specs.
 */

export type ResearchFallbackTemplate = () => string

/**
 * Variant A: Simple curiosity, invite comparison request.
 */
export const researchFallbackA: ResearchFallbackTemplate = () =>
  `Good question. Let me know what specifically you're comparing, and I can pull up specs side by side. What two things are you weighing?`

/**
 * Variant B: Warm redirect, slightly different framing.
 */
export const researchFallbackB: ResearchFallbackTemplate = () =>
  `Love a comparison question. Give me the two things you're looking at and I'll break down what actually matters between them. What are you deciding between?`

/**
 * Variant C: Brief and open.
 */
export const researchFallbackC: ResearchFallbackTemplate = () =>
  `Good question. Tell me what you're comparing and I'll dig into the real differences. What's in your shortlist?`

/** Ordered list for rotation. */
export const RESEARCH_FALLBACK_TEMPLATES: ReadonlyArray<ResearchFallbackTemplate> = [
  researchFallbackA,
  researchFallbackB,
  researchFallbackC,
]

/**
 * Pick a fallback variant. Rotation is time-based (seconds / 11 mod N) so
 * repeated calls within a short window return the same template, but
 * different conversations spread across variants.
 */
export function pickResearchFallbackTemplate(): string {
  const idx = (Math.floor(Date.now() / 11000)) % RESEARCH_FALLBACK_TEMPLATES.length
  const fn = RESEARCH_FALLBACK_TEMPLATES[idx]!
  return fn()
}
