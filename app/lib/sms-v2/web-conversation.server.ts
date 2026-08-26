/**
 * app/lib/sms-v2/web-conversation.server.ts
 *
 * Web conversation entity management for the v2 web chat pipeline.
 *
 * Mirrors conversation.server.ts but keyed by sessionId (UUID cookie)
 * instead of phone number. All the same rotation logic applies:
 *   - 24h session rotation: new conversation_id UUID + reset stage to RECONNECT.
 *   - 6h stage TTL: reset to DISCOVERY if intent doesn't match expected for stage.
 *   - On new session: no customer enrichment by phone (no phone available), but
 *     customerGid can be passed directly if known from Shopify customer auth.
 *
 * Exported:
 *   WebConversationRow
 *   getOrCreateWebConversation(sessionId, customerGid?) : Promise<WebConversationRow>
 *   applyWebStateWrites(sessionId, writes)              : Promise<void>
 */
import { eq } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { webConversations } from '../../../db/schema'
import type { Stage, Intent } from './types.server'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebConversationRow {
  sessionId: string
  conversationId: string
  stage: Stage
  currentPitchHandle: string | null
  currentUpsellHandle: string | null
  lastQuoteUrl: string | null
  lastQuoteItems: unknown
  lastQuoteCreatedAt: Date | null
  customerGid: string | null
  customerFirstName: string | null
  customerDefaultZip: string | null
  pageHandle: string | null
  pageRoute: string | null
  stageSetAt: Date
  lastActiveAt: Date
  /** Discovery gate state machine snapshot. Null for pre-gate rows. */
  discoveryState: unknown | null
  /** Accumulated discovery slots. Defaults to {} for pre-gate rows. */
  discoveredSlots: Record<string, unknown>
  /**
   * Pending PDP link awaiting affirmation. Voice-only today; the column
   * exists on web_conversations for forward-compatibility.
   */
  pendingPdpUrl: string | null
  /**
   * Migration 032: rolling Haiku-generated conversation summary.
   * Null until the first summarizer run after migration 032 ships.
   */
  conversationSummary: string | null
  /**
   * Migration 032: ordered log of last 10 pitched handles (most-recent last).
   */
  pitchedHandlesLog: string[] | null
}

// ---------------------------------------------------------------------------
// 6h stage TTL helpers (same logic as conversation.server.ts)
// ---------------------------------------------------------------------------

const STAGE_EXPECTED_INTENTS: Partial<Record<Stage, ReadonlyArray<Intent>>> = {
  PRESENTATION:  ['COMMIT_PICK', 'UPSELL_ACCEPT', 'UPSELL_DECLINE', 'OBJECTION', 'NAME_ITEM', 'RESEARCH'],
  OBJECTION:     ['COMMIT_PICK', 'UPSELL_ACCEPT', 'UPSELL_DECLINE', 'OBJECTION', 'RESEARCH'],
  UPSELL:        ['UPSELL_ACCEPT', 'UPSELL_DECLINE', 'COMMIT_PICK'],
  CHECKOUT:      ['COMMIT_PICK', 'SUPPORT'],
  POST_CHECKOUT: ['SUPPORT'],
  POST_PURCHASE: ['SUPPORT', 'NAME_ITEM', 'RESEARCH'],
  SUPPORT:       ['SUPPORT'],
}

function shouldResetStage(stage: Stage, stageSetAt: Date, newIntent: Intent): boolean {
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000)
  if (stageSetAt > sixHoursAgo) return false
  const expectedIntents = STAGE_EXPECTED_INTENTS[stage]
  if (!expectedIntents) return false
  return !expectedIntents.includes(newIntent)
}

// ---------------------------------------------------------------------------
// Main: getOrCreateWebConversation
// ---------------------------------------------------------------------------

/**
 * Lazily upsert a web_conversations row and apply rotation rules.
 *
 * Returns the current (possibly rotated) conversation row.
 *
 * If `newIntent` is provided, the 6h stage TTL check is applied.
 * `customerGid` is stored on first insert if provided (e.g. from Shopify auth).
 */
