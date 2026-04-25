import { useEffect, useRef, useState } from 'react'
import { Link, useFetcher, useLocation, useRevalidator } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import type { ChatProductCard, ChatTurn, ChatVariantOption, QuickReplyPayload } from '~/lib/ai-agent/chat-types'
import { AskEmmaProductCard } from './AskEmmaProductCard'

type Turn = ChatTurn & {
  products?: ChatProductCard[]
  quickReply?: QuickReplyPayload
  /** If set, only this many characters of `text` are visible (typewriter in progress). */
  reveal?: number
  /** Set to true once the user taps/submits the quickReply pills so they're hidden on re-render. */
  quickReplyAnswered?: boolean
  /** If true, this turn is sent to the server for context but not rendered in the UI. */
  hidden?: boolean
}

interface ChatApiResponse {
  reply?: string
  products?: ChatProductCard[]
  history?: ChatTurn[]
  quickReply?: QuickReplyPayload
  cartUpdated?: boolean
  error?: string
}

const STORAGE_KEY = 'xdipx:emma:state:v1'
const TAGLINE_KEY = 'xdipx:emma:tagline:v2'
const TAGLINE_TTL_MS = 5 * 60 * 1000
const DEFAULT_TAGLINE = 'here to help you find what you\u2019re into \u2665'
const GREETING = "Hey — I'm Emma. Tell me what you're curious about and I'll show you what's good today. ♥"

// iMessage-ish cadence. The typing pill is shown for at least MIN_TYPING_MS, then
// the text reveals at REVEAL_CPS chars/sec up to REVEAL_MAX_MS.
const MIN_TYPING_MS = 900
const REVEAL_CPS = 28
const REVEAL_MAX_MS = 3800
const REVEAL_MIN_MS = 700

