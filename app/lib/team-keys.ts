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

export const TEAM_IDS = ['homepage', 'social', 'ads', 'email', 'strategy', 'content', 'product', 'video', 'support'] as const
export type TeamId = (typeof TEAM_IDS)[number]

export function isTeamId(v: unknown): v is TeamId {
  return typeof v === 'string' && (TEAM_IDS as readonly string[]).includes(v)
}

/**
 * KV keys for the write-through daily spend/image counters that back the
 * budget gate (team.server.ts). Defined here (client-safe, pure strings) so
 * token-log.server.ts can bump them without importing team.server.ts.
 * `utcDay` is an ISO date, e.g. '2026-07-17' — matches the DB's current_date
 * window (Neon runs UTC).
 */
export function teamSpendKvKey(team: TeamId, utcDay: string): string {
  return `team:spend:${team}:${utcDay}`
}

export function teamImagesKvKey(utcDay: string): string {
  return `team:images:homepage:${utcDay}`
}

/**
 * Map an api_token_log feature label to its owning team, mirroring the SQL
 * attribution rule `feature LIKE '{team}-%'`. Returns null for non-team
 * features ('enrichment', 'sms', ...).
 */
export function teamFromFeature(feature: string): TeamId | null {
  const i = feature.indexOf('-')
  if (i <= 0) return null
  const prefix = feature.slice(0, i)
  return isTeamId(prefix) ? prefix : null
}

export interface TeamKeySet {
  enabled: string
  dailyCents: string
  maxRunsPerDay: string
  /**
   * When 'true', this team's incoming suggestions skip the owner's triage step
   * and are written straight to `approved` (062). "This team" = the team that
   * ACTS on the suggestion (its targetTeam, or the proposer when unrouted).
   * Auto-approve removes the owner from triage only; downstream execution gates
   * (agent-editor PR merge, manual campaign/promo/code steps) are unchanged.
   */
  autoApproveSuggestions: string
}

export function teamKeys(team: TeamId): TeamKeySet {
  return {
    enabled:                `${team}_team_enabled`,
    dailyCents:             `${team}_team_daily_cents`,
    maxRunsPerDay:          `${team}_team_max_runs`,
    autoApproveSuggestions: `${team}_team_auto_approve_suggestions`,
  }
}

