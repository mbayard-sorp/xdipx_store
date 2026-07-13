import { useEffect, useRef, useState } from 'react'
import { motion, useScroll, useMotionValueEvent } from 'motion/react'
import { useLocation } from 'react-router'
import { trackNotebookReadDepth } from '~/lib/analytics.client'

const DEPTH_THRESHOLDS = [25, 50, 75, 100] as const

/**
 * 2px coral reading-progress bar fixed to the top of the viewport (art
 * direction §4). Transform-only (scaleX), so zero CLS. Renders nothing until
 * mount, so SSR markup is unaffected. Positional rather than decorative, so
 * it simply tracks scroll under reduced-motion.
 *
 * Doubles as the read-depth instrument: fires notebook_read_depth once per
 * 25/50/75/100% threshold per page view.
 */
export function ReadingProgress() {
  const { scrollYProgress } = useScroll()
  const location = useLocation()
  const [mounted, setMounted] = useState(false)
  const fired = useRef(new Set<number>())
  useEffect(() => setMounted(true), [])

  // New post, fresh thresholds.
  useEffect(() => {
    fired.current = new Set()
  }, [location.pathname])

  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    const percent = v * 100
    for (const t of DEPTH_THRESHOLDS) {
      if (percent >= t && !fired.current.has(t)) {
        fired.current.add(t)
        trackNotebookReadDepth({ postPath: location.pathname, percent: t })
      }
    }
  })

  if (!mounted) return null

  return (
    <motion.div
      aria-hidden="true"
      className="fixed top-0 left-0 right-0 h-0.5 bg-coral origin-left z-50"
      style={{ scaleX: scrollYProgress }}
    />
  )
}
