/**
 * Draft-time supply of the four scene axes (ticket #10479).
 *
 * THE FAILURE THIS CLOSES. Migration 093 added `scene_location` and no caller
 * ever sent it. The diagnosed cause was "no document told the agents to send
 * it", so migration 099 added three more nullable columns plus documentation
 * telling the agents to send all four. Verified in production 2026-09-20: 281
 * `social_posts` rows all time, 0 carrying any of the four. The same fix
 * failed the same way twice, and the reason is structural rather than
 * clerical: the obligation lived in prose addressed to a language model, and
 * prose to an LLM is a suggestion with a compliance rate, never a constraint.
 *
 * THE PRINCIPLE. Never ask a model to re-assert a value a machine already
 * has. `cropScale` is already sent to and enum-validated by the generation
 * route; the body zone, contact mode and location are chosen in the same
 * breath, by the same caller, before a single dollar is spent. So they are
 * stamped onto the `social_media_assets` row at ingest (as `axis:<key>=<v>`
 * tags, see `social-scene-vocab.ts`), and the draft resolves them back by
 * URL. The draft-time field survives as a CONFIRMATION that overrides, not as
 * a memory test that fails.
 *
 * WHY NO 400. A draft arriving without an axis is not refused here. The image
 * it carries has already been generated and billed; refusing the draft
 * destroys inventory rather than a request, and the caller has no cheaper
 * retry than re-generating the frame. Enum-refusal belongs at generation
 * (pre-spend, one retry, already in place); backfill belongs here. Flipping
 * any axis to required is a separate, evidence-gated ticket (#10482) and
 * explicitly not this one.
 *
 * SEQUENCING, the whole lesson of 093 and 099: measure, then supply, then
 * require. This module is the supply step.
 */

import { sql } from 'drizzle-orm'
import { socialPosts } from '../../db/schema'
import { mergeSceneAxes, parseSceneAxisTags, type SceneAxes } from './social-scene-vocab'

export interface SceneAxisDeps {
  /**
   * `tags` of every `social_media_assets` row indexing one of these URLs,
   * newest row last (insertion order is fine: the merge below takes the first
   * value it finds per axis).
   */
  loadAssetTags?: (urls: string[]) => Promise<string[][]>
  /** Fills only the NULL axis columns of an existing post row. */
  patchPostAxes?: (postId: number, axes: SceneAxes) => Promise<void>
}

const defaultDeps: Required<SceneAxisDeps> = {
  loadAssetTags: async (urls) => {
    const { db } = await import('./db.server')
    const { socialMediaAssets } = await import('../../db/schema')
    const { inArray } = await import('drizzle-orm')
    const { stripUrlQuery } = await import('./social-asset-library.server')
    const bare = urls.map(stripUrlQuery).filter(Boolean)
    if (bare.length === 0) return []
    const rows = await db
      .select({ tags: socialMediaAssets.tags })
      .from(socialMediaAssets)
      // Shopify appends `?v=<epoch>` to CDN urls, so both sides are compared
      // bare, exactly like `findIdsByUrls` in social-asset-library.server.ts.
      .where(inArray(sql`split_part(split_part(${socialMediaAssets.url}, '?', 1), '#', 1)`, bare))
      .orderBy(socialMediaAssets.id)
    return rows.map(r => (Array.isArray(r.tags) ? r.tags : []))
  },
  patchPostAxes: async (postId, axes) => {
    const { db } = await import('./db.server')
    const { eq } = await import('drizzle-orm')
    // COALESCE, so a value already on the row always wins. A deduped draft
    // must never overwrite the axes the first draft recorded; it only fills
    // the holes.
    const set: Record<string, unknown> = {}
    if (axes.bodyZone) set['bodyZone'] = sql`coalesce(${socialPosts.bodyZone}, ${axes.bodyZone})`
    if (axes.contactMode) set['contactMode'] = sql`coalesce(${socialPosts.contactMode}, ${axes.contactMode})`
    if (axes.cropScale) set['cropScale'] = sql`coalesce(${socialPosts.cropScale}, ${axes.cropScale})`
    if (axes.sceneLocation) set['sceneLocation'] = sql`coalesce(${socialPosts.sceneLocation}, ${axes.sceneLocation})`
    if (Object.keys(set).length === 0) return
    await db.update(socialPosts).set(set).where(eq(socialPosts.id, postId))
  },
}

function resolve(deps?: SceneAxisDeps): Required<SceneAxisDeps> {
  return { ...defaultDeps, ...(deps ?? {}) }
}

/**
 * The axes to persist for a draft: what the caller supplied, with every
 * omission filled from the asset row(s) its media URLs resolve to.
 *
 * Non-fatal by contract, exactly like `tryMarkPickedByUrls`: a Neon hiccup
 * here must never fail a draft that is otherwise valid, so a failed lookup
 * degrades to "supplied only" and logs.
 */
export async function resolveDraftSceneAxes(
  supplied: SceneAxes,
  mediaUrls: readonly string[] | null | undefined,
  deps?: SceneAxisDeps,
): Promise<SceneAxes> {
  const urls = (mediaUrls ?? []).filter(u => typeof u === 'string' && u.length > 0)
  if (urls.length === 0) return mergeSceneAxes(supplied, {})
  try {
    const tagLists = await resolve(deps).loadAssetTags([...urls])
    // First asset that names an axis wins it. A carousel whose slides
    // disagree on the zone is a real editorial question, not something this
    // function should silently average; the first slide is the frame the
    // caption is written to.
    let fallback: SceneAxes = {}
    for (const tags of tagLists) {
      fallback = mergeSceneAxes(fallback, parseSceneAxisTags(tags))
    }
    return mergeSceneAxes(supplied, fallback)
  } catch (err) {
    console.error('[social-scene-axes] asset lookup failed (non-fatal), using supplied axes only', err)
    return mergeSceneAxes(supplied, {})
  }
}

/**
 * Fill the NULL axis columns of an EXISTING post row. This is the deduped
 * branch of the draft op, the easy one to miss: `createDraftSocialPost`
 * returns an already-open row's id without inserting, so a draft that
 * deduped would otherwise leave that row's axes null forever even though the
 * asset knows all four. Non-fatal for the same reason as above.
 */
export async function backfillPostSceneAxes(
  postId: number,
  axes: SceneAxes,
  deps?: SceneAxisDeps,
): Promise<void> {
  if (!axes.bodyZone && !axes.contactMode && !axes.cropScale && !axes.sceneLocation) return
  try {
    await resolve(deps).patchPostAxes(postId, axes)
  } catch (err) {
    console.error(`[social-scene-axes] backfill failed (non-fatal) for post ${postId}`, err)
  }
}
