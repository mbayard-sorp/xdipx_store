/**
 * Ads signal snapshots, the pure half (ticket #16686, plan §9.2 and §12).
 *
 * Client-safe: no server imports. The team endpoint, the hourly cron step
 * and the console pages all share these kinds, parsers and verdicts, so the
 * tests can pin them without a database.
 *
 * A snapshot is one reading of one kind on one channel, stored whole in
 * ad_health_snapshots.payload (migration 136). Who writes which kind:
 *
 * - pixel, errors, opportunity, anomaly: the daily ads routine, from the Meta
 *   Ads MCP, through POST /api/team/ad-health-snapshot. Source 'routine'.
 * - account, activity: the hourly /cron/ads-insights run, from the Graph API.
 *   Source 'graph'.
 * - breakdown: the Sunday 09:00 UTC restatement run, one row per dimension.
 *   Source 'graph'. The routine may record one too.
 *
 * Payload readers are lenient on purpose. The routine copies MCP output, and
 * the MCP's field names drift, so every reader accepts the common spellings
 * and returns null for what it cannot find. A null renders as "not reported",
 * never as zero.
 */
import { ageWords } from './console-core'

// ---------------------------------------------------------------------------
// Kinds and the record contract
// ---------------------------------------------------------------------------

export const SNAPSHOT_KINDS = ['pixel', 'errors', 'activity', 'opportunity', 'anomaly', 'breakdown', 'account'] as const
export type SnapshotKind = (typeof SNAPSHOT_KINDS)[number]

export function isSnapshotKind(v: unknown): v is SnapshotKind {
  return typeof v === 'string' && (SNAPSHOT_KINDS as readonly string[]).includes(v)
}

/** Past this the reading is old enough to say so on the page. */
export const SNAPSHOT_STALE_MS: Record<SnapshotKind, number> = {
  pixel: 36 * 3_600_000,
  errors: 36 * 3_600_000,
  opportunity: 36 * 3_600_000,
  anomaly: 36 * 3_600_000,
  activity: 3 * 3_600_000,
  account: 3 * 3_600_000,
  breakdown: 8 * 86_400_000,
}

export const MAX_PAYLOAD_BYTES = 200_000
/** A reading stamped further ahead than this is a clock or input error. */
const FUTURE_SLACK_MS = 10 * 60_000
const CHANNEL_RE = /^[a-z0-9][a-z0-9:_-]{0,39}$/
const SOURCE_RE = /^[a-z0-9][a-z0-9:_.-]{0,39}$/

export interface SnapshotRecordInput {
  channel: string
  kind: SnapshotKind
  observedAt: Date
  payload: Record<string, unknown>
  source: string
}

/** One stored snapshot as the endpoint and the pages hand it around. */
export interface SnapshotRow {
  id: number
  channel: string
  kind: SnapshotKind
  observedAt: string
  payload: Record<string, unknown>
  source: string
  createdAt: string
}

export class SnapshotValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SnapshotValidationError'
  }
}

/** Validates a `{ op: 'record' }` body. Throws SnapshotValidationError with a sentence the caller can read. */
export function parseRecordInput(b: Record<string, unknown>, now: Date = new Date()): SnapshotRecordInput {
  const channel = b['channel']
  if (typeof channel !== 'string' || !CHANNEL_RE.test(channel)) {
    throw new SnapshotValidationError('channel must be a lowercase channel id such as "meta".')
  }
  const kind = b['kind']
  if (!isSnapshotKind(kind)) throw new SnapshotValidationError(`kind must be one of ${SNAPSHOT_KINDS.join(', ')}.`)
  const rawAt = b['observedAt']
  if (typeof rawAt !== 'string' || !rawAt) throw new SnapshotValidationError('observedAt must be an ISO timestamp.')
  const observedAt = new Date(rawAt)
  if (Number.isNaN(observedAt.getTime())) throw new SnapshotValidationError('observedAt must be an ISO timestamp.')
  if (observedAt.getTime() > now.getTime() + FUTURE_SLACK_MS) {
    throw new SnapshotValidationError('observedAt is in the future.')
  }
  const payload = b['payload']
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new SnapshotValidationError('payload must be a JSON object.')
  }
  const size = JSON.stringify(payload).length
  if (size > MAX_PAYLOAD_BYTES) throw new SnapshotValidationError(`payload is ${size} bytes; the limit is ${MAX_PAYLOAD_BYTES}.`)
  const rawSource = b['source']
  if (rawSource != null && (typeof rawSource !== 'string' || !SOURCE_RE.test(rawSource))) {
    throw new SnapshotValidationError('source must be a short lowercase label such as "routine" or "mcp".')
  }
  return { channel, kind, observedAt, payload: payload as Record<string, unknown>, source: (rawSource as string | undefined) ?? 'routine' }
}

