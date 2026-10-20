/**
 * Database reads behind POST /api/team/ad-action (ticket #16433, phase 5c).
 * Inserts go through ledger.server.ts insertAction; this module only reads
 * the mirror and the ledger. It never talks to a platform and never reads or
 * writes pipeline_settings.
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { adActions, adPlatformEntities } from '../../../db/schema'
import type { MirrorTarget } from './ad-action-propose-core'
import type { AdActionRow } from './ledger.server'

/** The mirrored entity at (platform, externalId), when its level matches. */
export async function findMirrorTarget(platform: string, level: string, externalId: string): Promise<MirrorTarget | null> {
  const [row] = await db
    .select({
      platform: adPlatformEntities.platform,
      level: adPlatformEntities.level,
      externalId: adPlatformEntities.externalId,
      status: adPlatformEntities.status,
      effectiveStatus: adPlatformEntities.effectiveStatus,
      dailyBudgetCents: adPlatformEntities.dailyBudgetCents,
      lifetimeBudgetCents: adPlatformEntities.lifetimeBudgetCents,
      creativeId: adPlatformEntities.creativeId,
    })
    .from(adPlatformEntities)
    .where(and(
      eq(adPlatformEntities.platform, platform),
      eq(adPlatformEntities.externalId, externalId),
      eq(adPlatformEntities.level, level as MirrorTarget['level']),
    ))
    .limit(1)
  return row ?? null
}

/** The ledger row holding this idempotency key, if one exists. */
export async function findActionByKey(idempotencyKey: string): Promise<AdActionRow | null> {
  const [row] = await db
    .select()
    .from(adActions)
    .where(eq(adActions.idempotencyKey, idempotencyKey))
    .limit(1)
  return row ?? null
}

/** Rows this proposer created since `since`, whatever their status now. */
export async function countProposedSince(proposedBy: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(adActions)
    .where(and(eq(adActions.proposedBy, proposedBy), gte(adActions.createdAt, since)))
  return Number(row?.n ?? 0)
}

/** This proposer's rows since `since`, newest first, at most 200. */
export async function listProposedSince(proposedBy: string, since: Date): Promise<AdActionRow[]> {
  return db
    .select()
    .from(adActions)
    .where(and(eq(adActions.proposedBy, proposedBy), gte(adActions.createdAt, since)))
    .orderBy(desc(adActions.createdAt), desc(adActions.id))
    .limit(200)
}
