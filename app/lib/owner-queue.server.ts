/**
 * One owner surface, computed once and rendered three ways.
 *
 * ## What this replaces
 *
 * Fifteen independent senders, each of which had concluded on its own that the
 * owner needed to hear from it. D2 gave every one of them an escalation class;
 * this is the thing those `queue` classes fold into. The daily email, a new
 * `/admin/ops`, and `owner{}` on `/api/team/status` all render THIS, so a
 * routine and the owner are never looking at two different lists.
 *
 * ## Four rules, and three of them exist because the first draft got it wrong
 *
 * **1. Every entry names the single move.** `move` is required and is a
 * sentence like "merge #991" or "set OWNER_ALERT_PHONE". If an entry cannot
 * name one, it is not owner work — it is a lane's floor breach wearing an
 * owner's clothes, and it belongs in a ticket at that lane.
 *
 * **2. The counter-rule for what nobody registered.** As first designed this
 * was a *registration* rule wearing an inclusion rule's clothes: correctness
 * depended on every filer remembering to file a blocker, which is precisely the
 * §7 failure mode it was meant to fix. So any row on a structurally owner-only
 * surface — an approved `config`/`program` row, a `needs-owner` PR older than
 * 72h — with NO matching blocker is itself an entry, class
 * `unregistered-owner-ask`. Forgetting becomes loud instead of invisible.
 *
 * **3. A probe not evaluated recently is its own state, not a pass.** Blocker
 * #67 is the live cautionary tale: it carried `pr_merged` on the PR that fixed
 * the *prose*, that PR merged, and the row cleared itself on a fact that was
 * true and irrelevant while the actual ask went undone. A probe that has not
 * run in 24h reads as `stale`, never as satisfied.
 *
 * **4. Silence is never a pass.** Every gatherer fails soft to `null`, and
 * `null` renders as "could not determine", distinct from zero. The estate has
 * already paid for the alternative once: the pricing batch died at the 300s
 * ceiling four mornings running while the digest printed GOOD, because its test
 * was `COUNT(*) > 0` and a dead cron and a healthy quiet one both produce no
 * rows.
 *
 * ## Why money leads
 *
 * The money block is first and leads with **estate spend against revenue**, not
 * profit against the pace. Over 28 days the store took $28.11 across one
 * purchase while the fleet cost $93.47 over 30. Every invariant in this program
 * is about the fleet's health; not one is about the store's, and a queue that
 * opened with ticket counts would quietly confirm that ordering every morning.
 */

import { sql } from 'drizzle-orm'

import { db } from '~/lib/db.server'
import { listOpenBlockers } from '~/lib/owner-blockers.server'
import { recentSettingChanges } from '~/lib/settings.server'
import type { OwnerBlocker } from '~/lib/owner-blockers-core'

const LOG = '[owner-queue]'

/** Hours after which a probe's verdict is no longer evidence of anything. */
export const PROBE_STALE_HOURS = 24

/** Hours a `needs-owner` PR may sit before its absence from the blocker list is itself an entry. */
export const UNREGISTERED_PR_HOURS = 72

/** The monthly profit goal every money line is measured against. */
export const MONTHLY_PROFIT_GOAL_USD = 2000

export type OwnerQueueClass =
  | 'blocker'
  | 'protected-merge'
  | 'owner-decision'
  | 'unregistered-owner-ask'
  | 'stale-probe'

export interface QueueProbe {
  kind: string
  arg: string | null
  lastEvaluatedAt: string | null
  lastOk: boolean | null
  /** True when the verdict is older than PROBE_STALE_HOURS, or was never taken. */
  stale: boolean
}

export interface OwnerQueueEntry {
  /** Stable across runs, so the digest can tell a changed queue from a re-render. */
  id: string
  cls: OwnerQueueClass
  /** 1 is most urgent. */
  priority: number
  title: string
  /**
   * The single move the owner makes. Required, and the inclusion test: an entry
   * that cannot name one is not owner work.
   */
  move: string
  ageDays: number
  /** Which surface produced this, so a queue entry resolves to an actor. */
  source: string
  probe: QueueProbe | null
  detail?: string | null
}

