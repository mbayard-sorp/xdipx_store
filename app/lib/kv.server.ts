/**
 * Vercel KV wrapper — gracefully no-ops when KV is not configured (local dev).
 * Falls back to an in-memory store so local dev workflows (e.g. bulk import) work
 * without needing KV credentials.
 * All Vercel-specific code stays in server/ or here; never imported inside app/routes.
 */

let _kv: Awaited<ReturnType<typeof import('@vercel/kv').createClient>> | null = null

/**
 * Resolve KV credentials from env. Prod (Vercel marketplace integration)
 * injects the unprefixed `KV_REST_API_URL` / `KV_REST_API_TOKEN`; a
 * `vercel env pull` of a named store, by contrast, writes them under the
 * store-name prefix (e.g. `xdipx_splash_KV_REST_API_URL`). Accept either so
 * local dev and prod read the same store instead of local silently dropping
 * to the in-memory fallback. Prefer the unprefixed pair; otherwise take the
 * first matching prefixed pair.
 */
function resolveKvCreds(): { url: string; token: string } | null {
  const env = process.env
  // Explicit local opt-out. Set `KV_DISABLE=1` in `.env.local` to force the
  // in-memory fallback even when KV creds are present, so dev keeps an
  // isolated cache that rebuilds from live Shopify on every restart and never
  // reads or writes the shared prod KV. Intentional, unlike the old silent
  // fallback that only triggered because the var name didn't match.
  if (env['KV_DISABLE'] === '1' || env['KV_DISABLE'] === 'true') return null
  if (env['KV_REST_API_URL'] && env['KV_REST_API_TOKEN']) {
    return { url: env['KV_REST_API_URL'], token: env['KV_REST_API_TOKEN'] }
  }
  for (const key of Object.keys(env)) {
    if (!key.endsWith('_KV_REST_API_URL')) continue
    const prefix = key.slice(0, -'_KV_REST_API_URL'.length)
    const url = env[key]
    const token = env[`${prefix}_KV_REST_API_TOKEN`]
    if (url && token) return { url, token }
  }
  return null
}

async function getKV() {
  if (_kv) return _kv
  const creds = resolveKvCreds()
  if (!creds) return null
  const { createClient } = await import('@vercel/kv')
  _kv = createClient(creds)
  return _kv
}

/**
 * True when real KV credentials are resolvable (prod / a `vercel env pull`),
 * false when we're on the in-memory fallback (local dev, or `KV_DISABLE=1`).
 * Callers use this to decide whether a cold cache can be repopulated by a
 * background cron (prod) or must be built inline (local dev, where the
 * fire-and-forget rebuild trigger has no BASE_URL to reach).
 */
export function isKvConfigured(): boolean {
  return resolveKvCreds() !== null
}

// In-memory fallback used when KV is not configured (local dev).
// Stored on globalThis so it survives Vite HMR module re-evaluation.
const _g = globalThis as unknown as { __kvMemStore?: Map<string, unknown> }
if (!_g.__kvMemStore) _g.__kvMemStore = new Map()
const memStore = _g.__kvMemStore

// Per-key TTL timers for the in-memory store. Tracked separately so we can
// clear pending expirations when a key is overwritten or explicitly deleted.
const _g3 = globalThis as unknown as { __kvMemTimers?: Map<string, ReturnType<typeof setTimeout>> }
if (!_g3.__kvMemTimers) _g3.__kvMemTimers = new Map()
const memTimers = _g3.__kvMemTimers

// Throttled warning when a real KV op fails and we degrade to in-memory, so a
// flaky/unreachable KV degrades gracefully instead of throwing and 500ing the
// loader that called us. Throttled to avoid flooding logs on a hot path.
let _lastKvWarn = 0
function warnKvFallback(op: string, err: unknown): void {
  const now = Date.now()
  if (now - _lastKvWarn < 60_000) return
  _lastKvWarn = now
  console.warn(`[kv] ${op} failed, falling back to in-memory:`, err instanceof Error ? err.message : err)
}

// ─── In-memory primitives (also the fallback when real KV throws) ─────────
function memGet<T>(key: string): T | null {
  return (memStore.get(key) as T) ?? null
}

function memSet(key: string, value: unknown, exSeconds?: number): void {
  memStore.set(key, value)
  // Honor TTL on the in-memory fallback so dev behavior matches prod KV.
  // Critical for rate-limit windows, cache invalidation, and lock keys —
  // without this they'd accumulate forever and break local testing.
  const existing = memTimers.get(key)
  if (existing) clearTimeout(existing)
  if (exSeconds && exSeconds > 0) {
    const t = setTimeout(() => {
      memStore.delete(key)
      memTimers.delete(key)
    }, exSeconds * 1000)
    // Don't keep the dev process alive just to clean memory.
    if (typeof (t as { unref?: () => void }).unref === 'function') {
      (t as { unref: () => void }).unref()
    }
    memTimers.set(key, t)
  } else {
    memTimers.delete(key)
  }
}

