/**
 * ExoClick's ChannelAdapter, id 'adult:exoclick' (plan §3.2, ticket #16675).
 *
 * Read and insights only, on the API v2 client in client.server.ts:
 *
 *   health()        a login attempt with EXOCLICK_API_KEY
 *   syncEntities()  GET /campaigns, then GET /campaigns/{id}/variation for
 *                   each one. A campaign mirrors at level campaign and each
 *                   variation (banner) at level ad under it.
 *   pullInsights()  GET /statistics/a/variation (level ad) or
 *                   /statistics/a/campaign (level campaign), once per day in
 *                   the range. Neither endpoint takes a group-by-day
 *                   parameter, so asking one day at a time is how the rows
 *                   come back per day.
 *
 * It writes nothing to our database; sync.server.ts and insights.server.ts
 * do that for every channel the same way.
 *
 * mutate and createPaused throw ChannelNotEnabledError until every item on
 * the Channels checklist for adult:exoclick is green (plan §6). Pause,
 * resume and budget belong in exoclick/mutate.server.ts, a protected path
 * that a later owner-merged PR adds.
 *
 * Policy (docs/ads-policy.md, Adult ad networks row): allowed, copy at
 * register 10, the charter's nudity definition as the imagery ceiling, and
 * UTMs mandatory on every banner URL. policyCheck enforces the UTM rule.
 */
import { ChannelNotEnabledError } from '../errors'
import type {
  ChannelAdapter, DateRange, EntityLevel, NormalizedEntity, NormalizedInsightRow, PolicyContext, PolicyRefusal, PolicyVerdict, TokenHealth,
} from '../types'
import { ExoClickError, exoClient, type ExoClient, type ExoJson } from './client.server'

export const EXOCLICK_CHANNEL = 'adult:exoclick' as const

type Json = Record<string, unknown>

/** Rows per statistics or list page. ExoClick's default is 50. */
const PAGE_LIMIT = 500
const MAX_PAGES = 40

// -- Normalization -------------------------------------------------------------

