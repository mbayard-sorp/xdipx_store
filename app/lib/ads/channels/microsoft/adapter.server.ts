/**
 * Microsoft Advertising's ChannelAdapter (plan §3.2, phase 6d, ticket #16437).
 *
 * Read and insights only. It lists Search campaigns, ad groups and ads for the
 * configured account through the existing Campaign Management REST client
 * (microsoft-ads.server.ts), pulls daily performance through the Reporting
 * API v13 (submit, poll, download the zipped CSV), and checks the stored
 * OAuth refresh token. It writes nothing to our database; sync.server.ts and
 * insights.server.ts do that for every channel the same way.
 *
 * mutate stays empty and throws ChannelNotEnabledError until the Adult
 * Advertising Program accepts account 188472831 (docs/ads-policy.md,
 * Microsoft row). Pause, resume and budget belong in microsoft/mutate.server.ts,
 * a protected path that a later owner-merged PR adds.
 *
 * createPaused hands the exporter's payload to the existing paused-only push
 * in ad-export/microsoft-push.server.ts, which keeps its own valve, config
 * and policy checks in front of every call.
 *
 * Environment: MSADS_ENV picks sandbox or production exactly as the rest of
 * the Microsoft code does, sandbox by default.
 */
import { unzipSync } from 'fflate'
import { parse as parseCsv } from 'csv-parse/sync'

import { MsPushError, microsoftPolicyIssues, type MsPushPartial, type MsSearchPayload } from '~/lib/ad-export/microsoft-payload'
import type { MsPushDeps } from '~/lib/ad-export/microsoft-push.server'
import { missingConfig, msAdsConfig, type MsAdsErrorItem, type MsAdsService } from '~/lib/microsoft-ads-core'
import { ChannelNotEnabledError, ChannelNotReadyError, notReadyFromHealthError } from '../errors'
import type {
  ChannelAdapter, ChannelNotReadyReason, CreatedRefs, DateRange, EntityLevel, NormalizedEntity, NormalizedInsightRow, PolicyContext,
  PolicyRefusal, PolicyVerdict, TokenHealth,
} from '../types'

type Json = Record<string, unknown>
type ReadLevel = 'campaign' | 'adset' | 'ad'

/** Raised for a Reporting API job that failed or never finished. */
export class MsAdsReportError extends Error {
  constructor(readonly kind: 'report_failed' | 'report_timeout' | 'bad_response', message: string) {
    super(message)
    this.name = 'MsAdsReportError'
  }
}

// -- Normalization -------------------------------------------------------------

const str = (v: unknown): string | null => {
  if (typeof v === 'string') return v === '' ? null : v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

/** Report CSVs format numbers with thousands separators ("1,234.50"). */
const num = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v !== 'string') return 0
  const n = Number(v.replace(/,/g, '').replace(/%$/, '').trim())
  return Number.isFinite(n) ? n : 0
}

/** Microsoft budgets are in account currency units (dollars); the mirror stores cents. */
export function msBudgetCents(v: unknown): number | null {
  const n = num(v)
  return n > 0 ? Math.round(n * 100) : null
}

function biddingType(row: Json): string | null {
  const b = row['BiddingScheme']
  return b && typeof b === 'object' ? str((b as Json)['Type']) : null
}

/**
 * One Campaign Management object in the mirror's shape. Microsoft has no
 * separate effective status the way Meta does, so it is Status, except on ads
 * whose EditorialStatus is Disapproved: that lands as DISAPPROVED, the value
 * the policy checks and the console already look for.
 */
