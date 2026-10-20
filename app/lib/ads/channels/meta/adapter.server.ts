/**
 * Meta's ChannelAdapter (plan §3.2, phases 1b and 6b). Read only: it lists campaigns,
 * ad sets, ads and audiences, pulls daily insights and checks the token, and returns
 * normalized rows. It writes nothing anywhere. Phase 1c upserts the entities
 * into ad_platform_entities; phase 2b stores the insights.
 *
 * createPaused and mutate throw ChannelNotEnabledError. Phase 6a moves the
 * paused-draft push here and phase 5a adds pause, resume and set_budget, both
 * in meta/mutate.server.ts, which is a protected path.
 */
import { metaCredentialsFromEnv, type MetaCredentials } from '~/lib/ad-export/meta-push.server'
import { ChannelNotEnabledError } from '../errors'
import type {
  ChannelAdapter, EntityLevel, NormalizedAudience, NormalizedEntity, NormalizedInsightRow, PolicyContext, PolicyRefusal, PolicyVerdict, TokenHealth,
} from '../types'
import { GraphError, createGraphClient, type GraphClient, type GraphJson } from './graph.server'

const CAMPAIGN_FIELDS = 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,bid_strategy,updated_time'
// Ad sets carry no objective of their own; it lives on the campaign. targeting
// rides along in raw so the audiences mirror can read custom_audiences and
// excluded_custom_audiences (docs/ads-policy.md M8) without another call.
const ADSET_FIELDS = 'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,bid_strategy,targeting,updated_time'
// Ads carry no budget or bid strategy. ad_review_feedback is where disapprovals show up.
const AD_FIELDS = 'id,name,adset_id,status,effective_status,ad_review_feedback,creative{id},updated_time'
const CUSTOM_AUDIENCE_FIELDS = 'id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status,operation_status'
const SAVED_AUDIENCE_FIELDS = 'id,name,approximate_count_lower_bound,approximate_count_upper_bound,operation_status'
const INSIGHT_FIELDS = 'campaign_id,adset_id,ad_id,date_start,spend,impressions,reach,frequency,clicks,inline_link_clicks,actions,action_values'

// Meta reports the same conversion under several action types. Take the first
// one present so a lead or purchase is never counted twice.
const LEAD_TYPES = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead']
const PURCHASE_TYPES = ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase']

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : 0
}

/**
 * Meta returns budgets as strings in the account currency's minor unit (cents
 * for USD). "0" means the level has no budget of that kind, which the mirror
 * stores as null.
 */
export function budgetCents(v: unknown): number | null {
  const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

/** Spend and action values arrive as decimal strings in currency units. */
const toCents = (v: unknown): number => Math.round(num(v) * 100)

function actionMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!Array.isArray(v)) return out
  for (const a of v) {
    if (!a || typeof a !== 'object') continue
    const type = str((a as Record<string, unknown>)['action_type'])
    if (type) out[type] = num((a as Record<string, unknown>)['value'])
  }
  return out
}

const firstOf = (m: Record<string, number>, types: string[]): number => {
  for (const t of types) if (m[t] !== undefined) return m[t]
  return 0
}

function feedback(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0 ? (v as Record<string, unknown>) : null
}

export function normalizeMetaEntity(level: 'campaign' | 'adset' | 'ad', accountId: string, row: GraphJson): NormalizedEntity {
  const parent = level === 'adset' ? str(row['campaign_id']) : level === 'ad' ? str(row['adset_id']) : null
  return {
    platform: 'meta',
    accountId,
    level,
    externalId: String(row['id']),
    parentExternalId: parent,
    name: str(row['name']),
    status: str(row['status']),
    effectiveStatus: str(row['effective_status']),
    objective: level === 'campaign' ? str(row['objective']) : null,
    dailyBudgetCents: level === 'ad' ? null : budgetCents(row['daily_budget']),
    lifetimeBudgetCents: level === 'ad' ? null : budgetCents(row['lifetime_budget']),
    bidStrategy: level === 'ad' ? null : str(row['bid_strategy']),
    reviewFeedback: level === 'ad' ? feedback(row['ad_review_feedback']) : null,
    raw: row,
  }
}