export interface MoneyBlock {
  /** null = could not determine. Never conflate with 0. */
  ordersLast7: number | null
  revenueLast7Usd: number | null
  profitLast30Usd: number | null
  goalUsd: number
  /** Fleet cost over the same 30 days, from api_token_log. Metered only. */
  estateSpendLast30Usd: number | null
  /**
   * What the subscription-rated tokens WOULD have cost at API list price.
   *
   * `api_token_log.est_cost_usd` is zero for every Max-subscription row by
   * design, and that design is right for a budget gate: charging a team for
   * money that never moved throttles it on a phantom. But it means the metered
   * figure alone answers "what did the API key bill" and not "what is this
   * fleet consuming", and the second question is the one a spend-to-revenue
   * ratio needs. Measured 2026-09-04: $98.32 metered against roughly $2,400 of
   * list-priced consumption over the same 30 days.
   *
   * A CEILING, not an estimate. See `subscriptionRatedUnknownPct`.
   */
  subscriptionRatedCeilingUsd: number | null
  /**
   * The share of that ceiling priced at DEFAULT_RATE because the model is not
   * in the rate table. Measured 2026-09-04 it was 95%, since 87% of
   * subscription-rated tokens were on models the table predates, all of them
   * charged at Opus rates. A number that is mostly a guess must say so, or the
   * next reader quotes it as a fact — which is exactly what happened to the
   * audit that produced this field.
   */
  subscriptionRatedUnknownPct: number | null
  /**
   * Fixed monthly SaaS, hand-maintained in `fixed_monthly_costs`.
   *
   * Null when the table is empty, which is honest: until someone types the
   * numbers in, the denominator genuinely is unknown, and rendering 0 would
   * assert that hosting is free.
   */
  fixedMonthlyUsd: number | null
  /**
   * The sentence that matters. Spend against revenue, not profit against pace:
   * at current volume the store earns less than the fleet costs, and a money
   * block that led with "profit vs goal" would report that as a percentage
   * rather than as a fact.
   */
  verdict: string
}

export interface ValveChange {
  key: string
  oldValue: string | null
  newValue: string | null
  actor: string | null
  source: string | null
  changedAt: string
  /**
   * True when nothing recorded who made the change.
   *
   * `settings_audit_log` gained actor and source in migration 072 precisely so
   * a flip could be attributed afterwards, and it matters: four team
   * auto-approve valves were flipped on 2026-07-18 while the docs said
   * otherwise for eleven days. An unattributed flip is not an accusation, it is
   * a gap in the record, and the owner is the only person who can say whether
   * it was theirs.
   */
  unattributed: boolean
}

export interface LaneFlow {
  kind: string
  created14d: number
  terminal14d: number
  /** Positive means the lane is filling faster than it drains. */
  netPerDay: number
}

export interface HealthBlock {
  blocked: number
  blockedAtZeroAttempts: number
  oldestBlockerAgeDays: number | null
  openBlockers: number
  blockersWithoutProbe: number
  /**
   * Per-kind intake versus terminal over 14 days.
   *
   * The single most diagnostic number in this program, and until now it existed
   * only inside a planning document: it is what distinguishes "the fleet is
   * failing" from "the fleet is succeeding into a state nothing empties".
   */
  laneFlow: LaneFlow[]
  /**
   * Valve flips in the last 24h.
   *
   * `recentSettingChanges()` has carried the docstring "used by the owner
   * digest so a flip the owner did not make is visible the next morning rather
   * than discovered weeks later by an audit" while having ZERO callers. The
   * plan for this stage said delete it. Wiring it is strictly better: the
   * function was right about what the owner needs, it simply had nowhere to
   * report to until there was one owner surface — and deleting it would also
   * have meant editing a protected path to remove something useful.
   */
  recentValveChanges: ValveChange[]
  /**
   * Crons that are alive and broken, and crons that have gone silent.
   *
   * The queue read no cron health at all until this. That was survivable only
   * for as long as the push channel worked, and the incident that motivated it
   * was the push channel itself: `/cron/owner-digest` and `/cron/blocker-list`
   * returned HTTP 500 on every run for two days while `/admin/ops` rendered
   * perfectly, so the one surface still working had nothing to say about the
   * two that were not. A health strip that cannot report the failure of its own
   * delivery is not a health strip.
   */
  cronsFailing: CronFault[]
  cronsSilent: CronFault[]
}

