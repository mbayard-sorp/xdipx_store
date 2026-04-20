import { and, eq, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { pdpDialVotes } from '../../db/schema'
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
