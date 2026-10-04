/**
 * Read side of the Creatives tab (Ad Studio v2 PR-C): filtered, cursor-paged
 * list of v2 creatives (rows with an idea) joined to their idea, asset and the
 * owner's rating, plus the filter facets.
 */
import { and, asc, desc, eq, isNull, lt, sql, type SQL } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { adCreativeFeedback, adCreatives, adIdeas, mediaAssets } from '../../db/schema'
import { isGatesJson } from '~/lib/ad-render-rules'
import { isPlaceholderUrl } from '~/lib/ad-render.server'
import { CREATIVE_PAGE, CREATIVE_PAGE_MAX, type CreativeListItem, type CreativeView, type ExportStateView } from '~/lib/ad-creative-types'
import type { FeedbackFilter } from '~/lib/ad-creative-feedback-reasons'

export interface ListCreativesFilters {
  view?: CreativeView
  /** The Blocked chip: lists blocked rows only and overrides the view. */
  blocked?: boolean
  lane?: string | null
  concept?: string | null
  product?: string | null
  rating?: FeedbackFilter | null
  format?: string | null
  ideaId?: number | null
  cursor?: number | null
  limit?: number
}

function conds(f: ListCreativesFilters): SQL[] {
  const c: SQL[] = [sql`${adCreatives.ideaId} is not null`]
  if (f.blocked) c.push(eq(adCreatives.status, 'blocked'))
  else c.push(sql`${adCreatives.status} <> 'blocked'`)
  if (!f.blocked) {
    if (f.view === 'to-rate') {
      c.push(eq(adCreatives.status, 'draft'))
      c.push(sql`${mediaAssets.blobUrl} not like 'pending:%'`)
      c.push(isNull(adCreativeFeedback.id))
    } else if (f.view === 'hearted') {
      c.push(eq(adCreativeFeedback.verdict, 'up'))
    } else if (f.view === 'exported') {
      c.push(sql`(${adCreatives.status} = 'pushed' or ${adCreatives.exportPayload}->>'exportedAt' is not null)`)
    }
  }
  if (f.lane) c.push(eq(adCreatives.lane, f.lane))
  if (f.concept) c.push(eq(adIdeas.conceptSlug, f.concept))
  if (f.product) c.push(sql`${adIdeas.products} @> ${JSON.stringify([{ handle: f.product }])}::jsonb`)
  if (f.format) c.push(eq(adCreatives.format, f.format))
  if (f.ideaId) c.push(eq(adCreatives.ideaId, f.ideaId))
  if (f.rating === 'loved') c.push(eq(adCreativeFeedback.verdict, 'up'))
  if (f.rating === 'rejected') c.push(eq(adCreativeFeedback.verdict, 'down'))
  if (f.rating === 'unrated') c.push(isNull(adCreativeFeedback.id))
  if (f.cursor) c.push(lt(adCreatives.id, f.cursor))
  return c
}

function exportView(
  row: typeof adCreatives.$inferSelect,
  assetUrl: string | null,
  rated: 'up' | 'down' | null,
  renderState: string | null,
  renderError: string | null,
): ExportStateView {
  if (row.status === 'failed') return { kind: 'failed', message: renderError ?? 'The render failed.' }
  if (row.status === 'rendering') return { kind: 'building' }
  const payload = row.exportPayload as Record<string, unknown> | null
  const exportErr = payload && typeof payload['exportError'] === 'string' ? (payload['exportError'] as string) : null
  if (exportErr) return { kind: 'failed', message: exportErr }
  if (payload && payload['exporting'] === true) return { kind: 'building' }
  if (renderState === 'queued' || !assetUrl) {
    // Text-only Search rows have no stored file and no exporter yet.
    return { kind: row.format === 'text' ? 'none' : 'not-built' }
  }
  if (rated === 'up') return { kind: 'ready', downloadUrl: assetUrl }
  return { kind: 'not-built' }
}