export function normalizeMsEntity(level: ReadLevel, accountId: string, row: Json, parentExternalId: string | null): NormalizedEntity {
  const status = str(row['Status'])
  const editorial = level === 'ad' ? str(row['EditorialStatus']) : null
  const disapproved = editorial === 'Disapproved'
  const daily = level === 'campaign' && String(row['BudgetType'] ?? '').startsWith('Daily')
  return {
    platform: 'microsoft',
    accountId,
    level,
    externalId: String(row['Id']),
    parentExternalId,
    name: str(row['Name']) ?? (level === 'ad' ? str(row['Type']) : null),
    status,
    effectiveStatus: disapproved ? 'DISAPPROVED' : status,
    // Mirrored objectives drive the lead vs sales rules (plan §9.3). Search
    // campaigns carry no objective of that kind, so it stays null.
    objective: null,
    dailyBudgetCents: daily ? msBudgetCents(row['DailyBudget']) : null,
    lifetimeBudgetCents: null,
    bidStrategy: level === 'ad' ? null : biddingType(row),
    reviewFeedback: disapproved ? { EditorialStatus: editorial } : null,
    raw: row,
  }
}

const REPORT: Record<ReadLevel, { type: string; idColumn: string; columns: string[] }> = {
  campaign: {
    type: 'CampaignPerformanceReportRequest',
    idColumn: 'CampaignId',
    columns: ['TimePeriod', 'AccountId', 'CampaignId', 'Impressions', 'Clicks', 'Spend', 'Conversions', 'Revenue'],
  },
  adset: {
    type: 'AdGroupPerformanceReportRequest',
    idColumn: 'AdGroupId',
    columns: ['TimePeriod', 'AccountId', 'CampaignId', 'AdGroupId', 'Impressions', 'Clicks', 'Spend', 'Conversions', 'Revenue'],
  },
  ad: {
    type: 'AdPerformanceReportRequest',
    idColumn: 'AdId',
    columns: ['TimePeriod', 'AccountId', 'CampaignId', 'AdGroupId', 'AdId', 'Impressions', 'Clicks', 'Spend', 'Conversions', 'Revenue'],
  },
}

