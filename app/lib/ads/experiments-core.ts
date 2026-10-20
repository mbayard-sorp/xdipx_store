/**
 * Ads Control Plane experiment log, pure half (migration 133, ticket #16436,
 * plan sections 3.3, 8, 9.2 and 9.5). No database, no platform, no clock of
 * its own: everything here takes its inputs and returns a value, so the
 * floors and the status machine are unit-tested without Neon.
 *
 * At this spend an experiment is a structured hypothesis log, not a stats
 * engine (plan section 8). compareArms reports each arm against the section
 * 9.2 floors and names a leader only when every arm clears them. It never
 * decides anything: the owner writes the verdict.
 */
import type {
  AdExperimentArm,
  AdExperimentMetric,
  AdExperimentStatus,
  AdExperimentVariable,
} from '../../../db/schema'

export type { AdExperimentArm, AdExperimentMetric, AdExperimentStatus, AdExperimentVariable }

export const EXPERIMENT_VARIABLES: readonly AdExperimentVariable[] = ['hook', 'format', 'product', 'audience', 'placement']
export const EXPERIMENT_METRICS: readonly AdExperimentMetric[] = ['cpl', 'cpa', 'roas']
export const EXPERIMENT_STATUSES: readonly AdExperimentStatus[] = ['planned', 'running', 'decided', 'abandoned']
export const ARM_LEVELS: readonly AdExperimentArm['level'][] = ['campaign', 'adset', 'ad']

export const MIN_ARMS = 2
export const MAX_ARMS = 4
export const DEFAULT_MIN_SPEND_CENTS = 4000
export const MAX_HYPOTHESIS_CHARS = 500
export const MAX_LABEL_CHARS = 60

/**
 * Plan section 9.2 floors. Below them no verdict is allowed.
 * cpl: 10 leads per arm (still about plus or minus 30%) and 2,000 impressions.
 * cpa: 10 orders per arm is out of reach at this spend, so a CPA read needs
 *      a 40-lead cohort and 30 days instead.
 * roas: 10 orders per arm.
 */
export const FLOORS = {
  cplLeads: 10,
  cplImpressions: 2000,
  cpaLeads: 40,
  cpaDays: 30,
  roasOrders: 10,
} as const

export const isExperimentVariable = (v: unknown): v is AdExperimentVariable =>
  typeof v === 'string' && (EXPERIMENT_VARIABLES as readonly string[]).includes(v)
export const isExperimentMetric = (v: unknown): v is AdExperimentMetric =>
  typeof v === 'string' && (EXPERIMENT_METRICS as readonly string[]).includes(v)
export const isExperimentStatus = (v: unknown): v is AdExperimentStatus =>
  typeof v === 'string' && (EXPERIMENT_STATUSES as readonly string[]).includes(v)
export const isArmLevel = (v: unknown): v is AdExperimentArm['level'] =>
  typeof v === 'string' && (ARM_LEVELS as readonly string[]).includes(v)

// ─── Status machine ──────────────────────────────────────────────────────────

/** Legal moves. decided and abandoned are terminal. */
export const EXPERIMENT_TRANSITIONS: Record<AdExperimentStatus, readonly AdExperimentStatus[]> = {
  planned: ['running', 'abandoned'],
  running: ['decided', 'abandoned'],
  decided: [],
  abandoned: [],
}

export class IllegalExperimentTransitionError extends Error {
  constructor(public from: AdExperimentStatus, public to: AdExperimentStatus) {
    super(`An experiment cannot move from ${from} to ${to}.`)
    this.name = 'IllegalExperimentTransitionError'
  }
}

export function canTransition(from: AdExperimentStatus, to: AdExperimentStatus): boolean {
  return EXPERIMENT_TRANSITIONS[from].includes(to)
}

export function assertExperimentTransition(from: AdExperimentStatus, to: AdExperimentStatus): void {
  if (!canTransition(from, to)) throw new IllegalExperimentTransitionError(from, to)
}

// ─── Input validation ────────────────────────────────────────────────────────

