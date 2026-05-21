import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'

export interface UseRevealOptions {
  /** Animate one time then stop observing. Default true. */
  once?: boolean
  /** IntersectionObserver threshold. Default 0.2. */
  amount?: number
  /** Fire slightly before fully in view. Default '0px 0px -10% 0px'. */
  rootMargin?: string
  /** Skip IntersectionObserver entirely (e.g. above-the-fold hero that
      animates on a time delay rather than on scroll-in). Default false. */
  disabled?: boolean
}

export interface UseRevealResult {
  ref: React.RefObject<HTMLElement | null>
  /** True once the element has entered the viewport (client only). */
  inView: boolean
  /** True after the first client paint. Gate so SSR + first paint render
      the FINAL state and hydration matches — no flash of hidden content. */
  mounted: boolean
  /** prefers-reduced-motion. When true, callers render the final state. */
  reduced: boolean
}

/**
 * SSR-safe scroll-reveal signal. Server and first client render report
 * mounted=false so callers paint the visible/final state; only after mount
 * does the reveal arm. IntersectionObserver is skipped under reduced motion
 * or when disabled (in which case the element is treated as in view).
 */
export function useReveal(opts: UseRevealOptions = {}): UseRevealResult {
  const {
    once = true,
    amount = 0.2,
    rootMargin = '0px 0px -10% 0px',
    disabled = false,
  } = opts

  const reduced = useReducedMotion() ?? false
  const ref = useRef<HTMLElement | null>(null)
  const [mounted, setMounted] = useState(false)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (disabled || reduced) {
      setInView(true)
      return
    }
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        if (entry.isIntersecting) {
          setInView(true)
          if (once) io.disconnect()
        } else if (!once) {
          setInView(false)
        }
      },
      { threshold: amount, rootMargin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [disabled, reduced, once, amount, rootMargin])

  return { ref, inView, mounted, reduced }
}
