/**
 * Hourly ads health counters and the L3 funnel-break rule (plan §9.2, §9.3,
 * §9.8, phase 2d, ticket #16410).
 *
 * Once per /cron/ads-insights run, after the pull, sampleAdHealth() writes one
 * ad_health_samples row (migration 134) per key:
 *
 * - hello_ok: 1 when GET https://curious.xdipx.com/hello answers 2xx inside
 *   HELLO_TIMEOUT_MS, else 0 with the status or error in detail.
 * - lead_posts_1h: successful lead captures in the last 60 minutes. /api/lead
 *   keeps no row of its own for an email-only signup (Klaviyo holds the
 *   profile; lead_sms_subscriptions only sees SMS opt-ins), so the route now
 *   writes one `lead_post_event` row here per successful Klaviyo subscribe,
 *   and this counts them. That is the lightweight counter the ticket allowed.
 * - landing_views_today: today's (UTC) sum of Meta's `landing_page_view`
 *   action across ad-level rows in ad_platform_insights_daily.
 * - landing_views_1h: that sum minus the previous sample's, floored at 0. The
 *   first sample of a UTC day takes the whole day so far; the very first
 *   sample ever records 0 and is marked as the baseline, so a deploy mid-day
 *   cannot read a morning's views against a lead counter that only just
 *   started.
 * - lead_events_6h: Lead events sent by meta-capi in the last 6h. meta-capi
 *   keeps no ledger for Lead (sendCapiLead logs and returns an event id, and
 *   only Purchase has a ledger), so this records 0 with detail
 *   `{ ledger: false }` until one exists.
 * - growth_campaign_active: 1 when the entity mirror shows the Shopify Growth
 *   campaign (GROWTH_CAMPAIGN_EXTERNAL_ID on meta) with effective_status
 *   ACTIVE, else 0. A missing mirror row is 0 with `found: false`.
 *
 * Then runAdHealth() evaluates L3 over the last 6h of samples. A firing writes
 * one ad_rule_events row (rule L3, action pause, applied_by null: a
 * recommendation, auto-apply waits for phase 5) at most once per 6h, and files
 * the `ads-funnel-break` owner blocker. A clean evaluation clears that blocker.
 * growth_campaign_active == 1 files `ads-growth-campaign-active` the same way,
 * and a mirror row that reads anything but ACTIVE clears it. Both rows also
 * carry the `ad_health_clean` probe, so the daily verify sweep agrees with the
 * hourly run.
 *
 * Healthy inputs for the phase 4b L3 evaluator: HealthSample below is the
 * `{ sampledAt, key, value }` shape. #16428 was not open when this landed, so
 * the shape is defined here.
 *
 * Nothing here calls a platform write endpoint.
 */
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'

import type { BlockerInput, ProbeVerdict } from '~/lib/owner-blockers-core'
import { adHealthSamples, adPlatformEntities, adPlatformInsightsDaily, adRuleEvents } from '../../../db/schema'

export const HELLO_URL = 'https://curious.xdipx.com/hello'
export const HELLO_TIMEOUT_MS = 5_000
/** The Shopify Growth campaign on Meta (plan §9.8: its re-enabling is a page). */
export const GROWTH_CAMPAIGN_EXTERNAL_ID = '120249603764920056'
export const GROWTH_CAMPAIGN_PLATFORM = 'meta'
export const LANDING_VIEW_ACTION = 'landing_page_view'

export const HEALTH_KEYS = {
  helloOk: 'hello_ok',
  leadPosts1h: 'lead_posts_1h',
  landingViews1h: 'landing_views_1h',
  landingViewsToday: 'landing_views_today',
  leadEvents6h: 'lead_events_6h',
  growthCampaignActive: 'growth_campaign_active',
} as const
/** One row per successful /api/lead capture. Counted into lead_posts_1h. */
export const LEAD_POST_EVENT_KEY = 'lead_post_event'

export const L3_RULE_ID = 'L3'
export const L3_WINDOW_MS = 6 * 3_600_000
export const L3_MIN_LANDING_VIEWS = 30
export const L3_COOLDOWN_MS = 6 * 3_600_000
export const FUNNEL_BREAK_KEY = 'ads-funnel-break'
export const GROWTH_ACTIVE_KEY = 'ads-growth-campaign-active'
export const HEALTH_PROBE = 'ad_health_clean'
/** The probe reads only samples this fresh; older means the hourly run stopped, which it cannot judge. */
const PROBE_FRESH_MS = 3 * 3_600_000

