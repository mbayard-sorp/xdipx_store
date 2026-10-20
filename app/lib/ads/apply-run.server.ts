/**
 * The hourly applier (ticket #16432, plan §5, §9.4 and §7 phase 5b).
 *
 * runInsightsCron calls applyApprovedActions() once an hour, after the health
 * step. One pass:
 *
 *   1. Expires proposed rows older than 48h, or past their own expires_at.
 *      They become expired with the reason "expired after 48h". A tap that
 *      waited two days is stale: the numbers behind it have moved.
 *   2. Reads ads_spend_enabled and ads_auto_apply_enabled. With either off,
 *      it stops there. Approved rows wait, and the console says so.
 *   3. Collects approved rows (owner taps from the console or the digest
 *      link) and tier auto rows a crash left at proposed, oldest first.
 *   4. Hands each one to the dispatcher in channels/apply.server.ts, which is
 *      still the only code that calls a platform. It stops once the day's
 *      attempts reach ads_auto_actions_max_per_day. An attempt is a row that
 *      reached applied or failed after being approved today, by anyone.
 *
 * A dispatch that throws is counted and logged, and the loop moves on to the
 * next row. Nothing here throws past the caller except a failed read of the
 * ledger itself, and runInsightsCron catches that so the pull still stands.
 */
import type { DispatchResult, ApplySettings } from './channels/apply.server'
import type { AdActionRow, TransitionExtra } from './ledger.server'
import type { AdActionStatus } from './ledger-core'

export const PROPOSED_TTL_MS = 48 * 3_600_000
export const EXPIRED_REASON = 'expired after 48h'
/** Rows per status read in one pass. The daily cap is far below this. */
export const APPLY_SCAN_LIMIT = 200

export interface ApplyRunStore {
  /** Rows in `status`, oldest first, at most `limit`. */
  listOldestFirst(status: Extract<AdActionStatus, 'proposed' | 'approved'>, limit: number): Promise<AdActionRow[]>
  /** Rows approved at or after `since` that reached applied or failed: today's attempts. */
  countAttemptedSince(since: Date): Promise<number>
  transition(id: number, to: AdActionStatus, actor: string, extra?: TransitionExtra): Promise<AdActionRow>
}

export interface ApplyRunDeps {
  store?: ApplyRunStore
  settings?: () => Promise<ApplySettings>
  /** Sends one approved row. Defaults to applyApprovedRow. */
  dispatch?: (row: AdActionRow) => Promise<DispatchResult>
  /** Gates and sends one stranded auto row. Defaults to adoptStrandedAutoRow. */
  adopt?: (row: AdActionRow, now: Date) => Promise<DispatchResult>
  now?: () => Date
}

export interface ApplyRunResult {
  expired: number
  /** Why the apply loop did not run, when it did not. */
  skipped: string | null
  cap: number
  /** Attempts already made today when the pass started. */
  attemptedBefore: number
  considered: number
  applied: number
  failed: number
  /** Rows the dispatcher handed back untouched (a valve, a cap, a race). */
  waiting: number
  /** Dispatches that threw. */
  errors: number
  stoppedAtCap: boolean
  /** One line per row that did not apply, for the cron response. */
  notes: string[]
}

