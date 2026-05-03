/**
 * app/lib/sms-v2/conversation-history.server.ts
 *
 * Loads recent turn history for the Sonnet-driven discovery agent.
 *
 * Each `sms_turns` row carries one inbound→outbound pair: `customerMsg`
 * (what the user sent) plus `emmaMsg` (what Emma replied). To feed Anthropic's
 * Messages API we expand each row into a [user, assistant] pair, keeping the
 * pairs in chronological order so the agent sees the conversation as it
 * actually happened.
 *
 * The same `sms_turns` table is used by SMS, voice, and web channels — they
 * differ only in the `channel` column. We don't filter by channel here: the
 * conversation_id alone is enough to scope to a single conversation.
 *
 * Voice rows store SSML in `emmaMsg`. We strip the tags before handing them to
 * the model so the prose history reads cleanly.
 */
import { desc, eq } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { smsTurns } from '../../../db/schema'

export interface HistoryTurn {
  role: 'user' | 'assistant'
  text: string
}

const DEFAULT_LIMIT = 12

/**
 * Strip SSML markup from a stored Emma reply so voice history reads as prose.
 * Plain SMS / web rows pass through untouched.
 */
function stripSsml(text: string): string {
  if (!text) return text
  // Remove <speak>, <break>, <prosody>, etc. Keep the inner text.
  return text
    .replace(/<break\s+[^/>]*\/>/gi, ' ')
    .replace(/<\/?speak[^>]*>/gi, '')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Load the last N turn-pairs for a conversation, returned in chronological
 * order. Empty / null messages are skipped so the model never sees a blank
 * turn. The current inbound message is NOT included — the caller appends that
 * itself when composing the request to the model.
 *
 * `limit` caps the number of underlying rows fetched. Each row expands to up
 * to two messages (user + assistant), so a limit of 12 yields up to 24
 * conversational messages — enough for a discovery thread without blowing the
 * model's context budget.
 */
export async function loadConversationHistory(
  conversationId: string,
  limit: number = DEFAULT_LIMIT,
): Promise<HistoryTurn[]> {
  if (!conversationId) return []

  const rows = await db
    .select({
      customerMsg: smsTurns.customerMsg,
      emmaMsg: smsTurns.emmaMsg,
      createdAt: smsTurns.createdAt,
    })
    .from(smsTurns)
    .where(eq(smsTurns.conversationId, conversationId as `${string}-${string}-${string}-${string}-${string}`))
    .orderBy(desc(smsTurns.createdAt))
    .limit(limit)

  // Reverse to chronological (oldest first), then expand each row into
  // user + assistant messages. Empty bodies are dropped — they'd confuse the
  // model and burn tokens for no signal.
  const chronological = [...rows].reverse()
  const turns: HistoryTurn[] = []

  for (const row of chronological) {
    const userText = (row.customerMsg ?? '').trim()
    const assistantText = stripSsml(row.emmaMsg ?? '').trim()
    if (userText) turns.push({ role: 'user', text: userText })
    if (assistantText) turns.push({ role: 'assistant', text: assistantText })
  }

  return turns
}
