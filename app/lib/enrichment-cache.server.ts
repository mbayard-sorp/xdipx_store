/**
 * Generated-content cache for the Phase 1 import + backfill pipelines.
 *
 * Cache key:  (productId, fieldName, voiceHash, promptVersion)
 *
 * Strategy: cache the entire orchestrator `writes` payload as one row with
 * fieldName='all'. On a cache hit (matching voiceHash AND promptVersion),
 * the caller skips the orchestrator entirely and reuses the cached writes.
 *
 * `--mode=full` callers bypass the cache (overwrite). `--mode=fill-gaps`
 * (default) and `--mode=refresh` honor the cache. Per-field caching is a
 * Phase 2 concern; for now the all-or-nothing model captures the biggest
 * cost win (orchestrator Sonnet roundtrips).
 *
 * Backed by `product_enrichment_cache` table — see
 * db/migrations/016_product_enrichment_cache.sql.
 */
import { and, eq } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { db } from '~/lib/db.server'
import { productEnrichmentCache } from '../../db/schema'
import type { ProductWrites } from '~/lib/emma-orchestrator.server'

/**
 * Bump this when prompt structure changes (e.g. D3 Title Case migration).
 * Cached writes with a different version are treated as misses, forcing a
 * regen with the new prompts. Format is opaque to the cache logic — any
 * unique string (semver, date, integer) works.
 */
export const PROMPT_VERSION = '2026-04-27.d3'

/**
 * Hash the brand voice for cache invalidation. When the operator changes the
 * pipelineSettings.brandVoice (or the `--brand-voice` override), every cached
 * row becomes a miss and the orchestrator re-runs with the new voice. The
 * hash is stable: same voice text → same hash → cache hit on re-run.
 */
export function hashVoice(brandVoice: string | null | undefined): string {
  return createHash('sha1').update(brandVoice ?? '').digest('hex').slice(0, 32)
}

/** Read a cached orchestrator writes payload for the given product. Returns
 *  null on miss or stale (different voiceHash or promptVersion). */
export async function getCachedWrites(
  productId: string,
  voiceHash: string,
): Promise<{ writes: ProductWrites; generatedAt: Date } | null> {
  const [row] = await db
    .select({
      content:     productEnrichmentCache.content,
      generatedAt: productEnrichmentCache.generatedAt,
    })
    .from(productEnrichmentCache)
    .where(and(
      eq(productEnrichmentCache.productId,     productId),
      eq(productEnrichmentCache.fieldName,     'all'),
      eq(productEnrichmentCache.voiceHash,     voiceHash),
      eq(productEnrichmentCache.promptVersion, PROMPT_VERSION),
    ))
    .limit(1)
  if (!row) return null
  return { writes: row.content as ProductWrites, generatedAt: row.generatedAt }
}

/** Insert (or upsert) a cache row for the given product. The unique index on
 *  (productId, fieldName, voiceHash, promptVersion) makes the upsert
 *  idempotent — repeat writes with the same key replace content. */
export async function setCachedWrites(
  productId: string,
  voiceHash: string,
  writes: ProductWrites,
  meta: { model: string; inputTokens: number; outputTokens: number },
): Promise<void> {
  await db
    .insert(productEnrichmentCache)
    .values({
      productId,
      fieldName:     'all',
      voiceHash,
      promptVersion: PROMPT_VERSION,
      content:       writes as unknown as object,
      model:         meta.model,
      inputTokens:   meta.inputTokens,
      outputTokens:  meta.outputTokens,
    })
    .onConflictDoUpdate({
      target: [
        productEnrichmentCache.productId,
        productEnrichmentCache.fieldName,
        productEnrichmentCache.voiceHash,
        productEnrichmentCache.promptVersion,
      ],
      set: {
        content:       writes as unknown as object,
        model:         meta.model,
        inputTokens:   meta.inputTokens,
        outputTokens:  meta.outputTokens,
        generatedAt:   new Date(),
      },
    })
}