/** Validates a `{ op: 'latest' }` body. channel is optional; null means every channel. */
export function parseLatestInput(b: Record<string, unknown>): { channel: string | null } {
  const channel = b['channel']
  if (channel == null || channel === '') return { channel: null }
  if (typeof channel !== 'string' || !CHANNEL_RE.test(channel)) {
    throw new SnapshotValidationError('channel must be a lowercase channel id such as "meta".')
  }
  return { channel }
}

/** The newest row per (channel, kind), plus the newest breakdown row per dimension. */
export function latestPerKind(rows: SnapshotRow[]): SnapshotRow[] {
  const best = new Map<string, SnapshotRow>()
  for (const r of rows) {
    const k = `${r.channel}|${r.kind}`
    const cur = best.get(k)
    if (!cur || Date.parse(r.observedAt) > Date.parse(cur.observedAt)) best.set(k, r)
  }
  return [...best.values()].sort((a, b) => a.channel.localeCompare(b.channel) || a.kind.localeCompare(b.kind))
}

export function latestPerDimension(rows: SnapshotRow[]): SnapshotRow[] {
  const best = new Map<string, SnapshotRow>()
  for (const r of rows) {
    if (r.kind !== 'breakdown') continue
    const dim = str(r.payload['dimension']) ?? 'unknown'
    const k = `${r.channel}|${dim}`
    const cur = best.get(k)
    if (!cur || Date.parse(r.observedAt) > Date.parse(cur.observedAt)) best.set(k, r)
  }
  const order = (d: string) => {
    const i = (BREAKDOWN_DIMENSION_KEYS as readonly string[]).indexOf(d)
    return i === -1 ? 99 : i
  }
  return [...best.values()].sort((a, b) =>
    order(str(a.payload['dimension']) ?? '') - order(str(b.payload['dimension']) ?? ''))
}

export interface SnapshotAge { observedAt: string; age: string; stale: boolean }

export function snapshotAge(row: Pick<SnapshotRow, 'observedAt' | 'kind'>, now: Date): SnapshotAge {
  const ms = Math.max(0, now.getTime() - Date.parse(row.observedAt))
  return { observedAt: row.observedAt, age: `${ageWords(ms)} ago`, stale: ms > SNAPSHOT_STALE_MS[row.kind] }
}

// ---------------------------------------------------------------------------
// Lenient field helpers
// ---------------------------------------------------------------------------

function str(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]
  return undefined
}

function objects(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)) : []
}

function listOf(payload: Record<string, unknown>, keys: string[]): Record<string, unknown>[] {
  for (const k of keys) {
    const v = payload[k]
    if (Array.isArray(v)) return objects(v)
  }
  return []
}

// ---------------------------------------------------------------------------
// pixel
// ---------------------------------------------------------------------------

/**
 * Recommended payload, as the routine should record it:
 *   { datasetId, events: [{ event: 'Lead', emq: 4.2, count24h: 1, count7d: 3 }],
 *     leadEvents24h?: number, leadEvents7d?: number }
 * EMQ is Meta's 0 to 10 event match quality score.
 */
export interface PixelEvent { event: string; emq: number | null; count24h: number | null; count7d: number | null }
export interface PixelReading { datasetId: string | null; events: PixelEvent[]; leadEvents24h: number | null; leadEvents7d: number | null }

