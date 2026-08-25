/**
 * Social Studio v2 (Phase 3, ticket #4938): owner-side reads and writes the
 * nested /admin/socials routes share. Owner drafts, slide rows, the image
 * library listing, and the workspace counts.
 *
 * Boundaries. Phase 2 owns ingest and provenance membership
 * (`social-asset-library.server.ts`); this module only READS
 * `social_media_assets` and edits tags. Phase 4 owns eligibility and the
 * publish job; this module writes `scheduled_at` from the owner's PDT input
 * and nothing reads it here. Nothing in this file writes `review_status =
 * 'approved'` or `gate_status = 'pass'`: every owner save lands a row at
 * `draft`/`pending_review`, which is exactly the state the gate verdicts.
 */
import { db } from '~/lib/db.server'
import { socialPosts, socialMediaAssets, socialPostSlides } from '../../db/schema'
import { and, desc, eq, ilike, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { SOCIAL_PLATFORMS } from '~/lib/team-keys'
import { revertSocialPostToDraft } from '~/lib/social-publish-approve.server'
import { laWallClockToUtcIso } from '~/lib/social-schedule-ui'

export type PostRow = typeof socialPosts.$inferSelect
export type AssetRow = typeof socialMediaAssets.$inferSelect
export type SlideRow = typeof socialPostSlides.$inferSelect

// ── Workspace counts ────────────────────────────────────────────────────────

export interface StudioCounts {
  pending: number
  approved: number
  scheduled: number
  failed: number
}

export async function getStudioCounts(): Promise<StudioCounts> {
  const [row] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${socialPosts.status} = 'draft' and ${socialPosts.reviewStatus} in ('pending_review', 'needs_changes'))`,
      approved: sql<number>`count(*) filter (where ${socialPosts.status} = 'draft' and ${socialPosts.reviewStatus} = 'approved')`,
      scheduled: sql<number>`count(*) filter (where ${socialPosts.status} = 'draft' and ${socialPosts.reviewStatus} = 'approved' and coalesce(${socialPosts.scheduledAt}, ${socialPosts.scheduledFor}::timestamptz) is not null)`,
      failed: sql<number>`count(*) filter (where ${socialPosts.status} = 'failed')`,
    })
    .from(socialPosts)
  return {
    pending: Number(row?.pending ?? 0),
    approved: Number(row?.approved ?? 0),
    scheduled: Number(row?.scheduled ?? 0),
    failed: Number(row?.failed ?? 0),
  }
}

// ── Owner drafts ────────────────────────────────────────────────────────────

export interface SlideInput {
  url: string
  assetId: number | null
  altText: string
}

export interface OwnerDraftInput {
  platform: string
  caption: string
  slides: SlideInput[]
  shopifyProductId: string | null
  castSlugs: string[]
  /** YYYY-MM-DD in Los Angeles, or null to clear. */
  scheduledDate: string | null
  /** HH:MM in Los Angeles, or null for a date-only slot. */
  scheduledTime: string | null
  /** Owner note for the team, kept separate from the gate stamp. */
  feedback: string | null
}

export type OwnerDraftParse =
  | { ok: true; input: OwnerDraftInput }
  | { ok: false; error: string }

const CAPTION_MAX = 3000
const ALT_MAX = 1000

/**
 * Validate the Composer's form post. Mirrors the agents' `{op:'draft'}`
 * validation in api.team.social-post (platform allowlist, caption required, X
 * needs media) and adds the slide and schedule shapes.
 */
export function parseOwnerDraft(form: FormData): OwnerDraftParse {
  const platform = String(form.get('platform') ?? '')
  if (!(SOCIAL_PLATFORMS as readonly string[]).includes(platform)) {
    return { ok: false, error: `Platform must be one of ${SOCIAL_PLATFORMS.join(', ')}` }
  }
  const caption = String(form.get('caption') ?? '').trim()
  if (!caption) return { ok: false, error: 'Write a caption before saving' }
  if (caption.length > CAPTION_MAX) return { ok: false, error: `Caption is over ${CAPTION_MAX} characters` }

  let slides: SlideInput[] = []
  const rawSlides = form.get('slides')
  if (typeof rawSlides === 'string' && rawSlides.trim()) {
    let parsed: unknown
    try { parsed = JSON.parse(rawSlides) } catch { return { ok: false, error: 'Slides payload is not valid JSON' } }
    if (!Array.isArray(parsed)) return { ok: false, error: 'Slides payload must be a list' }
    for (const s of parsed as unknown[]) {
      if (!s || typeof s !== 'object') return { ok: false, error: 'Bad slide entry' }
      const o = s as Record<string, unknown>
      const url = typeof o['url'] === 'string' ? o['url'].trim() : ''
      if (!/^https?:\/\//.test(url)) return { ok: false, error: 'Every slide needs an https URL' }
      const assetId = typeof o['assetId'] === 'number' && Number.isInteger(o['assetId']) ? o['assetId'] : null
      const altText = typeof o['altText'] === 'string' ? o['altText'].slice(0, ALT_MAX) : ''
      slides.push({ url, assetId, altText })
    }
  }
  slides = slides.slice(0, 10)
  if (platform === 'x' && slides.length === 0) {
    return { ok: false, error: 'An X post needs at least one image; the publish gate blocks a media-less X post (owner decision 2026-08-16)' }
  }
  if (platform === 'instagram' && slides.length === 0) {
    return { ok: false, error: 'An Instagram post needs at least one image' }
  }

  const shopifyProductIdRaw = String(form.get('shopifyProductId') ?? '').trim()
  const shopifyProductId = shopifyProductIdRaw.length > 0 && shopifyProductIdRaw.length <= 60 ? shopifyProductIdRaw : null

  const castSlugs = String(form.get('castSlugs') ?? '')
    .split(',').map(s => s.trim()).filter(s => /^[a-z0-9-]{1,60}$/.test(s)).slice(0, 6)

  const scheduledDate = String(form.get('scheduledDate') ?? '').trim() || null
  if (scheduledDate && !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) return { ok: false, error: 'Schedule date must be YYYY-MM-DD' }
  const scheduledTime = String(form.get('scheduledTime') ?? '').trim() || null
  if (scheduledTime && !/^\d{2}:\d{2}$/.test(scheduledTime)) return { ok: false, error: 'Schedule time must be HH:MM' }
  if (scheduledTime && !scheduledDate) return { ok: false, error: 'A time needs a date' }

  const feedback = String(form.get('feedback') ?? '').trim() || null

  return {
    ok: true,
    input: { platform, caption, slides, shopifyProductId, castSlugs, scheduledDate, scheduledTime, feedback },
  }
}

async function replaceSlides(postId: number, slides: SlideInput[]): Promise<void> {
  await db.delete(socialPostSlides).where(eq(socialPostSlides.postId, postId))
  if (slides.length === 0) return
  await db.insert(socialPostSlides).values(
    slides.map((s, i) => ({
      postId,
      position: i,
      assetId: s.assetId,
      url: s.url,
      altText: s.altText || null,
    })),
  )
}

function scheduleColumns(input: OwnerDraftInput): { scheduledFor: string | null; scheduledAt: Date | null } {
  if (!input.scheduledDate) return { scheduledFor: null, scheduledAt: null }
  if (!input.scheduledTime) return { scheduledFor: input.scheduledDate, scheduledAt: null }
  const iso = laWallClockToUtcIso(input.scheduledDate, input.scheduledTime)
  return { scheduledFor: input.scheduledDate, scheduledAt: iso ? new Date(iso) : null }
}

/** Create an owner-composed draft. Always `draft`/`pending_review`, createdBy 'owner'. */
export async function createOwnerDraft(input: OwnerDraftInput): Promise<{ id: number }> {
  const now = new Date()
  const [row] = await db
    .insert(socialPosts)
    .values({
      platform: input.platform,
      postType: 'manual',
      tweetText: input.caption,
      mediaUrls: input.slides.map(s => s.url),
      status: 'draft',
      reviewStatus: 'pending_review',
      createdBy: 'owner',
      feedback: input.feedback,
      shopifyProductId: input.shopifyProductId,
      castSlugs: input.castSlugs,
      updatedAt: now,
      ...scheduleColumns(input),
    })
    .returning({ id: socialPosts.id })
  const id = row!.id
  await replaceSlides(id, input.slides)
  return { id }
}

export type UpdateOwnerDraftResult =
  | { ok: true; id: number }
  | { ok: false; error: string }

/**
 * Update a draft the owner is editing. Runs the revert-to-draft reset first
 * (unconditionally burning any stamp and gate columns), then writes content.
 * Owner edits are allowed on pending_review, needs_changes and approved rows;
 * rejected and posted rows are refused by the reset.
 */
export async function updateOwnerDraft(id: number, input: OwnerDraftInput): Promise<UpdateOwnerDraftResult> {
  const reset = await revertSocialPostToDraft(id)
  if (!reset.ok) return { ok: false, error: reset.error }
  await db
    .update(socialPosts)
    .set({
      platform: input.platform,
      tweetText: input.caption,
      editedText: null,
      mediaUrls: input.slides.map(s => s.url),
      shopifyProductId: input.shopifyProductId,
      castSlugs: input.castSlugs,
      feedback: input.feedback,
      updatedAt: new Date(),
      ...scheduleColumns(input),
    })
    .where(eq(socialPosts.id, id))
  await replaceSlides(id, input.slides)
  return { ok: true, id }
}

export interface ComposerPost {
  row: PostRow
  slides: Array<{ id: number | null; url: string; assetId: number | null; altText: string; aspect: string | null }>
}

/** Load a post for the Composer; rows without slide rows derive from mediaUrls. */
export async function loadComposerPost(id: number): Promise<ComposerPost | null> {
  const [row] = await db.select().from(socialPosts).where(eq(socialPosts.id, id)).limit(1)
  if (!row) return null
  const slideRows = await db
    .select({
      id: socialPostSlides.id,
      url: socialPostSlides.url,
      assetId: socialPostSlides.assetId,
      altText: socialPostSlides.altText,
      aspect: socialMediaAssets.aspect,
    })
    .from(socialPostSlides)
    .leftJoin(socialMediaAssets, eq(socialMediaAssets.id, socialPostSlides.assetId))
    .where(eq(socialPostSlides.postId, id))
    .orderBy(socialPostSlides.position)
  const slides = slideRows.length > 0
    ? slideRows.map(s => ({ id: s.id, url: s.url, assetId: s.assetId, altText: s.altText ?? '', aspect: s.aspect ?? null }))
    : (row.mediaUrls ?? []).map(url => ({ id: null, url, assetId: null, altText: '', aspect: null }))
  return { row, slides }
}

// ── Library ─────────────────────────────────────────────────────────────────

import { LIBRARY_PAGE } from '~/components/admin/social/LibraryGrid'
export { LIBRARY_PAGE }

export interface LibraryFilters {
  q: string
  tag: string | null
  product: string | null
  cast: string | null
  archetype: string | null
  source: string | null
  picked: boolean | null
  /** Asset id to page before (newest first). */
  before: number | null
  /**
   * false (the default, `?archived` absent or `0`) shows only the active
   * library: `archived_at IS NULL`. true (`?archived=1`) shows only archived
   * assets, reachable via the "Archived" filter chip. This is the whole
   * point of ticket #5426: an archived asset must disappear from BOTH the
   * library grid and the Composer picker (both read through
   * `listLibraryAssets`/this parser, see `admin.socials.library.tsx` and
   * `libraryPickerUrl` in `LibraryPickerModal.tsx`), so getting this default
   * right here is what makes archiving do anything at all.
   */
  archived: boolean
}

export function parseLibraryFilters(url: URL): LibraryFilters {
  const p = url.searchParams
  const before = Number(p.get('before'))
  const pickedRaw = p.get('picked')
  return {
    q: (p.get('q') ?? '').trim().slice(0, 120),
    tag: p.get('tag')?.trim() || null,
    product: p.get('product')?.trim() || null,
    cast: p.get('cast')?.trim() || null,
    archetype: p.get('archetype')?.trim() || null,
    source: p.get('source')?.trim() || null,
    picked: pickedRaw === '1' ? true : pickedRaw === '0' ? false : null,
    before: Number.isInteger(before) && before > 0 ? before : null,
    archived: p.get('archived') === '1',
  }
}

export interface LibraryPage {
  assets: AssetRow[]
  nextBefore: number | null
  facets: { tags: string[]; products: string[]; casts: string[]; archetypes: string[]; sources: string[] }
}

export async function listLibraryAssets(f: LibraryFilters): Promise<LibraryPage> {
  const conds: SQL[] = []
  if (f.q) {
    const like = `%${f.q.replace(/[%_]/g, m => `\\${m}`)}%`
    conds.push(or(
      ilike(socialMediaAssets.prompt, like),
      ilike(socialMediaAssets.productHandle, like),
      sql`exists (select 1 from jsonb_array_elements_text(coalesce(${socialMediaAssets.tags}, '[]'::jsonb)) t where t ilike ${like})`,
    )!)
  }
  if (f.tag) conds.push(sql`coalesce(${socialMediaAssets.tags}, '[]'::jsonb) ? ${f.tag}`)
  if (f.product) conds.push(eq(socialMediaAssets.productHandle, f.product))
  if (f.cast) conds.push(sql`coalesce(${socialMediaAssets.castSlugs}, '[]'::jsonb) ? ${f.cast}`)
  if (f.archetype) conds.push(eq(socialMediaAssets.archetype, f.archetype))
  if (f.source) conds.push(eq(socialMediaAssets.source, f.source))
  if (f.picked != null) conds.push(eq(socialMediaAssets.isPicked, f.picked))
  if (f.before) conds.push(lt(socialMediaAssets.id, f.before))
  // Always applied, not conditional on a truthy value: the default
  // (archived=false) must actively exclude archived rows, which is the
  // entire point of the archive feature (#5426).
  conds.push(f.archived ? isNotNull(socialMediaAssets.archivedAt) : isNull(socialMediaAssets.archivedAt))

  const rows = await db
    .select()
    .from(socialMediaAssets)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(socialMediaAssets.id))
    .limit(LIBRARY_PAGE + 1)
  const assets = rows.slice(0, LIBRARY_PAGE)
  const nextBefore = rows.length > LIBRARY_PAGE ? (assets[assets.length - 1]?.id ?? null) : null

  const [facetRow] = await db
    .select({
      tags: sql<string[]>`coalesce((select array_agg(distinct t) from ${socialMediaAssets} a, jsonb_array_elements_text(coalesce(a.tags, '[]'::jsonb)) t), '{}')`,
      products: sql<string[]>`coalesce((select array_agg(distinct product_handle) from ${socialMediaAssets} where product_handle is not null), '{}')`,
      casts: sql<string[]>`coalesce((select array_agg(distinct c) from ${socialMediaAssets} a, jsonb_array_elements_text(coalesce(a.cast_slugs, '[]'::jsonb)) c), '{}')`,
      archetypes: sql<string[]>`coalesce((select array_agg(distinct archetype) from ${socialMediaAssets} where archetype is not null), '{}')`,
      sources: sql<string[]>`coalesce((select array_agg(distinct source) from ${socialMediaAssets}), '{}')`,
    })
    .from(sql`(select 1) as one`)
  const sorted = (xs: string[] | null | undefined) => [...(xs ?? [])].sort()
  return {
    assets,
    nextBefore,
    facets: {
      tags: sorted(facetRow?.tags),
      products: sorted(facetRow?.products),
      casts: sorted(facetRow?.casts),
      archetypes: sorted(facetRow?.archetypes),
      sources: sorted(facetRow?.sources),
    },
  }
}

export async function getLibraryAsset(id: number): Promise<AssetRow | null> {
  const [row] = await db.select().from(socialMediaAssets).where(eq(socialMediaAssets.id, id)).limit(1)
  return row ?? null
}

export async function getLibraryAssetsByIds(ids: number[]): Promise<AssetRow[]> {
  if (ids.length === 0) return []
  return db.select().from(socialMediaAssets).where(inArray(socialMediaAssets.id, ids))
}

export interface AssetUsage {
  postId: number
  platform: string
  status: string
  reviewStatus: string
  via: 'slide' | 'media_urls'
}

/** Every post that carries this asset, via slide rows or a legacy media_urls entry. */
export async function getAssetUsage(asset: AssetRow): Promise<AssetUsage[]> {
  const viaSlides = await db
    .select({ postId: socialPosts.id, platform: socialPosts.platform, status: socialPosts.status, reviewStatus: socialPosts.reviewStatus })
    .from(socialPostSlides)
    .innerJoin(socialPosts, eq(socialPosts.id, socialPostSlides.postId))
    .where(or(eq(socialPostSlides.assetId, asset.id), eq(socialPostSlides.url, asset.url)))
  const viaMedia = await db
    .select({ postId: socialPosts.id, platform: socialPosts.platform, status: socialPosts.status, reviewStatus: socialPosts.reviewStatus })
    .from(socialPosts)
    .where(sql`${socialPosts.mediaUrls}::jsonb ? ${asset.url}`)
  const seen = new Set<number>()
  const out: AssetUsage[] = []
  for (const r of viaSlides) { if (!seen.has(r.postId)) { seen.add(r.postId); out.push({ ...r, via: 'slide' }) } }
  for (const r of viaMedia) { if (!seen.has(r.postId)) { seen.add(r.postId); out.push({ ...r, via: 'media_urls' }) } }
  return out.sort((a, b) => b.postId - a.postId)
}

// ── Archive lifecycle (ticket #5426, reversible half only) ─────────────────
//
// Archiving only ever sets `archivedAt`/`archivedBy`. There is no delete
// path anywhere in this module: the publish gate's provenance check
// (`isLibraryMember`, social-asset-library.server.ts) reads by row
// existence, so a deleted row would fail provenance retroactively on a post
// that already passed the gate. The irreversible purge is ticket #5427,
// deliberately not built here.

/**
 * Post states (raw `social_posts.status` / `review_status`) that make an
 * asset's current usage "still live": the post is or may still be published
 * with this asset, so archiving now would pull it out from under an active
 * draft, review queue entry, approval or schedule. `publishing` is the
 * in-flight moment itself; `pending_review` and `approved` cover a `draft`
 * status row on its way to going out (an approved row may or may not be
 * scheduled yet — both still need the asset). `posted` is deliberately NOT
 * blocking: once live, the platform has already fetched and hosts its own
 * copy at container-create time, so the library's copy stops being
 * load-bearing for that post (still warned about, for provenance/reuse).
 */
const ARCHIVE_BLOCKING_REVIEW_STATUSES = new Set(['pending_review', 'approved'])

export interface ArchiveEligibility {
  eligible: boolean
  /** Set when `eligible` is false: names the blocking post, per the ticket. */
  reason: string | null
  /** Set when `eligible` is true but a `posted` usage exists. */
  warning: string | null
}

/**
 * Pure predicate, no DB access: unit-testable directly on a list of usage
 * rows (see `getAssetUsage`). Refuses archiving when any usage is a post
 * that is draft/pending_review/approved/scheduled/publishing; the refusal
 * names the blocking post id and platform. Allows, with a warning, when the
 * only usage is a `posted` row.
 */
export function assessArchiveEligibility(usage: readonly AssetUsage[]): ArchiveEligibility {
  const blocker = usage.find(u =>
    u.status === 'publishing' ||
    (u.status !== 'posted' && u.status !== 'failed' && u.status !== 'deleted' &&
      ARCHIVE_BLOCKING_REVIEW_STATUSES.has(u.reviewStatus)),
  )
  if (blocker) {
    const stateLabel = blocker.status === 'publishing'
      ? 'publishing'
      : blocker.reviewStatus === 'approved' ? 'approved (may be scheduled)' : 'pending review'
    return {
      eligible: false,
      reason: `Post #${blocker.postId} (${blocker.platform}) is ${stateLabel}. Archive is refused while any post using this asset is draft, pending review, approved, scheduled or publishing.`,
      warning: null,
    }
  }
  const posted = usage.find(u => u.status === 'posted')
  return {
    eligible: true,
    reason: null,
    warning: posted
      ? `Used by post #${posted.postId} (${posted.platform}), already posted. The platform fetched and hosts its own copy at publish time, so archiving the library copy does not affect the live post.`
      : null,
  }
}