export function AskEmmaWidget() {
  const location = useLocation()
  const onAdmin = location.pathname.startsWith('/admin')

  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [hasUnread, setHasUnread] = useState(false)
  const [isRevealing, setIsRevealing] = useState(false)
  const [tagline, setTagline] = useState(DEFAULT_TAGLINE)
  const fetcher = useFetcher<ChatApiResponse>()
  const revalidator = useRevalidator()
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const pendingSubmitRef = useRef(false)
  const submittedAtRef = useRef<number>(0)
  const revealTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Typing pill shows during network request OR while we're artificially holding
  // before committing, so Emma never "teleports" her reply in.
  const isSending = fetcher.state !== 'idle' || pendingSubmitRef.current

  // Hydrate state once on mount.
  useEffect(() => {
    setMounted(true)
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as { open?: boolean; turns?: Turn[] }
        if (Array.isArray(saved.turns)) setTurns(saved.turns.slice(-20))
        if (typeof saved.open === 'boolean') setOpen(saved.open)
      }
    } catch {
      // ignore
    }

    // Rotating Emma tagline — cached in sessionStorage with a short TTL so the
    // headline visibly refreshes while someone is browsing, without hammering
    // the Claude API on every route change.
    let cached: string | null = null
    try {
      const raw = sessionStorage.getItem(TAGLINE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as { tagline?: unknown; fetchedAt?: unknown }
        const line = typeof parsed.tagline === 'string' ? parsed.tagline : null
        const fetchedAt = typeof parsed.fetchedAt === 'number' ? parsed.fetchedAt : 0
        if (line && Date.now() - fetchedAt < TAGLINE_TTL_MS) cached = line
      }
    } catch { /* privacy mode or bad JSON — fall through to fetch */ }

    if (cached) {
      setTagline(cached)
      return
    }

    const controller = new AbortController()
    fetch('/api/emma-tagline', { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { tagline?: string } | null) => {
        const line = data?.tagline?.trim()
        if (line) {
          setTagline(line)
          try {
            sessionStorage.setItem(TAGLINE_KEY, JSON.stringify({ tagline: line, fetchedAt: Date.now() }))
          } catch { /* ignore */ }
        }
      })
      .catch(() => { /* keep default */ })
    return () => controller.abort()
  }, [])

  // Listen for cart drawer open/close so Emma can slide left while it's visible.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onOpened = () => setCartOpen(true)
    const onClosed = () => setCartOpen(false)
    window.addEventListener('xdipx:cart-opened', onOpened)
    window.addEventListener('xdipx:cart-closed', onClosed)
    return () => {
      window.removeEventListener('xdipx:cart-opened', onOpened)
      window.removeEventListener('xdipx:cart-closed', onClosed)
    }
  }, [])

  // Persist state whenever it changes. Strip transient `reveal` so persisted
  // turns hydrate as fully-revealed on page reload.
  useEffect(() => {
    if (!mounted) return
    try {
      const sanitized = turns.slice(-20).map(({ reveal: _reveal, ...rest }) => rest)
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ open, turns: sanitized }))
    } catch {
      // quota or privacy mode — fail silent
    }
  }, [open, turns, mounted])

  // Clean up any in-flight timers on unmount.
  useEffect(() => {
    return () => {
      if (revealTimerRef.current) clearInterval(revealTimerRef.current)
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current)
    }
  }, [])

  // Roll the fetcher's response into turns when it lands, with a minimum typing
  // delay + typewriter reveal so Emma feels human instead of instant.
  useEffect(() => {
    if (!pendingSubmitRef.current) return
    if (fetcher.state !== 'idle') return
    const data = fetcher.data
    if (!data) return

    const quickReply = data.quickReply
    const products = data.products ?? []
    if (data.cartUpdated) {
      // Pull fresh cart into _layout.tsx so Navbar sees the new line items,
      // then fire the same custom event the PDP uses so the drawer pops open.
      revalidator.revalidate()
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('xdipx:cart-added'))
      }
    }
    // If Emma only called askQuickChoice and didn't write prose, don't fall back
    // to the generic "brain blanked" — the pills are the answer.
    const fallback = quickReply
      ? "Pick one and I'll take it from there ♥"
      : "Sorry — I hit a snag. Try that again?"
    const reply = (data.reply && data.reply.trim()) || fallback

    const elapsed = Date.now() - submittedAtRef.current
    const holdMs = Math.max(0, MIN_TYPING_MS - elapsed)

    if (commitTimerRef.current) clearTimeout(commitTimerRef.current)
    commitTimerRef.current = setTimeout(() => {
      pendingSubmitRef.current = false
      commitTimerRef.current = null
      setTurns((prev) => [
        ...prev,
        { role: 'assistant', text: reply, products, reveal: 0, ...(quickReply ? { quickReply } : {}) },
      ])
      if (!open) setHasUnread(true)
      startReveal(reply.length)
    }, holdMs)
  }, [fetcher.state, fetcher.data, open])

  function startReveal(total: number) {
    if (revealTimerRef.current) clearInterval(revealTimerRef.current)
    if (total === 0) {
      setIsRevealing(false)
      return
    }
    const durationMs = Math.min(REVEAL_MAX_MS, Math.max(REVEAL_MIN_MS, (total / REVEAL_CPS) * 1000))
    const startAt = Date.now()
    setIsRevealing(true)
    revealTimerRef.current = setInterval(() => {
      const t = (Date.now() - startAt) / durationMs
      if (t >= 1) {
        if (revealTimerRef.current) {
          clearInterval(revealTimerRef.current)
          revealTimerRef.current = null
        }
        setIsRevealing(false)
        setTurns((prev) => {
          if (prev.length === 0) return prev
          const last = prev[prev.length - 1]!
          if (last.role !== 'assistant') return prev
          const next = prev.slice(0, -1)
          const { reveal: _reveal, ...rest } = last
          next.push(rest)
          return next
        })
        return
      }
      const chars = Math.max(1, Math.floor(total * t))
      setTurns((prev) => {
        if (prev.length === 0) return prev
        const last = prev[prev.length - 1]!
        if (last.role !== 'assistant') return prev
        if (last.reveal === chars) return prev
        const next = prev.slice(0, -1)
        next.push({ ...last, reveal: chars })
        return next
      })
    }, 30)
  }

  // Auto-scroll to latest turn.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [turns, isSending, open])

  // Focus input when the panel opens.
  useEffect(() => {
    if (open) {
      setHasUnread(false)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Refs for the `xdipx:emma:openWith` bridge — must sit above early returns
  // so hook order stays stable across renders. sendMessageRef is populated
  // after sendMessage is defined below.
  const sendMessageRef = useRef<((msg: string, opts?: { hidden?: boolean }) => void) | null>(null)
  const pendingSeededPromptRef = useRef<string | null>(null)

  // Open Emma with a seeded prompt when another component dispatches
  // `xdipx:emma:openWith`. Stores the prompt until the widget is open + idle,
  // then sends it via the ref so we always call the latest sendMessage.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ prompt?: string }>).detail
      const prompt = typeof detail?.prompt === 'string' ? detail.prompt.trim() : ''
      if (!prompt) return
      pendingSeededPromptRef.current = prompt
      setOpen(true)
      setHasUnread(false)
    }
    window.addEventListener('xdipx:emma:openWith', handler as EventListener)
    return () => window.removeEventListener('xdipx:emma:openWith', handler as EventListener)
  }, [])

  useEffect(() => {
    if (!open) return
    if (isSending || isRevealing) return
    const pending = pendingSeededPromptRef.current
    if (!pending) return
    pendingSeededPromptRef.current = null
    sendMessageRef.current?.(pending)
  }, [open, isSending, isRevealing])

  if (onAdmin) return null
  if (!mounted) return null

  const sendMessage = (rawMsg: string, opts: { hidden?: boolean } = {}) => {
    const msg = rawMsg.trim()
    if (!msg || isSending || isRevealing) return
    // Any prior quickReply pills are now stale — mark the latest assistant turn
    // with one as answered so the pills disappear.
    const markedTurns = markLatestQuickReplyAnswered(turns)
    const userTurn: Turn = { role: 'user', text: msg, ...(opts.hidden ? { hidden: true } : {}) }
    const nextTurns: Turn[] = [...markedTurns, userTurn]
    setTurns(nextTurns)
    setDraft('')
    const historyForServer: ChatTurn[] = nextTurns
      .slice(0, -1)
      .map(({ role, text }) => ({ role, text }))
    pendingSubmitRef.current = true
    submittedAtRef.current = Date.now()
    fetcher.submit(
      JSON.stringify({
        message: msg,
        history: historyForServer,
        hidden: opts.hidden === true,
        pageContext: { pathname: location.pathname },
      }),
      { method: 'post', action: '/api/ask-emma', encType: 'application/json' },
    )
  }

  const send = () => sendMessage(draft)

  // Keep the ref pointing at the latest sendMessage so the openWith listener
  // always dispatches through the current closure. Safe to mutate in render:
  // refs don't drive re-renders.
  sendMessageRef.current = sendMessage

  const onVariantPick = (card: ChatProductCard, variant: ChatVariantOption) => {
    if (!variant.inStock) return
    // Include the variant GID so Emma can skip re-searching and call
    // buildCheckoutLink directly with the exact variant.
    sendMessage(`Add the ${variant.label} of ${card.title} to cart (variantId: ${variant.variantId})`)
  }

  const onTellMore = (card: ChatProductCard) => {
    // Include the handle so Emma can call getProductDetails directly instead of
    // re-searching, and so she can drop a PDP link into her reply. Hidden from
    // the UI — the user shouldn't see this structured prompt echoed back.
    sendMessage(`Tell me more about ${card.title} (handle: ${card.handle})`, { hidden: true })
  }

  const toggleOpen = () => {
    setOpen((v) => {
      const next = !v
      if (next) setHasUnread(false)
      return next
    })
  }

  const clear = () => {
    setTurns([])
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="emma-panel"
            role="dialog"
            aria-modal="false"
            aria-label="Ask Emma"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ type: 'tween', duration: 0.2, ease: 'easeOut' }}
            style={{ transformOrigin: 'bottom right' }}
            className={`fixed z-[60] flex flex-col overflow-hidden rounded-2xl bg-cream shadow-2xl ring-1 ring-black/5
              inset-x-2 bottom-2 top-auto max-h-[88vh] sm:inset-auto sm:bottom-24 sm:h-[min(580px,calc(100vh-8rem))] sm:w-[380px] sm:max-h-none transition-[right] duration-300 ease-out ${
              cartOpen ? 'sm:right-[25rem]' : 'sm:right-4'
            }`}
          >
            <header
              className="flex items-center justify-between px-4 py-3 text-white"
              style={{ background: 'linear-gradient(to right, #F04E37, #FF8C38)' }}
            >
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-bold leading-none" style={{ fontFamily: 'var(--font-display)' }}>
                  Ask Emma
                  <span className="relative flex h-2 w-2" aria-label="Online">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400 ring-1 ring-white/80" />
                  </span>
                </p>
                <p className="mt-1 text-[11px] opacity-90">Online · {tagline}</p>
              </div>
              <div className="flex items-center gap-1">
                {turns.length > 0 && (
                  <button
                    type="button"
                    onClick={clear}
                    className="rounded-full px-2 py-1 text-[11px] font-semibold opacity-80 hover:bg-white/10 hover:opacity-100"
                    aria-label="Clear conversation"
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/10"
                  aria-label="Close chat"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M1 1l12 12M13 1L1 13" />
                  </svg>
                </button>
              </div>
            </header>

            <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-4">
              <AssistantBubble text={GREETING} products={[]} />
              {turns.map((t, i) => (
                <Bubble
                  key={i}
                  turn={t}
                  onQuickReply={sendMessage}
                  onVariantPick={onVariantPick}
                  onTellMore={onTellMore}
                />
              ))}
              {isSending && <TypingBubble />}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                send()
              }}
              className="flex items-end gap-2 border-t border-line bg-white px-3 py-3"
            >
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                placeholder="Ask Emma anything…"
                className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-line bg-cream px-3 py-2.5 text-sm text-ink placeholder:text-ink/40 focus:border-coral/60 focus:outline-none focus:ring-2 focus:ring-coral/20"
              />
              <button
                type="submit"
                disabled={!draft.trim() || isSending || isRevealing}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ background: 'linear-gradient(to right, #F04E37, #FF8C38)' }}
                aria-label="Send"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M22 2 11 13" />
                  <path d="M22 2 15 22l-4-9-9-4 20-7z" />
                </svg>
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={toggleOpen}
        aria-label={open ? 'Close chat with Emma' : 'Open chat with Emma'}
        aria-expanded={open}
        className={`fixed bottom-[calc(120px+env(safe-area-inset-bottom))] md:bottom-4 z-[55] flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition-[right,transform] duration-300 ease-out hover:scale-105 active:scale-95 ${
          cartOpen ? 'right-4 md:right-[25rem]' : 'right-4'
        }`}
        style={{ background: 'linear-gradient(to right, #F04E37, #FF8C38)' }}
      >
        {open ? (
          <svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <path d="M1 1l12 12M13 1L1 13" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
        {hasUnread && !open && (
          <span className="absolute right-1 top-1 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ink opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-ink ring-2 ring-white" />
          </span>
        )}
        {!open && (
          <span
            className="absolute bottom-0.5 right-0.5 flex h-3 w-3"
            aria-label="Emma is online"
          >
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-white" />
          </span>
        )}
      </button>
    </>
  )
}

