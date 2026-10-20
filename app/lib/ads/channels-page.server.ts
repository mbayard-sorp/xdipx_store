/**
 * /admin/ads/channels, the database half (ticket #16438, plan sections 6 and
 * 7 phase 7a).
 *
 *   loadChannels()         one row per channel in the registry, with its
 *                          token health, freshness and checklist
 *   toggleChecklistItem()  checks or unchecks one checklist item
 *
 * No platform call happens here. Token health comes from ad_channel_health,
 * the last entity sync from ad_platform_entities.last_synced_at, the last
 * insights pull from ad_platform_insights_daily.pulled_at, and the checklist
 * from ad_channel_checklist (migration 135).
 *
 * toggleChecklistItem is called only from the route's admin session action.
 * No team-token route, cron or agent calls it.
 */
import { max } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { adChannelChecklist, adPlatformEntities, adPlatformInsightsDaily } from '../../../db/schema'
import { getChannel, listChannels, type ChannelListing } from './channels/registry.server'
import { readChannelHealth, type ChannelHealthRow } from './token-health.server'
import {
  EVIDENCE_MAX, checklistFor, isChecklistItem, mutateStateFor, pendingLabel,
  type ChannelPageRow, type ChannelsPage, type ChecklistRow,
} from './channels-core'

export * from './channels-core'

/** Every read loadChannels makes, so a test can hand in rows without a database. */
export interface ChannelsSource {
  channels(): ChannelListing[]
  health(): Promise<ChannelHealthRow[]>
  /** Latest last_synced_at per platform. */
  lastEntitySync(): Promise<Array<{ platform: string; at: Date | null }>>
  /** Latest pulled_at per platform. */
  lastInsightsPull(): Promise<Array<{ platform: string; at: Date | null }>>
  checklist(): Promise<ChecklistRow[]>
}

function asDate(v: unknown): Date | null {
  if (v == null) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d
}

export const dbChannelsSource: ChannelsSource = {
  channels: listChannels,
  health: readChannelHealth,

  async lastEntitySync() {
    const rows = await db
      .select({ platform: adPlatformEntities.platform, at: max(adPlatformEntities.lastSyncedAt) })
      .from(adPlatformEntities)
      .groupBy(adPlatformEntities.platform)
    return rows.map(r => ({ platform: r.platform, at: asDate(r.at) }))
  },

  async lastInsightsPull() {
    const rows = await db
      .select({ platform: adPlatformInsightsDaily.platform, at: max(adPlatformInsightsDaily.pulledAt) })
      .from(adPlatformInsightsDaily)
      .groupBy(adPlatformInsightsDaily.platform)
    return rows.map(r => ({ platform: r.platform, at: asDate(r.at) }))
  },

  async checklist() {
    const rows = await db.select().from(adChannelChecklist)
    return rows.map(r => ({
      channel: r.channel,
      item: r.item,
      checkedAt: r.checkedAt?.toISOString() ?? null,
      checkedBy: r.checkedBy,
      evidence: r.evidence,
    }))
  },
}

async function attempt<T>(name: string, failed: string[], read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch (err) {
    console.error(`[ads-channels] ${name} read failed`, err)
    failed.push(name)
    return null
  }
}

/**
 * The channels page. Each read fails on its own: a failed read leaves its
 * column null and its name in `failed`. A failed checklist read leaves every
 * channel blocked: an item counts as checked only from a stored row.
 */
export async function loadChannels(source: ChannelsSource = dbChannelsSource): Promise<ChannelsPage> {
  const failed: string[] = []
  const listings = source.channels()
  const [health, syncs, pulls, checklist] = await Promise.all([
    attempt('token health', failed, () => source.health()),
    attempt('entity sync', failed, () => source.lastEntitySync()),
    attempt('insights pull', failed, () => source.lastInsightsPull()),
    attempt('checklist', failed, () => source.checklist()),
  ])

  const healthBy = new Map((health ?? []).map(h => [h.channel as string, h]))
  const syncBy = new Map((syncs ?? []).map(s => [s.platform, s.at]))
  const pullBy = new Map((pulls ?? []).map(p => [p.platform, p.at]))

  const channels: ChannelPageRow[] = listings.map(l => {
    const h = healthBy.get(l.id)
    const items = checklistFor(l.id, l.policyState, checklist ?? [])
    const pending = h ? pendingLabel(l.id, h.error) : null
    return {
      id: l.id,
      label: l.label,
      policyState: l.policyState,
      policyNote: l.policyNote,
      hasAdapter: l.hasAdapter,
      capabilities: l.capabilities,
      token: h
        ? { state: h.state, checkedAt: h.checkedAt, expiresAt: h.expiresAt, error: h.error, ...(pending ? { pending } : {}) }
        : null,
      lastEntitySyncAt: syncBy.get(l.id)?.toISOString() ?? null,
      lastInsightsPullAt: pullBy.get(l.id)?.toISOString() ?? null,
      checklist: items,
      mutate: mutateStateFor({ policyState: l.policyState, hasAdapter: l.hasAdapter, capabilities: l.capabilities, checklist: items }),
    }
  })
  return { channels, failed }
}

export class ChecklistInputError extends Error {}

export interface ChecklistWrite {
  channel: string
  item: string
  checkedAt: Date | null
  checkedBy: string
  evidence: string | null
}

export interface ToggleDeps {
  write?: (row: ChecklistWrite) => Promise<void>
  now?: () => Date
}

async function defaultWrite(row: ChecklistWrite): Promise<void> {
  await db
    .insert(adChannelChecklist)
    .values(row)
    .onConflictDoUpdate({
      target: [adChannelChecklist.channel, adChannelChecklist.item],
      set: { checkedAt: row.checkedAt, checkedBy: row.checkedBy, evidence: row.evidence },
    })
}

/**
 * Check or uncheck one item. Refuses a channel the registry does not list, a
 * prohibited channel, an unknown item, and a check with no evidence. `by` is
 * the admin who did it, e.g. "admin:mike@xdipx.com". Unchecking keeps the
 * evidence text so the history of why it was checked is not lost.
 */
export async function toggleChecklistItem(
  channel: string,
  item: string,
  checked: boolean,
  by: string,
  evidence: string | null,
  deps: ToggleDeps = {},
): Promise<ChecklistWrite> {
  const entry = getChannel(channel)
  if (!entry) throw new ChecklistInputError(`Unknown channel: ${channel}`)
  if (entry.policyState === 'prohibited') {
    throw new ChecklistInputError(`${entry.label} is prohibited by policy and has no checklist.`)
  }
  if (!isChecklistItem(item)) throw new ChecklistInputError(`Unknown checklist item: ${item}`)
  const who = by.trim()
  if (!who) throw new ChecklistInputError('Missing who made the change.')
  const text = (evidence ?? '').trim().slice(0, EVIDENCE_MAX)
  if (checked && !text) throw new ChecklistInputError('Write down the evidence before checking this item.')

  const now = (deps.now ?? (() => new Date()))()
  const row: ChecklistWrite = {
    channel: entry.id,
    item,
    checkedAt: checked ? now : null,
    checkedBy: who,
    evidence: text || null,
  }
  await (deps.write ?? defaultWrite)(row)
  return row
}

