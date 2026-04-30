/**
 * sms-v2 shared types.
 * Phase 6c stub — other phases (6a, 6b, 6d) add their own types here.
 * This file is a "locked import" — phases read from it, don't modify each other's sections.
 */

// ─── Phase 6c — Knowledge-base result shape ───────────────────────────────

/**
 * KbContext — the shape returned by kbLookup().
 * Used by DISCOVERY, RESEARCH, PRESENTATION, OBJECTION, POST_PURCHASE stages
 * to inject policy / compatibility / FAQ copy into LLM context.
 */
export interface KbContext {
  topic: 'shipping' | 'returns' | 'compatibility' | 'troubleshooting' | 'brand'
  quickAnswer: string       // ≤280 chars; for SMS slot-fill
  bodyExcerpt?: string      // for IVR / web chat richer surface
  sourceId: string          // Sanity _id for tracing
  sourceTitle: string
}
