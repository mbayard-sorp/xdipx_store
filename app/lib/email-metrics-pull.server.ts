/**
 * Daily Klaviyo reporting pull for the promo email program (ticket #15004,
 * docs/store-team/routine-email-daily.md). /cron/email-metrics-pull reads back
 * how each `email_sends` campaign from the last PULL_WINDOW_DAYS actually
 * performed, and joins that to `order_attribution` so a campaign's blocks are
 * credited with the orders they produced.
 *
 * One batched `campaign-values-reports` call per run, across every campaign
 * due for a pull, because that endpoint's own rate limit is far tighter than
 * the rest of the Klaviyo API (burst 1/s, steady 2/min, 225/day). A 429 is
 * retried with backoff rather than treated as a hard failure.
 *
 * `email_campaign_metrics` is append-only (db/schema.ts): this always INSERTs
 * a fresh row per campaign per run rather than upserting, so metrics history
 * survives a re-pull.
 */
import { and, eq, gte, isNotNull } from 'drizzle-orm'
import { db } from './db.server'
import { emailSends, emailCampaignMetrics, orderAttribution } from '../../db/schema'
import { getMetricIdsByName } from './klaviyo-flows.server'
import { listKlaviyoCampaigns, previewKlaviyoCampaign, type KlaviyoCampaignResource } from './klaviyo-campaigns.server'

const KLAVIYO_BASE = 'https://a.klaviyo.com/api'
const KLAVIYO_REVISION = '2026-07-15'

/** How far back an `email_sends` row is still worth pulling metrics for. */
export const PULL_WINDOW_DAYS = 30

export const CAMPAIGN_VALUES_STATISTICS = [
  'recipients', 'delivered', 'opens_unique', 'clicks_unique',
  'conversions', 'conversion_value', 'unsubscribes', 'spam_complaints', 'bounced',
] as const
export type CampaignValuesStatistic = typeof CAMPAIGN_VALUES_STATISTICS[number]

export interface CampaignValuesReportResult {
  groupings: { campaign_id?: string; campaign_message_id?: string; send_channel?: string }
  statistics: Partial<Record<CampaignValuesStatistic, number>>
}

async function klaviyoFetch<T>(path: string, method = 'GET', body?: unknown, attempt = 0): Promise<T> {
  const init: RequestInit = {
    method,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      revision: KLAVIYO_REVISION,
      Authorization: `Klaviyo-API-Key ${process.env['KLAVIYO_API_KEY']}`,
    },
  }
  if (body !== undefined) init.body = JSON.stringify(body)
  const res = await fetch(`${KLAVIYO_BASE}${path}`, init)
  // The campaign-values-reports endpoint's own limit is 1/s burst, 2/min
  // steady: a 429 here is expected under any real concurrency, not a defect.
  if (res.status === 429 && attempt < 3) {
    const retryAfterHeader = Number(res.headers.get('retry-after'))
    const waitSeconds = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader : (attempt + 1) * 2
    await new Promise(r => setTimeout(r, waitSeconds * 1000))
    return klaviyoFetch<T>(path, method, body, attempt + 1)
  }
  const text = await res.text()
  if (!res.ok) throw new Error(`Klaviyo ${method} ${path} ${res.status}: ${text.slice(0, 1000)}`)
  return (text ? JSON.parse(text) : {}) as T
}

/**
 * One batched campaign-values-report covering every campaign id due this run.
 * `conversionMetricId` must be the id of the Placed Order metric the account
 * fires on real orders, per `getMetricIdsByName`'s Shopify-integration
 * preference (ticket #15004's own fix for the name-only collision there).
 */
