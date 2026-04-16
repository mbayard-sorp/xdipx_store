import Anthropic from '@anthropic-ai/sdk'
import { SMS_SYSTEM_PROMPT } from './prompt'
import { QA_TOOL_DEFINITIONS, runQaTool, type AgentContext } from './tools.server'

const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] ?? '' })

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOOL_HOPS = 3

export interface SmsTurn {
  role: 'user' | 'assistant'
  text: string
}

/**
 * Generate an SMS reply. Runs a small tool-use loop so Claude can answer
 * product questions (searchProducts / getProductDetails / listTodaysCollections)
 * before composing the final text reply. Cap output to ~320 chars so Twilio
 * sends at most 2 segments.
 */
export async function generateSmsReply(
  history: SmsTurn[],
  ctx: AgentContext = { channel: 'sms' },
): Promise<string> {
  const messages: Anthropic.MessageParam[] = history.map((t) => ({
    role: t.role,
    content: t.text,
  }))

  for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 320,
      system: SMS_SYSTEM_PROMPT,
      tools: QA_TOOL_DEFINITIONS,
      messages,
    })

    if (res.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: res.content })
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of res.content) {
        if (block.type !== 'tool_use') continue
        const result = await runQaTool(block.name, (block.input ?? {}) as Record<string, unknown>, ctx)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
          is_error: !result.ok,
        })
      }
      messages.push({ role: 'user', content: toolResults })
      continue
    }

    const textBlock = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    return clampSms(textBlock?.text ?? '')
  }

  // Ran out of hops — ask Claude for a plain-text wrap-up without tools.
  const final = await client.messages.create({
    model: MODEL,
    max_tokens: 240,
    system: SMS_SYSTEM_PROMPT + '\n\nRespond in plain text only — no further tool calls.',
    messages,
  })
  const block = final.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  return clampSms(block?.text ?? '')
}

export function clampSms(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= 320) return trimmed
  const cut = trimmed.slice(0, 317)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 260 ? cut.slice(0, lastSpace) : cut) + '...'
}
