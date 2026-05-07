import { renderMarkdown } from '~/lib/markdown-render'
import { CopyButton } from './CopyButton'

interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

interface ToolResult {
  tool_use_id: string
  content: string
  is_error?: boolean
}

export interface ChatMessageData {
  id: number
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls: ToolCall[] | null
  toolResults: ToolResult[] | null
}

interface ChatMessageProps {
  message: ChatMessageData
  isLast?: boolean
  isStreaming?: boolean
}

export function ChatMessage({ message, isLast = false, isStreaming = false }: ChatMessageProps) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end mb-3">
        <div
          className="bg-cream-2 text-ink rounded-2xl px-4 py-3 max-w-[85%] text-sm whitespace-pre-wrap break-words"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          {message.content}
        </div>
      </div>
    )
  }

  if (message.role === 'tool') {
    const calls = message.toolResults ?? []
    return (
      <div className="mb-2">
        {calls.map((tr, i) => (
          <ToolResultRow key={tr.tool_use_id ?? i} result={tr} />
        ))}
      </div>
    )
  }

  // assistant role
  const html = renderMarkdown(message.content)
  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[85%]">
        <div
          className={[
            'bg-paper border border-line text-ink rounded-2xl px-4 py-3 text-sm',
            isStreaming ? 'opacity-80' : '',
          ].join(' ')}
          style={{ fontFamily: 'var(--font-body)' }}
        >
          {message.content ? (
            <div
              className="prose-sm prose-neutral max-w-none [&_a]:text-coral [&_a]:underline [&_strong]:font-semibold [&_ul]:my-2 [&_li]:my-0.5"
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : isStreaming ? (
            <span className="inline-block w-2 h-4 bg-coral/60 animate-pulse rounded-sm" />
          ) : null}
          {isStreaming && message.content && (
            <span className="inline-block w-2 h-4 bg-coral/60 animate-pulse rounded-sm ml-0.5 align-middle" />
          )}
        </div>
        {isLast && !isStreaming && message.content && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CopyButton text={message.content} />
          </div>
        )}
      </div>
    </div>
  )
}

function ToolResultRow({ result }: { result: ToolResult }) {
  let parsed: unknown
  try {
    parsed = JSON.parse(result.content)
  } catch {
    parsed = result.content
  }

  const summary = buildSummary(result)

  return (
    <details className="mb-1 group">
      <summary
        className={[
          'text-xs px-3 py-1.5 rounded-lg cursor-pointer select-none list-none flex items-center gap-1.5',
          result.is_error
            ? 'bg-red-50 text-red-600'
            : 'bg-cream text-muted hover:text-ink',
        ].join(' ')}
        style={{ fontFamily: 'var(--font-display)' }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
        {summary}
      </summary>
      <div className="mt-1 ml-4 p-3 bg-cream rounded-lg">
        <pre className="text-xs text-ink/70 overflow-x-auto whitespace-pre-wrap break-words" style={{ fontFamily: 'var(--font-body)' }}>
          {JSON.stringify(parsed, null, 2)}
        </pre>
      </div>
    </details>
  )
}

function buildSummary(result: ToolResult): string {
  try {
    const parsed = JSON.parse(result.content) as Record<string, unknown>
    if (typeof parsed.count === 'number') {
      return `search_products → ${parsed.count} results`
    }
    if (typeof parsed.handle === 'string') {
      return `get_product_details → ${parsed.handle}`
    }
    if (parsed.error) return `tool error: ${parsed.error}`
  } catch {
    // fall through
  }
  return result.is_error ? 'tool error' : 'tool result'
}
