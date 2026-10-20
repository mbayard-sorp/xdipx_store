/**
 * Ads Control Plane channel types (ADR-018, plan §3.2). Client-safe: no
 * server imports, so the console can render channel and entity shapes.
 *
 * The operate layer lives under app/lib/ads/channels/ and is the only code
 * that talks to an ad platform. The export registry in app/lib/ad-export/
 * stays the build layer and never reaches a platform.
 */

/** Every channel the registry knows about, prohibited ones included. */
export type ChannelId =
  | 'meta'
  | 'microsoft'
  | 'google'
  | 'snap'
  | `adult:${string}`
  | 'reddit'
  | 'x'
  | 'tiktok'
  | 'pinterest'

/** Mirrors the paid column of docs/ads-policy.md's platform matrix. */
export type PolicyState = 'allowed' | 'restricted' | 'prohibited'

/** Matches the CHECK on ad_platform_entities.level (migration 128). */
export type EntityLevel = 'campaign' | 'adset' | 'ad' | 'creative'

export interface EntityRef {
  platform: ChannelId
  level: EntityLevel
  externalId: string
}

/**
 * One platform object as the adapter reports it. Field names mirror the
 * ad_platform_entities columns. Ids, first_seen_at and last_synced_at belong
 * to the upsert (phase 1c), and creative_id is the Ad Studio link the sync
 * resolves, so none of them are here.
 */
export interface NormalizedEntity {
  platform: ChannelId
  accountId: string
  level: EntityLevel
  externalId: string
  parentExternalId: string | null
  name: string | null
  status: string | null
  effectiveStatus: string | null
  objective: string | null
  dailyBudgetCents: number | null
  lifetimeBudgetCents: number | null
  bidStrategy: string | null
  reviewFeedback: Record<string, unknown> | null
  raw: Record<string, unknown>
}

/** One entity on one day. Mirrors ad_platform_insights_daily (migration 129, phase 2a). */
export interface NormalizedInsightRow {
  platform: ChannelId
  level: EntityLevel
  externalId: string
  /** YYYY-MM-DD in the ad account's time zone, as the platform reports it. */
  day: string
  spendCents: number
  impressions: number
  reach: number
  frequency: number
  clicks: number
  linkClicks: number
  leads: number
  platformPurchases: number
  platformPurchaseValueCents: number
  /** Every action count the platform returned, keyed by its action type. */
  actions: Record<string, number>
}

/** Inclusive, YYYY-MM-DD on both ends. */
export interface DateRange {
  since: string
  until: string
}

/**
 * halt_all pauses every ACTIVE campaign in the account as one ledger action.
 * It is not listed in capabilities.mutate, which names per-entity verbs.
 */
export type MutationVerb = 'pause' | 'resume' | 'set_budget' | 'update_creative' | 'halt_all'

/** The ad_actions row a mutation is applying, as the dispatcher saw it. */
export interface MutationLedgerContext {
  actionId: number | null
  tier: 'auto' | 'approve' | 'owner'
  /** The row's status when mutate was called. approved, in practice. */
  status: string
  /** Who approved the row: auto for the machine, an email or owner for a tap. */
  approvedBy?: string | null
}

export interface MutationRequest {
  verb: MutationVerb
  target: EntityRef
  params: unknown
  /** Set by the dispatcher. Gates that depend on the row (budget step) read it. */
  ledger?: MutationLedgerContext | undefined
}

export interface MutationResult {
  applied: boolean
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  platformResponse?: unknown
  /** Every platform id the call changed. halt_all touches many campaigns. */
  touchedIds?: string[]
  /** True when the adapter already ran read-after-write for touchedIds. */
  synced?: boolean
  /** A partial failure worth keeping on an applied row, e.g. one campaign of five refused. */
  warning?: string | null
}

/** Ids the platform assigned to what createPaused made. */
export interface CreatedRefs {
  campaignId?: string
  adSetId?: string
  adId?: string
  creativeId?: string
}

export interface NormalizedAudience {
  platform: ChannelId
  externalId: string
  name: string | null
  kind: 'custom' | 'lookalike' | 'saved'
  /** The platform's lower size bound, or its single estimate. Null when it reports none. */
  approxSize: number | null
  /** The upper size bound, when the platform reports a range. */
  approxSizeUpper?: number | null
  /** The platform's delivery or operation status, as a short readable string. */
  status?: string | null
  /** The last platform payload, kept on ad_audiences.raw. */
  raw?: Record<string, unknown>
}

export interface TokenHealth {
  valid: boolean
  /** ISO timestamp, or null when the token does not expire or health could not be read. */
  expiresAt: string | null
  /** ISO timestamp for Meta's separate data access window, when the platform has one. */
  dataAccessExpiresAt?: string | null
  /**
   * True when the platform never says when the token expires (Microsoft's
   * refresh token rolls forward on every use). expiresAt is then null because
   * the expiry is unknown, not because the token lasts forever.
   */
  expiryUnknown?: boolean
  scopes: string[]
  checkedAt: string
  /** Why valid is false when the platform did not say, e.g. not_configured. */
  error?: string
}

export interface ChannelCapabilities {
  read: boolean
  insights: boolean
  mutate: MutationVerb[]
  audiences: 'none' | 'read' | 'write'
  preview: boolean
}

/** The slice of a mirrored entity row a policy check reads. */
export type PolicyMirrorRow = Pick<
  NormalizedEntity,
  'platform' | 'level' | 'externalId' | 'name' | 'effectiveStatus' | 'reviewFeedback'
>

/**
 * Everything a policy check needs, passed in so the check stays pure. The
 * caller loads the mirror rows; the adapter never reads the database.
 */
export interface PolicyContext {
  mirror: PolicyMirrorRow[]
  /** The entity an action would touch, when the check is for one action. */
  target?: EntityRef
}

export interface PolicyRefusal {
  code: string
  message: string
  ref?: EntityRef
}

export interface PolicyVerdict {
  ok: boolean
  refusals: PolicyRefusal[]
}

/** The seam every ad platform implements (plan §3.2). */
export interface ChannelAdapter {
  id: ChannelId
  capabilities: ChannelCapabilities
  auth: { health(): Promise<TokenHealth> }
  syncEntities(opts: { since?: Date }): Promise<NormalizedEntity[]>
  pullInsights(range: DateRange, level: EntityLevel): Promise<NormalizedInsightRow[]>
  createPaused(payload: unknown): Promise<CreatedRefs>
  mutate(m: MutationRequest): Promise<MutationResult>
  audiences?: { list(): Promise<NormalizedAudience[]> }
  preview?(adRef: EntityRef): Promise<string>
  policyCheck(ctx: PolicyContext): Promise<PolicyVerdict>
}
