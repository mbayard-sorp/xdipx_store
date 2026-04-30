/**
 * Per-call state. One Session per WebSocket connection; GC'd on close.
 *
 * History is bounded: we keep the last MAX_TURNS user/assistant pairs in full
 * fidelity and roll older turns into a short running summary that rides at the
 * top of the message list. This keeps input tokens flat as calls get long.
 */
import type Anthropic from '@anthropic-ai/sdk'
import { IVR_LIMITS, type CallEndReason } from './config.ts'
import type { IvrSettings } from './settings.ts'

/** Per-call runtime limits. Defaults come from IVR_LIMITS but Vercel can
 *  override any field by appending it as a URL param when handing the call
 *  off, so admin edits in /admin/ivr take effect on the next call without a
 *  Fly redeploy. */
export type SessionLimits = typeof IVR_LIMITS

type Role = 'user' | 'assistant'
/** SDK 0.32.x doesn't export a single ContentBlockParam alias, but
 *  MessageParam.content is `string | Array<...>` of these four. */
export type AnyContentBlockParam =
  | Anthropic.TextBlockParam
  | Anthropic.ImageBlockParam
  | Anthropic.ToolUseBlockParam
  | Anthropic.ToolResultBlockParam
/** Turn content is either a plain spoken/typed string OR an array of Anthropic
 *  content blocks (text + tool_use for assistant turns, tool_result for user
 *  turns). Tool blocks must persist across user turns so Claude retains
 *  variantIds, customer lookups, etc. — otherwise it loops on searchProducts
 *  and never reaches createDraftOrder. */
export type TurnContent = string | AnyContentBlockParam[]
export interface Turn {
  role: Role
  content: TurnContent
}

// Higher than before because tool turns add 2 rows per hop (assistant blocks +
// user tool_result). 40 rows ≈ 10–12 conversational turns with tool use.
const MAX_TURNS = 40

export class Session {
  callSid = ''
  fromNumber = ''
  toNumber = ''
  summary = '' // running summary of truncated turns
  history: Turn[] = []
  abort: AbortController | null = null
  /** Per-call rate-limiting counters keyed by tool name. */
  toolCallCount: Record<string, number> = {}
  /** Total prompt events observed this call (runaway guard). */
  promptCount = 0
  /** How many re-engage nudges we've sent without a caller response. */
  reEngageCount = 0
  /** Wall-clock start so we can compute remaining budget. */
  startedAt = Date.now()
  /** Total Claude tokens consumed this call (input + output, across all hops). */
  tokensUsed = 0
  /** Once true, we inject a "wrap up" hint into the next turn's messages. */
  wrapUpMode = false
  /** True once createDraftOrder has been invoked this call. Guards the
   *  send-intent trap in claude.ts from firing twice. */
  createdDraftOrderThisCall = false
  /** Reason we'll log on WS close, if we end the call ourselves. */
  endReason: CallEndReason = 'user_hangup'
  /** Admin-configured prompts + farewells, resolved once at session start. */
  settings: IvrSettings | null = null
  /** Resolved system prompt for this call (built from settings.brandVoice). */
  systemPrompt = ''
  /** Per-call limits (initialSilenceMs, maxPrompts, etc.). Starts as a copy of
   *  IVR_LIMITS; the WS upgrade handler overrides any fields the Vercel TwiML
   *  passed as URL params. */
  limits: SessionLimits = { ...IVR_LIMITS }
  /** Active silence/duration timers owned by the session. */
  private silenceTimer: NodeJS.Timeout | null = null
  private durationTimer: NodeJS.Timeout | null = null

  /** Arm or reset the silence timer. onFire runs when the caller has been quiet. */
  armSilence(ms: number, onFire: () => void): void {
    this.clearSilence()
    this.silenceTimer = setTimeout(onFire, ms)
  }

  clearSilence(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer)
      this.silenceTimer = null
    }
  }

  /** Hard cap on call length — fires once, set at setup. */
  armDuration(ms: number, onFire: () => void): void {
    this.clearDuration()
    this.durationTimer = setTimeout(onFire, ms)
  }

  clearDuration(): void {
    if (this.durationTimer) {
      clearTimeout(this.durationTimer)
      this.durationTimer = null
    }
  }

  clearTimers(): void {
    this.clearSilence()
    this.clearDuration()
  }

  incrementToolCall(name: string): number {
    const n = (this.toolCallCount[name] ?? 0) + 1
    this.toolCallCount[name] = n
    return n
  }

  addTurn(role: Role, content: TurnContent): void {
    this.history.push({ role, content })
    this.truncate()
  }

  /** Drop oldest turns when over cap. The Anthropic API rejects a leading
   *  user tool_result that has no matching assistant tool_use, so when
   *  truncation would land on one we keep dropping until the new head is a
   *  plain caller utterance. */
  private truncate(): void {
    if (this.history.length <= MAX_TURNS) return
    let dropCount = this.history.length - MAX_TURNS
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
    this.summary = this.summary
      ? `${this.summary}\n${droppedText}`
      : droppedText
  }

  /** Build the message list to send to Claude for the next turn. */
  buildMessages(): Anthropic.MessageParam[] {
    const msgs: Anthropic.MessageParam[] = []
    if (this.summary) {
      msgs.push({
        role: 'user',
        content: `[Earlier in this call, summarised]\n${this.summary}`,
      })
      msgs.push({ role: 'assistant', content: 'Understood.' })
    }
    for (const t of this.history) {
      msgs.push({ role: t.role, content: t.content } as Anthropic.MessageParam)
    }
    if (this.wrapUpMode) {
      msgs.push({
        role: 'user',
        content: '[System note: this call is running long on tokens. Wrap up politely in your next reply — offer voicemail if the caller has more to discuss, then end.]',
      })
    }
    return msgs
  }

  /** Abort any in-flight Claude stream (caller barge-in). */
  interrupt(): void {
    if (this.abort) {
      this.abort.abort()
      this.abort = null
    }
  }
}

/** Render a turn as a single human-readable line. Used for voicemail
 *  transcripts and the running summary when turns are truncated. */
export function turnToText(t: Turn): string {
  const role = t.role === 'user' ? 'Caller' : 'Agent'
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
