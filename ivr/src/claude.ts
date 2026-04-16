/**
 * Claude streaming for a single caller turn — with tool use.
 *
 * Loop shape:
 *   1. Send history + tools to Claude, stream deltas to Twilio as text tokens.
 *   2. If the turn ended with stop_reason="tool_use", execute each tool,
 *      append tool_result blocks, re-open a stream, repeat.
 *   3. Loop caps at MAX_TOOL_HOPS to prevent runaway tool calls.
 *
 * Cost levers: Haiku model, prompt caching on system + tool defs, max_tokens
 * cap, pre-truncated history, AbortSignal for barge-in.
 */
import Anthropic from '@anthropic-ai/sdk'
import { buildSystemPrompt } from './prompts.ts'
import { DEFAULT_BRAND_VOICE } from './settings.ts'
import type { AnyContentBlockParam, Session } from './session.ts'
import { TOOL_DEFINITIONS, runTool } from './tools/index.ts'
import { IVR_LIMITS } from './config.ts'

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 150
// Forced tool calls must emit a full JSON payload (e.g. createDraftOrder:
// items array + email + address + state + zip). 150 tokens truncates that
// and the stream stops with max_tokens before the tool_use block closes.
const MAX_TOKENS_FORCED_TOOL = 800
// Single-turn flow can need: searchProducts -> getProductDetails ->
// lookupReturningCustomer -> createDraftOrder -> final text. 4 was too tight
// and Claude bailed before reaching createDraftOrder. 6 leaves headroom.
const MAX_TOOL_HOPS = 6

