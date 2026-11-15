/**
 * The ExoClick ledger path (ticket #19412). PROTECTED PATH: the owner merges
 * every change to this file.
 *
 * Every ExoClick change becomes an ad_actions row, the way channels/apply.server.ts
 * writes them for Meta, but gated on exoclick_operator_enabled and
 * exoclick_total_cap_cents instead of the shared ads_spend_enabled valve (which
 * also gates Meta). The shared daily action cap and the three-a-day automatic
 * pause cap do not apply here: R-EXO's brakes are the point, and the owner's own
 * cap on total spend is the limit that matters on this channel.
 *
 *   brake (pause, block_placement, a lowered budget): tier auto. Allowed
 *     whenever the operator switch is on.
 *   gas (resume, set_budget up, update_creative, create): tier approve, and
 *     allowed only when the switch is on AND projected total spend stays
 *     under the cap. The switch plus the cap is the owner's standing approval,
 *     so the row is approved by its proposer at once.
 *
 * With the switch off every action returns status not_enabled, writes a
 * dry_run row saying why, and sends nothing: mutate.server.ts is not called.
 * A refused gas action (cap not set, over the cap) is written the same way and
 * returns status dry_run.
 */
import { buildIdempotencyKey } from '../../ledger-core'
import type { AdActionRow, InsertActionResult, NewAdAction, TransitionExtra } from '../../ledger.server'
import type { AdActionStatus, AdActionTier } from '../../ledger-core'
import { ChannelNotEnabledError, MutationRefusedError } from '../errors'
import type { EntityRef, MutationVerb } from '../types'
import { exoclickMutate, variationPauseSupported, type ExoclickMutate } from './mutate.server'
import { EXOCLICK_CHANNEL } from './policy-core'

export interface ExoOperatorStore {
  findByKey(idempotencyKey: string): Promise<AdActionRow | null>
  insert(input: NewAdAction): Promise<InsertActionResult>
  transition(id: number, to: AdActionStatus, actor: string, extra?: TransitionExtra): Promise<AdActionRow>
}

export interface ExoOperatorDeps {
  store?: ExoOperatorStore
  mutate?: ExoclickMutate
}

export interface ExoActionRequest {
  verb: MutationVerb
  target: EntityRef
  params: Record<string, unknown> | null
  /** rule:exoclick-kill-rules, agent:r-exo, owner, or an admin email. */
  proposedBy: string
  reason?: string | null | undefined
  ruleEventId?: number | null | undefined
  now?: Date | undefined
}

export type ExoActionStatus = 'applied' | 'dry_run' | 'failed' | 'not_enabled' | 'skipped'

export interface ExoActionResult {
  status: ExoActionStatus
  tier: AdActionTier | null
  actionId: number | null
  applied: boolean
  error: boolean
  note: string
  target: EntityRef
}

const ledger = () => import('../../ledger.server')

const defaultStore: ExoOperatorStore = {
  async findByKey(key) {
    const [{ db }, { adActions }, { eq }] = await Promise.all([
      import('~/lib/db.server'), import('../../../../../db/schema'), import('drizzle-orm'),
    ])
    const [row] = await db.select().from(adActions).where(eq(adActions.idempotencyKey, key)).limit(1)
    return row && row.idempotencyKey === key ? row : null
  },
  insert: async input => (await ledger()).insertAction(input),
  transition: async (id, to, actor, extra) => (await ledger()).transitionAction(id, to, actor, extra),
}

function errorText(err: unknown): string {
  if (err instanceof ChannelNotEnabledError) return `not_enabled: ${err.message}`
  if (err instanceof MutationRefusedError) return `${err.code}: ${err.message}`
  const kind = err && typeof err === 'object' ? (err as { kind?: unknown }).kind : undefined
  if (err instanceof Error && typeof kind === 'string') return `${kind}: ${err.message}`
  return err instanceof Error ? err.message : String(err)
}

const dayOf = (now: Date) => now.toISOString().slice(0, 10)

function reasonOf(...parts: Array<string | null | undefined>): string | null {
  const text = parts.filter((p): p is string => !!p && p.trim().length > 0).join('. ')
  return text ? text.slice(0, 1000) : null
}