/** TimePeriod arrives as YYYY-MM-DD on CSV v2.0; older formats used M/D/YYYY. */
function reportDay(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}` : null
}

/**
 * Parse a downloaded report CSV into insight rows. Rows that share an id and
 * a day are summed, so a report that splits a day by some attribute never
 * writes two rows the upsert would fight over. Microsoft reports no reach
 * and no link clicks for Search; clicks stand in for link clicks because
 * every Search ad click is a click to the landing page.
 */
export function parseMsReportCsv(level: ReadLevel, csv: string): NormalizedInsightRow[] {
  const records = parseCsv(csv.replace(/^﻿/, ''), {
    columns: true, skip_empty_lines: true, relax_column_count: true, trim: true,
  }) as Array<Record<string, string>>
  const idColumn = REPORT[level].idColumn
  const out = new Map<string, NormalizedInsightRow>()
  for (const r of records) {
    const id = str(r[idColumn])
    const day = reportDay(r['TimePeriod'])
    if (!id || !day) continue // footer lines such as the copyright row
    const key = `${id}|${day}`
    const row = out.get(key) ?? {
      platform: 'microsoft' as const, level, externalId: id, day,
      spendCents: 0, impressions: 0, reach: 0, frequency: 0, clicks: 0, linkClicks: 0,
      leads: 0, platformPurchases: 0, platformPurchaseValueCents: 0, actions: {},
    }
    const conversions = num(r['Conversions'])
    row.spendCents += Math.round(num(r['Spend']) * 100)
    row.impressions += Math.round(num(r['Impressions']))
    row.clicks += Math.round(num(r['Clicks']))
    row.linkClicks = row.clicks
    row.platformPurchases += Math.round(conversions)
    row.platformPurchaseValueCents += Math.round(num(r['Revenue']) * 100)
    row.actions = { conversions: (row.actions['conversions'] ?? 0) + conversions }
    out.set(key, row)
  }
  return [...out.values()]
}

/** The first CSV in the downloaded zip. Microsoft sends exactly one. */
export function csvFromReportZip(bytes: Uint8Array): string {
  // A zip starts with PK\x03\x04. Anything else is treated as the CSV itself.
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) return new TextDecoder().decode(bytes)
  const files = unzipSync(bytes)
  const name = Object.keys(files).find(n => n.toLowerCase().endsWith('.csv')) ?? Object.keys(files)[0]
  if (!name) throw new MsAdsReportError('bad_response', 'Microsoft report zip was empty.')
  return new TextDecoder().decode(files[name])
}

const dateParts = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return { Day: d, Month: m, Year: y }
}

export function buildReportRequest(level: ReadLevel, accountId: string, range: DateRange): Json {
  const spec = REPORT[level]
  return {
    ReportRequest: {
      Type: spec.type,
      ReportName: `xdipx ${level} daily ${range.since} to ${range.until}`,
      Format: 'Csv',
      FormatVersion: '2.0',
      ExcludeReportHeader: true,
      ExcludeReportFooter: true,
      ExcludeColumnHeaders: false,
      // Today and yesterday are still settling; the 09:00 UTC restatement
      // pull re-reads them, so partial data is the right call for the hourly pull.
      ReturnOnlyCompleteData: false,
      Aggregation: 'Daily',
      Columns: spec.columns,
      Scope: { AccountIds: [Number(accountId)] },
      // No ReportTimeZone: Microsoft then reports in its default zone, which
      // is how the platform UI's daily numbers line up for this account.
      Time: { CustomDateRangeStart: dateParts(range.since), CustomDateRangeEnd: dateParts(range.until) },
    },
  }
}

// -- Policy --------------------------------------------------------------------

function looksLikeMsPayload(v: unknown): v is MsSearchPayload {
  if (!v || typeof v !== 'object') return false
  const p = v as Json
  return p['version'] === 1 && !!p['campaign'] && !!p['adGroup'] && !!p['ad'] && Array.isArray(p['keywords'])
}

/**
 * The Microsoft policy check: refuse while any mirrored Microsoft ad is
 * disapproved, and, when the caller passes a built payload, run the Adult
 * Advertising Program guard from microsoft-payload.ts over it.
 */
export function microsoftPolicyCheck(ctx: PolicyContext & { payload?: unknown; dailyCapCents?: number }): PolicyVerdict {
  const refusals: PolicyRefusal[] = ctx.mirror
    .filter(r => r.platform === 'microsoft' && r.effectiveStatus === 'DISAPPROVED')
    .map(r => ({
      code: 'microsoft_disapproved',
      message: `Microsoft ${r.level} ${r.externalId}${r.name ? ` (${r.name})` : ''} is disapproved. Resolve it before changing anything on Microsoft.`,
      ref: { platform: 'microsoft', level: r.level, externalId: r.externalId },
    }))
  if (ctx.payload !== undefined) {
    if (!looksLikeMsPayload(ctx.payload)) {
      refusals.push({ code: 'microsoft_payload_invalid', message: 'The payload is not a Microsoft Search payload.' })
    } else {
      for (const issue of microsoftPolicyIssues(ctx.payload, { dailyCapCents: ctx.dailyCapCents ?? 0 })) {
        refusals.push({ code: 'microsoft_program_guard', message: issue })
      }
    }
  }
  return { ok: refusals.length === 0, refusals }
}

// -- Adapter -------------------------------------------------------------------

export interface MicrosoftAdapterDeps {
  call?: <T>(service: MsAdsService, path: string, body: unknown) => Promise<{ data: T; partial: MsAdsErrorItem[] }>
  download?: (url: string) => Promise<Uint8Array>
  accessToken?: () => Promise<string>
  accountId?: () => string
  missingConfig?: () => string[]
  pushDeps?: () => Promise<MsPushDeps>
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  pollIntervalMs?: number
  maxPolls?: number
  /**
   * The not-ready reason the last sync or insights pull stored for Microsoft
   * in ad_channel_health.error, or null. health() reports it as ready: false.
   */
  lastNotReady?: () => Promise<ChannelNotReadyReason | null>
}

const defaultLastNotReady = async (): Promise<ChannelNotReadyReason | null> => {
  try {
    const [{ db }, { adChannelHealth }, { eq }] = await Promise.all([
      import('~/lib/db.server'),
      import('../../../../../db/schema'),
      import('drizzle-orm'),
    ])
    const rows = await db
      .select({ error: adChannelHealth.error })
      .from(adChannelHealth)
      .where(eq(adChannelHealth.channel, 'microsoft'))
      .limit(1)
    return notReadyFromHealthError(rows[0]?.error ?? null)
  } catch (err) {
    // A health reading must never fail on this read; without it the token reads as ready.
    console.warn('[ads/microsoft] could not read the stored not-ready reason (ignored):', String(err).slice(0, 200))
    return null
  }
}

const defaultCall: NonNullable<MicrosoftAdapterDeps['call']> = async (service, path, body) => {
  const { msAdsCall } = await import('~/lib/microsoft-ads.server')
  const r = await msAdsCall<never>(service, path, body, { retryThrottle: true })
  return { data: r.data, partial: r.partial }
}

const defaultDownload = async (url: string): Promise<Uint8Array> => {
  const res = await fetch(url)
  if (!res.ok) throw new MsAdsReportError('bad_response', `Microsoft report download failed (${res.status}).`)
  return new Uint8Array(await res.arrayBuffer())
}

const defaultAccessToken = async (): Promise<string> => {
  const { getMsAdsAccessToken } = await import('~/lib/microsoft-ads-token.server')
  return getMsAdsAccessToken()
}

// Built here rather than borrowed from ad-export/service.server.ts on purpose:
// that module reaches ad-compose.server.ts and its ?inline font imports, which
// the esbuild server bundle (scripts/build-vercel.mjs) cannot load. The cron
// routes import this adapter through the registry, so the chain must stay
// free of Vite-only assets.
const defaultPushDeps = async (): Promise<MsPushDeps> => {
  const [{ getAdsMediaDailyCapCents, getAdsSpendEnabled }, core, { msAdsCall }] = await Promise.all([
    import('~/lib/ad-settings.server'),
    import('~/lib/microsoft-ads-core'),
    import('~/lib/microsoft-ads.server'),
  ])
  return {
    spendEnabled: getAdsSpendEnabled,
    missingConfig: () => core.missingConfig(),
    env: () => core.msAdsEnv(),
    accountId: () => core.msAdsConfig().accountId,
    dailyCapCents: getAdsMediaDailyCapCents,
    call: async (service, path, body) => {
      const r = await msAdsCall<never>(service, path, body)
      return { data: r.data, partial: r.partial }
    },
  }
}

/** Map a failed token exchange to the error codes token-health.server.ts reads. */
export function msHealthError(e: unknown): string {
  const name = e instanceof Error ? e.name : ''
  const message = e instanceof Error ? e.message : String(e)
  if (name === 'MsAdsNotConnectedError') return /invalid_grant/.test(message) ? 'token_rejected' : 'not_connected'
  if (name === 'MsAdsTokenError') return /invalid_grant/.test(message) ? 'token_rejected' : 'api_error'
  if (e instanceof TypeError) return 'network' // fetch throws TypeError when the host is unreachable
  return 'unknown'
}

/**
 * Microsoft's code for "Authentication failed. Either supplied credentials are
 * invalid or the account is inactive." With a token exchange that just
 * succeeded, the inactive account is what it means: account 188472831 answers
 * every Campaign Management and Reporting call this way while it is Pending in
 * the Adult Advertising Program (first seen in production 2026-10-20).
 */
export const MS_INACTIVE_ACCOUNT_CODE = 105

/**
 * The ChannelNotReadyError for an error from the REST client, or null when the
 * error is anything else. Matches a 401 whose fault list carries code 105, and
 * falls back to the "105:" text describeErrors writes into the message for a
 * client that lost the structured list.
 */
export function msNotReadyError(e: unknown, accountId: string): ChannelNotReadyError | null {
  if (!(e instanceof Error) || e.name !== 'MsAdsApiError') return null
  const err = e as Error & { status?: unknown; errors?: unknown }
  if (err.status !== 401) return null
  const items = Array.isArray(err.errors) ? (err.errors as MsAdsErrorItem[]) : []
  const coded = items.some(i => i?.code === MS_INACTIVE_ACCOUNT_CODE)
  const inText = items.length === 0 && new RegExp(`\\b${MS_INACTIVE_ACCOUNT_CODE}: `).test(err.message)
  if (!coded && !inText) return null
  return new ChannelNotReadyError(
    'microsoft',
    'account_inactive',
    `Microsoft Ads account ${accountId || '(unset)'} is not active yet, so Microsoft refuses every Campaign Management `
    + 'and Reporting call with 105. It is Pending in the Adult Advertising Program; this clears on its own once Microsoft accepts it.',
  )
}

function partialFail(what: string, partial: MsAdsErrorItem[]): void {
  if (partial.length) {
    throw new MsAdsReportError('bad_response', `Microsoft ${what} had errors: ${partial.map(p => p.message || p.code).join('; ')}`)
  }
}

export function createMicrosoftAdapter(deps: MicrosoftAdapterDeps = {}): ChannelAdapter {
  const call = deps.call ?? defaultCall
  const download = deps.download ?? defaultDownload
  const accessToken = deps.accessToken ?? defaultAccessToken
  const missing = deps.missingConfig ?? (() => missingConfig())
  const now = deps.now ?? (() => new Date())
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const pollIntervalMs = deps.pollIntervalMs ?? 5_000
  const maxPolls = deps.maxPolls ?? 24
  const lastNotReady = deps.lastNotReady ?? defaultLastNotReady

  const accountId = (): string => {
    const id = (deps.accountId ?? (() => msAdsConfig().accountId))()
    if (!id) throw new MsAdsReportError('bad_response', 'Microsoft Ads account id is not set for the active MSADS_ENV.')
    return id
  }

  async function runReport(level: ReadLevel, range: DateRange): Promise<string | null> {
    const submit = await call<{ ReportRequestId?: unknown }>('Reporting', 'GenerateReport/Submit', buildReportRequest(level, accountId(), range))
    partialFail('report submit', submit.partial)
    const requestId = str(submit.data?.ReportRequestId)
    if (!requestId) throw new MsAdsReportError('bad_response', 'Microsoft report submit returned no request id.')

    for (let i = 0; i < maxPolls; i++) {
      const poll = await call<{ ReportRequestStatus?: { Status?: unknown; ReportDownloadUrl?: unknown } }>(
        'Reporting', 'GenerateReport/Poll', { ReportRequestId: requestId },
      )
      const status = str(poll.data?.ReportRequestStatus?.Status)
      if (status === 'Success') {
        // A report with no rows comes back Success with a null download URL.
        const url = str(poll.data?.ReportRequestStatus?.ReportDownloadUrl)
        return url ? csvFromReportZip(await download(url)) : null
      }
      if (status === 'Error') throw new MsAdsReportError('report_failed', `Microsoft report ${requestId} failed.`)
      await sleep(pollIntervalMs)
    }
    throw new MsAdsReportError('report_timeout', `Microsoft report ${requestId} was still pending after ${maxPolls} polls.`)
  }

  return {
    id: 'microsoft',
    capabilities: { read: true, insights: true, mutate: [], audiences: 'none', preview: false },

    auth: {
      /**
       * Valid when a token exchange succeeds now (or one did within the hour,
       * which the token module caches). Microsoft does not report when a
       * refresh token expires; it rolls forward on every use, so the expiry is
       * reported as unknown rather than guessed.
       */
      async health(): Promise<TokenHealth> {
        const checkedAt = now().toISOString()
        const unset = missing()
        if (unset.length) return { valid: false, expiresAt: null, expiryUnknown: true, scopes: [], checkedAt, error: 'not_configured' }
        try {
          await accessToken()
        } catch (e) {
          return { valid: false, expiresAt: null, expiryUnknown: true, scopes: [], checkedAt, error: msHealthError(e) }
        }
        const valid: TokenHealth = { valid: true, expiresAt: null, expiryUnknown: true, scopes: ['msads.manage'], checkedAt }
        // The token is good. Whether the account behind it answers is only
        // known from the last sync or pull, which stores the reason; a later
        // clean pass clears it, so this flips back without anyone touching it.
        const reason = await lastNotReady()
        return reason ? { ...valid, ready: false, notReadyReason: reason } : valid
      },
    },

    // Microsoft objects carry no modified time on these reads, so `since` is
    // ignored and every pass is a full pass. The account is a handful of rows.
    async syncEntities() {
      try {
        return await listEntities()
      } catch (e) {
        throw msNotReadyError(e, safeAccountId()) ?? e
      }
    },

    async pullInsights(range: DateRange, level: EntityLevel) {
      if (level === 'creative') throw new MsAdsReportError('bad_response', 'Microsoft insights are not reported at creative level.')
      try {
        const csv = await runReport(level, range)
        return csv ? parseMsReportCsv(level, csv) : []
      } catch (e) {
        throw msNotReadyError(e, safeAccountId()) ?? e
      }
    },

    /**
     * Takes the exporter's MsSearchPayload, or { payload, existing } to resume
     * a partial push. The push checks ads_spend_enabled, MSADS_* config and the
     * program guard before it sends anything, and creates every object Paused.
     */
    async createPaused(input: unknown): Promise<CreatedRefs> {
      const wrapped = input && typeof input === 'object' && 'payload' in input
        ? (input as { payload: unknown; existing?: MsPushPartial })
        : { payload: input, existing: {} }
      if (!looksLikeMsPayload(wrapped.payload)) throw new MsPushError('not_exportable', 'Not a Microsoft Search payload. Nothing was sent.')
      const { pushMicrosoftSearch } = await import('~/lib/ad-export/microsoft-push.server')
      const res = await pushMicrosoftSearch(wrapped.payload, wrapped.existing ?? {}, await (deps.pushDeps ?? defaultPushDeps)())
      return { campaignId: res.campaignId, adSetId: res.adGroupId, adId: res.adId }
    },

    async mutate(m) {
      throw new ChannelNotEnabledError('microsoft', `mutate:${m.verb}`)
    },

    async policyCheck(ctx) {
      return microsoftPolicyCheck(ctx)
    },
  }

  function safeAccountId(): string {
    try {
      return accountId()
    } catch {
      return ''
    }
  }

  async function listEntities(): Promise<NormalizedEntity[]> {
    const account = accountId()
    const camp = await call<{ Campaigns?: Json[] | null }>('CampaignManagement', 'Campaigns/QueryByAccountId', {
      AccountId: account, CampaignType: 'Search',
    })
    partialFail('campaign list', camp.partial)
    const campaigns = camp.data?.Campaigns ?? []
    const out: NormalizedEntity[] = campaigns.map(c => normalizeMsEntity('campaign', account, c, null))

    for (const c of campaigns) {
      const campaignId = String(c['Id'])
      const groups = await call<{ AdGroups?: Json[] | null }>('CampaignManagement', 'AdGroups/QueryByCampaignId', { CampaignId: campaignId })
      partialFail('ad group list', groups.partial)
      for (const g of groups.data?.AdGroups ?? []) {
        out.push(normalizeMsEntity('adset', account, g, campaignId))
        const adGroupId = String(g['Id'])
        const ads = await call<{ Ads?: Json[] | null }>('CampaignManagement', 'Ads/QueryByAdGroupId', {
          AdGroupId: adGroupId, AdTypes: ['ResponsiveSearch', 'ExpandedText', 'DynamicSearch'],
        })
        partialFail('ad list', ads.partial)
        for (const a of ads.data?.Ads ?? []) out.push(normalizeMsEntity('ad', account, a, adGroupId))
      }
    }
    return out
  }
}

export const microsoftAdapter: ChannelAdapter = createMicrosoftAdapter()
