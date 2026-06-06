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

export const MODEL = 'claude-sonnet-4-20250514'
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
sexual-wellness storefront. This is an internal chat with the xdipx team. It
is NOT customer-facing. Treat it like a Slack DM with a senior product person.

Voice in THIS context (different from public site copy):
- Frank, raw, factual. Talk like a senior product person who has actually tested
  the gear. Profanity is fine when it serves clarity. Em-dashes are fine.
- Be direct. The team doesn't need warm-ups, hedging, or "great question!" framing.
- Name competitors honestly (Lelo, We-Vibe, Lovense, Magic Wand, Womanizer,
  Satisfyer, Tenga, Fleshlight, Doxy, Hitachi, etc.) and compare them to xdipx
  SKUs. You can call out overhyped products. You can be opinionated.
- Discuss anatomy, materials (silicone vs TPE vs ABS vs porous vs non-porous),
  motors (single vs dual, RPM, decibel level when known), waterproofing,
  charging (USB-C vs proprietary, magnetic), noise levels, sizing/girth, and
  what works/doesn't for which body.
- Do NOT use the heart symbol ♥ in this chat. Skip the public-Emma flourishes
  ("I'll take it ♥" and similar CTA glyphs); those are for storefront copy only.

Catalog grounding (CRITICAL):
- Whenever you would name an xdipx product, FIRST call the search_products tool
  to confirm it exists and get the current handle. Never invent SKUs.
- search_products returns lightweight cards: handle, title, price, available,
  map_restricted. It does NOT return Emma-voice taxonomy (tagline, sensation_dial,
  product_type_dial, mood_tags, audience_tags, matters_tags) — those fields will
  be null/empty in the search payload. To pitch a product with depth, you MUST
  call get_product_details(handle) to get the full enrichment.
- Each variant in get_product_details carries originalDescription: raw manufacturer
  text. Use it to answer size, dimension, material, and fit questions precisely.
  Translate the specs into plain language; never quote the manufacturer text verbatim.