export async function dispatchExoclickAction(req: ExoActionRequest, deps: ExoOperatorDeps = {}): Promise<ExoActionResult> {
  const store = deps.store ?? defaultStore
  const mutate = deps.mutate ?? exoclickMutate()
  const now = req.now ?? new Date()
  const target = req.target
  const result = (r: Omit<ExoActionResult, 'target'>): ExoActionResult => ({ ...r, target })

  if (target.platform !== EXOCLICK_CHANNEL) {
    return result({ status: 'skipped', tier: null, actionId: null, applied: false, error: false, note: `Not an ExoClick target: ${target.platform}.` })
  }
  if (target.level === 'ad' && req.verb === 'pause' && !variationPauseSupported) {
    return result({
      status: 'skipped', tier: null, actionId: null, applied: false, error: false,
      note: 'No ledger row: ExoClick variation pause is not wired (the route could not be verified). Pause the campaign or block the sites.',
    })
  }

  // 1. The gate, with the live reads it needs. Off means no network call at all.
  const reading = await mutate.readGate(req.verb, target.externalId, req.params)
  const tier: AdActionTier = reading.kind === 'brake' ? 'auto' : 'approve'
  const before = reading.campaign ? { status: reading.campaign.status, dailyBudgetCents: reading.campaign.dailyBudgetCents } : null
  const after = req.verb === 'pause' ? { status: 'PAUSED' } : req.verb === 'resume' ? { status: 'ACTIVE' } : null

  // 2. The row. Same key shape as the shared ledger: one change on one target per day is one row.
  const idempotencyKey = buildIdempotencyKey({
    platform: target.platform, level: target.level, externalId: target.externalId,
    verb: req.verb as NewAdAction['verb'], day: dayOf(now), params: req.params,
  })

  if (!reading.gate.allowed) {
    const why = `Dry run: ${reading.gate.reason}`
    // A held row gets its own key, so turning the switch on later the same day is not blocked by it.
    const heldKey = buildIdempotencyKey({
      platform: target.platform, level: target.level, externalId: target.externalId,
      verb: req.verb as NewAdAction['verb'], day: dayOf(now), params: { ...(req.params ?? {}), _held: reading.gate.code },
    })
    const ins = await store.insert({
      idempotencyKey: heldKey, platform: target.platform, targetLevel: target.level, targetExternalId: target.externalId,
      verb: req.verb as NewAdAction['verb'], params: req.params, before, after, proposedBy: req.proposedBy,
      reason: reasonOf(why, req.reason), ruleEventId: req.ruleEventId ?? null, tier, status: 'dry_run',
    })
    const status: ExoActionStatus = reading.gate.code === 'not_enabled' ? 'not_enabled' : 'dry_run'
    return result({
      status, tier, actionId: ins.row?.id ?? null, applied: false, error: false,
      note: `${why}. Nothing was sent to ExoClick.`,
    })
  }

  const ins = await store.insert({
    idempotencyKey, platform: target.platform, targetLevel: target.level, targetExternalId: target.externalId,
    verb: req.verb as NewAdAction['verb'], params: req.params, before, after, proposedBy: req.proposedBy,
    reason: reasonOf(req.reason), ruleEventId: req.ruleEventId ?? null, tier, status: 'proposed',
  })

  let row = ins.row
  if (!ins.inserted || !row) {
    const existing = ins.row ?? (await store.findByKey(idempotencyKey))
    if (existing?.status === 'applied') {
      return result({ status: 'applied', tier, actionId: existing.id, applied: false, error: false, note: 'Replay: this key already applied today, so no second platform call.' })
    }
    if (existing?.status !== 'approved') {
      return result({
        status: (existing?.status as ExoActionStatus | undefined) === 'failed' ? 'failed' : 'dry_run',
        tier, actionId: existing?.id ?? null, applied: false, error: false,
        note: `Already in the ledger today as ${existing?.status ?? 'unknown'}: no second row, no platform call.`,
      })
    }
    row = existing // approved and never sent: a crash between approve and apply. Send it now.
  } else {
    // A brake is approved by the machine; gas by whoever proposed it, under the owner's switch and cap.
    row = await store.transition(row.id, 'approved', tier === 'auto' ? 'auto' : req.proposedBy)
  }

  // 3. The only path to the platform.
  try {
    const out = await mutate.mutate({
      verb: req.verb, target, params: req.params,
      ledger: { actionId: row.id, tier, status: 'approved', approvedBy: row.approvedBy ?? null },
    })
    if (!out.applied) {
      const msg = 'The adapter reported no change.'
      await store.transition(row.id, 'failed', 'auto', { error: msg, platformResponse: out.platformResponse ?? null })
      return result({ status: 'failed', tier, actionId: row.id, applied: false, error: true, note: msg })
    }
    await store.transition(row.id, 'applied', 'auto', {
      after: out.after ?? after, platformResponse: out.platformResponse ?? null,
      ...(out.warning ? { error: out.warning } : {}),
    })
    return result({ status: 'applied', tier, actionId: row.id, applied: true, error: false, note: `Applied ${req.verb} to ${target.level} ${target.externalId}.${out.warning ? ` ${out.warning}` : ''}` })
  } catch (err) {
    const msg = errorText(err).slice(0, 1000)
    try {
      await store.transition(row.id, 'failed', 'auto', { error: msg })
    } catch (e) {
      console.error('[ads/exoclick/operator] could not mark the row failed', row.id, e)
    }
    const stopped = err instanceof ChannelNotEnabledError
    return result({ status: stopped ? 'not_enabled' : 'failed', tier, actionId: row.id, applied: false, error: !stopped, note: msg })
  }
}
