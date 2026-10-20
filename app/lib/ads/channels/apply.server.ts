/**
 * The ledger dispatcher (plan §3.1 and §5, tickets #16429 and #16431).
 * PROTECTED PATH: the owner merges every change to this file.
 *
 * dispatch() is the only path from the control plane to a platform mutation.
 * Every request becomes an ad_actions row before anything else happens:
 *
 *   1. Resolve the target. Pause and resume act on the ad; scale, brake and
 *      set_budget act on whatever owns the budget (the campaign under CBO,
 *      the ad set under ABO), read from the ad_platform_entities mirror.
 *      halt_all with no target is account-wide.
 *   2. Compute before and after from the mirror.
 *   3. Classify the tier (apply-core.ts). Spend-raising is never auto.
 *   4. Build the idempotency key and insert the row.
 *   5. The row is dry_run unless ads_spend_enabled and ads_auto_apply_enabled
 *      are both on, the tier is auto, today's automatic actions are under
 *      ads_auto_actions_max_per_day, a budget step is inside
 *      ads_budget_max_step_pct, and for a pause, fewer than
 *      AUTO_PAUSE_CAP_PER_DAY automatic pauses have applied today. The
 *      reason it stopped goes in `reason`.
 *   6. Only a row that passed every gate reaches the adapter's mutate. A
 *      thrown error, a typed refusal or ChannelNotEnabledError, lands as
 *      failed with `code: message` in ad_actions.error. A real change is
 *      followed by syncAfterWrite unless the adapter already ran it.
 *
 * Phase 5a (ticket #16431) added:
 * - Idempotency on replay. A key whose row is applied is never sent again
 *   (applied: false, note replay). A key whose row is approved, by the owner
 *   or left there by a crash, is applied by the next dispatch, once.
 * - Brake clamp. A brake's step is min(the rule's percentage, the
 *   ads_budget_max_step_pct valve), so R6's 30% lands as a 20% automatic
 *   brake instead of a dry run. The row's reason says it was clamped.
 * - halt_all is one row and one action against ads_auto_actions_max_per_day,
 *   however many campaigns it pauses.
 * - A spend-guard halt (halt_all from rule:R7 or rule:L3, ticket #16648) is
 *   exempt from ads_auto_actions_max_per_day and the automatic pause cap,
 *   owner decision 2026-10-20. Both valves still hold it, it still writes its
 *   tier auto row (reason "spend guard: cap exempt") and still runs the
 *   read-after-write. The R7 page stays with the caller in ad-rules.server.ts.
 * - The automatic pause cap (plan §9.4). Once AUTO_PAUSE_CAP_PER_DAY
 *   automatic pauses have applied in a UTC day, the next one is written as
 *   dry_run with reason "auto-pause cap: owner page", and one owner blocker
 *   keyed ads-auto-pause-cap is filed.
 *
 * Phase 5b (ticket #16432) added applyApprovedRow and adoptStrandedAutoRow,
 * the entry points of the hourly applier in app/lib/ads/apply-run.server.ts.
 *
 * Phase 6a (ticket #16434) added dispatchCreatePaused: the paused draft
 * from the Creatives tab, one owner-tier row per attempt, gated on
 * ads_spend_enabled only, because a paused draft creates nothing live.
 *
 * Apart from that draft, nothing changes on a platform while ads_spend_enabled or
 * ads_auto_apply_enabled is off, approved rows included. The Meta adapter
 * refuses any resume that does not undo the machine's own pause (M4).
 */
import { buildIdempotencyKey } from '../ledger-core'
import type { AdActionRow, InsertActionResult, NewAdAction, TransitionExtra } from '../ledger.server'
import type { AdActionStatus, AdActionTier, AdActionVerb } from '../ledger-core'
import type { BlockerInput } from '~/lib/owner-blockers-core'
import {
  budgetChangeOf, budgetWithinStep, classifyTier, gateDispatch, isSpendGuardHalt, resolveBudgetOwner,
  SPEND_GUARD_CAP_EXEMPT_REASON, withinDailyActionCap,
  type DispatchGate, type DispatchVerb, type MirrorBudgetRow,
} from './apply-core'
import { ChannelNotEnabledError, MutationRefusedError } from './errors'
import type { ChannelAdapter, ChannelId, CreatedRefs, EntityRef, MutationResult } from './types'

