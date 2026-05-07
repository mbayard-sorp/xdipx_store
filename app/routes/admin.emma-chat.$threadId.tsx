import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useRevalidator, Link, useFetcher } from 'react-router'
import { useEffect, useRef, useCallback, useState } from 'react'
import { redirect } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import {
  loadThread,
  appendUserMessage,
  archiveThread,
  EMMA_QUICK_ACTIONS,
  type EmmaChatMessage,
  type EmmaChatThread,
} from '~/lib/emma-chat.server'
import { ChatMessage, type ChatMessageData } from '~/components/admin/EmmaChat/ChatMessage'
import { ChatComposer } from '~/components/admin/EmmaChat/ChatComposer'

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? `${data.thread.title} — Emma Chat` : 'Emma Chat' },
]

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const threadId = Number(params.threadId)
  if (!Number.isFinite(threadId) || threadId <= 0) {
    throw new Response('not found', { status: 404 })
  }
  const result = await loadThread(threadId)
  if (!result) throw new Response('not found', { status: 404 })
  return { thread: result.thread, messages: result.messages }
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireAdmin(request)
  const threadId = Number(params.threadId)
  if (!Number.isFinite(threadId) || threadId <= 0) {
    throw new Response('not found', { status: 404 })
  }

  const form = await request.formData()
  const intent = form.get('intent') as string

  if (intent === 'send') {
    const content = (form.get('content') as string | null)?.trim() ?? ''
    if (content.length < 1) return { error: 'Message cannot be empty.' }
    const { messageId } = await appendUserMessage(threadId, content)
    return { ok: true, messageId }
  }

  if (intent === 'quick_action') {
    const actionKey = form.get('action') as string
    const qa = EMMA_QUICK_ACTIONS[actionKey as keyof typeof EMMA_QUICK_ACTIONS]
    if (!qa) return { error: 'Unknown quick action.' }
    const { messageId } = await appendUserMessage(threadId, qa.prompt)
    return { ok: true, messageId, prompt: qa.prompt }
  }

  if (intent === 'archive') {
    await archiveThread(threadId)
    return redirect('/admin/emma-chat')
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

// ---------------------------------------------------------------------------
// useEmmaStream hook
// ---------------------------------------------------------------------------

function useEmmaStream(
  threadId: number,
  onComplete: () => void,
) {
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

    // Clean up any prior connection
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
      } catch { /* ignore parse errors */ }
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

    // Also handle EventSource connection errors
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
  }, [kickCount])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      esRef.current?.close()
    }
  }, [])

  return { streamingDraft, streamingTools, isStreaming, streamError, kick }
}

// ---------------------------------------------------------------------------
// Main chat page
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

export default function EmmaChatThread() {
  const { thread, messages } = useLoaderData<typeof loader>()
  const { revalidate } = useRevalidator()
  const archiveFetcher = useFetcher()
  const scrollRef = useRef<HTMLDivElement>(null)

  const { streamingDraft, streamingTools, isStreaming, streamError, kick } = useEmmaStream(
    thread.id,
    revalidate,
  )

  // Auto-scroll to bottom when messages or tokens arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length, streamingDraft])

  // Find index of last assistant message in persisted messages
  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'assistant') return i
    }
    return -1
  })()

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Link
              to="/admin/emma-chat"
              className="text-muted hover:text-ink transition-colors text-sm"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              ← Threads
            </Link>
          </div>
          <h1
            className="text-lg font-bold text-ink truncate"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {thread.title}
          </h1>
          {thread.redditPostUrl && (
            <a
              href={thread.redditPostUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-coral hover:underline mt-0.5 inline-flex items-center gap-1"
              style={{ fontFamily: 'var(--font-body)' }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              View Reddit post
            </a>
          )}
        </div>
        <archiveFetcher.Form method="post" className="shrink-0">
          <input type="hidden" name="intent" value="archive" />
          <button
            type="submit"
            className="text-xs font-medium text-muted hover:text-ink px-3 py-1.5 rounded-lg border border-line hover:border-line/80 transition-all"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Archive
          </button>
        </archiveFetcher.Form>
      </div>

      {/* Reddit post excerpt card */}
      {thread.redditPostExcerpt && (
        <div className="bg-cream-2 border-l-2 border-coral/40 rounded-r-xl px-4 py-3 mb-4 shrink-0">
          <p className="text-xs font-semibold text-muted mb-1.5" style={{ fontFamily: 'var(--font-display)' }}>
            📋 Post you're replying to
          </p>
          <p
            className="text-sm text-ink/80 whitespace-pre-wrap"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            {thread.redditPostExcerpt}
          </p>
        </div>
      )}

      {/* Message list */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto py-2 pr-1 space-y-1 min-h-0"
      >
        {messages.map((msg, idx) => (
          <ChatMessage
            key={msg.id}
            message={toDomain(msg)}
            isLast={idx === lastAssistantIdx && !isStreaming}
          />
        ))}

        {/* In-flight tool events */}
        {streamingTools.length > 0 && (
          <div className="mb-2">
            {streamingTools.filter(t => t.type === 'tool_result').map((t, i) => (
              <InFlightToolRow key={i} event={t} />
            ))}
          </div>
        )}

        {/* In-flight assistant draft */}
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
