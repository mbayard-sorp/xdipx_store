/**
 * Ads token health (plan §3.4 and §8, ticket #16406).
 *
 * Once a day /cron/ads-token-health asks every registered channel that has an
 * adapter for its token health (Meta: Graph debug_token). Three outcomes:
 *
 * - ok: valid, and neither expiry is inside TOKEN_EXPIRY_WARNING_DAYS.
 * - expiring or invalid: files one owner blocker per channel. The dedupe key
 *   is per channel, so a repeat day refreshes the same row instead of stacking
 *   a second one, and the row carries the `ad_token_healthy` probe, which runs
 *   this same check again and clears the row once the owner rotates the token.
 * - unknown: the platform could not be asked (network, throttling, a 5xx, a
 *   body we could not read). Files nothing, per the blocker probe rule in
 *   #4702.
 *
 * The latest reading per channel lands in ad_channel_health (migration 131)
 * so the phase 3 console can show token state without calling the platform.
 */
import { sql } from 'drizzle-orm'
import { adChannelHealth, type AdChannelHealthState } from '../../../db/schema'
import type { BlockerInput, ProbeVerdict } from '~/lib/owner-blockers-core'
import { notReadyHealthError } from './channels/errors'
import { getChannel, listChannels } from './channels/registry.server'
import type { ChannelAdapter, ChannelId, ChannelNotReadyReason, TokenHealth } from './channels/types'

export const TOKEN_EXPIRY_WARNING_DAYS = 14

const DAY_MS = 86_400_000

/**
 * Adapter error codes that mean the platform was not reached or did not give
 * a usable answer. Anything else on an invalid reading (Meta's own message
 * from debug_token, `token_rejected`, `not_configured`) is the token itself.
 * `api_error` is here because without Meta's code 190 it is as likely a 5xx
 * or a malformed request as a dead token; the adapter promotes the real
 * refusals to `token_rejected`.
 */
const COULD_NOT_ASK = new Set(['network', 'rate_limited', 'bad_response', 'api_error', 'unknown'])

export type TokenHealthState = AdChannelHealthState

export interface TokenAssessment {
  state: TokenHealthState
  /** Which expiry is closest, when one is set. */
  expiryKind: 'token' | 'data_access' | null
  /** The closest expiry, ISO. */
  nearestExpiry: string | null
  /** Whole days until nearestExpiry, floored. Negative once past. */
  daysLeft: number | null
}

/** Pure: turn one adapter reading into the verdict the cron acts on. */
export function assessTokenHealth(
  h: TokenHealth,
  now: Date,
  warnDays: number = TOKEN_EXPIRY_WARNING_DAYS,
): TokenAssessment {
  const candidates: Array<{ kind: 'token' | 'data_access'; at: number; iso: string }> = []
  for (const [kind, iso] of [['token', h.expiresAt], ['data_access', h.dataAccessExpiresAt ?? null]] as const) {
    const at = iso ? Date.parse(iso) : NaN
    if (iso && Number.isFinite(at)) candidates.push({ kind, at, iso })
  }
  candidates.sort((a, b) => a.at - b.at)
  const nearest = candidates[0] ?? null
  const daysLeft = nearest ? Math.floor((nearest.at - now.getTime()) / DAY_MS) : null
  const base = { expiryKind: nearest?.kind ?? null, nearestExpiry: nearest?.iso ?? null, daysLeft }

  if (!h.valid) {
    const couldNotAsk = !h.error || COULD_NOT_ASK.has(h.error)
    return { ...base, state: couldNotAsk ? 'unknown' : 'invalid' }
  }
  if (nearest && nearest.at - now.getTime() < warnDays * DAY_MS) return { ...base, state: 'expiring' }
  return { ...base, state: 'ok' }
}

/**
 * The env var that holds each channel's token, named the way the owner will
 * look for it in Vercel. Meta reads META_ADS_ACCESS_TOKEN first and falls back
 * to META_ACCESS_TOKEN (metaCredentialsFromEnv), so this names whichever one
 * is actually in use.
 */