export async function getOrCreateWebConversation(
  sessionId: string,
  customerGid?: string,
  newIntent?: Intent,
): Promise<WebConversationRow> {
  const now = new Date()
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  const existing = await db
    .select()
    .from(webConversations)
    .where(eq(webConversations.sessionId, sessionId))
    .limit(1)

  const row = existing[0]

  // --- New session: insert ---
  if (!row) {
    await db.insert(webConversations).values({
      sessionId,
      stage: 'GREETING',
      stageSetAt: now,
      lastActiveAt: now,
      customerGid: customerGid ?? null,
    })

    const inserted = await db
      .select()
      .from(webConversations)
      .where(eq(webConversations.sessionId, sessionId))
      .limit(1)

    const newRow = inserted[0]
    if (!newRow) throw new Error(`[web-conversation] insert failed for sessionId=${sessionId}`)
    return newRow as unknown as WebConversationRow
  }

  // --- Existing session: check rotation rules ---
  let updates: Partial<typeof webConversations.$inferInsert> = { lastActiveAt: now }
  let stage = row.stage as Stage

  // 24h session rotation: new UUID + reset to RECONNECT + clear session-scoped
  // shopping state.
  //
  // Everything that describes *this shopping trip* is cleared: it is scoped to a
  // session (this sessionId's current visit), not to the browser cookie forever.
  // This mirrors the SMS rotation in conversation.server.ts, which already
  // clears these columns; the web rotation previously left them intact, so a
  // currentPitchHandle from a prior visit survived the RECONNECT. On 2026-08-25
  // (web, turns 1606-1621) a leftover prowler-prostate handle let a plain
  // discovery message ("I want to give her an amazing orgasm") route to an
  // UPSELL pitch before any product had been selected this session, and seeded
  // an anal-glide pitch to a man shopping for his wife (#5656). The
  // currentPitchHandle guard in pickEffectiveStage is only trustworthy when the
  // handle is genuinely session-scoped — clearing it here is what makes
  // "product selected this session" mean what it says on web.
  if (row.lastActiveAt < twentyFourHoursAgo) {
    updates = {
      ...updates,
      conversationId: crypto.randomUUID(),
      stage: 'RECONNECT',
      stageSetAt: now,
      // Session-scoped shopping state — cleared so the new visit starts clean.
      // Identity columns (customerGid, customerFirstName, customerDefaultZip)
      // are deliberately NOT touched: those belong to the person, not the trip.
      currentPitchHandle: null,
      currentUpsellHandle: null,
      discoveredSlots: {},
      discoveryState: null,
      pitchedHandlesLog: null,
      pendingPdpUrl: null,
    }
    stage = 'RECONNECT'
    console.info(`[web-conversation] 24h rotation for sessionId=${sessionId} new stage=RECONNECT sessionStateCleared=true`)
  }
  // 6h stage TTL: reset to DISCOVERY if intent doesn't match expected for stage
  else if (newIntent && shouldResetStage(stage, row.stageSetAt, newIntent)) {
    updates = {
      ...updates,
      stage: 'DISCOVERY',
      stageSetAt: now,
    }
    stage = 'DISCOVERY'
    console.info(
      `[web-conversation] 6h stage TTL: ${row.stage} → DISCOVERY for sessionId=${sessionId} intent=${newIntent}`,
    )
  }

  // If customerGid was not stored yet but we have one now, update it
  if (customerGid && !row.customerGid) {
    updates.customerGid = customerGid
  }

  await db
    .update(webConversations)
    .set(updates)
    .where(eq(webConversations.sessionId, sessionId))

  const updated = await db
    .select()
    .from(webConversations)
    .where(eq(webConversations.sessionId, sessionId))
    .limit(1)

  const finalRow = updated[0]
  if (!finalRow) throw new Error(`[web-conversation] read-after-update failed for sessionId=${sessionId}`)
  return finalRow as unknown as WebConversationRow
}

// ---------------------------------------------------------------------------
// State writes
// ---------------------------------------------------------------------------

/**
 * Apply a set of state writes to the web_conversations row.
 * Called by the web adapter after the stage handler resolves a reply.
 */
export async function applyWebStateWrites(
  sessionId: string,
  writes: {
    stage?: Stage
    currentPitchHandle?: string | null
    currentUpsellHandle?: string | null
    lastQuoteUrl?: string | null
    lastQuoteItems?: unknown | null
    lastQuoteCreatedAt?: Date | null
    customerGid?: string | null
    pageHandle?: string | null
    pageRoute?: string | null
    discoveryState?: unknown | null
    discoveredSlots?: Record<string, unknown>
    /** ADR-003 Sub-decision B: rolling summary written by the dispatcher summarizer. */
    conversationSummary?: string | null
    /** ADR-003 Sub-decision B: ordered log of last 10 pitched handles. */
    pitchedHandlesLog?: string[] | null
  },
): Promise<void> {
  const now = new Date()
  const updates: Partial<typeof webConversations.$inferInsert> = { lastActiveAt: now }

  if (writes.stage !== undefined) {
    updates.stage = writes.stage
    updates.stageSetAt = now
  }
  if (writes.currentPitchHandle !== undefined) updates.currentPitchHandle = writes.currentPitchHandle
  if (writes.currentUpsellHandle !== undefined) updates.currentUpsellHandle = writes.currentUpsellHandle
  if (writes.lastQuoteUrl !== undefined) updates.lastQuoteUrl = writes.lastQuoteUrl
  if (writes.lastQuoteItems !== undefined) updates.lastQuoteItems = writes.lastQuoteItems
  if (writes.lastQuoteCreatedAt !== undefined) updates.lastQuoteCreatedAt = writes.lastQuoteCreatedAt
  if (writes.customerGid !== undefined) updates.customerGid = writes.customerGid
  if (writes.pageHandle !== undefined) updates.pageHandle = writes.pageHandle
  if (writes.pageRoute !== undefined) updates.pageRoute = writes.pageRoute
  if (writes.discoveryState !== undefined) updates.discoveryState = writes.discoveryState
  if (writes.discoveredSlots !== undefined) updates.discoveredSlots = writes.discoveredSlots
  // ADR-003 Sub-decision B: memory primitive writes — mirrors sms applyStateWrites.
  if (writes.conversationSummary !== undefined) updates.conversationSummary = writes.conversationSummary
  if (writes.pitchedHandlesLog   !== undefined) updates.pitchedHandlesLog   = writes.pitchedHandlesLog

  await db.update(webConversations).set(updates).where(eq(webConversations.sessionId, sessionId))
}