function memDel(key: string): void {
  memStore.delete(key)
  const t = memTimers.get(key)
  if (t) { clearTimeout(t); memTimers.delete(key) }
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const kv = await getKV()
  if (kv) {
    try { return await kv.get<T>(key) }
    catch (err) { warnKvFallback('get', err) }
  }
  return memGet<T>(key)
}

export async function kvSet(key: string, value: unknown, _exSeconds?: number): Promise<void> {
  const kv = await getKV()
  if (kv) {
    try {
      if (_exSeconds) await kv.set(key, value, { ex: _exSeconds })
      else await kv.set(key, value)
      return
    } catch (err) { warnKvFallback('set', err) }
  }
  memSet(key, value, _exSeconds)
}

export async function kvIncr(key: string): Promise<number> {
  const kv = await getKV()
  if (kv) {
    try { return await kv.incr(key) }
    catch (err) { warnKvFallback('incr', err) }
  }
  const current = (memStore.get(key) as number) ?? 0
  memStore.set(key, current + 1)
  return current + 1
}

export async function kvDel(key: string): Promise<void> {
  const kv = await getKV()
  if (kv) {
    try { await kv.del(key); return }
    catch (err) { warnKvFallback('del', err) }
  }
  memDel(key)
}

/**
 * Set a KV key only if it does not already exist (NX semantics), with a TTL.
 * Returns true if the lock was newly acquired, false if it was already held.
 * Uses Upstash set NX option in prod; emulates NX via memGet check in the
 * in-memory fallback so local dev concurrency behaviour matches prod KV.
 */
export async function kvSetNX(key: string, value: string, exSeconds: number): Promise<boolean> {
  const kv = await getKV()
  if (kv) {
    try {
      const result = await kv.set(key, value, { nx: true, ex: exSeconds })
      return result === 'OK'
    } catch (err) { warnKvFallback('setNX', err) }
  }
  // In-memory fallback: acquire only if absent.
  if (memGet(key) !== null) return false
  memSet(key, value, exSeconds)
  return true
}

// ─── Two-tier cache (in-memory L1 + KV L2) ────────────────────────────────
// Cuts Shopify/Sanity API calls on hot read paths. Short TTLs keep admin
// changes visible quickly; `invalidateCache(prefix)` lets admin flows bust
// a class of keys after a mutation.

type CacheEntry<T> = { data: T; ts: number }

const _g2 = globalThis as unknown as { __readCache?: Map<string, CacheEntry<unknown>> }
if (!_g2.__readCache) _g2.__readCache = new Map()
const readCache = _g2.__readCache

export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<T> {
  const ttlMs  = ttlSeconds * 1000
  const now    = Date.now()
  const l1     = readCache.get(key) as CacheEntry<T> | undefined
  if (l1 && now - l1.ts < ttlMs) return l1.data
  const l2 = await kvGet<CacheEntry<T>>(key)
  if (l2 && now - l2.ts < ttlMs) {
    readCache.set(key, l2)
    return l2.data
  }
  const data  = await fn()
  const entry = { data, ts: now }
  readCache.set(key, entry)
  // Slightly longer KV TTL than L1 TTL — lets new instances warm from KV
  // before hitting origin even if L1 expired.
  await kvSet(key, entry, ttlSeconds + 60)
  return data
}

export function invalidateCache(prefix: string): void {
  for (const k of readCache.keys()) {
    if (k.startsWith(prefix)) readCache.delete(k)
  }
  // KV keys expire naturally via TTL; for immediate invalidation add kvDel
  // calls in the admin mutation path.
}

// ─── Named KV Keys ────────────────────────────────────────────────────────