export interface CronFault {
  route: string
  moneyRelevant: boolean
  ownerTeam: string | null
  /** ISO, or null when nothing has ever been seen. */
  lastSeenAt: string | null
  /** Failing routes only: how many consecutive runs threw. */
  consecutiveFailures?: number
  detail: string | null
}

export interface OwnerQueue {
  generatedAt: string
  money: MoneyBlock
  entries: OwnerQueueEntry[]
  health: HealthBlock
  /**
   * Changes only when the queue's substance changes, so the digest can skip a
   * send on an unchanged day without hashing rendered HTML (which changes every
   * day for reasons nobody cares about, like the date in the footer).
   */
  fingerprint: string
  /** Gatherers that failed. Non-empty means the queue is incomplete, and says so. */
  gaps: string[]
}

// ---------------------------------------------------------------------------

function daysBetween(iso: string | null, now: number): number {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((now - t) / 86_400_000))
}

export function probeFrom(b: OwnerBlocker, now: number): QueueProbe | null {
  if (!b.verifyProbe) return null
  const at = b.lastVerifiedAt
  const ageMs = at ? now - new Date(at).getTime() : Number.POSITIVE_INFINITY
  return {
    kind: b.verifyProbe,
    arg: b.verifyArg,
    lastEvaluatedAt: at,
    lastOk: b.lastVerifyOk,
    // Never evaluated is stale, not fresh. A probe that has not run is not
    // evidence that the condition holds; it is the absence of evidence, and
    // the two must not render the same way.
    stale: !Number.isFinite(ageMs) || ageMs > PROBE_STALE_HOURS * 3_600_000,
  }
}

/**
 * Turn open blockers into queue entries.
 *
 * Pure, so the ordering and the move-naming can be tested without a database.
 */
export function blockerEntries(blockers: readonly OwnerBlocker[], now: number): OwnerQueueEntry[] {
  return blockers.map((b) => ({
    id: `blocker:${b.id}`,
    cls: 'blocker' as const,
    priority: b.priority,
    title: b.title,
    // `whereToGo` is the closest thing a blocker carries to a move. Falling back
    // to the title is honest rather than clever: a blocker whose title does not
    // imply an action is a badly-filed blocker, and inventing a move here would
    // hide that from the person who has to act on it.
    move: b.whereToGo?.trim() || b.title,
    ageDays: b.ageDays,
    source: `blocker #${b.id} (${b.source})`,
    probe: probeFrom(b, now),
    detail: b.detail,
  }))
}

/**
 * Entries for owner-only surfaces that nobody registered as a blocker.
 *
 * This is rule 2, and it is the reason the queue is an inclusion rule rather
 * than a registration rule. Everything here is, by construction, work the owner
 * must do that nothing asked the owner to do.
 */
export function unregisteredEntries(input: {
  ownerOnlyTickets: Array<{ id: number; kind: string; ageDays: number; suggestion: string }>
  needsOwnerPrs: Array<{ number: number; title: string; ageHours: number }>
  registeredRefs: ReadonlySet<string>
}): OwnerQueueEntry[] {
  const out: OwnerQueueEntry[] = []

  for (const t of input.ownerOnlyTickets) {
    if (input.registeredRefs.has(`ticket:${t.id}`)) continue
    out.push({
      id: `unregistered:ticket:${t.id}`,
      cls: 'unregistered-owner-ask',
      priority: 3,
      title: `Approved \`${t.kind}\` ticket #${t.id} has no owner blocker`,
      move: `Decide #${t.id}: approve the spend, or dismiss it. Nothing else can.`,
      ageDays: t.ageDays,
      source: `ticket #${t.id}`,
      probe: null,
      detail: t.suggestion.slice(0, 400),
    })
  }

  for (const pr of input.needsOwnerPrs) {
    if (pr.ageHours < UNREGISTERED_PR_HOURS) continue
    if (input.registeredRefs.has(`pr:${pr.number}`)) continue
    out.push({
      id: `unregistered:pr:${pr.number}`,
      cls: 'unregistered-owner-ask',
      priority: 2,
      title: `PR #${pr.number} has carried needs-owner for ${Math.floor(pr.ageHours / 24)}d with no blocker row`,
      move: `Merge or close #${pr.number}.`,
      ageDays: Math.floor(pr.ageHours / 24),
      source: `pr #${pr.number}`,
      probe: null,
      detail: pr.title,
    })
  }

  return out
}

