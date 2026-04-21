/**
 * Emma context-group picks — precomputes contextual product rails that
 * complement the current hero deal, cached per (dealHandle, groupId).
 *
 * Layers:
 *   1. generatePicksForGroup / generatePicksForActiveGroups  — runs at midnight
 *      (and on admin on-demand, brief-change, or lazy-on-miss). One Haiku call
 *      per group; prompt-cached across groups in the same pass.
 *   2. getPicksForRender — called by the homepage loader; deterministic seed
 *      shuffle picks a stable-but-different subset per visitor. Zero AI cost.
 *
 * Storage:
 *   - emma_pick_groups (admin-authored briefs)
 *   - emma_pick_runs   (precomputed picks; UNIQUE(group, dealHandle) so regen
 *     overwrites via upsert)
 */
import { createHash } from 'node:crypto'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from './db.server'
import {
  emmaPickGroups,
  emmaPickRuns,
  type EmmaPickEntry,
} from '../../db/schema'
import {
  getDealByHandle,
  getProductsByTag,
  getCollectionProducts,
  getProductsByIds,
} from './shopify.server'
import { pickForContextGroup, type ContextPickCandidate } from './claude.server'
import { kvGet, kvSet, kvDel } from './kv.server'
import type { Product } from '~/types'

export type PickTrigger = 'midnight' | 'admin' | 'brief_change' | 'lazy'