- When you mention an xdipx product in your reply text, format it as a Markdown
  link: [Product Title](https://xdipx.com/products/{handle})
- For competitor products, do NOT generate links — just name them in plain text.
- Hard cap: at most 6 tool calls per turn. Plan your searches before you fire
  them; don't burn hops on duplicate queries.

Format:
- Match the format of the question. A quick "what's good for X?" gets a quick
  answer. A long detailed paste gets a thorough one.
- Lead with the recommendation or answer, then the why.
- If you are unsure, say so. Hype kills credibility.

If the team pastes a Reddit/forum post or customer message and asks for a draft
reply, write the reply directly — no preamble, no "here's a draft of:" framing.
Otherwise just answer the question; no need to wrap responses as if they were
Reddit posts.
`.trim()

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

/**
 * Single-chat helpers — the admin UI uses one "current" non-archived thread per agentType.
 * "Clear" archives the current thread; the next visit creates a fresh one.
 * agentType defaults to 'emma' so all existing Emma callers are unaffected.
 */
export async function getOrCreateCurrentThread(agentType = 'emma'): Promise<{ thread: EmmaChatThread; messages: EmmaChatMessage[] }> {
  const [existing] = await db.select().from(emmaChatThreads)
    .where(and(eq(emmaChatThreads.archived, false), eq(emmaChatThreads.agentType, agentType)))
    .orderBy(desc(emmaChatThreads.updatedAt))
    .limit(1)
  if (existing) {
    const messageRows = await db.select().from(emmaChatMessages)
      .where(eq(emmaChatMessages.threadId, existing.id))
      .orderBy(asc(emmaChatMessages.createdAt), asc(emmaChatMessages.id))
    return { thread: rowToThread(existing), messages: messageRows.map(rowToMessage) }
  }
  const title = agentType === 'pm' ? 'PM chat' : 'Emma chat'
  const [created] = await db.insert(emmaChatThreads).values({
    title,
    agentType,
  }).returning()
  if (!created) throw new Error('getOrCreateCurrentThread: insert returned no row')
  return { thread: rowToThread(created), messages: [] }
}

export async function clearCurrentThread(agentType = 'emma'): Promise<{ thread: EmmaChatThread }> {
  const [existing] = await db.select().from(emmaChatThreads)
    .where(and(eq(emmaChatThreads.archived, false), eq(emmaChatThreads.agentType, agentType)))
    .orderBy(desc(emmaChatThreads.updatedAt))
    .limit(1)
  if (existing) {
    await db.update(emmaChatThreads)
      .set({ archived: true, updatedAt: new Date() })
      .where(eq(emmaChatThreads.id, existing.id))
  }
  const title = agentType === 'pm' ? 'PM chat' : 'Emma chat'
  const [created] = await db.insert(emmaChatThreads).values({
    title,
    agentType,
  }).returning()
  if (!created) throw new Error('clearCurrentThread: insert returned no row')
  return { thread: rowToThread(created) }
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
 * Generic streaming agent orchestrator. Runs the MAX_TOOL_HOPS agentic loop,
 * persists messages to the thread, and emits SSE frames. Both Emma and PM chat
 * delegate here — the only differences are the systemPrompt, tools, and
 * dispatchTool callback passed in.
 *
 * SSE event types:
 *   - token        { text }
 *   - tool_call    { id, name, input }
 *   - tool_result  { tool_use_id, content, is_error?, durationMs?, resultCount? }
 *   - done         { messageId, inputTokens, outputTokens, aborted }
 *   - error        { message }
 *
 * Prompt-cache note: the SDK does NOT cache automatically. We pass the system
 * prompt as a structured block tagged with cache_control: ephemeral. Anthropic
 * caches in canonical order (tools, system, messages), so this single breakpoint
 * at the end of the system block caches the tool definitions AND the system
 * prompt together. The static prefix is re-read (not re-billed at full input
 * rate) on every hop of the agentic loop and across turns within the 5-min TTL.
 */
export function streamAgentReply(input: {
  threadId: number
  signal: AbortSignal
  systemPrompt: string
  tools: Anthropic.Tool[]
  dispatchTool: (name: string, input: Record<string, unknown>) => Promise<{
    content: string
    is_error?: boolean
    diagnostics?: { durationMs: number; resultCount?: number; handle?: string }
  }>
  model?: string
}): ReadableStream<Uint8Array> {
  const { threadId, signal, systemPrompt, tools, dispatchTool, model = MODEL } = input
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
        // B3.4 — cache token accumulators (cache_control: ephemeral on system prompt)
        let totalCacheCreationTokens = 0
        let totalCacheReadTokens = 0
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
              model,
              max_tokens: MAX_OUTPUT_TOKENS,
              system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
              tools,
              messages: anthropicMessages,
            },
            { signal },
          )

          stream.on('text', (delta: string) => {
            accumulatedText += delta
            sseEvent(controller, 'token', { text: delta })
          })

          const finalMessage = await stream.finalMessage()
          // B3.4 — cast for cache fields; accumulate across hops
          const hopUsage = finalMessage.usage as typeof finalMessage.usage & {
            cache_creation_input_tokens?: number
            cache_read_input_tokens?:     number
          }
          totalInputTokens         += hopUsage?.input_tokens                   ?? 0
          totalOutputTokens        += hopUsage?.output_tokens                  ?? 0
          totalCacheCreationTokens += hopUsage?.cache_creation_input_tokens    ?? 0
          totalCacheReadTokens     += hopUsage?.cache_read_input_tokens        ?? 0

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
            const result = await dispatchTool(tu.name, (tu.input ?? {}) as Record<string, unknown>)
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

        // B3.4 — fire token log once per turn (aggregated across hops). Best-effort.
        void import('~/lib/token-log.server').then(({ logApiTokens }) =>
          logApiTokens({
            feature: 'emma-chat', model, source: 'sync', caller: 'emma-chat',
            inputTokens:         totalInputTokens,
            outputTokens:        totalOutputTokens,
            cacheCreationTokens: totalCacheCreationTokens,
            cacheReadTokens:     totalCacheReadTokens,
          })
        ).catch((err) => console.error('[emma-chat] token-log failed (ignored):', err))

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

/**
 * Stream Emma's reply for the most recent user message in a thread.
 * Thin wrapper around streamAgentReply — behavior-preserving, zero changes to
 * Emma's prompt, tools, or model.
 */
export function streamEmmaReply(input: {
  threadId: number
  signal: AbortSignal
}): ReadableStream<Uint8Array> {
  return streamAgentReply({
    threadId: input.threadId,
    signal: input.signal,
    systemPrompt: EMMA_SME_SYSTEM_PROMPT,
    tools: EMMA_CHAT_TOOLS,
    dispatchTool: executeEmmaChatTool,
    model: MODEL,
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
