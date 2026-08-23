/**
 * Social image library: ingest + membership (Social Studio v2 Phase 2, #4937).
 *
 * ADR-013 decision 1: Sanity is the binary store, Neon is the index. Every
 * generated candidate (winners AND losers) and every owner upload goes through
 * `uploadBufferToSanity` and gets one `social_media_assets` row carrying the
 * provenance the Studio needs to search, filter and reuse it. ADR-013
 * decision 5: the publish gate's `image-provenance` check becomes "has a
 * library row", which is strictly stronger than the filename-prefix check it
 * replaces after a burn-in cycle.
 *
 * Which url a row stores. The generators rehost every candidate to Shopify
 * Files, and the Shopify CDN url is what lands in `social_posts.media_urls`
 * and what the gate sees. So when a candidate was ALSO rehosted to Shopify,
 * the row's `url` is the Shopify CDN url (the one the gate must match) and the
 * Sanity side is carried by `sanityAssetId`: a Sanity asset's CDN url is
 * derivable from its asset document, so nothing is lost and no new column is
 * needed (migration 084 is frozen). When there is no Shopify rehost (a bare
 * ingest), `url` is the Sanity CDN url.
 *
 * Non-fatal by contract. Callers in the generation path use
 * `tryIngestSocialAsset`, which swallows and logs. A Sanity or Neon outage
 * must never break image generation; the worst case is a missing library row,
 * which the burn-in prefix check still covers until the prefix check retires.
 *
 * Membership ignores query strings: Shopify appends `?v=<epoch>` to CDN urls
 * and a row written from the upload response may or may not carry it.
 */

import { inArray, sql } from 'drizzle-orm'
import { socialMediaAssets } from '../../db/schema'

export type SocialAssetSource = 'generated' | 'upload' | 'video_poster'

export type SocialMediaAssetRow = typeof socialMediaAssets.$inferSelect
export type SocialMediaAssetInsert = typeof socialMediaAssets.$inferInsert

export interface IngestSocialAssetInput {
  /** Image bytes. Either this or `sourceUrl` is required; the buffer wins. */
  buffer?: Buffer
  /** Fetched to a Buffer when `buffer` is absent. */
  sourceUrl?: string
  filename: string
  contentType?: string
  /**
   * The url the row indexes under. Pass the Shopify Files CDN url when the
   * candidate was rehosted there (see the file header); omit to index under
   * the Sanity CDN url.
   */
  url?: string
  width?: number
  height?: number
  aspect?: string
  bytes?: number
  source: SocialAssetSource
  provider?: string
  model?: string
  prompt?: string
  negativePrompt?: string
  archetype?: string
  productHandle?: string
  shopifyProductId?: string
  castSlugs?: string[]
  tags?: string[]
  generationBatchId?: string
  isPicked?: boolean
  postId?: number
  createdBy?: string
}

/**
 * Injectable seams so the unit tests need neither Sanity nor a database.
 * Defaults are the real implementations, loaded lazily so importing this
 * module never drags the Sanity client or the Neon driver into a test.
 */
export interface SocialAssetLibraryDeps {
  uploadToSanity?: (buffer: Buffer, filename: string, contentType?: string) => Promise<{ assetId: string; url: string }>
  insertAsset?: (row: SocialMediaAssetInsert) => Promise<SocialMediaAssetRow>
  findByUrl?: (url: string) => Promise<boolean>
  findIdsByUrls?: (urls: string[]) => Promise<{ id: number; url: string }[]>
  setPicked?: (assetIds: number[], postId: number) => Promise<void>
  fetchBuffer?: (url: string) => Promise<Buffer>
  readDimensions?: (buffer: Buffer) => Promise<{ width: number; height: number } | null>
}