export function readPixel(payload: Record<string, unknown>): PixelReading {
  const events: PixelEvent[] = listOf(payload, ['events', 'event_stats', 'data']).map(e => ({
    event: str(pick(e, ['event', 'event_name', 'name'])) ?? 'unknown',
    emq: num(pick(e, ['emq', 'event_match_quality', 'match_quality', 'emq_score', 'score'])),
    count24h: num(pick(e, ['count24h', 'count_24h', 'last_24h', 'events_24h'])),
    count7d: num(pick(e, ['count7d', 'count_7d', 'last_7d', 'events_7d', 'count'])),
  }))
  const emqMap = payload['emq']
  if (events.length === 0 && emqMap && typeof emqMap === 'object' && !Array.isArray(emqMap)) {
    for (const [event, v] of Object.entries(emqMap as Record<string, unknown>)) {
      events.push({ event, emq: num(v), count24h: null, count7d: null })
    }
  }
  const lead = events.find(e => e.event.toLowerCase() === 'lead')
  return {
    datasetId: str(pick(payload, ['datasetId', 'dataset_id', 'pixelId', 'pixel_id'])),
    events,
    leadEvents24h: num(pick(payload, ['leadEvents24h', 'lead_events_24h'])) ?? lead?.count24h ?? null,
    leadEvents7d: num(pick(payload, ['leadEvents7d', 'lead_events_7d'])) ?? lead?.count7d ?? null,
  }
}

// ---------------------------------------------------------------------------
// account
// ---------------------------------------------------------------------------

/** Graph v23 AdAccount.account_status codes. */
export const ACCOUNT_STATUS_NAMES: Record<number, string> = {
  1: 'ACTIVE', 2: 'DISABLED', 3: 'UNSETTLED', 7: 'PENDING_RISK_REVIEW', 8: 'PENDING_SETTLEMENT',
  9: 'IN_GRACE_PERIOD', 100: 'PENDING_CLOSURE', 101: 'CLOSED', 201: 'ANY_ACTIVE', 202: 'ANY_CLOSED',
}

/** Graph v23 AdAccount.disable_reason codes. */
export const DISABLE_REASON_NAMES: Record<number, string> = {
  0: 'NONE', 1: 'ADS_INTEGRITY_POLICY', 2: 'ADS_IP_REVIEW', 3: 'RISK_PAYMENT', 4: 'GRAY_ACCOUNT_SHUT_DOWN',
  5: 'ADS_AFC_REVIEW', 6: 'BUSINESS_INTEGRITY_RAR', 7: 'PERMANENT_CLOSE', 8: 'UNUSED_RESELLER_ACCOUNT',
  9: 'UNUSED_ACCOUNT', 10: 'UMBRELLA_AD_ACCOUNT', 11: 'BUSINESS_MANAGER_INTEGRITY_POLICY',
  12: 'MISREPRESENTED_AD_ACCOUNT', 13: 'AOAB_DESHARE_LEGAL_ENTITY', 14: 'CTX_THREAD_REVIEW', 15: 'COMPROMISED_AD_ACCOUNT',
}

const STATUS_WORDS: Record<number, string> = {
  2: 'Meta disabled the ad account. Nothing can deliver.',
  3: 'The ad account has an unsettled balance: a payment failed. Delivery stops until it is paid.',
  7: 'Meta is reviewing the ad account for risk. Delivery may stop.',
  8: 'The ad account is waiting on a payment to settle.',
  9: 'The ad account is in a payment grace period. Fix the payment method before it lapses.',
  100: 'The ad account is pending closure.',
  101: 'The ad account is closed.',
}

/** Recorded payload: { accountId, name, accountStatus, disableReason, currency, amountSpentCents, spendCapCents, balanceCents }. */
export interface AccountReading {
  accountId: string | null
  name: string | null
  accountStatus: number | null
  statusName: string
  disableReason: number | null
  disableReasonName: string | null
  currency: string | null
  amountSpentCents: number | null
  spendCapCents: number | null
  balanceCents: number | null
}

export function readAccount(payload: Record<string, unknown>): AccountReading {
  const status = num(pick(payload, ['accountStatus', 'account_status']))
  const reason = num(pick(payload, ['disableReason', 'disable_reason']))
  return {
    accountId: str(pick(payload, ['accountId', 'account_id', 'id'])),
    name: str(payload['name']),
    accountStatus: status,
    statusName: status == null ? 'UNKNOWN' : ACCOUNT_STATUS_NAMES[status] ?? `STATUS_${status}`,
    disableReason: reason,
    disableReasonName: reason == null ? null : DISABLE_REASON_NAMES[reason] ?? `REASON_${reason}`,
    currency: str(payload['currency']),
    amountSpentCents: num(pick(payload, ['amountSpentCents', 'amount_spent_cents'])),
    spendCapCents: num(pick(payload, ['spendCapCents', 'spend_cap_cents'])),
    balanceCents: num(pick(payload, ['balanceCents', 'balance_cents'])),
  }
}

