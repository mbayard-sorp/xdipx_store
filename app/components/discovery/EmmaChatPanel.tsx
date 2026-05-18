/**
 * EmmaChatPanel — outer shell and state container for the public-facing
 * Emma Discovery Chat.
 *
 * Desktop (>= md): sticky right column, 320px, bg-paper rounded-[28px].
 * Mobile (< md): bottom-sheet drawer. Collapsed = fixed coral pill at
 *   bottom. Open = fixed inset-x-0 bottom-0 h-[70vh] rounded-t-[24px].
 *
 * Data flow:
 *   Submit → POST /api/emma-discovery-chat → { threadId, sessionId }
 *           → EventSource /api/emma-discovery-chat/stream/:threadId
 *           → SSE events: token | tool_call | tool_result | done | error
 *
 * No server imports. No .server.ts imports. No Next.js patterns.
 * Browser APIs guarded with typeof window checks.
 */

import { useEffect, useRef, useState } from 'react'
import { useDiscovery } from '~/stores/discovery'
import { getQuickReplies } from '~/lib/discovery-emma'
import { Bubble, FilterActionCard, QuickReplyRow, TypingDots } from './EmmaChatPanel.bubbles'
import { EmmaChatInput } from './EmmaChatPanel.input'
import type { FilterChipItem } from './EmmaChatPanel.bubbles'

/* ─── Public types ──────────────────────────────────────────────────────── */

/** Shape of SSE tool_call events from the stream. */
export interface ToolCallPayload {
  id: string
  name: string
  input: Record<string, unknown>
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCallPayload[]
  /** Unix ms — used for timestamp gap detection. */
  ts: number
}

interface EmmaChatPanelProps {
  // Vocab is validated server-side in the SSE route via getDiscoveryVocab();
  // the client does not need to know it, so this surface is intentionally empty.
}

/* ─── Constants ─────────────────────────────────────────────────────────── */

const FIVE_MINUTES_MS = 5 * 60 * 1000

/* ─── Helpers ───────────────────────────────────────────────────────────── */

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2)
}

function formatTimeGap(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes === 1) return '1 minute ago'
  return `${minutes} minutes ago`
}

/* ─── Main component ────────────────────────────────────────────────────── */

