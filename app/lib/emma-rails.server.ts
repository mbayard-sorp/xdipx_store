/**
 * Emma context rails — Sanity-native AI-curated product rails under the hero.
 *
 * Storage: Sanity (doc type `emmaContextRail`). Human editors use Studio; the
 * generation layer writes via @sanity/client; a future agent uses Sanity MCP.
 *
 * Layers:
 *   1. regenerateRail / regenerateActiveRails — writes current.picks back to
 *      the Sanity document. Runs at midnight rotation, on admin trigger, or
 *      lazy-on-miss from the homepage loader.
 *   2. getEmmaContextRows — homepage read path. Fetches active rails, lazy
 *      regens any stale ones, hydrates products from Shopify in one batch,
 *      deterministic shuffle per (session, deal, rail) → displayCount cards.
 */
import { createHash } from 'node:crypto'
import { createClient, type SanityClient } from '@sanity/client'
import {
  getDealByHandle,
  getProductsByTag,
  getCollectionProducts,
  getProductsByIds,
} from './shopify.server'
import { pickForContextGroup, type ContextPickCandidate } from './claude.server'
import { kvGet, kvSet, kvDel } from './kv.server'
import type { Product } from '~/types'
import { categoryToLegacyString } from '~/types'

// ─── Types ─────────────────────────────────────────────────────────────────

export type RailKind     = 'pairing' | 'alternative' | 'adjacent'
export type RailSource   = 'tag' | 'collection' | 'manual'
export type RailTrigger  = 'midnight' | 'admin' | 'brief_change' | 'lazy' | 'agent'

export interface RailPick {
  productGid: string
  handle:     string
  pairingWhy: string
  rank:       number
  edited?:    boolean
}

export interface RailCurrent {
  dealHandle:   string
  generatedAt:  string
  briefHash:    string
  trigger:      RailTrigger
  model:        string
  inputTokens:  number
  outputTokens: number
  picks:        RailPick[]
}

export interface RailLastError {
  reason:  string
  message: string
  at:      string
}

export interface RailDoc {
  _id:              string
  name:             string
  slug:             string
  kind:             RailKind
  emmaBrief:        string
  source:           RailSource
  shopifyTag?:      string
  collectionHandle?: string
  productGids?:     string[]
  maxPicks:         number
  displayCount:     number
  active:           boolean
  sortOrder:        number
  current?:         RailCurrent | null
  lastError?:       RailLastError | null
}

export interface RenderPick {
  product:    Product
  pairingWhy: string
}

/**
 * Render row shape consumed by <EmmaContextRow>. `rail` mirrors the old
 * `group` shape (id/name/slug/kind/displayCount) so the component only needs
 * a prop rename.
 */
export interface RenderRow {
  rail: {
    id:           string
    name:         string
    slug:         string
    kind:         RailKind
    displayCount: number
  }
  picks: RenderPick[]
}

// ─── Sanity client ─────────────────────────────────────────────────────────

const projectId  = process.env['SANITY_PROJECT_ID']
const dataset    = process.env['SANITY_DATASET'] ?? 'production'
const apiVersion = '2024-10-01'

function getReadClient(): SanityClient | null {
  if (!projectId) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient({ projectId, dataset, apiVersion, useCdn: true, token: process.env['SANITY_API_TOKEN'] } as any)
}