/** Entries for probes that have gone quiet. Rule 3. */
export function staleProbeEntries(entries: readonly OwnerQueueEntry[]): OwnerQueueEntry[] {
  // Only blockers old enough that a probe SHOULD have run: a row filed twenty
  // minutes ago has a stale probe by definition and flagging it would be noise
  // on the very first render.
  return entries
    .filter((e) => e.probe?.stale && e.ageDays >= 1)
    .map((e) => ({
      id: `stale-probe:${e.id}`,
      cls: 'stale-probe' as const,
      priority: 4,
      title: `"${e.title}" has a probe that has not been evaluated in ${PROBE_STALE_HOURS}h`,
      move:
        'Check that /cron/blocker-list is still running. Until the probe runs, this row is '
        + 'neither open nor cleared on evidence, it is simply unread.',
      ageDays: e.ageDays,
      source: e.source,
      probe: e.probe,
    }))
}

export function sortEntries(entries: readonly OwnerQueueEntry[]): OwnerQueueEntry[] {
  return [...entries].sort((a, b) => a.priority - b.priority || b.ageDays - a.ageDays || a.id.localeCompare(b.id))
}

/**
 * A stable digest of the queue's substance.
 *
 * Deliberately excludes ages and timestamps. Including them would change the
 * fingerprint every single day, which would make "send only when the queue
 * changed" mean "send every day" — the rule would still be there and would do
 * nothing, which is the exact shape of failure this program keeps finding.
 */
export function fingerprintOf(entries: readonly OwnerQueueEntry[]): string {
  return sortEntries(entries).map((e) => `${e.id}:${e.priority}`).join('|')
}

export function moneyVerdict(m: Omit<MoneyBlock, 'verdict'>): string {
  if (m.revenueLast7Usd === null || m.estateSpendLast30Usd === null) {
    return 'Revenue or estate spend could not be read this run, so the comparison that matters is unavailable. This is a gap, not a zero.'
  }
  const spend = m.estateSpendLast30Usd
  const rev = m.revenueLast7Usd
  if (rev === 0 && spend > 0) {
    return `The fleet cost $${spend.toFixed(2)} over 30 days and the store took nothing in the last 7. `
      + 'Nothing in the automation program changes that number; it is a demand question.'
  }
  return `Estate spend $${spend.toFixed(2)}/30d against store revenue $${rev.toFixed(2)}/7d. `
    + `Profit goal is $${MONTHLY_PROFIT_GOAL_USD}/month.`
}

// ---------------------------------------------------------------------------
// gatherers — each fails soft to null, and null means "unknown", never "fine"
// ---------------------------------------------------------------------------

