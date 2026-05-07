import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useRevalidator, useFetcher } from 'react-router'
import { useEffect, useRef, useCallback, useState } from 'react'
import { requireAdmin } from '~/lib/session.server'
import {
  getOrCreateCurrentThread,
  clearCurrentThread,
  appendUserMessage,
  type EmmaChatMessage,
} from '~/lib/emma-chat.server'
import { ChatMessage, type ChatMessageData } from '~/components/admin/EmmaChat/ChatMessage'
import { ChatComposer } from '~/components/admin/EmmaChat/ChatComposer'

export const meta: MetaFunction = () => [{ title: 'Emma Chat — xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const { thread, messages } = await getOrCreateCurrentThread()
  return { thread, messages }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const intent = form.get('intent') as string

  if (intent === 'send') {
    const threadId = Number(form.get('threadId'))
    if (!Number.isFinite(threadId) || threadId <= 0) {
      return { error: 'invalid thread' }
    }
    const content = (form.get('content') as string | null)?.trim() ?? ''
    if (content.length < 1) return { error: 'Message cannot be empty.' }
    const { messageId } = await appendUserMessage(threadId, content)
    return { ok: true, messageId }
  }

  if (intent === 'clear') {
    await clearCurrentThread()
    return { ok: true, cleared: true }
  }

  return { error: 'Unknown intent' }
}

// ---------------------------------------------------------------------------
// Streaming SSE types
// ---------------------------------------------------------------------------

interface StreamingToolEvent {
  type: 'tool_call' | 'tool_result'
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string
  is_error?: boolean
  durationMs?: number
  resultCount?: number
}

function useEmmaStream(threadId: number, onComplete: () => void) {
  const [streamingDraft, setStreamingDraft] = useState('')
  const [streamingTools, setStreamingTools] = useState<StreamingToolEvent[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [kickCount, setKickCount] = useState(0)
  const esRef = useRef<EventSource | null>(null)

  const kick = useCallback(() => {
    setKickCount(c => c + 1)
  }, [])

  useEffect(() => {
    if (kickCount === 0) return

    esRef.current?.close()

    setStreamingDraft('')
    setStreamingTools([])
    setStreamError(null)
    setIsStreaming(true)

    const es = new EventSource(`/api/admin/emma-chat/stream/${threadId}`)
    esRef.current = es

    es.addEventListener('token', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { text: string }
        setStreamingDraft(prev => prev + data.text)
      } catch { /* ignore */ }
    })

    es.addEventListener('tool_call', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as Omit<StreamingToolEvent, 'type'>
        setStreamingTools(prev => [...prev, { type: 'tool_call' as const, ...data }])
      } catch { /* ignore */ }
    })

    es.addEventListener('tool_result', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as Omit<StreamingToolEvent, 'type'>
        setStreamingTools(prev => [...prev, { type: 'tool_result' as const, ...data }])
      } catch { /* ignore */ }
    })

    es.addEventListener('done', () => {
      es.close()
      esRef.current = null
      setIsStreaming(false)
      setStreamingDraft('')
      setStreamingTools([])
      onComplete()
    })

    es.addEventListener('error', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { message: string }
        setStreamError(data.message)
      } catch {
        setStreamError('Stream error')
      }
      es.close()
      esRef.current = null
      setIsStreaming(false)
    })

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        esRef.current = null
        setIsStreaming(false)
      }
    }

    return () => {
      es.close()
      esRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kickCount, threadId])

  useEffect(() => {
    return () => {
      esRef.current?.close()
    }
  }, [])

  return { streamingDraft, streamingTools, isStreaming, streamError, kick }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function toDomain(m: EmmaChatMessage): ChatMessageData {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    toolCalls: m.toolCalls as ChatMessageData['toolCalls'],
    toolResults: m.toolResults as ChatMessageData['toolResults'],
  }
}