export async function fetchCampaignValuesReport(
  campaignIds: string[],
  conversionMetricId: string,
): Promise<CampaignValuesReportResult[]> {
  if (campaignIds.length === 0) return []
  const idList = campaignIds.map(id => JSON.stringify(id)).join(',')
  const filter = `and(contains-any(campaign_id,[${idList}]),equals(send_channel,"email"))`
  const json = await klaviyoFetch<{
    data?: { attributes?: { results?: CampaignValuesReportResult[] } }
  }>('/campaign-values-reports/', 'POST', {
    data: {
      type: 'campaign-values-report',
      attributes: {
        statistics: CAMPAIGN_VALUES_STATISTICS,
        timeframe: { key: 'last_30_days' },
        conversion_metric_id: conversionMetricId,
        group_by: ['campaign_id', 'campaign_message_id', 'send_channel'],
        filter,
      },
    },
  })
  return json.data?.attributes?.results ?? []
}

export interface KlaviyoCampaignStatus {
  status: string
  sendTime: string | null
}

/** Read back a campaign's send status. 'Sent' is the only status this module acts on. */
export async function fetchCampaignStatus(campaignId: string): Promise<KlaviyoCampaignStatus> {
  const json = await klaviyoFetch<{
    data?: { attributes?: { status?: string; send_time?: string | null } }
  }>(`/campaigns/${encodeURIComponent(campaignId)}/?fields[campaign]=status,send_time`)
  return {
    status: json.data?.attributes?.status ?? 'Unknown',
    sendTime: json.data?.attributes?.send_time ?? null,
  }
}

/**
 * Sums statistics across every result group for one campaign id. A campaign
 * ordinarily has one campaign-message group; an A/B test has more than one,
 * and the daily send should be reported as one number either way.
 */
export function sumStatisticsForCampaign(
  results: CampaignValuesReportResult[],
  campaignId: string,
): Partial<Record<CampaignValuesStatistic, number>> {
  const out: Partial<Record<CampaignValuesStatistic, number>> = {}
  for (const r of results) {
    if (r.groupings.campaign_id !== campaignId) continue
    for (const stat of CAMPAIGN_VALUES_STATISTICS) {
      const v = r.statistics[stat]
      if (typeof v === 'number') out[stat] = (out[stat] ?? 0) + v
    }
  }
  return out
}

export interface EmailAttribution {
  attributedOrders: number
  attributedRevenue: string
  byBlock: Record<string, { orders: number; revenue: string }>
}

/**
 * Joins `order_attribution` by `utm_campaign` (the daily assembler stamps
 * every block link with `utm_campaign=<campaignKey>`, per
 * docs/store-team/routine-email-daily.md), and groups by `utm_content` for
 * the per-block breakdown.
 */
export async function orderAttributionForCampaign(campaignKey: string): Promise<EmailAttribution> {
  const rows = await db
    .select({ utmContent: orderAttribution.utmContent, totalPrice: orderAttribution.totalPrice })
    .from(orderAttribution)
    .where(eq(orderAttribution.utmCampaign, campaignKey))

  let attributedOrders = 0
  let attributedRevenue = 0
  const byBlock: Record<string, { orders: number; revenue: number }> = {}
  for (const row of rows) {
    attributedOrders++
    const price = parseFloat(row.totalPrice ?? '0') || 0
    attributedRevenue += price
    const block = row.utmContent ?? 'unknown'
    const existing = byBlock[block] ?? { orders: 0, revenue: 0 }
    existing.orders++
    existing.revenue += price
    byBlock[block] = existing
  }
  return {
    attributedOrders,
    attributedRevenue: attributedRevenue.toFixed(2),
    byBlock: Object.fromEntries(
      Object.entries(byBlock).map(([k, v]) => [k, { orders: v.orders, revenue: v.revenue.toFixed(2) }]),
    ),
  }
}

export interface EmailMetricsPullResult {
  campaignsChecked: number
  pulled: number
  statusFlipped: number
  errors: string[]
}

/**
 * One run: find every `email_sends` campaign from the last PULL_WINDOW_DAYS,
 * pull their Klaviyo stats in one batched call, join order attribution, write
 * one `email_campaign_metrics` row per campaign, and flip `email_sends.status`
 * to 'sent' for any campaign Klaviyo now reports as sent.
 */
