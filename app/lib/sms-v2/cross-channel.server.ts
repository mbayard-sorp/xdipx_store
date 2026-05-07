/**
 * app/lib/sms-v2/cross-channel.server.ts
 *
 * Phase 10 — Cross-channel conversation state.
 *
 * Provides:
 *   findRecentCrossChannelActivity() — "did this customer touch another channel
 *     in the last N hours, and what were they considering?"
 *   buildEmmaContextWithCrossChannel() — builds EmmaContext and attaches the hint.
 *   getCrossChannelHint() — safe read of the augmented field from any EmmaContext.
 *
 * Design notes:
 *   - SMS and voice share sms_conversations (phone is PK). The IVR adapter uses
 *     channel='voice' in sms_turns but the conversation row is the same table.
 *     For Phase 10, voice is treated as channel='sms' — the SMS<->web join is the
 *     high-value case today. Future phases can split voice into its own table.
 *   - We augment EmmaContext via a cast rather than modifying types.server.ts
 *     (locked spec). getCrossChannelHint() makes the cast explicit at the callsite.
 */

import { and, desc, gt, isNotNull } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { smsConversations, webConversations } from '../../../db/schema'
import { buildEmmaContext } from './context-builder.server'
import { getProductByHandle } from '~/lib/shopify.server'
import type { EmmaContext } from './types.server'
import type { Stage } from './types.server'
import type { ConversationRow } from './conversation.server'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Channel = 'sms' | 'web' | 'voice'

export interface CrossChannelHint {
  otherChannel: Channel
  topic:
    | { kind: 'product'; handle: string; title?: string }
    | { kind: 'stage'; stage: Stage }
  lastActiveAt: Date
  conversationId: string
}

/** EmmaContext with an optional cross-channel hint attached. */
export type EmmaContextWithCrossChannel = EmmaContext & {
  crossChannelHint?: CrossChannelHint
}

// ---------------------------------------------------------------------------
// getCrossChannelHint — safe cast helper for stage handlers
// ---------------------------------------------------------------------------

/**
 * Read the crossChannelHint from any EmmaContext (or augmented subtype).
 * Returns undefined if no hint was attached (anonymous session, same-channel
 * call, or TTL expiry).
 *
 * Using a cast here is intentional: the hint is attached by the processor layer
 * after buildEmmaContext() completes, so it cannot be part of the locked
 * EmmaContext type. The explicit cast makes the unsafe access visible.
 */
export function getCrossChannelHint(ctx: EmmaContext): CrossChannelHint | undefined {
  return (ctx as EmmaContext & { crossChannelHint?: CrossChannelHint }).crossChannelHint
}

// ---------------------------------------------------------------------------
// findRecentCrossChannelActivity
// ---------------------------------------------------------------------------

/**
 * Look for the most recent conversation row belonging to `customerGid` on a
 * channel *other than* `currentChannel`, active within `ttlHours`.
 *
 * Returns a CrossChannelHint if found, null otherwise.
 *
 * Simplification for Phase 10: voice and SMS both live in sms_conversations.
 * We treat currentChannel === 'voice' as 'sms' for the exclusion check, so a
 * voice caller can still get a web-chat hint.
 */
export async function findRecentCrossChannelActivity(
  customerGid: string | null | undefined,
  currentChannel: Channel,
  ttlHours: number = 24,
): Promise<CrossChannelHint | null> {
  // Short-circuit: anonymous sessions can never have cross-channel state.
  if (!customerGid) return null

  const cutoff = new Date(Date.now() - ttlHours * 60 * 60 * 1000)

  // Normalise voice → sms: both use sms_conversations, so the "other" channel
  // when current is voice/sms is always web, and vice versa.
  const normalised: 'sms' | 'web' = currentChannel === 'web' ? 'web' : 'sms'

  if (normalised === 'sms') {
    // Current channel is SMS or voice — look for recent web activity.
    return _queryWebChannel(customerGid, cutoff)
  } else {
    // Current channel is web — look for recent SMS/voice activity.
    return _querySmsChannel(customerGid, cutoff)
  }
}