export function tokenEnvVar(channel: ChannelId | string, env: NodeJS.ProcessEnv = process.env): string {
  const set = (k: string) => Boolean(env[k]?.trim())
  if (channel === 'meta') {
    if (set('META_ADS_ACCESS_TOKEN')) return 'META_ADS_ACCESS_TOKEN'
    if (set('META_ACCESS_TOKEN')) return 'META_ACCESS_TOKEN'
    return 'META_ADS_ACCESS_TOKEN (or META_ACCESS_TOKEN)'
  }
  // Microsoft keeps its refresh token in microsoft_ads_tokens, not in an env var.
  if (channel === 'microsoft') return 'the Microsoft Ads connection (/api/microsoft-ads-connect)'
  return `the ${channel} token env var`
}

const WHERE_TO_GO: Partial<Record<string, string>> = {
  meta:
    'Meta Business Settings > Users > System users: generate a new token for the ads system user '
    + 'with ads_read and ads_management on ad account 920738511029316, then set it in Vercel and redeploy.',
  microsoft:
    'Open /api/microsoft-ads-connect while signed in as the owner and approve the Microsoft consent screen. '
    + 'If the blocker says not set, add the MSADS_* variables for the active MSADS_ENV in Vercel first.',
}

export function tokenBlockerDedupeKey(channel: ChannelId | string): string {
  return `ads-token-health-${channel}`
}

function day(iso: string): string {
  return iso.slice(0, 10)
}

/** The blocker for one channel's reading, or null when nothing should be filed. */
export function tokenBlockerInput(
  ch: { id: ChannelId; label: string },
  health: TokenHealth,
  a: TokenAssessment,
  envVar: string,
): BlockerInput | null {
  if (a.state !== 'expiring' && a.state !== 'invalid') return null

  const expiryLine = a.nearestExpiry
    ? `${a.expiryKind === 'data_access' ? 'Data access expires' : 'Token expires'} ${a.nearestExpiry}`
      + ` (${a.daysLeft !== null && a.daysLeft >= 0 ? `${a.daysLeft} days left` : 'already past'}).`
    : 'No expiry reported.'

  let title: string
  if (a.state === 'invalid' && health.error === 'not_configured') {
    title = `${ch.label} ads token is not set: add ${envVar}`
  } else if (a.state === 'invalid') {
    title = `${ch.label} ads token is invalid: rotate ${envVar}`
  } else {
    const what = a.expiryKind === 'data_access' ? 'data access' : 'token'
    title = `${ch.label} ads ${what} expires ${day(a.nearestExpiry ?? '')}: rotate ${envVar}`
  }

  const detail = [
    a.state === 'invalid'
      ? `The platform says the token is not valid${health.error ? ` (${health.error})` : ''}.`
      : `The token is valid today but runs out inside ${TOKEN_EXPIRY_WARNING_DAYS} days.`,
    expiryLine,
    `Env: ${envVar}.`,
    `Scopes reported: ${health.scopes.length > 0 ? health.scopes.join(', ') : 'none'}.`,
    `Checked ${health.checkedAt} by /cron/ads-token-health. A timeout or a 5xx files nothing; `
    + 'only an answer about the token itself does.',
  ].join('\n\n')

  return {
    dedupeKey: tokenBlockerDedupeKey(ch.id),
    title,
    detail,
    unblocks:
      'The ads control plane: entity sync, insights pulls, and every rule that reads them. '
      + 'Live campaigns keep spending while the console is blind.',
    whereToGo: WHERE_TO_GO[ch.id] ?? `${ch.label} business settings: issue a new token, set ${envVar} in Vercel, redeploy.`,
    category: 'credential',
    priority: a.state === 'invalid' ? 1 : 2,
    source: 'sweep',
    sourceRef: 'cron:ads-token-health',
    verifyProbe: 'ad_token_healthy',
    verifyArg: ch.id,
  }
}

export interface HealthChannel {
  id: ChannelId
  label: string
  adapter: ChannelAdapter
}

/** Every registered channel that has an adapter. */
export function channelsWithAdapters(): HealthChannel[] {
  const out: HealthChannel[] = []
  for (const listing of listChannels()) {
    const entry = getChannel(listing.id)
    if (entry?.adapter) out.push({ id: entry.id, label: entry.label, adapter: entry.adapter })
  }
  return out
}

