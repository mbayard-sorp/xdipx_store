import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  useChatSession,
  isDismissed,
  dismiss as dismissLauncher,
  isAgeVerified,
  type ChatMessage,
  type ChatToolEvent,
} from '~/lib/chat-client'

export function ChatWidget() {
  const chat = useChatSession()
  const [mounted, setMounted] = useState(false)
  const [ageOk, setAgeOk] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    setMounted(true)
    setAgeOk(isAgeVerified())
    setDismissed(isDismissed())
    const onStorage = () => {
      setAgeOk(isAgeVerified())
      setDismissed(isDismissed())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  if (!mounted || !ageOk) return null

  return (
    <>
      {!dismissed && !chat.open && (
        <ChatLauncher
          onOpen={() => chat.setOpen(true)}
          onDismiss={() => {
            dismissLauncher()
            setDismissed(true)
          }}
        />
      )}
      <AnimatePresence>
        {chat.open && (
          <ChatPanel
            chat={chat}
            onClose={() => chat.setOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  )
}

function ChatLauncher({ onOpen, onDismiss }: { onOpen: () => void; onDismiss: () => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-[55] flex flex-col items-end gap-2">
      <button
        onClick={onDismiss}
        aria-label="Dismiss chat"
        className="text-xs text-brand-charcoal/60 hover:text-brand-charcoal bg-white/80 backdrop-blur rounded-full px-2 py-0.5 shadow-sm"
      >
        Not now
      </button>
      <button
        onClick={onOpen}
        aria-label="Open chat with Emma"
        className="h-14 w-14 rounded-full bg-brand-gradient text-white shadow-lg hover:scale-105 active:scale-95 transition-transform flex items-center justify-center font-display text-2xl"
      >
        <span aria-hidden>♥</span>
      </button>
    </div>
  )
}

type ChatHook = ReturnType<typeof useChatSession>

function ChatPanel({ chat, onClose }: { chat: ChatHook; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/30 z-[55] md:bg-transparent md:pointer-events-none"
        onClick={onClose}
      />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Chat with Emma"
        initial={{ x: '100%', opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 26, stiffness: 260 }}
        className="fixed bottom-0 right-0 z-[56] w-full md:w-[420px] md:bottom-4 md:right-4 md:rounded-2xl h-[85vh] md:h-[620px] bg-white shadow-2xl flex flex-col overflow-hidden"
      >
        <header className="flex items-center justify-between px-4 py-3 bg-brand-gradient text-white">
          <div className="flex items-center gap-2">
            <span className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center text-lg">♥</span>
            <div className="leading-tight">
              <div className="font-display font-semibold">Emma</div>
              <div className="text-xs opacity-80">xdipx concierge</div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close chat"
            className="h-8 w-8 rounded-full hover:bg-white/20 flex items-center justify-center text-xl"
          >
            ×
          </button>
        </header>

        {chat.sessionId ? (
          <Conversation chat={chat} />
        ) : (
          <IdentityGate onStart={chat.start} />
        )}
      </motion.div>
    </>
  )
}

function IdentityGate({ onStart }: { onStart: ChatHook['start'] }) {
  const [mode, setMode] = useState<'email' | 'phone'>('email')
  const [value, setValue] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    const result = await onStart(mode === 'email' ? { email: value } : { phone: value })
    setBusy(false)
    if (!result.ok) setErr(result.error ?? 'Please try again.')
  }

  return (
    <div className="flex-1 overflow-y-auto p-5 bg-brand-cream">
      <h2 className="font-display text-xl text-brand-charcoal mb-1">Let's chat ♥</h2>
      <p className="text-sm text-brand-charcoal/80 mb-4">
        Drop your email or phone and I'll help you find what you're after. One of them — your choice.
      </p>
      <div className="flex gap-2 mb-3 text-sm font-display">
        <button
          type="button"
          onClick={() => { setMode('email'); setValue(''); setErr(null) }}
          className={`px-3 py-1 rounded-full ${mode === 'email' ? 'bg-brand-purple text-white' : 'bg-white text-brand-charcoal border border-brand-charcoal/10'}`}
        >
          Email
        </button>
        <button
          type="button"
          onClick={() => { setMode('phone'); setValue(''); setErr(null) }}
          className={`px-3 py-1 rounded-full ${mode === 'phone' ? 'bg-brand-purple text-white' : 'bg-white text-brand-charcoal border border-brand-charcoal/10'}`}
        >
          Phone
        </button>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <input
          type={mode === 'email' ? 'email' : 'tel'}
          inputMode={mode === 'email' ? 'email' : 'tel'}
          autoComplete={mode === 'email' ? 'email' : 'tel'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={mode === 'email' ? 'you@example.com' : '(555) 123-4567'}
          required
          className="w-full rounded-lg border border-brand-charcoal/15 bg-white px-3 py-2 text-sm focus:border-brand-purple focus:outline-none"
        />
        {err && <p className="text-xs text-brand-coral">{err}</p>}
        <p className="text-[11px] text-brand-charcoal/60 leading-snug">
          By continuing you agree to get occasional messages from xdipx and to our terms. 21+ only.
        </p>
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="w-full rounded-lg bg-brand-gradient text-white font-display py-2 text-sm disabled:opacity-60"
        >
          {busy ? 'Starting…' : 'Dip In ♥'}
        </button>
      </form>
    </div>
  )
}

function Conversation({ chat }: { chat: ChatHook }) {
  const [input, setInput] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.messages, chat.streaming])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || chat.streaming) return
    setInput('')
    chat.send(text)
  }

  return (
    <>
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 bg-brand-cream space-y-3">
        {chat.messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {chat.streaming && chat.messages[chat.messages.length - 1]?.role === 'user' && (
          <div className="text-xs text-brand-charcoal/50 italic">Emma is typing…</div>
        )}
        {chat.error && (
          <div className="text-xs text-brand-coral bg-brand-coral/10 rounded-md px-3 py-2">
            {chat.error}
          </div>
        )}
      </div>
      <form onSubmit={submit} className="border-t border-brand-charcoal/10 p-3 bg-white flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Emma anything…"
          disabled={chat.streaming}
          className="flex-1 rounded-lg border border-brand-charcoal/15 px-3 py-2 text-sm focus:border-brand-purple focus:outline-none"
        />
        <button
          type="submit"
          disabled={chat.streaming || !input.trim()}
          className="rounded-lg bg-brand-gradient text-white font-display px-4 py-2 text-sm disabled:opacity-60"
        >
          Send
        </button>
      </form>
      <div className="text-[10px] text-center text-brand-charcoal/40 pb-1">
        <button onClick={chat.close} className="hover:underline">End chat</button>
      </div>
    </>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
          isUser
            ? 'bg-brand-purple text-white rounded-br-sm'
            : 'bg-white text-brand-charcoal border border-brand-charcoal/10 rounded-bl-sm'
        }`}
      >
        {message.text || (!isUser && <span className="opacity-60">…</span>)}
        {!isUser && message.toolEvents?.length ? (
          <ToolEventList events={message.toolEvents} />
        ) : null}
      </div>
    </div>
  )
}

function ToolEventList({ events }: { events: ChatToolEvent[] }) {
  // Render product results from searchProducts / discoverProducts / recommendSimilar
  const products: Array<{ title: string; handle: string; price?: number; image?: string }> = []
  let dealLink: string | null = null
  let draftInvoiceUrl: string | null = null

  for (const e of events) {
    if (e.type !== 'tool_result') continue
    const out = e.output as { ok?: boolean; data?: unknown; invoiceUrl?: string } | null
    if (!out?.ok) continue
    if (e.name === 'readTodaysDeal') {
      const d = out.data as { url?: string; handle?: string } | undefined
      if (d?.url) dealLink = d.url
      else if (d?.handle) dealLink = `/products/${d.handle}`
    }
    if (e.name === 'searchProducts' || e.name === 'discoverProducts' || e.name === 'recommendSimilar') {
      const list = (out.data as unknown as { results?: Array<{ title: string; handle: string; price?: number; image?: string }> } | undefined)?.results
      if (Array.isArray(list)) products.push(...list.slice(0, 4))
    }
    if (e.name === 'createDraftOrder') {
      const url = (out as { invoiceUrl?: string }).invoiceUrl
      if (url) draftInvoiceUrl = url
    }
  }

  if (!products.length && !dealLink && !draftInvoiceUrl) return null

  return (
    <div className="mt-2 space-y-2">
      {products.map((p) => (
        <a
          key={p.handle}
          href={`/products/${p.handle}`}
          className="flex items-center gap-2 rounded-lg border border-brand-charcoal/10 p-2 hover:border-brand-purple"
        >
          {p.image && <img src={p.image} alt="" className="h-10 w-10 rounded object-cover" />}
          <div className="flex-1 min-w-0">
            <div className="truncate text-xs font-medium">{p.title}</div>
            {typeof p.price === 'number' && (
              <div className="text-xs text-brand-purple">${p.price.toFixed(2)}</div>
            )}
          </div>
        </a>
      ))}
      {dealLink && (
        <a href={dealLink} className="inline-block text-xs font-display text-brand-purple underline">
          See today's deal →
        </a>
      )}
      {draftInvoiceUrl && (
        <a
          href={draftInvoiceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-block rounded-md bg-brand-gradient text-white text-xs font-display px-3 py-1"
        >
          Open checkout link
        </a>
      )}
    </div>
  )
}