// ---------------------------------------------------------------------------
// Internal: per-table queries
// ---------------------------------------------------------------------------

async function _queryWebChannel(
  customerGid: string,
  cutoff: Date,
): Promise<CrossChannelHint | null> {
  const rows = await db
    .select({
      conversationId:     webConversations.conversationId,
      currentPitchHandle: webConversations.currentPitchHandle,
      stage:              webConversations.stage,
      lastActiveAt:       webConversations.lastActiveAt,
      customerGid:        webConversations.customerGid,
    })
    .from(webConversations)
    .where(
      and(
        isNotNull(webConversations.customerGid),
        gt(webConversations.lastActiveAt, cutoff),
      ),
    )
    .orderBy(desc(webConversations.lastActiveAt))
    .limit(20)

  // Filter for exact GID match in JS — avoids needing drizzle-orm's sql template
  // for text equality on nullable columns and keeps the query index-friendly.
  const row = rows.find((r) => r.customerGid === customerGid)
  if (!row) return null

  return _buildHint(
    'web',
    row.conversationId,
    row.currentPitchHandle,
    row.stage as Stage,
    row.lastActiveAt,
  )
}

async function _querySmsChannel(
  customerGid: string,
  cutoff: Date,
): Promise<CrossChannelHint | null> {
  const rows = await db
    .select({
      conversationId:     smsConversations.conversationId,
      currentPitchHandle: smsConversations.currentPitchHandle,
      stage:              smsConversations.stage,
      lastActiveAt:       smsConversations.lastActiveAt,
      customerGid:        smsConversations.customerGid,
    })
    .from(smsConversations)
    .where(
      and(
        isNotNull(smsConversations.customerGid),
        gt(smsConversations.lastActiveAt, cutoff),
      ),
    )
    .orderBy(desc(smsConversations.lastActiveAt))
    .limit(20)

  const row = rows.find((r) => r.customerGid === customerGid)
  if (!row) return null

  return _buildHint(
    'sms',
    row.conversationId,
    row.currentPitchHandle,
    row.stage as Stage,
    row.lastActiveAt,
  )
}

/**
 * Build a CrossChannelHint from raw DB fields. Attempts to fetch the product
 * title from Shopify if a pitch handle is present; degrades gracefully on error.
 */
async function _buildHint(
  otherChannel: Channel,
  conversationId: string,
  pitchHandle: string | null | undefined,
  stage: Stage,
  lastActiveAt: Date,
): Promise<CrossChannelHint> {
  if (pitchHandle) {
    let title: string | undefined
    try {
      const product = await getProductByHandle(pitchHandle)
      if (product?.title) title = product.title
    } catch {
      // Degrade gracefully — the hint is still useful without a resolved title.
    }

    return {
      otherChannel,
      topic: { kind: 'product', handle: pitchHandle, ...(title !== undefined && { title }) },
      lastActiveAt,
      conversationId,
    }
  }

  // No pitch handle — surface the stage as the topic so RECONNECT can fall
  // through to its existing cold-reconnect logic.
  return {
    otherChannel,
    topic: { kind: 'stage', stage },
    lastActiveAt,
    conversationId,
  }
}

// ---------------------------------------------------------------------------
// buildEmmaContextWithCrossChannel
// ---------------------------------------------------------------------------

/**
 * Build an EmmaContext (via the locked buildEmmaContext) and attach a
 * cross-channel hint if one is found.
 *
 * Works with both ConversationRow (SMS/voice) and WebConversationRow — both
 * expose customerGid at the same field name.
 */
export async function buildEmmaContextWithCrossChannel(
  conversation: ConversationRow & { customerGid: string | null },
  channel: Channel,
): Promise<EmmaContext> {
  const ctx = await buildEmmaContext(conversation)
  ctx.channel = channel

  const hint = await findRecentCrossChannelActivity(
    conversation.customerGid,
    channel,
  )

  if (hint) {
    (ctx as EmmaContextWithCrossChannel).crossChannelHint = hint
  }

  return ctx
}
