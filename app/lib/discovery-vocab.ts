/**
 * Discovery vocabulary for the discoverProducts tool (SMS chat agent + IVR).
 *
 * Single source of truth for the tool-facing mood / experience / use-case /
 * feature enums the model may pass to discoverProducts. Values are curated to
 * what actually exists in live product data (verified 2026-08-15 against the
 * Sanity productPage moodTags / ivrExperience / ivrUseCase / ivrFeatures
 * fields) so the discovery filter returns matches instead of scoring zero
 * documents. Before this module the enums were hand-maintained in two places
 * and had drifted: experience beginner/intermediate matched 0 docs, mood
 * luxurious/relaxing matched 0, and use-case solo/couples were feature tags,
 * not use-case tags.
 *
 * PURE module: no imports, no env, no side effects. `ivr/` is a separate
 * Fly.io deploy with its own Dockerfile and cannot import from `app/`, so this
 * file is mirrored byte-for-byte as ivr/src/discovery-vocab.ts. The vitest
 * guard app/lib/__tests__/discovery-vocab-sync.test.ts fails if the two files
 * diverge — keep them identical.
 */

// Mood/vibe tags. Lowercase, matching the canonical Ask-Emma mood vocabulary
// and the lowercase forms present in live moodTags. Case-insensitive matching
// against the mixed-case stored tags is a separate follow-up.
export const DISCOVER_MOOD = [
  'playful',
  'romantic',
  'adventurous',
  'sensual',
  'curious',
  'indulgent',
  'comforting',
  'tender',
] as const

// Experience levels. Mirrors the canonical IVR experience vocabulary the
// enricher classifies ivrExperience against; re-exported from claude.server.ts
// as IVR_EXPERIENCE_LEVELS so there is a single definition.
export const DISCOVER_EXPERIENCE = [
  'first-time',
  'curious',
  'experienced',
  'advanced',
] as const

// Use-case tags. A curated subset of the canonical IVR use-case vocabulary,
// each value confirmed present on live ivrUseCase data.
export const DISCOVER_USE_CASE = [
  'date-night',
  'couples-play',
  'me-time',
  'travel',
  'gift',
  'long-distance',
  'discovery',
  'celebration',
] as const

// Feature tags. All present on live ivrFeatures data and in the canonical IVR
// feature vocabulary.
export const DISCOVER_FEATURES = [
  'waterproof',
  'quiet',
  'rechargeable',
  'app-controlled',
  'body-safe',
] as const

export type DiscoverMood = (typeof DISCOVER_MOOD)[number]
export type DiscoverExperience = (typeof DISCOVER_EXPERIENCE)[number]
export type DiscoverUseCase = (typeof DISCOVER_USE_CASE)[number]
export type DiscoverFeature = (typeof DISCOVER_FEATURES)[number]
