/**
 * The ledger dispatcher (plan §3.1 and §5, ticket #16429). PROTECTED PATH:
 * the owner merges every change to this file.
 *
 * dispatch() is the only path from the control plane to a platform mutation.
 * Every request becomes an ad_actions row before anything else happens:
 *
 *   1. Resolve the target. Pause and resume act on the ad; scale, brake and
 *      set_budget act on whatever owns the budget (the campaign under CBO,
 *      the ad set under ABO), read from the ad_platform_entities mirror.
 *   2. Compute before and after from the mirror.
 *   3. Classify the tier (apply-core.ts). Spend-raising is never auto.
 *   4. Build the idempotency key and insert the row.
 *   5. The row is dry_run unless ads_spend_enabled and ads_auto_apply_enabled
 *      are both on, the tier is auto, today's automatic actions are under
 *      ads_auto_actions_max_per_day, and a budget step is inside
 *      ads_budget_max_step_pct. The reason it stopped goes in `reason`.
 *   6. Only a fresh row that passed every gate reaches the adapter's mutate.
 *      A thrown error, ChannelNotEnabledError included, lands as failed with
 *      the error text. A real change is followed by syncAfterWrite.
 *
 * In this PR the Meta adapter's mutate throws ChannelNotEnabledError, so
 * nothing here can change a live ad even with both valves on.
 */
import { buildIdempotencyKey } from '../ledger-core'
import type { AdActionRow, InsertActionResult, NewAdAction, TransitionExtra } from '../ledger.server'
import type { AdActionStatus, AdActionTier, AdActionVerb } from '../ledger-core'
import {
  budgetChangeOf, budgetWithinStep, classifyTier, gateDispatch, resolveBudgetOwner,
  type DispatchVerb, type MirrorBudgetRow,
} from './apply-core'
import { ChannelNotEnabledError } from './errors'
import type { ChannelAdapter, ChannelId, EntityRef, MutationResult } from './types'

export interface DispatchRequest {
  verb: DispatchVerb
  /** The ad the action is about. Pause and resume target it; budget verbs resolve its budget owner. */
  adExternalId?: string | null | undefined
  /** An explicit target. Wins over adExternalId when given. */
  target?: EntityRef | undefined
  /** The channel to use when neither the target nor the mirror names one. */
  platform?: ChannelId | null | undefined
  /** scale and brake: new budget = round(current budget x factor). */
  budgetFactor?: number | undefined
  /** set_budget: the new daily budget. */
  newDailyBudgetCents?: number | undefined
  /** rule:R5, agent:paid-media-buyer, owner, or the admin's email. */
  proposedBy: string
  reason?: string | null | undefined
  ruleEventId?: number | null | undefined
  /** The caller's own read of ads_spend_enabled. Off here holds the row even if the store says on. */
  spendEnabledHint?: boolean | undefined
  now?: Date | undefined
}

export interface DispatchResult {
  /** skipped means no row: the target could not be resolved. */
  status: AdActionStatus | 'skipped'
  tier: AdActionTier | null
  actionId: number | null
  /** False when the idempotency key already had a row. */
  inserted: boolean
  /** True only when the adapter really changed something. */
  applied: boolean
  error: boolean
  note: string
  target: EntityRef | null
}

export interface ApplySettings {
  spendEnabled: boolean
  autoApplyEnabled: boolean
  autoActionsMaxPerDay: number
  budgetMaxStepPct: number
}

export interface ApplyStore {
  /** ad_platform_entities rows whose external_id is in the list. */
  mirrorRows(externalIds: string[]): Promise<MirrorBudgetRow[]>
  countAutoActionsSince(since: Date): Promise<number>
  insert(input: NewAdAction): Promise<InsertActionResult>
  transition(id: number, to: AdActionStatus, actor: string, extra?: TransitionExtra): Promise<AdActionRow>
}

