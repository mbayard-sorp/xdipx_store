/**
 * Client-side chat state: session id, open/closed, messages, streaming.
 * Persists open state + minimal history in sessionStorage so navigation
 * doesn't reset the panel. Email/phone live server-side only (httpOnly cookie).
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  toolEvents?: ChatToolEvent[]
}

export interface ChatToolEvent {
  type: 'tool_use' | 'tool_result'
  name: string
  id: string
  input?: unknown
  output?: unknown
}

const STORAGE_KEY = 'xdipx:chat:state'
const DISMISS_KEY = 'xdipx:chat:dismissed'
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000

export function isDismissed(): boolean {
  if (typeof window === 'undefined') return false
  const raw = window.localStorage.getItem(DISMISS_KEY)
  if (!raw) return false
  const ts = Number(raw)
  if (!Number.isFinite(ts)) return false
  return Date.now() - ts < DISMISS_TTL_MS
}

export function dismiss(): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(DISMISS_KEY, String(Date.now()))
}

export function isAgeVerified(): boolean {
  if (typeof window === 'undefined') return false
  return !!window.localStorage.getItem('xdipx_age_verified')
}

interface PersistedState {
  sessionId: string | null
  messages: ChatMessage[]
  open: boolean
}

function loadPersisted(): PersistedState {
  if (typeof window === 'undefined') return { sessionId: null, messages: [], open: false }
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return { sessionId: null, messages: [], open: false }
    return JSON.parse(raw) as PersistedState
  } catch {
    return { sessionId: null, messages: [], open: false }
  }
}

function savePersisted(state: PersistedState): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {}
}

export function useChatSession() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [open, setOpen] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const p = loadPersisted()
    setSessionId(p.sessionId)
    setMessages(p.messages)
    setOpen(p.open)
  }, [])

  useEffect(() => {
    savePersisted({ sessionId, messages, open })
  }, [sessionId, messages, open])

  const start = useCallback(async (form: { email?: string; phone?: string }): Promise<{ ok: boolean; error?: string }> => {
    const body = new FormData()
    if (form.email) body.set('email', form.email)
    if (form.phone) body.set('phone', form.phone)
    const res = await fetch('/api/chat/start', { method: 'POST', body })
    const data = await res.json() as { ok?: boolean; sessionId?: string; greeting?: string; error?: string }
    if (!res.ok || !data.sessionId) return { ok: false, error: data.error ?? 'Could not start chat.' }
    setSessionId(data.sessionId)
    setMessages([{ id: `greet-${Date.now()}`, role: 'assistant', text: data.greeting ?? "Hey — I'm Emma. What brings you in?" }])
    return { ok: true }
  }, [])

  const send = useCallback(async (text: string) => {
    if (!sessionId || !text.trim() || streaming) return
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', text: text.trim() }
    const asstId = `a-${Date.now()}`
    setMessages((m) => [...m, userMsg, { id: asstId, role: 'assistant', text: '', toolEvents: [] }])
    setStreaming(true)
    setError(null)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text.trim() }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        setError(res.status === 429 ? "You're typing faster than I can keep up — give me a sec." : 'Connection issue — try again.')
        setStreaming(false)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let sepIdx
        while ((sepIdx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, sepIdx)
          buf = buf.slice(sepIdx + 2)
          const event = /^event: (.+)$/m.exec(frame)?.[1]
          const dataLine = /^data: (.+)$/m.exec(frame)?.[1]
          if (!event || !dataLine) continue
          try {
            const payload = JSON.parse(dataLine)
            if (event === 'token') {
              setMessages((m) => m.map((x) => x.id === asstId ? { ...x, text: x.text + (payload.text as string) } : x))
            } else if (event === 'tool') {
              setMessages((m) => m.map((x) => x.id === asstId ? { ...x, toolEvents: [...(x.toolEvents ?? []), payload as ChatToolEvent] } : x))
            } else if (event === 'error') {
              setError((payload.message as string) ?? 'Something went wrong.')
            }
          } catch {}
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError('Connection lost.')
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }, [sessionId, streaming])

  const close = useCallback(async () => {
    abortRef.current?.abort()
    await fetch('/api/chat/close', { method: 'POST' }).catch(() => {})
    setSessionId(null)
    setMessages([])
    setOpen(false)
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(STORAGE_KEY)
  }, [])

  return { sessionId, messages, open, setOpen, streaming, error, start, send, close }
}
