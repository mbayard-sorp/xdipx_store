/**
 * Backfill the Social Studio image library (`social_media_assets`) from every
 * generated social image that already lives in Shopify Files.
 *
 * Before migration 084 the generators rehosted each candidate to Shopify Files
 * and kept nothing else: no prompt, no provider, no index row. This script
 * walks Shopify Files for the three generated-social name shapes, uploads each
 * binary to Sanity (ADR-013: Sanity holds binaries, Neon indexes), and writes
 * one library row per file with the provenance that can still be recovered:
 *
 *   social-{handle}-{archetype}-{mood}-{yyyymmdd}[-{aspect}][-{n}].jpg
 *       handle, archetype, mood (as a tag), aspect, date
 *   ig-*.jpg                        grandfathered 2026-08-09 names (4:5, cast)
 *   instagram-image[_uuid].jpg      pre-#770 generator output, shape unknown
 *
 * Provider is inferred, not read: the spend log (api_token_log, feature
 * 'social-images') never carried a filename, so the rule is the model
 * timeline it does carry. Cast composites are fal in every era; every other
 * archetype is fal before 2026-08-16 and Atlas (seedream-4.5-edit) from then
 * on (PR #692). Rows carry the tag `provider-inferred` so the Studio never
 * presents the guess as a fact.
 *
 * Pick state comes from `social_posts.media_urls`: a file some post uses is
 * `is_picked` with that post's id (lowest id when several).
 *
 * Idempotent: a file whose bare url already has a row is skipped, so re-runs
 * only add what is missing.
 *
 * Homepage imagery (`--source homepage`, or `all`) is the second source: the
 * homepage team's generated art already lives in Sanity under
 * `homepage-{blockKey}[-{run}]-{epoch}.png` (homepage-media.server.ts), so the
 * row points at the existing Sanity asset (no re-upload) under its Sanity CDN
 * url, tagged `homepage` plus the block key. Provider is inferred by date the
 * same way; archetype and product stay null (these are not product shots).
 *
 * Usage:
 *   npx tsx scripts/backfill-social-library.ts --dry-run [--source social|homepage|all]
 *   npx tsx scripts/backfill-social-library.ts [--limit N] [--source social|homepage|all]
 */

import 'dotenv/config'
import { adminGraphQL, getProductByHandle } from '../app/lib/shopify.server'
import {
  ingestSocialAsset,
  isLibraryMember,
  stripUrlQuery,
} from '../app/lib/social-asset-library.server'
import { SOCIAL_ARCHETYPES, socialAssetAspect, type SocialArchetype } from '../app/lib/social-media.server'

const DRY_RUN = process.argv.includes('--dry-run')
const limitArg = process.argv.indexOf('--limit')
const LIMIT = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity
const sourceArg = process.argv.indexOf('--source')
const SOURCE = (sourceArg >= 0 ? process.argv[sourceArg + 1] : 'social') as 'social' | 'homepage' | 'all'

/** Atlas became the primary still-image provider on this date (PR #692). */
const ATLAS_CUTOVER = new Date('2026-08-16T00:00:00Z')

interface FileNode {
  id: string
  createdAt: string
  alt?: string | null
  image?: { url: string; width?: number | null; height?: number | null } | null
  url?: string
}

async function listFiles(query: string): Promise<FileNode[]> {
  const all: FileNode[] = []
  let after: string | null = null
  for (let page = 0; page < 100; page++) {
    const r = await adminGraphQL<{
      files: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: FileNode[] }
    }>(`
      query SocialLibraryFiles($after: String, $q: String) {
        files(first: 250, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id createdAt alt
            ... on MediaImage { image { url width height } }
            ... on GenericFile { url }
          }
        }
      }
    `, { after, q: query })
    all.push(...r.files.nodes)
    if (!r.files.pageInfo.hasNextPage) break
    after = r.files.pageInfo.endCursor
  }
  return all
}

function fileUrl(n: FileNode): string | null {
  return n.image?.url ?? n.url ?? null
}

function basename(url: string): string {
  return stripUrlQuery(url).split('/').pop() ?? ''
}

interface Parsed {
  handle?: string
  archetype?: SocialArchetype
  mood?: string
  date?: string
  shape: 'social' | 'ig' | 'legacy'
}

/**
 * social-{handle}-{archetype}-{mood}-{yyyymmdd}[-{aspect}][-{n}].jpg
 * The handle may itself contain hyphens, so the archetype is the LAST
 * archetype token before the date segment (a handle like
 * `wand-education-broad-head` must not be cut at a word that happens to
 * match). Shopify de-dupes by appending `_uuid`; that is stripped first.
 */