export interface ArchiveOutcome {
  archived: number[]
  refused: Array<{ id: number; reason: string }>
  warnings: Array<{ id: number; warning: string }>
}

/**
 * Archive each id whose current usage passes `assessArchiveEligibility`.
 * Never deletes a row; sets `archivedAt`/`archivedBy` only. Ids that do not
 * resolve to a row are reported in `refused` too, so a caller iterating the
 * result never silently drops one.
 */
export async function archiveAssets(ids: readonly number[], by: string): Promise<ArchiveOutcome> {
  const uniqueIds = [...new Set(ids)].filter(n => Number.isInteger(n) && n > 0)
  const out: ArchiveOutcome = { archived: [], refused: [], warnings: [] }
  if (uniqueIds.length === 0) return out
  const assets = await getLibraryAssetsByIds(uniqueIds)
  const found = new Set(assets.map(a => a.id))
  for (const id of uniqueIds) {
    if (!found.has(id)) out.refused.push({ id, reason: 'Asset not found' })
  }
  for (const asset of assets) {
    const usage = await getAssetUsage(asset)
    const verdict = assessArchiveEligibility(usage)
    if (!verdict.eligible) {
      out.refused.push({ id: asset.id, reason: verdict.reason! })
      continue
    }
    if (verdict.warning) out.warnings.push({ id: asset.id, warning: verdict.warning })
    await db.update(socialMediaAssets)
      .set({ archivedAt: new Date(), archivedBy: by.slice(0, 60), updatedAt: new Date() })
      .where(eq(socialMediaAssets.id, asset.id))
    out.archived.push(asset.id)
  }
  return out
}