export interface AccountProblem { title: string; sentence: string }

/**
 * Null when the account reads ACTIVE (1 or 201). Anything else is a page:
 * plan §9.8 pages on a payment failure or a restriction, and every other
 * status stops delivery or is about to.
 */
export function accountProblem(a: AccountReading): AccountProblem | null {
  if (a.accountStatus == null || a.accountStatus === 1 || a.accountStatus === 201) return null
  const reason = a.disableReason && a.disableReason !== 0 ? ` Disable reason: ${a.disableReasonName}.` : ''
  return {
    title: `Meta ad account is ${a.statusName}${a.disableReason ? ` (${a.disableReasonName})` : ''}`,
    sentence: `${STATUS_WORDS[a.accountStatus] ?? `Meta reports account_status ${a.accountStatus}.`}${reason}`,
  }
}

// ---------------------------------------------------------------------------
// activity
// ---------------------------------------------------------------------------

/** One AdActivity row (Graph v23) plus our verdict on it. */
export interface ActivityItem {
  eventTime: string | null
  eventType: string | null
  translatedEventType: string | null
  actorId: string | null
  actorName: string | null
  applicationName: string | null
  objectId: string | null
  objectName: string | null
  objectType: string | null
  extraData: string | null
  outOfBand: boolean
  /** Why it is or is not out of band, in a few words. */
  why: string
}

export interface LedgerApplied { externalId: string; appliedAt: string; id: number }

/** A ledger row this close to an activity on the same object is the change that caused it. */
export const LEDGER_MATCH_MS = 30 * 60_000

/** Normalizes raw AdActivity rows from Graph or the MCP. Verdicts default to unknown until flagActivities runs. */
export function readActivityRows(rows: unknown): Omit<ActivityItem, 'outOfBand' | 'why'>[] {
  return objects(rows).map(r => ({
    eventTime: str(pick(r, ['event_time', 'eventTime'])),
    eventType: str(pick(r, ['event_type', 'eventType'])),
    translatedEventType: str(pick(r, ['translated_event_type', 'translatedEventType'])),
    actorId: str(pick(r, ['actor_id', 'actorId'])),
    actorName: str(pick(r, ['actor_name', 'actorName'])),
    applicationName: str(pick(r, ['application_name', 'applicationName'])),
    objectId: str(pick(r, ['object_id', 'objectId'])),
    objectName: str(pick(r, ['object_name', 'objectName'])),
    objectType: str(pick(r, ['object_type', 'objectType'])),
    extraData: str(pick(r, ['extra_data', 'extraData'])),
  }))
}

/**
 * A change is ours when our system user made it or an applied ledger row on
 * the same object sits within LEDGER_MATCH_MS of it. Everything else is out
 * of band: the owner clicking in Ads Manager, Shopify's Advantage+ app, Meta's
 * own automated changes.
 */
export function flagActivities(
  items: Omit<ActivityItem, 'outOfBand' | 'why'>[],
  ours: { systemUserIds: string[]; ledger: LedgerApplied[] },
): ActivityItem[] {
  const users = new Set(ours.systemUserIds.filter(Boolean))
  return items.map(it => {
    if (it.actorId && users.has(it.actorId)) return { ...it, outOfBand: false, why: 'our system user' }
    const t = it.eventTime ? Date.parse(it.eventTime) : NaN
    const match = it.objectId && Number.isFinite(t)
      ? ours.ledger.find(l => l.externalId === it.objectId && Math.abs(Date.parse(l.appliedAt) - t) <= LEDGER_MATCH_MS)
      : undefined
    if (match) return { ...it, outOfBand: false, why: `ledger row ${match.id}` }
    const who = it.applicationName ? `${it.actorName ?? 'someone'} via ${it.applicationName}` : it.actorName ?? 'an unknown actor'
    return { ...it, outOfBand: true, why: `made by ${who}, not the control plane` }
  })
}