function parseName(name: string): Parsed {
  const stem = name.replace(/\.[a-z0-9]+$/i, '').replace(/_[0-9a-f-]{36}$/i, '').toLowerCase()
  if (stem.startsWith('ig-')) return { shape: 'ig', archetype: 'cast' }
  if (!stem.startsWith('social-')) return { shape: 'legacy' }
  const segs = stem.slice('social-'.length).split('-')
  let dateIdx = -1
  for (let i = segs.length - 1; i >= 0; i--) {
    if (/^\d{8}$/.test(segs[i]!)) { dateIdx = i; break }
  }
  if (dateIdx < 0) return { shape: 'social' }
  let archIdx = -1
  for (let i = dateIdx - 1; i >= 0; i--) {
    if ((SOCIAL_ARCHETYPES as readonly string[]).includes(segs[i]!)) { archIdx = i; break }
  }
  if (archIdx <= 0) return { shape: 'social', date: segs[dateIdx] }
  return {
    shape: 'social',
    handle: segs.slice(0, archIdx).join('-'),
    archetype: segs[archIdx] as SocialArchetype,
    mood: segs.slice(archIdx + 1, dateIdx).join('-') || undefined,
    date: segs[dateIdx],
  }
}

function inferProvider(archetype: SocialArchetype | undefined, createdAt: Date): { provider: string; model?: string } {
  if (archetype === 'cast') return { provider: 'fal' }
  if (createdAt >= ATLAS_CUTOVER) return { provider: 'atlas', model: 'atlas/seedream-4.5-edit' }
  return { provider: 'fal' }
}

async function loadPostsByUrl(): Promise<Map<string, number>> {
  const { db } = await import('../app/lib/db.server')
  const { socialPosts } = await import('../db/schema')
  const { isNotNull, asc } = await import('drizzle-orm')
  const rows = await db
    .select({ id: socialPosts.id, mediaUrls: socialPosts.mediaUrls })
    .from(socialPosts)
    .where(isNotNull(socialPosts.mediaUrls))
    .orderBy(asc(socialPosts.id))
  const map = new Map<string, number>()
  for (const r of rows) {
    for (const u of r.mediaUrls ?? []) {
      const bare = stripUrlQuery(u)
      if (bare && !map.has(bare)) map.set(bare, r.id)
    }
  }
  return map
}

interface SanityAssetRow {
  _id: string
  originalFilename: string | null
  url: string
  size: number | null
  mimeType: string | null
  _createdAt: string
  w: number | null
  h: number | null
}

/** homepage-{blockKey}[-{run}]-{epoch}.png -> block key and optional run token. */
function parseHomepageName(name: string): { blockKey?: string; run?: string } {
  const stem = name.replace(/\.[a-z0-9]+$/i, '')
  const m = /^homepage-([A-Za-z0-9]+)(?:-(.+?))?-(\d{10,})$/.exec(stem)
  if (!m) return {}
  return { blockKey: m[1], ...(m[2] ? { run: m[2] } : {}) }
}

async function backfillHomepage(): Promise<{ done: number; skipped: number; failed: number }> {
  const { getClient } = await import('../app/lib/sanity.server')
  const client = getClient(true)
  if (!client) throw new Error('Sanity not configured')
  const assets = await client.fetch<SanityAssetRow[]>(
    `*[_type == "sanity.imageAsset" && originalFilename match "homepage-*"]{
      _id, originalFilename, url, size, mimeType, _createdAt,
      "w": metadata.dimensions.width, "h": metadata.dimensions.height
    } | order(_createdAt asc)`,
  )
  console.log(`Sanity: ${assets.length} homepage-* image assets`)
  let done = 0, skipped = 0, failed = 0
  for (const a of assets) {
    if (done >= LIMIT) break
    const name = a.originalFilename ?? basename(a.url)
    const bare = stripUrlQuery(a.url)
    if (await isLibraryMember(bare)) { skipped++; continue }
    const createdAt = new Date(a._createdAt)
    const { provider, model } = inferProvider(undefined, createdAt)
    const { blockKey, run } = parseHomepageName(name)
    const tags = ['backfill', 'provider-inferred', 'homepage']
    if (blockKey) tags.push(blockKey)
    if (run) tags.push(run)
    tags.push(a._createdAt.slice(0, 7))
    const summary = `${name} -> ${provider}${blockKey ? ' ' + blockKey : ''}`
    if (DRY_RUN) { console.log('[dry] ' + summary); done++; continue }
    try {
      const row = await ingestSocialAsset(
        {
          sourceUrl: a.url,
          filename: name,
          ...(a.mimeType ? { contentType: a.mimeType } : {}),
          url: a.url,
          ...(a.w && a.h ? { width: a.w, height: a.h } : {}),
          ...(a.size ? { bytes: a.size } : {}),
          source: 'generated',
          provider,
          ...(model ? { model } : {}),
          tags,
          createdBy: 'backfill',
        },
        {
          // The binary is already in Sanity: point the row at it rather than
          // uploading a second copy. Dimensions and size come from the asset
          // document, so the buffer is never needed.
          uploadToSanity: async () => ({ assetId: a._id, url: a.url }),
          fetchBuffer: async () => Buffer.alloc(0),
        },
      )
      done++
      console.log(`[ok ${row.id}] ${summary}`)
    } catch (err) {
      failed++
      console.error(`[fail] ${name}:`, err instanceof Error ? err.message : err)
    }
  }
  return { done, skipped, failed }
}