const HOUR_MS = 3_600_000

/** One health reading. The input shape for L3, here and in the phase 4b evaluator. */
export interface HealthSample {
  sampledAt: string | Date
  key: string
  value: number
  detail?: Record<string, unknown> | null
}

function at(s: HealthSample): number {
  return s.sampledAt instanceof Date ? s.sampledAt.getTime() : Date.parse(s.sampledAt)
}

// ---------------------------------------------------------------------------
// L3, pure.
// ---------------------------------------------------------------------------

export interface FunnelBreakEvaluation {
  fires: boolean
  /** Which half fired: the landing views without leads, the /hello probe, or both. */
  reasons: Array<'no_leads' | 'hello_down'>
  /** One plain sentence for the rule row, the blocker and the console. Null when clean. */
  sentence: string | null
  landingViews6h: number
  leadPosts6h: number
  /** The two latest hello_ok values, newest first. */
  helloLatest: number[]
  windowStart: string
  windowEnd: string
}

/**
 * L3 (plan §9.3): at least L3_MIN_LANDING_VIEWS landing views summed over a
 * rolling 6h with zero lead posts summed over the same 6h, or hello_ok 0 on
 * the two latest samples. `now` defaults to the newest sample. The no-leads
 * half needs at least one lead_posts_1h sample in the window, so a window with
 * no lead counter at all reads as unknown rather than as zero leads.
 */
export function evaluateFunnelBreak(samples: readonly HealthSample[], now?: Date): FunnelBreakEvaluation {
  const end = now?.getTime() ?? samples.reduce((m, s) => Math.max(m, at(s)), 0)
  const start = end - L3_WINDOW_MS
  const inWindow = samples.filter(s => {
    const t = at(s)
    return Number.isFinite(t) && t > start && t <= end
  })
  const sum = (key: string) => inWindow.filter(s => s.key === key).reduce((n, s) => n + (Number(s.value) || 0), 0)
  const landingViews6h = sum(HEALTH_KEYS.landingViews1h)
  const leadPosts6h = sum(HEALTH_KEYS.leadPosts1h)
  const haveLeadCounter = inWindow.some(s => s.key === HEALTH_KEYS.leadPosts1h)

  const helloLatest = samples
    .filter(s => s.key === HEALTH_KEYS.helloOk && Number.isFinite(at(s)) && at(s) <= end)
    .sort((a, b) => at(b) - at(a))
    .slice(0, 2)
    .map(s => Number(s.value))

  const reasons: FunnelBreakEvaluation['reasons'] = []
  if (haveLeadCounter && landingViews6h >= L3_MIN_LANDING_VIEWS && leadPosts6h === 0) reasons.push('no_leads')
  if (helloLatest.length === 2 && helloLatest.every(v => v === 0)) reasons.push('hello_down')

  const parts: string[] = []
  if (reasons.includes('no_leads')) {
    parts.push(`Meta reported ${landingViews6h} landing views in the last 6 hours and /api/lead recorded no signups.`)
  }
  if (reasons.includes('hello_down')) {
    parts.push(`${HELLO_URL} failed the last two hourly probes.`)
  }
  return {
    fires: reasons.length > 0,
    reasons,
    sentence: parts.length > 0 ? parts.join(' ') : null,
    landingViews6h,
    leadPosts6h,
    helloLatest,
    windowStart: new Date(start).toISOString(),
    windowEnd: new Date(end).toISOString(),
  }
}

/** Hourly delta of a cumulative day counter. Exported for tests. */
export function landingDelta(
  today: string,
  cumulative: number,
  previous: { value: number; day: string | null } | null,
): { value: number; baseline: boolean } {
  if (!previous) return { value: 0, baseline: true }
  if (previous.day !== today) return { value: Math.max(0, cumulative), baseline: false }
  // Meta restates downward sometimes; a negative hour is not a real hour.
  return { value: Math.max(0, cumulative - previous.value), baseline: false }
}

// ---------------------------------------------------------------------------
// Blockers, pure.
// ---------------------------------------------------------------------------