/** Drop `?query` and `#fragment`; Shopify appends `?v=<epoch>` to every CDN url. */
export function stripUrlQuery(url: string): string {
  return (url ?? '').split(/[?#]/)[0] ?? ''
}

const defaultDeps: Required<SocialAssetLibraryDeps> = {
  uploadToSanity: async (buffer, filename, contentType) => {
    const { uploadBufferToSanity } = await import('./sanity.server')
    return uploadBufferToSanity(buffer, filename, contentType)
  },
  insertAsset: async (row) => {
    const { db } = await import('./db.server')
    const [inserted] = await db.insert(socialMediaAssets).values(row).returning()
    if (!inserted) throw new Error('social_media_assets insert returned no row')
    return inserted
  },
  findByUrl: async (bare) => {
    const { db } = await import('./db.server')
    // Match rows whose stored url, with its own query string removed, equals
    // the bare url. The index on `url` still serves the common exact case.
    const rows = await db
      .select({ id: socialMediaAssets.id })
      .from(socialMediaAssets)
      .where(sql`split_part(split_part(${socialMediaAssets.url}, '?', 1), '#', 1) = ${bare}`)
      .limit(1)
    return rows.length > 0
  },
  findIdsByUrls: async (bare) => {
    const { db } = await import('./db.server')
    return db
      .select({ id: socialMediaAssets.id, url: socialMediaAssets.url })
      .from(socialMediaAssets)
      // inArray expands to one placeholder per value; a raw `IN ${array}`
      // would bind the whole array as a single parameter.
      .where(inArray(sql`split_part(split_part(${socialMediaAssets.url}, '?', 1), '#', 1)`, bare))
  },
  setPicked: async (assetIds, postId) => {
    const { db } = await import('./db.server')
    await db
      .update(socialMediaAssets)
      .set({ isPicked: true, postId, updatedAt: new Date() })
      .where(inArray(socialMediaAssets.id, assetIds))
  },
  fetchBuffer: async (url) => {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`fetch ${url} failed: HTTP ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  },
  readDimensions: async (buffer) => {
    try {
      const sharp = (await import('sharp')).default
      const meta = await sharp(buffer).metadata()
      if (meta.width && meta.height) return { width: meta.width, height: meta.height }
      return null
    } catch {
      return null
    }
  },
}

function resolve(deps?: SocialAssetLibraryDeps): Required<SocialAssetLibraryDeps> {
  return { ...defaultDeps, ...(deps ?? {}) } as Required<SocialAssetLibraryDeps>
}

/** `w:h` reduced by gcd, e.g. 1080x1350 -> '4:5'. Unknown when a side is 0. */
export function aspectFromDimensions(width: number, height: number): string | undefined {
  if (!width || !height) return undefined
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const g = gcd(width, height)
  return `${width / g}:${height / g}`
}

/**
 * Upload to Sanity and write the index row. Throws on failure; the generation
 * path uses `tryIngestSocialAsset` below instead.
 */
export async function ingestSocialAsset(
  input: IngestSocialAssetInput,
  deps?: SocialAssetLibraryDeps,
): Promise<SocialMediaAssetRow> {
  const d = resolve(deps)
  const buffer = input.buffer ?? (input.sourceUrl ? await d.fetchBuffer(input.sourceUrl) : undefined)
  if (!buffer) throw new Error('ingestSocialAsset: a buffer or sourceUrl is required')

  const sanity = await d.uploadToSanity(buffer, input.filename, input.contentType)

  let width = input.width
  let height = input.height
  if (!width || !height) {
    const dims = await d.readDimensions(buffer)
    if (dims) {
      width = dims.width
      height = dims.height
    }
  }
  const aspect = input.aspect ?? (width && height ? aspectFromDimensions(width, height) : undefined)

  const row: SocialMediaAssetInsert = {
    sanityAssetId: sanity.assetId,
    url: input.url ?? sanity.url,
    source: input.source,
    isPicked: input.isPicked ?? false,
    createdBy: input.createdBy ?? 'system',
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(aspect ? { aspect: aspect.slice(0, 12) } : {}),
    ...(input.contentType ? { mimeType: input.contentType.slice(0, 40) } : {}),
    bytes: input.bytes ?? buffer.byteLength,
    ...(input.provider ? { provider: input.provider.slice(0, 40) } : {}),
    ...(input.model ? { model: input.model.slice(0, 120) } : {}),
    ...(input.prompt ? { prompt: input.prompt } : {}),
    ...(input.negativePrompt ? { negativePrompt: input.negativePrompt } : {}),
    ...(input.archetype ? { archetype: input.archetype.slice(0, 40) } : {}),
    ...(input.productHandle ? { productHandle: input.productHandle.slice(0, 255) } : {}),
    ...(input.shopifyProductId ? { shopifyProductId: input.shopifyProductId.slice(0, 60) } : {}),
    ...(input.castSlugs?.length ? { castSlugs: input.castSlugs } : {}),
    ...(input.tags?.length ? { tags: input.tags } : {}),
    ...(input.generationBatchId ? { generationBatchId: input.generationBatchId.slice(0, 80) } : {}),
    ...(input.postId ? { postId: input.postId } : {}),
  }

  return d.insertAsset(row)
}

/**
 * Non-fatal ingest for the generation path. Logs under `[social-library]`
 * and returns null on any failure so a Sanity or Neon outage never breaks a
 * billed image generation.
 */
export async function tryIngestSocialAsset(
  input: IngestSocialAssetInput,
  deps?: SocialAssetLibraryDeps,
): Promise<SocialMediaAssetRow | null> {
  try {
    return await ingestSocialAsset(input, deps)
  } catch (err) {
    console.error(`[social-library] ingest failed (non-fatal): ${input.filename}`, err)
    return null
  }
}

/** True when a `social_media_assets` row indexes this url (query string ignored). */
export async function isLibraryMember(url: string, deps?: SocialAssetLibraryDeps): Promise<boolean> {
  const bare = stripUrlQuery(url)
  if (!bare) return false
  return resolve(deps).findByUrl(bare)
}

/**
 * Every url is a library member. An empty list is false: fail closed, the
 * same contract as `allMediaAreGeneratedSocialAssets`.
 */
export async function allMediaAreLibraryMembers(
  urls: readonly string[] | null | undefined,
  deps?: SocialAssetLibraryDeps,
): Promise<boolean> {
  if (!urls || urls.length === 0) return false
  for (const u of urls) {
    if (!(await isLibraryMember(u, deps))) return false
  }
  return true
}

/** Mark the candidate(s) the agent chose for `postId`. */
export async function markPicked(
  assetIds: number[],
  postId: number,
  deps?: SocialAssetLibraryDeps,
): Promise<void> {
  if (assetIds.length === 0) return
  await resolve(deps).setPicked(assetIds, postId)
}

/**
 * Mark picked by url, for the draft op: the agent picks one of the returned
 * candidates client-side and only the url comes back with the draft, so the
 * row is found by url. Non-fatal: a miss here loses only an `is_picked` flag.
 */
export async function tryMarkPickedByUrls(
  urls: readonly string[] | null | undefined,
  postId: number,
  deps?: SocialAssetLibraryDeps,
): Promise<number[]> {
  const bare = (urls ?? []).map(stripUrlQuery).filter(Boolean)
  if (bare.length === 0) return []
  try {
    const d = resolve(deps)
    const rows = await d.findIdsByUrls(bare)
    const ids = rows.map(r => r.id)
    if (ids.length > 0) await d.setPicked(ids, postId)
    return ids
  } catch (err) {
    console.error(`[social-library] markPicked by url failed (non-fatal) for post ${postId}`, err)
    return []
  }
}
