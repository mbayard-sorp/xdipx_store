import { useEffect, useState } from 'react'
import { motion, useScroll } from 'motion/react'

/**
 * 2px coral reading-progress bar fixed to the top of the viewport (art
 * direction §4). Transform-only (scaleX), so zero CLS. Renders nothing until
 * mount, so SSR markup is unaffected. Positional rather than decorative, so
 * it simply tracks scroll under reduced-motion.
 */
export function ReadingProgress() {
  const { scrollYProgress } = useScroll()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) return null

  return (
    <motion.div
      aria-hidden="true"
      className="fixed top-0 left-0 right-0 h-0.5 bg-coral origin-left z-50"
      style={{ scaleX: scrollYProgress }}
    />
  )
}