// Haiku sometimes narrates "sending it right over" without actually emitting
// the createDraftOrder tool_use block — the caller hears the promise but no
// draft/SMS ever goes out. When we detect this pattern and no draft has been
// created this call, we re-run the hop with tool_choice forced so the tool
// actually fires. Stronger prompting alone has not reliably fixed this.
const SEND_INTENT_RE =
  /\b(sending|sent|send(ing)?\s+(it|that|the\s+(link|order))|email(ing)?\s+(you|it|that|the)|text(ing)?\s+(you|it|that)|on\s+(its|it's|the)\s+way|right\s+over|shooting\s+(it|that)\s+over|check\s+your\s+(phone|email|inbox|text|messages)|went\s+to\s+your\s+(email|inbox|phone|text)|link\s+(just\s+)?(went|sent|emailed)|just\s+went\s+to\s+your)\b/i

const apiKey = process.env['ANTHROPIC_API_KEY']
if (!apiKey) {
  console.warn('[ivr] ANTHROPIC_API_KEY not set — Claude calls will fail')
}

const client = new Anthropic({ apiKey: apiKey ?? '' })

// ElevenLabs reads markdown markers literally ("asterisk asterisk"). Strip the
// formatting characters that have no spoken meaning before forwarding deltas
// to Twilio. Punctuation that affects prosody (.,?!:;-) is preserved.
function stripForTTS(s: string): string {
  return s.replace(/[*_`~#]+/g, '')
}

export interface StreamCallbacks {
  onToken: (token: string) => void
  onDone: () => void
  onError: (err: unknown) => void
}

export async function streamReply(
  session: Session,
  cb: StreamCallbacks,
): Promise<void> {
  session.interrupt()
  const controller = new AbortController()
  session.abort = controller

  const silentCb: StreamCallbacks = {
    onToken: () => {},
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
          !session.createdDraftOrderThisCall &&
          result.textBuf.length > 0 &&
          SEND_INTENT_RE.test(result.textBuf)

        if (!shouldForceDraft) break

        console.warn(
          `[ivr] send-intent without tool_use callSid=${session.callSid} — forcing createDraftOrder`,
        )
        const forced = await runOneHop(session, controller, silentCb, {
          type: 'tool',
          name: 'createDraftOrder',
        })
        if (controller.signal.aborted) break
        if (forced.stopReason !== 'tool_use') {
          console.error(
            `[ivr] forced createDraftOrder did not emit tool_use callSid=${session.callSid} stop=${forced.stopReason}`,
          )
          break
        }
        session.addTurn('assistant', forced.blocks)
        const forcedResults: Anthropic.ToolResultBlockParam[] = []
        for (const block of forced.blocks) {
          if (block.type !== 'tool_use') continue
          console.log(`[ivr] tool_use (forced) callSid=${session.callSid} name=${block.name}`)
          let output: unknown
          try {
            output = await runTool(block.name, block.input, { session })
          } catch (err) {
            output = { error: 'handler_threw', message: err instanceof Error ? err.message : String(err) }
          }
          if (block.name === 'createDraftOrder') session.createdDraftOrderThisCall = true
          forcedResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(output),
          })
        }
        session.addTurn('user', forcedResults)
        hops++
        continue
      }

      // Persist the assistant turn (text + tool_use blocks) so the next user
      // turn still has variantIds, lookup results, etc. Without this, Claude
      // would re-search on every "yes" and never reach createDraftOrder.
      session.addTurn('assistant', result.blocks)

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of result.blocks) {
        if (block.type !== 'tool_use') continue
        console.log(`[ivr] tool_use callSid=${session.callSid} name=${block.name}`)
        let output: unknown
        try {
          output = await runTool(block.name, block.input, { session })
        } catch (err) {
          output = { error: 'handler_threw', message: err instanceof Error ? err.message : String(err) }
        }
        if (block.name === 'createDraftOrder') session.createdDraftOrderThisCall = true
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(output),
        })
      }
      session.addTurn('user', toolResults)
      hops++
    }
    cb.onDone()
  } catch (err) {
    if (controller.signal.aborted) {
      cb.onDone()
      return
    }
    cb.onError(err)
  } finally {
    if (session.abort === controller) session.abort = null
  }
}

interface HopResult {
  stopReason: Anthropic.Message['stop_reason']
  blocks: AnyContentBlockParam[]
  textBuf: string
}

async function runOneHop(
  session: Session,
  controller: AbortController,
  cb: StreamCallbacks,
  toolChoice?: Anthropic.ToolChoice,
): Promise<HopResult> {
  const messages = session.buildMessages()

  const stream = client.messages.stream(
    {
      model: MODEL,
      max_tokens: toolChoice ? MAX_TOKENS_FORCED_TOOL : MAX_TOKENS,
      // cache_control is GA on the Messages API; SDK 0.32.1 types lag, so cast.
      system: [
        {
          type: 'text',
          text: session.systemPrompt || buildSystemPrompt(DEFAULT_BRAND_VOICE),
          cache_control: { type: 'ephemeral' },
        },
      ] as unknown as Anthropic.TextBlockParam[],
      tools: TOOL_DEFINITIONS,
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
      messages: messages as Anthropic.MessageParam[],
    },
    { signal: controller.signal },
  )

  let textBuf = ''
  stream.on('text', (delta) => {
    textBuf += delta
    const spoken = stripForTTS(delta)
    if (spoken) cb.onToken(spoken)
  })

  const final = await stream.finalMessage()

  // Cache fields exist on the API but SDK 0.32.1 Usage type omits them.
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
  if (!session.wrapUpMode && session.tokensUsed > IVR_LIMITS.softTokenBudget) {
    console.warn(`[ivr] soft token budget exceeded callSid=${session.callSid} tokens=${session.tokensUsed}`)
    session.wrapUpMode = true
  }

  const blocks: AnyContentBlockParam[] = []
  for (const b of final.content) {
    if (b.type === 'text') blocks.push({ type: 'text', text: b.text })
    else if (b.type === 'tool_use') blocks.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input })
  }

  if (textBuf) {
    console.log(`[ivr] assistant callSid=${session.callSid}: ${textBuf.replace(/\s+/g, ' ').trim()}`)
  }

  return { stopReason: final.stop_reason, blocks, textBuf }
}
