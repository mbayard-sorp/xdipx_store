import { or, eq, desc, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { productCopurchase } from '../../db/schema'
import { kvGetMemo, kvSet, primeKvMemo, KV_KEYS } from '~/lib/kv.server'
import { getProductByHandle, getProductsByTag } from '~/lib/shopify.server'

const TTL_SECONDS = 60 * 60

export async function getFrequentlyBoughtWith(handle: string, limit = 4): Promise<string[]> {
  const cacheKey = KV_KEYS.fbt(handle)
  const cached = await kvGetMemo<string[]>(cacheKey, 300)
  if (cached) return cached.slice(0, limit)

  let fromCopurchase: string[] = []
  try {
    const rows = await db
      .select({
        other: sql<string>`CASE WHEN ${productCopurchase.handleA} = ${handle} THEN ${productCopurchase.handleB} ELSE ${productCopurchase.handleA} END`,
        count: productCopurchase.count,
      })
      .from(productCopurchase)
      .where(or(eq(productCopurchase.handleA, handle), eq(productCopurchase.handleB, handle)))
      .orderBy(desc(productCopurchase.count))
      .limit(limit * 2)
    fromCopurchase = rows.map(r => r.other).filter(Boolean)
  } catch (err) {
    console.error('[recommendations] copurchase query failed:', err)
  }

  let handles = fromCopurchase.slice(0, limit)

  if (handles.length < limit) {
    const fallback = await getColdStartFallback(handle, limit - handles.length, new Set(handles))
    handles = [...handles, ...fallback]
  }

  if (handles.length > 0) {
    await kvSet(cacheKey, handles, TTL_SECONDS).catch(() => {})
    primeKvMemo(cacheKey, handles)
  }

  return handles
}

async function getColdStartFallback(handle: string, limit: number, exclude: Set<string>): Promise<string[]> {
  try {
    const product = await getProductByHandle(handle)
    if (!product) return []

    const tag = product.tags?.[0]
    if (!tag) return []

    const products = await getProductsByTag(tag, limit + 5)
    return products
      .map(p => p.handle)
      .filter(h => h !== handle && !exclude.has(h))
      .slice(0, limit)
  } catch {
    return []
  }
}