function startOfUtcDay(now: Date): Date {
  return new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`)
}

/** True when a proposed row is past its 48h, or past an explicit expires_at. */
export function isStaleProposal(row: Pick<AdActionRow, 'createdAt' | 'expiresAt'>, now: Date): boolean {
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return true
  return now.getTime() - row.createdAt.getTime() >= PROPOSED_TTL_MS
}

function expiredReason(previous: string | null): string {
  return (previous ? `${EXPIRED_REASON}. ${previous}` : EXPIRED_REASON).slice(0, 1000)
}

function byAge(a: AdActionRow, b: AdActionRow): number {
  return a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id
}

// ---------------------------------------------------------------------------
// Defaults, loaded lazily so the tests never touch the database.
// ---------------------------------------------------------------------------

async function drizzleApplyRunStore(): Promise<ApplyRunStore> {
  const [{ db }, { adActions }, { and, asc, eq, gte, inArray, ne, sql }, { transitionAction }] = await Promise.all([
    import('~/lib/db.server'), import('../../../db/schema'), import('drizzle-orm'), import('./ledger.server'),
  ])
  // audience_sync rows (ticket #16687) belong to the weekly audience sync, which
  // writes and closes its own row. The applier never sends them and they do not
  // spend the daily action cap: refreshing an exclusion list cannot raise spend.
  return {
    listOldestFirst: (status, limit) => db.select().from(adActions)
      .where(and(eq(adActions.status, status), ne(adActions.verb, 'audience_sync')))
      .orderBy(asc(adActions.createdAt), asc(adActions.id))
      .limit(limit),
    async countAttemptedSince(since) {
      const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(adActions).where(and(
        inArray(adActions.status, ['applied', 'failed']),
        gte(adActions.approvedAt, since),
        ne(adActions.verb, 'audience_sync'),
      ))
      return Number(row?.n ?? 0)
    },
    transition: (id, to, actor, extra) => transitionAction(id, to, actor, extra),
  }
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

async function defaultDispatch(row: AdActionRow): Promise<DispatchResult> {
  const { applyApprovedRow } = await import('./channels/apply.server')
  return applyApprovedRow(row)
}

async function defaultAdopt(row: AdActionRow, now: Date): Promise<DispatchResult> {
  const { adoptStrandedAutoRow } = await import('./channels/apply.server')
  return adoptStrandedAutoRow(row, {}, now)
}

// ---------------------------------------------------------------------------

export async function applyApprovedActions(deps: ApplyRunDeps = {}): Promise<ApplyRunResult> {
  const now = (deps.now ?? (() => new Date()))()
  const store = deps.store ?? await drizzleApplyRunStore()
  const out: ApplyRunResult = {
    expired: 0, skipped: null, cap: 0, attemptedBefore: 0, considered: 0,
    applied: 0, failed: 0, waiting: 0, errors: 0, stoppedAtCap: false, notes: [],
  }

  // 1. Expiry. A stale row is gone before anything can adopt it.
  const proposed = await store.listOldestFirst('proposed', APPLY_SCAN_LIMIT)
  const live: AdActionRow[] = []
  for (const row of proposed) {
    if (!isStaleProposal(row, now)) {
      live.push(row)
      continue
    }
    try {
      await store.transition(row.id, 'expired', 'auto', { reason: expiredReason(row.reason) })
      out.expired++
    } catch (err) {
      // Someone decided it in the meantime. That is their call, not an error.
      out.notes.push(`#${row.id}: not expired, ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // 2. Valves. Off means the queue waits; it is not a failure.
  const settings = await (deps.settings ?? defaultSettings)()
  out.cap = settings.autoActionsMaxPerDay
  if (!settings.spendEnabled || !settings.autoApplyEnabled) {
    out.skipped = `${!settings.spendEnabled ? 'ads_spend_enabled' : 'ads_auto_apply_enabled'} is off, so approved rows wait`
    return out
  }

  // 3. The queue, oldest first.
  const approved = await store.listOldestFirst('approved', APPLY_SCAN_LIMIT)
  const stranded = live.filter(r => r.tier === 'auto')
  const queue = [
    ...approved.map(row => ({ row, stranded: false })),
    ...stranded.map(row => ({ row, stranded: true })),
  ].sort((a, b) => byAge(a.row, b.row))

  // 4. Dispatch under the cap.
  let attempted = await store.countAttemptedSince(startOfUtcDay(now))
  out.attemptedBefore = attempted
  const dispatchOne = deps.dispatch ?? defaultDispatch
  const adopt = deps.adopt ?? defaultAdopt
  for (const { row, stranded: isStranded } of queue) {
    if (attempted >= settings.autoActionsMaxPerDay) {
      out.stoppedAtCap = true
      break
    }
    out.considered++
    let r: DispatchResult
    try {
      r = isStranded ? await adopt(row, now) : await dispatchOne(row)
    } catch (err) {
      out.errors++
      out.notes.push(`#${row.id}: dispatch threw, ${err instanceof Error ? err.message : String(err)}`)
      console.error('[ads/apply-run] dispatch threw', row.id, err)
      continue
    }
    if (r.applied) {
      out.applied++
      attempted++
    } else if (r.status === 'failed') {
      out.failed++
      attempted++
      out.notes.push(`#${row.id}: ${r.note}`)
    } else {
      out.waiting++
      out.notes.push(`#${row.id}: ${r.note}`)
    }
  }
  return out
}