/** Recorded payload: { windowHours, since, until, systemUser: { id, name }, items: ActivityItem[], outOfBandCount }. */
export interface ActivityReading { windowHours: number | null; items: ActivityItem[]; outOfBandCount: number; systemUserName: string | null }

export function readActivity(payload: Record<string, unknown>): ActivityReading {
  const raw = listOf(payload, ['items', 'activities', 'data'])
  const base = readActivityRows(raw)
  const items: ActivityItem[] = raw.map((r, i) => {
    const flagged = typeof r['outOfBand'] === 'boolean' ? (r['outOfBand'] as boolean) : null
    return { ...base[i]!, outOfBand: flagged ?? false, why: str(r['why']) ?? (flagged == null ? 'not judged' : '') }
  })
  const su = payload['systemUser']
  return {
    windowHours: num(payload['windowHours']),
    items,
    outOfBandCount: items.filter(i => i.outOfBand).length,
    systemUserName: su && typeof su === 'object' ? str((su as Record<string, unknown>)['name']) : null,
  }
}

// ---------------------------------------------------------------------------
// errors, opportunity, anomaly
// ---------------------------------------------------------------------------

/** Recommended payload: { items: [{ level, id, name, severity, message }] } from ads_get_errors. */
export interface ErrorItem { level: string | null; id: string | null; name: string | null; severity: string | null; message: string }

export function readErrors(payload: Record<string, unknown>): ErrorItem[] {
  return listOf(payload, ['items', 'errors', 'data']).map(e => ({
    level: str(pick(e, ['level', 'object_type', 'entity_type'])),
    id: str(pick(e, ['id', 'object_id', 'entity_id', 'ad_id'])),
    name: str(pick(e, ['name', 'object_name', 'entity_name'])),
    severity: str(pick(e, ['severity', 'level_of_severity', 'type'])),
    message: str(pick(e, ['message', 'error_message', 'description', 'summary', 'title'])) ?? 'No message given.',
  }))
}

/** Recommended payload: { score: 0..100, recommendations: [{ title, detail, impact }] } from ads_get_opportunity_score. */
export interface OpportunityReading { score: number | null; recommendations: Array<{ title: string; detail: string | null; impact: string | null }> }

export function readOpportunity(payload: Record<string, unknown>): OpportunityReading {
  return {
    score: num(pick(payload, ['score', 'opportunity_score', 'opportunityScore'])),
    recommendations: listOf(payload, ['recommendations', 'items', 'data']).map(r => ({
      title: str(pick(r, ['title', 'name', 'type', 'recommendation_type'])) ?? 'Recommendation',
      detail: str(pick(r, ['detail', 'description', 'message', 'body'])),
      impact: str(pick(r, ['impact', 'score_lift', 'points', 'estimated_impact'])),
    })),
  }
}

/** Recommended payload: { items: [{ metric, direction, severity, message, object }] } from ads_insights_anomaly_signal. */
export interface AnomalyItem { metric: string | null; direction: string | null; severity: string | null; message: string; object: string | null }

export function readAnomalies(payload: Record<string, unknown>): AnomalyItem[] {
  return listOf(payload, ['items', 'anomalies', 'signals', 'data']).map(a => ({
    metric: str(pick(a, ['metric', 'metric_name', 'kpi'])),
    direction: str(pick(a, ['direction', 'trend', 'change_direction'])),
    severity: str(pick(a, ['severity', 'level'])),
    message: str(pick(a, ['message', 'description', 'summary', 'title'])) ?? 'No description given.',
    object: str(pick(a, ['object', 'object_name', 'entity_name', 'campaign_name', 'id'])),
  }))
}

// ---------------------------------------------------------------------------
// breakdown
// ---------------------------------------------------------------------------

/** Plan §9.2's weekly breakdowns. Hour is diagnostic only there, so it is not pulled. */
export const BREAKDOWN_DIMENSIONS = {
  placement: ['publisher_platform', 'platform_position'],
  age: ['age'],
  gender: ['gender'],
} as const
export type BreakdownDimension = keyof typeof BREAKDOWN_DIMENSIONS
export const BREAKDOWN_DIMENSION_KEYS = Object.keys(BREAKDOWN_DIMENSIONS) as BreakdownDimension[]

