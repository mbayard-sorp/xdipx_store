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

export function teamImagesKvKey(team: TeamId, utcDay: string): string {
  return `team:images:${team}:${utcDay}`
}

/**
 * Feature labels whose spend belongs to a team even though the label does not
 * start with '{team}-'. The one live case: media-manager logs Notebook heroes
 * under 'notebook-images', which matched no team prefix, so the content team's
 * daily $ gate and image counter both silently skipped every hero it billed
 * (tickets #581/#96). The SQL aggregation in team.server.ts and the KV
 * write-through bump in token-log.server.ts both consult this map so the two
 * attribution paths cannot drift apart again.
 */
export const FEATURE_TEAM_OVERRIDES: Readonly<Record<string, TeamId>> = {
  'notebook-images': 'content',
}

/** Override feature labels attributed to `team` (for the SQL spend window). */
export function extraSpendFeaturesForTeam(team: TeamId): string[] {
  return Object.entries(FEATURE_TEAM_OVERRIDES)
    .filter(([, t]) => t === team)
    .map(([feature]) => feature)
}

/**
 * Image-generation feature labels counted toward each team's daily image cap.
 * Only teams with a configured maxImagesPerDay appear here. The homepage label
 * is the original hardcoded one; content counts the Notebook labels; social
 * counts 'social-images' (ticket #3678 — never 'homepage-images') plus
 * 'social-drafts' (ticket #5429): the daily drafting routine's own atlas/
 * seedream calls are logged under the same feature label as its token spend
 * ('social-drafts', see docs/store-team/README.md and the social-media-manager
 * agent def), which this list omitted entirely, so 34 real generations since
 * 2026-08-22 counted as zero toward the cap. Because that feature is SHARED
 * with plain token rows, a feature match alone is not enough to know a row is
 * an image — team.server.ts's getTodayImageCount additionally requires
 * `input_tokens = 0 AND output_tokens = 0`, the structural signature every
 * `logImageCost` row carries and no real token-log row does.
 */
export const TEAM_IMAGE_FEATURES: Readonly<Partial<Record<TeamId, readonly string[]>>> = {
  homepage: ['homepage-images'],
  content:  ['notebook-images', 'content-images'],
  social:   ['social-images', 'social-drafts'],
}

/**
 * Caller values an owner-initiated image generation writes, never the
 * scheduled drafting routine. Ticket #5429: 4 of the 13 images that tripped
 * run 475's image cap carried `caller='owner-slate-preview'` (the pre-rebuild
 * Social Studio preview flow); `'owner-studio'` (`api.admin.social-image.tsx`,
 * the Library "Edit prompt, regenerate" flow that replaced it) is its current
 * successor and would reproduce the identical bug under a new name if left
 * out here. These calls still bill the social team's DOLLAR budget like any
 * other spend (`getTodaySpendCents` is untouched) — only the per-day IMAGE
 * COUNT the routine's own cap compares against excludes them, because an
 * unrelated owner click in the admin UI must never be the reason a scheduled
 * run refuses itself.
 */
export const OWNER_IMAGE_CALLERS: readonly string[] = ['owner-slate-preview', 'owner-studio']

/** Which team's image counter a feature label bumps (null = none). */
export function imageTeamFromFeature(feature: string): TeamId | null {
  for (const [team, features] of Object.entries(TEAM_IMAGE_FEATURES)) {
    if (features.includes(feature)) return team as TeamId
  }
  return null
}

/**
 * Map an api_token_log feature label to its owning team, mirroring the SQL
 * attribution rule `feature LIKE '{team}-%'` plus FEATURE_TEAM_OVERRIDES.
 * Returns null for non-team features ('enrichment', 'sms', ...).
 */
export function teamFromFeature(feature: string): TeamId | null {
  const override = FEATURE_TEAM_OVERRIDES[feature]
  if (override) return override
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
 * generate per day (via media-manager). Hard-gated since tickets #3390/#581:
 * gate() counts the content image features (TEAM_IMAGE_FEATURES) and refuses
 * with over_image_cap once a positive cap is reached. 0 means the routine
 * ships posts heroless (no image budget; the run itself still proceeds).
 * Owner-editable in the Content tab of /admin/homepage-team; seeded by
 * migration 055.
 */
export const CONTENT_EXTRA_KEYS = {
  maxImagesPerDay: 'content_team_max_images',
} as const

/** Default content image cap when the key is unset (conservative; migration seeds 5). */
export const CONTENT_MAX_IMAGES_DEFAULT = 0

/**
 * Social-team extra (ticket #3678): daily image-generation cap for the social
 * slate, enforced by gate() against feature 'social-images'. Before this key
 * was wired server-side, the only binding limit was a client-side fallback
 * constant in scripts/gen-social-image.ts pretending to be a cap.
 */
export const SOCIAL_EXTRA_KEYS = {
  maxImagesPerDay: 'social_team_max_images',
} as const

/**
 * Default social image cap when the key is unset. 12 on purpose: it equals the
 * LOCAL_IMAGE_CAP_FALLBACK that was the de-facto binding cap before the key
 * was wired, so wiring the server-side cap changes nothing until the owner
 * edits the setting (spend-control invariant: count and enforce, never raise).
 */
export const SOCIAL_MAX_IMAGES_DEFAULT = 12

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
  // Hard cap on how many jobs one enqueue-set call may expand to (078). Read
  // via getTeamConfig('video').maxVariantsPerSet — the key rides the existing
  // 'video_team_%' LIKE query, no extra round trip.
  maxVariantsPerSet: 'video_team_max_variants_per_set',
  // 1.5s logo + CTA outro appended in assembly. Read via getPipelineSetting
  // (=== 'true', defaults OFF) like frame_review — a render toggle, not budget.
  endcardEnabled: 'video_endcard_enabled',
  // The model tier enqueueVideoJob/enqueueVideoJobSet fall back to when the
  // caller omits modelTier. Plain pipeline_settings key (not a 'video_team_%'
  // one, so it does NOT ride getTeamConfig's LIKE query) — read directly via
  // getPipelineSetting like frame_review/endcardEnabled. No migration seeds
  // this row; absence is the expected steady state and falls back to
  // VIDEO_DEFAULT_MODEL_TIER_DEFAULT below. An owner (or agent) can set it at
  // any time via the pipeline_settings table with no schema change.
  defaultModelTier: 'video_default_model_tier',
} as const

