import Anthropic from '@anthropic-ai/sdk'
import { and, asc, desc, eq, sql as drizzleSql } from 'drizzle-orm'
import { db } from './db.server'
import {
  emmaChatThreads,
  emmaChatMessages,
  type EmmaChatToolCall,
  type EmmaChatToolResult,
} from '../../db/schema'
import { EMMA_CHAT_TOOLS, executeEmmaChatTool } from './emma-chat-tools.server'

const MODEL = 'claude-sonnet-4-20250514'
const MAX_OUTPUT_TOKENS = 4096
const MAX_TOOL_HOPS = 6

// Lazy singleton: defer Anthropic client construction until first use so the env
// var is read at request time, not module-load time. This sidesteps shell envs
// that pre-set ANTHROPIC_API_KEY to an empty string (dotenv won't override).
let _anthropicClient: Anthropic | null = null
function getAnthropicClient(): Anthropic {
  if (_anthropicClient) return _anthropicClient
  const apiKey = process.env['ANTHROPIC_API_KEY']?.trim()
  if (!apiKey) throw new Error('emma-chat: ANTHROPIC_API_KEY is not set')
  _anthropicClient = new Anthropic({ apiKey })
  return _anthropicClient
}

// ---------------------------------------------------------------------------
// System prompt — INTERNAL Emma-as-product-SME voice. Distinct from the
// public storefront Emma voice. See CLAUDE.md "Voice" section for the public
// persona; the differences below are deliberate and load-bearing.
// ---------------------------------------------------------------------------

export const EMMA_SME_SYSTEM_PROMPT = `
You are Emma, the in-house product expert at xdipx.com — an editorially-curated
sexual-wellness storefront. This is an internal Slack-style chat with the xdipx
team for drafting Reddit replies (mostly r/sextoys). It is NOT customer-facing.

Voice in THIS context (different from public site copy):
- Frank, raw, factual. Talk like a senior product person who has actually tested
  the gear. Profanity is fine when it serves clarity. Em-dashes are fine.
- You can name competitors (Lelo, We-Vibe, Lovense, Magic Wand, Womanizer,
  Satisfyer, Tenga, Fleshlight, Doxy, Hitachi, etc.) and compare them honestly
  to xdipx SKUs.
- You can call out overhyped products. You can be opinionated.
- You can discuss anatomy, materials (silicone vs TPE vs ABS vs porous vs
  non-porous), motors (single vs dual, RPM, decibel level when known),
  waterproofing, charging (USB-C vs proprietary, magnetic), noise levels,
  sizing/girth, and what works/doesn't for which body.
- Do NOT use the heart symbol ♥ in this chat. Skip the public-Emma flourishes
  ("I'll take it ♥", "been living on my desk", etc.) — those are for storefront
  copy only.
- For the FINISHED Reddit draft, avoid "sex" as an adjective — use "intimate",
  "pleasure", "wellness", or "satisfaction". Internal reasoning between you and
  the team can be however direct it needs to be.

Catalog grounding (CRITICAL):
- Whenever you would name an xdipx product, FIRST call the search_products tool
  to confirm it exists and get the current handle. Never invent SKUs.
- search_products returns lightweight cards: handle, title, price, available,
  map_restricted. It does NOT return Emma-voice taxonomy (tagline, sensation_dial,
  product_type_dial, mood_tags, audience_tags, matters_tags) — those fields will
  be null/empty in the search payload. To pitch a product with depth, you MUST
  call get_product_details(handle) to get the full enrichment.
- When you mention an xdipx product in your reply text, format it as:
  [Product Title](https://xdipx.com/products/{handle})
  That is exactly Reddit's link format — the user copies your reply verbatim.
- For competitor products, do NOT generate links — just name them in plain text.
- Hard cap: at most 6 tool calls per turn. Plan your searches before you fire
  them; don't burn hops on duplicate queries.

Reddit reply style:
- Match the energy of the post you were given. Quick question = quick answer.
  Long detailed post = thorough answer.
- Lead with the recommendation, then the why. People scroll.
- If you are unsure, say so. Hype kills credibility.
- Disclose nothing about being AI. Disclose nothing about being from xdipx
  UNLESS the user explicitly asks you to add a disclosure. The user runs the
  disclosure policy, not you.

When the user pastes a Reddit post and asks for a draft, return ONLY the draft —
no preamble, no "here's a draft of:" framing. They want to copy your reply.
`.trim()