export async function listCreatives(f: ListCreativesFilters = {}): Promise<{ items: CreativeListItem[]; nextCursor: number | null }> {
  const limit = Math.max(1, Math.min(CREATIVE_PAGE_MAX, Math.trunc(f.limit ?? CREATIVE_PAGE)))
  const rows = await db
    .select({
      c: adCreatives,
      url: mediaAssets.blobUrl,
      title: adIdeas.title,
      concept: adIdeas.conceptSlug,
      headlines: adIdeas.headlines,
      products: adIdeas.products,
      fbVerdict: adCreativeFeedback.verdict,
      fbReasons: adCreativeFeedback.reasons,
      fbNote: adCreativeFeedback.note,
      fbBy: adCreativeFeedback.ratedBy,
      fbCreated: adCreativeFeedback.createdAt,
      fbUpdated: adCreativeFeedback.updatedAt,
    })
    .from(adCreatives)
    .innerJoin(mediaAssets, eq(mediaAssets.id, adCreatives.assetId))
    .leftJoin(adIdeas, eq(adIdeas.id, adCreatives.ideaId))
    .leftJoin(adCreativeFeedback, eq(adCreativeFeedback.creativeId, adCreatives.id))
    .where(and(...conds(f)))
    .orderBy(desc(adCreatives.id))
    .limit(limit + 1)
  const page = rows.slice(0, limit)
  const items: CreativeListItem[] = page.map(r => {
    const assetUrl = isPlaceholderUrl(r.url) ? null : r.url
    const render = (r.c.renderJson as Record<string, unknown> | null) ?? null
    const renderState = typeof render?.['state'] === 'string' ? (render['state'] as string) : null
    const renderError = typeof render?.['error'] === 'string' ? (render['error'] as string) : null
    const skipped = typeof render?.['skipped'] === 'string' ? (render['skipped'] as string) : null
    const verdict = r.fbVerdict === 'up' || r.fbVerdict === 'down' ? r.fbVerdict : null
    return {
      id: r.c.id,
      ideaId: r.c.ideaId ?? null,
      ideaTitle: r.title ?? null,
      conceptSlug: r.concept ?? null,
      lane: r.c.lane ?? 'owned',
      registerTier: r.c.registerTier ?? '',
      format: r.c.format,
      width: r.c.width ?? null,
      height: r.c.height ?? null,
      slogan: r.c.slogan ?? null,
      headlines: r.headlines ?? [],
      status: r.c.status,
      assetUrl,
      products: r.products ?? [],
      gates: isGatesJson(r.c.gatesJson) ? r.c.gatesJson : null,
      renderState,
      renderNote: renderError ?? (skipped ? `Skipped: ${skipped}` : null),
      export: exportView(r.c, assetUrl, verdict, renderState, renderError),
      feedback: verdict
        ? {
            verdict,
            reasons: r.fbReasons ?? [],
            note: r.fbNote ?? null,
            ratedBy: r.fbBy ?? 'owner',
            ratedAt: new Date(r.fbUpdated ?? r.fbCreated ?? r.c.createdAt).toISOString(),
          }
        : null,
      createdAt: new Date(r.c.createdAt).toISOString(),
    }
  })
  const last = page[page.length - 1]
  return { items, nextCursor: rows.length > limit && last ? last.c.id : null }
}

export interface CreativeFacets {
  lanes: string[]
  concepts: string[]
  products: string[]
  formats: string[]
  blockedCount: number
}

export async function getCreativeFacets(): Promise<CreativeFacets> {
  const [lanes, concepts, formats, products, blocked] = await Promise.all([
    db.selectDistinct({ v: adCreatives.lane }).from(adCreatives).where(sql`${adCreatives.ideaId} is not null`).orderBy(asc(adCreatives.lane)),
    db.selectDistinct({ v: adIdeas.conceptSlug }).from(adCreatives).innerJoin(adIdeas, eq(adIdeas.id, adCreatives.ideaId)).orderBy(asc(adIdeas.conceptSlug)),
    db.selectDistinct({ v: adCreatives.format }).from(adCreatives).where(sql`${adCreatives.ideaId} is not null`).orderBy(asc(adCreatives.format)),
    db.execute(sql`select distinct p->>'handle' as v from ad_creatives c join ad_ideas i on i.id = c.idea_id, jsonb_array_elements(i.products) p where p->>'handle' is not null order by 1`),
    db.select({ n: sql<number>`count(*)::int` }).from(adCreatives).where(and(sql`${adCreatives.ideaId} is not null`, eq(adCreatives.status, 'blocked'))),
  ])
  const productRows = ((products as unknown as { rows?: Array<{ v: string }> }).rows ?? (products as unknown as Array<{ v: string }>))
  return {
    lanes: lanes.map(r => r.v).filter((v): v is string => !!v),
    concepts: concepts.map(r => r.v),
    products: productRows.map(r => r.v),
    formats: formats.map(r => r.v),
    blockedCount: blocked[0]?.n ?? 0,
  }
}