export const BREAKDOWN_LABELS: Record<BreakdownDimension, string> = {
  placement: 'Placement',
  age: 'Age',
  gender: 'Gender',
}

/** One ad set on one slice. Recorded payload: { dimension, breakdowns, since, until, rows: BreakdownRow[] }. */
export interface BreakdownRow {
  adsetId: string | null
  adsetName: string | null
  slice: string
  spendCents: number
  impressions: number
  linkClicks: number
  leads: number
}

export interface BreakdownReading { dimension: string; since: string | null; until: string | null; rows: BreakdownRow[] }

export function readBreakdown(payload: Record<string, unknown>): BreakdownReading {
  return {
    dimension: str(payload['dimension']) ?? 'unknown',
    since: str(payload['since']),
    until: str(payload['until']),
    rows: listOf(payload, ['rows', 'data']).map(r => ({
      adsetId: str(pick(r, ['adsetId', 'adset_id'])),
      adsetName: str(pick(r, ['adsetName', 'adset_name'])),
      slice: str(pick(r, ['slice', 'label'])) ?? 'unknown',
      spendCents: Math.round(num(pick(r, ['spendCents', 'spend_cents'])) ?? 0),
      impressions: Math.round(num(r['impressions']) ?? 0),
      linkClicks: Math.round(num(pick(r, ['linkClicks', 'link_clicks', 'inline_link_clicks'])) ?? 0),
      leads: Math.round(num(r['leads']) ?? 0),
    })),
  }
}

/** Plan §9.2: act on a slice only past all three. */
export const SLICE_MIN_SHARE = 0.25
export const SLICE_MIN_LEADS = 10
export const SLICE_CPL_MULTIPLE = 2

export interface SliceSummary {
  slice: string
  spendCents: number
  impressions: number
  leads: number
  cplCents: number | null
  /** Share of the dimension's spend, 0 to 1. */
  share: number
  restLeads: number
  restCplCents: number | null
  meetsFloor: boolean
  /** Which floor it missed, or what it cleared. */
  floorNote: string
}

/**
 * Sums a dimension's rows per slice across ad sets and marks the slices that
 * clear the §9.2 action floor: at least 25% of spend, at least 10 leads on
 * the slice and on the rest, and a CPL at least 2x the rest's. Sorted by
 * spend, biggest first.
 */
export function summarizeBreakdown(rows: BreakdownRow[]): { totalSpendCents: number; totalLeads: number; slices: SliceSummary[] } {
  const by = new Map<string, { spendCents: number; impressions: number; leads: number }>()
  for (const r of rows) {
    const acc = by.get(r.slice) ?? { spendCents: 0, impressions: 0, leads: 0 }
    acc.spendCents += r.spendCents
    acc.impressions += r.impressions
    acc.leads += r.leads
    by.set(r.slice, acc)
  }
  let totalSpendCents = 0, totalLeads = 0
  for (const v of by.values()) { totalSpendCents += v.spendCents; totalLeads += v.leads }

  const slices: SliceSummary[] = [...by.entries()].map(([slice, v]) => {
    const share = totalSpendCents > 0 ? v.spendCents / totalSpendCents : 0
    const restSpend = totalSpendCents - v.spendCents
    const restLeads = totalLeads - v.leads
    const cplCents = v.leads > 0 ? Math.round(v.spendCents / v.leads) : null
    const restCplCents = restLeads > 0 ? Math.round(restSpend / restLeads) : null
    const floor = sliceFloor({ share, leads: v.leads, restLeads, cplCents, restCplCents })
    return { slice, ...v, cplCents, share, restLeads, restCplCents, ...floor }
  })
  slices.sort((a, b) => b.spendCents - a.spendCents || a.slice.localeCompare(b.slice))
  return { totalSpendCents, totalLeads, slices }
}