async function main() {
  if (SOURCE === 'homepage' || SOURCE === 'all') {
    const r = await backfillHomepage()
    console.log(`homepage: ${DRY_RUN ? 'would ingest' : 'ingested'} ${r.done}, skipped ${r.skipped} already indexed, failed ${r.failed}\n`)
    if (SOURCE === 'homepage') return
  }
  const [social, ig, legacy] = await Promise.all([
    listFiles('filename:social-*'),
    listFiles('filename:ig-*'),
    listFiles('filename:instagram-*'),
  ])
  const files = [...social, ...ig, ...legacy]
    .filter(n => fileUrl(n))
    .filter(n => /^(social-|ig-|instagram-image)/i.test(basename(fileUrl(n)!)))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  console.log(`Shopify Files: ${social.length} social-*, ${ig.length} ig-*, ${legacy.length} instagram-* (${files.length} candidates)`)

  const postByUrl = await loadPostsByUrl()
  const handleCache = new Map<string, string | null>()
  async function productIdFor(handle: string | undefined): Promise<string | null> {
    if (!handle) return null
    if (handleCache.has(handle)) return handleCache.get(handle)!
    let id: string | null = null
    try { id = (await getProductByHandle(handle))?.id ?? null } catch { id = null }
    handleCache.set(handle, id)
    return id
  }

  let done = 0, skipped = 0, failed = 0
  for (const n of files) {
    if (done >= LIMIT) break
    const url = fileUrl(n)!
    const bare = stripUrlQuery(url)
    const name = basename(url)
    if (await isLibraryMember(bare)) { skipped++; continue }

    const parsed = parseName(name)
    const createdAt = new Date(n.createdAt)
    const { provider, model } = inferProvider(parsed.archetype, createdAt)
    const productId = await productIdFor(parsed.handle)
    const postId = postByUrl.get(bare)
    const tags = ['backfill', 'provider-inferred']
    if (parsed.mood) tags.push(parsed.mood)
    if (parsed.shape === 'legacy') tags.push('legacy-name')
    if (parsed.date) tags.push(parsed.date.slice(0, 4) + '-' + parsed.date.slice(4, 6))

    const summary = `${name} -> ${provider}${parsed.archetype ? ' ' + parsed.archetype : ''}${parsed.handle ? ' ' + parsed.handle + (productId ? '' : ' (no product)') : ''}${postId ? ' picked by #' + postId : ''}`
    if (DRY_RUN) { console.log('[dry] ' + summary); done++; continue }

    try {
      const row = await ingestSocialAsset({
        sourceUrl: url,
        filename: name,
        contentType: 'image/jpeg',
        url,
        ...(n.image?.width && n.image?.height ? { width: n.image.width, height: n.image.height } : {}),
        ...(parsed.shape !== 'legacy' ? { aspect: socialAssetAspect(name) } : {}),
        source: 'generated',
        provider,
        ...(model ? { model } : {}),
        ...(parsed.archetype ? { archetype: parsed.archetype } : {}),
        // The handle is kept even when Shopify no longer knows it (archived
        // product): the filter still groups the shoot, and the id stays null.
        ...(parsed.handle ? { productHandle: parsed.handle } : {}),
        ...(productId ? { shopifyProductId: productId } : {}),
        tags,
        ...(postId ? { isPicked: true, postId } : {}),
        createdBy: 'backfill',
      })
      done++
      console.log(`[ok ${row.id}] ${summary}`)
    } catch (err) {
      failed++
      console.error(`[fail] ${name}:`, err instanceof Error ? err.message : err)
    }
  }
  console.log(`\n${DRY_RUN ? 'would ingest' : 'ingested'} ${done}, skipped ${skipped} already indexed, failed ${failed}`)
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1) })