const str = (v: unknown): string | null => {
  if (typeof v === 'string') return v === '' ? null : v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

const num = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const n = Number(v.replace(/,/g, '').trim())
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/** /collections/campaign-status, read live 2026-10-20. */
export const CAMPAIGN_STATUS: Record<string, string> = { '-1': 'ARCHIVED', '0': 'PAUSED', '1': 'ACTIVE' }

/** /collections/variation-status, read live 2026-10-20. This is the review status. */
export const VARIATION_STATUS: Record<string, string> = { '0': 'PENDING_REVIEW', '1': 'APPROVED', '2': 'REJECTED' }

/** calculated_status names (campaign) and strings (variation), folded to the mirror's vocabulary. */
function effectiveFromCalculated(raw: string | null): string | null {
  if (!raw) return null
  const s = raw.toLowerCase().replace(/[^a-z]/g, '')
  if (s === 'running' || s === 'partiallyrunning' || s === 'approved') return 'ACTIVE'
  if (s === 'rejected') return 'DISAPPROVED'
  if (s === 'pendingapproval') return 'PENDING_REVIEW'
  if (s === 'archived') return 'ARCHIVED'
  if (s === 'paused') return 'PAUSED'
  // No Funds, Daily Budget Reached, Scheduled and the rest: keep ExoClick's own words, upper snake.
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function calculatedStatus(row: Json): string | null {
  const c = row['calculated_status']
  if (typeof c === 'string') return c
  if (c && typeof c === 'object') return str((c as Json)['status']) ?? str((c as Json)['name'])
  return null
}

/** ExoClick reports money in the account currency (USD for this account); the mirror stores cents. */
export function exoCents(v: unknown): number {
  return Math.round(num(v) * 100)
}

/**
 * The daily budget in cents, when the campaign has a budget-type daily limit
 * (daily_limit_type 1). max_daily_budget_reset is the configured cap per day;
 * max_daily_budget is what remains today, so it is only the fallback.
 */
function dailyBudgetCents(row: Json): number | null {
  if (num(row['daily_limit_type']) !== 1) return null
  const cap = num(row['max_daily_budget_reset']) || num(row['max_daily_budget'])
  return cap > 0 ? Math.round(cap * 100) : null
}

export function normalizeExoCampaign(accountId: string, row: Json): NormalizedEntity {
  const status = CAMPAIGN_STATUS[String(row['status'])] ?? str(row['status'])
  const lifetime = num(row['total_budget_limit'])
  const pricing = num(row['pricing_model'])
  return {
    platform: EXOCLICK_CHANNEL,
    accountId,
    level: 'campaign',
    externalId: String(row['id']),
    parentExternalId: null,
    name: str(row['name']),
    status,
    effectiveStatus: effectiveFromCalculated(calculatedStatus(row)) ?? status,
    objective: null,
    dailyBudgetCents: dailyBudgetCents(row),
    lifetimeBudgetCents: lifetime > 0 ? Math.round(lifetime * 100) : null,
    bidStrategy: pricing ? (PRICING_MODEL[String(pricing)] ?? String(pricing)) : null,
    reviewFeedback: null,
    raw: row,
  }
}

/** Campaign.pricing_model in the swagger. */
const PRICING_MODEL: Record<string, string> = {
  '1': 'CPC', '2': 'CPM', '3': 'CPA', '4': 'SMART_CPM', '5': 'CPV', '7': 'SMART_CPC', '8': 'SMART_BID',
}

export function normalizeExoVariation(accountId: string, campaignId: string, row: Json): NormalizedEntity {
  const id = String(row['idvariation'] ?? row['id'])
  const archived = row['active'] !== undefined && num(row['active']) === 0
  const review = VARIATION_STATUS[String(row['status'])] ?? null
  const calculated = effectiveFromCalculated(str(row['calculated_status']))
  const rejected = review === 'REJECTED' || calculated === 'DISAPPROVED'
  return {
    platform: EXOCLICK_CHANNEL,
    accountId,
    level: 'ad',
    externalId: id,
    parentExternalId: str(row['idcampaign']) ?? campaignId,
    name: str(row['name']) ?? id,
    status: archived ? 'ARCHIVED' : 'ACTIVE',
    effectiveStatus: archived ? 'ARCHIVED' : rejected ? 'DISAPPROVED' : (calculated ?? review ?? 'ACTIVE'),
    objective: null,
    dailyBudgetCents: null,
    lifetimeBudgetCents: null,
    bidStrategy: null,
    reviewFeedback: rejected ? { status: row['status'] ?? null, calculated_status: row['calculated_status'] ?? null } : null,
    raw: row,
  }
}

/**
 * Conversions from a statistics row's goals block. The swagger types goals
 * as { data: { <goalUID>: { volume, coa, ecpa } }, total, ecpa }, and
 * StatisticsAdvertiserGlobal types it as an array of that. total is read
 * first; otherwise each goal's volume is summed.
 */
export function exoConversions(goals: unknown): { total: number; byGoal: Record<string, number> } {
  const byGoal: Record<string, number> = {}
  const blocks = Array.isArray(goals) ? goals : goals ? [goals] : []
  let total = 0
  let sawTotal = false
  for (const g of blocks) {
    if (!g || typeof g !== 'object') continue
    const o = g as Json
    if (o['total'] !== undefined && o['total'] !== null) {
      total += num(o['total'])
      sawTotal = true
    }
    const data = o['data']
    if (data && typeof data === 'object') {
      for (const [uid, v] of Object.entries(data as Json)) {
        const vol = v && typeof v === 'object' ? num((v as Json)['volume']) : num(v)
        byGoal[`goal:${uid}`] = (byGoal[`goal:${uid}`] ?? 0) + vol
      }
    }
  }
  if (!sawTotal) total = Object.values(byGoal).reduce((a, b) => a + b, 0)
  return { total, byGoal }
}

/**
 * One statistics row for one day. Cost comes from `cost` (a number in the
 * account currency); the integer `value` field the swagger also labels
 * "Campaign costs" is used only when cost is absent, and is treated as the
 * same unit. ExoClick reports no reach and no separate link clicks, so
 * clicks stand in for link clicks: every banner click goes to the landing URL.
 */
export function parseExoStatsRow(level: 'campaign' | 'ad', day: string, row: Json): NormalizedInsightRow | null {
  const id = str(level === 'ad' ? (row['idvariation'] ?? row['variation_id']) : (row['idcampaign'] ?? row['campaign_id']))
  if (!id) return null
  const conv = exoConversions(row['goals'])
  const clicks = Math.round(num(row['clicks']))
  const cost = row['cost'] !== undefined && row['cost'] !== null ? row['cost'] : row['value']
  return {
    platform: EXOCLICK_CHANNEL,
    level,
    externalId: id,
    day,
    spendCents: exoCents(cost),
    impressions: Math.round(num(row['hits'] ?? row['impressions'])),
    reach: 0,
    frequency: 0,
    clicks,
    linkClicks: clicks,
    leads: 0,
    platformPurchases: Math.round(conv.total),
    platformPurchaseValueCents: 0,
    actions: { conversions: conv.total, ...conv.byGoal },
  }
}

/** Sums rows that share an id, which a variation split across campaigns could produce. */
export function parseExoStatsPage(level: 'campaign' | 'ad', day: string, json: ExoJson): NormalizedInsightRow[] {
  const result = json['result']
  if (!Array.isArray(result)) throw new ExoClickError('bad_response', `ExoClick statistics for ${day} returned no result array.`)
  const out = new Map<string, NormalizedInsightRow>()
  for (const r of result) {
    if (!r || typeof r !== 'object') continue
    const row = parseExoStatsRow(level, day, r as Json)
    if (!row) continue
    const prev = out.get(row.externalId)
    if (!prev) { out.set(row.externalId, row); continue }
    prev.spendCents += row.spendCents
    prev.impressions += row.impressions
    prev.clicks += row.clicks
    prev.linkClicks = prev.clicks
    prev.platformPurchases += row.platformPurchases
    for (const [k, v] of Object.entries(row.actions)) prev.actions[k] = (prev.actions[k] ?? 0) + v
  }
  return [...out.values()]
}

/** Every day from since to until, inclusive, as YYYY-MM-DD. */
export function exoDays(range: DateRange): string[] {
  const out: string[] = []
  const d = new Date(`${range.since}T00:00:00Z`)
  const end = new Date(`${range.until}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime())) return out
  for (; d <= end && out.length < 400; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10))
  return out
}

// -- Policy --------------------------------------------------------------------

/** The four UTMs docs/ads-policy.md makes mandatory on every adult-network banner URL. */
export const REQUIRED_UTMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const

export interface ExoPolicyContext extends PolicyContext {
  /** Every banner destination URL the action would put on ExoClick. */
  bannerUrls?: readonly string[]
}

/**
 * Allowed only when every banner URL carries utm_source, utm_medium,
 * utm_campaign and utm_content with a value. Each missing parameter is its
 * own refusal, named. Mirrored ExoClick variations that ExoClick rejected
 * also refuse, the same way Meta and Microsoft disapprovals do.
 */
export function exoclickPolicyCheck(ctx: ExoPolicyContext): PolicyVerdict {
  const refusals: PolicyRefusal[] = ctx.mirror
    .filter(r => r.platform === EXOCLICK_CHANNEL && r.effectiveStatus === 'DISAPPROVED')
    .map(r => ({
      code: 'exoclick_rejected',
      message: `ExoClick ${r.level} ${r.externalId}${r.name ? ` (${r.name})` : ''} was rejected in review. Resolve it before changing anything on ExoClick.`,
      ref: { platform: EXOCLICK_CHANNEL, level: r.level, externalId: r.externalId },
    }))
  for (const raw of ctx.bannerUrls ?? []) {
    let u: URL
    try {
      u = new URL(raw)
    } catch {
      refusals.push({ code: 'exoclick_bad_url', message: `Banner URL is not a valid URL: ${raw.slice(0, 200)}` })
      continue
    }
    for (const p of REQUIRED_UTMS) {
      if (!u.searchParams.get(p)?.trim()) {
        refusals.push({
          code: 'exoclick_missing_utm',
          message: `Banner URL ${u.origin}${u.pathname} is missing ${p}. docs/ads-policy.md makes utm_source, utm_medium, utm_campaign and utm_content mandatory on every adult-network banner.`,
        })
      }
    }
  }
  return { ok: refusals.length === 0, refusals }
}

// -- Adapter -------------------------------------------------------------------

export interface ExoclickAdapterDeps {
  client?: ExoClient
  now?: () => Date
  /** The advertiser account id. Defaults to EXOCLICK_ACCOUNT_ID, else GET /user. */
  accountId?: () => Promise<string>
}

/** Map a failed login to the error codes token-health.server.ts reads. */
export function exoHealthError(e: unknown): string {
  if (e instanceof ExoClickError) return e.kind
  if (e instanceof TypeError) return 'network'
  return 'unknown'
}

export function createExoclickAdapter(deps: ExoclickAdapterDeps = {}): ChannelAdapter {
  const client = deps.client ?? exoClient
  const now = deps.now ?? (() => new Date())
  let accountCache: string | null = null

  async function accountId(): Promise<string> {
    if (deps.accountId) return deps.accountId()
    if (accountCache) return accountCache
    const fromEnv = process.env['EXOCLICK_ACCOUNT_ID']?.trim()
    if (fromEnv) return (accountCache = fromEnv)
    const user = await client.get('user')
    const id = str((user['result'] as Json | undefined)?.['id'])
    if (!id) throw new ExoClickError('bad_response', 'ExoClick /user returned no account id.')
    return (accountCache = id)
  }

  /** Follows offset paging on a list endpoint whose rows sit under `key`. */
  async function getAll(path: string, params: Record<string, string | number | boolean>, key = 'result'): Promise<Json[]> {
    const out: Json[] = []
    for (let page = 0; page < MAX_PAGES; page++) {
      const json = await client.get(path, { ...params, limit: PAGE_LIMIT, offset: page * PAGE_LIMIT })
      const rows = json[key]
      if (!Array.isArray(rows)) throw new ExoClickError('bad_response', `ExoClick GET ${path} returned no ${key} array.`, { path })
      for (const r of rows) if (r && typeof r === 'object') out.push(r as Json)
      if (rows.length < PAGE_LIMIT) return out
    }
    throw new ExoClickError('bad_response', `ExoClick GET ${path} paged past ${MAX_PAGES} pages.`, { path })
  }

  return {
    id: EXOCLICK_CHANNEL,
    capabilities: { read: true, insights: true, mutate: [], audiences: 'none', preview: false },

    auth: {
      /**
       * Valid when a login with EXOCLICK_API_KEY succeeds now (or did, and
       * the session is still cached). The session token lasts 12 hours and
       * the client renews it on its own, so its expiry is not the
       * credential's. ExoClick does not say when an API key expires, so
       * expiresAt stays null with expiryUnknown, the way Microsoft reports
       * its rolling refresh token. Reporting the 12-hour session as the
       * expiry would read as "expiring" every day and file a rotate blocker
       * for a key that is fine.
       */
      async health(): Promise<TokenHealth> {
        const checkedAt = now().toISOString()
        try {
          await client.session()
        } catch (e) {
          return { valid: false, expiresAt: null, expiryUnknown: true, scopes: [], checkedAt, error: exoHealthError(e) }
        }
        return { valid: true, expiresAt: null, expiryUnknown: true, scopes: ['api_token'], checkedAt }
      },
    },

    // ExoClick list reads carry no modified-since filter, so every pass is a full pass.
    async syncEntities() {
      const account = await accountId()
      const campaigns = await getAll('campaigns', { detailed: true })
      const out: NormalizedEntity[] = []
      for (const c of campaigns) {
        if (c['id'] === undefined || c['id'] === null) continue
        const campaign = normalizeExoCampaign(account, c)
        out.push(campaign)
        const res = await client.get(`campaigns/${encodeURIComponent(campaign.externalId)}/variation`)
        // The swagger names the list `variations`; read `result` too in case the live API matches its other lists.
        const list = Array.isArray(res['variations']) ? res['variations'] : Array.isArray(res['result']) ? res['result'] : []
        for (const v of list) {
          if (v && typeof v === 'object') out.push(normalizeExoVariation(account, campaign.externalId, v as Json))
        }
      }
      return out
    },

    async pullInsights(range: DateRange, level: EntityLevel) {
      if (level !== 'ad' && level !== 'campaign') {
        throw new ExoClickError('bad_response', `ExoClick insights are reported per variation (ad) or campaign, not ${level}.`)
      }
      const path = level === 'ad' ? 'statistics/a/variation' : 'statistics/a/campaign'
      const rows: NormalizedInsightRow[] = []
      for (const day of exoDays(range)) {
        // Pages are joined before parsing so an id split across two pages is summed, not overwritten.
        const result: unknown[] = []
        for (let page = 0; ; page++) {
          if (page >= MAX_PAGES) throw new ExoClickError('bad_response', `ExoClick GET ${path} paged past ${MAX_PAGES} pages.`, { path })
          const json = await client.get(path, {
            'date-from': day, 'date-to': day, include: 'goals', limit: PAGE_LIMIT, offset: page * PAGE_LIMIT,
          })
          if (!Array.isArray(json['result'])) throw new ExoClickError('bad_response', `ExoClick statistics for ${day} returned no result array.`, { path })
          result.push(...json['result'])
          if (json['result'].length < PAGE_LIMIT) break
        }
        rows.push(...parseExoStatsPage(level, day, { result }))
      }
      return rows
    },

    async createPaused() {
      throw new ChannelNotEnabledError(EXOCLICK_CHANNEL, 'createPaused')
    },

    async mutate(m) {
      throw new ChannelNotEnabledError(EXOCLICK_CHANNEL, `mutate:${m.verb}`)
    },

    async policyCheck(ctx) {
      return exoclickPolicyCheck(ctx as ExoPolicyContext)
    },
  }
}

export const exoclickAdapter: ChannelAdapter = createExoclickAdapter()