// ---------------------------------------------------------------------------
// Quick-action canned prompts — exposed so the route action can resolve them
// to real user-message text (we persist them as actual user turns rather than
// hidden directives so the conversation stays inspectable).
// ---------------------------------------------------------------------------

export type EmmaQuickActionId =
  | 'more_direct'
  | 'shorter'
  | 'competitor_compare'
  | 'safety_disclaimer'
  | 'more_emma'

export const EMMA_QUICK_ACTIONS: Record<EmmaQuickActionId, { label: string; prompt: string }> = {
  more_direct: {
    label: 'More direct',
    prompt: 'Make that more direct. Cut the warmup. Lead with the recommendation.',
  },
  shorter: {
    label: 'Shorter',
    prompt: "Shorter. Half the length. Reddit doesn't read essays.",
  },
  competitor_compare: {
    label: 'Add competitor compare',
    prompt: 'Add a quick comparison to one or two competitor products so the rec has context.',
  },
  safety_disclaimer: {
    label: 'Add safety disclaimer',
    prompt: 'Add a brief safety / material note (silicone, body-safe, lube compatibility) where relevant.',
  },
  more_emma: {
    label: 'More Emma personality',
    prompt: 'More Emma personality. Funnier, warmer, less corporate. Still no heart symbols.',
  },
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EmmaChatThread {
  id: number
  title: string
  redditPostUrl: string | null
  redditPostExcerpt: string | null
  archived: boolean
  createdAt: Date
  updatedAt: Date
}

export interface EmmaChatMessage {
  id: number
  threadId: number
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls: EmmaChatToolCall[] | null
  toolResults: EmmaChatToolResult[] | null
  stopReason: string | null
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: number | null
  createdAt: Date
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function deriveTitle(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (!collapsed) return 'New thread'
  return collapsed.length <= 80 ? collapsed : collapsed.slice(0, 77) + '...'
}

export async function listThreads(input?: { includeArchived?: boolean; limit?: number }): Promise<EmmaChatThread[]> {
  const limit = Math.max(1, Math.min(input?.limit ?? 50, 200))
  const rows = input?.includeArchived
    ? await db.select().from(emmaChatThreads).orderBy(desc(emmaChatThreads.updatedAt)).limit(limit)
    : await db.select().from(emmaChatThreads)
        .where(eq(emmaChatThreads.archived, false))
        .orderBy(desc(emmaChatThreads.updatedAt))
        .limit(limit)
  return rows.map(rowToThread)
}

export async function loadThread(threadId: number): Promise<{ thread: EmmaChatThread; messages: EmmaChatMessage[] } | null> {
  const [threadRow] = await db.select().from(emmaChatThreads).where(eq(emmaChatThreads.id, threadId)).limit(1)
  if (!threadRow) return null
  const messageRows = await db.select().from(emmaChatMessages)
    .where(eq(emmaChatMessages.threadId, threadId))
    .orderBy(asc(emmaChatMessages.createdAt), asc(emmaChatMessages.id))
  return {
    thread: rowToThread(threadRow),
    messages: messageRows.map(rowToMessage),
  }
}

export async function createThread(input: {
  firstUserMessage: string
  redditPostUrl?: string | null
  redditPostExcerpt?: string | null
}): Promise<{ threadId: number; messageId: number }> {
  // Neon HTTP driver does not support transactions; sequential inserts.
  const titleSource = input.redditPostExcerpt?.trim() || input.firstUserMessage
  const title = deriveTitle(titleSource)
  const [thread] = await db.insert(emmaChatThreads).values({
    title,
    redditPostUrl: input.redditPostUrl ?? null,
    redditPostExcerpt: input.redditPostExcerpt ?? null,
  }).returning({ id: emmaChatThreads.id })
  if (!thread) throw new Error('createThread: insert returned no row')
  const [message] = await db.insert(emmaChatMessages).values({
    threadId: thread.id,
    role: 'user',
    content: input.firstUserMessage,
  }).returning({ id: emmaChatMessages.id })
  if (!message) throw new Error('createThread: message insert returned no row')
  return { threadId: thread.id, messageId: message.id }
}

export async function appendUserMessage(threadId: number, content: string): Promise<{ messageId: number }> {
  // Neon HTTP driver does not support transactions; sequential inserts.
  const [message] = await db.insert(emmaChatMessages).values({
    threadId,
    role: 'user',
    content,
  }).returning({ id: emmaChatMessages.id })
  if (!message) throw new Error('appendUserMessage: insert returned no row')
  await db.update(emmaChatThreads)
    .set({ updatedAt: new Date() })
    .where(eq(emmaChatThreads.id, threadId))
  return { messageId: message.id }
}

export async function archiveThread(threadId: number): Promise<void> {
  await db.update(emmaChatThreads)
    .set({ archived: true, updatedAt: new Date() })
    .where(eq(emmaChatThreads.id, threadId))
}

// ---------------------------------------------------------------------------
// Streaming orchestrator
// ---------------------------------------------------------------------------

/**
 * Convert persisted DB messages into the Anthropic messages-array format.
 * - 'user' rows -> { role: 'user', content: text }
 * - 'assistant' rows -> { role: 'assistant', content: [text_block, ...tool_use blocks] }
 * - 'tool' rows -> { role: 'user', content: [tool_result blocks] }
 */
function buildAnthropicMessages(messages: EmmaChatMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content })
      continue
    }
    if (m.role === 'assistant') {
      const blocks: Anthropic.ContentBlockParam[] = []
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const tc of m.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input })
      }
      out.push({ role: 'assistant', content: blocks.length > 0 ? blocks : m.content })
      continue
    }
    if (m.role === 'tool') {
      const blocks: Anthropic.ToolResultBlockParam[] = (m.toolResults ?? []).map(tr => ({
        type: 'tool_result',
        tool_use_id: tr.tool_use_id,
        content: tr.content,
        ...(tr.is_error ? { is_error: true } : {}),
      }))
      if (blocks.length > 0) out.push({ role: 'user', content: blocks })
      continue
    }
  }
  return out
}