/** Reversal: clears `archivedAt`/`archivedBy`. No eligibility check needed. */
export async function unarchiveAssets(ids: readonly number[]): Promise<number> {
  const uniqueIds = [...new Set(ids)].filter(n => Number.isInteger(n) && n > 0)
  if (uniqueIds.length === 0) return 0
  const rows = await db.update(socialMediaAssets)
    .set({ archivedAt: null, archivedBy: null, updatedAt: new Date() })
    .where(inArray(socialMediaAssets.id, uniqueIds))
    .returning({ id: socialMediaAssets.id })
  return rows.length
}

// ── Auto-archive sweep (ticket #5426(f)) ────────────────────────────────────
//
// At ~110 new library images/day and an 82% orphan rate, manual curation
// alone will not keep the grid browsable. This sweep archives unpicked
// candidates the team never acted on, past a tunable age threshold. It only
// READS `social_library_auto_archive_days` via `getPipelineSetting`
// (feed-processor.server.ts, not a protected path); nothing here writes to
// `pipeline_settings` or touches `team.server.ts` / `team-keys.ts` /
// `settings.server.ts`.

const AUTO_ARCHIVE_SETTING_KEY = 'social_library_auto_archive_days'
/** Conservative default: 60 days of browsability for an unpicked candidate
 *  before the sweep archives it. Tunable on `/admin/homepage-team`-style
 *  settings surfaces once one exposes this key; until then, edit the row
 *  directly. */
