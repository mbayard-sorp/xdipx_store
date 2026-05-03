/**
 * app/lib/sms-v2/conversation.server.ts
 *
 * Conversation entity management for the v2 SMS pipeline.
 *
 * Handles:
 *   - Lazy upsert of sms_conversations rows (one per phone)
 *   - 24h session rotation: if last_active_at < now() - 24h, rotate
 *     conversation_id (new UUID) and reset stage to RECONNECT
 *   - 6h stage TTL: if stage_set_at < now() - 6h AND the new intent doesn't
 *     match the expected intent for the current stage, reset to DISCOVERY
 *   - On new phone: attempt lookupReturningCustomer and populate customer_gid,
 *     customer_first_name, customer_default_zip (failure is non-fatal)
 *
 * Exported:
 *   getOrCreateConversation(phone): Promise<ConversationRow>
 */
import { eq } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { smsConversations } from '../../../db/schema'
import { findCustomerByPhone } from '~/lib/shopify.server'
import type { Stage, Intent } from './types.server'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationRow {
  phone: string
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
  stageSetAt: Date
  lastActiveAt: Date
  /** Discovery gate state machine snapshot. Null for pre-gate rows. */
  discoveryState: unknown | null
  /** Accumulated discovery slots. Defaults to {} for pre-gate rows. */
  discoveredSlots: Record<string, unknown>
  /**
   * Voice-channel pending PDP link awaiting caller permission.
   * The voice adapter sets this when a stage handler returns a productCard
   * with pdpUrl; the next caller turn can affirm ("yes", "send it") to trigger
   * the SMS, or any other response clears it. Null when no link is pending.
   */
  pendingPdpUrl: string | null
}

// ---------------------------------------------------------------------------
// Expected intent families per stage (for 6h stage TTL check)
// These are "the intent classes that make sense in this stage". If the new
// intent is completely foreign to the stage, we reset.
// ---------------------------------------------------------------------------

const STAGE_EXPECTED_INTENTS: Partial<Record<Stage, ReadonlyArray<Intent>>> = {
  PRESENTATION:   ['COMMIT_PICK', 'UPSELL_ACCEPT', 'UPSELL_DECLINE', 'OBJECTION', 'NAME_ITEM', 'RESEARCH'],
  OBJECTION:      ['COMMIT_PICK', 'UPSELL_ACCEPT', 'UPSELL_DECLINE', 'OBJECTION', 'RESEARCH'],
  UPSELL:         ['UPSELL_ACCEPT', 'UPSELL_DECLINE', 'COMMIT_PICK'],
  CHECKOUT:       ['COMMIT_PICK', 'SUPPORT'],
  POST_CHECKOUT:  ['SUPPORT'],
  POST_PURCHASE:  ['SUPPORT', 'NAME_ITEM', 'RESEARCH'],
  SUPPORT:        ['SUPPORT'],
}

function shouldResetStage(stage: Stage, stageSetAt: Date, newIntent: Intent): boolean {
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000)
  if (stageSetAt > sixHoursAgo) return false

  const expectedIntents = STAGE_EXPECTED_INTENTS[stage]
  if (!expectedIntents) return false // GREETING/CONSENT_GATE/DISCOVERY/RECONNECT always OK

  return !expectedIntents.includes(newIntent)
}

// ---------------------------------------------------------------------------
// Customer enrichment on first contact
// ---------------------------------------------------------------------------

async function tryEnrichCustomer(phone: string): Promise<{
  gid: string | null
  firstName: string | null
  defaultZip: string | null
}> {
  try {
    const customer = await findCustomerByPhone(phone)
    if (!customer) return { gid: null, firstName: null, defaultZip: null }
    const zip = customer.defaultAddress?.zip ?? null
    return { gid: customer.id, firstName: customer.firstName, defaultZip: zip }
  } catch (err) {
    console.warn('[conversation] lookupReturningCustomer failed — leaving nulls', err)
    return { gid: null, firstName: null, defaultZip: null }
  }
}

// ---------------------------------------------------------------------------
// Main: getOrCreateConversation
// ---------------------------------------------------------------------------