const enc = new TextEncoder()
function sseEvent(controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: unknown) {
  controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
}

/**
 * Stream Emma's reply for the most recent user message in a thread.
 * Returns a ReadableStream of SSE frames. Event types:
 *   - token        { text }
 *   - tool_call    { id, name, input }
 *   - tool_result  { tool_use_id, content, is_error?, durationMs? }
 *   - done         { messageId }
 *   - error        { message }
 */
export function streamEmmaReply(input: {
  threadId: number
  signal: AbortSignal
}): ReadableStream<Uint8Array> {
  const { threadId, signal } = input
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const turnStart = Date.now()
      let aborted = false
      const onAbort = () => { aborted = true }
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        const loaded = await loadThread(threadId)
        if (!loaded) {
          sseEvent(controller, 'error', { message: 'thread_not_found' })
          controller.close()
          return
        }

        const history: EmmaChatMessage[] = [...loaded.messages]
        let totalInputTokens = 0
        let totalOutputTokens = 0
        let finalAssistantId: number | null = null

        for (let hop = 0; hop < MAX_TOOL_HOPS && !aborted; hop++) {
          const anthropicMessages = buildAnthropicMessages(history)
          if (anthropicMessages.length === 0) {
            sseEvent(controller, 'error', { message: 'no_messages_to_send' })
            break
          }

          // Stream this hop. We accumulate text deltas into `accumulatedText`
          // and the full content blocks are available on `finalMessage`.
          let accumulatedText = ''
          const stream = getAnthropicClient().messages.stream(
            {
              model: MODEL,
              max_tokens: MAX_OUTPUT_TOKENS,
              system: EMMA_SME_SYSTEM_PROMPT,
              tools: EMMA_CHAT_TOOLS,
              messages: anthropicMessages,
            },
            { signal },
          )

          stream.on('text', (delta: string) => {
            accumulatedText += delta
            sseEvent(controller, 'token', { text: delta })
          })

          const finalMessage = await stream.finalMessage()
          totalInputTokens  += finalMessage.usage?.input_tokens  ?? 0
          totalOutputTokens += finalMessage.usage?.output_tokens ?? 0

          // Extract any tool_use blocks
          const toolUses = finalMessage.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
          )

          // Persist the assistant message (text + tool_calls).
          const assistantContent = accumulatedText
          const assistantToolCalls: EmmaChatToolCall[] = toolUses.map(tu => ({
            id: tu.id,
            name: tu.name,
            input: (tu.input ?? {}) as Record<string, unknown>,
          }))

          const [assistantRow] = await db.insert(emmaChatMessages).values({
            threadId,
            role: 'assistant',
            content: assistantContent,
            toolCalls: assistantToolCalls.length > 0 ? assistantToolCalls : null,
            stopReason: finalMessage.stop_reason ?? null,
            inputTokens: finalMessage.usage?.input_tokens ?? null,
            outputTokens: finalMessage.usage?.output_tokens ?? null,
            latencyMs: Date.now() - turnStart,
          }).returning({ id: emmaChatMessages.id, createdAt: emmaChatMessages.createdAt })
          if (!assistantRow) throw new Error('failed to persist assistant message')

          history.push({
            id: assistantRow.id,
            threadId,
            role: 'assistant',
            content: assistantContent,
            toolCalls: assistantToolCalls.length > 0 ? assistantToolCalls : null,
            toolResults: null,
            stopReason: finalMessage.stop_reason ?? null,
            inputTokens: finalMessage.usage?.input_tokens ?? null,
            outputTokens: finalMessage.usage?.output_tokens ?? null,
            latencyMs: null,
            createdAt: assistantRow.createdAt,
          })
          finalAssistantId = assistantRow.id

          // No tools called -> we're done.
          if (toolUses.length === 0 || finalMessage.stop_reason !== 'tool_use') break

          // Run each tool, persist a tool row, push tool_result blocks for the next hop.
          const toolResults: EmmaChatToolResult[] = []
          for (const tu of toolUses) {
            sseEvent(controller, 'tool_call', { id: tu.id, name: tu.name, input: tu.input })
            const result = await executeEmmaChatTool(tu.name, (tu.input ?? {}) as Record<string, unknown>)
            const toolResult: EmmaChatToolResult = {
              tool_use_id: tu.id,
              content: result.content,
              ...(result.is_error ? { is_error: true } : {}),
            }
            toolResults.push(toolResult)
            sseEvent(controller, 'tool_result', {
              tool_use_id: tu.id,
              name: tu.name,
              is_error: result.is_error ?? false,
              durationMs: result.diagnostics?.durationMs,
              resultCount: result.diagnostics?.resultCount,
            })
          }

          const [toolRow] = await db.insert(emmaChatMessages).values({
            threadId,
            role: 'tool',
            content: '',
            toolResults,
          }).returning({ id: emmaChatMessages.id, createdAt: emmaChatMessages.createdAt })
          if (!toolRow) throw new Error('failed to persist tool message')

          history.push({
            id: toolRow.id,
            threadId,
            role: 'tool',
            content: '',
            toolCalls: null,
            toolResults,
            stopReason: null,
            inputTokens: null,
            outputTokens: null,
            latencyMs: null,
            createdAt: toolRow.createdAt,
          })
          // loop back into next hop
        }

        // Bump thread.updated_at + final telemetry
        await db.update(emmaChatThreads)
          .set({ updatedAt: new Date() })
          .where(eq(emmaChatThreads.id, threadId))

        sseEvent(controller, 'done', {
          messageId: finalAssistantId,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          aborted,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        sseEvent(controller, 'error', { message })
      } finally {
        signal.removeEventListener('abort', onAbort)
        controller.close()
      }
    },
    cancel() {
      // Caller closed the SSE connection; the AbortSignal is the source of truth.
    },
  })
}

// ---------------------------------------------------------------------------
// Row -> domain mappers
// ---------------------------------------------------------------------------

function rowToThread(r: typeof emmaChatThreads.$inferSelect): EmmaChatThread {
  return {
    id: r.id,
    title: r.title,
    redditPostUrl: r.redditPostUrl,
    redditPostExcerpt: r.redditPostExcerpt,
    archived: r.archived,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

function rowToMessage(r: typeof emmaChatMessages.$inferSelect): EmmaChatMessage {
  const role = r.role === 'user' || r.role === 'assistant' || r.role === 'tool' ? r.role : 'user'
  return {
    id: r.id,
    threadId: r.threadId,
    role,
    content: r.content,
    toolCalls: r.toolCalls ?? null,
    toolResults: r.toolResults ?? null,
    stopReason: r.stopReason ?? null,
    inputTokens: r.inputTokens ?? null,
    outputTokens: r.outputTokens ?? null,
    latencyMs: r.latencyMs ?? null,
    createdAt: r.createdAt,
  }
}

// suppress unused import warning if `and` / `drizzleSql` aren't used yet
void and
void drizzleSql