/** Default per-video ceiling when the key is unset (cents; migration seeds 600). */
export const VIDEO_MAX_COST_CENTS_DEFAULT = 600

/** Default enqueue-set expansion cap when the key is unset (migration seeds 4). */
export const VIDEO_MAX_VARIANTS_PER_SET_DEFAULT = 4

/**
 * Default modelTier when video_default_model_tier is unset AND the caller
 * omits modelTier. kling25-pro: the cheapest fully-silent standard tier
 * already in production use, so a misconfigured/absent default never
 * accidentally selects an expensive or unvalidated tier.
 */
export const VIDEO_DEFAULT_MODEL_TIER_DEFAULT = 'kling25-pro'

/**
 * Delivery-tone vocabulary for video speech (spec §5 Phase 3). Optional and
 * opt-in per job: scriptJson.presenterTone routes that job's TTS to eleven_v3
 * with the matching audio tag (the store voice on eleven_multilingual_v2 stays
 * the default) and appends the expression phrase to the avatar motion prompt.
 * The voice gate checks tone choices against the platform register caps.
 */
export const VIDEO_TONES = ['warm', 'playful', 'direct', 'hushed'] as const
export type VideoTone = (typeof VIDEO_TONES)[number]

export function isVideoTone(v: unknown): v is VideoTone {
  return typeof v === 'string' && (VIDEO_TONES as readonly string[]).includes(v)
}

/** Expression phrase appended to the avatar render prompt per tone. */
export const TONE_EXPRESSION: Record<VideoTone, string> = {
  warm:    'warm gentle smile, relaxed friendly delivery',
  playful: 'playful bright energy, light teasing smile',
  direct:  'steady eye contact, confident matter-of-fact delivery',
  hushed:  'leaning in, soft conspiratorial delivery',
}

/**
 * CTA lines allowed on the end card (subset of the charter CTA whitelist that
 * reads well as a closing card; scriptJson.cta outside this list falls back to
 * the first entry).
 */
export const ENDCARD_CTA_WHITELIST = ['Take a peek', 'Show me', 'Find your fit'] as const

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
 *  - social autopost: LEGACY and gates nothing in code. It predates the
 *    per-platform publish valves (instagram_autopublish_enabled,
 *    x_autopublish_enabled) which are what actually control live posting. Kept
 *    so the existing row is not silently reinterpreted as something live.
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

/**
 * Monthly ceiling on X metrics reads by /cron/social-metrics-sweep (Social
 * Studio v2 Phase 6b, ticket #4916). One read = one tweet id looked up, about
 * $0.005 on X's pay-per-use tier. 1500 is roughly $7.50 a month and covers 24
 * rows every six hours with headroom. Zero keeps the valve on and pauses X
 * reads; Instagram insights are free and unaffected. Owner-only, like every
 * spend control; editable on the Social tab of /admin/homepage-team.
 */
export const X_METRICS_MAX_READS_MONTH_KEY = 'x_metrics_max_reads_month'
export const X_METRICS_MAX_READS_MONTH_DEFAULT = 1500

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
  // Instagram autopublish. Deliberately its own valve rather than reusing
  // social_team_autopost, which is documented as X-only, gates nothing in code,
  // and is already TRUE: keying an unattended Instagram publish off an armed
  // valve would arm it silently. Different platform, different risk profile.
  // Meta enforcement is account-level and retroactive. Default OFF.
  instagramAutopublish: 'instagram_autopublish_enabled',
  // X autopublish. Its own valve for the same reason Instagram got one: a
  // different platform with a different risk profile, and reusing an armed
  // valve would arm this silently. Default OFF, like every other publish valve,
  // and `getValve` treats the missing row as off so this ships inert with no
  // migration. X's risk is not Meta-style retroactive enforcement but money:
  // X bills per post since February 2026, so this valve is paired with
  // `x_publish_max_spend_usd_month` rather than standing alone.
  xAutopublish:       'x_autopublish_enabled',
  // Social metrics sweep (Social Studio v2 Phase 6b, ticket #4916): gates the
  // six-hourly /cron/social-metrics-sweep that refreshes metrics_json on
  // recent posted rows. Its own valve because X bills per metrics read, so
  // this is a spend control paired with `x_metrics_max_reads_month`. Default
  // OFF; `getValve` treats the missing row as off so it ships inert.
  socialMetricsSweep: 'social_metrics_sweep_enabled',
  chatEnabled:        'chat_enabled',
  smsAgentEnabled:    'sms_agent_enabled',
} as const