export interface EmmaPickGroupRow {
  id:           number
  name:         string
  slug:         string
  kind:         'pairing' | 'alternative' | 'adjacent'
  emmaContext:  string
  sourceType:   'tag' | 'collection' | 'manual'
  sourceValue:  string
  maxPicks:     number
  displayCount: number
  active:       boolean
  sortOrder:    number
  briefHash:    string
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Deterministic hash of the editable parts of the brief — detects changes. */
export function computeBriefHash(parts: {
  emmaContext: string
  sourceType:  string
  sourceValue: string
  kind:        string
  maxPicks:    number
}): string {
  const payload = JSON.stringify({
    k:  parts.kind,
    c:  parts.emmaContext.trim(),
    st: parts.sourceType,
    sv: parts.sourceValue.trim(),
    m:  parts.maxPicks,
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

/** Convert a string seed into a 32-bit integer via sha256 prefix. */
function seedFromString(s: string): number {
  const hex = createHash('sha256').update(s).digest('hex').slice(0, 8)
  return parseInt(hex, 16) >>> 0
}

/** Fisher-Yates shuffle using a seeded PRNG — stable across runs. */
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

// ─── Candidate pool loading ────────────────────────────────────────────────

/** Load the candidate product pool for a group from its declared source. */
async function loadCandidates(group: EmmaPickGroupRow): Promise<Product[]> {
  if (group.sourceType === 'tag') {
    return getProductsByTag(group.sourceValue.trim(), 40)
  }
  if (group.sourceType === 'collection') {
    return getCollectionProducts(group.sourceValue.trim(), 40)
  }
  // manual — sourceValue is a JSON array of Shopify product GIDs
  try {
    const ids = JSON.parse(group.sourceValue) as unknown
    if (!Array.isArray(ids)) return []
    return getProductsByIds(ids.filter((x): x is string => typeof x === 'string').slice(0, 40))
  } catch {
    return []
  }
}

/** Compact Product → the slimmer shape we send to Haiku. */
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

// ─── Core generation ───────────────────────────────────────────────────────

/**
 * Generate picks for a single group against a given hero deal. Overwrites
 * any existing run for (group, dealHandle) via upsert.
 */
export async function generatePicksForGroup(opts: {
  group:      EmmaPickGroupRow
  dealHandle: string
  trigger:    PickTrigger
}): Promise<{ ok: true; count: number } | { ok: false; reason: string }> {
  const { group, dealHandle, trigger } = opts

  const hero = await getDealByHandle(dealHandle)
  if (!hero) return { ok: false, reason: 'hero_not_found' }

  const candidates = await loadCandidates(group)
  const shaped = candidates
    .map(p => toPickCandidate(p, hero.handle))
    .filter((c): c is ContextPickCandidate => c !== null)
    .slice(0, 20)   // keep input tokens bounded — pre-filter to top 20

  if (shaped.length < 3) return { ok: false, reason: 'not_enough_candidates' }

  const result = await pickForContextGroup({
    hero: {
      handle:       hero.handle,
      title:        hero.seoTitle,
      ...(hero.brand    ? { brand: hero.brand } : {}),
      ...(hero.tagline  ? { tagline: hero.tagline } : {}),
      ...(hero.category ? { category: hero.category } : {}),
      ...(hero.tags?.length ? { tags: hero.tags } : {}),
      dealPrice:    hero.dealPrice,
    },
    group: {
      name:        group.name,
      kind:        group.kind,
      emmaContext: group.emmaContext,
    },
    candidates: shaped,
    maxPicks:   Math.max(3, Math.min(group.maxPicks, 12)),
  })

  if (result.picks.length < 1) return { ok: false, reason: 'empty_picks' }

  // Map back to EmmaPickEntry (we have handle from the candidates list)
  const handleById = new Map(shaped.map(c => [c.id, c.handle]))
  const picks: EmmaPickEntry[] = result.picks.map((p, i) => ({
    productGid: p.id,
    handle:     handleById.get(p.id) ?? '',
    pairingWhy: p.pairingWhy.trim(),
    rank:       i,
  })).filter(p => p.handle)

  // Upsert — UNIQUE(group_id, deal_handle) enforces one live row per pair.
  await db
    .insert(emmaPickRuns)
    .values({
      groupId:      group.id,
      dealHandle,
      picks,
      briefHash:    group.briefHash,
      trigger,
      model:        'claude-haiku-4-5-20251001',
      inputTokens:  result.tokens.input + result.tokens.cacheCreation + result.tokens.cacheRead,
      outputTokens: result.tokens.output,
      generatedAt:  new Date(),
    })
    .onConflictDoUpdate({
      target: [emmaPickRuns.groupId, emmaPickRuns.dealHandle],
      set: {
        picks,
        briefHash:    group.briefHash,
        trigger,
        model:        'claude-haiku-4-5-20251001',
        inputTokens:  result.tokens.input + result.tokens.cacheCreation + result.tokens.cacheRead,
        outputTokens: result.tokens.output,
        generatedAt:  new Date(),
      },
    })

  // Bust the hydrated product cache so the new picks show up immediately.
  await kvDel(`emma:picks:hydrated:${dealHandle}`)
  return { ok: true, count: picks.length }
}

/** Run generation for every active group. Called at midnight rotation. */
export async function generatePicksForActiveGroups(
  dealHandle: string,
  trigger: PickTrigger = 'midnight',
): Promise<{ ran: number; ok: number; failed: number }> {
  const groups = await listGroups({ activeOnly: true })
  let ok = 0, failed = 0
  for (const g of groups) {
    try {
      const result = await generatePicksForGroup({ group: g, dealHandle, trigger })
      if (result.ok) ok++; else failed++
    } catch (err) {
      console.error('[emma-picks] generate failed for group', g.slug, err)
      failed++
    }
  }
  return { ran: groups.length, ok, failed }
}

// ─── Group CRUD ────────────────────────────────────────────────────────────

export async function listGroups(opts: { activeOnly?: boolean } = {}): Promise<EmmaPickGroupRow[]> {
  const query = db.select().from(emmaPickGroups).orderBy(asc(emmaPickGroups.sortOrder), asc(emmaPickGroups.id))
  const rows = opts.activeOnly
    ? await query.where(eq(emmaPickGroups.active, true))
    : await query
  return rows.map(r => ({
    id:           r.id,
    name:         r.name,
    slug:         r.slug,
    kind:         r.kind as EmmaPickGroupRow['kind'],
    emmaContext:  r.emmaContext,
    sourceType:   r.sourceType as EmmaPickGroupRow['sourceType'],
    sourceValue:  r.sourceValue,
    maxPicks:     r.maxPicks,
    displayCount: r.displayCount,
    active:       r.active,
    sortOrder:    r.sortOrder,
    briefHash:    r.briefHash,
  }))
}

export async function getGroupBySlug(slug: string): Promise<EmmaPickGroupRow | null> {
  const [row] = await db.select().from(emmaPickGroups).where(eq(emmaPickGroups.slug, slug)).limit(1)
  if (!row) return null
  return {
    id:           row.id,
    name:         row.name,
    slug:         row.slug,
    kind:         row.kind as EmmaPickGroupRow['kind'],
    emmaContext:  row.emmaContext,
    sourceType:   row.sourceType as EmmaPickGroupRow['sourceType'],
    sourceValue:  row.sourceValue,
    maxPicks:     row.maxPicks,
    displayCount: row.displayCount,
    active:       row.active,
    sortOrder:    row.sortOrder,
    briefHash:    row.briefHash,
  }
}

export async function getRunForGroup(groupId: number, dealHandle: string) {
  const [row] = await db
    .select()
    .from(emmaPickRuns)
    .where(and(eq(emmaPickRuns.groupId, groupId), eq(emmaPickRuns.dealHandle, dealHandle)))
    .limit(1)
  return row ?? null
}

// ─── Render path (homepage loader) ─────────────────────────────────────────

export interface RenderPick {
  product:    Product
  pairingWhy: string
}

export interface RenderRow {
  group: Pick<EmmaPickGroupRow, 'id' | 'name' | 'slug' | 'kind' | 'displayCount'>
  picks: RenderPick[]
}

/** KV lock to prevent duplicate lazy regens across concurrent requests. */
async function acquireLock(key: string, ttlSeconds = 60): Promise<boolean> {
  // Best-effort — on in-memory fallback this is per-process; that's fine.
  const existing = await kvGet<number>(key)
  if (existing != null) return false
  await kvSet(key, Date.now(), ttlSeconds)
  return true
}

/**
 * Main read path for the homepage. Loads all active groups' picks for the
 * current deal, fires lazy regen for any stale/missing rows, hydrates
 * products from Shopify (cached 24h), and deterministically selects
 * `displayCount` items per group keyed to the visitor session.
 */
export async function getPicksForRender(opts: {
  dealHandle: string
  sessionSeed: string
}): Promise<RenderRow[]> {
  const { dealHandle, sessionSeed } = opts

  const groups = await listGroups({ activeOnly: true })
  if (groups.length === 0) return []

  // Fetch all runs for these groups + this deal in a single query
  const runs = groups.length
    ? await db
        .select()
        .from(emmaPickRuns)
        .where(and(
          eq(emmaPickRuns.dealHandle, dealHandle),
          inArray(emmaPickRuns.groupId, groups.map(g => g.id)),
        ))
    : []
  const runByGroup = new Map(runs.map(r => [r.groupId, r]))

  // Lazy regen for any group with missing or stale runs. Awaited inline so
  // the first requesting visitor pays the latency; concurrent callers skip
  // via the lock and read after the row lands.
  for (const g of groups) {
    const run = runByGroup.get(g.id)
    const needs = !run || run.briefHash !== g.briefHash
    if (!needs) continue
    const lockKey = `emma:picks:lock:${dealHandle}:${g.id}`
    const got = await acquireLock(lockKey, 60)
    if (got) {
      try {
        const result = await generatePicksForGroup({ group: g, dealHandle, trigger: 'lazy' })
        if (result.ok) {
          const fresh = await getRunForGroup(g.id, dealHandle)
          if (fresh) runByGroup.set(g.id, fresh)
        }
      } catch (err) {
        console.error('[emma-picks] lazy regen failed for', g.slug, err)
      } finally {
        await kvDel(lockKey)
      }
    }
    // If we didn't get the lock, we just skip and render whatever is there
    // (possibly empty) this request — next request after the lock releases
    // will pick up the fresh row.
  }

  // Collect all product GIDs to hydrate in one Shopify batch
  const allIds = new Set<string>()
  for (const g of groups) {
    const run = runByGroup.get(g.id)
    if (!run) continue
    for (const p of run.picks) allIds.add(p.productGid)
  }
  const ids = [...allIds]
  const hydrated = ids.length
    ? await hydrateProducts(dealHandle, ids)
    : new Map<string, Product>()

  // Build render rows with seeded subset selection
  const rows: RenderRow[] = []
  for (const g of groups) {
    const run = runByGroup.get(g.id)
    if (!run || !run.picks.length) continue

    // Filter out any pick whose product didn't hydrate (unpublished/deleted)
    const alive = run.picks
      .map(p => {
        const product = hydrated.get(p.productGid)
        if (!product) return null
        return { product, pairingWhy: p.pairingWhy }
      })
      .filter((x): x is RenderPick => x !== null)

    if (alive.length === 0) continue

    const seed = seedFromString(`${sessionSeed}|${dealHandle}|${g.id}`)
    const shuffled = seededShuffle(alive, seed)
    const picks = shuffled.slice(0, Math.max(1, g.displayCount))

    rows.push({
      group: { id: g.id, name: g.name, slug: g.slug, kind: g.kind, displayCount: g.displayCount },
      picks,
    })
  }
  return rows
}

/** 24h cache of hydrated Products for a given deal — one Shopify fetch/day. */
async function hydrateProducts(dealHandle: string, ids: string[]): Promise<Map<string, Product>> {
  const cacheKey = `emma:picks:hydrated:${dealHandle}`
  const cached = await kvGet<Product[]>(cacheKey)
  if (cached && cached.length) {
    const map = new Map(cached.map(p => [p.id, p]))
    // If the cache covers everything we need, use it
    if (ids.every(id => map.has(id))) return map
  }
  const fresh = await getProductsByIds(ids)
  await kvSet(cacheKey, fresh, 24 * 60 * 60)
  return new Map(fresh.map(p => [p.id, p]))
}

// ─── Admin helpers ─────────────────────────────────────────────────────────

/**
 * Apply a patch to a single pick in a run (edit pairingWhy, reorder, remove).
 * Used by the admin detail UI — does not call Claude.
 */
export async function patchRunPicks(
  groupId: number,
  dealHandle: string,
  transform: (picks: EmmaPickEntry[]) => EmmaPickEntry[],
): Promise<boolean> {
  const existing = await getRunForGroup(groupId, dealHandle)
  if (!existing) return false
  const next = transform(existing.picks).map((p, i) => ({ ...p, rank: i }))
  await db
    .update(emmaPickRuns)
    .set({ picks: next })
    .where(and(eq(emmaPickRuns.groupId, groupId), eq(emmaPickRuns.dealHandle, dealHandle)))
  await kvDel(`emma:picks:hydrated:${dealHandle}`)
  return true
}
