/**
 * Ad Studio v2 ideas and owner feedback (migration 114).
 *
 * Ideas are filed by the ads routine through POST /api/team/ad-ideas and rated
 * by the owner in /admin/ad-studio/ideas. Feedback on ideas and creatives is
 * OWNER-WRITE ONLY: the set/clear functions here are called from admin route
 * actions behind requireAdmin and never from a team-token route, or the signal
 * trains on itself (same contract as social-asset-feedback.server.ts). The
 * read functions (list, summary) back the read-only team endpoint.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, sql, type SQL } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import {
  adCreativeFeedback, adCreatives, adIdeaFeedback, adIdeas,
} from '../../db/schema'
import * as ideaReasons from '~/lib/ad-idea-feedback-reasons'
import * as creativeReasons from '~/lib/ad-creative-feedback-reasons'

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const AD_LANES = ['meta', 'google', 'microsoft', 'snap', 'adult', 'newsletter', 'owned'] as const
export type AdLane = typeof AD_LANES[number]

export const REGISTER_TIERS = ['3-4', '4-5', '6-7', '7-9', '9', '10'] as const
export type RegisterTier = typeof REGISTER_TIERS[number]

export const IDEA_STATUSES = ['proposed', 'hearted', 'rejected', 'rendered', 'archived'] as const
export type IdeaStatus = typeof IDEA_STATUSES[number]

/** Statuses an agent may set through the team endpoint. hearted and rejected come only from the owner rating. */
export const AGENT_SETTABLE_STATUSES = ['rendered', 'archived'] as const

export const BATCH_MAX = 50
export const LIST_MAX = 100
export const LIST_DEFAULT = 20

export function isAdLane(v: unknown): v is AdLane {
  return typeof v === 'string' && (AD_LANES as readonly string[]).includes(v)
}
export function isRegisterTier(v: unknown): v is RegisterTier {
  return typeof v === 'string' && (REGISTER_TIERS as readonly string[]).includes(v)
}
export function isIdeaStatus(v: unknown): v is IdeaStatus {
  return typeof v === 'string' && (IDEA_STATUSES as readonly string[]).includes(v)
}

export class AdValidationError extends Error {}

