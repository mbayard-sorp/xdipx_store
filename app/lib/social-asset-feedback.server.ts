/**
 * Owner feedback on social library images (migration 104, ticket #11551).
 *
 * Storage and read seam for the heart / thumbs-down verdicts the owner leaves
 * in /admin/socials/library. The social routine reads it at run start (via
 * POST /api/team/social-asset-feedback) to waste fewer generations.
 *
 * OWNER-WRITE ONLY. `setAssetFeedback`/`clearAssetFeedback` are called only
 * from the admin library routes behind `requireAdmin`, never from a team-token
 * route, or the signal trains on itself. The read functions carry no such risk.
 */
import { and, desc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { socialAssetFeedback, socialMediaAssets } from '../../db/schema'
import {
  FEEDBACK_REASONS, NOTE_MAX, isFeedbackVerdict, isReasonFor, type FeedbackVerdict,
} from '~/lib/social-asset-feedback-reasons'

export type AssetFeedbackRow = typeof socialAssetFeedback.$inferSelect

export class FeedbackValidationError extends Error {}

export interface SetAssetFeedbackInput {
  assetId: number
  verdict: string
  reasons?: string[]
  note?: string | null
  ratedBy: string
}

/** Validates and normalises input. Throws FeedbackValidationError on bad data. */
export function normaliseFeedbackInput(input: SetAssetFeedbackInput) {
  if (!Number.isInteger(input.assetId) || input.assetId <= 0) throw new FeedbackValidationError('Bad asset id')
  if (!isFeedbackVerdict(input.verdict)) throw new FeedbackValidationError('Verdict must be up or down')
  const verdict: FeedbackVerdict = input.verdict
  const reasons = [...new Set((input.reasons ?? []).map(r => r.trim()).filter(Boolean))]
  const unknown = reasons.filter(r => !isReasonFor(verdict, r))
  if (unknown.length > 0) {
    throw new FeedbackValidationError(`Unknown reason for ${verdict}: ${unknown.join(', ')}`)
  }
  // Keep vocabulary order so reads are stable.
  const ordered = FEEDBACK_REASONS[verdict].map(r => r.value).filter(v => reasons.includes(v))
  const note = (input.note ?? '').trim().slice(0, NOTE_MAX) || null
  const ratedBy = (input.ratedBy || 'owner').slice(0, 60)
  return { assetId: input.assetId, verdict, reasons: ordered, note, ratedBy }
}

/** Owner-only upsert. One live verdict per asset; a second write replaces the first. */
export async function setAssetFeedback(input: SetAssetFeedbackInput): Promise<AssetFeedbackRow> {
  const v = normaliseFeedbackInput(input)
  const [row] = await db
    .insert(socialAssetFeedback)
    .values(v)
    .onConflictDoUpdate({
      target: socialAssetFeedback.assetId,
      set: { verdict: v.verdict, reasons: v.reasons, note: v.note, ratedBy: v.ratedBy, updatedAt: new Date() },
    })
    .returning()
  if (!row) throw new Error('setAssetFeedback: insert returned no row')
  return row
}

/** Owner-only delete. Returns true when a verdict existed and was removed. */
export async function clearAssetFeedback(assetId: number): Promise<boolean> {
  if (!Number.isInteger(assetId) || assetId <= 0) return false
  const deleted = await db
    .delete(socialAssetFeedback)
    .where(eq(socialAssetFeedback.assetId, assetId))
    .returning({ id: socialAssetFeedback.id })
  return deleted.length > 0
}

export interface AssetFeedbackView {
  verdict: FeedbackVerdict
  reasons: string[]
  note: string | null
  ratedBy: string
  ratedAt: string
}

function toView(r: AssetFeedbackRow): AssetFeedbackView {
  return {
    verdict: r.verdict as FeedbackVerdict,
    reasons: r.reasons ?? [],
    note: r.note ?? null,
    ratedBy: r.ratedBy,
    ratedAt: new Date(r.updatedAt ?? r.createdAt).toISOString(),
  }
}

/** Feedback keyed by asset id for the given ids. Assets with no verdict are absent. */
export async function getFeedbackForAssets(assetIds: number[]): Promise<Record<number, AssetFeedbackView>> {
  const ids = [...new Set(assetIds.filter(n => Number.isInteger(n) && n > 0))]
  if (ids.length === 0) return {}
  const rows = await db.select().from(socialAssetFeedback).where(inArray(socialAssetFeedback.assetId, ids))
  const out: Record<number, AssetFeedbackView> = {}
  for (const r of rows) out[r.assetId] = toView(r)
  return out
}

export const FEEDBACK_LIST_MAX = 200
export const FEEDBACK_LIST_DEFAULT = 50

export interface ListFeedbackOptions {
  since?: Date | null
  verdict?: FeedbackVerdict | null
  limit?: number | undefined
}

export interface FeedbackListItem {
  assetId: number
  url: string
  provider: string | null
  model: string | null
  // TODO(#11548): add providerRequestId once social_media_assets carries the
  // provider_request_id column. It does not exist in db/schema.ts yet.
  prompt: string | null
  negativePrompt: string | null
  castSlugs: string[]
  productHandle: string | null
  tags: string[]
  generationBatchId: string | null
  isPicked: boolean
  postId: number | null
  verdict: FeedbackVerdict
  reasons: string[]
  note: string | null
  ratedAt: string
}

function sinceCond(since: Date | null | undefined): SQL | undefined {
  if (!since) return undefined
  return gte(sql`coalesce(${socialAssetFeedback.updatedAt}, ${socialAssetFeedback.createdAt})`, since)
}

/** Rated assets, newest rating first, joined to the library row for prompt and provenance. */
export async function listAssetFeedback(opts: ListFeedbackOptions = {}): Promise<FeedbackListItem[]> {
  const limit = Math.max(1, Math.min(FEEDBACK_LIST_MAX, Math.trunc(opts.limit ?? FEEDBACK_LIST_DEFAULT)))
  const conds: SQL[] = []
  const s = sinceCond(opts.since)
  if (s) conds.push(s)
  if (opts.verdict) conds.push(eq(socialAssetFeedback.verdict, opts.verdict))
  const rows = await db
    .select({
      assetId: socialAssetFeedback.assetId,
      verdict: socialAssetFeedback.verdict,
      reasons: socialAssetFeedback.reasons,
      note: socialAssetFeedback.note,
      createdAt: socialAssetFeedback.createdAt,
      updatedAt: socialAssetFeedback.updatedAt,
      url: socialMediaAssets.url,
      provider: socialMediaAssets.provider,
      model: socialMediaAssets.model,
      prompt: socialMediaAssets.prompt,
      negativePrompt: socialMediaAssets.negativePrompt,
      castSlugs: socialMediaAssets.castSlugs,
      productHandle: socialMediaAssets.productHandle,
      tags: socialMediaAssets.tags,
      generationBatchId: socialMediaAssets.generationBatchId,
      isPicked: socialMediaAssets.isPicked,
      postId: socialMediaAssets.postId,
    })
    .from(socialAssetFeedback)
    .innerJoin(socialMediaAssets, eq(socialMediaAssets.id, socialAssetFeedback.assetId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(sql`coalesce(${socialAssetFeedback.updatedAt}, ${socialAssetFeedback.createdAt})`))
    .limit(limit)
  return rows.map(r => ({
    assetId: r.assetId,
    url: r.url,
    provider: r.provider ?? null,
    model: r.model ?? null,
    prompt: r.prompt ?? null,
    negativePrompt: r.negativePrompt ?? null,
    castSlugs: r.castSlugs ?? [],
    productHandle: r.productHandle ?? null,
    tags: r.tags ?? [],
    generationBatchId: r.generationBatchId ?? null,
    isPicked: r.isPicked,
    postId: r.postId ?? null,
    verdict: r.verdict as FeedbackVerdict,
    reasons: r.reasons ?? [],
    note: r.note ?? null,
    ratedAt: new Date(r.updatedAt ?? r.createdAt).toISOString(),
  }))
}

export interface FeedbackSummary {
  total: number
  byVerdict: Record<FeedbackVerdict, number>
  byReason: Record<FeedbackVerdict, Record<string, number>>
}

/** Counts by verdict and by reason (per verdict), optionally since a timestamp. */
export async function summarizeAssetFeedback(since?: Date | null): Promise<FeedbackSummary> {
  const rows = await db
    .select({ verdict: socialAssetFeedback.verdict, reasons: socialAssetFeedback.reasons })
    .from(socialAssetFeedback)
    .where(sinceCond(since))
  const out: FeedbackSummary = { total: 0, byVerdict: { up: 0, down: 0 }, byReason: { up: {}, down: {} } }
  for (const v of ['up', 'down'] as const) for (const r of FEEDBACK_REASONS[v]) out.byReason[v][r.value] = 0
  for (const r of rows) {
    if (!isFeedbackVerdict(r.verdict)) continue
    out.total++
    out.byVerdict[r.verdict]++
    for (const reason of r.reasons ?? []) {
      out.byReason[r.verdict][reason] = (out.byReason[r.verdict][reason] ?? 0) + 1
    }
  }
  return out
}

/**
 * Shared handler for the admin `feedback` intent on both library routes.
 * Callers MUST have passed requireAdmin first. verdict=clear removes the row.
 */
export async function handleFeedbackIntent(assetId: number, form: FormData, ratedBy: string) {
  const verdict = String(form.get('verdict') ?? '')
  if (verdict === 'clear') {
    await clearAssetFeedback(assetId)
    return { ok: true as const, intent: 'feedback' as const, assetId, feedback: null }
  }
  const reasons = String(form.get('reasons') ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const note = String(form.get('note') ?? '')
  try {
    const row = await setAssetFeedback({ assetId, verdict, reasons, note, ratedBy })
    return { ok: true as const, intent: 'feedback' as const, assetId, feedback: toView(row) }
  } catch (err) {
    if (err instanceof FeedbackValidationError) return { ok: false as const, intent: 'feedback' as const, error: err.message }
    throw err
  }
}