function getWriteClient(): SanityClient | null {
  if (!projectId) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient({ projectId, dataset, apiVersion, useCdn: false, token: process.env['SANITY_API_TOKEN'] } as any)
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Deterministic hash of the editable parts of the rail — detects brief changes. */
export function computeBriefHash(rail: Pick<RailDoc, 'emmaBrief' | 'source' | 'shopifyTag' | 'collectionHandle' | 'productGids' | 'kind' | 'maxPicks'>): string {
  const sv =
    rail.source === 'tag'        ? (rail.shopifyTag ?? '')
    : rail.source === 'collection' ? (rail.collectionHandle ?? '')
    : JSON.stringify(rail.productGids ?? [])
  const payload = JSON.stringify({
    k:  rail.kind,
    c:  (rail.emmaBrief ?? '').trim(),
    st: rail.source,
    sv: sv.trim(),
    m:  rail.maxPicks,
  })
  return createHash('sha256').update(payload).digest('hex').slice(0, 32)
}

/** Seeded PRNG (mulberry32) — deterministic for a given numeric seed. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6D2B79F5) >>> 0
    let r = t
    r = Math.imul(r ^ (r >>> 15), r | 1)
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function seedFromString(s: string): number {
  const hex = createHash('sha256').update(s).digest('hex').slice(0, 8)
  return parseInt(hex, 16) >>> 0
}

function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const rand = mulberry32(seed)
  const arr = items.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = arr[i]!
    arr[i] = arr[j]!
    arr[j] = tmp
  }
  return arr
}

function describeFailure(reason: string, rail?: Pick<RailDoc, 'source' | 'shopifyTag' | 'collectionHandle'>): string {
  switch (reason) {
    case 'hero_not_found':
      return `Live deal not found in Shopify — check the daily deal is set and published.`
    case 'not_enough_candidates': {
      const src = rail
        ? rail.source === 'tag'        ? ` — tag "${rail.shopifyTag ?? ''}"`
          : rail.source === 'collection' ? ` — collection "${rail.collectionHandle ?? ''}"`
          : ' — manual list'
        : ''
      return `Not enough matching products in Shopify${src}. Need at least 3.`
    }
    case 'empty_picks':
      return `Emma returned no picks from the candidates. Try rewording the brief.`
    case 'no_live_deal':
      return `No live deal set — can't generate picks until one is live.`
    case 'sanity_not_configured':
      return `Sanity is not configured — set SANITY_PROJECT_ID and SANITY_API_TOKEN.`
    default:
      return reason
  }
}

// ─── Candidate pool loading ────────────────────────────────────────────────

async function loadCandidates(rail: RailDoc): Promise<Product[]> {
  if (rail.source === 'tag') {
    return getProductsByTag((rail.shopifyTag ?? '').trim(), 40)
  }
  if (rail.source === 'collection') {
    return getCollectionProducts((rail.collectionHandle ?? '').trim(), 40)
  }
  const ids = rail.productGids ?? []
  return getProductsByIds(ids.filter(x => typeof x === 'string').slice(0, 40))
}

function toPickCandidate(p: Product, heroHandle: string): ContextPickCandidate | null {
  if (p.handle === heroHandle) return null
  return {
    id:     p.id,
    handle: p.handle,
    title:  p.title,
    ...(p.brand    ? { brand: p.brand } : {}),
    ...(p.tags?.length ? { tags: p.tags } : {}),
    ...(p.category ? { productType: p.category } : {}),
    price: p.price,
    ...(p.seoTitle && p.seoTitle !== p.title ? { blurb: p.seoTitle } : {}),
  }
}

// ─── Sanity read ───────────────────────────────────────────────────────────

const RAIL_FIELDS_GROQ = `{
  _id, name, "slug": slug.current, kind, emmaBrief,
  source, shopifyTag, collectionHandle, productGids,
  maxPicks, displayCount, active, sortOrder,
  current, lastError
}`

const RAILS_GROQ = `*[_type == "emmaContextRail" && active == true] | order(sortOrder asc, _createdAt asc) ${RAIL_FIELDS_GROQ}`

export async function listActiveRails(): Promise<RailDoc[]> {
  const client = getReadClient()
  if (!client) return []
  try {
    const rows = await client.fetch<RailDoc[]>(RAILS_GROQ)
    return rows ?? []
  } catch (err) {
    console.error('[emma-rails] listActiveRails error:', err)
    return []
  }
}

async function getRailById(id: string): Promise<RailDoc | null> {
  const client = getReadClient()
  if (!client) return null
  try {
    return await client.fetch<RailDoc | null>(
      `*[_type == "emmaContextRail" && _id == $id][0]${RAIL_FIELDS_GROQ}`,
      { id },
    )
  } catch (err) {
    console.error('[emma-rails] getRailById error:', err)
    return null
  }
}

// ─── Sanity write ──────────────────────────────────────────────────────────

async function patchCurrent(railId: string, current: RailCurrent): Promise<void> {
  const client = getWriteClient()
  if (!client) throw new Error('sanity_not_configured')
  // Patch both the published doc and any draft so Studio reflects generation.
  await client
    .patch(railId)
    .set({ current })
    .unset(['lastError'])
    .commit({ autoGenerateArrayKeys: true })
  const draftId = railId.startsWith('drafts.') ? railId : `drafts.${railId}`
  try {
    await client
      .patch(draftId)
      .set({ current })
      .unset(['lastError'])
      .commit({ autoGenerateArrayKeys: true })
  } catch {
    // draft may not exist — fine
  }
}

async function patchLastError(railId: string, reason: string, message: string): Promise<void> {
  const client = getWriteClient()
  if (!client) return
  const lastError: RailLastError = { reason, message, at: new Date().toISOString() }
  try {
    await client.patch(railId).set({ lastError }).commit()
  } catch (err) {
    console.error('[emma-rails] patchLastError error:', err)
  }
}

// ─── Generation ────────────────────────────────────────────────────────────

export async function regenerateRail(
  rail: RailDoc,
  dealHandle: string,
  trigger: RailTrigger,
): Promise<{ ok: true; count: number } | { ok: false; reason: string }> {
  if (!getWriteClient()) {
    return { ok: false, reason: 'sanity_not_configured' }
  }

  try {
    const hero = await getDealByHandle(dealHandle)
    if (!hero) {
      await patchLastError(rail._id, 'hero_not_found', describeFailure('hero_not_found'))
      return { ok: false, reason: 'hero_not_found' }
    }

    const candidates = await loadCandidates(rail)
    const shaped = candidates
      .map(p => toPickCandidate(p, hero.handle))
      .filter((c): c is ContextPickCandidate => c !== null)
      .slice(0, 20)

    if (shaped.length < 3) {
      await patchLastError(rail._id, 'not_enough_candidates', describeFailure('not_enough_candidates', rail))
      return { ok: false, reason: 'not_enough_candidates' }
    }

    const result = await pickForContextGroup({
      hero: {
        handle:     hero.handle,
        title:      hero.seoTitle,
        ...(hero.brand    ? { brand: hero.brand } : {}),
        ...(hero.tagline  ? { tagline: hero.tagline } : {}),
        ...(hero.category?.length ? { category: categoryToLegacyString(hero.category) } : {}),
        ...(hero.tags?.length ? { tags: hero.tags } : {}),
        dealPrice:  hero.dealPrice,
      },
      group: {
        name:        rail.name,
        kind:        rail.kind,
        emmaContext: rail.emmaBrief,
      },
      candidates: shaped,
      maxPicks:   Math.max(3, Math.min(rail.maxPicks, 12)),
    })

    if (result.picks.length < 1) {
      await patchLastError(rail._id, 'empty_picks', describeFailure('empty_picks'))
      return { ok: false, reason: 'empty_picks' }
    }

    const handleById = new Map(shaped.map(c => [c.id, c.handle]))
    const picks: RailPick[] = result.picks.map((p, i) => ({
      productGid: p.id,
      handle:     handleById.get(p.id) ?? '',
      pairingWhy: p.pairingWhy.trim(),
      rank:       i,
      edited:     false,
    })).filter(p => p.handle)

    const current: RailCurrent = {
      dealHandle,
      generatedAt:  new Date().toISOString(),
      briefHash:    computeBriefHash(rail),
      trigger,
      model:        'claude-haiku-4-5-20251001',
      inputTokens:  result.tokens.input + result.tokens.cacheCreation + result.tokens.cacheRead,
      outputTokens: result.tokens.output,
      picks,
    }

    await patchCurrent(rail._id, current)
    await kvDel(`emma:rails:hydrated:${dealHandle}`)
    return { ok: true, count: picks.length }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'internal_error'
    await patchLastError(rail._id, 'internal_error', msg).catch(() => {})
    throw err
  }
}

/** Regenerate every active rail — called at midnight rotation. */
export async function regenerateActiveRails(
  dealHandle: string,
  trigger: RailTrigger = 'midnight',
): Promise<{ ran: number; ok: number; failed: number }> {
  const rails = await listActiveRails()
  let ok = 0, failed = 0
  for (const rail of rails) {
    try {
      const res = await regenerateRail(rail, dealHandle, trigger)
      if (res.ok) ok++; else failed++
    } catch (err) {
      console.error('[emma-rails] regenerate failed for', rail.slug, err)
      failed++
    }
  }
  return { ran: rails.length, ok, failed }
}

/** On-demand regen by rail _id — used by the cron/Studio action endpoint. */
export async function regenerateRailById(
  railId: string,
  dealHandle: string,
  trigger: RailTrigger,
): Promise<{ ok: true; count: number } | { ok: false; reason: string }> {
  const rail = await getRailById(railId)
  if (!rail) return { ok: false, reason: 'rail_not_found' }
  return regenerateRail(rail, dealHandle, trigger)
}

// ─── Render path (homepage loader) ─────────────────────────────────────────

async function acquireLock(key: string, ttlSeconds = 60): Promise<boolean> {
  const existing = await kvGet<number>(key)
  if (existing != null) return false
  await kvSet(key, Date.now(), ttlSeconds)
  return true
}

async function hydrateProducts(dealHandle: string, ids: string[]): Promise<Map<string, Product>> {
  const cacheKey = `emma:rails:hydrated:${dealHandle}`
  const cached = await kvGet<Product[]>(cacheKey)
  if (cached && cached.length) {
    const map = new Map(cached.map(p => [p.id, p]))
    if (ids.every(id => map.has(id))) return map
  }
  const fresh = await getProductsByIds(ids)
  await kvSet(cacheKey, fresh, 24 * 60 * 60)
  return new Map(fresh.map(p => [p.id, p]))
}

/**
 * Main homepage read path. Returns one RenderRow per active rail, each with
 * `displayCount` picks chosen deterministically from the pool via seeded
 * shuffle. Fires lazy regen (under a KV lock) for any rail whose cached
 * picks are missing or stale vs. current deal / current brief.
 */
export async function getEmmaContextRows(opts: {
  dealHandle:  string
  sessionSeed: string
}): Promise<RenderRow[]> {
  const { dealHandle, sessionSeed } = opts

  const rails = await listActiveRails()
  if (rails.length === 0) return []

  // In-memory copy we may patch after lazy regen.
  const railsById = new Map(rails.map(r => [r._id, r]))

  for (const rail of rails) {
    const briefHash = computeBriefHash(rail)
    const needs = !rail.current
      || rail.current.dealHandle !== dealHandle
      || rail.current.briefHash !== briefHash
    if (!needs) continue

    const lockKey = `emma:rails:lock:${dealHandle}:${rail._id}`
    const got = await acquireLock(lockKey, 60)
    if (!got) continue
    try {
      const res = await regenerateRail(rail, dealHandle, 'lazy')
      if (res.ok) {
        const refreshed = await getRailById(rail._id)
        if (refreshed) railsById.set(rail._id, refreshed)
      }
    } catch (err) {
      console.error('[emma-rails] lazy regen failed for', rail.slug, err)
    } finally {
      await kvDel(lockKey)
    }
  }

  // One Shopify batch for every pick across all rails.
  const allIds = new Set<string>()
  for (const rail of railsById.values()) {
    for (const p of rail.current?.picks ?? []) allIds.add(p.productGid)
  }
  const hydrated = allIds.size
    ? await hydrateProducts(dealHandle, [...allIds])
    : new Map<string, Product>()

  const rows: RenderRow[] = []
  for (const rail of railsById.values()) {
    const picks = rail.current?.picks ?? []
    if (picks.length === 0) continue

    const alive = picks
      .map(p => {
        const product = hydrated.get(p.productGid)
        if (!product) return null
        return { product, pairingWhy: p.pairingWhy }
      })
      .filter((x): x is RenderPick => x !== null)

    if (alive.length === 0) continue

    const seed = seedFromString(`${sessionSeed}|${dealHandle}|${rail._id}`)
    const shuffled = seededShuffle(alive, seed)
    const selected = shuffled.slice(0, Math.max(1, rail.displayCount))

    rows.push({
      rail: {
        id:           rail._id,
        name:         rail.name,
        slug:         rail.slug,
        kind:         rail.kind,
        displayCount: rail.displayCount,
      },
      picks: selected,
    })
  }
  return rows
}