export async function runEmailMetricsPull(): Promise<EmailMetricsPullResult> {
  const result: EmailMetricsPullResult = { campaignsChecked: 0, pulled: 0, statusFlipped: 0, errors: [] }

  if (!process.env['KLAVIYO_API_KEY']) {
    result.errors.push('no-klaviyo-api-key')
    return result
  }

  const since = new Date(Date.now() - PULL_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const rows = await db
    .select({
      id: emailSends.id,
      campaignKey: emailSends.campaignKey,
      klaviyoCampaignId: emailSends.klaviyoCampaignId,
      status: emailSends.status,
    })
    .from(emailSends)
    .where(and(gte(emailSends.createdAt, since), isNotNull(emailSends.klaviyoCampaignId)))

  result.campaignsChecked = rows.length
  if (rows.length === 0) return result

  let conversionMetricId: string | null = null
  try {
    conversionMetricId = (await getMetricIdsByName()).get('Placed Order') ?? null
  } catch (err) {
    result.errors.push(`metric lookup failed: ${(err as Error).message}`)
  }
  if (!conversionMetricId) {
    result.errors.push('no-placed-order-metric-id')
    return result
  }

  const campaignIds = rows
    .map(r => r.klaviyoCampaignId)
    .filter((id): id is string => Boolean(id))

  let reportResults: CampaignValuesReportResult[] = []
  try {
    reportResults = await fetchCampaignValuesReport(campaignIds, conversionMetricId)
  } catch (err) {
    result.errors.push(`campaign-values-report failed: ${(err as Error).message}`)
    return result
  }

  for (const row of rows) {
    const campaignId = row.klaviyoCampaignId
    if (!campaignId) continue
    try {
      const stats = sumStatisticsForCampaign(reportResults, campaignId)
      const attribution = await orderAttributionForCampaign(row.campaignKey)

      await db.insert(emailCampaignMetrics).values({
        campaignKey: row.campaignKey,
        klaviyoCampaignId: campaignId,
        recipients: stats.recipients ?? null,
        delivered: stats.delivered ?? null,
        opensUnique: stats.opens_unique ?? null,
        clicksUnique: stats.clicks_unique ?? null,
        conversions: stats.conversions ?? null,
        conversionValue: stats.conversion_value != null ? stats.conversion_value.toFixed(2) : null,
        unsubscribes: stats.unsubscribes ?? null,
        spamComplaints: stats.spam_complaints ?? null,
        bounced: stats.bounced ?? null,
        attributedOrders: attribution.attributedOrders,
        attributedRevenue: attribution.attributedRevenue,
        byBlock: attribution.byBlock,
      })
      result.pulled++

      if (row.status !== 'sent') {
        const campaignStatus = await fetchCampaignStatus(campaignId)
        if (campaignStatus.status === 'Sent') {
          await db.update(emailSends)
            .set({
              status: 'sent',
              sentAt: campaignStatus.sendTime ? new Date(campaignStatus.sendTime) : new Date(),
            })
            .where(eq(emailSends.id, row.id))
          result.statusFlipped++
        }
      }
    } catch (err) {
      result.errors.push(`campaign ${campaignId}: ${(err as Error).message}`)
    }
  }

  return result
}

// ─── Reconciliation (ticket #20823) ─────────────────────────────────────────
// `email_sends` only ever gained a row through `draftDailyEmail`/
// `pushApprovedCampaign` (app/lib/email-daily-draft.server.ts,
// klaviyo-campaigns.server.ts), both gated behind `email_campaign_push_enabled`.
// Any campaign the owner (or an interactive session) built directly in the
// Klaviyo UI instead never created one, so this store's own measurement loop
// — email_campaign_metrics, email-analyst's hypothesis ledger — has nothing
// to read for those sends even though they are real, live campaigns.
// `runEmailMetricsPull` itself only ever looks AT existing `email_sends`
// rows, so it cannot discover these on its own; reconciliation is a
// separate step the cron route runs first.

export function mapKlaviyoStatusToSendStatus(klaviyoStatus: string): 'drafted' | 'sent' | 'skipped' {
  if (klaviyoStatus === 'Sent') return 'sent'
  if (klaviyoStatus === 'Cancelled') return 'skipped'
  return 'drafted'
}

/** Klaviyo campaign ids never collide with the `daily-YYYYMMDD` keys our own drafting path mints. */
export function reconciledCampaignKey(campaignId: string): string {
  return `klaviyo-${campaignId}`
}

export interface ReconcileResult {
  /** Email-channel campaigns Klaviyo reported. */
  campaignsSeen: number
  /** `email_sends` rows created for a campaign with no existing row. */
  created: number
  errors: string[]
}

/**
 * Backfills `email_sends` for every Klaviyo email campaign with no matching
 * row, matched strictly on `klaviyoCampaignId` so an existing row (drafted
 * through this app) is never duplicated or overwritten. A reconciled row
 * carries `audience: 'reconciled-from-klaviyo'` so the ledger can tell it
 * apart from one our own drafting path created, and `reviewStatus:
 * 'approved'` because a campaign already live in Klaviyo was, by
 * construction, already decided — there is no draft left to review.
 */
export async function reconcileEmailSendsFromKlaviyo(): Promise<ReconcileResult> {
  const result: ReconcileResult = { campaignsSeen: 0, created: 0, errors: [] }

  if (!process.env['KLAVIYO_API_KEY']) {
    result.errors.push('no-klaviyo-api-key')
    return result
  }

  let campaigns: KlaviyoCampaignResource[] = []
  try {
    campaigns = await listKlaviyoCampaigns({ channel: 'email' })
  } catch (err) {
    result.errors.push(`list campaigns failed: ${(err as Error).message}`)
    return result
  }
  result.campaignsSeen = campaigns.length
  if (campaigns.length === 0) return result

  const existingRows = await db
    .select({ klaviyoCampaignId: emailSends.klaviyoCampaignId })
    .from(emailSends)
    .where(isNotNull(emailSends.klaviyoCampaignId))
  const knownCampaignIds = new Set(existingRows.map((r) => r.klaviyoCampaignId))

  for (const campaign of campaigns) {
    if (knownCampaignIds.has(campaign.id)) continue

    try {
      const attrs = campaign.attributes ?? {}
      const status = typeof attrs['status'] === 'string' ? attrs['status'] : 'Unknown'
      const sendTime = typeof attrs['send_time'] === 'string' ? attrs['send_time'] : null
      const name = typeof attrs['name'] === 'string' ? attrs['name'] : null

      // Best effort: the campaign-message subject needs one extra read per
      // newly-discovered campaign. A failure here never blocks the row —
      // the campaign name is still a usable fallback label in the ledger.
      let subject: string | null = null
      try {
        const preview = await previewKlaviyoCampaign(campaign.id)
        const content = preview.messages[0]?.attributes?.['definition'] as Record<string, unknown> | undefined
        const definitionContent = content?.['content'] as Record<string, unknown> | undefined
        subject = typeof definitionContent?.['subject'] === 'string' ? (definitionContent['subject'] as string) : null
      } catch (err) {
        console.error('[email-metrics-pull] reconcile: could not read subject for campaign', campaign.id, err)
      }

      await db
        .insert(emailSends)
        .values({
          campaignKey: reconciledCampaignKey(campaign.id),
          sendDate: sendTime ? sendTime.slice(0, 10) : null,
          klaviyoCampaignId: campaign.id,
          subject: subject ?? name,
          audience: 'reconciled-from-klaviyo',
          status: mapKlaviyoStatusToSendStatus(status),
          sentAt: status === 'Sent' && sendTime ? new Date(sendTime) : null,
          reviewStatus: 'approved',
        })
        .onConflictDoNothing()
      result.created++
    } catch (err) {
      result.errors.push(`campaign ${campaign.id}: ${(err as Error).message}`)
    }
  }

  return result
}
