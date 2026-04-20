/**
 * Vercel KV wrapper — gracefully no-ops when KV is not configured (local dev).
 * Falls back to an in-memory store so local dev workflows (e.g. bulk import) work
 * without needing KV credentials.
 * All Vercel-specific code stays in server/ or here; never imported inside app/routes.
 */

let _kv: Awaited<ReturnType<typeof import('@vercel/kv').createClient>> | null = null

async function getKV() {
  if (_kv) return _kv
  if (!process.env['KV_REST_API_URL'] || !process.env['KV_REST_API_TOKEN']) return null
  const { createClient } = await import('@vercel/kv')
  _kv = createClient({
    url:   process.env['KV_REST_API_URL']!,
    token: process.env['KV_REST_API_TOKEN']!,
  })
  return _kv
}

// In-memory fallback used when KV is not configured (local dev).
// Stored on globalThis so it survives Vite HMR module re-evaluation.
const _g = globalThis as unknown as { __kvMemStore?: Map<string, unknown> }
if (!_g.__kvMemStore) _g.__kvMemStore = new Map()
const memStore = _g.__kvMemStore

export async function kvGet<T>(key: string): Promise<T | null> {
  const kv = await getKV()
  if (kv) return kv.get<T>(key)
  return (memStore.get(key) as T) ?? null
}

export async function kvSet(key: string, value: unknown, _exSeconds?: number): Promise<void> {
  const kv = await getKV()
  if (kv) {
    if (_exSeconds) {
      await kv.set(key, value, { ex: _exSeconds })
    } else {
      await kv.set(key, value)
    }
    return
  }
  memStore.set(key, value)
}

export async function kvIncr(key: string): Promise<number> {
  const kv = await getKV()
  if (kv) return kv.incr(key)
  const current = (memStore.get(key) as number) ?? 0
  memStore.set(key, current + 1)
  return current + 1
}

export async function kvDel(key: string): Promise<void> {
  const kv = await getKV()
  if (kv) { await kv.del(key); return }
  memStore.delete(key)
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
  collectionCursor:       (handle: string, page: number) => `vault:cursor:${handle}:p${page}`,
  // v2 redesign — dial vote aggregates (5-min TTL)
  dialAggregate:          (shopifyProductId: string) => `dial:agg:${shopifyProductId}`,
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
