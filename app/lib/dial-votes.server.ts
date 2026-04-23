import { and, eq, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { pdpDialVotes, pdpProductVotes } from '../../db/schema'
import { cached, invalidateCache, KV_KEYS } from '~/lib/kv.server'

export interface DialAggregate {
  agreePct: number
  votes:    number
}

/**
 * Aggregates per-dimension 👍/👎 counts for a product into {agreePct, votes}.
 * Cached in KV for 5 min (the dial rarely moves minute-to-minute).
 */
export async function getDialAggregates(
  shopifyProductId: string,
): Promise<Record<string, DialAggregate>> {
  return cached(KV_KEYS.dialAggregate(shopifyProductId), 300, async () => {
    const rows = await db
      .select({
        dimension: pdpDialVotes.dimension,
        agree:     sql<number>`sum(case when ${pdpDialVotes.vote} > 0 then 1 else 0 end)`.mapWith(Number),
        total:     sql<number>`count(*)`.mapWith(Number),
      })
      .from(pdpDialVotes)
      .where(eq(pdpDialVotes.shopifyProductId, shopifyProductId))
      .groupBy(pdpDialVotes.dimension)

    const out: Record<string, DialAggregate> = {}
    for (const r of rows) {
      if (r.total > 0) {
        out[r.dimension] = {
          votes:    r.total,
          agreePct: Math.round((r.agree / r.total) * 100),
        }
      }
    }
    return out
  })
}

/**
 * Upserts a single customer's vote for (product, dimension).
 * Returns `{ ok: true }` on success or `{ ok: false, reason }` on conflict.
 * One vote per (shopifyProductId, dimension, customerGid) — unique index enforces it.
 */
export async function castDialVote(params: {
  shopifyProductId: string
  dimension:        string
  customerGid:      string
  vote:             1 | -1
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { shopifyProductId, dimension, customerGid, vote } = params

  // Upsert — change vote direction if the user flips their mind
  await db
    .insert(pdpDialVotes)
    .values({ shopifyProductId, dimension, customerGid, vote })
    .onConflictDoUpdate({
      target: [pdpDialVotes.shopifyProductId, pdpDialVotes.dimension, pdpDialVotes.customerGid],
      set:    { vote },
    })

  invalidateCache(KV_KEYS.dialAggregate(shopifyProductId))
  return { ok: true }
}

/** Returns this customer's existing votes for a product keyed by dimension. */
export async function getCustomerVotes(
  shopifyProductId: string,
  customerGid:      string,
): Promise<Record<string, 1 | -1>> {
  const rows = await db
    .select({ dimension: pdpDialVotes.dimension, vote: pdpDialVotes.vote })
    .from(pdpDialVotes)
    .where(and(eq(pdpDialVotes.shopifyProductId, shopifyProductId), eq(pdpDialVotes.customerGid, customerGid)))

  const out: Record<string, 1 | -1> = {}
  for (const r of rows) {
    out[r.dimension] = (r.vote >= 1 ? 1 : -1)
  }
  return out
}

// ─── Product-level aggregate votes (v2 PDP redesign) ─────────────────────

export interface ProductVoteAggregate {
  agrees:    number
  disagrees: number
  agreePct:  number
}

/**
 * Returns {agrees, disagrees, agreePct} for the product's aggregate vote.
 * Cached in KV for 5 min.
 */
export async function getProductVoteAggregate(
  shopifyProductId: string,
): Promise<ProductVoteAggregate> {
  return cached(KV_KEYS.productVoteAggregate(shopifyProductId), 300, async () => {
    const [row] = await db
      .select({
        agrees:    sql<number>`sum(case when ${pdpProductVotes.vote} > 0 then 1 else 0 end)`.mapWith(Number),
        disagrees: sql<number>`sum(case when ${pdpProductVotes.vote} < 0 then 1 else 0 end)`.mapWith(Number),
        total:     sql<number>`count(*)`.mapWith(Number),
      })
      .from(pdpProductVotes)
      .where(eq(pdpProductVotes.shopifyProductId, shopifyProductId))

    const agrees    = row?.agrees    ?? 0
    const disagrees = row?.disagrees ?? 0
    const total     = row?.total     ?? 0
    const agreePct  = total > 0 ? Math.round((agrees / total) * 100) : 0
    return { agrees, disagrees, agreePct }
  })
}

/**
 * Upserts a customer's aggregate vote for a product. Flipping is allowed —
 * the unique index on (product, customer) guarantees one vote per user.
 */
export async function castProductVote(params: {
  shopifyProductId: string
  customerGid:      string
  vote:             1 | -1
}): Promise<{ ok: true }> {
  const { shopifyProductId, customerGid, vote } = params

  await db
    .insert(pdpProductVotes)
    .values({ shopifyProductId, customerGid, vote })
    .onConflictDoUpdate({
      target: [pdpProductVotes.shopifyProductId, pdpProductVotes.customerGid],
      set:    { vote },
    })

  invalidateCache(KV_KEYS.productVoteAggregate(shopifyProductId))
  return { ok: true }
}

/** Returns this customer's existing product-level vote, or null if none. */
export async function getCustomerProductVote(
  shopifyProductId: string,
  customerGid:      string,
): Promise<1 | -1 | null> {
  const [row] = await db
    .select({ vote: pdpProductVotes.vote })
    .from(pdpProductVotes)
    .where(and(
      eq(pdpProductVotes.shopifyProductId, shopifyProductId),
      eq(pdpProductVotes.customerGid, customerGid),
    ))
    .limit(1)

  if (!row) return null
  return row.vote >= 1 ? 1 : -1
}
