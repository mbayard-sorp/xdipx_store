import { useEffect, useLayoutEffect, useRef, useState } from 'react'

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
  /** True only for an element that was below the fold at first paint, so it
      can be hidden and animated in without the user ever seeing it visible.
      Above-the-fold content is never armed: hiding what has already painted
      costs FCP/LCP and buys nothing the reader can see. */
  armed: boolean
}

/** SSR-safe: useLayoutEffect warns on the server, and there is no layout to read there. */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * SSR-safe scroll-reveal signal, CSS-driven.
 *
 * Server and first client render report mounted=false and armed=false, so
 * callers paint the visible/final state and hydration matches. Before the
 * browser's first paint, a layout effect measures the element: only content
 * BELOW the fold is armed (hidden, then animated in when scrolled to).
 * Anything already on screen stays visible and never animates, which is why
 * there is no hide-then-reshow flash and why the hero costs nothing.
 *
 * Reduced motion arms nothing at all.
 */
export function useReveal(opts: UseRevealOptions = {}): UseRevealResult {
  const {
    once = true,
    amount = 0.2,
    rootMargin = '0px 0px -10% 0px',
    disabled = false,
  } = opts

  const ref = useRef<HTMLElement | null>(null)
  const [mounted, setMounted] = useState(false)
  const [inView, setInView] = useState(false)
  const [armed, setArmed] = useState(false)
  const [reduced, setReduced] = useState(false)

  // Runs before the browser paints, so arming never flashes.
  useIsomorphicLayoutEffect(() => {
    setMounted(true)

    if (prefersReducedMotion()) {
      setReduced(true)
      setInView(true)
      return
    }
    // `disabled` marks above-the-fold content, which is never armed.
    if (disabled) {
      setInView(true)
      return
    }
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    // A hidden document (background tab, prerender) delivers no IntersectionObserver
    // callbacks, so arming there would hide content with nothing to bring it back.
    // Never arm what cannot be observed.
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      setInView(true)
      return
    }
    // Below the fold at first paint? Only then is it safe to hide it.
    const belowFold = el.getBoundingClientRect().top >= window.innerHeight
    if (!belowFold) {
      setInView(true)
      return
    }
    setArmed(true)
  }, [disabled])

  useEffect(() => {
    if (!armed) return
    const el = ref.current
    if (!el) return

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
  }, [armed, once, amount, rootMargin])

  return { ref, inView, mounted, reduced, armed }
}