export default function EmmaChat() {
  const { thread, messages } = useLoaderData<typeof loader>()
  const { revalidate } = useRevalidator()
  const clearFetcher = useFetcher()
  const scrollRef = useRef<HTMLDivElement>(null)

  const { streamingDraft, streamingTools, isStreaming, streamError, kick } = useEmmaStream(
    thread.id,
    revalidate,
  )

  // Auto-kick when the page loads with a pending user message and no
  // assistant reply yet (e.g. after a page refresh during generation, or
  // when the composer's onSubmitted didn't run for some reason).
  const kickedForUserIdRef = useRef<number | null>(null)
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'user') return
    if (isStreaming) return
    if (kickedForUserIdRef.current === last.id) return
    kickedForUserIdRef.current = last.id
    kick()
  }, [messages, isStreaming, kick])

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length, streamingDraft])

  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'assistant') return i
    }
    return -1
  })()

  const isClearing = clearFetcher.state !== 'idle'

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4 shrink-0">
        <div className="min-w-0">
          <h1
            className="text-lg font-bold text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Emma Chat
          </h1>
          <p className="text-xs text-muted mt-0.5" style={{ fontFamily: 'var(--font-body)' }}>
            Internal SME. Not customer-facing.
          </p>
        </div>
        <clearFetcher.Form method="post" className="shrink-0">
          <input type="hidden" name="intent" value="clear" />
          <button
            type="submit"
            disabled={isClearing || messages.length === 0}
            className="text-xs font-medium text-muted hover:text-ink px-3 py-1.5 rounded-lg border border-line hover:border-line/80 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {isClearing ? 'Clearing…' : 'Clear'}
          </button>
        </clearFetcher.Form>
      </div>

      {/* Message list */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto py-2 pr-1 space-y-1 min-h-0"
      >
        {messages.length === 0 && !isStreaming && (
          <div className="text-sm text-muted/70 px-1 py-2" style={{ fontFamily: 'var(--font-body)' }}>
            Ask Emma anything — product questions, competitor compares, draft replies. She'll search the catalog before naming SKUs.
          </div>
        )}

        {messages.map((msg, idx) => (
          <ChatMessage
            key={msg.id}
            message={toDomain(msg)}
            isLast={idx === lastAssistantIdx && !isStreaming}
          />
        ))}

        {streamingTools.length > 0 && (
          <div className="mb-2">
            {streamingTools.filter(t => t.type === 'tool_result').map((t, i) => (
              <InFlightToolRow key={i} event={t} />
            ))}
          </div>
        )}

        {isStreaming && (
          <ChatMessage
            message={{
              id: -1,
              role: 'assistant',
              content: streamingDraft,
              toolCalls: null,
              toolResults: null,
            }}
            isLast={false}
            isStreaming={true}
          />
        )}

        {streamError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700" style={{ fontFamily: 'var(--font-body)' }}>
            Stream error: {streamError}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="pt-3 border-t border-line shrink-0">
        <ChatComposer
          threadId={thread.id}
          disabled={isStreaming}
          onSubmitted={kick}
        />
      </div>
    </div>
  )
}

function InFlightToolRow({ event }: { event: StreamingToolEvent }) {
  let summary = 'tool result'
  if (event.resultCount != null) {
    summary = `search_products → ${event.resultCount} results`
  } else if (event.name) {
    summary = `${event.name} → done`
  }

  return (
    <details className="mb-1">
      <summary
        className="text-xs px-3 py-1.5 rounded-lg cursor-pointer select-none list-none flex items-center gap-1.5 bg-cream text-muted hover:text-ink animate-pulse"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
        {summary}
      </summary>
      <div className="mt-1 ml-4 p-3 bg-cream rounded-lg">
        <pre className="text-xs text-ink/70 overflow-x-auto whitespace-pre-wrap break-words" style={{ fontFamily: 'var(--font-body)' }}>
          {event.content ?? '...'}
        </pre>
      </div>
    </details>
  )
}
