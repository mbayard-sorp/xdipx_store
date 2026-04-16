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
import type { Session } from './session.ts'
import { TOOL_DEFINITIONS, runTool } from './tools/index.ts'
import { IVR_LIMITS } from './config.ts'

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 150
const MAX_TOOL_HOPS = 4

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

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }

export async function streamReply(
  session: Session,
  cb: StreamCallbacks,
): Promise<void> {
  session.interrupt()
  const controller = new AbortController()
  session.abort = controller

  try {
    let hops = 0
    while (hops <= MAX_TOOL_HOPS) {
      const result = await runOneHop(session, controller, cb)
      if (controller.signal.aborted) break

      if (result.stopReason !== 'tool_use') break

      // Push the full assistant block list (text + tool_use) into the tool-hop
      // scratch history so Claude sees its own calls when we re-enter the loop.
      session.toolHopHistory.push({
        role: 'assistant',
        content: result.blocks as unknown as string,
      })

      // Execute every tool_use in this turn
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
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(output),
        })
      }
      session.toolHopHistory.push({ role: 'user', content: toolResults })
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
    session.toolHopHistory = []
  }
}

interface HopResult {
  stopReason: Anthropic.Message['stop_reason']
  blocks: ContentBlock[]
}

async function runOneHop(
  session: Session,
  controller: AbortController,
  cb: StreamCallbacks,
): Promise<HopResult> {
  const messages = [...session.buildMessages(), ...session.toolHopHistory]

  const stream = client.messages.stream(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // cache_control is GA on the Messages API; SDK 0.32.1 types lag, so cast.
      system: [
        {
          type: 'text',
          text: session.systemPrompt || buildSystemPrompt(DEFAULT_BRAND_VOICE),
          cache_control: { type: 'ephemeral' },
        },
      ] as unknown as Anthropic.TextBlockParam[],
      tools: TOOL_DEFINITIONS,
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

  const blocks: ContentBlock[] = final.content.map((b) => {
    if (b.type === 'text') return { type: 'text', text: b.text }
    if (b.type === 'tool_use') {
      return { type: 'tool_use', id: b.id, name: b.name, input: b.input }
    }
    return { type: 'text', text: '' }
  })

  if (final.stop_reason !== 'tool_use' && textBuf) {
    session.addTurn('assistant', textBuf)
  }

  return { stopReason: final.stop_reason, blocks }
}