/**
 * Lazily upsert a conversation row and apply rotation rules.
 *
 * Returns the current (possibly rotated) conversation row.
 *
 * If `newIntent` is provided, the 6h stage TTL check is applied.
 */
export async function getOrCreateConversation(
  phone: string,
  newIntent?: Intent,
): Promise<ConversationRow> {
  const now = new Date()
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  // Try to find existing row
  const existing = await db
    .select()
    .from(smsConversations)
    .where(eq(smsConversations.phone, phone))
    .limit(1)

  const row = existing[0]

  // --- New phone: insert with customer enrichment ---
  if (!row) {
    const enriched = await tryEnrichCustomer(phone)
    await db.insert(smsConversations).values({
      phone,
      stage: 'GREETING',
      stageSetAt: now,
      lastActiveAt: now,
      customerGid: enriched.gid,
      customerFirstName: enriched.firstName,
      customerDefaultZip: enriched.defaultZip,
    })

    const inserted = await db
      .select()
      .from(smsConversations)
      .where(eq(smsConversations.phone, phone))
      .limit(1)

    const newRow = inserted[0]
    if (!newRow) throw new Error(`[conversation] insert failed for phone=${phone}`)
    return newRow as ConversationRow
  }

  // --- Existing phone: check rotation rules ---
  let updates: Partial<typeof smsConversations.$inferInsert> = { lastActiveAt: now }
  let stage = row.stage as Stage

  // 24h session rotation: new UUID + reset to RECONNECT
  if (row.lastActiveAt < twentyFourHoursAgo) {
    updates = {
      ...updates,
      // Drizzle's uuid default generates a new UUID when we don't specify one,
      // but we need to explicitly rotate — use crypto.randomUUID()
      conversationId: crypto.randomUUID(),
      stage: 'RECONNECT',
      stageSetAt: now,
    }
    stage = 'RECONNECT'
    console.info(`[conversation] 24h rotation for phone=${phone} new stage=RECONNECT`)
  }
  // 6h stage TTL: reset to DISCOVERY if intent doesn't match expected for stage
  else if (
    newIntent &&
    shouldResetStage(stage, row.stageSetAt, newIntent)
  ) {
    updates = {
      ...updates,
      stage: 'DISCOVERY',
      stageSetAt: now,
    }
    stage = 'DISCOVERY'
    console.info(
      `[conversation] 6h stage TTL: ${row.stage} → DISCOVERY for phone=${phone} intent=${newIntent}`,
    )
  }

  await db
    .update(smsConversations)
    .set(updates)
    .where(eq(smsConversations.phone, phone))

  // Re-read to get the final state (especially the possibly-new conversationId)
  const updated = await db
    .select()
    .from(smsConversations)
    .where(eq(smsConversations.phone, phone))
    .limit(1)

  const finalRow = updated[0]
  if (!finalRow) throw new Error(`[conversation] read-after-update failed for phone=${phone}`)
  return finalRow as ConversationRow
}

/**
 * Apply a set of state writes to the conversation row.
 * Called by the stage handler after it resolves a reply.
 */
export async function applyStateWrites(
  phone: string,
  writes: {
    stage?: Stage
    currentPitchHandle?: string | null
    currentUpsellHandle?: string | null
    lastQuoteUrl?: string | null
    lastQuoteItems?: unknown | null
    lastQuoteCreatedAt?: Date | null
    customerGid?: string | null
    discoveryState?: unknown | null
    discoveredSlots?: Record<string, unknown>
    pendingPdpUrl?: string | null
  },
): Promise<void> {
  const now = new Date()
  const updates: Partial<typeof smsConversations.$inferInsert> = { lastActiveAt: now }

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
  if (writes.discoveryState !== undefined) updates.discoveryState = writes.discoveryState
  if (writes.discoveredSlots !== undefined) updates.discoveredSlots = writes.discoveredSlots
  if (writes.pendingPdpUrl !== undefined) updates.pendingPdpUrl = writes.pendingPdpUrl

  await db.update(smsConversations).set(updates).where(eq(smsConversations.phone, phone))
}
