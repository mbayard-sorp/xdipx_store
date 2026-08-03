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
  /**
   * Migration 032: Haiku-generated rolling summary (1-2 sentences).
   * Updated fire-and-forget after each turn. Injected into buildSystemPrompt
   * via the <known_about_customer> block so the agent retains context beyond
   * the HISTORY_LIMIT window. Copied forward on 24h rotation with the prefix
   * "From a previous conversation: {summary}".
   */
  conversationSummary: string | null
  /**
   * Migration 032: ordered array of the last 10 pitched product handles
   * (most-recent last). Enables resolution of "the first one you showed me"
   * references in multi-pitch conversations.
   */
  pitchedHandlesLog: string[] | null
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

/**
 * Task 0.8: Soften the stage TTL (Option B: extend to 24h + intent confidence gate).
 *
 * The old 6h reset fired silently and discarded the entire stage context the
 * moment an intent classifier returned something unexpected — producing the
 * "she just totally changed gears" derail.
 *
 * New behavior:
 *   - TTL extended from 6h to 24h (matching the session rotation boundary).
 *     A customer who texted yesterday is genuinely a "restart", not a customer
 *     who texted 7 hours ago.
 *   - Reset only fires when the incoming intent confidence is >= 0.75. Low-
 *     confidence intent classifications (common on ambiguous messages like
 *     "ok" or "hmm") no longer silently nuke the stage.
 *   - Suppressed resets are logged at console.info so the log-monitor role can
 *     see them without them being noisy in production.
 *
 * A hard 48h backstop is NOT needed in Phase 0 because the 24h rotation
 * (session UUID flip) already provides the principled reset point. The two
 * reset mechanisms are now aligned rather than overlapping.
 */
function shouldResetStage(
  stage: Stage,
  stageSetAt: Date,
  newIntent: Intent,
  intentConfidence: number,
): boolean {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  if (stageSetAt > twentyFourHoursAgo) return false

  const expectedIntents = STAGE_EXPECTED_INTENTS[stage]
  if (!expectedIntents) return false // GREETING/CONSENT_GATE/DISCOVERY/RECONNECT always OK

  if (expectedIntents.includes(newIntent)) return false

  // Low-confidence intent: suppress reset, let the agent decide.
  if (intentConfidence < 0.75) {
    console.info(
      `[conversation] stage-TTL reset SUPPRESSED: stage=${stage} intent=${newIntent} confidence=${intentConfidence.toFixed(2)} (< 0.75 threshold)`,
    )
    return false
  }

  return true
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
// Summary bridging
// ---------------------------------------------------------------------------

const SUMMARY_BRIDGE_PREFIX = 'From a previous conversation: '
// Matches one or more stacked bridge prefixes at the head of a summary.
const STACKED_BRIDGE_PREFIX_RE = /^(?:From a previous conversation:\s*)+/i

/**
 * Prefix a carried-forward summary exactly once.
 *
 * Every 24h rotation re-prefixed whatever was already stored, so a summary that
 * survived six rotations arrived at the model as "From a previous conversation:
 * From a previous conversation: ... Customer is purchasing ...". That burns
 * context on nothing and reads to the model as six distinct prior sessions.
 * Strip any prefixes already present before adding ours.
 */
export function bridgeSummary(priorSummary: string | null | undefined): string | null {
  const stripped = (priorSummary ?? '').replace(STACKED_BRIDGE_PREFIX_RE, '').trim()
  if (!stripped) return null
  return `${SUMMARY_BRIDGE_PREFIX}${stripped}`
}

// ---------------------------------------------------------------------------
// Main: getOrCreateConversation
// ---------------------------------------------------------------------------

/**
 * Lazily upsert a conversation row and apply rotation rules.
 *
 * Returns the current (possibly rotated) conversation row.
 *
 * If `newIntent` is provided, the stage TTL check is applied (Task 0.8:
 * now gated on 24h TTL + intentConfidence >= 0.75 — see shouldResetStage).
 * `intentConfidence` defaults to 1.0 when not provided so callers that pass
 * only `newIntent` get the same behavior as before (reset fires when TTL
 * and intent mismatch are both true).
 */
export async function getOrCreateConversation(
  phone: string,
  newIntent?: Intent,
  intentConfidence: number = 1.0,
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

  // 24h session rotation: new UUID + reset to RECONNECT + clear session-scoped
  // shopping state.
  //
  // The conversation_summary is copied forward as a context bridge so the agent
  // can greet a returning customer without being a stranger. Everything else
  // that describes *this shopping trip* is cleared: it is scoped to a session,
  // not to a phone number.
  //
  // This used to rotate the id and stage while leaving discoveredSlots intact,
  // so a slot captured weeks earlier kept steering brand-new conversations. A
  // caller who opened with "I'm shopping for a new vibrator" was answered
  // against a stale priceMax=10 and subtype=plug from a previous session; Emma
  // told them their results were "all above your ten dollar budget" for a
  // budget they never named on that call.
  if (row.lastActiveAt < twentyFourHoursAgo) {
    const priorSummary = (row as unknown as { conversationSummary?: string | null }).conversationSummary ?? null
    const bridgedSummary: string | null = bridgeSummary(priorSummary)
    updates = {
      ...updates,
      // Drizzle's uuid default generates a new UUID when we don't specify one,
      // but we need to explicitly rotate — use crypto.randomUUID()
      conversationId: crypto.randomUUID(),
      stage: 'RECONNECT',
      stageSetAt: now,
      // Bridge the summary forward; pitchedHandlesLog is intentionally NOT
      // carried over — a 24h gap justifies a fresh pitch slate.
      ...(bridgedSummary !== null && { conversationSummary: bridgedSummary }),
      // Session-scoped state — cleared so the new conversation starts clean.
      // Identity columns (customerGid, customerFirstName, customerDefaultZip)
      // are deliberately NOT touched: those belong to the person, not the trip.
      discoveredSlots: {},
      discoveryState: null,
      pitchedHandlesLog: null,
      currentPitchHandle: null,
      currentUpsellHandle: null,
      pendingPdpUrl: null,
    }
    stage = 'RECONNECT'
    console.info(`[conversation] 24h rotation for phone=${phone} new stage=RECONNECT summaryBridged=${bridgedSummary !== null} sessionStateCleared=true`)
  }
  // Stage TTL check (Task 0.8: 24h + confidence gate — see shouldResetStage).
  else if (
    newIntent &&
    shouldResetStage(stage, row.stageSetAt, newIntent, intentConfidence)
  ) {
    updates = {
      ...updates,
      stage: 'DISCOVERY',
      stageSetAt: now,
    }
    stage = 'DISCOVERY'
    console.info(
      `[conversation] stage TTL (24h + foreign intent): ${row.stage} → DISCOVERY for phone=${phone} intent=${newIntent}`,
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
    /** Migration 032: rolling Haiku-generated conversation summary. */
    conversationSummary?: string | null
    /**
     * Migration 032: ordered log of last 10 pitched handles (most-recent last).
     * The application layer enforces the cap — always slice to 10 before writing.
     */
    pitchedHandlesLog?: string[] | null
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
  if (writes.conversationSummary !== undefined) updates.conversationSummary = writes.conversationSummary
  if (writes.pitchedHandlesLog !== undefined) updates.pitchedHandlesLog = writes.pitchedHandlesLog

  await db.update(smsConversations).set(updates).where(eq(smsConversations.phone, phone))
}