export function funnelBreakBlocker(ev: FunnelBreakEvaluation): BlockerInput {
  return {
    dedupeKey: FUNNEL_BREAK_KEY,
    title: 'Lead funnel looks broken: pause the Meta lead ads until curious.xdipx.com takes signups',
    detail: [
      ev.sentence ?? '',
      `Window ${ev.windowStart} to ${ev.windowEnd}: ${ev.landingViews6h} landing views, ${ev.leadPosts6h} signups. `
      + `Latest /hello probes, newest first: ${ev.helloLatest.length > 0 ? ev.helloLatest.join(', ') : 'none'} (1 is up).`,
      'Rule L3 wrote a pause recommendation to ad_rule_events. Nothing was paused: auto-apply waits for phase 5. '
      + 'This row clears itself on the first clean hourly check.',
    ].join('\n\n'),
    unblocks: 'Paid lead spend that is landing visitors on a page that cannot take their email.',
    whereToGo:
      'Meta Ads Manager, ad account 920738511029316: pause the lead campaign. Then open '
      + `${HELLO_URL} and try one signup.`,
    category: 'execute',
    priority: 1,
    source: 'sweep',
    sourceRef: 'cron:ads-insights',
    verifyProbe: HEALTH_PROBE,
    verifyArg: 'funnel',
  }
}

export function growthActiveBlocker(detail: Record<string, unknown> | null | undefined): BlockerInput {
  const synced = typeof detail?.['lastSyncedAt'] === 'string' ? ` (mirror synced ${detail['lastSyncedAt']})` : ''
  return {
    dedupeKey: GROWTH_ACTIVE_KEY,
    title: 'Shopify Growth campaign is ACTIVE on Meta again: pause it',
    detail: [
      `The entity mirror shows campaign ${GROWTH_CAMPAIGN_EXTERNAL_ID} with effective_status ACTIVE${synced}.`,
      'Shopify Growth turns it back on by itself. It runs outside the control plane\'s caps and rules, '
      + 'and plan §9.8 makes its return a page.',
      'This row clears itself once the mirror reads it as anything but ACTIVE.',
    ].join('\n\n'),
    unblocks: 'Spend that bypasses the daily and monthly caps.',
    whereToGo: `Meta Ads Manager, ad account 920738511029316: pause campaign ${GROWTH_CAMPAIGN_EXTERNAL_ID}. `
      + 'If it keeps coming back, turn off Shopify Growth in the Shopify admin.',
    category: 'execute',
    priority: 1,
    source: 'sweep',
    sourceRef: 'cron:ads-insights',
    verifyProbe: HEALTH_PROBE,
    verifyArg: 'growth',
  }
}

// ---------------------------------------------------------------------------
// IO seams.
// ---------------------------------------------------------------------------

export interface HelloResult {
  ok: boolean
  status: number | null
  error?: string
  ms: number
}

export interface CampaignStatus {
  effectiveStatus: string | null
  lastSyncedAt: string | null
}

export interface RuleEventInput {
  ruleId: string
  firedAt: Date
  action: string
  detail: Record<string, unknown>
}

export interface HealthStore {
  insertSamples(rows: HealthSample[]): Promise<void>
  countEvents(key: string, since: Date): Promise<number>
  latestSample(key: string): Promise<HealthSample | null>
  recentSamples(keys: readonly string[], since: Date): Promise<HealthSample[]>
  /** Sum of the action across ad-level rows for one platform and day. */
  actionSumForDay(platform: string, day: string, action: string): Promise<number>
  campaignStatus(platform: string, externalId: string): Promise<CampaignStatus | null>
  lastRuleEventAt(ruleId: string): Promise<Date | null>
  insertRuleEvent(row: RuleEventInput): Promise<number>
}

type FileBlockerFn = (input: BlockerInput) => Promise<{ id: number; created: boolean; reopened: boolean }>
type ClearBlockerFn = (dedupeKey: string, note: string) => Promise<boolean>

export interface AdHealthDeps {
  store?: HealthStore
  fetchHello?: () => Promise<HelloResult>
  /** Lead events in the last 6h. Defaults to 0 with `{ ledger: false }`; see the header. */
  leadEvents6h?: (since: Date) => Promise<{ value: number; detail: Record<string, unknown> }>
  fileBlocker?: FileBlockerFn
  clearBlocker?: ClearBlockerFn
  now?: () => Date
}

async function defaultFetchHello(): Promise<HelloResult> {
  const started = Date.now()
  try {
    const res = await fetch(HELLO_URL, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'user-agent': 'xdipx-ads-health/1.0 (+cron:ads-insights)' },
      signal: AbortSignal.timeout(HELLO_TIMEOUT_MS),
    })
    // Drain the body so the connection closes; the content does not matter.
    await res.arrayBuffer().catch(() => undefined)
    return { ok: res.ok, status: res.status, ms: Date.now() - started }
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    return {
      ok: false,
      status: null,
      error: name === 'TimeoutError' || name === 'AbortError' ? `timeout after ${HELLO_TIMEOUT_MS}ms` : String(err).slice(0, 200),
      ms: Date.now() - started,
    }
  }
}