/** Plan §9.4: at most 3 automatic pauses a day; the 4th waits and pages the owner. */
export const AUTO_PAUSE_CAP_PER_DAY = 3
export const AUTO_PAUSE_CAP_BLOCKER_KEY = 'ads-auto-pause-cap'
export const AUTO_PAUSE_CAP_REASON = 'auto-pause cap: owner page'

/** halt_all with no explicit target is account-wide. The row still needs a target id. */
export const HALT_ALL_TARGET_ID = 'all'

export interface DispatchRequest {
  verb: DispatchVerb
  /** The ad the action is about. Pause and resume target it; budget verbs resolve its budget owner. */
  adExternalId?: string | null | undefined
  /** An explicit target. Wins over adExternalId when given. */
  target?: EntityRef | undefined
  /** The channel to use when neither the target nor the mirror names one. */
  platform?: ChannelId | null | undefined
  /** scale and brake: new budget = round(current budget x factor). A brake is clamped to the step cap. */
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
  /** True only when the adapter really changed something on this call. */
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
  /** Tier auto pause rows applied since `since`. Feeds AUTO_PAUSE_CAP_PER_DAY. */
  countAutoPausesSince(since: Date): Promise<number>
  /** The row that owns an idempotency key, for a replay. */
  findByKey(idempotencyKey: string): Promise<AdActionRow | null>
  insert(input: NewAdAction): Promise<InsertActionResult>
  transition(id: number, to: AdActionStatus, actor: string, extra?: TransitionExtra): Promise<AdActionRow>
}

export type FileBlockerFn = (input: BlockerInput) => Promise<{ id: number; created: boolean; reopened: boolean }>

