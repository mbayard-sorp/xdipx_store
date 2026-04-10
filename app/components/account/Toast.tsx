import { useEffect, useRef, useState } from 'react'

interface ToastProps {
  /** Message to show — the toast re-mounts when this changes */
  message: string
  /** Called after auto-dismiss (3s) or on fade-out end */
  onDismiss: () => void
  /** Visual variant — success (purple check) or error (red dot) */
  variant?: 'success' | 'error'
}

/**
 * Small auto-dismiss toast.
 *
 * - Fixed bottom-center on mobile, top-right on desktop
 * - role="status" + aria-live="polite" so screen readers announce it
 * - Fades + slides in, auto-dismisses after 3000ms
 * - Brand styling: rounded-2xl, white bg, subtle shadow
 */
export function Toast({ message, onDismiss, variant = 'success' }: ToastProps) {
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
        className="flex items-center gap-3 bg-white rounded-2xl shadow-lg border border-brand-mist px-4 py-3 text-sm text-brand-charcoal"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {variant === 'success' ? (
          <svg
            aria-hidden="true"
            className="w-4 h-4 text-brand-purple shrink-0"
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
        <span className="font-semibold">{message}</span>
      </div>
    </div>
  )
}
