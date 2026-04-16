/**
 * Per-call state. One Session per WebSocket connection; GC'd on close.
 *
 * History is bounded: we keep the last MAX_TURNS user/assistant pairs in full
 * fidelity and roll older turns into a short running summary that rides at the
 * top of the message list. This keeps input tokens flat as calls get long.
 */
import type Anthropic from '@anthropic-ai/sdk'
import type { CallEndReason } from './config.ts'
import type { IvrSettings } from './settings.ts'

type Role = 'user' | 'assistant'
export interface Turn {
  role: Role
  content: string
}

const MAX_TURNS = 12 // 12 user+assistant messages total, not pairs

export class Session {
  callSid = ''
  fromNumber = ''
  toNumber = ''
  summary = '' // running summary of truncated turns
  history: Turn[] = []
  /** Ephemeral per-turn scratch space for multi-hop tool-use loops.
   *  Cleared at the end of every streamReply call. */
  toolHopHistory: Anthropic.MessageParam[] = []
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
  /** Reason we'll log on WS close, if we end the call ourselves. */
  endReason: CallEndReason = 'user_hangup'
  /** Admin-configured prompts + farewells, resolved once at session start. */
  settings: IvrSettings | null = null
  /** Resolved system prompt for this call (built from settings.brandVoice). */
  systemPrompt = ''
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

  addTurn(role: Role, content: string): void {
    this.history.push({ role, content })
    this.truncate()
  }

  /** Drop oldest turns when over cap. Summary update happens lazily in Phase E. */
  private truncate(): void {
    if (this.history.length <= MAX_TURNS) return
    const dropped = this.history.splice(0, this.history.length - MAX_TURNS)
    // Minimal running-summary stub; Phase E replaces with a Sonnet summarisation call.
    const droppedText = dropped.map((t) => `${t.role}: ${t.content}`).join('\n')
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
    for (const t of this.history) msgs.push({ role: t.role, content: t.content })
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
