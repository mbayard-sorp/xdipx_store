/**
 * Chat-channel Claude streaming loop. Mirrors ivr/src/claude.ts but emits
 * plain text deltas (no TTS stripping) and a separate tool-event stream so
 * the UI can render product cards, draft-order confirmations, etc.
 *
 * Safety nets preserved from IVR:
 * - Ephemeral cache on system prompt
 * - MAX_TOOL_HOPS cap
 * - Soft token budget → wrap-up mode
 * - Send-intent regex trap: if Claude narrates "sent it" without calling
 *   createDraftOrder, we force-invoke the tool so users don't get lied to.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { ChatSession, AnyContentBlockParam } from './session.server'
import { getChatToolDefinitions, runChatTool } from './tools.server'

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 800
const MAX_TOOL_HOPS = 20

const SEND_INTENT_RE =
  /\b(sending|sent|send(ing)?\s+(it|that|the\s+(link|order))|email(ing)?\s+(you|it|that|the)|text(ing)?\s+(you|it|that)|on\s+(its|it's|the)\s+way|right\s+over|shooting\s+(it|that)\s+over|check\s+your\s+(phone|email|inbox|text|messages)|went\s+to\s+your\s+(email|inbox|phone|text)|link\s+(just\s+)?(went|sent|emailed)|just\s+went\s+to\s+your)\b/i

const apiKey = process.env['ANTHROPIC_API_KEY']
if (!apiKey) {
  console.warn('[emma/chat] ANTHROPIC_API_KEY not set — Claude calls will fail')
}

const client = new Anthropic({ apiKey: apiKey ?? '' })

export type ChatToolEvent =
  | { type: 'tool_use'; name: string; input: unknown; id: string }
  | { type: 'tool_result'; name: string; id: string; output: unknown }

export interface ChatStreamCallbacks {
  onToken: (token: string) => void
  onToolEvent: (event: ChatToolEvent) => void
  onDone: () => void
  onError: (err: unknown) => void
}

export async function streamChatReply(
  session: ChatSession,
  cb: ChatStreamCallbacks,
): Promise<void> {
  session.interrupt()
  const controller = new AbortController()
  session.abort = controller

  const silentCb: ChatStreamCallbacks = {
    onToken: () => {},
    onToolEvent: cb.onToolEvent,
    onDone: () => {},
    onError: () => {},
  }

  try {
    let hops = 0
    while (hops <= MAX_TOOL_HOPS) {
      const result = await runOneHop(session, controller, cb)
      if (controller.signal.aborted) break

      if (result.stopReason !== 'tool_use') {
        if (result.textBuf) session.addTurn('assistant', result.textBuf)

        const shouldForceDraft =
          !session.createdDraftOrderThisConversation &&
          result.textBuf.length > 0 &&
          SEND_INTENT_RE.test(result.textBuf)

        if (!shouldForceDraft) break

        console.warn(
          `[emma/chat] send-intent without tool_use session=${session.sessionId} — forcing createDraftOrder`,
        )
        const forced = await runOneHop(session, controller, silentCb, {
          type: 'tool',
          name: 'createDraftOrder',
        })
        if (controller.signal.aborted) break
        if (forced.stopReason !== 'tool_use') break

        session.addTurn('assistant', forced.blocks)
        const forcedResults = await executeTools(forced.blocks, session, cb)
        session.addTurn('user', forcedResults)
        hops++
        continue
      }

      session.addTurn('assistant', result.blocks)
      const toolResults = await executeTools(result.blocks, session, cb)
      session.addTurn('user', toolResults)
      hops++
    }
    cb.onDone()
  } catch (err) {
    if (controller.signal.aborted) {
      cb.onDone()
      return
    }
    console.error(
      `[emma/chat] streamChatReply error session=${session.sessionId}`,
      err instanceof Error ? `${err.name}: ${err.message}` : err,
    )
    cb.onError(err)
  } finally {
    if (session.abort === controller) session.abort = null
  }
}

async function executeTools(
  blocks: AnyContentBlockParam[],
  session: ChatSession,
  cb: ChatStreamCallbacks,
): Promise<Anthropic.ToolResultBlockParam[]> {
  const results: Anthropic.ToolResultBlockParam[] = []
  for (const block of blocks) {
    if (block.type !== 'tool_use') continue
    cb.onToolEvent({ type: 'tool_use', id: block.id, name: block.name, input: block.input })
    let output: unknown
    try {
      output = await runChatTool(block.name, block.input, { session })
    } catch (err) {
      output = { error: 'handler_threw', message: err instanceof Error ? err.message : String(err) }
    }
    if (block.name === 'createDraftOrder') {
      const res = output as { ok?: boolean } | null
      if (res?.ok) session.createdDraftOrderThisConversation = true
    }
    cb.onToolEvent({ type: 'tool_result', id: block.id, name: block.name, output })
    results.push({
      type: 'tool_result',
      tool_use_id: block.id,
      content: JSON.stringify(output),
    })
  }
  return results
}

interface HopResult {
  stopReason: Anthropic.Message['stop_reason']
  blocks: AnyContentBlockParam[]
  textBuf: string
}

async function runOneHop(
  session: ChatSession,
  controller: AbortController,
  cb: ChatStreamCallbacks,
  toolChoice?: Anthropic.ToolChoice,
): Promise<HopResult> {
  const messages = session.buildMessages()
  const tools = getChatToolDefinitions(session.settings.enabledTools)

  const stream = client.messages.stream(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: session.systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ] as unknown as Anthropic.TextBlockParam[],
      tools,
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
      messages: messages as Anthropic.MessageParam[],
    },
    { signal: controller.signal },
  )

  let textBuf = ''
  stream.on('text', (delta) => {
    textBuf += delta
    cb.onToken(delta)
  })

  const final = await stream.finalMessage()

  const usage = final.usage as Anthropic.Usage & {
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  const hopTokens =
    (usage.input_tokens ?? 0) +
    (usage.output_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  session.tokensUsed += hopTokens
  if (!session.wrapUpMode && session.tokensUsed > session.settings.softTokenBudget) {
    console.warn(`[emma/chat] soft token budget exceeded session=${session.sessionId} tokens=${session.tokensUsed}`)
    session.wrapUpMode = true
  }

  const blocks: AnyContentBlockParam[] = []
  for (const b of final.content) {
    if (b.type === 'text') blocks.push({ type: 'text', text: b.text })
    else if (b.type === 'tool_use') blocks.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input })
  }

  return { stopReason: final.stop_reason, blocks, textBuf }
}
