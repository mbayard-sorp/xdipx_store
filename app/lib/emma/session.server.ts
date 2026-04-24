/**
 * Per-session state for a chat conversation. Mirrors the IVR Session class
 * (ivr/src/session.ts) but scoped to a text-channel session — no silence
 * timers, no caller ID.
 *
 * History is bounded: last MAX_TURNS user/assistant pairs in full fidelity,
 * older turns roll into a rolling summary so input tokens stay flat on long
 * conversations.
 */
import type Anthropic from '@anthropic-ai/sdk'
import type { ChatSettings } from './settings.server'

type Role = 'user' | 'assistant'

export type AnyContentBlockParam =
  | Anthropic.TextBlockParam
  | Anthropic.ImageBlockParam
  | Anthropic.ToolUseBlockParam
  | Anthropic.ToolResultBlockParam

export type TurnContent = string | AnyContentBlockParam[]

export interface Turn {
  role: Role
  content: TurnContent
}

export interface ChatSessionInit {
  sessionId: string
  email?: string | null
  phone?: string | null
  systemPrompt: string
  settings: ChatSettings
}

export class ChatSession {
  sessionId: string
  email: string | null
  phone: string | null
  summary = ''
  history: Turn[] = []
  abort: AbortController | null = null
  toolCallCount: Record<string, number> = {}
  startedAt = Date.now()
  lastActivityAt = Date.now()
  tokensUsed = 0
  wrapUpMode = false
  createdDraftOrderThisConversation = false
  systemPrompt: string
  settings: ChatSettings

  constructor(init: ChatSessionInit) {
    this.sessionId = init.sessionId
    this.email = init.email ?? null
    this.phone = init.phone ?? null
    this.systemPrompt = init.systemPrompt
    this.settings = init.settings
  }

  incrementToolCall(name: string): number {
    const n = (this.toolCallCount[name] ?? 0) + 1
    this.toolCallCount[name] = n
    return n
  }

  addTurn(role: Role, content: TurnContent): void {
    this.history.push({ role, content })
    this.lastActivityAt = Date.now()
    this.truncate()
  }

  private truncate(): void {
    const max = this.settings.maxTurns
    if (this.history.length <= max) return
    let dropCount = this.history.length - max
    while (dropCount < this.history.length) {
      const head = this.history[dropCount]
      if (!head) break
      const isToolResultHead = head.role === 'user' && Array.isArray(head.content)
      if (!isToolResultHead) break
      dropCount++
    }
    if (dropCount === 0) return
    const dropped = this.history.splice(0, dropCount)
    const droppedText = dropped.map(turnToText).join('\n')
    this.summary = this.summary ? `${this.summary}\n${droppedText}` : droppedText
  }

  buildMessages(): Anthropic.MessageParam[] {
    const msgs: Anthropic.MessageParam[] = []
    if (this.summary) {
      msgs.push({
        role: 'user',
        content: `[Earlier in this conversation, summarised]\n${this.summary}`,
      })
      msgs.push({ role: 'assistant', content: 'Understood.' })
    }
    for (const t of this.history) {
      msgs.push({ role: t.role, content: t.content } as Anthropic.MessageParam)
    }
    if (this.wrapUpMode) {
      msgs.push({
        role: 'user',
        content:
          '[System note: this conversation is getting long. Wrap up politely in your next reply — offer to follow up by email if they have more to discuss, then end.]',
      })
    }
    return msgs
  }

  interrupt(): void {
    if (this.abort) {
      this.abort.abort()
      this.abort = null
    }
  }
}

export function turnToText(t: Turn): string {
  const role = t.role === 'user' ? 'User' : 'Emma'
  if (typeof t.content === 'string') return `${role}: ${t.content}`
  const parts = t.content
    .map((b) => {
      if (b.type === 'text') return b.text
      if (b.type === 'tool_use') return `[called ${b.name}]`
      if (b.type === 'tool_result') return `[tool result]`
      return ''
    })
    .filter(Boolean)
  return `${role}: ${parts.join(' ')}`
}