const AUTO_ARCHIVE_DEFAULT_DAYS = 60
/** One sweep tick never touches more than this many rows. */
const AUTO_ARCHIVE_BATCH_LIMIT = 500

export async function autoArchiveThresholdDays(): Promise<number> {
  const { getPipelineSetting } = await import('~/lib/feed-processor.server')
  const raw = await getPipelineSetting(AUTO_ARCHIVE_SETTING_KEY)
  const n = raw != null ? parseInt(raw, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : AUTO_ARCHIVE_DEFAULT_DAYS
}

export interface AutoArchiveSweepResult extends ArchiveOutcome {
  thresholdDays: number
  candidateCount: number
}

/**
 * Archive every unpicked, not-yet-archived asset older than the threshold.
 * Runs through the same `archiveAssets` usage guard as a manual archive: an
 * unpicked row can still carry a legacy `media_urls` attachment without
 * `is_picked` ever having been set, so the defensive check still applies.
 */
export async function runSocialAssetAutoArchiveSweep(): Promise<AutoArchiveSweepResult> {
  const thresholdDays = await autoArchiveThresholdDays()
  const cutoff = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000)
  const rows = await db
    .select({ id: socialMediaAssets.id })
    .from(socialMediaAssets)
    .where(and(
      eq(socialMediaAssets.isPicked, false),
      isNull(socialMediaAssets.archivedAt),
      lt(socialMediaAssets.createdAt, cutoff),
    ))
    .limit(AUTO_ARCHIVE_BATCH_LIMIT)
  const ids = rows.map(r => r.id)
  if (ids.length === 0) return { thresholdDays, candidateCount: 0, archived: [], refused: [], warnings: [] }
  const outcome = await archiveAssets(ids, 'auto')
  return { thresholdDays, candidateCount: ids.length, ...outcome }
}