async function defaultLeadEvents6h(): Promise<{ value: number; detail: Record<string, unknown> }> {
  return { value: 0, detail: { ledger: false, note: 'no ledger: meta-capi does not record Lead sends' } }
}

async function defaultFileBlocker(input: BlockerInput) {
  const { fileBlocker } = await import('~/lib/owner-blockers.server')
  return fileBlocker(input)
}

async function defaultClearBlocker(dedupeKey: string, note: string): Promise<boolean> {
  const { clearBlockerByKey } = await import('~/lib/owner-blockers.server')
  return clearBlockerByKey(dedupeKey, 'auto', note)
}

function ymd(d: Date): string { return d.toISOString().slice(0, 10) }

// ---------------------------------------------------------------------------
// Sampling.
// ---------------------------------------------------------------------------

/** Take and store this hour's samples. Returns what it wrote. */
export async function sampleAdHealth(deps: AdHealthDeps = {}): Promise<HealthSample[]> {
  const store = deps.store ?? await drizzleHealthStore()
  const now = (deps.now ?? (() => new Date()))()
  const sampledAt = now.toISOString()
  const today = ymd(now)

  const hello = await (deps.fetchHello ?? defaultFetchHello)()
  const leadPosts = await store.countEvents(LEAD_POST_EVENT_KEY, new Date(now.getTime() - HOUR_MS))

  const landingToday = await store.actionSumForDay('meta', today, LANDING_VIEW_ACTION)
  const prev = await store.latestSample(HEALTH_KEYS.landingViewsToday)
  const prevDay = typeof prev?.detail?.['day'] === 'string' ? (prev.detail['day'] as string) : null
  const delta = landingDelta(today, landingToday, prev ? { value: Number(prev.value), day: prevDay } : null)

  const leadEvents = await (deps.leadEvents6h ?? defaultLeadEvents6h)(new Date(now.getTime() - L3_WINDOW_MS))

  const growth = await store.campaignStatus(GROWTH_CAMPAIGN_PLATFORM, GROWTH_CAMPAIGN_EXTERNAL_ID)
  const growthActive = growth?.effectiveStatus?.toUpperCase() === 'ACTIVE'

  const rows: HealthSample[] = [
    {
      sampledAt, key: HEALTH_KEYS.helloOk, value: hello.ok ? 1 : 0,
      detail: { url: HELLO_URL, status: hello.status, ms: hello.ms, ...(hello.error ? { error: hello.error } : {}) },
    },
    { sampledAt, key: HEALTH_KEYS.leadPosts1h, value: leadPosts, detail: { source: LEAD_POST_EVENT_KEY } },
    { sampledAt, key: HEALTH_KEYS.landingViewsToday, value: landingToday, detail: { day: today, platform: 'meta' } },
    {
      sampledAt, key: HEALTH_KEYS.landingViews1h, value: delta.value,
      detail: { day: today, cumulative: landingToday, ...(delta.baseline ? { baseline: true } : {}) },
    },
    { sampledAt, key: HEALTH_KEYS.leadEvents6h, value: leadEvents.value, detail: leadEvents.detail },
    {
      sampledAt, key: HEALTH_KEYS.growthCampaignActive, value: growthActive ? 1 : 0,
      detail: {
        externalId: GROWTH_CAMPAIGN_EXTERNAL_ID,
        found: growth !== null,
        effectiveStatus: growth?.effectiveStatus ?? null,
        lastSyncedAt: growth?.lastSyncedAt ?? null,
      },
    },
  ]
  await store.insertSamples(rows)
  return rows
}

// ---------------------------------------------------------------------------
// The hourly step.
// ---------------------------------------------------------------------------

export interface BlockerOutcome {
  action: 'filed' | 'cleared' | 'none'
  id?: number
  error?: string
}

export interface AdHealthResult {
  samples: HealthSample[]
  l3: FunnelBreakEvaluation
  /** The ad_rule_events row: written, or skipped because one already fired inside the cooldown. */
  ruleEvent: { written: boolean; id?: number; skipped?: string }
  funnelBlocker: BlockerOutcome
  growthBlocker: BlockerOutcome
}