export interface NewExperimentInput {
  hypothesis: string
  variable: AdExperimentVariable
  primaryMetric: AdExperimentMetric
  arms: AdExperimentArm[]
  minSpendCents: number
  notes: string | null
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * One arm from the create form. The select posts "platform|level|externalId"
 * from the entity mirror; the label is free text and falls back to Arm A, B.
 */
export function parseArmChoice(choice: string, label: string, index: number): ParseResult<AdExperimentArm> {
  const parts = choice.split('|')
  if (parts.length !== 3) return { ok: false, error: `Arm ${index + 1}: pick an ad, ad set or campaign.` }
  const [platform, level, externalId] = parts.map(p => p.trim())
  if (!platform || !externalId) return { ok: false, error: `Arm ${index + 1}: pick an ad, ad set or campaign.` }
  if (!isArmLevel(level)) return { ok: false, error: `Arm ${index + 1}: ${level || 'that level'} cannot be an arm.` }
  const clean = label.trim().slice(0, MAX_LABEL_CHARS)
  return { ok: true, value: { label: clean || `Arm ${String.fromCharCode(65 + index)}`, platform, level, externalId } }
}

export function validateArms(arms: AdExperimentArm[]): string | null {
  if (arms.length < MIN_ARMS) return `An experiment needs at least ${MIN_ARMS} arms.`
  if (arms.length > MAX_ARMS) return `An experiment takes at most ${MAX_ARMS} arms.`
  const seen = new Set<string>()
  for (const a of arms) {
    const key = `${a.platform}|${a.externalId}`
    if (seen.has(key)) return 'The same entity is in two arms.'
    seen.add(key)
  }
  return null
}

/** Dollars as typed in the form to cents. Blank means the $40 default. */
export function parseMinSpendDollars(raw: string): ParseResult<number> {
  const t = raw.trim()
  if (!t) return { ok: true, value: DEFAULT_MIN_SPEND_CENTS }
  const n = Number(t.replace(/^\$/, ''))
  if (!Number.isFinite(n) || n <= 0 || n > 10_000) return { ok: false, error: 'Minimum spend is a dollar amount between $1 and $10,000.' }
  return { ok: true, value: Math.round(n * 100) }
}

export function parseNewExperiment(fields: {
  hypothesis: string
  variable: string
  primaryMetric: string
  minSpend: string
  notes: string
  arms: Array<{ choice: string; label: string }>
}): ParseResult<NewExperimentInput> {
  const hypothesis = fields.hypothesis.trim()
  if (!hypothesis) return { ok: false, error: 'Write the hypothesis first.' }
  if (hypothesis.length > MAX_HYPOTHESIS_CHARS) return { ok: false, error: `Keep the hypothesis under ${MAX_HYPOTHESIS_CHARS} characters.` }
  if (!isExperimentVariable(fields.variable)) return { ok: false, error: 'Pick the one lever this test changes.' }
  if (!isExperimentMetric(fields.primaryMetric)) return { ok: false, error: 'Pick a primary metric.' }
  const spend = parseMinSpendDollars(fields.minSpend)
  if (!spend.ok) return spend
  const arms: AdExperimentArm[] = []
  const filled = fields.arms.filter(a => a.choice.trim() !== '')
  for (const [i, f] of filled.entries()) {
    const a = parseArmChoice(f.choice, f.label, i)
    if (!a.ok) return a
    arms.push(a.value)
  }
  const armError = validateArms(arms)
  if (armError) return { ok: false, error: armError }
  const notes = fields.notes.trim()
  return {
    ok: true,
    value: { hypothesis, variable: fields.variable, primaryMetric: fields.primaryMetric, arms, minSpendCents: spend.value, notes: notes || null },
  }
}

// ─── Readability and comparison ──────────────────────────────────────────────

export interface ArmMetrics {
  spendCents: number
  impressions: number
  leads: number
  orders: number
  netRevenueCents: number
}

export interface ArmWithMetrics {
  arm: AdExperimentArm
  metrics: ArmMetrics
}

export interface CompareContext {
  metric: AdExperimentMetric
  minSpendCents: number
  startsAt: Date | null
  endsAt: Date | null
  now: Date
}

export interface ArmReading {
  arm: AdExperimentArm
  metrics: ArmMetrics
  /** cpl and cpa in cents, roas as a ratio. null when the denominator is zero. */
  value: number | null
  readable: boolean
  /** Why it is not readable yet, joined for display. null when readable. */
  reason: string | null
}

export interface ArmComparison {
  metric: AdExperimentMetric
  days: number
  arms: ArmReading[]
  allReadable: boolean
  /** Index into arms. Set only when every arm is readable and there is no tie. */
  leaderIndex: number | null
  note: string | null
}

export function formatCents(cents: number): string {
  const dollars = cents / 100
  return `$${dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const fmtInt = (n: number) => n.toLocaleString('en-US')

/** Whole days the experiment has run, from starts_at to ends_at or now. */
export function daysRunning(startsAt: Date | null, endsAt: Date | null, now: Date): number {
  if (!startsAt) return 0
  const end = endsAt && endsAt.getTime() < now.getTime() ? endsAt : now
  return Math.max(0, Math.floor((end.getTime() - startsAt.getTime()) / 86_400_000))
}

export function metricValue(metric: AdExperimentMetric, m: ArmMetrics): number | null {
  if (metric === 'cpl') return m.leads > 0 ? Math.round(m.spendCents / m.leads) : null
  if (metric === 'cpa') return m.orders > 0 ? Math.round(m.spendCents / m.orders) : null
  return m.spendCents > 0 ? m.netRevenueCents / m.spendCents : null
}

export function formatMetric(metric: AdExperimentMetric, value: number | null): string {
  if (value == null) return 'n/a'
  if (metric === 'roas') return `${value.toFixed(2)}x`
  return formatCents(value)
}

/** The floors one arm still misses, in plain words. Empty when it clears all of them. */
export function readabilityGaps(ctx: CompareContext, m: ArmMetrics, days: number): string[] {
  const gaps: string[] = []
  if (!ctx.startsAt) return ['not started']
  if (m.spendCents < ctx.minSpendCents) gaps.push(`${formatCents(m.spendCents)} of ${formatCents(ctx.minSpendCents)} spend`)
  if (ctx.metric === 'cpl') {
    if (m.leads < FLOORS.cplLeads) gaps.push(`${fmtInt(m.leads)} of ${FLOORS.cplLeads} leads`)
    if (m.impressions < FLOORS.cplImpressions) gaps.push(`${fmtInt(m.impressions)} of ${fmtInt(FLOORS.cplImpressions)} impressions`)
  } else if (ctx.metric === 'cpa') {
    if (m.leads < FLOORS.cpaLeads) gaps.push(`${fmtInt(m.leads)} of ${FLOORS.cpaLeads} leads`)
    if (days < FLOORS.cpaDays) gaps.push(`${days} of ${FLOORS.cpaDays} days`)
  } else {
    if (m.orders < FLOORS.roasOrders) gaps.push(`${fmtInt(m.orders)} of ${FLOORS.roasOrders} orders`)
  }
  if (gaps.length === 0 && metricValue(ctx.metric, m) == null) {
    gaps.push(ctx.metric === 'cpa' ? 'no orders yet' : ctx.metric === 'cpl' ? 'no leads yet' : 'no spend yet')
  }
  return gaps
}

/**
 * Per-arm metric, readable flag and reason. leaderIndex is set only when
 * every arm is readable: lowest wins for cpl and cpa, highest for roas, and
 * an exact tie names no one. This is a reading, not a decision.
 */
export function compareArms(arms: ArmWithMetrics[], ctx: CompareContext): ArmComparison {
  const days = daysRunning(ctx.startsAt, ctx.endsAt, ctx.now)
  const readings: ArmReading[] = arms.map(({ arm, metrics }) => {
    const gaps = readabilityGaps(ctx, metrics, days)
    return {
      arm,
      metrics,
      value: metricValue(ctx.metric, metrics),
      readable: gaps.length === 0,
      reason: gaps.length ? gaps.join(', ') : null,
    }
  })
  const allReadable = readings.length >= MIN_ARMS && readings.every(r => r.readable)
  if (!allReadable) {
    const waiting = readings.filter(r => !r.readable).length
    return {
      metric: ctx.metric, days, arms: readings, allReadable, leaderIndex: null,
      note: readings.length < MIN_ARMS ? 'Fewer than two arms.' : `${waiting} of ${readings.length} arms are under the floor, so there is no leader yet.`,
    }
  }
  const better = (a: number, b: number) => (ctx.metric === 'roas' ? a > b : a < b)
  let best = 0
  let tie = false
  for (let i = 1; i < readings.length; i++) {
    const v = readings[i]!.value as number
    const bv = readings[best]!.value as number
    if (better(v, bv)) { best = i; tie = false }
    else if (v === bv) tie = true
  }
  return {
    metric: ctx.metric, days, arms: readings, allReadable,
    leaderIndex: tie ? null : best,
    note: tie ? 'Every arm is readable, but the top two are tied.' : null,
  }
}