export interface ApplyDeps {
  store?: ApplyStore | undefined
  settings?: (() => Promise<ApplySettings>) | undefined
  adapterFor?: ((channel: ChannelId) => ChannelAdapter | null) | undefined
  syncAfterWrite?: ((platform: ChannelId, externalIds: string[]) => Promise<unknown>) | undefined
}

// ---------------------------------------------------------------------------
// Default dependencies, loaded lazily so tests that inject fakes never touch
// the database, the settings table or the registry.
// ---------------------------------------------------------------------------

async function drizzleMirrorRows(externalIds: string[]): Promise<MirrorBudgetRow[]> {
  if (!externalIds.length) return []
  const [{ db }, { adPlatformEntities }, { inArray }] = await Promise.all([
    import('~/lib/db.server'), import('../../../../db/schema'), import('drizzle-orm'),
  ])
  const rows = await db.select({
    platform: adPlatformEntities.platform,
    level: adPlatformEntities.level,
    externalId: adPlatformEntities.externalId,
    parentExternalId: adPlatformEntities.parentExternalId,
    status: adPlatformEntities.status,
    effectiveStatus: adPlatformEntities.effectiveStatus,
    dailyBudgetCents: adPlatformEntities.dailyBudgetCents,
    lifetimeBudgetCents: adPlatformEntities.lifetimeBudgetCents,
  }).from(adPlatformEntities).where(inArray(adPlatformEntities.externalId, externalIds))
  // Filter again here, so the result is exactly what was asked for whatever the driver returns.
  const wanted = new Set(externalIds)
  return (rows as MirrorBudgetRow[]).filter(r => wanted.has(r.externalId))
}

const ledger = () => import('../ledger.server')

const defaultStore: ApplyStore = {
  mirrorRows: drizzleMirrorRows,
  countAutoActionsSince: async since => (await ledger()).countAutoActionsSince(since),
  insert: async input => (await ledger()).insertAction(input),
  transition: async (id, to, actor, extra) => (await ledger()).transitionAction(id, to, actor, extra),
}

async function defaultSettings(): Promise<ApplySettings> {
  const { getAdsSpendEnabled, getAdsAutomationSettings } = await import('~/lib/ad-settings.server')
  const [spendEnabled, auto] = await Promise.all([getAdsSpendEnabled(), getAdsAutomationSettings()])
  return {
    spendEnabled,
    autoApplyEnabled: auto.autoApplyEnabled,
    autoActionsMaxPerDay: auto.autoActionsMaxPerDay,
    budgetMaxStepPct: auto.budgetMaxStepPct,
  }
}

async function defaultAdapterFor(channel: ChannelId): Promise<ChannelAdapter | null> {
  const { getChannel } = await import('./registry.server')
  return getChannel(channel)?.adapter ?? null
}