async function fileOrClear(
  fire: boolean,
  clear: boolean,
  input: () => BlockerInput,
  key: string,
  file: FileBlockerFn,
  clearFn: ClearBlockerFn,
): Promise<BlockerOutcome> {
  try {
    if (fire) {
      const r = await file(input())
      return { action: 'filed', id: r.id }
    }
    if (clear) {
      const cleared = await clearFn(key, 'hourly ads health check came back clean')
      return { action: cleared ? 'cleared' : 'none' }
    }
    return { action: 'none' }
  } catch (err) {
    console.error(`[ads-health] blocker ${key} failed:`, err)
    return { action: 'none', error: String(err).slice(0, 300) }
  }
}

/**
 * Sample, evaluate L3, write the recommendation row, and file or clear the two
 * blockers. Throws only when sampling or reading samples fails; the caller in
 * runInsightsCron catches that so the pull result still stands.
 */
export async function runAdHealth(deps: AdHealthDeps = {}): Promise<AdHealthResult> {
  const store = deps.store ?? await drizzleHealthStore()
  const now = (deps.now ?? (() => new Date()))()
  const file = deps.fileBlocker ?? defaultFileBlocker
  const clearFn = deps.clearBlocker ?? defaultClearBlocker

  const samples = await sampleAdHealth({ ...deps, store, now: () => now })
  const recent = await store.recentSamples(
    [HEALTH_KEYS.helloOk, HEALTH_KEYS.leadPosts1h, HEALTH_KEYS.landingViews1h],
    // A little past 6h so the hello pair always has its previous probe.
    new Date(now.getTime() - L3_WINDOW_MS - 2 * HOUR_MS),
  )
  const l3 = evaluateFunnelBreak(recent, now)

  let ruleEvent: AdHealthResult['ruleEvent'] = { written: false }
  if (l3.fires) {
    const last = await store.lastRuleEventAt(L3_RULE_ID)
    if (last && now.getTime() - last.getTime() < L3_COOLDOWN_MS) {
      ruleEvent = { written: false, skipped: `L3 already fired at ${last.toISOString()}` }
    } else {
      const id = await store.insertRuleEvent({
        ruleId: L3_RULE_ID,
        firedAt: now,
        action: 'pause',
        detail: {
          recommendation: true,
          scope: 'all lead ads',
          sentence: l3.sentence,
          reasons: l3.reasons,
          landingViews6h: l3.landingViews6h,
          leadPosts6h: l3.leadPosts6h,
          helloLatest: l3.helloLatest,
          windowStart: l3.windowStart,
          windowEnd: l3.windowEnd,
        },
      })
      ruleEvent = { written: true, id }
    }
  }

  const funnelBlocker = await fileOrClear(l3.fires, true, () => funnelBreakBlocker(l3), FUNNEL_BREAK_KEY, file, clearFn)

  const growth = samples.find(s => s.key === HEALTH_KEYS.growthCampaignActive)
  const growthFound = growth?.detail?.['found'] === true
  const growthBlocker = await fileOrClear(
    growth?.value === 1,
    // Only a real mirror reading clears it; a missing row cannot say the campaign is off.
    growthFound && growth?.value === 0,
    () => growthActiveBlocker(growth?.detail),
    GROWTH_ACTIVE_KEY,
    file,
    clearFn,
  )

  return { samples, l3, ruleEvent, funnelBlocker, growthBlocker }
}

// ---------------------------------------------------------------------------
// The probe and the lead counter.
// ---------------------------------------------------------------------------

/**
 * The `ad_health_clean` probe. Arg `funnel`: true when L3 does not fire on
 * the stored samples, false when it does. Arg `growth`: true when the latest
 * mirror reading is not ACTIVE, false when it is. Null when the samples are
 * stale (the hourly run stopped) or the mirror has no row.
 */