/** Per-team config defaults. Everything ships OFF; budgets are conservative. */
export const TEAM_DEFAULTS: Record<TeamId, { dailyCents: number; maxRunsPerDay: number }> = {
  homepage: { dailyCents: 1500, maxRunsPerDay: 4 },
  social:   { dailyCents: 500,  maxRunsPerDay: 2 },
  ads:      { dailyCents: 500,  maxRunsPerDay: 1 },
  email:    { dailyCents: 500,  maxRunsPerDay: 1 },
  strategy: { dailyCents: 1500, maxRunsPerDay: 8 }, // 6 routines on a Monday (Weekly Strategy, R-DEV x2, R-QA, Cost Review, Apply Pass) + 2 slots of headroom; the cap counts run rows, not successes (074)
  content:  { dailyCents: 500,  maxRunsPerDay: 8 }, // double days (Sat trend-scout, Sun SEO curation, Wed podcast) plus writer-retry headroom; the cap counts run rows, not successes, and a retry day burned all 3 slots before the Wed podcast run could open (075). Budget covers the accuracy gate's web verification (068) and is still the real ceiling
  product:  { dailyCents: 300,  maxRunsPerDay: 1 }, // daily import-queue drain (SQL + curl, ~$0)
  video:    { dailyCents: 2000, maxRunsPerDay: 1 }, // fal video generation is metered; $20/day ceiling, ~3 videos/week planned
  support:  { dailyCents: 300,  maxRunsPerDay: 2 }, // daily conversation-quality review over IVR/SMS/chat transcripts + one retry slot; the cap counts run rows, not successes
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
 * Video-team extras (065). max_cost_cents is the HARD per-video ceiling: the
 * pipeline refuses to enqueue (and re-checks mid-job) any video whose estimated
 * cost exceeds it, so a model-tier misconfig cannot drain the daily budget in
 * one loop. frame_review parks every job at awaiting_frame_approval so the
 * owner picks the scene frame in /admin/video-studio BEFORE the expensive clip
 * generation; flipping it off lets auto-QC choose the frame.
 */
export const VIDEO_EXTRA_KEYS = {
  maxCostCents: 'video_team_max_cost_cents',
  frameReview:  'video_frame_review',
} as const

/** Default per-video ceiling when the key is unset (cents; migration seeds 600). */
export const VIDEO_MAX_COST_CENTS_DEFAULT = 600

/**
 * The video formula library (client-safe). Ranked by platform-safety and
 * production cost by the social team consult; POV-testimonial ships last and
 * only with per-script owner review. Definitions live in
 * .claude/agents/video-producer.md; this list is the validation whitelist.
 */
export const VIDEO_FORMULAS = [
  'myth-busting',
  'unboxing',
  'before-after',
  'hook-problem-payoff',
  'three-things',
  'grwm',
  'pov-testimonial',
  // Named shows from the social-video strategy (docs/store-team/
  // social-video-strategy-DRAFT.md §3) plus the between-episodes tentpole slot.
  'ten-second-fix',
  'the-one-thing',
  'translate-the-feeling',
  'brand-tentpole',
] as const
export type VideoFormula = (typeof VIDEO_FORMULAS)[number]

/**
 * Weekly per-video scorecard fields the owner self-reports in Video Studio
 * (strategy §4 measurement). Stored per platform in video_jobs.metrics_json;
 * unreported videos display "not yet reported", never an estimate.
 */
export const VIDEO_METRIC_FIELDS = ['hookRetentionPct', 'saves', 'shares', 'profileTaps', 'utmClicks'] as const
export type VideoMetricField = (typeof VIDEO_METRIC_FIELDS)[number]

/**
 * Talking-head scene kit (strategy §5): scenes are composed ONCE, owner
 * frame-reviewed, then reused automatically. Scripts set scriptJson.sceneSlug
 * to a slug from this kit; the pipeline looks up the scene's latest approved
 * frame (same presenter) and reuses it, so a first use composes and parks for
 * approval and every later use is free. reuseFrameAssetId stays as an explicit
 * per-job override. The team API's {op:'config'} decorates each entry with the
 * computed `approvedFrameAssetId` for presenter 'emma' (null = not composed or
 * not yet approved); this static list carries no asset ids itself.
 */
export interface SceneKitScene {
  slug: string
  label: string
  status: 'core' | 'stretch'
  note: string
}

const SCENE_KIT_NOTE =
  'All scenes are doctrine archetype C and ground-locked (coral-soft/plum-soft/paper). ' +
  'No product ever appears in a talking-head frame; product visuals are b-roll cutaways or post-composited stills. ' +
  'The identity source is Emma\'s canonical photo, resolved fresh from the Sanity editor singleton by the pipeline; scene frames are per-scene compositions from it, owner-approved once, then reused.'

export const SCENE_KIT: SceneKitScene[] = [
  { slug: 'couch-cozy',             label: 'Couch Cozy',             status: 'core',    note: SCENE_KIT_NOTE },
  { slug: 'vanity-bright',          label: 'Vanity Bright',          status: 'core',    note: SCENE_KIT_NOTE },
  { slug: 'kitchen-counter-casual', label: 'Kitchen Counter Casual', status: 'core',    note: SCENE_KIT_NOTE },
  { slug: 'closet-edit',            label: 'Closet Edit',            status: 'stretch', note: SCENE_KIT_NOTE },
  { slug: 'out-and-about-stoop',    label: 'Out-and-About Stoop',    status: 'stretch', note: SCENE_KIT_NOTE },
  { slug: 'reading-nook',           label: 'Reading Nook',           status: 'stretch', note: SCENE_KIT_NOTE },
]

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
export const SOCIAL_PLATFORMS = ['x', 'instagram', 'tiktok', 'facebook', 'youtube', 'linkedin'] as const
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]

export function socialFreqKey(platform: SocialPlatform): string {
  return `social_freq_${platform}`
}

export const SOCIAL_FREQ_DEFAULTS: Record<SocialPlatform, number> = {
  x: 1,
  instagram: 1,
  tiktok: 1,
  facebook: 0,
  youtube: 0, // video-only platform; drafts come from the video pipeline, not the daily text routine
  linkedin: 0, // authority posts drafted only from pending researchBrief docs (brand voice, not Emma); owner opts in
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
  // Trend scout: kill switch for the weekly Saturday trend-scout routine
  // (community-discourse research that proposes trendTopicBrief docs for the
  // seo-curator's Sunday planning; research-only, never writes posts).
  trendScout:         'trend_scout_enabled',
  // Social trend scout: kill switch for the weekly social-format trend-scout
  // routine (TikTok/IG format + sound research that files trend briefs the
  // video-producer can act on; propose-only, never posts). Mirrors trendScout;
  // migration seeding lives with the agent-side rollout.
  socialTrendScout:   'social_trend_scout_enabled',
  reviewsPdp:         'reviews_pdp_enabled',
  // Video autopublish: even with the video team enabled, platform posting stays
  // manual until this AND the per-platform publisher env keys are both set.
  videoAutopublish:   'video_team_autopublish',
  // Conversation-surface kill switches (076). These are FAIL-OPEN: the live
  // channels stay up when the row is missing or the DB is slow — read them
  // with getKillSwitch(), not getValve(). Flipping one to 'false' is the
  // owner's instant, no-redeploy off switch for that channel's AI agent.
  // chat_enabled gates the Ask Emma web widget's /api/ask-emma replies;
  // sms_agent_enabled gates conversational SMS replies (carrier-required
  // STOP/HELP/START compliance keeps working even when it is off).
  chatEnabled:        'chat_enabled',
  smsAgentEnabled:    'sms_agent_enabled',
} as const