export function EmmaChatPanel(_props: EmmaChatPanelProps) {
  const { state, toggleMood, toggleAudience, toggleMatters, setBudget } = useDiscovery()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const threadRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)
  const inFlightIdRef = useRef<string | null>(null)

  // Derive quick replies from current discovery state
  const quickReplies = getQuickReplies(state)

  // Auto-scroll thread to bottom when messages change
  useEffect(() => {
    const el = threadRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, streaming])

  // Cleanup EventSource on unmount
  useEffect(() => {
    return () => {
      esRef.current?.close()
    }
  }, [])

  /* ── SSE stream handler ─────────────────────────────────────────────── */

  function openStream(tid: number) {
    esRef.current?.close()
    const es = new EventSource(`/api/emma-discovery-chat/stream/${tid}`)
    esRef.current = es

    es.addEventListener('token', (e: MessageEvent) => {
      const token = (e as MessageEvent<string>).data
      setMessages(prev => {
        const id = inFlightIdRef.current
        if (!id) return prev
        return prev.map(m =>
          m.id === id ? { ...m, content: m.content + token } : m,
        )
      })
    })

    es.addEventListener('tool_call', (e: MessageEvent) => {
      try {
        const tc: ToolCallPayload = JSON.parse((e as MessageEvent<string>).data)
        setMessages(prev => {
          const id = inFlightIdRef.current
          if (!id) return prev
          return prev.map(m =>
            m.id === id
              ? { ...m, toolCalls: [...(m.toolCalls ?? []), tc] }
              : m,
          )
        })
      } catch {
        // malformed event — skip
      }
    })

    es.addEventListener('tool_result', () => {
      // tool_result events are informational in the client. No UI action needed.
    })

    es.addEventListener('done', () => {
      es.close()
      esRef.current = null
      inFlightIdRef.current = null
      setStreaming(false)
    })

    es.addEventListener('error', (e: Event) => {
      es.close()
      esRef.current = null
      inFlightIdRef.current = null
      setStreaming(false)
      // Only surface a bubble error if it's a MessageEvent with data (server error event)
      if ('data' in e) {
        try {
          const payload = JSON.parse((e as MessageEvent<string>).data)
          const msg = typeof payload.error === 'string' ? payload.error : 'Something went wrong.'
          setMessages(prev => [
            ...prev,
            {
              id: generateId(),
              role: 'assistant',
              content: `Something went sideways there. Try again in a sec. (${msg})`,
              ts: Date.now(),
            },
          ])
        } catch {
          // native EventSource connection error — don't add a bubble
        }
      }
    })
  }

  /* ── Submit handler ─────────────────────────────────────────────────── */

  async function handleSubmit(userText: string) {
    if (!userText.trim() || streaming) return

    setErrorMsg(null)

    // Optimistically append the user bubble
    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: userText,
      ts: Date.now(),
    }
    setMessages(prev => [...prev, userMsg])

    // Placeholder assistant bubble (shown as TypingDots until tokens arrive)
    const assistantId = generateId()
    inFlightIdRef.current = assistantId
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      ts: Date.now(),
    }
    setMessages(prev => [...prev, assistantMsg])
    setStreaming(true)

    try {
      const res = await fetch('/api/emma-discovery-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText }),
      })

      if (!res.ok) {
        throw new Error(`POST failed: ${res.status}`)
      }

      const data = (await res.json()) as { threadId: number; sessionId: string }
      openStream(data.threadId)
    } catch (err) {
      setStreaming(false)
      inFlightIdRef.current = null
      setMessages(prev =>
        prev
          .filter(m => m.id !== assistantId)
          .concat({
            id: generateId(),
            role: 'assistant',
            content: "I lost the thread for a second. Mind trying that again? ♥",
            ts: Date.now(),
          }),
      )
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  /* ── FilterActionCard apply handler ────────────────────────────────── */

  function handleApply(chips: FilterChipItem[], isBudget: boolean, budgetValue?: number) {
    if (isBudget && typeof budgetValue === 'number') {
      setBudget(budgetValue)
      // Post a synthetic confirming user message
      void handleSubmit(`Set budget to $${budgetValue}`)
      return
    }

    const labels: string[] = []
    for (const chip of chips) {
      if (chip.action === 'add') {
        if (chip.group === 'mood')     { toggleMood(chip.value);     labels.push(chip.value) }
        if (chip.group === 'audience') { toggleAudience(chip.value); labels.push(chip.value) }
        if (chip.group === 'matters')  { toggleMatters(chip.value);  labels.push(chip.value) }
      } else {
        // remove: toggle off (toggles work as remove when value is already set)
        if (chip.group === 'mood')     { toggleMood(chip.value) }
        if (chip.group === 'audience') { toggleAudience(chip.value) }
        if (chip.group === 'matters')  { toggleMatters(chip.value) }
      }
    }

    if (labels.length > 0) {
      void handleSubmit(`Applied: ${labels.join(', ')}`)
    }
  }

  /* ── Render helpers ─────────────────────────────────────────────────── */

  const isEmpty = messages.length === 0

  // Last emma message index (for quick replies)
  const lastAssistantIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'assistant') return i
    }
    return -1
  })()

  function renderTimestampDivider(msg: ChatMessage, prev: ChatMessage | undefined) {
    if (!prev) return null
    const gap = msg.ts - prev.ts
    if (gap < FIVE_MINUTES_MS) return null
    return (
      <div className="flex justify-center py-1" aria-hidden="true">
        <span className="text-muted text-[11px]" style={{ fontFamily: 'var(--font-body)' }}>
          {formatTimeGap(gap)}
        </span>
      </div>
    )
  }

  const thread = (
    <div
      ref={threadRef}
      role="log"
      aria-live="polite"
      aria-label="Chat with Emma"
      className="flex flex-col gap-3 px-5 py-4 flex-1 overflow-y-auto"
      style={{ maxHeight: 'calc(100vh - 220px)' }}
    >
      {isEmpty ? (
        <EmptyState quickReplies={quickReplies} onSelect={handleSubmit} />
      ) : (
        messages.map((msg, i) => {
          const prev = messages[i - 1]
          const isLastAssistant = i === lastAssistantIndex

          return (
            <div key={msg.id}>
              {renderTimestampDivider(msg, prev)}
              <Bubble role={msg.role}>
                {msg.role === 'assistant' && msg.content === '' && streaming && inFlightIdRef.current === msg.id ? (
                  // Content not yet started: render TypingDots inline
                  <TypingDotsInline />
                ) : (
                  msg.content
                )}
                {/* Render FilterActionCard for each tool call */}
                {msg.toolCalls?.map(tc => (
                  <FilterActionCard
                    key={tc.id}
                    toolCall={tc}
                    onApply={handleApply}
                    disabled={streaming}
                  />
                ))}
              </Bubble>

              {/* Quick replies below last assistant bubble, not while streaming */}
              {isLastAssistant && !streaming && quickReplies.length > 0 && (
                <QuickReplyRow
                  replies={quickReplies}
                  onSelect={handleSubmit}
                  disabled={streaming}
                />
              )}
            </div>
          )
        })
      )}

      {/* Standalone TypingDots while we wait for POST + first token */}
      {streaming && messages.at(-1)?.role === 'user' && (
        <TypingDots />
      )}
    </div>
  )

  const header = (
    <div className="flex items-center gap-3 px-5 py-3 border-b border-line flex-none" style={{ height: 56 }}>
      <img
        src="/emma.png"
        alt="Emma"
        width={44}
        height={44}
        className="rounded-full object-cover flex-none"
        style={{ width: 44, height: 44 }}
      />
      <div className="flex items-center gap-2">
        <span
          className="font-bold text-ink text-base"
          style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic' }}
        >
          Emma
        </span>
        <span
          className="w-1.5 h-1.5 rounded-full bg-sage flex-none"
          aria-hidden="true"
        />
      </div>
    </div>
  )

  const input = (
    <EmmaChatInput
      value={inputValue}
      onChange={setInputValue}
      onSubmit={handleSubmit}
      disabled={streaming}
    />
  )

  /* ── Desktop panel ──────────────────────────────────────────────────── */

  const desktopPanel = (
    <aside
      className="hidden md:flex flex-col"
      style={{
        position: 'sticky',
        top: 24,
        width: 320,
        flexShrink: 0,
        alignSelf: 'flex-start',
        background: 'var(--color-paper)',
        borderRadius: 28,
        border: '1px solid var(--color-line)',
        boxShadow: '0 8px 24px -12px rgba(21,18,17,0.12)',
        overflow: 'hidden',
        maxHeight: 'calc(100vh - 48px)',
      }}
    >
      {header}
      {thread}
      {input}
      {errorMsg && (
        <p className="px-5 pb-2 text-[11px] text-muted/60" style={{ fontFamily: 'var(--font-body)' }}>
          Debug: {errorMsg}
        </p>
      )}
    </aside>
  )

  /* ── Mobile collapsed pill ──────────────────────────────────────────── */

  const latestEmmaLine = [...messages].reverse().find(m => m.role === 'assistant' && m.content)?.content
    ?? "Hi, I'm Emma. Want me to help you find something good?"

  const mobilePill = (
    <div className="md:hidden fixed bottom-4 inset-x-4 z-40" style={{ maxWidth: 480, margin: '0 auto' }}>
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="w-full flex items-center gap-3 bg-coral text-paper rounded-full px-4 py-3 shadow-lg"
      >
        <img
          src="/emma.png"
          alt="Emma"
          width={32}
          height={32}
          className="rounded-full object-cover flex-none border-2 border-paper/40"
          style={{ width: 32, height: 32 }}
        />
        <p
          className="text-sm font-semibold truncate text-left flex-1"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          {latestEmmaLine.length > 60 ? latestEmmaLine.slice(0, 57) + '…' : latestEmmaLine}
        </p>
        <span className="text-paper/80 text-sm flex-none" style={{ fontFamily: 'var(--font-display)' }}>
          Reply ♥
        </span>
      </button>
    </div>
  )

  /* ── Mobile open sheet ──────────────────────────────────────────────── */

  // TODO v2: implement actual swipe-to-close gesture. v1 is tap-outside or tap-handle only.

  const mobileSheet = mobileOpen ? (
    <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-ink/20"
        aria-hidden="true"
        onClick={() => setMobileOpen(false)}
      />

      {/* Sheet */}
      <div
        className="relative flex flex-col bg-paper rounded-t-[24px] overflow-hidden"
        style={{ height: '70vh' }}
      >
        {/* Swipe handle */}
        <button
          type="button"
          className="mx-auto mt-2 mb-0 w-12 h-1 bg-line rounded-full flex-none"
          onClick={() => setMobileOpen(false)}
          aria-label="Close Emma chat"
        />
        {header}
        {/* Thread in mobile: override maxHeight to fill available space */}
        <div
          ref={threadRef}
          role="log"
          aria-live="polite"
          aria-label="Chat with Emma"
          className="flex flex-col gap-3 px-5 py-4 flex-1 overflow-y-auto"
        >
          {isEmpty ? (
            <EmptyState quickReplies={quickReplies} onSelect={(r) => { handleSubmit(r) }} />
          ) : (
            messages.map((msg, i) => {
              const prev = messages[i - 1]
              const isLastAssistant = i === lastAssistantIndex
              return (
                <div key={msg.id}>
                  {renderTimestampDivider(msg, prev)}
                  <Bubble role={msg.role}>
                    {msg.role === 'assistant' && msg.content === '' && streaming && inFlightIdRef.current === msg.id ? (
                      <TypingDotsInline />
                    ) : (
                      msg.content
                    )}
                    {msg.toolCalls?.map(tc => (
                      <FilterActionCard
                        key={tc.id}
                        toolCall={tc}
                        onApply={handleApply}
                        disabled={streaming}
                      />
                    ))}
                  </Bubble>
                  {isLastAssistant && !streaming && quickReplies.length > 0 && (
                    <QuickReplyRow
                      replies={quickReplies}
                      onSelect={handleSubmit}
                      disabled={streaming}
                    />
                  )}
                </div>
              )
            })
          )}
          {streaming && messages.at(-1)?.role === 'user' && <TypingDots />}
        </div>
        {input}
      </div>
    </div>
  ) : null

  return (
    <>
      {desktopPanel}
      {mobilePill}
      {mobileSheet}
    </>
  )
}