export const KV_KEYS = {
  feedCache:              'nalpac:feed:cache',
  feedCacheTimestamp:     'nalpac:feed:timestamp',
  socialProof:            (handle: string) => `social:proof:${handle}`,
  dealOfDay:              'deal:today',
  viewerCount:            (handle: string) => `viewers:${handle}`,
  pinnedAccessoryIds:     'pinned:accessory_ids',
  vaultFilterTabs:        'vault:filter_tabs',
  bulkImportJob:          'bulk-import:job',
  veoOperation:           (token: string) => `veo:op:${token}`,
  ltxOperation:           (token: string) => `ltx:op:${token}`,
  liveDealHandle:         'live-deal:handle',
  fbt:                    (handle: string) => `fbt:${handle}`,
  collectionCursor:       (handle: string, page: number, sort = 'manual') => `vault:cursor:${handle}:${sort}:p${page}`,
  // v2 redesign — dial vote aggregates (5-min TTL)
  dialAggregate:          (shopifyProductId: string) => `dial:agg:${shopifyProductId}`,
  // PDP product-level aggregate vote (thumbs up/down on the whole dial)
  productVoteAggregate:   (shopifyProductId: string) => `dial:product-agg:${shopifyProductId}`,
  // PDP contextual Emma aside (24h TTL; guest/empty inputs collapse to one key per product)
  emmaAside:              (productId: string, userBucket: string, cartHash: string, browseHash: string) =>
                          `emmaAside:${productId}:${userBucket}:${cartHash}:${browseHash}`,
  emmaAsideLock:          (productId: string) => `emmaAside:lock:${productId}`,
  emmaAsideDailyCount:    (utcDate: string) => `emmaAside:dailyCount:${utcDate}`,
  // Cart drawer Emma aside (24h TTL; cart+profile+subtotal-band collapse to one key)
  emmaCartAside:          (variant: string, userBucket: string, cartHash: string, searchHash: string, subtotalBand: number) =>
                          `emmaCartAside:${variant}:${userBucket}:${cartHash}:${searchHash}:${subtotalBand}`,
  emmaCartAsideLock:      (cartHash: string) => `emmaCartAside:lock:${cartHash}`,
  emmaCartAsideDailyCount:(utcDate: string) => `emmaCartAside:dailyCount:${utcDate}`,
  // Discovery rail on /search + /collections (10-min TTL per query+filter+recentView hash)
  emmaDiscovery:          (hash: string) => `emmaDiscovery:v1:${hash}`,
  emmaDiscoveryDailyCount:(utcDate: string) => `emmaDiscovery:dailyCount:${utcDate}`,
  // Encouragement strip above discovery grid (30-min TTL per filter combination)
  emmaEncouragement:           (hash: string) => `emmaEncouragement:v2:${hash}`,
  emmaEncouragementDailyCount: (utcDate: string) => `emmaEncouragement:dailyCount:${utcDate}`,
  // Batch enrichment job summary mirrored from DB for fast admin poll surface (24h TTL)
  enrichmentJob:               (jobId: string) => `batch-job:${jobId}`,
} as const

// ─── Vault Filter Tabs helpers ────────────────────────────────────────────

import type { VaultFilterTab } from '~/types'

export const DEFAULT_VAULT_TABS: VaultFilterTab[] = [
  { id: 'all',      label: 'All',       slug: 'all',      filter: { type: 'all' } },
  { id: 'for-him',  label: 'For Him',   slug: 'for-him',  filter: { type: 'collection', handle: 'for-him' } },
  { id: 'for-her',  label: 'For Her',   slug: 'for-her',  filter: { type: 'collection', handle: 'for-her' } },
  { id: 'couples',  label: 'Couples',   slug: 'couples',  filter: { type: 'collection', handle: 'couples' } },
  { id: 'under-25', label: 'Under $25', slug: 'under-25', filter: { type: 'price', max: 25 } },
  { id: 'under-50', label: 'Under $50', slug: 'under-50', filter: { type: 'price', max: 50 } },
]

export async function getVaultFilterTabs(): Promise<VaultFilterTab[]> {
  const stored = await kvGet<VaultFilterTab[]>(KV_KEYS.vaultFilterTabs)
  return stored ?? DEFAULT_VAULT_TABS
}

// ─── Pinned accessory IDs (KV-backed for hot vault-load path) ─────────────

export async function getPinnedAccessoryIds(): Promise<string[]> {
  const ids = await kvGet<string[]>(KV_KEYS.pinnedAccessoryIds)
  return Array.isArray(ids) ? ids : []
}

export async function setPinnedAccessoryIds(ids: string[]): Promise<void> {
  // Persistent admin config — no TTL. Previous 24h TTL silently dropped upsells
  // from the cart drawer one day after being set.
  await kvSet(KV_KEYS.pinnedAccessoryIds, ids)
}

// ─── Product markdown twin cache purge (webhook-driven invalidation) ─────
//
// The product `.md` route caches its rendered body at `md:product:{handle}`
// for 900s (app/routes/products.$slug[.md].tsx). That cache key is not in
// KV_KEYS above because the route builds it as a plain template literal;
// mirror the exact same string here so a webhook can invalidate what a
// crawler might otherwise read stale for up to 15 minutes.
export function mdProductCacheKey(handle: string): string {
  return `md:product:${handle}`
}

/**
 * Purge the markdown twin cache for a single product handle, both the L1
 * in-memory read-through cache and the L2 KV entry. Cheap, precise, single
 * key. Call this from a products/update webhook so a price/availability
 * change is reflected on the next crawl instead of waiting out the TTL.
 *
 * Also purges the two handle-scoped Shopify read caches that back that same
 * PDP data (`shopify:p:{handle}` from getProductByHandle, `shopify:deal:
 * byhandle:{handle}` from getDealByHandle, both in shopify.server.ts). Both
 * are single-key deletes keyed only by handle, so purging them here is
 * trivially safe and keeps the HTML PDP in step with the markdown twin.
 */
export async function purgeMarkdownCache(handle: string): Promise<void> {
  const keys = [
    mdProductCacheKey(handle),
    `shopify:p:${handle}`,
    `shopify:deal:byhandle:${handle}`,
  ]
  for (const key of keys) readCache.delete(key)
  await Promise.all(keys.map(key => kvDel(key)))
}