export async function probeAdHealth(arg: string, deps: { store?: HealthStore; now?: () => Date } = {}): Promise<ProbeVerdict> {
  const store = deps.store ?? await drizzleHealthStore()
  const now = (deps.now ?? (() => new Date()))()
  const which = arg.trim()
  if (which === 'growth') {
    const s = await store.latestSample(HEALTH_KEYS.growthCampaignActive)
    if (!s || now.getTime() - at(s) > PROBE_FRESH_MS || s.detail?.['found'] !== true) return null
    return Number(s.value) === 0
  }
  if (which === 'funnel') {
    const recent = await store.recentSamples(
      [HEALTH_KEYS.helloOk, HEALTH_KEYS.leadPosts1h, HEALTH_KEYS.landingViews1h],
      new Date(now.getTime() - L3_WINDOW_MS - 2 * HOUR_MS),
    )
    const newest = recent.reduce((m, s) => Math.max(m, at(s)), 0)
    if (recent.length === 0 || now.getTime() - newest > PROBE_FRESH_MS) return null
    return !evaluateFunnelBreak(recent, now).fires
  }
  return null
}

/**
 * One row per successful /api/lead capture. Awaited by the route (Vercel
 * discards work after the response) and never throws: a counter failure must
 * not cost a visitor their code.
 */
export async function recordLeadPostEvent(detail: Record<string, unknown>, deps: { store?: HealthStore; now?: () => Date } = {}): Promise<void> {
  try {
    const store = deps.store ?? await drizzleHealthStore()
    const now = (deps.now ?? (() => new Date()))()
    await store.insertSamples([{ sampledAt: now.toISOString(), key: LEAD_POST_EVENT_KEY, value: 1, detail }])
  } catch (err) {
    console.error('[ads-health] could not record the lead post (ignored):', String(err).slice(0, 200))
  }
}

// ---------------------------------------------------------------------------
// The Drizzle store.
// ---------------------------------------------------------------------------

export async function drizzleHealthStore(): Promise<HealthStore> {
  const { db } = await import('~/lib/db.server')
  const t = adHealthSamples
  const toSample = (r: { sampledAt: Date; key: string; value: string; detail: Record<string, unknown> | null }): HealthSample => ({
    sampledAt: r.sampledAt.toISOString(),
    key: r.key,
    value: Number(r.value),
    detail: r.detail,
  })
  return {
    async insertSamples(rows) {
      if (rows.length === 0) return
      await db.insert(t).values(rows.map(r => ({
        sampledAt: r.sampledAt instanceof Date ? r.sampledAt : new Date(r.sampledAt),
        key: r.key,
        value: String(r.value),
        detail: r.detail ?? null,
      })))
    },

    async countEvents(key, since) {
      const [row] = await db
        .select({ n: sql<string>`count(*)` })
        .from(t)
        .where(and(eq(t.key, key), gte(t.sampledAt, since)))
      return Number(row?.n ?? 0)
    },

    async latestSample(key) {
      const [row] = await db.select().from(t).where(eq(t.key, key)).orderBy(desc(t.sampledAt)).limit(1)
      return row ? toSample(row) : null
    },

    async recentSamples(keys, since) {
      if (keys.length === 0) return []
      const rows = await db
        .select()
        .from(t)
        .where(and(inArray(t.key, [...keys]), gte(t.sampledAt, since)))
        .orderBy(t.sampledAt)
      return rows.map(toSample)
    },

    async actionSumForDay(platform, day, action) {
      const i = adPlatformInsightsDaily
      const [row] = await db
        .select({ n: sql<string>`coalesce(sum((${i.actions} ->> ${action})::numeric), 0)` })
        .from(i)
        .where(and(eq(i.platform, platform), eq(i.level, 'ad'), eq(i.day, day)))
      return Number(row?.n ?? 0)
    },

    async campaignStatus(platform, externalId) {
      const e = adPlatformEntities
      const [row] = await db
        .select({ effectiveStatus: e.effectiveStatus, lastSyncedAt: e.lastSyncedAt })
        .from(e)
        .where(and(eq(e.platform, platform), eq(e.externalId, externalId)))
        .limit(1)
      return row ? { effectiveStatus: row.effectiveStatus, lastSyncedAt: row.lastSyncedAt.toISOString() } : null
    },

    async lastRuleEventAt(ruleId) {
      const [row] = await db
        .select({ firedAt: adRuleEvents.firedAt })
        .from(adRuleEvents)
        .where(eq(adRuleEvents.ruleId, ruleId))
        .orderBy(desc(adRuleEvents.firedAt))
        .limit(1)
      return row?.firedAt ?? null
    },

    async insertRuleEvent(row) {
      const [out] = await db
        .insert(adRuleEvents)
        .values({ ruleId: row.ruleId, creativeId: null, firedAt: row.firedAt, action: row.action, detail: row.detail, appliedBy: null })
        .returning({ id: adRuleEvents.id })
      return out?.id ?? 0
    },
  }
}