/* ─── Empty state ───────────────────────────────────────────────────────── */

interface EmptyStateProps {
  quickReplies: string[]
  onSelect: (reply: string) => void
}

function EmptyState({ quickReplies, onSelect }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
      <img
        src="/emma.png"
        alt="Emma"
        width={64}
        height={64}
        className="rounded-full object-cover"
        style={{ width: 64, height: 64 }}
      />
      <p
        className="text-[15px] text-ink/70 italic leading-snug max-w-[220px]"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Hi — I&apos;m Emma. Want me to help you find something good?
      </p>
      {quickReplies.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {quickReplies.map(r => (
            <button
              key={r}
              type="button"
              onClick={() => onSelect(r)}
              className="bg-paper border border-line text-ink rounded-full px-3 py-1.5 text-[13px] font-semibold hover:bg-cream-2 transition-colors"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {r}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── TypingDotsInline ──────────────────────────────────────────────────── */
// Lightweight variant rendered inside a Bubble wrapper (Bubble provides the
// bg-cream-2 shell; this just renders the dots themselves).

function TypingDotsInline() {
  return (
    <span className="flex items-center gap-1.5 py-0.5" aria-label="Emma is typing" role="status">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="w-1.5 h-1.5 bg-ink/40 rounded-full animate-pulse"
          style={{ animationDelay: `${i * 0.4}s` }}
        />
      ))}
    </span>
  )
}