function Bubble({
  turn,
  onQuickReply,
  onVariantPick,
  onTellMore,
}: {
  turn: Turn
  onQuickReply: (msg: string) => void
  onVariantPick: (card: ChatProductCard, variant: ChatVariantOption) => void
  onTellMore: (card: ChatProductCard) => void
}) {
  if (turn.role === 'user') {
    if (turn.hidden) return null
    return (
      <div className="flex justify-end">
        <div className="max-w-[82%] rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-sm text-white">
          {turn.text}
        </div>
      </div>
    )
  }
  const revealing = typeof turn.reveal === 'number'
  const displayText = revealing ? turn.text.slice(0, turn.reveal!) : turn.text
  // Hold products + pills until the text has fully revealed, so nothing flashes
  // in before Emma "finishes speaking".
  return (
    <AssistantBubble
      text={displayText}
      products={revealing ? [] : (turn.products ?? [])}
      quickReply={revealing || turn.quickReplyAnswered ? undefined : turn.quickReply}
      onQuickReply={onQuickReply}
      onVariantPick={onVariantPick}
      onTellMore={onTellMore}
      showCaret={revealing}
    />
  )
}

function AssistantBubble({
  text,
  products,
  quickReply,
  onQuickReply,
  onVariantPick,
  onTellMore,
  showCaret,
}: {
  text: string
  products: ChatProductCard[]
  quickReply?: QuickReplyPayload | undefined
  onQuickReply?: ((msg: string) => void) | undefined
  onVariantPick?: ((card: ChatProductCard, variant: ChatVariantOption) => void) | undefined
  onTellMore?: ((card: ChatProductCard) => void) | undefined
  showCaret?: boolean | undefined
}) {
  return (
    <div className="flex flex-col items-start gap-2">
      <div className="max-w-[90%] rounded-2xl rounded-bl-md bg-cream-2 px-3.5 py-2 text-sm text-ink">
        <MarkdownText text={text} />
        {showCaret && (
          <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-[2px] animate-pulse bg-ink/60 align-middle" aria-hidden="true" />
        )}
      </div>
      {quickReply && onQuickReply && (
        <QuickReply payload={quickReply} onPick={onQuickReply} />
      )}
      {products.length > 0 && (
        <div className="w-full space-y-2">
          {products.map((p) => (
            <AskEmmaProductCard
              key={p.handle}
              card={p}
              onVariantPick={onVariantPick}
              onTellMore={onTellMore}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function QuickReply({ payload, onPick }: { payload: QuickReplyPayload; onPick: (msg: string) => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  if (payload.mode === 'single') {
    return (
      <div className="w-full">
        <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink/60">
          {payload.question}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {payload.options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onPick(opt)}
              className="rounded-full border border-coral/30 bg-white px-3 py-1.5 text-xs font-medium text-coral transition hover:border-coral hover:bg-ink hover:text-white active:scale-95"
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
    )
  }

  const toggle = (opt: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(opt)) next.delete(opt)
      else next.add(opt)
      return next
    })
  }

  const submit = () => {
    if (selected.size === 0) return
    const picked = payload.options.filter((o) => selected.has(o))
    onPick(picked.join(', '))
  }

  return (
    <div className="w-full rounded-xl border border-line bg-white p-2.5">
      <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink/60">
        {payload.question}
      </p>
      <div className="flex flex-col gap-1.5">
        {payload.options.map((opt) => {
          const on = selected.has(opt)
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggle(opt)}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition ${
                on ? 'bg-ink/10 text-coral' : 'hover:bg-cream-2 text-ink'
              }`}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  on ? 'border-coral bg-ink text-white' : 'border-ink/30 bg-white'
                }`}
                aria-hidden="true"
              >
                {on && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1.5 5l2.5 2.5L8.5 2.5" />
                  </svg>
                )}
              </span>
              <span className="font-medium">{opt}</span>
            </button>
          )
        })}
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={selected.size === 0}
        className="mt-2 w-full rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
      >
        Send {selected.size > 0 ? `(${selected.size})` : ''}
      </button>
    </div>
  )
}

function markLatestQuickReplyAnswered(turns: Turn[]): Turn[] {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]!
    if (t.role !== 'assistant') continue
    if (t.quickReply && !t.quickReplyAnswered) {
      const next = turns.slice()
      next[i] = { ...t, quickReplyAnswered: true }
      return next
    }
    break
  }
  return turns
}