async function defaultSyncAfterWrite(platform: ChannelId, externalIds: string[]): Promise<unknown> {
  const { syncAfterWrite } = await import('../sync.server')
  return syncAfterWrite(platform, externalIds)
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

const LEDGER_VERB: Record<DispatchVerb, AdActionVerb> = {
  pause: 'pause', resume: 'resume', set_budget: 'set_budget', update_creative: 'update_creative',
  halt_all: 'halt_all', scale: 'set_budget', brake: 'set_budget',
}

const BUDGET_VERBS = new Set<DispatchVerb>(['scale', 'brake', 'set_budget'])

function dayOf(now: Date): string {
  return now.toISOString().slice(0, 10)
}

function startOfUtcDay(now: Date): Date {
  return new Date(`${dayOf(now)}T00:00:00.000Z`)
}

function skipped(note: string): DispatchResult {
  return { status: 'skipped', tier: null, actionId: null, inserted: false, applied: false, error: false, note, target: null }
}

/** Walks ad, ad set, campaign in the mirror. At most three lookups. */
async function loadChain(store: ApplyStore, externalId: string): Promise<MirrorBudgetRow[]> {
  const out: MirrorBudgetRow[] = []
  let next: string | null = externalId
  for (let i = 0; i < 3 && next; i++) {
    const [row] = await store.mirrorRows([next])
    if (!row) break
    out.push(row)
    next = row.parentExternalId
  }
  return out
}

function joinReason(...parts: Array<string | null | undefined>): string | null {
  const text = parts.filter((p): p is string => !!p && p.trim().length > 0).join('. ')
  return text ? text.slice(0, 1000) : null
}

function errorText(err: unknown): string {
  if (err instanceof ChannelNotEnabledError) return `not_enabled: ${err.message}`
  return err instanceof Error ? err.message : String(err)
}

export async function dispatch(req: DispatchRequest, deps: ApplyDeps = {}): Promise<DispatchResult> {
  const store = deps.store ?? defaultStore
  const now = req.now ?? new Date()
  const ledgerVerb = LEDGER_VERB[req.verb]
  if (!ledgerVerb) return skipped(`Unknown verb ${String(req.verb)}.`)

  // 1. Target and mirror context.
  const isBudget = BUDGET_VERBS.has(req.verb)
  const adId = req.adExternalId ?? null
  const chain = adId ? await loadChain(store, adId) : []
  let target: EntityRef | null = null
  if (req.target) {
    target = req.target
  } else if (isBudget) {
    target = adId ? resolveBudgetOwner(chain, adId) : null
    if (!target) return skipped(`No ledger row: the budget owner for ad ${adId ?? '(none)'} is not in the mirror.`)
  } else if (adId) {
    const platform = (chain[0]?.platform as ChannelId | undefined) ?? req.platform ?? null
    if (!platform) return skipped(`No ledger row: no platform known for ad ${adId}.`)
    target = { platform, level: 'ad', externalId: adId }
  }
  if (!target) return skipped('No ledger row: no target.')

  const targetRow = chain.find(r => r.externalId === target!.externalId)
    ?? (await store.mirrorRows([target.externalId]))[0]
    ?? null

  // 2. Before, params and after.
  let before: Record<string, unknown> | null = null
  let params: Record<string, unknown> | null = null
  let after: Record<string, unknown> | null = null
  if (isBudget) {
    before = targetRow
      ? { dailyBudgetCents: targetRow.dailyBudgetCents, lifetimeBudgetCents: targetRow.lifetimeBudgetCents }
      : null
    const field = targetRow?.dailyBudgetCents != null && targetRow.dailyBudgetCents > 0
      ? 'dailyBudgetCents'
      : targetRow?.lifetimeBudgetCents != null && targetRow.lifetimeBudgetCents > 0 ? 'lifetimeBudgetCents' : 'dailyBudgetCents'
    const current = targetRow ? targetRow[field] : null
    let proposed: number | null = null
    if (req.verb === 'set_budget') proposed = req.newDailyBudgetCents ?? null
    else if (current != null && req.budgetFactor != null && Number.isFinite(req.budgetFactor)) {
      proposed = Math.max(0, Math.round(current * req.budgetFactor))
    }
    params = proposed != null
      ? { [req.verb === 'set_budget' ? 'dailyBudgetCents' : field]: proposed, ...(req.verb !== 'set_budget' ? { via: req.verb } : {}) }
      : { via: req.verb, budgetFactor: req.budgetFactor ?? null }
    after = proposed != null ? { ...before, [req.verb === 'set_budget' ? 'dailyBudgetCents' : field]: proposed } : null
  } else {
    before = targetRow ? { status: targetRow.status ?? null, effectiveStatus: targetRow.effectiveStatus ?? null } : null
    if (req.verb === 'pause' || req.verb === 'halt_all') after = { status: 'PAUSED' }
    else if (req.verb === 'resume') after = { status: 'ACTIVE' }
    else after = null
  }

  // 3. Tier: scale is always approve, brake and set_budget are judged on their numbers.
  const tier = classifyTier(req.verb, params, before)

  // 4. Gates.
  const settings = await (deps.settings ?? defaultSettings)()
  const spendEnabled = settings.spendEnabled && req.spendEnabledHint !== false
  let budgetStepOk: boolean | undefined
  if (isBudget) {
    const change = budgetChangeOf(params, before)
    budgetStepOk = budgetWithinStep(change.current, change.proposed, settings.budgetMaxStepPct)
  }
  const mayAuto = spendEnabled && settings.autoApplyEnabled && tier === 'auto'
  const autoToday = mayAuto ? await store.countAutoActionsSince(startOfUtcDay(now)) : 0
  const gate = gateDispatch({
    tier, spendEnabled, autoApplyEnabled: settings.autoApplyEnabled,
    autoActionsToday: autoToday, autoActionsMaxPerDay: settings.autoActionsMaxPerDay,
    budgetStepOk, budgetMaxStepPct: settings.budgetMaxStepPct,
  })

  // 5. The row.
  const idempotencyKey = buildIdempotencyKey({
    platform: target.platform, level: target.level, externalId: target.externalId,
    verb: ledgerVerb, day: dayOf(now), params,
  })
  const ins = await store.insert({
    idempotencyKey,
    platform: target.platform,
    targetLevel: target.level,
    targetExternalId: target.externalId,
    verb: ledgerVerb,
    params, before, after,
    proposedBy: req.proposedBy,
    reason: gate.dryRunReason ? joinReason(`Dry run: ${gate.dryRunReason}`, req.reason) : joinReason(req.reason),
    ruleEventId: req.ruleEventId ?? null,
    tier,
    status: gate.status,
  })
  const row = ins.row
  const base = { tier, target, actionId: row?.id ?? null, inserted: ins.inserted }
  if (!ins.inserted || !row) {
    return { ...base, status: row?.status ?? 'skipped', applied: false, error: false, note: 'Already in the ledger today: no second row, no platform call.' }
  }
  if (gate.status === 'dry_run') {
    return { ...base, status: 'dry_run', applied: false, error: false, note: `Dry run: ${gate.dryRunReason}.` }
  }

  // 6. The only path to a platform mutation.
  await store.transition(row.id, 'approved', 'auto')
  const adapter = await (deps.adapterFor ? Promise.resolve(deps.adapterFor(target.platform)) : defaultAdapterFor(target.platform))
  if (!adapter) {
    const msg = `No adapter for channel ${target.platform}.`
    await store.transition(row.id, 'failed', 'auto', { error: msg })
    return { ...base, status: 'failed', applied: false, error: true, note: msg }
  }
  let result: MutationResult
  try {
    result = await adapter.mutate({ verb: ledgerVerb === 'halt_all' ? 'pause' : ledgerVerb, target, params })
  } catch (err) {
    const msg = errorText(err)
    await store.transition(row.id, 'failed', 'auto', { error: msg })
    return { ...base, status: 'failed', applied: false, error: true, note: msg }
  }
  if (!result.applied) {
    const msg = 'The adapter reported no change.'
    await store.transition(row.id, 'failed', 'auto', { error: msg, platformResponse: result.platformResponse ?? null })
    return { ...base, status: 'failed', applied: false, error: true, note: msg }
  }
  await store.transition(row.id, 'applied', 'auto', {
    after: result.after ?? after, platformResponse: result.platformResponse ?? null,
  })
  try {
    await (deps.syncAfterWrite ?? defaultSyncAfterWrite)(target.platform, [target.externalId])
  } catch (err) {
    console.error('[ads/apply] read-after-write sync failed', target.platform, target.externalId, err)
  }
  return { ...base, status: 'applied', applied: true, error: false, note: `Applied ${ledgerVerb} to ${target.level} ${target.externalId}.` }
}
