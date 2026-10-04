/**
 * Toast region for the Ad Studio layout (wires 10.4). One toast at a time,
 * auto-dismiss 4s (6s with Undo). Ratings do not toast: the sheet's "Saved"
 * readout already confirms them.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { revealVariants, springEntrance } from '~/components/motion/variants'

interface ToastInput { message: string; actionLabel?: string; onAction?: () => void }
interface ToastState extends ToastInput { id: number }

const Ctx = createContext<{ show: (t: ToastInput) => void }>({ show: () => {} })

export function useAdsToast() {
  return useContext(Ctx)
}

export function AdsToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)
  const reduce = useReducedMotion()

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    setToast(null)
  }, [])

  const show = useCallback((t: ToastInput) => {
    if (timer.current) clearTimeout(timer.current)
    seq.current += 1
    setToast({ ...t, id: seq.current })
    timer.current = setTimeout(() => setToast(null), t.onAction ? 6000 : 4000)
  }, [])

  const value = useMemo(() => ({ show }), [show])

  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed z-30 inset-x-4 bottom-[calc(56px+env(safe-area-inset-bottom)+12px)] md:inset-x-auto md:right-8 md:bottom-8 md:w-80"
      >
        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast.id}
              {...(reduce ? {} : { variants: revealVariants.up })}
              initial={reduce ? false : 'hidden'}
              animate="visible"
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              transition={springEntrance}
              className="pointer-events-auto flex items-center gap-2 rounded-2xl bg-ink px-4 py-3 text-sm text-white shadow-lg"
            >
              <span className="min-w-0 flex-1">{toast.message}</span>
              {toast.actionLabel && toast.onAction && (
                <button
                  type="button"
                  onClick={() => { toast.onAction?.(); dismiss() }}
                  className="min-h-11 px-3 font-semibold text-white underline-offset-2 hover:underline touch-manipulation"
                >
                  {toast.actionLabel}
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  )
}
