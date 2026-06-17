/**
 * pipeline_settings keys for the homepage team — client-safe (no `.server`
 * suffix, no server-only imports) so the /admin/homepage-team component can
 * reference them without pulling homepage-team.server.ts into the client
 * bundle. The server module re-exports these.
 *
 * All keys are <= varchar(50) (pipeline_settings.key constraint).
 */
export const TEAM_KEYS = {
  enabled:          'homepage_team_enabled',
  dailyCents:       'homepage_team_daily_cents',
  buildCents:       'homepage_team_build_cents',
  maxImagesPerDay:  'homepage_team_max_images',
  maxRunsPerDay:    'homepage_team_max_runs',
} as const