export function sliceFloor(s: { share: number; leads: number; restLeads: number; cplCents: number | null; restCplCents: number | null }): { meetsFloor: boolean; floorNote: string } {
  if (s.share < SLICE_MIN_SHARE) return { meetsFloor: false, floorNote: `under ${Math.round(SLICE_MIN_SHARE * 100)}% of spend` }
  if (s.leads < SLICE_MIN_LEADS) return { meetsFloor: false, floorNote: `under ${SLICE_MIN_LEADS} leads` }
  if (s.restLeads < SLICE_MIN_LEADS) return { meetsFloor: false, floorNote: `the rest has under ${SLICE_MIN_LEADS} leads` }
  if (s.cplCents == null || s.restCplCents == null || s.cplCents < s.restCplCents * SLICE_CPL_MULTIPLE) {
    return { meetsFloor: false, floorNote: `CPL under ${SLICE_CPL_MULTIPLE}x the rest` }
  }
  return { meetsFloor: true, floorNote: `CPL ${(s.cplCents / s.restCplCents).toFixed(1)}x the rest on enough volume` }
}

// ---------------------------------------------------------------------------
// The Signal health card
// ---------------------------------------------------------------------------

/** EMQ below this is red (Meta's own "good" band starts around 6). */
export const EMQ_FLOOR = 6
/** Meta's Lead count and ours may differ by this share before the card goes red. */
export const LEAD_GAP_MAX = 0.2

export interface LeadCompare {
  window: '24h' | '7d'
  meta: number | null
  ours: number
  /** |meta - ours| / max(meta, ours). Null when Meta's count is unknown or both are zero. */
  gap: number | null
}

export type SignalState = 'red' | 'amber' | 'ok' | 'empty'

export interface SignalHealth {
  state: SignalState
  /** Plain sentences behind a red or amber state. */
  reasons: string[]
  events: PixelEvent[]
  leads: LeadCompare[]
  /** Meta's attributed leads from the insights mirror, for context. Null when the read failed. */
  attributedLeads7d: number | null
  snapshot: SnapshotAge | null
  source: string | null
}

export function leadGap(meta: number | null, ours: number): number | null {
  if (meta == null) return null
  const top = Math.max(meta, ours)
  return top > 0 ? Math.abs(meta - ours) / top : null
}

export function assembleSignalHealth(input: {
  pixel: SnapshotRow | null
  ourLeads24h: number | null
  ourLeads7d: number | null
  attributedLeads7d: number | null
  now: Date
}): SignalHealth {
  if (!input.pixel) {
    return {
      state: 'empty', reasons: [], events: [], leads: [],
      attributedLeads7d: input.attributedLeads7d, snapshot: null, source: null,
    }
  }
  const p = readPixel(input.pixel.payload)
  const snapshot = snapshotAge(input.pixel, input.now)
  const leads: LeadCompare[] = []
  if (input.ourLeads24h != null) leads.push({ window: '24h', meta: p.leadEvents24h, ours: input.ourLeads24h, gap: leadGap(p.leadEvents24h, input.ourLeads24h) })
  if (input.ourLeads7d != null) leads.push({ window: '7d', meta: p.leadEvents7d, ours: input.ourLeads7d, gap: leadGap(p.leadEvents7d, input.ourLeads7d) })

  const red: string[] = []
  for (const l of leads) {
    if (l.gap != null && l.gap > LEAD_GAP_MAX) {
      red.push(`Meta saw ${l.meta} Lead events in ${l.window}; our database stored ${l.ours} leads (${Math.round(l.gap * 100)}% apart).`)
    }
  }
  for (const e of p.events) {
    if (e.emq != null && e.emq < EMQ_FLOOR) red.push(`${e.event} match quality is ${e.emq.toFixed(1)}, under ${EMQ_FLOOR}.`)
  }
  const amber: string[] = []
  if (snapshot.stale) amber.push(`The pixel reading is ${snapshot.age.replace(/ ago$/, '')} old.`)
  if (p.events.length === 0) amber.push('The pixel snapshot lists no events.')
  if (leads.length > 0 && leads.every(l => l.meta == null)) amber.push('The pixel snapshot has no Lead count to compare.')

  return {
    state: red.length > 0 ? 'red' : amber.length > 0 ? 'amber' : 'ok',
    reasons: [...red, ...amber],
    events: p.events,
    leads,
    attributedLeads7d: input.attributedLeads7d,
    snapshot,
    source: input.pixel.source,
  }
}