async function gatherMoney(gaps: string[]): Promise<MoneyBlock> {
  let ordersLast7: number | null = null
  let revenueLast7Usd: number | null = null
  let profitLast30Usd: number | null = null
  let estateSpendLast30Usd: number | null = null
  let subscriptionRatedCeilingUsd: number | null = null
  let subscriptionRatedUnknownPct: number | null = null
  let fixedMonthlyUsd: number | null = null

  try {
    const r = await db.execute(sql`
      SELECT COALESCE(SUM(total_orders), 0)::int      AS orders,
             COALESCE(SUM(total_revenue), 0)::float8  AS revenue
        FROM daily_profit_summary
       WHERE summary_date >= (CURRENT_DATE - INTERVAL '7 days')`)
    const row = (r.rows ?? [])[0] as Record<string, unknown> | undefined
    ordersLast7 = Number(row?.['orders'] ?? 0)
    revenueLast7Usd = Number(row?.['revenue'] ?? 0)
  } catch (err) {
    gaps.push('orders/revenue')
    console.warn(`${LOG} money: orders/revenue read failed`, err)
  }

  try {
    const r = await db.execute(sql`
      SELECT COALESCE(SUM(total_profit), 0)::float8 AS profit
        FROM daily_profit_summary
       WHERE summary_date >= (CURRENT_DATE - INTERVAL '30 days')`)
    profitLast30Usd = Number(((r.rows ?? [])[0] as Record<string, unknown>)?.['profit'] ?? 0)
  } catch (err) {
    gaps.push('profit')
    console.warn(`${LOG} money: profit read failed`, err)
  }

  try {
    const r = await db.execute(sql`
      SELECT COALESCE(SUM(est_cost_usd), 0)::float8 AS usd
        FROM api_token_log
       WHERE ts >= now() - INTERVAL '30 days'`)
    estateSpendLast30Usd = Number(((r.rows ?? [])[0] as Record<string, unknown>)?.['usd'] ?? 0)
  } catch (err) {
    gaps.push('estate-spend')
    console.warn(`${LOG} money: estate spend read failed`, err)
  }

  // Price the subscription-rated rows as if the API key had paid, by calling
  // the estate's own estimator with a metered source. Grouped by model so the
  // rate table is consulted once per model rather than once per row, and so the
  // unknown-model share can be measured rather than assumed.
  try {
    const { estimateCostUsd, isKnownModelRate, MAX_SUBSCRIPTION_SOURCES } =
      await import('~/lib/model-pricing.server')
    const sources = [...MAX_SUBSCRIPTION_SOURCES]
    const r = await db.execute(sql`
      SELECT model,
             COALESCE(SUM(input_tokens), 0)::bigint          AS inp,
             COALESCE(SUM(output_tokens), 0)::bigint         AS outp,
             COALESCE(SUM(cache_creation_tokens), 0)::bigint AS cc,
             COALESCE(SUM(cache_read_tokens), 0)::bigint     AS cr
        FROM api_token_log
       WHERE ts >= now() - INTERVAL '30 days'
         AND source = ANY(${sources})
       GROUP BY model`)
    let total = 0
    let unknown = 0
    for (const raw of (r.rows ?? []) as Array<Record<string, unknown>>) {
      const model = String(raw['model'] ?? '')
      const cost = estimateCostUsd({
        model,
        source: 'sync', // the whole point: price it as if metered
        inputTokens: Number(raw['inp'] ?? 0),
        outputTokens: Number(raw['outp'] ?? 0),
        cacheCreationTokens: Number(raw['cc'] ?? 0),
        cacheReadTokens: Number(raw['cr'] ?? 0),
      })
      total += cost
      if (!isKnownModelRate(model)) unknown += cost
    }
    subscriptionRatedCeilingUsd = Math.round(total * 100) / 100
    subscriptionRatedUnknownPct = total > 0 ? Math.round((unknown / total) * 100) : 0
  } catch (err) {
    gaps.push('subscription-rated-spend')
    console.warn(`${LOG} money: subscription-rated spend failed`, err)
  }

  try {
    const r = await db.execute(sql`
      SELECT COALESCE(SUM(monthly_usd), 0)::float8 AS usd
        FROM fixed_monthly_costs
       WHERE effective_from <= CURRENT_DATE
         AND (effective_to IS NULL OR effective_to > CURRENT_DATE)`)
    const usd = Number(((r.rows ?? [])[0] as Record<string, unknown>)?.['usd'] ?? 0)
    // Zero rows means nobody has entered the numbers, not that hosting is free.
    fixedMonthlyUsd = usd > 0 ? usd : null
  } catch (err) {
    // The table arrives with migration 094; a digest must still send before it
    // has been applied, so this is a gap rather than a failure.
    gaps.push('fixed-costs')
    console.warn(`${LOG} money: fixed monthly costs read failed`, err)
  }

  const base = {
    ordersLast7,
    revenueLast7Usd,
    profitLast30Usd,
    goalUsd: MONTHLY_PROFIT_GOAL_USD,
    estateSpendLast30Usd,
    subscriptionRatedCeilingUsd,
    subscriptionRatedUnknownPct,
    fixedMonthlyUsd,
  }
  return { ...base, verdict: moneyVerdict(base) }
}