export interface ApplyDeps {
  store?: ApplyStore | undefined
  settings?: (() => Promise<ApplySettings>) | undefined
  adapterFor?: ((channel: ChannelId) => ChannelAdapter | null) | undefined
  syncAfterWrite?: ((platform: ChannelId, externalIds: string[]) => Promise<unknown>) | undefined
  fileBlocker?: FileBlockerFn | undefined
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

async function drizzleCountAutoPausesSince(since: Date): Promise<number> {
  const [{ db }, { adActions }, { and, eq, gte, sql }] = await Promise.all([
    import('~/lib/db.server'), import('../../../../db/schema'), import('drizzle-orm'),
  ])
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(adActions).where(and(
    eq(adActions.tier, 'auto'), eq(adActions.verb, 'pause'), eq(adActions.status, 'applied'), gte(adActions.createdAt, since),
  ))
  return Number(row?.n ?? 0)
}

async function drizzleFindByKey(idempotencyKey: string): Promise<AdActionRow | null> {
  const [{ db }, { adActions }, { eq }] = await Promise.all([
    import('~/lib/db.server'), import('../../../../db/schema'), import('drizzle-orm'),
  ])
  const [row] = await db.select().from(adActions).where(eq(adActions.idempotencyKey, idempotencyKey)).limit(1)
  return row && row.idempotencyKey === idempotencyKey ? row : null
}

const ledger = () => import('../ledger.server')

const defaultStore: ApplyStore = {
  mirrorRows: drizzleMirrorRows,
  countAutoActionsSince: async since => (await ledger()).countAutoActionsSince(since),
  countAutoPausesSince: drizzleCountAutoPausesSince,
  findByKey: drizzleFindByKey,
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

// Same filing path as token-health.server.ts: owner-blockers.server's fileBlocker, deduped on the key.
async function defaultFileBlocker(input: BlockerInput) {
  const { fileBlocker } = await import('~/lib/owner-blockers.server')
  return fileBlocker(input)
}

// ---------------------------------------------------------------------------
// Helpers
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

/**
 * What lands in ad_actions.error. A typed error leads with its code, so the
 * console and the digest can tell a refusal from a platform failure.
 */
function errorText(err: unknown): string {
  if (err instanceof ChannelNotEnabledError) return `not_enabled: ${err.message}`
  if (err instanceof MutationRefusedError) return `${err.code}: ${err.message}`
  const kind = err && typeof err === 'object' ? (err as { kind?: unknown }).kind : undefined
  if (err instanceof Error && typeof kind === 'string') return `${kind}: ${err.message}`
  return err instanceof Error ? err.message : String(err)
}

/**
 * A brake's new budget after the clamp: the cut is min(the rule's step,
 * maxStepPct). Rounds toward the smaller cut so the result is always inside
 * the step cap.
 */
export function clampBrake(current: number, proposed: number, maxStepPct: number): { proposed: number; clamped: boolean; askedPct: number } {
  const askedPct = current > 0 ? ((current - proposed) / current) * 100 : 0
  if (!(current > 0) || proposed >= current || askedPct <= maxStepPct + 1e-9) return { proposed, clamped: false, askedPct }
  return { proposed: Math.ceil(current * (1 - maxStepPct / 100)), clamped: true, askedPct }
}

function pct(n: number): string {
  return `${Math.round(n * 10) / 10}%`
}

function autoPauseCapBlocker(day: string, count: number, target: EntityRef, proposedBy: string): BlockerInput {
  return {
    dedupeKey: AUTO_PAUSE_CAP_BLOCKER_KEY,
    title: `Ads: ${count} automatic pauses ran today, the next one is waiting for you`,
    detail: [
      `The control plane paused ${count} things on its own today (${day} UTC). That is the daily limit in plan §9.4.`,
      `The next pause it wanted, ${target.platform} ${target.level} ${target.externalId} from ${proposedBy}, was written as a dry run and not sent.`,
      'Read today\'s applied and dry_run rows in ad_actions. If the pauses look right, pause the rest in Ads Manager. If they look wrong, turn ads_auto_apply_enabled off.',
    ].join('\n\n'),
    unblocks: 'Automatic pauses for the rest of the day. The cap resets at 00:00 UTC.',
    whereToGo: '/admin/ads/tree shows what is live, then Meta Ads Manager.',
    category: 'decision',
    priority: 1,
    source: 'sweep',
    sourceRef: 'ads:apply:auto-pause-cap',
  }
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

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
  } else if (req.verb === 'halt_all') {
    const platform = (chain[0]?.platform as ChannelId | undefined) ?? req.platform ?? 'meta'
    target = { platform, level: 'campaign', externalId: HALT_ALL_TARGET_ID }
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

  const settings = await (deps.settings ?? defaultSettings)()
  const spendEnabled = settings.spendEnabled && req.spendEnabledHint !== false

  // 2. Before, params and after.
  let before: Record<string, unknown> | null = null
  let params: Record<string, unknown> | null = null
  let after: Record<string, unknown> | null = null
  let clampNote: string | null = null
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
    // A brake cuts by min(the rule's percentage, ads_budget_max_step_pct), so it stays automatic.
    if (req.verb === 'brake' && current != null && proposed != null) {
      const c = clampBrake(current, proposed, settings.budgetMaxStepPct)
      if (c.clamped) {
        clampNote = `Brake clamped from ${pct(c.askedPct)} to ${pct(settings.budgetMaxStepPct)} by ads_budget_max_step_pct`
        proposed = c.proposed
      }
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

  // 4. Gates. halt_all is one row, so it counts once against the action cap.
  // A spend-guard halt (R7, L3) is exempt from both caps; the valves still hold it.
  const spendGuard = isSpendGuardHalt(req.verb, req.proposedBy)
  let budgetStepOk: boolean | undefined
  if (isBudget) {
    const change = budgetChangeOf(params, before)
    budgetStepOk = budgetWithinStep(change.current, change.proposed, settings.budgetMaxStepPct)
  }
  const mayAuto = spendEnabled && settings.autoApplyEnabled && tier === 'auto'
  const autoToday = mayAuto ? await store.countAutoActionsSince(startOfUtcDay(now)) : 0
  let gate: DispatchGate = gateDispatch({
    tier, spendEnabled, autoApplyEnabled: settings.autoApplyEnabled,
    autoActionsToday: autoToday, autoActionsMaxPerDay: settings.autoActionsMaxPerDay,
    budgetStepOk, budgetMaxStepPct: settings.budgetMaxStepPct,
    verb: req.verb, proposedBy: req.proposedBy,
  })
  // The pause cap sits inside the action cap: past it, an automatic pause waits for the owner.
  let pauseCapHit = 0
  if (gate.status === 'proposed' && ledgerVerb === 'pause' && tier === 'auto' && !spendGuard) {
    const pausesToday = await store.countAutoPausesSince(startOfUtcDay(now))
    if (pausesToday >= AUTO_PAUSE_CAP_PER_DAY) {
      pauseCapHit = pausesToday
      gate = {
        status: 'dry_run',
        dryRunReason: `${AUTO_PAUSE_CAP_REASON} (${pausesToday} automatic pauses applied today, cap ${AUTO_PAUSE_CAP_PER_DAY})`,
      }
    }
  }

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
    reason: gate.dryRunReason
      ? joinReason(`Dry run: ${gate.dryRunReason}`, clampNote, req.reason)
      : joinReason(spendGuard ? SPEND_GUARD_CAP_EXEMPT_REASON : null, clampNote, req.reason),
    ruleEventId: req.ruleEventId ?? null,
    tier,
    status: gate.status,
  })

  if (!ins.inserted || !ins.row) {
    const existing = ins.row ?? await store.findByKey(idempotencyKey)
    const replay = { tier: (existing?.tier as AdActionTier | undefined) ?? tier, target, actionId: existing?.id ?? null, inserted: false }
    if (existing?.status === 'approved') {
      // Approved and never sent: by the owner, or left there by a crash between approve and apply.
      if (!spendEnabled || !settings.autoApplyEnabled) {
        const which = !spendEnabled ? 'ads_spend_enabled' : 'ads_auto_apply_enabled'
        return { ...replay, status: 'approved', applied: false, error: false, note: `Approved row waits: ${which} is off, so no platform call.` }
      }
      return applyRow(existing, target, store, deps, replay)
    }
    if (existing?.status === 'applied') {
      return { ...replay, status: 'applied', applied: false, error: false, note: 'Replay: this key already applied, so no second platform call.' }
    }
    return { ...replay, status: existing?.status ?? 'skipped', applied: false, error: false, note: 'Already in the ledger today: no second row, no platform call.' }
  }

  const row = ins.row
  const base = { tier, target, actionId: row.id, inserted: true }
  if (gate.status === 'dry_run') {
    let note = `Dry run: ${gate.dryRunReason}.`
    if (pauseCapHit > 0) {
      try {
        await (deps.fileBlocker ?? defaultFileBlocker)(autoPauseCapBlocker(dayOf(now), pauseCapHit, target, req.proposedBy))
        note += ' Owner blocker filed.'
      } catch (err) {
        console.error('[ads/apply] could not file the auto-pause cap blocker', err)
        note += ' The owner blocker could not be filed.'
      }
    }
    return { ...base, status: 'dry_run', applied: false, error: false, note }
  }

  // 6. The only path to a platform mutation.
  const approvedRow = await store.transition(row.id, 'approved', 'auto')
  return applyRow(approvedRow, target, store, deps, base)
}

/**
 * Sends one approved row to its adapter and records the outcome. Every verb
 * sets a value (a status or a budget), so two racing sends of one row land
 * the same state at the platform; the conditional applied transition keeps
 * one applied row, and the loser reports applied: false.
 */
async function applyRow(
  row: AdActionRow,
  target: EntityRef,
  store: ApplyStore,
  deps: ApplyDeps,
  base: Pick<DispatchResult, 'tier' | 'target' | 'actionId' | 'inserted'>,
): Promise<DispatchResult> {
  // create_paused rows never reach here: dispatchCreatePaused has its own path.
  const verb = row.verb as Exclude<AdActionVerb, 'create_paused'>
  const params = (row.params ?? null) as Record<string, unknown> | null
  const fail = async (msg: string, platformResponse?: unknown): Promise<DispatchResult> => {
    try {
      await store.transition(row.id, 'failed', 'auto', { error: msg, ...(platformResponse !== undefined ? { platformResponse } : {}) })
    } catch (err) {
      console.error('[ads/apply] could not mark the row failed', row.id, err)
    }
    return { ...base, status: 'failed', applied: false, error: true, note: msg }
  }

  const adapter = await (deps.adapterFor ? Promise.resolve(deps.adapterFor(target.platform)) : defaultAdapterFor(target.platform))
  if (!adapter) return fail(`No adapter for channel ${target.platform}.`)

  let result: MutationResult
  try {
    result = await adapter.mutate({
      verb, target, params,
      ledger: { actionId: row.id, tier: row.tier as AdActionTier, status: 'approved', approvedBy: row.approvedBy ?? null },
    })
  } catch (err) {
    return fail(errorText(err))
  }
  if (!result.applied) return fail('The adapter reported no change.', result.platformResponse ?? null)

  try {
    await store.transition(row.id, 'applied', 'auto', {
      after: result.after ?? (row.after as Record<string, unknown> | null) ?? null,
      platformResponse: result.platformResponse ?? null,
      ...(result.warning ? { error: result.warning } : {}),
    })
  } catch (err) {
    console.error('[ads/apply] the applied transition lost a race', row.id, err)
    return { ...base, status: 'applied', applied: false, error: false, note: 'Another dispatch recorded this row first.' }
  }
  if (!result.synced) {
    const ids = result.touchedIds?.length
      ? result.touchedIds
      : target.externalId === HALT_ALL_TARGET_ID ? [] : [target.externalId]
    try {
      if (ids.length) await (deps.syncAfterWrite ?? defaultSyncAfterWrite)(target.platform, ids)
    } catch (err) {
      console.error('[ads/apply] read-after-write sync failed', target.platform, ids, err)
    }
  }
  return { ...base, status: 'applied', applied: true, error: false, note: `Applied ${verb} to ${target.level} ${target.externalId}.` }
}

// ---------------------------------------------------------------------------
// The hourly applier's entry points (ticket #16432, phase 5b)
//
// dispatch() handles a fresh request. Rows that already sit in the ledger
// reach the platform through the two functions below, which
// app/lib/ads/apply-run.server.ts calls once an hour. They keep the replay
// path's rule: nothing is sent while either valve is off.
// ---------------------------------------------------------------------------

/**
 * A proposed auto row younger than this may still belong to a dispatch that
 * is between its insert and its approve, so the applier leaves it alone.
 */
export const STRANDED_MIN_AGE_MS = 10 * 60_000

function targetOfRow(row: AdActionRow): EntityRef {
  return { platform: row.platform as ChannelId, level: row.targetLevel, externalId: row.targetExternalId }
}

function valveOff(settings: ApplySettings): string | null {
  if (!settings.spendEnabled) return 'ads_spend_enabled'
  if (!settings.autoApplyEnabled) return 'ads_auto_apply_enabled'
  return null
}

/**
 * Sends one approved row: an owner tap from the console or the digest link,
 * or a machine row a crash left at approved. Tier owner rows are never sent
 * from here, whoever approved them, because plan §5 keeps those changes in
 * Ads Manager. They land as failed with that sentence and leave the queue.
 */
export async function applyApprovedRow(row: AdActionRow, deps: ApplyDeps = {}): Promise<DispatchResult> {
  const store = deps.store ?? defaultStore
  const target = targetOfRow(row)
  const base = { tier: row.tier as AdActionTier, target, actionId: row.id, inserted: false }
  if (row.status !== 'approved') {
    return { ...base, status: row.status, applied: false, error: false, note: `Row is ${row.status}, so there is nothing to apply.` }
  }
  if (row.tier === 'owner') {
    const msg = 'tier owner: the owner makes this change in Ads Manager, so the applier does not send it.'
    try {
      await store.transition(row.id, 'failed', 'auto', { error: msg })
    } catch (err) {
      console.error('[ads/apply] could not mark the owner-tier row failed', row.id, err)
    }
    return { ...base, status: 'failed', applied: false, error: true, note: msg }
  }
  const off = valveOff(await (deps.settings ?? defaultSettings)())
  if (off) return { ...base, status: 'approved', applied: false, error: false, note: `Approved row waits: ${off} is off, so no platform call.` }
  return applyRow(row, target, store, deps, base)
}

/**
 * A tier auto row left at proposed. dispatch inserts a row and approves it in
 * the next statement, so only a crash leaves one here. The row gets the gates
 * dispatch would have given it, checked again now: both valves, the daily
 * action cap and the automatic pause cap (a spend-guard halt skips both
 * caps, as in dispatch). Only a row from today's UTC day
 * qualifies; older ones wait for the 48h expiry. A row that fails a gate
 * stays proposed.
 */
export async function adoptStrandedAutoRow(row: AdActionRow, deps: ApplyDeps = {}, now: Date = new Date()): Promise<DispatchResult> {
  const store = deps.store ?? defaultStore
  const target = targetOfRow(row)
  const base = { tier: row.tier as AdActionTier, target, actionId: row.id, inserted: false }
  const leave = (note: string): DispatchResult => ({ ...base, status: row.status, applied: false, error: false, note })
  if (row.status !== 'proposed' || row.tier !== 'auto') return leave('Not a stranded automatic row.')
  if (dayOf(row.createdAt) !== dayOf(now)) return leave('Stranded before today, so it waits for the 48h expiry.')
  if (now.getTime() - row.createdAt.getTime() < STRANDED_MIN_AGE_MS) return leave('Too new: a dispatch may still be working on it.')

  const settings = await (deps.settings ?? defaultSettings)()
  const off = valveOff(settings)
  if (off) return leave(`Stranded row waits: ${off} is off.`)
  const dayStart = startOfUtcDay(now)
  const spendGuard = isSpendGuardHalt(row.verb, row.proposedBy)
  const autoToday = spendGuard ? 0 : await store.countAutoActionsSince(dayStart)
  if (!spendGuard && !withinDailyActionCap(autoToday, settings.autoActionsMaxPerDay)) {
    return leave(`Stranded row waits: daily cap reached, ${autoToday} automatic actions today, cap ${settings.autoActionsMaxPerDay}.`)
  }
  if (!spendGuard && row.verb === 'pause' && (await store.countAutoPausesSince(dayStart)) >= AUTO_PAUSE_CAP_PER_DAY) {
    return leave(`Stranded row waits: ${AUTO_PAUSE_CAP_REASON}.`)
  }
  let approved: AdActionRow
  try {
    approved = await store.transition(row.id, 'approved', 'auto')
  } catch (err) {
    return leave(`Another writer moved this row first: ${errorText(err)}`)
  }
  return applyRow(approved, target, store, deps, base)
}

// ---------------------------------------------------------------------------
// dispatchCreatePaused (phase 6a, ticket #16434)
// ---------------------------------------------------------------------------

/** How many failed attempts one creative may log in a day before the next push is refused. */
export const CREATE_PAUSED_MAX_ATTEMPTS = 20

export interface CreatePausedRequest {
  platform: ChannelId
  /** Our ad_creatives id. The ledger target is creative ad_creatives:<id>. */
  adCreativeId: number
  /** Handed to the adapter's createPaused unchanged. */
  input: unknown
  /** The admin's email. The Creatives tab action is the only caller. */
  proposedBy: string
  reason?: string | null | undefined
  now?: Date | undefined
}

export interface CreatePausedDispatchResult {
  actionId: number
  created: CreatedRefs
}

/**
 * The ledger path for a paused draft. Always tier owner: an admin session is
 * the only caller, and that admin approves the row. Never auto, never dry_run.
 *
 * Gates: ads_spend_enabled must be on, exactly as the old push required.
 * ads_auto_apply_enabled is not read: a paused draft creates nothing live,
 * and only the owner takes an ad live (docs/ads-policy.md M4).
 *
 * One row per attempt: verb create_paused, before null, after the created
 * ids, status applied or failed. The key carries the creative id and an
 * attempt number, so a failed push can be retried and an applied one cannot.
 * A replay of a pushed creative throws already_applied with no platform call.
 * The adapter's own error is rethrown once the row is marked failed, so the
 * caller sees the same error the push always threw.
 */
export async function dispatchCreatePaused(req: CreatePausedRequest, deps: ApplyDeps = {}): Promise<CreatePausedDispatchResult> {
  const store = deps.store ?? defaultStore
  const now = req.now ?? new Date()
  const settings = await (deps.settings ?? defaultSettings)()
  if (!settings.spendEnabled) {
    throw new MutationRefusedError(req.platform, 'spend_disabled', 'Spend is off (ads_spend_enabled is false). Nothing was sent.')
  }
  const target: EntityRef = { platform: req.platform, level: 'creative', externalId: `ad_creatives:${req.adCreativeId}` }

  let idempotencyKey: string | null = null
  let params: Record<string, unknown> = {}
  for (let attempt = 0; attempt < CREATE_PAUSED_MAX_ATTEMPTS; attempt++) {
    params = { adCreativeId: req.adCreativeId, attempt }
    const key = buildIdempotencyKey({ ...target, verb: 'create_paused', day: dayOf(now), params })
    const existing = await store.findByKey(key)
    if (!existing) { idempotencyKey = key; break }
    if (existing.status === 'applied') {
      throw new MutationRefusedError(req.platform, 'already_applied', `Creative #${req.adCreativeId} was already created on ${req.platform} (ad_actions #${existing.id}).`)
    }
    if (existing.status === 'proposed' || existing.status === 'approved') {
      throw new MutationRefusedError(req.platform, 'already_applied', `Creative #${req.adCreativeId} has a push in flight (ad_actions #${existing.id}). Check Ads Manager before trying again.`)
    }
  }
  if (!idempotencyKey) {
    throw new MutationRefusedError(req.platform, 'already_applied', `Creative #${req.adCreativeId} has failed ${CREATE_PAUSED_MAX_ATTEMPTS} pushes today. Read the failed rows in ad_actions first.`)
  }

  const ins = await store.insert({
    idempotencyKey, platform: req.platform, targetLevel: target.level, targetExternalId: target.externalId,
    verb: 'create_paused', params, before: null, after: null,
    proposedBy: req.proposedBy, reason: joinReason('Paused draft from the Creatives tab', req.reason),
    tier: 'owner', status: 'proposed',
  })
  if (!ins.inserted || !ins.row) {
    throw new MutationRefusedError(req.platform, 'already_applied', `Creative #${req.adCreativeId} has a push in flight. Check Ads Manager before trying again.`)
  }
  const row = await store.transition(ins.row.id, 'approved', req.proposedBy)

  const markFailed = async (err: unknown): Promise<void> => {
    const partial = err && typeof err === 'object' ? (err as { partial?: unknown }).partial : undefined
    try {
      await store.transition(row.id, 'failed', req.proposedBy, {
        error: errorText(err).slice(0, 1000),
        ...(partial !== undefined ? { platformResponse: { partial } } : {}),
      })
    } catch (e) {
      console.error('[ads/apply] could not mark the create_paused row failed', row.id, e)
    }
  }

  const adapter = await (deps.adapterFor ? Promise.resolve(deps.adapterFor(req.platform)) : defaultAdapterFor(req.platform))
  if (!adapter) {
    const err = new ChannelNotEnabledError(req.platform, 'createPaused')
    await markFailed(err)
    throw err
  }
  let created: CreatedRefs
  try {
    created = await adapter.createPaused(req.input)
  } catch (err) {
    await markFailed(err)
    throw err
  }
  const after = {
    campaignId: created.campaignId ?? null, adSetId: created.adSetId ?? null,
    creativeId: created.creativeId ?? null, adId: created.adId ?? null,
  }
  try {
    await store.transition(row.id, 'applied', req.proposedBy, { after, platformResponse: created })
  } catch (err) {
    console.error('[ads/apply] the create_paused applied transition failed', row.id, err)
  }
  return { actionId: row.id, created }
}
