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

export const TEAM_IDS = ['homepage', 'social', 'ads', 'email', 'strategy'] as const
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
}

/** Homepage-only extras (kept from the original TEAM_KEYS set). */
export const HOMEPAGE_EXTRA_KEYS = {
  buildCents:      'homepage_team_build_cents',
  maxImagesPerDay: 'homepage_team_max_images',
} as const

/**
 * Standalone valves outside the per-team key sets:
 *  - social autopost: even with the social team enabled, live posting stays off
 *    until this AND the env-level X_AUTO_POST_ENABLED are both true.
 *  - suggestion apply: kill switch for agent-editor turning approved
 *    instruction-suggestions into PRs.
 */
export const VALVE_KEYS = {
  socialAutopost:  'social_team_autopost',
  suggestionApply: 'suggestion_apply_enabled',
} as const