async function gatherHealth(gaps: string[]): Promise<HealthBlock> {
  const out: HealthBlock = {
    blocked: 0,
    blockedAtZeroAttempts: 0,
    oldestBlockerAgeDays: null,
    openBlockers: 0,
    blockersWithoutProbe: 0,
    laneFlow: [],
    recentValveChanges: [],
    cronsFailing: [],
    cronsSilent: [],
  }

  // Read through the same manifest the janitor uses, so the owner surface and
  // the lane tickets can never disagree about what is broken.
  try {
    const { readCronLiveness } = await import('~/lib/cron-runs.server')
    const liveness = await readCronLiveness()
    out.cronsFailing = liveness
      .filter(l => l.failing)
      .map(l => ({
        route: l.route,
        moneyRelevant: l.moneyRelevant,
        ownerTeam: l.ownerTeam,
        lastSeenAt: l.lastSeenAt ? l.lastSeenAt.toISOString() : null,
        consecutiveFailures: l.consecutiveFailures,
        detail: l.lastError ? l.lastError.slice(0, 200) : null,
      }))
    out.cronsSilent = liveness
      .filter(l => l.breached)
      .map(l => ({
        route: l.route,
        moneyRelevant: l.moneyRelevant,
        ownerTeam: l.ownerTeam,
        lastSeenAt: l.lastSeenAt ? l.lastSeenAt.toISOString() : null,
        detail: `floor ${l.periodMinutes}+${l.graceMinutes} min, source ${l.source}`,
      }))
  } catch (err) {
    gaps.push('cron-health')
    console.warn(`${LOG} health: cron liveness failed`, err)
  }

  try {
    out.recentValveChanges = (await recentSettingChanges(24, 20)).map((c) => ({
      key: c.key,
      oldValue: c.oldValue,
      newValue: c.newValue,
      actor: c.actor,
      source: c.source,
      changedAt: c.changedAt.toISOString(),
      unattributed: !c.actor || c.actor === 'unknown',
    }))
  } catch (err) {
    gaps.push('valve-changes')
    console.warn(`${LOG} health: valve changes failed`, err)
  }

  try {
    const r = await db.execute(sql`
      SELECT COUNT(*)::int                                        AS blocked,
             COUNT(*) FILTER (WHERE attempt_count = 0)::int        AS at_zero
        FROM homepage_team_suggestions
       WHERE status = 'blocked'`)
    const row = (r.rows ?? [])[0] as Record<string, unknown> | undefined
    out.blocked = Number(row?.['blocked'] ?? 0)
    out.blockedAtZeroAttempts = Number(row?.['at_zero'] ?? 0)
  } catch (err) {
    gaps.push('blocked-count')
    console.warn(`${LOG} health: blocked count failed`, err)
  }

  try {
    // Intake versus terminal, per kind, over a fortnight. A kind whose net is
    // positive is filling faster than anything empties it.
    const r = await db.execute(sql`
      SELECT kind,
             COUNT(*) FILTER (WHERE created_at >= now() - INTERVAL '14 days')::int AS created,
             COUNT(*) FILTER (WHERE status IN ('applied','dismissed')
                                AND updated_at >= now() - INTERVAL '14 days')::int AS terminal
        FROM homepage_team_suggestions
       GROUP BY kind
       ORDER BY created DESC`)
    out.laneFlow = ((r.rows ?? []) as Array<Record<string, unknown>>)
      .map((row) => {
        const created14d = Number(row['created'] ?? 0)
        const terminal14d = Number(row['terminal'] ?? 0)
        return {
          kind: String(row['kind'] ?? '?'),
          created14d,
          terminal14d,
          netPerDay: Math.round(((created14d - terminal14d) / 14) * 10) / 10,
        }
      })
      .filter((f) => f.created14d > 0 || f.terminal14d > 0)
  } catch (err) {
    gaps.push('lane-flow')
    console.warn(`${LOG} health: lane flow failed`, err)
  }

  return out
}