export type AdIdeaRow = typeof adIdeas.$inferSelect

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface NewIdeaInput {
  runId?: number | null
  conceptSlug: string
  lane: AdLane
  registerTier: RegisterTier
  title: string
  oneLiner?: string | null
  products: Array<{ handle: string; title?: string }>
  headlines: string[]
  body: string[]
  audience?: Record<string, unknown> | null
  destinationUrl?: string | null
  breakEven?: Record<string, unknown> | null
  policyCheck: string
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function strList(v: unknown, field: string, max: number): string[] {
  if (v == null) return []
  if (!Array.isArray(v)) throw new AdValidationError(`${field} must be an array of strings`)
  const out = v.map(x => (typeof x === 'string' ? x.trim() : '')).filter(Boolean)
  if (out.length !== v.length) throw new AdValidationError(`${field} must contain only non-empty strings`)
  return out.slice(0, max)
}

/** Validate one raw idea from the team endpoint. Throws AdValidationError with the field named. */
export function validateIdea(raw: unknown, index = 0): NewIdeaInput {
  const at = `ideas[${index}]`
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AdValidationError(`${at} must be an object`)
  const r = raw as Record<string, unknown>

  const conceptSlug = str(r['concept_slug'] ?? r['conceptSlug'])
  if (!conceptSlug || conceptSlug.length > 64) throw new AdValidationError(`${at}.concept_slug is required (max 64 chars)`)

  const lane = r['lane']
  if (!isAdLane(lane)) throw new AdValidationError(`${at}.lane must be one of ${AD_LANES.join('|')}`)

  const tier = r['register_tier'] ?? r['registerTier']
  if (!isRegisterTier(tier)) throw new AdValidationError(`${at}.register_tier must be one of ${REGISTER_TIERS.join('|')}`)

  const title = str(r['title'])
  if (!title || title.length > 160) throw new AdValidationError(`${at}.title is required (max 160 chars)`)

  const policyCheck = str(r['policy_check'] ?? r['policyCheck'])
  if (!policyCheck) throw new AdValidationError(`${at}.policy_check is required and must be non-empty`)

  const productsRaw = r['products']
  if (productsRaw != null && !Array.isArray(productsRaw)) throw new AdValidationError(`${at}.products must be an array`)
  const products = (productsRaw as unknown[] | undefined ?? []).map((p, i) => {
    if (typeof p === 'string') return { handle: p.trim() }
    if (p && typeof p === 'object' && typeof (p as Record<string, unknown>)['handle'] === 'string') {
      const o = p as Record<string, unknown>
      const handle = String(o['handle']).trim()
      const t = typeof o['title'] === 'string' ? String(o['title']).trim() : ''
      return t ? { handle, title: t } : { handle }
    }
    throw new AdValidationError(`${at}.products[${i}] must be a handle string or {handle, title?}`)
  }).filter(p => p.handle)

  const headlines = strList(r['headlines'], `${at}.headlines`, 15)
  const body = strList(r['body'], `${at}.body`, 10)

  const destinationUrl = str(r['destination_url'] ?? r['destinationUrl']) || null
  if (destinationUrl) {
    let u: URL
    try { u = new URL(destinationUrl) } catch { throw new AdValidationError(`${at}.destination_url must be an absolute URL`) }
    if (!u.searchParams.get('utm_content')) {
      throw new AdValidationError(`${at}.destination_url must carry utm_content (attribution reads orders by utm_content)`)
    }
  }

  const audience = r['audience']
  if (audience != null && (typeof audience !== 'object' || Array.isArray(audience))) throw new AdValidationError(`${at}.audience must be an object`)
  const be = r['break_even_json'] ?? r['breakEven']
  if (be != null && (typeof be !== 'object' || Array.isArray(be))) throw new AdValidationError(`${at}.break_even_json must be an object`)

  const runId = r['run_id'] ?? r['runId']
  if (runId != null && (typeof runId !== 'number' || !Number.isInteger(runId))) throw new AdValidationError(`${at}.run_id must be an integer`)

  return {
    runId: (runId as number | null | undefined) ?? null,
    conceptSlug,
    lane,
    registerTier: tier,
    title,
    oneLiner: str(r['one_liner'] ?? r['oneLiner']) || null,
    products,
    headlines,
    body,
    audience: (audience as Record<string, unknown> | null | undefined) ?? null,
    destinationUrl,
    breakEven: (be as Record<string, unknown> | null | undefined) ?? null,
    policyCheck,
  }
}

export async function createIdeas(inputs: NewIdeaInput[]): Promise<AdIdeaRow[]> {
  if (inputs.length === 0) return []
  if (inputs.length > BATCH_MAX) throw new AdValidationError(`At most ${BATCH_MAX} ideas per batch`)
  return db
    .insert(adIdeas)
    .values(inputs.map(i => ({
      runId: i.runId ?? null,
      conceptSlug: i.conceptSlug,
      lane: i.lane,
      registerTier: i.registerTier,
      title: i.title,
      oneLiner: i.oneLiner ?? null,
      products: i.products,
      headlines: i.headlines,
      body: i.body,
      audience: i.audience ?? null,
      destinationUrl: i.destinationUrl ?? null,
      breakEvenJson: i.breakEven ?? null,
      policyCheck: i.policyCheck,
    })))
    .returning()
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Set an idea's status. `actor: 'agent'` may only set rendered or archived;
 * hearted and rejected are written by the owner's rating (setIdeaFeedback) and
 * by nothing else. Returns the updated row or null when the id does not exist.
 */
export async function setIdeaStatus(id: number, status: string, actor: 'agent' | 'owner'): Promise<AdIdeaRow | null> {
  if (!Number.isInteger(id) || id <= 0) throw new AdValidationError('Bad idea id')
  if (!isIdeaStatus(status)) throw new AdValidationError(`status must be one of ${IDEA_STATUSES.join('|')}`)
  if (actor === 'agent' && !(AGENT_SETTABLE_STATUSES as readonly string[]).includes(status)) {
    throw new AdValidationError('Agents may only set status to rendered or archived. hearted and rejected come from the owner rating.')
  }
  const [row] = await db
    .update(adIdeas)
    .set({ status, updatedAt: new Date() })
    .where(eq(adIdeas.id, id))
    .returning()
  return row ?? null
}

// ---------------------------------------------------------------------------
// Feedback (owner write only)
// ---------------------------------------------------------------------------

type Kind = 'idea' | 'creative'

export type { FeedbackView } from '~/lib/ad-idea-types'
import type { FeedbackView } from '~/lib/ad-idea-types'

export interface SetFeedbackInput {
  id: number
  verdict: string
  reasons?: string[]
  note?: string | null
  ratedBy: string
}

function vocab(kind: Kind) {
  return kind === 'idea' ? ideaReasons : creativeReasons
}

/** Validates and normalises input. Throws AdValidationError on bad data. */
export function normaliseFeedbackInput(kind: Kind, input: SetFeedbackInput) {
  const v = vocab(kind)
  if (!Number.isInteger(input.id) || input.id <= 0) throw new AdValidationError(`Bad ${kind} id`)
  if (!v.isFeedbackVerdict(input.verdict)) throw new AdValidationError('Verdict must be up or down')
  const verdict = input.verdict
  const reasons = [...new Set((input.reasons ?? []).map(r => r.trim()).filter(Boolean))]
  const unknown = reasons.filter(r => !v.isReasonFor(verdict, r))
  if (unknown.length > 0) throw new AdValidationError(`Unknown reason for ${verdict}: ${unknown.join(', ')}`)
  // Keep vocabulary order so reads are stable.
  const ordered = v.FEEDBACK_REASONS[verdict].map(r => r.value).filter(x => reasons.includes(x))
  const note = (input.note ?? '').trim().slice(0, v.NOTE_MAX) || null
  const ratedBy = (input.ratedBy || 'owner').slice(0, 64)
  return { id: input.id, verdict, reasons: ordered, note, ratedBy }
}

function toView(r: { verdict: string; reasons: string[] | null; note: string | null; ratedBy: string; createdAt: Date; updatedAt: Date | null }): FeedbackView {
  return {
    verdict: r.verdict as ideaReasons.FeedbackVerdict,
    reasons: r.reasons ?? [],
    note: r.note ?? null,
    ratedBy: r.ratedBy,
    ratedAt: new Date(r.updatedAt ?? r.createdAt).toISOString(),
  }
}

/**
 * Owner-only upsert on an idea. One live verdict per idea. Also moves the idea
 * to hearted (up) or rejected (down) unless it is already rendered or archived.
 */
export async function setIdeaFeedback(input: SetFeedbackInput): Promise<FeedbackView> {
  const v = normaliseFeedbackInput('idea', input)
  const exists = await db.select({ id: adIdeas.id }).from(adIdeas).where(eq(adIdeas.id, v.id)).limit(1)
  if (exists.length === 0) throw new AdValidationError(`Idea ${v.id} not found`)
  const [row] = await db
    .insert(adIdeaFeedback)
    .values({ ideaId: v.id, verdict: v.verdict, reasons: v.reasons, note: v.note, ratedBy: v.ratedBy })
    .onConflictDoUpdate({
      target: adIdeaFeedback.ideaId,
      set: { verdict: v.verdict, reasons: v.reasons, note: v.note, ratedBy: v.ratedBy, updatedAt: new Date() },
    })
    .returning()
  if (!row) throw new Error('setIdeaFeedback: insert returned no row')
  await db
    .update(adIdeas)
    .set({ status: v.verdict === 'up' ? 'hearted' : 'rejected', updatedAt: new Date() })
    .where(and(eq(adIdeas.id, v.id), inArray(adIdeas.status, ['proposed', 'hearted', 'rejected'])))
  return toView(row)
}

/** Owner-only delete. Moves a hearted or rejected idea back to proposed. */
export async function clearIdeaFeedback(ideaId: number): Promise<boolean> {
  if (!Number.isInteger(ideaId) || ideaId <= 0) return false
  const deleted = await db.delete(adIdeaFeedback).where(eq(adIdeaFeedback.ideaId, ideaId)).returning({ id: adIdeaFeedback.id })
  await db
    .update(adIdeas)
    .set({ status: 'proposed', updatedAt: new Date() })
    .where(and(eq(adIdeas.id, ideaId), inArray(adIdeas.status, ['hearted', 'rejected'])))
  return deleted.length > 0
}

/** Owner-only upsert on a creative. One live verdict per creative. */
export async function setCreativeFeedback(input: SetFeedbackInput): Promise<FeedbackView> {
  const v = normaliseFeedbackInput('creative', input)
  const exists = await db.select({ id: adCreatives.id }).from(adCreatives).where(eq(adCreatives.id, v.id)).limit(1)
  if (exists.length === 0) throw new AdValidationError(`Creative ${v.id} not found`)
  const [row] = await db
    .insert(adCreativeFeedback)
    .values({ creativeId: v.id, verdict: v.verdict, reasons: v.reasons, note: v.note, ratedBy: v.ratedBy })
    .onConflictDoUpdate({
      target: adCreativeFeedback.creativeId,
      set: { verdict: v.verdict, reasons: v.reasons, note: v.note, ratedBy: v.ratedBy, updatedAt: new Date() },
    })
    .returning()
  if (!row) throw new Error('setCreativeFeedback: insert returned no row')
  return toView(row)
}

export async function clearCreativeFeedback(creativeId: number): Promise<boolean> {
  if (!Number.isInteger(creativeId) || creativeId <= 0) return false
  const deleted = await db.delete(adCreativeFeedback).where(eq(adCreativeFeedback.creativeId, creativeId)).returning({ id: adCreativeFeedback.id })
  return deleted.length > 0
}

/**
 * Shared handler for the admin `feedback` and `clear-feedback` intents on the
 * Ad Studio routes. Callers MUST have passed requireAdmin first.
 */
export async function handleAdFeedbackIntent(kind: Kind, form: FormData, ratedBy: string) {
  const intent = String(form.get('intent') ?? '')
  const id = Number(form.get(kind === 'idea' ? 'ideaId' : 'creativeId'))
  const verdict = String(form.get('verdict') ?? '')
  try {
    if (intent === 'clear-feedback' || verdict === 'clear') {
      if (kind === 'idea') await clearIdeaFeedback(id); else await clearCreativeFeedback(id)
      return { ok: true as const, intent: 'feedback' as const, id, feedback: null }
    }
    const reasons = String(form.get('reasons') ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const note = String(form.get('note') ?? '')
    const input = { id, verdict, reasons, note, ratedBy }
    const feedback = kind === 'idea' ? await setIdeaFeedback(input) : await setCreativeFeedback(input)
    return { ok: true as const, intent: 'feedback' as const, id, feedback }
  } catch (err) {
    if (err instanceof AdValidationError) return { ok: false as const, intent: 'feedback' as const, error: err.message }
    throw err
  }
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export type RatingFilter = ideaReasons.FeedbackFilter

export interface ListIdeasFilters {
  status?: IdeaStatus | null
  lane?: AdLane | null
  concept?: string | null
  /** Product handle, matched against ad_ideas.products[].handle. */
  product?: string | null
  rating?: RatingFilter | null
  /** created_at on or after. */
  since?: Date | null
  /** Archived ideas are hidden unless status is 'archived' or this is true. */
  includeArchived?: boolean
  /** id of the last row of the previous page (rows are ordered id descending). */
  cursor?: number | null
  limit?: number | undefined
}

export type { IdeaListItem } from '~/lib/ad-idea-types'
import type { IdeaListItem } from '~/lib/ad-idea-types'

export interface IdeaListPage {
  items: IdeaListItem[]
  /** Pass back as `cursor` for the next page; null when this is the last. */
  nextCursor: number | null
}

function ideaConds(f: ListIdeasFilters): SQL[] {
  const conds: SQL[] = []
  if (f.status) conds.push(eq(adIdeas.status, f.status))
  else if (!f.includeArchived) conds.push(ne(adIdeas.status, 'archived'))
  if (f.lane) conds.push(eq(adIdeas.lane, f.lane))
  if (f.concept) conds.push(eq(adIdeas.conceptSlug, f.concept))
  if (f.product) conds.push(sql`${adIdeas.products} @> ${JSON.stringify([{ handle: f.product }])}::jsonb`)
  if (f.since) conds.push(gte(adIdeas.createdAt, f.since))
  if (f.rating === 'loved') conds.push(eq(adIdeaFeedback.verdict, 'up'))
  if (f.rating === 'rejected') conds.push(eq(adIdeaFeedback.verdict, 'down'))
  if (f.rating === 'unrated') conds.push(isNull(adIdeaFeedback.id))
  return conds
}

export async function listIdeas(f: ListIdeasFilters = {}): Promise<IdeaListPage> {
  const limit = Math.max(1, Math.min(LIST_MAX, Math.trunc(f.limit ?? LIST_DEFAULT)))
  const conds = ideaConds(f)
  if (f.cursor) conds.push(lt(adIdeas.id, f.cursor))
  const rows = await db
    .select({
      idea: adIdeas,
      fbVerdict: adIdeaFeedback.verdict,
      fbReasons: adIdeaFeedback.reasons,
      fbNote: adIdeaFeedback.note,
      fbBy: adIdeaFeedback.ratedBy,
      fbCreated: adIdeaFeedback.createdAt,
      fbUpdated: adIdeaFeedback.updatedAt,
      creativeCount: sql<number>`(select count(*)::int from ad_creatives c where c.idea_id = ${adIdeas.id})`,
    })
    .from(adIdeas)
    .leftJoin(adIdeaFeedback, eq(adIdeaFeedback.ideaId, adIdeas.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(adIdeas.id))
    .limit(limit + 1)
  const page = rows.slice(0, limit)
  const items: IdeaListItem[] = page.map(r => ({
    id: r.idea.id,
    runId: r.idea.runId ?? null,
    conceptSlug: r.idea.conceptSlug,
    lane: r.idea.lane,
    registerTier: r.idea.registerTier,
    title: r.idea.title,
    oneLiner: r.idea.oneLiner ?? null,
    products: r.idea.products ?? [],
    headlines: r.idea.headlines ?? [],
    body: r.idea.body ?? [],
    audience: r.idea.audience ?? null,
    destinationUrl: r.idea.destinationUrl ?? null,
    breakEven: r.idea.breakEvenJson ?? null,
    policyCheck: r.idea.policyCheck,
    status: r.idea.status,
    createdAt: new Date(r.idea.createdAt).toISOString(),
    creativeCount: r.creativeCount ?? 0,
    feedback: r.fbVerdict
      ? toView({ verdict: r.fbVerdict, reasons: r.fbReasons, note: r.fbNote, ratedBy: r.fbBy ?? 'owner', createdAt: r.fbCreated ?? r.idea.createdAt, updatedAt: r.fbUpdated })
      : null,
  }))
  const last = page[page.length - 1]
  return { items, nextCursor: rows.length > limit && last ? last.idea.id : null }
}

export interface IdeaFacets {
  lanes: string[]
  concepts: string[]
  products: string[]
  /** Ideas with no owner rating that are still proposed: the "To rate" count and tab badge. */
  toRate: number
}

export async function getIdeaFacets(): Promise<IdeaFacets> {
  const [lanes, concepts, products, toRate] = await Promise.all([
    db.selectDistinct({ v: adIdeas.lane }).from(adIdeas).orderBy(asc(adIdeas.lane)),
    db.selectDistinct({ v: adIdeas.conceptSlug }).from(adIdeas).orderBy(asc(adIdeas.conceptSlug)),
    db.execute(sql`select distinct p->>'handle' as v from ad_ideas, jsonb_array_elements(products) p where p->>'handle' is not null order by 1`),
    countToRate(),
  ])
  const productRows = ((products as unknown as { rows?: Array<{ v: string }> }).rows ?? (products as unknown as Array<{ v: string }>))
  return {
    lanes: lanes.map(r => r.v),
    concepts: concepts.map(r => r.v),
    products: productRows.map(r => r.v),
    toRate,
  }
}

export async function countToRate(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(adIdeas)
    .leftJoin(adIdeaFeedback, eq(adIdeaFeedback.ideaId, adIdeas.id))
    .where(and(eq(adIdeas.status, 'proposed'), isNull(adIdeaFeedback.id)))
  return row?.n ?? 0
}

// ---------------------------------------------------------------------------
// Team read side: feedback list and summary
// ---------------------------------------------------------------------------

export const FEEDBACK_LIST_MAX = 200
export const FEEDBACK_LIST_DEFAULT = 50
export const FEEDBACK_SUMMARY_MAX = 5000

export interface AdFeedbackListOptions {
  since?: Date | null
  verdict?: ideaReasons.FeedbackVerdict | null
  kind?: 'ideas' | 'creatives' | 'both'
  limit?: number | undefined
  /** Raises the row ceiling to FEEDBACK_SUMMARY_MAX. Used by the summary rollup only. */
  rollup?: boolean
}

export interface IdeaFeedbackItem {
  ideaId: number
  conceptSlug: string
  lane: string
  registerTier: string
  title: string
  firstHeadline: string | null
  products: Array<{ handle: string; title?: string }>
  status: string
  verdict: ideaReasons.FeedbackVerdict
  reasons: string[]
  note: string | null
  ratedAt: string
}

export interface CreativeFeedbackItem {
  creativeId: number
  ideaId: number | null
  conceptSlug: string | null
  lane: string | null
  registerTier: string | null
  slogan: string | null
  format: string
  products: Array<{ handle: string; title?: string }>
  status: string
  verdict: ideaReasons.FeedbackVerdict
  reasons: string[]
  note: string | null
  ratedAt: string
}

const ideaRatedAt = sql`coalesce(${adIdeaFeedback.updatedAt}, ${adIdeaFeedback.createdAt})`
const creativeRatedAt = sql`coalesce(${adCreativeFeedback.updatedAt}, ${adCreativeFeedback.createdAt})`

/** Rated ideas and creatives, newest rating first, joined to concept, lane, products and title or slogan. */
export async function listAdFeedback(opts: AdFeedbackListOptions = {}): Promise<{
  ideas: IdeaFeedbackItem[]
  creatives: CreativeFeedbackItem[]
}> {
  const limit = Math.max(1, Math.min(opts.rollup ? FEEDBACK_SUMMARY_MAX : FEEDBACK_LIST_MAX, Math.trunc(opts.limit ?? FEEDBACK_LIST_DEFAULT)))
  const kind = opts.kind ?? 'both'

  let ideas: IdeaFeedbackItem[] = []
  if (kind !== 'creatives') {
    const conds: SQL[] = []
    if (opts.since) conds.push(gte(ideaRatedAt, opts.since))
    if (opts.verdict) conds.push(eq(adIdeaFeedback.verdict, opts.verdict))
    const rows = await db
      .select({
        ideaId: adIdeaFeedback.ideaId,
        verdict: adIdeaFeedback.verdict,
        reasons: adIdeaFeedback.reasons,
        note: adIdeaFeedback.note,
        createdAt: adIdeaFeedback.createdAt,
        updatedAt: adIdeaFeedback.updatedAt,
        conceptSlug: adIdeas.conceptSlug,
        lane: adIdeas.lane,
        registerTier: adIdeas.registerTier,
        title: adIdeas.title,
        headlines: adIdeas.headlines,
        products: adIdeas.products,
        status: adIdeas.status,
      })
      .from(adIdeaFeedback)
      .innerJoin(adIdeas, eq(adIdeas.id, adIdeaFeedback.ideaId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(ideaRatedAt))
      .limit(limit)
    ideas = rows.map(r => ({
      ideaId: r.ideaId,
      conceptSlug: r.conceptSlug,
      lane: r.lane,
      registerTier: r.registerTier,
      title: r.title,
      firstHeadline: (r.headlines ?? [])[0] ?? null,
      products: r.products ?? [],
      status: r.status,
      verdict: r.verdict as ideaReasons.FeedbackVerdict,
      reasons: r.reasons ?? [],
      note: r.note ?? null,
      ratedAt: new Date(r.updatedAt ?? r.createdAt).toISOString(),
    }))
  }

  let creatives: CreativeFeedbackItem[] = []
  if (kind !== 'ideas') {
    const conds: SQL[] = []
    if (opts.since) conds.push(gte(creativeRatedAt, opts.since))
    if (opts.verdict) conds.push(eq(adCreativeFeedback.verdict, opts.verdict))
    const rows = await db
      .select({
        creativeId: adCreativeFeedback.creativeId,
        verdict: adCreativeFeedback.verdict,
        reasons: adCreativeFeedback.reasons,
        note: adCreativeFeedback.note,
        createdAt: adCreativeFeedback.createdAt,
        updatedAt: adCreativeFeedback.updatedAt,
        ideaId: adCreatives.ideaId,
        lane: adCreatives.lane,
        registerTier: adCreatives.registerTier,
        slogan: adCreatives.slogan,
        format: adCreatives.format,
        status: adCreatives.status,
        conceptSlug: adIdeas.conceptSlug,
        products: adIdeas.products,
      })
      .from(adCreativeFeedback)
      .innerJoin(adCreatives, eq(adCreatives.id, adCreativeFeedback.creativeId))
      .leftJoin(adIdeas, eq(adIdeas.id, adCreatives.ideaId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(creativeRatedAt))
      .limit(limit)
    creatives = rows.map(r => ({
      creativeId: r.creativeId,
      ideaId: r.ideaId ?? null,
      conceptSlug: r.conceptSlug ?? null,
      lane: r.lane ?? null,
      registerTier: r.registerTier ?? null,
      slogan: r.slogan ?? null,
      format: r.format,
      products: r.products ?? [],
      status: r.status,
      verdict: r.verdict as ideaReasons.FeedbackVerdict,
      reasons: r.reasons ?? [],
      note: r.note ?? null,
      ratedAt: new Date(r.updatedAt ?? r.createdAt).toISOString(),
    }))
  }
  return { ideas, creatives }
}

export interface AdFeedbackSummarySide {
  total: number
  byVerdict: Record<ideaReasons.FeedbackVerdict, number>
  byReason: Record<ideaReasons.FeedbackVerdict, Record<string, number>>
  byLane: Record<string, { up: number; down: number }>
  byConcept: Record<string, { up: number; down: number }>
}

function emptySide(v: typeof ideaReasons | typeof creativeReasons): AdFeedbackSummarySide {
  const out: AdFeedbackSummarySide = {
    total: 0, byVerdict: { up: 0, down: 0 }, byReason: { up: {}, down: {} }, byLane: {}, byConcept: {},
  }
  for (const verdict of ['up', 'down'] as const) for (const r of v.FEEDBACK_REASONS[verdict]) out.byReason[verdict][r.value] = 0
  return out
}

function tally(side: AdFeedbackSummarySide, verdict: string, reasons: string[], lane: string | null, concept: string | null) {
  if (!ideaReasons.isFeedbackVerdict(verdict)) return
  side.total++
  side.byVerdict[verdict]++
  for (const reason of reasons) side.byReason[verdict][reason] = (side.byReason[verdict][reason] ?? 0) + 1
  if (lane) { const l = (side.byLane[lane] ??= { up: 0, down: 0 }); l[verdict]++ }
  if (concept) { const c = (side.byConcept[concept] ??= { up: 0, down: 0 }); c[verdict]++ }
}

/** Counts by verdict, reason, lane and concept for ideas and creatives, optionally since a timestamp. */
export async function summarizeAdFeedback(since?: Date | null): Promise<{
  ideas: AdFeedbackSummarySide
  creatives: AdFeedbackSummarySide
}> {
  const { ideas, creatives } = await listAdFeedback({ since: since ?? null, kind: 'both', limit: FEEDBACK_SUMMARY_MAX, rollup: true })
  const i = emptySide(ideaReasons)
  const c = emptySide(creativeReasons)
  for (const r of ideas) tally(i, r.verdict, r.reasons, r.lane, r.conceptSlug)
  for (const r of creatives) tally(c, r.verdict, r.reasons, r.lane, r.conceptSlug)
  return { ideas: i, creatives: c }
}

/** Ratings keyed by idea id, for callers that already hold ideas. */
export async function getIdeaFeedbackFor(ids: number[]): Promise<Record<number, FeedbackView>> {
  const clean = [...new Set(ids.filter(n => Number.isInteger(n) && n > 0))]
  if (clean.length === 0) return {}
  const rows = await db.select().from(adIdeaFeedback).where(inArray(adIdeaFeedback.ideaId, clean))
  const out: Record<number, FeedbackView> = {}
  for (const r of rows) out[r.ideaId] = toView(r)
  return out
}

/** v2 creatives (lane set) with no owner rating yet: the Creatives tab badge. */
export async function countCreativesToRate(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(adCreatives)
    .leftJoin(adCreativeFeedback, eq(adCreativeFeedback.creativeId, adCreatives.id))
    .where(and(sql`${adCreatives.lane} is not null`, isNull(adCreativeFeedback.id), ne(adCreatives.status, 'rejected')))
  return row?.n ?? 0
}
