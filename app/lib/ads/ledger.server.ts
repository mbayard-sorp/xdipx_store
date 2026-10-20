/**
 * Ads Control Plane mutation ledger, database half (migration 130, ticket
 * #16427, plan sections 3.3, 5 and 9.4). Every change the control plane
 * wants to make on an ad platform is a row in ad_actions before anything
 * calls the platform. This module only writes and reads the ledger; it
 * never talks to a platform. Applying an approved row is the job of
 * channels/apply.server.ts in a later phase.
 */
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { adActions } from '../../../db/schema'
import {
  IllegalAdActionTransitionError,
  assertLegalTransition,
  type AdActionStatus,
  type AdActionTier,
  type AdActionVerb,
} from './ledger-core'
import type { EntityLevel } from './channels/types'

export type AdActionRow = typeof adActions.$inferSelect

export interface NewAdAction {
  idempotencyKey: string
  platform: string
  targetLevel: EntityLevel
  targetExternalId: string
  verb: AdActionVerb
  params?: Record<string, unknown> | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  /** rule:R5, agent:paid-media-buyer, or owner. */
  proposedBy: string
  reason?: string | null
  ruleEventId?: number | null
  tier: AdActionTier
  /** proposed (default) or dry_run. Anything later is a transition, not an insert. */
  status?: Extract<AdActionStatus, 'proposed' | 'dry_run'>
  expiresAt?: Date | null
}

export interface InsertActionResult {
  /** false when a row with this idempotency key already existed. */
  inserted: boolean
  row: AdActionRow | null
}

/**
 * INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING. A rule that
 * fires twice for the same change on the same day gets inserted: false the
 * second time, and the ledger keeps one row.
 */
export async function insertAction(input: NewAdAction): Promise<InsertActionResult> {
  const status = input.status ?? 'proposed'
  if (status !== 'proposed' && status !== 'dry_run') {
    throw new Error(`insertAction writes proposed or dry_run only, got ${String(status)}`)
  }
  const rows = await db
    .insert(adActions)
    .values({
      idempotencyKey: input.idempotencyKey,
      platform: input.platform,
      targetLevel: input.targetLevel,
      targetExternalId: input.targetExternalId,
      verb: input.verb,
      params: input.params ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      proposedBy: input.proposedBy,
      reason: input.reason ?? null,
      ruleEventId: input.ruleEventId ?? null,
      tier: input.tier,
      status,
      expiresAt: input.expiresAt ?? null,
    })
    .onConflictDoNothing({ target: adActions.idempotencyKey })
    .returning()
  const row = rows[0] ?? null
  return { inserted: row !== null, row }
}

export interface TransitionExtra {
  after?: Record<string, unknown> | null
  platformResponse?: unknown
  error?: string | null
  reason?: string | null
}

/**
 * Moves one row to `to` when the move is legal (see LEGAL_TRANSITIONS) and
 * throws IllegalAdActionTransitionError otherwise, including when the row
 * is missing or another writer moved it first. The UPDATE is conditioned on
 * the status we read, so two racing writers cannot both win.
 * approved and rejected stamp approved_by and approved_at; applied stamps
 * applied_at.
 */
export async function transitionAction(
  id: number,
  to: AdActionStatus,
  actor: string,
  extra: TransitionExtra = {},
): Promise<AdActionRow> {
  const [current] = await db
    .select({ status: adActions.status })
    .from(adActions)
    .where(eq(adActions.id, id))
    .limit(1)
  if (!current) throw new IllegalAdActionTransitionError(id, null, to)
  assertLegalTransition(id, current.status, to)

  const now = new Date()
  const patch: Partial<typeof adActions.$inferInsert> = { status: to }
  // A rejection records its decider in the same columns, so the console can
  // say who said no and when.
  if (to === 'approved' || to === 'rejected') {
    patch.approvedBy = actor
    patch.approvedAt = now
  }
  if (to === 'applied') patch.appliedAt = now
  if (extra.after !== undefined) patch.after = extra.after
  if (extra.platformResponse !== undefined) patch.platformResponse = extra.platformResponse
  if (extra.error !== undefined) patch.error = extra.error
  if (extra.reason !== undefined) patch.reason = extra.reason

  const [row] = await db
    .update(adActions)
    .set(patch)
    .where(and(eq(adActions.id, id), eq(adActions.status, current.status)))
    .returning()
  if (!row) {
    // Another writer moved the row between our read and our write.
    throw new IllegalAdActionTransitionError(id, current.status, to)
  }
  return row
}

export interface ListActionsOptions {
  status?: AdActionStatus
  /** Default 50, at most 500. */
  limit?: number
}

/** Newest first, optionally filtered to one status. */
export async function listActions(opts: ListActionsOptions = {}): Promise<AdActionRow[]> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 500)
  const where = opts.status ? eq(adActions.status, opts.status) : undefined
  return db
    .select()
    .from(adActions)
    .where(where)
    .orderBy(desc(adActions.createdAt), desc(adActions.id))
    .limit(limit)
}

/**
 * Automatic actions since `since` that got past the gate: tier auto rows that
 * were approved, applied or failed. dry_run rows do not count, since nothing
 * was attempted. Feeds the ads_auto_actions_max_per_day cap.
 */
export async function countAutoActionsSince(since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(adActions)
    .where(and(
      eq(adActions.tier, 'auto'),
      inArray(adActions.status, ['approved', 'applied', 'failed']),
      gte(adActions.createdAt, since),
    ))
  return Number(row?.n ?? 0)
}