const TAG_RE = /^[a-z0-9][a-z0-9 _-]{0,39}$/

export function normalizeTag(raw: string): string | null {
  const t = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  return TAG_RE.test(t) ? t : null
}

export async function addAssetTags(ids: number[], tag: string): Promise<number> {
  const t = normalizeTag(tag)
  if (!t || ids.length === 0) return 0
  const rows = await db.select({ id: socialMediaAssets.id, tags: socialMediaAssets.tags })
    .from(socialMediaAssets).where(inArray(socialMediaAssets.id, ids))
  let n = 0
  for (const r of rows) {
    const tags = r.tags ?? []
    if (tags.includes(t)) continue
    await db.update(socialMediaAssets).set({ tags: [...tags, t], updatedAt: new Date() }).where(eq(socialMediaAssets.id, r.id))
    n++
  }
  return n
}

export async function removeAssetTag(id: number, tag: string): Promise<boolean> {
  const t = normalizeTag(tag)
  if (!t) return false
  const [r] = await db.select({ tags: socialMediaAssets.tags }).from(socialMediaAssets).where(eq(socialMediaAssets.id, id)).limit(1)
  if (!r) return false
  await db.update(socialMediaAssets)
    .set({ tags: (r.tags ?? []).filter(x => x !== t), updatedAt: new Date() })
    .where(eq(socialMediaAssets.id, id))
  return true
}

/** Gate-less helper for the shell: rows still unscheduled, for the queue header. */
export async function countUnscheduledApproved(): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)` })
    .from(socialPosts)
    .where(and(eq(socialPosts.status, 'draft'), eq(socialPosts.reviewStatus, 'approved'), isNull(socialPosts.scheduledAt), isNull(socialPosts.scheduledFor)))
  return Number(r?.n ?? 0)
}