export interface ChannelHealthRow {
  channel: ChannelId
  checkedAt: string
  state: TokenHealthState
  valid: boolean
  expiresAt: string | null
  dataAccessExpiresAt: string | null
  scopes: string[]
  error: string | null
  envVar: string
}

type FileBlockerFn = (input: BlockerInput) => Promise<{ id: number; created: boolean; reopened: boolean }>

export interface AdsTokenHealthDeps {
  channels?: () => HealthChannel[]
  fileBlocker?: FileBlockerFn
  saveHealth?: (row: ChannelHealthRow) => Promise<void>
  now?: () => Date
  env?: NodeJS.ProcessEnv
}

export interface ChannelHealthResult extends ChannelHealthRow {
  daysLeft: number | null
  blocker: { id: number; created: boolean; reopened: boolean } | null
  blockerError?: string
  saved: boolean
}

export interface AdsTokenHealthResult {
  checked: number
  /** True when a channel needed a blocker and filing it failed. The route answers 500. */
  failed: boolean
  channels: ChannelHealthResult[]
}

async function defaultFileBlocker(input: BlockerInput) {
  const { fileBlocker } = await import('~/lib/owner-blockers.server')
  return fileBlocker(input)
}

async function defaultSaveHealth(row: ChannelHealthRow): Promise<void> {
  const { db } = await import('~/lib/db.server')
  const values = {
    channel: row.channel,
    checkedAt: new Date(row.checkedAt),
    state: row.state,
    valid: row.valid,
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
    dataAccessExpiresAt: row.dataAccessExpiresAt ? new Date(row.dataAccessExpiresAt) : null,
    scopes: row.scopes,
    error: row.error,
    envVar: row.envVar,
  }
  const { channel: _channel, ...update } = values
  await db.insert(adChannelHealth).values(values).onConflictDoUpdate({ target: adChannelHealth.channel, set: update })
}

async function safeHealth(adapter: ChannelAdapter, now: Date): Promise<TokenHealth> {
  try {
    return await adapter.auth.health()
  } catch (err) {
    // The contract says health() never throws. If one does, it did not get an
    // answer, so it reads as could-not-ask rather than as a dead token.
    console.warn(`[ads-token-health] ${adapter.id} health() threw (treated as unknown):`, String(err).slice(0, 200))
    return { valid: false, expiresAt: null, scopes: [], checkedAt: now.toISOString(), error: 'unknown' }
  }
}

/**
 * The stored row for one reading. A not-ready reason rides in `error` as
 * `not_ready:<reason>` (no schema change) and never changes `state`: a
 * pending account has a good token, so it files no token blocker.
 */
function healthRow(
  channel: ChannelId,
  health: TokenHealth,
  a: TokenAssessment,
  envVar: string,
  notReady: ChannelNotReadyReason | null,
): ChannelHealthRow {
  return {
    channel,
    checkedAt: health.checkedAt,
    state: a.state,
    valid: health.valid,
    expiresAt: health.expiresAt,
    dataAccessExpiresAt: health.dataAccessExpiresAt ?? null,
    scopes: health.scopes,
    error: health.error ?? (notReady ? notReadyHealthError(notReady) : null),
    envVar,
  }
}

/**
 * Called by the entity sync and the insights pull when a channel's readiness
 * changed: `reason` set when the platform said the account cannot be used yet
 * (ChannelNotReadyError), null when a clean pass followed a stored reason. It
 * upserts the channel's ad_channel_health row from the reading the cron just
 * took, so the Channels page and the next health() call see it.
 */