function TypingBubble() {
  return (
    <div className="flex justify-start">
      <div className="rounded-2xl rounded-bl-md bg-cream-2 px-4 py-3">
        <div className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink/60 [animation-delay:-0.3s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink/60 [animation-delay:-0.15s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink/60" />
        </div>
      </div>
    </div>
  )
}

/**
 * Minimal markdown-ish renderer: supports **bold**, [label](url) links, and
 * line breaks. No HTML passthrough — everything Claude returns is rendered as
 * text / React elements, so XSS isn't possible here. URLs are restricted to
 * http(s)/relative paths to prevent javascript: scheme injection.
 */
function MarkdownText({ text }: { text: string }) {
  const lines = text.split(/\r?\n/)
  return (
    <>
      {lines.map((line, i) => (
        <span key={i} className="block whitespace-pre-wrap">
          {renderInline(line)}
        </span>
      ))}
    </>
  )
}

const SAFE_URL = /^(https?:\/\/|\/)/i

function renderInline(line: string) {
  // Split on links first so bold inside link text still works.
  const linkSplit = line.split(/(\[[^\]]+\]\([^)]+\))/g)
  return linkSplit.flatMap((chunk, i) => {
    const linkMatch = chunk.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (linkMatch && SAFE_URL.test(linkMatch[2]!)) {
      const [, label, href] = linkMatch
      const internalPath = toInternalPath(href!)
      const className =
        'font-semibold text-coral underline decoration-ink/40 underline-offset-2 hover:text-coral hover:decoration-coral/50'
      if (internalPath) {
        return [
          <Link key={`l-${i}`} to={internalPath} className={className}>
            {renderBold(label!)}
          </Link>,
        ]
      }
      return [
        <a
          key={`l-${i}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={className}
        >
          {renderBold(label!)}
        </a>,
      ]
    }
    return renderBold(chunk).map((el, j) => <span key={`b-${i}-${j}`}>{el}</span>)
  })
}

/** Return a same-origin path for client-side nav, or null if the link is truly external. */
function toInternalPath(href: string): string | null {
  if (href.startsWith('/')) return href
  try {
    const u = new URL(href)
    if (typeof window !== 'undefined' && u.origin === window.location.origin) {
      return u.pathname + u.search + u.hash
    }
  } catch {
    return null
  }
  return null
}

function renderBold(line: string) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      )
    }
    return <span key={i}>{part}</span>
  })
}
