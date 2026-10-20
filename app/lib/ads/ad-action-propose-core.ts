/**
 * The pure half of POST /api/team/ad-action (plan §5 "Buyer write path",
 * §9.4, §9.6; ticket #16433, phase 5c). No database and no platform here:
 * the route loads the mirror row and the day's counts, and these functions
 * decide what the ledger row looks like.
 *
 * A team-token proposal can only ever land as status proposed. Approval is
 * an admin-session action in the console, never this path.
 */
import { classifyTier } from './channels/apply-core'
import type { AdActionTier, AdActionVerb } from './ledger-core'
import type { EntityLevel } from './channels/types'

/** The sentence every refused approval or apply attempt gets, word for word. */
export const PROPOSE_ONLY_MESSAGE = 'This route proposes only; approval happens in the console.'

/** Verbs a team proposal may carry. halt_all is the rules engine's alone. */
export const PROPOSABLE_VERBS = ['pause', 'resume', 'set_budget', 'update_creative'] as const
export type ProposableVerb = typeof PROPOSABLE_VERBS[number] & AdActionVerb

export const PROPOSAL_SOURCES = ['paid-media-buyer', 'allocator'] as const
export type ProposalSource = typeof PROPOSAL_SOURCES[number]

/** Plan §9.4: at most 3 one-tap cards a day from the buyer. */
export const BUYER_DAILY_PROPOSAL_CAP = 3
/** A proposal nobody tapped in 48 hours expires. */
export const PROPOSAL_TTL_MS = 48 * 60 * 60 * 1000
/** op:'list' looks back this far. */
export const LIST_LOOKBACK_DAYS = 7

const LEVELS: readonly EntityLevel[] = ['campaign', 'adset', 'ad', 'creative']

export function proposedByFor(source: ProposalSource): string {
  return `agent:${source}`
}

export class ProposalValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProposalValidationError'
  }
}

export interface ProposalInput {
  platform: string
  level: EntityLevel
  externalId: string
  verb: ProposableVerb
  params: Record<string, unknown>
  reason: string
  expectedContributionCents: number | null
  source: ProposalSource
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function positiveInt(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v > 0
}

/**
 * True when the body tries to set anything the console owns: a status other
 * than proposed, or an approver or applier.
 */
export function triesToSkipApproval(body: Record<string, unknown>): boolean {
  const status = body['status']
  if (status !== undefined && status !== null && status !== 'proposed') return true
  for (const k of ['approvedBy', 'approved_by', 'appliedBy', 'applied_by', 'approvedAt', 'appliedAt']) {
    if (body[k] !== undefined && body[k] !== null) return true
  }
  return false
}

/**
 * Validates a propose body and returns it in one shape. Throws
 * ProposalValidationError with a message the caller can read and fix.
 */
export function parseProposal(body: Record<string, unknown>): ProposalInput {
  const platform = body['platform']
  if (typeof platform !== 'string' || platform.trim() === '') {
    throw new ProposalValidationError('platform is required, for example "meta"')
  }
  const target = body['target']
  if (!isPlainObject(target)) throw new ProposalValidationError('target must be { level, externalId }')
  const level = target['level']
  if (typeof level !== 'string' || !(LEVELS as readonly string[]).includes(level)) {
    throw new ProposalValidationError(`target.level must be one of ${LEVELS.join('|')}`)
  }
  const externalId = target['externalId']
  if (typeof externalId !== 'string' || externalId.trim() === '') {
    throw new ProposalValidationError('target.externalId is required')
  }
  const verb = body['verb']
  if (typeof verb !== 'string' || !(PROPOSABLE_VERBS as readonly string[]).includes(verb)) {
    throw new ProposalValidationError(`verb must be one of ${PROPOSABLE_VERBS.join('|')}`)
  }
  const rawParams = body['params'] ?? {}
  if (!isPlainObject(rawParams)) throw new ProposalValidationError('params must be an object')
  const source = body['source']
  if (typeof source !== 'string' || !(PROPOSAL_SOURCES as readonly string[]).includes(source)) {
    throw new ProposalValidationError(`source must be one of ${PROPOSAL_SOURCES.join('|')}`)
  }
  const reason = body['reason']
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new ProposalValidationError('reason is required: one plain line the owner reads on the card')
  }
  const ec = body['expectedContributionCents']
  if (ec !== undefined && ec !== null && !(typeof ec === 'number' && Number.isInteger(ec))) {
    throw new ProposalValidationError('expectedContributionCents must be an integer when present')
  }

