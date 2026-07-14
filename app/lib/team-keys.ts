/**
 * pipeline_settings keys for the store-wide agent teams — client-safe (no
 * `.server` suffix, no server-only imports) so admin route components can
 * reference them without pulling team.server.ts into the client bundle.
 *
 * The homepage team keeps its original keys (homepage_team_enabled, ...) plus
 * two extras (build cents, image cap) that other teams don't have. Every other
 * team gets the same three-key set via teamKeys().
 *
 * All keys are <= varchar(50) (pipeline_settings.key constraint).
 */

export const TEAM_IDS = ['homepage', 'social', 'ads', 'email', 'strategy', 'content', 'product'] as const
export type TeamId = (typeof TEAM_IDS)[number]

export function isTeamId(v: unknown): v is TeamId {
  return typeof v === 'string' && (TEAM_IDS as readonly string[]).includes(v)
}

export interface TeamKeySet {
  enabled: string
  dailyCents: string
  maxRunsPerDay: string
}

export function teamKeys(team: TeamId): TeamKeySet {
  return {
    enabled:       `${team}_team_enabled`,
    dailyCents:    `${team}_team_daily_cents`,
    maxRunsPerDay: `${team}_team_max_runs`,
  }
}

/** Per-team config defaults. Everything ships OFF; budgets are conservative. */
export const TEAM_DEFAULTS: Record<TeamId, { dailyCents: number; maxRunsPerDay: number }> = {
  homepage: { dailyCents: 1500, maxRunsPerDay: 4 },
  social:   { dailyCents: 500,  maxRunsPerDay: 2 },
  ads:      { dailyCents: 500,  maxRunsPerDay: 1 },
  email:    { dailyCents: 500,  maxRunsPerDay: 1 },
  strategy: { dailyCents: 300,  maxRunsPerDay: 1 },
  content:  { dailyCents: 300,  maxRunsPerDay: 2 }, // 2nd run = one voice-gate retry
  product:  { dailyCents: 300,  maxRunsPerDay: 1 }, // daily import-queue drain (SQL + curl, ~$0)
}

/** Homepage-only extras (kept from the original TEAM_KEYS set). */
export const HOMEPAGE_EXTRA_KEYS = {
  buildCents:      'homepage_team_build_cents',
  maxImagesPerDay: 'homepage_team_max_images',
} as const

/**
 * Content-team extra: how many hero/mood images the daily Notebook routine may
 * generate per day (via media-manager). Advisory cap the content routine
 * self-limits to; unlike homepage it is not hard-gated (content makes ~1 hero a
 * day). 0 means the routine ships posts heroless. Owner-editable in the Content
 * tab of /admin/homepage-team; seeded by migration 055.
 */
export const CONTENT_EXTRA_KEYS = {
  maxImagesPerDay: 'content_team_max_images',
} as const

/** Default content image cap when the key is unset (conservative; migration seeds 5). */
export const CONTENT_MAX_IMAGES_DEFAULT = 0

/**
 * Standalone valves outside the per-team key sets:
 *  - social autopost: even with the social team enabled, live posting stays off
 *    until this AND the env-level X_AUTO_POST_ENABLED are both true.
 *  - suggestion apply: kill switch for agent-editor turning approved
 *    instruction-suggestions into PRs.
 *  - content autopublish: with the content team enabled, blog posts go live
 *    only when this is on; off degrades the daily routine to draft-only.
 *  - keyword research: gates the monthly /cron/keyword-research run (paused
 *    in #198 to stop spend; the valve makes re-enabling an owner dashboard
 *    action instead of a code change).
 *  - seo curation: kill switch for the weekly seo-curator routine (gray-zone
 *    keyword triage, cluster hygiene, content-brief planning).
 *  - reviews pdp: flips the PDP review block AND aggregateRating JSON-LD
 *    together. They must never be decoupled: emitting ratings that are not
 *    visible on-page violates Google's review-snippet policy.
 */
/**
 * Social platforms + per-platform posting frequency keys (posts/day, '0' =
 * platform off). Owner edits these on /admin/socials; the social routine reads
 * them via {op:'config'} to size each run's per-platform draft quota. Only x
 * has live plumbing; instagram/tiktok drafts are posted manually.
 */
export const SOCIAL_PLATFORMS = ['x', 'instagram', 'tiktok', 'facebook'] as const
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]

export function socialFreqKey(platform: SocialPlatform): string {
  return `social_freq_${platform}`
}

export const SOCIAL_FREQ_DEFAULTS: Record<SocialPlatform, number> = {
  x: 1,
  instagram: 1,
  tiktok: 1,
  facebook: 0,
}

/** Review lifecycle for social drafts (social_posts.review_status). */
export const SOCIAL_REVIEW_STATUSES = ['pending_review', 'approved', 'needs_changes', 'rejected'] as const
export type SocialReviewStatus = (typeof SOCIAL_REVIEW_STATUSES)[number]

export const VALVE_KEYS = {
  socialAutopost:     'social_team_autopost',
  suggestionApply:    'suggestion_apply_enabled',
  contentAutopublish: 'content_team_autopublish',
  keywordResearch:    'keyword_research_enabled',
  seoCuration:        'seo_curation_enabled',
  reviewsPdp:         'reviews_pdp_enabled',
} as const