export async function recordChannelReadiness(
  channel: ChannelId,
  health: TokenHealth,
  reason: ChannelNotReadyReason | null,
  deps: { saveHealth?: (row: ChannelHealthRow) => Promise<void>; now?: () => Date; env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  const now = (deps.now ?? (() => new Date()))()
  const row = healthRow(channel, health, assessTokenHealth(health, now), tokenEnvVar(channel, deps.env ?? process.env), reason)
  await (deps.saveHealth ?? defaultSaveHealth)(row)
}

/** The slice of a health reading the sync and insights cron reports carry. */
export function summarizeTokenHealth(
  health: TokenHealth,
): Pick<TokenHealth, 'valid' | 'expiresAt' | 'error' | 'ready' | 'notReadyReason'> {
  return {
    valid: health.valid,
    expiresAt: health.expiresAt,
    ...(health.error !== undefined ? { error: health.error } : {}),
    ...(health.ready !== undefined ? { ready: health.ready } : {}),
    ...(health.notReadyReason !== undefined ? { notReadyReason: health.notReadyReason } : {}),
  }
}

export type RecordReadinessFn =(channel: ChannelId, health: TokenHealth, reason: ChannelNotReadyReason | null) => Promise<void>

/**
 * The cron side of readiness: store a new not-ready reason, or clear a stored
 * one after a clean pass. Writes only on a change, so Meta, which never sets
 * `ready`, never writes here. A failed write is logged and ignored; it must
 * not turn a skip or a good pull into a failure.
 */
export async function noteChannelReadiness(
  record: RecordReadinessFn | undefined,
  channel: ChannelId,
  health: TokenHealth,
  reason: ChannelNotReadyReason | null,
): Promise<void> {
  const stored = health.ready === false ? health.notReadyReason ?? null : null
  if (reason === stored) return
  try {
    await (record ?? recordChannelReadiness)(channel, health, reason)
  } catch (err) {
    console.warn(`[ads] could not store ${channel} readiness (ignored):`, String(err).slice(0, 200))
  }
}

/** The daily pass. Never throws for one channel's sake. */
export async function runAdsTokenHealth(deps: AdsTokenHealthDeps = {}): Promise<AdsTokenHealthResult> {
  const channels = (deps.channels ?? channelsWithAdapters)()
  const file = deps.fileBlocker ?? defaultFileBlocker
  const save = deps.saveHealth ?? defaultSaveHealth
  const now = deps.now ?? (() => new Date())
  const env = deps.env ?? process.env

  const results: ChannelHealthResult[] = []
  let failed = false
  for (const ch of channels) {
    const health = await safeHealth(ch.adapter, now())
    const a = assessTokenHealth(health, now())
    const envVar = tokenEnvVar(ch.id, env)
    const row = healthRow(ch.id, health, a, envVar, health.ready === false ? health.notReadyReason ?? null : null)

    let saved = false
    try {
      await save(row)
      saved = true
    } catch (err) {
      console.warn(`[ads-token-health] could not store ${ch.id} health (ignored):`, String(err).slice(0, 200))
    }

    let blocker: ChannelHealthResult['blocker'] = null
    let blockerError: string | undefined
    const input = tokenBlockerInput(ch, health, a, envVar)
    if (input) {
      try {
        const r = await file(input)
        blocker = { id: r.id, created: r.created, reopened: r.reopened }
      } catch (err) {
        failed = true
        blockerError = String(err).slice(0, 300)
        console.error(`[ads-token-health] could not file the ${ch.id} token blocker:`, err)
      }
    }

    results.push({ ...row, daysLeft: a.daysLeft, blocker, saved, ...(blockerError ? { blockerError } : {}) })
  }
  return { checked: results.length, failed, channels: results }
}

/**
 * The `ad_token_healthy` probe. True once the channel's token reads ok, false
 * while it is still expiring or invalid, null when the platform could not be
 * asked or the channel has no adapter.
 */
export async function probeChannelToken(
  channelId: string,
  deps: { now?: () => Date } = {},
): Promise<ProbeVerdict> {
  const entry = getChannel(channelId.trim())
  if (!entry?.adapter) return null
  const now = (deps.now ?? (() => new Date()))()
  const a = assessTokenHealth(await safeHealth(entry.adapter, now), now)
  if (a.state === 'ok') return true
  if (a.state === 'unknown') return null
  return false
}

/** Latest stored reading per channel, for the console. No platform call. */
export async function readChannelHealth(): Promise<ChannelHealthRow[]> {
  const { db } = await import('~/lib/db.server')
  const rows = await db.select().from(adChannelHealth).orderBy(sql`${adChannelHealth.channel}`)
  return rows.map(r => ({
    channel: r.channel as ChannelId,
    checkedAt: r.checkedAt.toISOString(),
    state: r.state,
    valid: r.valid,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    dataAccessExpiresAt: r.dataAccessExpiresAt?.toISOString() ?? null,
    scopes: Array.isArray(r.scopes) ? r.scopes : [],
    error: r.error,
    envVar: r.envVar ?? '',
  }))
}
