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
import { useRouteLoaderData } from 'react-router'
import { useDiscovery } from '~/stores/discovery'
import { getQuickReplies } from '~/lib/discovery-emma'
import { Bubble, FilterActionCard, QuickReplyRow, TypingDots } from './EmmaChatPanel.bubbles'
import { EmmaChatInput } from './EmmaChatPanel.input'
import type { FilterChipItem } from './EmmaChatPanel.bubbles'
import type { EmmaPersona } from '~/types/cms'

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

  // Sanity-backed persona override (avatar + display name), same source the
  // static EmmaSidekick reads from. Falls back to /emma.png and "Emma".
  const layoutData = useRouteLoaderData('routes/_layout') as { emmaPersona?: EmmaPersona | null } | undefined
  const emmaPersona = layoutData?.emmaPersona ?? null
  const avatarSrc = emmaPersona?.avatarUrl ?? '/emma.png'
  const avatarAlt = emmaPersona?.avatarAlt || emmaPersona?.displayName || 'Emma'
  const displayName = emmaPersona?.displayName || 'Emma'

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
      // Server sends `{ text: string }` per the admin stream contract.
      let token = ''
      try {
        const parsed = JSON.parse((e as MessageEvent<string>).data)
        token = typeof parsed?.text === 'string' ? parsed.text : ''
      } catch {
        return
      }
      if (!token) return
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
        <span
          className="text-ink-4 uppercase"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.18em' }}
        >
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
      className="flex flex-col gap-3 px-5 py-4 flex-1 min-h-0 overflow-y-auto"
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

  // Header — mirrors EmmaSidekick §07: 52px avatar with green status dot,
  // Newsreader italic name, mono uppercase role kicker.
  const header = (
    <div className="flex items-center gap-3.5 px-6 pt-6 pb-4 border-b border-line flex-none">
      <div className="relative flex-none">
        <img
          src={avatarSrc}
          alt={avatarAlt}
          width={104}
          height={104}
          className="rounded-full object-cover block"
          style={{ width: 52, height: 52, boxShadow: '0 4px 12px rgba(26,20,24,.12)' }}
        />
        <span
          aria-hidden="true"
          className="absolute right-0 bottom-0 rounded-full"
          style={{
            width: 11,
            height: 11,
            background: '#4caf50',
            border: '2px solid var(--color-paper)',
          }}
        />
      </div>
      <div>
        <p
          className="text-ink leading-none"
          style={{
            fontFamily: 'var(--font-display)',
            fontStyle: 'italic',
            fontSize: '22px',
            letterSpacing: '-0.01em',
          }}
        >
          {displayName}
        </p>
        <p
          className="text-ink-3 mt-1"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
          }}
        >
          Your guide · online
        </p>
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

  // Desktop panel — Style Guide §10: 340px column, sticky 24px top, paper
  // surface with line-2 hairline border. No drop shadow (the rest of the
  // page is flat-paper too; shadow would feel un-systemic).
  const desktopPanel = (
    <aside
      className="hidden md:flex flex-col"
      style={{
        position: 'sticky',
        top: 24,
        width: 340,
        flexShrink: 0,
        alignSelf: 'flex-start',
        background: 'var(--color-paper)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-line-2)',
        overflow: 'hidden',
        maxHeight: 'calc(100vh - 48px)',
      }}
    >
      {header}
      {thread}
      {input}
      {errorMsg && (
        <p className="px-6 pb-2 text-[11px] text-ink-4" style={{ fontFamily: 'var(--font-mono)' }}>
          {errorMsg}
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
        className="w-full flex items-center gap-3 bg-paper border border-line-2 rounded-full px-3 py-2"
        style={{ boxShadow: '0 6px 18px -10px rgba(26,20,24,.18)' }}
      >
        <img
          src={avatarSrc}
          alt={avatarAlt}
          width={32}
          height={32}
          className="rounded-full object-cover flex-none"
          style={{ width: 32, height: 32 }}
        />
        <p
          className="text-[13px] text-ink-2 truncate text-left flex-1"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          {latestEmmaLine.length > 60 ? latestEmmaLine.slice(0, 57) + '…' : latestEmmaLine}
        </p>
        <span
          className="text-ink-3 flex-none uppercase"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.14em' }}
        >
          Reply
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
          className="flex flex-col gap-3 px-5 py-4 flex-1 min-h-0 overflow-y-auto"
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
    <div className="flex flex-col gap-4 py-4">
      {/* Emma opener — Newsreader italic 19px to match the sidekick one-liner. */}
      <p
        className="text-ink-2 leading-[1.4]"
        style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: '19px' }}
      >
        Hey. Tell me what you&apos;re after and I&apos;ll pull a few things.
      </p>

      {quickReplies.length > 0 && (
        <>
          <p
            className="text-ink-3 uppercase"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.18em' }}
          >
            Start with
          </p>
          <div className="flex flex-wrap gap-2">
            {quickReplies.map(r => (
              <button
                key={r}
                type="button"
                onClick={() => onSelect(r)}
                className="inline-flex items-center rounded-full border bg-paper text-ink border-line-2 px-3 py-1.5 text-[13px] hover:border-ink/60 transition-colors"
                style={{ fontFamily: 'var(--font-body)' }}
              >
                {r}
              </button>
            ))}
          </div>
        </>
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
          className="w-1.5 h-1.5 bg-ink-3 rounded-full animate-pulse"
          style={{ animationDelay: `${i * 0.4}s` }}
        />
      ))}
    </span>
  )
}