/** Meta reports -1 (or nothing) when it will not estimate a size. */
function sizeBound(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

/** delivery_status and operation_status arrive as { code, description }. */
function statusText(...vs: unknown[]): string | null {
  for (const v of vs) {
    if (!v || typeof v !== 'object') continue
    const o = v as Record<string, unknown>
    const d = str(o['description'])
    if (d) return d
    if (o['code'] !== undefined && o['code'] !== null) return String(o['code'])
  }
  return null
}

/** LOOKALIKE is the only custom-audience subtype that is not a plain custom audience. */
export function metaAudienceKind(subtype: unknown): 'custom' | 'lookalike' {
  return typeof subtype === 'string' && subtype.toUpperCase() === 'LOOKALIKE' ? 'lookalike' : 'custom'
}

export function normalizeMetaAudience(source: 'custom' | 'saved', row: GraphJson): NormalizedAudience {
  return {
    platform: 'meta',
    externalId: String(row['id']),
    name: str(row['name']),
    kind: source === 'saved' ? 'saved' : metaAudienceKind(row['subtype']),
    approxSize: sizeBound(row['approximate_count_lower_bound']),
    approxSizeUpper: sizeBound(row['approximate_count_upper_bound']),
    status: statusText(row['delivery_status'], row['operation_status']),
    raw: row,
  }
}

const ID_FIELD: Record<'campaign' | 'adset' | 'ad', string> = { campaign: 'campaign_id', adset: 'adset_id', ad: 'ad_id' }

export function normalizeMetaInsight(level: 'campaign' | 'adset' | 'ad', row: GraphJson): NormalizedInsightRow {
  const actions = actionMap(row['actions'])
  const values = actionMap(row['action_values'])
  return {
    platform: 'meta',
    level,
    externalId: String(row[ID_FIELD[level]]),
    day: String(row['date_start']),
    spendCents: toCents(row['spend']),
    impressions: Math.round(num(row['impressions'])),
    reach: Math.round(num(row['reach'])),
    frequency: num(row['frequency']),
    clicks: Math.round(num(row['clicks'])),
    linkClicks: Math.round(num(row['inline_link_clicks'])),
    leads: Math.round(firstOf(actions, LEAD_TYPES)),
    platformPurchases: Math.round(firstOf(actions, PURCHASE_TYPES)),
    platformPurchaseValueCents: Math.round(firstOf(values, PURCHASE_TYPES) * 100),
    actions,
  }
}

/**
 * The first Meta policy check: refuse while any mirrored Meta entity is
 * DISAPPROVED. A rejection pattern pauses the lane (docs/ads-policy.md, M7),
 * so nothing new moves until the disapproval is dealt with. The rest of M1
 * to M8 join this check as later phases need them.
 */
export function metaPolicyCheck(ctx: PolicyContext): PolicyVerdict {
  const refusals: PolicyRefusal[] = ctx.mirror
    .filter(r => r.platform === 'meta' && r.effectiveStatus === 'DISAPPROVED')
    .map(r => ({
      code: 'meta_disapproved',
      message: `Meta ${r.level} ${r.externalId}${r.name ? ` (${r.name})` : ''} is DISAPPROVED. Resolve it before changing anything on Meta.`,
      ref: { platform: 'meta', level: r.level, externalId: r.externalId },
    }))
  return { ok: refusals.length === 0, refusals }
}

export interface MetaAdapterDeps {
  graph?: GraphClient
  credentials?: () => MetaCredentials
  now?: () => Date
}

export function createMetaAdapter(deps: MetaAdapterDeps = {}): ChannelAdapter {
  const credentials = deps.credentials ?? (() => metaCredentialsFromEnv())
  const graph = deps.graph ?? createGraphClient({ token: () => credentials().token })
  const now = deps.now ?? (() => new Date())

  const accountId = (): string => {
    const id = credentials().accountId
    if (!id) throw new GraphError('not_configured', 'META_AD_ACCOUNT_ID is not set.')
    return id
  }

  return {
    id: 'meta',
    capabilities: { read: true, insights: true, mutate: [], audiences: 'read', preview: false },

    auth: {
      async health(): Promise<TokenHealth> {
        const checkedAt = now().toISOString()
        const token = credentials().token
        if (!token) return { valid: false, expiresAt: null, scopes: [], checkedAt, error: 'not_configured' }
        try {
          const json = await graph.get('debug_token', { input_token: token })
          const d = (json['data'] ?? {}) as Record<string, unknown>
          const epoch = (v: unknown): string | null => {
            const n = num(v)
            return n > 0 ? new Date(n * 1000).toISOString() : null
          }
          const scopes = Array.isArray(d['scopes']) ? d['scopes'].filter((s): s is string => typeof s === 'string') : []
          const err = d['error'] as Record<string, unknown> | undefined
          return {
            valid: d['is_valid'] === true,
            expiresAt: epoch(d['expires_at']),
            dataAccessExpiresAt: epoch(d['data_access_expires_at']),
            scopes,
            checkedAt,
            ...(d['is_valid'] === true ? {} : { error: str(err?.['message']) ?? 'invalid' }),
          }
        } catch (e) {
          // Meta answers a revoked or expired bearer token with OAuthException
          // code 190 (or a 401) before debug_token runs. That is the token
          // being refused, not a could-not-ask, so it gets its own error code
          // and the token health cron treats it as authoritative.
          const rejected = e instanceof GraphError && e.kind === 'api_error'
            && (e.detail.code === 190 || e.detail.status === 401)
          const error = rejected ? 'token_rejected' : e instanceof GraphError ? e.kind : 'unknown'
          return { valid: false, expiresAt: null, scopes: [], checkedAt, error }
        }
      },
    },

    async syncEntities({ since }) {
      const account = accountId()
      const [campaigns, adsets, ads] = await Promise.all([
        graph.getAll(`${account}/campaigns`, { fields: CAMPAIGN_FIELDS, limit: 200 }),
        graph.getAll(`${account}/adsets`, { fields: ADSET_FIELDS, limit: 200 }),
        graph.getAll(`${account}/ads`, { fields: AD_FIELDS, limit: 200 }),
      ])
      // Filtered here, not in the request: the three edges do not filter on
      // updated_time the same way, and the account is a few dozen rows.
      const fresh = (r: GraphJson) => {
        if (!since) return true
        const t = Date.parse(String(r['updated_time'] ?? ''))
        return !Number.isFinite(t) || t >= since.getTime()
      }
      return [
        ...campaigns.filter(fresh).map(r => normalizeMetaEntity('campaign', account, r)),
        ...adsets.filter(fresh).map(r => normalizeMetaEntity('adset', account, r)),
        ...ads.filter(fresh).map(r => normalizeMetaEntity('ad', account, r)),
      ]
    },

    async pullInsights(range, level: EntityLevel) {
      if (level === 'creative') throw new GraphError('bad_response', 'Meta insights are not reported at creative level.')
      const account = accountId()
      const rows = await graph.getAll(`${account}/insights`, {
        level,
        fields: INSIGHT_FIELDS,
        time_range: { since: range.since, until: range.until },
        time_increment: 1,
        limit: 500,
      })
      return rows.map(r => normalizeMetaInsight(level, r))
    },

    audiences: {
      // Read only. Role (targeting or exclusion) is not a property of the
      // audience on Meta; app/lib/ads/audiences.server.ts derives it from the
      // mirrored ad sets' targeting. Saved audiences are a smaller, optional
      // edge: if that call fails the custom audiences still come back.
      async list() {
        const account = accountId()
        const [custom, saved] = await Promise.all([
          graph.getAll(`${account}/customaudiences`, { fields: CUSTOM_AUDIENCE_FIELDS, limit: 200 }),
          graph.getAll(`${account}/saved_audiences`, { fields: SAVED_AUDIENCE_FIELDS, limit: 200 }).catch(() => [] as GraphJson[]),
        ])
        return [
          ...custom.map(r => normalizeMetaAudience('custom', r)),
          ...saved.map(r => normalizeMetaAudience('saved', r)),
        ]
      },
    },

    async createPaused() {
      throw new ChannelNotEnabledError('meta', 'createPaused')
    },

    async mutate(m) {
      throw new ChannelNotEnabledError('meta', `mutate:${m.verb}`)
    },

    async policyCheck(ctx) {
      return metaPolicyCheck(ctx)
    },
  }
}

export const metaAdapter: ChannelAdapter = createMetaAdapter()
