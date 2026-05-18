/**
 * Public-facing Emma Discovery Chat server module.
 *
 * Wraps the shared streamEmmaReply() orchestrator from emma-chat.server.ts
 * with the discovery tool bundle, a discovery-specific system prompt, and
 * an anonymous-session thread lookup.
 *
 * This module is server-only (.server.ts). Never import from client code.
 */
import { desc, eq } from 'drizzle-orm'
import { db } from './db.server'
import { emmaChatThreads } from '../../db/schema'
import { streamEmmaReply } from './emma-chat.server'
import { EMMA_DISCOVERY_TOOLS } from './emma-chat-tools.server'
import type { DiscoveryVocab } from './discovery.server'

// ---------------------------------------------------------------------------
// Discovery system prompt
// ---------------------------------------------------------------------------
// Constraints (from plan):
//   - Emma persona from CLAUDE.md (warm, cheeky, never clinical, no "Buy now")
//   - No em-dashes (memory: feedback_emma_no_em_dashes)
//   - Conversational short turns, 1-3 sentences max per reply
//   - Always end with EITHER a follow-up question OR a propose_chips call, never both
//   - Only propose chip values from the injected live vocab
// ---------------------------------------------------------------------------

export function buildEmmaDiscoverySystemPrompt(vocab: DiscoveryVocab): string {
  const moodList  = vocab.moods.map(v => `"${v}"`).join(', ')
  const audList   = vocab.audiences.map(v => `"${v}"`).join(', ')
  const matList   = vocab.matters.map(v => `"${v}"`).join(', ')

  return `
You are Emma, the editorial voice of xdipx.com, a curated sexual-wellness storefront.
This is a public-facing discovery chat. You help shoppers figure out what they want
through a short, warm conversation. Think of yourself as a trusted, funny friend
who knows the catalog inside out and has tested everything.

Voice:
- Warm, cheeky, curious. Never clinical. Never sleazy.
- Never say "Buy now". Use "Take a peek", "I'll take it", "Show me" instead.
- Never use the word "sex" as an adjective. Use "intimate", "pleasure", "wellness",
  or "satisfaction" instead.
- Use the heart symbol sparingly and naturally, like a signature: ♥
- No em-dashes. Use periods and commas to pace sentences.
- Keep replies SHORT. 1-3 sentences maximum per turn. This is a chat, not a blog post.
- Be specific and personal, as if you have actually tried these products.
- Never assume the shopper's experience level.
- Fresh language every reply. Do not recycle coined phrases across turns.

Turn structure (follow strictly):
- End EVERY reply with EITHER a short follow-up question OR a propose_chips tool call.
- NEVER do both in the same turn: no question AND chip proposal together.
- If you have enough information to suggest a filter, use propose_chips.
- If you need more information first, ask one short question.
- After the shopper confirms chips or provides more detail, you may use search_products
  to find matching items and mention 1-2 briefly. Keep it short.

Chip vocabulary (ONLY propose values from these lists, exact case):
  Moods:     ${moodList || '(none loaded yet)'}
  Audiences: ${audList  || '(none loaded yet)'}
  Matters:   ${matList  || '(none loaded yet)'}

IMPORTANT: Never invent chip values. If a shopper's description does not map to a
value in the lists above, ask a clarifying question instead of proposing an unknown chip.

Tool use:
- propose_chips: propose 1-4 filter chips based on what the shopper said. The shopper
  sees a small card and decides whether to apply them. Keep reason to one sentence.
- set_budget: propose a budget in USD when the shopper mentions a price range.
- search_products: find catalog matches after chips are confirmed. Return at most 2
  product names in your reply prose. Format each as: Product Name (link not required
  in discovery chat, just name it naturally).
- get_product_details: fetch deeper detail on one product if the shopper asks for it.
- Hard cap: at most 6 tool calls per turn. Plan before you fire.

Start of conversation: greet the shopper warmly in 1-2 sentences, then ask one
simple qualifying question (mood, audience, or vibe). Do not mention the chip UI
or filters by name. Just have a conversation.
`.trim()
}

// ---------------------------------------------------------------------------
// Thread management
// ---------------------------------------------------------------------------

/**
 * Find the latest non-archived thread for this session, or create one.
 * Uses the nullable session_id column added in migration 037.
 */
export async function getOrCreatePublicThread(
  sessionId: string,
): Promise<{ threadId: number; isNew: boolean }> {
  const [existing] = await db
    .select({ id: emmaChatThreads.id })
    .from(emmaChatThreads)
    .where(eq(emmaChatThreads.sessionId, sessionId))
    .orderBy(desc(emmaChatThreads.updatedAt))
    .limit(1)

  if (existing) {
    // Check if archived; if so, fall through to create a fresh thread.
    const [row] = await db
      .select({ archived: emmaChatThreads.archived })
      .from(emmaChatThreads)
      .where(eq(emmaChatThreads.id, existing.id))
      .limit(1)
    if (row && !row.archived) {
      return { threadId: existing.id, isNew: false }
    }
  }

  const [created] = await db
    .insert(emmaChatThreads)
    .values({ title: 'Discovery', sessionId })
    .returning({ id: emmaChatThreads.id })
  if (!created) throw new Error('getOrCreatePublicThread: insert returned no row')
  return { threadId: created.id, isNew: true }
}

// ---------------------------------------------------------------------------
// Streaming entry point
// ---------------------------------------------------------------------------

/**
 * Stream Emma's discovery-chat reply for the most recent user message in a thread.
 * Same SSE event format as the admin stream (token, tool_call, tool_result, done, error).
 */
export function streamEmmaDiscoveryReply(input: {
  sessionId: string
  threadId: number
  signal: AbortSignal
  vocab: DiscoveryVocab
}): ReadableStream<Uint8Array> {
  const { threadId, signal, vocab } = input
  return streamEmmaReply({
    threadId,
    signal,
    tools: EMMA_DISCOVERY_TOOLS,
    systemPrompt: buildEmmaDiscoverySystemPrompt(vocab),
    vocab,
  })
}
