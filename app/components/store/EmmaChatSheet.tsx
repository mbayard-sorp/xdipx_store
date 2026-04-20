import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Link } from 'react-router'

interface EmmaChatSheetProps {
  open:      boolean
  onClose:   () => void
  /** Optional SMS number — if present, shows "Text Emma" option. */
  textNumber?: string | null
}

type Step =
  | { kind: 'menu' }
  | { kind: 'prompt'; path: string[] }

const ROOT_PROMPTS: { label: string; href: string }[] = [
  { label: "I'm new here — where do I start?", href: '/collections/first-timer' },
  { label: 'Something quiet',                  href: '/search?matters=quiet' },
  { label: "I'm buying a gift",                href: '/search?audience=gift' },
  { label: 'What are your current picks?',     href: '/' },
  { label: 'Browse everything',                href: '/collections/all' },
]

export function EmmaChatSheet({ open, onClose, textNumber }: EmmaChatSheetProps) {
  const [step, setStep] = useState<Step>({ kind: 'menu' })

  useEffect(() => {
    if (!open) setStep({ kind: 'menu' })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const smsHref = textNumber
    ? `sms:${textNumber}?&body=${encodeURIComponent("Hey Emma — ")}`
    : null

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[70] bg-ink/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Ask Emma"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'tween', duration: 0.25 }}
            className="fixed bottom-0 inset-x-0 z-[71] bg-cream rounded-t-2xl shadow-2xl max-h-[85vh] flex flex-col"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            {/* Handle */}
            <div className="pt-3 pb-1 flex justify-center shrink-0">
              <span className="w-10 h-1 rounded-full bg-line" aria-hidden="true" />
            </div>

            {/* Header */}
            <div className="px-5 pb-3 flex items-start gap-3 shrink-0">
              <div
                className="w-11 h-11 rounded-full bg-coral text-white flex items-center justify-center font-bold text-base shrink-0"
                style={{ fontFamily: 'var(--font-display)' }}
                aria-hidden="true"
              >
                E
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <p className="text-[10px] font-mono text-muted uppercase tracking-wider">Emma · online</p>
                <p className="text-base font-bold text-ink leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
                  Hey — what are you after?
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-cream-2 transition-colors text-ink/70"
                aria-label="Close"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M1 1l12 12M13 1L1 13" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-2.5">
              {step.kind === 'menu' && (
                <>
                  {ROOT_PROMPTS.map(p => (
                    <Link
                      key={p.label}
                      to={p.href}
                      onClick={onClose}
                      className="block bg-paper border border-line rounded-xl px-4 py-3 text-[14px] text-ink hover:border-coral hover:text-coral transition-colors"
                    >
                      {p.label}
                    </Link>
                  ))}
                  <div className="pt-2 text-[11px] text-muted leading-relaxed">
                    Can't find the right question? Text me — I answer fast when I'm around.
                  </div>
                </>
              )}
            </div>

            {/* Footer — text fallback */}
            <div className="border-t border-line px-5 py-3 bg-paper shrink-0 flex gap-3">
              {smsHref ? (
                <a
                  href={smsHref}
                  className="flex-1 text-center py-3 rounded-xl bg-coral hover:bg-coral-deep text-white text-sm font-bold transition-colors"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Text Emma →
                </a>
              ) : (
                <Link
                  to="/contact"
                  onClick={onClose}
                  className="flex-1 text-center py-3 rounded-xl bg-coral hover:bg-coral-deep text-white text-sm font-bold transition-colors"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Leave a note →
                </Link>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
