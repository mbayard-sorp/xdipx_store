// pricing-velocity.server.ts
// Computes velocity bucket per variant from 60-day Shopify order data.
// Bucket is cached in pipeline_settings keyed velocity:{variantId} for 24h.
// Tradeoff: pipeline_settings is a simple k/v table we already have; adding a
// dedicated pricing_velocity_cache table would be cleaner for bulk queries but
// requires a new migration. Using pipeline_settings avoids schema churn until
// Phase 5 reviews whether a dedicated table is warranted.

import { adminGraphQL } from './shopify.server'
import { db } from './db.server'
import { pipelineSettings } from '../../db/schema'
import { eq } from 'drizzle-orm'
import type { VelocityBucket } from './pricing-engine-v2.server'

// ---------------------------------------------------------------------------
// Constants (spec ss4)
// ---------------------------------------------------------------------------

const FAST_UNITS_PER_WEEK   = 2      // top bucket threshold
const SLOW_UNITS_PER_WEEK   = 0.25   // below this -> slow
const DEAD_WINDOW_DAYS      = 60     // 0 sales in this window -> dead candidate
const MIN_STOCK_FOR_SLOW    = 5      // N: only mark slow/dead if stock >= N
const CACHE_TTL_SECS        = 24 * 60 * 60 // 24 hours

// ---------------------------------------------------------------------------
// Shopify Admin query: count line-item quantity for one variant in last 60 days
// ---------------------------------------------------------------------------

interface OrderCountResult {
  orders: {
    nodes: Array<{
      lineItems: {
        nodes: Array<{
          quantity:        number
          variant:         { id: string } | null
          currentQuantity: number
        }>
      }
    }>
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
  }
}

const ORDERS_QUERY = `
  query OrdersForVariant($query: String!, $first: Int!, $after: String) {
    orders(first: $first, after: $after, query: $query) {
      nodes {
        lineItems(first: 50) {
          nodes {
            quantity
            currentQuantity
            variant { id }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

async function fetchUnits60d(variantGid: string): Promise<number> {
  const since = new Date(Date.now() - DEAD_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const sinceStr = since.toISOString().slice(0, 10)
  const queryStr = `created_at:>='${sinceStr}' status:any`

  let totalUnits = 0
  let cursor: string | null = null
  const PAGE = 50

  do {
    const data: OrderCountResult = await adminGraphQL<OrderCountResult>(ORDERS_QUERY, {
      query: queryStr,
      first: PAGE,
      after: cursor ?? null,
    })

    for (const order of data.orders.nodes) {
      for (const item of order.lineItems.nodes) {
        if (item.variant?.id === variantGid) {
          totalUnits += item.quantity
        }
      }
    }

    cursor = data.orders.pageInfo.hasNextPage
      ? (data.orders.pageInfo.endCursor ?? null)
      : null
  } while (cursor !== null)

  return totalUnits
}

// ---------------------------------------------------------------------------
// Inventory query (to check MIN_STOCK_FOR_SLOW)
// ---------------------------------------------------------------------------

interface InventoryResult {
  productVariant: {
    inventoryQuantity: number | null
  } | null
}

const INVENTORY_QUERY = `
  query VariantInventory($id: ID!) {
    productVariant(id: $id) {
      inventoryQuantity
    }
  }
`

async function fetchInventory(variantGid: string): Promise<number> {
  try {
    const data = await adminGraphQL<InventoryResult>(INVENTORY_QUERY, { id: variantGid })
    return data.productVariant?.inventoryQuantity ?? 0
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Pipeline-settings cache helpers
// ---------------------------------------------------------------------------

interface VelocityCachePayload {
  bucket:     VelocityBucket
  units60d:   number
  computedAt: string
}

function cacheKey(variantId: string): string {
  // pipeline_settings.key is varchar(50); the full Shopify GID
  // (gid://shopify/ProductVariant/...) overflows it and the write 22001s,
  // so key on just the numeric variant id.
  return `velocity:${variantId.split('/').pop() ?? variantId}`
}

async function readCache(variantId: string): Promise<VelocityBucket | null> {
  try {
    const rows = await db
      .select({ value: pipelineSettings.value })
      .from(pipelineSettings)
      .where(eq(pipelineSettings.key, cacheKey(variantId)))
      .limit(1)
    if (!rows[0]?.value) return null
    const payload = JSON.parse(rows[0].value) as VelocityCachePayload
    const ageMs = Date.now() - new Date(payload.computedAt).getTime()
    if (ageMs > CACHE_TTL_SECS * 1000) return null
    return payload.bucket
  } catch {
    return null
  }
}

async function writeCache(variantId: string, bucket: VelocityBucket, units60d: number): Promise<void> {
  const payload: VelocityCachePayload = {
    bucket,
    units60d,
    computedAt: new Date().toISOString(),
  }
  try {
    await db
      .insert(pipelineSettings)
      .values({ key: cacheKey(variantId), value: JSON.stringify(payload) })
      .onConflictDoUpdate({
        target: pipelineSettings.key,
        set: { value: JSON.stringify(payload), updatedAt: new Date() },
      })
  } catch (err) {
    console.warn('[pricing-velocity] cache write failed:', err)
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute (or return cached) velocity bucket for a variant.
 * Falls back to 'normal' on Shopify errors to avoid blocking a price update.
 */
export async function computeVelocityBucket(variantGid: string): Promise<VelocityBucket> {
  const cached = await readCache(variantGid)
  if (cached !== null) return cached

  try {
    const [units60d, stock] = await Promise.all([
      fetchUnits60d(variantGid),
      fetchInventory(variantGid),
    ])

    const weeksInWindow = DEAD_WINDOW_DAYS / 7
    const unitsPerWeek  = units60d / weeksInWindow

    let bucket: VelocityBucket
    if (unitsPerWeek > FAST_UNITS_PER_WEEK) {
      bucket = 'top'
    } else if (unitsPerWeek >= SLOW_UNITS_PER_WEEK) {
      bucket = 'normal'
    } else if (units60d === 0 && stock >= MIN_STOCK_FOR_SLOW) {
      bucket = 'dead'
    } else if (stock >= MIN_STOCK_FOR_SLOW) {
      bucket = 'slow'
    } else {
      bucket = 'normal'
    }

    await writeCache(variantGid, bucket, units60d)
    return bucket
  } catch (err) {
    console.warn('[pricing-velocity] Shopify query failed, defaulting to normal:', err)
    return 'normal'
  }
}

/** Force-evict a variant's velocity cache (e.g. after a manual override). */
export async function invalidateVelocityCache(variantGid: string): Promise<void> {
  try {
    await db
      .delete(pipelineSettings)
      .where(eq(pipelineSettings.key, cacheKey(variantGid)))
  } catch {
    // ignore
  }
}
