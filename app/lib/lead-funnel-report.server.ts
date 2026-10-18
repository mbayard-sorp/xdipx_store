/**
 * Lead funnel attribution report (ticket #16145). Server-only.
 *
 * Join: Klaviyo list profiles (interest, utm_content, lead_captured_at) against
 * Klaviyo Placed Order events on the same profile. order_attribution is a
 * secondary count (utm_campaign = 'curious_lead' by utm_content) because it
 * carries no email. Door B comes from GA4 select_promotion 'start_interest'.
 *
 * API budget per request: up to 10 profile pages (100 each, so 1000 leads),
 * 1 metrics lookup, up to 10 event pages (200 each), 1 GA4 report, 1 SQL query.
 */
import { and, eq, gte, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { orderAttribution } from '../../db/schema'
import { getMetricIdsByName } from '~/lib/klaviyo-flows.server'
import { runGa4Report } from '~/lib/ga4.server'
import {
  aggregateLeadFunnel,
  type FunnelAggregate,
  type FunnelLead,
  type FunnelOrder,
} from '~/lib/lead-funnel-report'

const KLAVIYO_BASE = 'https://a.klaviyo.com/api'
const REVISION = '2024-10-15'
export const MAX_LEADS = 1000
const PROFILE_PAGE_SIZE = 100
const MAX_PROFILE_PAGES = MAX_LEADS / PROFILE_PAGE_SIZE
const MAX_EVENT_PAGES = 10
export const DEFAULT_WINDOW_DAYS = 30
export const DOOR_A_CAMPAIGN = 'curious_lead'

async function kfetch<T>(path: string): Promise<T> {
  const res = await fetch(path.startsWith('http') ? path : `${KLAVIYO_BASE}${path}`, {
    headers: {
      accept: 'application/json',
      revision: REVISION,
      Authorization: `Klaviyo-API-Key ${process.env['KLAVIYO_API_KEY']}`,
    },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Klaviyo GET ${path} ${res.status}: ${text.slice(0, 500)}`)
  return JSON.parse(text) as T
}

interface Page<A> {
  data?: Array<{ id: string; attributes: A; relationships?: { profile?: { data?: { id?: string } } } }>
  links?: { next?: string | null }
}

export interface LeadFunnelReport extends FunnelAggregate {
  windowDays: number
  since: string
  listId: string | null
  leadsCap: number
  /** True when the list had more profiles than were read (capped at leadsCap). */
  leadsTruncated: boolean
  leadsRead: number
  ordersRead: number
  ordersTruncated: boolean
  /** Secondary: order_attribution rows with utm_campaign = 'curious_lead'. */
  orderAttribution: Array<{ utmContent: string; orders: number; revenue: number }> | null
  /** Door B: GA4 select_promotion events named start_interest, by creative slot. */
  doorB: { total: number; byInterest: Array<{ interest: string; events: number }> } | null
  /** Anything that could not be read, named. Empty when the report is complete. */
  gaps: string[]
}

async function readLeads(listId: string, sinceMs: number, gaps: string[]) {
  const leads: FunnelLead[] = []
  let read = 0
  let truncated = false
  let path: string | null = `/lists/${encodeURIComponent(listId)}/profiles/?fields[profile]=email,properties&page[size]=${PROFILE_PAGE_SIZE}`
  for (let i = 0; i < MAX_PROFILE_PAGES && path; i++) {
    const res: Page<{ properties?: Record<string, unknown> }> = await kfetch(path)
    for (const p of res.data ?? []) {
      read += 1
      const props = p.attributes.properties ?? {}
      const capturedAt = typeof props['lead_captured_at'] === 'string' ? (props['lead_captured_at'] as string) : ''
      const ms = Date.parse(capturedAt)
      if (!Number.isFinite(ms) || ms < sinceMs) continue
      leads.push({
        profileId: p.id,
        capturedAt,
        interest: typeof props['interest'] === 'string' ? (props['interest'] as string) : null,
        utmContent: typeof props['utm_content'] === 'string' ? (props['utm_content'] as string) : null,
      })
    }
    path = res.links?.next ?? null
  }
  if (path) {
    truncated = true
    gaps.push(`leads capped at ${MAX_LEADS} profiles; the list has more, so older or later leads may be missing`)
  }
  return { leads, read, truncated }
}

async function readOrders(metricId: string, sinceIso: string, gaps: string[]) {
  const orders: FunnelOrder[] = []
  const filter = encodeURIComponent(`and(equals(metric_id,"${metricId}"),greater-than(datetime,${sinceIso}))`)
  let path: string | null = `/events/?filter=${filter}&fields[event]=datetime,event_properties&include=profile&fields[profile]=email&page[size]=200&sort=datetime`
  let truncated = false
  for (let i = 0; i < MAX_EVENT_PAGES && path; i++) {
    const res: Page<{ datetime?: string; event_properties?: Record<string, unknown> }> = await kfetch(path)
    for (const e of res.data ?? []) {
      const profileId = e.relationships?.profile?.data?.id
      if (!profileId || !e.attributes.datetime) continue
      const raw = e.attributes.event_properties?.['$value']
      const value = typeof raw === 'number' ? raw : Number(raw ?? 0)
      orders.push({ profileId, at: e.attributes.datetime, value: Number.isFinite(value) ? value : 0 })
    }
    path = res.links?.next ?? null
  }
  if (path) {
    truncated = true
    gaps.push(`Placed Order events capped at ${MAX_EVENT_PAGES * 200}; revenue may be understated`)
  }
  return { orders, truncated }
}

async function readOrderAttribution(since: Date) {
  const rows = await db
    .select({
      utmContent: orderAttribution.utmContent,
      orders: sql<number>`count(*)::int`,
      revenue: sql<string>`coalesce(sum(${orderAttribution.totalPrice}), 0)::text`,
    })
    .from(orderAttribution)
    .where(and(eq(orderAttribution.utmCampaign, DOOR_A_CAMPAIGN), gte(orderAttribution.createdAt, since)))
    .groupBy(orderAttribution.utmContent)
  return rows.map(r => ({
    utmContent: r.utmContent || '(not set)',
    orders: r.orders,
    revenue: Math.round(Number(r.revenue) * 100) / 100,
  }))
}

async function readDoorB(windowDays: number) {
  const report = await runGa4Report({
    dateRanges: [{ startDate: `${windowDays}daysAgo`, endDate: 'today' }],
    dimensions: [{ name: 'itemPromotionName' }, { name: 'itemPromotionCreativeSlot' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      andGroup: {
        expressions: [
          { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'select_promotion' } } },
          { filter: { fieldName: 'itemPromotionName', stringFilter: { matchType: 'EXACT', value: 'start_interest' } } },
        ],
      },
    },
    limit: 50,
  })
  if (!report) return null
  const byInterest = (report.rows ?? []).map(r => ({
    interest: r.dimensionValues?.[1]?.value || '(not set)',
    events: Number(r.metricValues?.[0]?.value ?? 0),
  }))
  return { total: byInterest.reduce((s, r) => s + r.events, 0), byInterest }
}

export async function buildLeadFunnelReport(opts: {
  windowDays?: number
  listId?: string | null
} = {}): Promise<LeadFunnelReport> {
  const windowDays = Math.min(Math.max(Math.floor(opts.windowDays ?? DEFAULT_WINDOW_DAYS), 1), 90)
  const since = new Date(Date.now() - windowDays * 86_400_000)
  const listId = opts.listId || process.env['KLAVIYO_LIST_ID_PAID_LEADS'] || null
  const gaps: string[] = []

  const base: LeadFunnelReport = {
    ...aggregateLeadFunnel([], [], { start: since }),
    windowDays,
    since: since.toISOString(),
    listId,
    leadsCap: MAX_LEADS,
    leadsTruncated: false,
    leadsRead: 0,
    ordersRead: 0,
    ordersTruncated: false,
    orderAttribution: null,
    doorB: null,
    gaps,
  }

  if (!process.env['KLAVIYO_API_KEY']) gaps.push('KLAVIYO_API_KEY not set')
  else if (!listId) gaps.push('no list id: set KLAVIYO_LIST_ID_PAID_LEADS or pass ?list=')
  else {
    try {
      const { leads, read, truncated } = await readLeads(listId, since.getTime(), gaps)
      base.leadsRead = read
      base.leadsTruncated = truncated
      const metricId = (await getMetricIdsByName()).get('Placed Order')
      let orders: FunnelOrder[] = []
      if (!metricId) gaps.push('Klaviyo metric "Placed Order" not found')
      else if (leads.length > 0) {
        const earliest = leads.reduce((m, l) => (l.capturedAt < m ? l.capturedAt : m), leads[0]!.capturedAt)
        const o = await readOrders(metricId, new Date(Date.parse(earliest)).toISOString().replace(/\.\d+Z$/, ''), gaps)
        orders = o.orders
        base.ordersTruncated = o.truncated
      }
      base.ordersRead = orders.length
      Object.assign(base, aggregateLeadFunnel(leads, orders, { start: since }))
    } catch (err) {
      gaps.push(`klaviyo: ${err instanceof Error ? err.message.slice(0, 300) : String(err)}`)
    }
  }

  try {
    base.orderAttribution = await readOrderAttribution(since)
  } catch (err) {
    gaps.push(`order_attribution: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`)
  }

  try {
    base.doorB = await readDoorB(windowDays)
    if (!base.doorB) gaps.push('GA4 not configured; Door B unavailable')
  } catch (err) {
    gaps.push(`ga4 Door B: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`)
  }

  return base
}
