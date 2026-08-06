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

    // Synchronous initial in-view seed. The IntersectionObserver callback is
    // always async (fires on a later frame), so between mount (mounted=true)
    // and that first callback, an above-the-fold element computes
    // animateIn=true / inView=false and springs toward the hidden state
    // (opacity 0, y 16px) before the observer springs it back. On a slow
    // device that gap is more than one frame: a visible flash that shows up as
    // Speed Index churn. Reading the element's box once here settles inView in
    // the same batched re-render as setMounted, so anything already on screen
    // paints its final state with no hidden frame. Off-screen elements stay
    // false and reveal on scroll via the observer exactly as before.
    const rect = el.getBoundingClientRect()
    const vh = window.innerHeight || document.documentElement.clientHeight
    // Mirror the default '-10% 0px' bottom rootMargin conservatively: only seed
    // for elements clearly within the initial viewport. Borderline elements
    // fall through to the observer, so this can never suppress a real reveal.
    if (rect.top < vh * 0.9 && rect.bottom > 0) {
      setInView(true)
      if (once) return
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
