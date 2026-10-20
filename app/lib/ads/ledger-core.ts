/**
 * Ads Control Plane mutation ledger, pure half (migration 130, ticket
 * #16427, plan sections 3.3, 5 and 9.4). No database here, so the key
 * builder and the status machine test without one. The writes live in
 * ledger.server.ts.
 *
 * node:crypto keeps this module server-side in practice; nothing on the
 * client needs it.
 */
import { createHash } from 'node:crypto'
import type { AdActionStatus, AdActionTier, AdActionVerb } from '../../../db/schema'

export type { AdActionStatus, AdActionTier, AdActionVerb }

export const AD_ACTION_VERBS: readonly AdActionVerb[] = [
  'pause', 'resume', 'set_budget', 'update_creative', 'halt_all', 'create_paused', 'audience_sync',
]
export const AD_ACTION_TIERS: readonly AdActionTier[] = ['auto', 'approve', 'owner']
export const AD_ACTION_STATUSES: readonly AdActionStatus[] = [
  'proposed', 'dry_run', 'approved', 'applied', 'failed', 'rejected', 'expired',
]

/**
 * Every legal status move. dry_run is written as dry_run and never moves:
 * it is the shadow ledger the owner reads before flipping
 * ads_auto_apply_enabled. applied, failed, rejected and expired are final.
 */
export const LEGAL_TRANSITIONS: Readonly<Record<AdActionStatus, readonly AdActionStatus[]>> = {
  proposed: ['approved', 'rejected', 'expired'],
  dry_run: [],
  approved: ['applied', 'failed', 'expired'],
  applied: [],
  failed: [],
  rejected: [],
  expired: [],
}

export function isLegalTransition(from: AdActionStatus, to: AdActionStatus): boolean {
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false
}

export function isTerminalStatus(status: AdActionStatus): boolean {
  return LEGAL_TRANSITIONS[status].length === 0
}

export class IllegalAdActionTransitionError extends Error {
  readonly code = 'illegal_transition' as const
  constructor(
    readonly actionId: number,
    readonly from: AdActionStatus | null,
    readonly to: AdActionStatus,
  ) {
    super(
      from === null
        ? `ad_actions #${actionId} not found, cannot move it to ${to}`
        : `ad_actions #${actionId} cannot move from ${from} to ${to}`,
    )
    this.name = 'IllegalAdActionTransitionError'
  }
}

/** Throws IllegalAdActionTransitionError unless the move is in LEGAL_TRANSITIONS. */
export function assertLegalTransition(
  actionId: number,
  from: AdActionStatus,
  to: AdActionStatus,
): void {
  if (!isLegalTransition(from, to)) throw new IllegalAdActionTransitionError(actionId, from, to)
}

/**
 * JSON with object keys sorted at every depth, so two objects that differ
 * only in key order serialize the same. Arrays keep their order, because
 * order in an array is data. undefined values drop out, as in JSON.stringify.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value))
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const src = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(src).sort()) {
      if (src[k] !== undefined) out[k] = sortKeysDeep(src[k])
    }
    return out
  }
  return value
}

export interface IdempotencyKeyInput {
  platform: string
  level: string
  externalId: string
  verb: AdActionVerb
  /** YYYY-MM-DD. The same change on the same target on the same day is one row. */
  day: string
  params?: unknown
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * `<verb>:<48 hex chars>`: the verb, then the first 48 characters of the
 * sha256 of the canonical JSON of every input. Key order inside params does
 * not change the key; any change to a param value does.
 */
export function buildIdempotencyKey(input: IdempotencyKeyInput): string {
  if (!AD_ACTION_VERBS.includes(input.verb)) throw new Error(`unknown ad action verb: ${input.verb}`)
  if (!DAY_RE.test(input.day)) throw new Error(`day must be YYYY-MM-DD, got ${input.day}`)
  const canonical = canonicalJson({
    platform: input.platform,
    level: input.level,
    externalId: input.externalId,
    verb: input.verb,
    day: input.day,
    params: input.params ?? null,
  })
  const digest = createHash('sha256').update(canonical).digest('hex').slice(0, 48)
  return `${input.verb}:${digest}`
}
