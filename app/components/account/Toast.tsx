import { useEffect, useRef, useState } from 'react'

interface ToastProps {
  /** Plain-text message — ignored when children is provided */
  message?: string
  /** Rich content — takes precedence over message */
  children?: React.ReactNode
  /** Called after auto-dismiss (3s) or on fade-out end */
  onDismiss: () => void
  /** Visual variant — success (purple check) or error (red dot) */
  variant?: 'success' | 'error'
  /** Show an X close button */
  showClose?: boolean
}

/**
 * Small auto-dismiss toast.
 *
 * - Fixed bottom-center on mobile, top-right on desktop
 * - role="status" + aria-live="polite" so screen readers announce it
 * - Fades + slides in, auto-dismisses after 3000ms
 * - Brand styling: rounded-2xl, white bg, subtle shadow
 */
export function Toast({ message, children, onDismiss, variant = 'success', showClose = false }: ToastProps) {
  const [visible, setVisible] = useState(false)

  // Route onDismiss through a ref so the dismiss-timer effect only runs ONCE
  // on mount. Otherwise parent re-renders (e.g. a useRevalidator.revalidate()
  // call that lands during the 3s toast window) would create a new
  // onDismiss closure, tear down the timers, and restart the countdown —
  // in pathological cases the toast would never actually disappear.
  const onDismissRef = useRef(onDismiss)
  useEffect(() => {
    onDismissRef.current = onDismiss
  })

  // Fade + slide in on mount, then schedule fade-out + dismiss.
  useEffect(() => {
    // Next frame: flip visibility so the CSS transition runs.
    const show = requestAnimationFrame(() => setVisible(true))
    // After 3s start the fade-out; dismiss a moment later once animation done.
    const hide = setTimeout(() => setVisible(false), 3000)
    const done = setTimeout(() => onDismissRef.current(), 3200)
    return () => {
      cancelAnimationFrame(show)
      clearTimeout(hide)
      clearTimeout(done)
    }
    // Intentionally empty deps — see onDismissRef comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      role="status"
      aria-live="polite"
      className={`
        fixed z-50 px-4
        bottom-6 left-1/2 -translate-x-1/2
        sm:bottom-auto sm:left-auto sm:translate-x-0 sm:top-6 sm:right-6
        transition-all duration-200 ease-out
        ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}
      `}
    >
      <div
        className="flex items-center gap-3 bg-white rounded-2xl shadow-lg border border-cream-2 px-4 py-3 text-sm text-ink"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {variant === 'success' ? (
          <svg
            aria-hidden="true"
            className="w-4 h-4 text-sage shrink-0"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.415 0l-3.5-3.5a1 1 0 111.415-1.42l2.793 2.79 6.793-6.79a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        ) : (
          <span
            aria-hidden="true"
            className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0"
          />
        )}
        {children ?? <span className="font-semibold">{message}</span>}
        {showClose && (
          <button
            type="button"
            onClick={() => {
              setVisible(false)
              setTimeout(() => onDismissRef.current(), 200)
            }}
            aria-label="Close"
            className="ml-2 text-ink/40 hover:text-ink transition-colors shrink-0"
          >
            <svg aria-hidden="true" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