interface OwnerOnlyTicket { id: number; kind: string; ageDays: number; suggestion: string }

async function gatherOwnerOnlyTickets(gaps: string[], now: number): Promise<OwnerOnlyTicket[]> {
  try {
    // `config` and `program` are the two kinds with no agent-reachable exit.
    // Deliberately NOT re-derived from a candidate list here: an earlier count
    // in this program said 253 rows were executor-less when 251 of them had an
    // edge, and the correction was to read the transition map rather than to
    // guess from kinds.
    const r = await db.execute(sql`
      SELECT id, kind, created_at::text AS created_at, suggestion
        FROM homepage_team_suggestions
       WHERE status = 'approved' AND kind IN ('config','program')
       ORDER BY created_at ASC
       LIMIT 50`)
    return ((r.rows ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: Number(row['id'] ?? 0),
      kind: String(row['kind'] ?? '?'),
      ageDays: daysBetween(String(row['created_at'] ?? ''), now),
      suggestion: String(row['suggestion'] ?? ''),
    }))
  } catch (err) {
    gaps.push('owner-only-tickets')
    console.warn(`${LOG} owner-only ticket read failed`, err)
    return []
  }
}

/**
 * Compute the queue.
 *
 * `needsOwnerPrs` is injected rather than fetched: the GitHub read belongs to
 * the caller that already has a client, and keeping it out means this function
 * is exercisable without the network.
 */
export async function computeOwnerQueue(opts: {
  needsOwnerPrs?: Array<{ number: number; title: string; ageHours: number }>
  now?: number
} = {}): Promise<OwnerQueue> {
  const now = opts.now ?? Date.now()
  const gaps: string[] = []

  let blockers: OwnerBlocker[] = []
  try {
    blockers = await listOpenBlockers(100)
  } catch (err) {
    gaps.push('blockers')
    console.warn(`${LOG} blocker read failed`, err)
  }

  const [money, health, ownerOnlyTickets] = await Promise.all([
    gatherMoney(gaps),
    gatherHealth(gaps),
    gatherOwnerOnlyTickets(gaps, now),
  ])

  health.openBlockers = blockers.length
  health.blockersWithoutProbe = blockers.filter((b) => !b.verifyProbe && b.category !== 'decision').length
  health.oldestBlockerAgeDays = blockers.length > 0
    ? Math.max(...blockers.map((b) => b.ageDays))
    : null

  // What the blocker list already knows about, so the counter-rule only fires
  // on genuinely unregistered surfaces.
  const registeredRefs = new Set<string>()
  for (const b of blockers) {
    if (b.verifyProbe === 'pr_merged' && b.verifyArg) registeredRefs.add(`pr:${b.verifyArg.replace(/\D/g, '')}`)
    const ref = b.sourceRef ?? ''
    const pr = ref.match(/\/pull\/(\d+)/)
    if (pr) registeredRefs.add(`pr:${pr[1]}`)
    for (const m of `${b.title} ${b.detail ?? ''}`.matchAll(/#(\d{2,6})\b/g)) {
      registeredRefs.add(`ticket:${m[1]}`)
    }
  }

  const base = blockerEntries(blockers, now)
  const entries = sortEntries([
    ...base,
    ...unregisteredEntries({
      ownerOnlyTickets,
      needsOwnerPrs: opts.needsOwnerPrs ?? [],
      registeredRefs,
    }),
    ...staleProbeEntries(base),
  ])

  return {
    generatedAt: new Date(now).toISOString(),
    money,
    entries,
    health,
    fingerprint: fingerprintOf(entries),
    gaps,
  }
}