  const params = paramsFor(verb as ProposableVerb, level as EntityLevel, rawParams)
  return {
    platform: platform.trim(),
    level: level as EntityLevel,
    externalId: externalId.trim(),
    verb: verb as ProposableVerb,
    params,
    reason: reason.trim(),
    expectedContributionCents: typeof ec === 'number' ? ec : null,
    source: source as ProposalSource,
  }
}

/**
 * The params each verb carries, and nothing else, so the idempotency key
 * hashes the change itself and not whatever extra the caller sent.
 */
function paramsFor(verb: ProposableVerb, level: EntityLevel, p: Record<string, unknown>): Record<string, unknown> {
  switch (verb) {
    case 'pause':
    case 'resume':
      if (level === 'creative') throw new ProposalValidationError(`${verb} targets a campaign, ad set or ad`)
      return {}
    case 'set_budget': {
      if (level !== 'campaign' && level !== 'adset') {
        throw new ProposalValidationError('set_budget targets a campaign or an ad set, whichever owns the budget')
      }
      const daily = p['dailyBudgetCents']
      const lifetime = p['lifetimeBudgetCents']
      if (daily != null && !positiveInt(daily)) throw new ProposalValidationError('params.dailyBudgetCents must be a positive integer')
      if (lifetime != null && !positiveInt(lifetime)) throw new ProposalValidationError('params.lifetimeBudgetCents must be a positive integer')
      if (daily == null && lifetime == null) {
        throw new ProposalValidationError('set_budget needs params.dailyBudgetCents or params.lifetimeBudgetCents')
      }
      return daily != null ? { dailyBudgetCents: daily } : { lifetimeBudgetCents: lifetime }
    }
    case 'update_creative': {
      if (level !== 'ad') throw new ProposalValidationError('update_creative targets an ad')
      const creativeId = p['creativeId']
      if (!positiveInt(creativeId)) throw new ProposalValidationError('update_creative needs params.creativeId, the Ad Studio creative id')
      return { creativeId }
    }
  }
}

/** The slice of an ad_platform_entities row a proposal reads. */
export interface MirrorTarget {
  platform: string
  level: EntityLevel
  externalId: string
  status: string | null
  effectiveStatus: string | null
  dailyBudgetCents: number | null
  lifetimeBudgetCents: number | null
  creativeId: number | null
}

export interface BeforeAfter {
  before: Record<string, unknown>
  after: Record<string, unknown>
}

/**
 * before is the mirror as it stands; after is the mirror with params
 * applied. expectedContribution7dCents rides on after so the console can
 * rank the day's cards (§9.4) without it changing the idempotency key.
 */
export function beforeAfterFor(input: ProposalInput, row: MirrorTarget): BeforeAfter {
  const extra = input.expectedContributionCents != null
    ? { expectedContribution7dCents: input.expectedContributionCents }
    : {}
  switch (input.verb) {
    case 'pause':
    case 'resume': {
      const before = { status: row.status, effectiveStatus: row.effectiveStatus }
      return { before, after: { status: input.verb === 'pause' ? 'PAUSED' : 'ACTIVE', ...extra } }
    }
    case 'set_budget': {
      const before = { dailyBudgetCents: row.dailyBudgetCents, lifetimeBudgetCents: row.lifetimeBudgetCents }
      return { before, after: { ...before, ...input.params, ...extra } }
    }
    case 'update_creative': {
      const before = { creativeId: row.creativeId }
      return { before, after: { creativeId: input.params['creativeId'], ...extra } }
    }
  }
}

/**
 * The classifier's tier, raised to approve when it said auto. The owner asked
 * that every buyer proposal be one tap (plan §5), so a team proposal is never
 * tier auto, a pause included. owner stays owner.
 */
export function proposalTier(verb: ProposableVerb, params: Record<string, unknown>, before: Record<string, unknown>): AdActionTier {
  const tier = classifyTier(verb, params, before)
  return tier === 'auto' ? 'approve' : tier
}

/** YYYY-MM-DD in UTC, the day granularity of the idempotency key and the cap. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10)
}

export function startOfUtcDay(now: Date): Date {
  return new Date(`${utcDay(now)}T00:00:00.000Z`)
}
