/**
 * The audited write path for `pipeline_settings`.
 *
 * Every valve in this system lives in that table: team kill switches, daily
 * spend caps, run caps, auto-approve flags, and the release engine's own
 * enable flag. The table itself is three columns with no actor, so before
 * migration 072 a flip left no trace — on 2026-07-18 four auto-approve valves
 * changed within 31 seconds and nobody could prove who did it or why, while
 * the governance docs went on describing the old posture for nine more days.
 *
 * Writes therefore go through `setPipelineSettingAudited`, which records the
 * previous value, the new value, an actor, and the code path that made the
 * change. This file is in PROTECTED_GLOBS: it is the choke point for the
 * store's entire safety boundary, so a change to it needs an owner's eyes,
 * never an agent's self-merge.
 *
 * The audit insert is best-effort by design. A valve flip is an operational
 * act — often a kill switch during an incident — and it must not fail because
 * a logging table is unavailable. A missing audit row is recoverable; a
 * kill switch that would not turn off is not.
 */

import { desc, eq, gte } from 'drizzle-orm'
import { db } from './db.server'
import { pipelineSettings, settingsAuditLog } from '../../db/schema'
import { invalidateTeamSettingsCache } from './team.server'

/** Who made the change. Same vocabulary the ticket bus uses for actors. */
export type SettingsActor = 'owner' | 'system' | 'migration' | `agent:${string}`

export interface AuditedSettingWrite {
  key: string
  /** Previous value, or null when this key had never been set. */
  oldValue: string | null
  newValue: string
  /** True when the value was already what was asked for (no-op write). */
  unchanged: boolean
}

/**
 * Upsert a pipeline setting, record who changed it, and bust the 60s team
 * settings cache so kill-switch flips land immediately rather than up to a
 * minute later.
 *
 * `source` should name the call site (e.g. 'admin.homepage-team',
 * 'release-engine:circuit-breaker') so an unexpected flip can be traced back
 * to a route instead of guessed at.
 */
export async function setPipelineSettingAudited(
  key: string,
  value: string,
  actor: SettingsActor,
  source: string,
): Promise<AuditedSettingWrite> {
  const [existing] = await db
    .select({ value: pipelineSettings.value })
    .from(pipelineSettings)
    .where(eq(pipelineSettings.key, key))
    .limit(1)

  const oldValue = existing?.value ?? null

  await db
    .insert(pipelineSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: pipelineSettings.key,
      set: { value, updatedAt: new Date() },
    })

  // Best-effort: never let the audit trail block the valve write itself.
  try {
    await db.insert(settingsAuditLog).values({
      key,
      oldValue,
      newValue: value,
      actor,
      source: source.slice(0, 64),
    })
  } catch (err) {
    console.error('[settings] audit insert failed', { key, actor, source, err })
  }

  await invalidateTeamSettingsCache()

  return { key, oldValue, newValue: value, unchanged: oldValue === value }
}

export interface SettingsAuditEntry {
  key: string
  oldValue: string | null
  newValue: string
  actor: string
  source: string
  changedAt: Date
}

/**
 * Recent valve changes, newest first. Used by the owner digest so a flip the
 * owner did not make is visible the next morning rather than discovered weeks
 * later by an audit.
 */
export async function recentSettingChanges(sinceHours = 24, limit = 20): Promise<SettingsAuditEntry[]> {
  const since = new Date(Date.now() - sinceHours * 3600_000)
  return db
    .select({
      key: settingsAuditLog.key,
      oldValue: settingsAuditLog.oldValue,
      newValue: settingsAuditLog.newValue,
      actor: settingsAuditLog.actor,
      source: settingsAuditLog.source,
      changedAt: settingsAuditLog.changedAt,
    })
    .from(settingsAuditLog)
    .where(gte(settingsAuditLog.changedAt, since))
    .orderBy(desc(settingsAuditLog.changedAt))
    .limit(limit)
}
