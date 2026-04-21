import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PairBundleCopyMoment, PairBundleCopyWhyCard } from '~/types'
import { renderWithHighlight } from './pairBundleText'

export interface PairBundleHeroCarouselProps {
  whyCards:      PairBundleCopyWhyCard[]
  emmaQuote:     string
  momentTitle:   string
  moments:       PairBundleCopyMoment[]
  autoAdvanceMs?: number
}

type SlideKey = 'why' | 'emma' | 'moments'
interface SlideMeta { key: SlideKey; label: string }

export function PairBundleHeroCarousel({
  whyCards,
  emmaQuote,
  momentTitle,
  moments,
  autoAdvanceMs = 6000,
}: PairBundleHeroCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [active,  setActive]  = useState(0)
  const [paused,  setPaused]  = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)

  const slides = useMemo<SlideMeta[]>(() => {
    const list: SlideMeta[] = []
    if (whyCards.length > 0) list.push({ key: 'why',     label: 'Why they\u2019re better together' })
    if (emmaQuote.trim())    list.push({ key: 'emma',    label: 'Emma\u2019s take' })
    if (moments.length > 0)  list.push({ key: 'moments', label: momentTitle || 'How to make this pair click' })
    return list
  }, [whyCards, emmaQuote, moments, momentTitle])

  // prefers-reduced-motion (guarded for SSR)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(mql.matches)
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  const goTo = useCallback((i: number) => {
    const el = trackRef.current
    if (!el) return
    const child = el.children[i] as HTMLElement | undefined
    if (!child) return
    el.scrollTo({ left: child.offsetLeft, behavior: reducedMotion ? 'auto' : 'smooth' })
  }, [reducedMotion])

  const next = useCallback(() => goTo((active + 1) % Math.max(1, slides.length)), [active, slides.length, goTo])
  const prev = useCallback(() => goTo((active - 1 + slides.length) % Math.max(1, slides.length)), [active, slides.length, goTo])

  // Active-slide tracking via IntersectionObserver (more reliable than scroll events)
  useEffect(() => {
    const el = trackRef.current
    if (!el || slides.length <= 1) return
    if (typeof IntersectionObserver === 'undefined') return

    const io = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (!visible) return
        const idx = Array.from(el.children).indexOf(visible.target as Element)
        if (idx >= 0) setActive(idx)
      },
      { root: el, threshold: [0.5, 0.75] },
    )
    Array.from(el.children).forEach(c => io.observe(c))
    return () => io.disconnect()
  }, [slides.length])

  // Auto-advance
  useEffect(() => {
    if (paused || autoAdvanceMs <= 0 || reducedMotion || slides.length <= 1) return
    if (typeof window === 'undefined') return
    const id = window.setInterval(() => {
      const el = trackRef.current
      if (!el) return
      const nextIdx = (active + 1) % slides.length
      const child = el.children[nextIdx] as HTMLElement | undefined
      if (child) el.scrollTo({ left: child.offsetLeft, behavior: 'smooth' })
    }, autoAdvanceMs)
    return () => clearInterval(id)
  }, [paused, autoAdvanceMs, reducedMotion, active, slides.length])

  const handleKeys = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); next() }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); prev() }
  }, [next, prev])

  if (slides.length === 0) return null

  const showControls = slides.length > 1

  return (
    <section
      role="region"
      aria-roledescription="carousel"
      aria-label="Pair bundle details"
      tabIndex={-1}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setPaused(false)}
      onKeyDown={handleKeys}
      className="relative bg-cream focus:outline-none"
    >
      <div
        ref={trackRef}
        className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide"
        style={{ scrollbarWidth: 'none' }}
      >
        {slides.map(slide => {
          if (slide.key === 'why') {
            return (
              <article
                key="why"
                id="pbh-slide-why"
                aria-labelledby="pbh-slide-why-label"
                className="shrink-0 w-screen snap-start bg-paper border-y border-line"
              >
                <div className="max-w-5xl mx-auto px-4 md:px-6 py-10 md:py-14">
                  <div className="flex items-baseline justify-between gap-5 mb-5 md:mb-6">
                    <div id="pbh-slide-why-label">
                      <span
                        className="italic"
                        style={{
                          fontFamily:    'var(--font-display)',
                          fontWeight:    500,
                          fontStyle:     'italic',
                          fontSize:      'clamp(20px, 2.4vw, 26px)',
                          letterSpacing: '-0.01em',
                        }}
                      >
                        Why they&#39;re{' '}
                        <em style={{ fontStyle: 'italic', fontWeight: 600, color: 'var(--color-coral)' }}>
                          better together
                        </em>
                      </span>
                      <span
                        className="ml-2.5 text-muted hidden md:inline"
                        style={{ fontFamily: 'var(--font-script)', fontSize: '17px' }}
                      >
                        — the short, honest version
                      </span>
                    </div>
                  </div>

                  {/* Mobile — vertical stack */}
                  <ol className="md:hidden flex flex-col gap-3 list-none">
                    {whyCards.map((c, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-3.5 p-4 rounded-[14px] bg-cream"
                        style={{ border: '1.2px solid var(--color-line-2)' }}
                      >
                        <span
                          className="shrink-0 italic leading-none text-coral"
                          style={{
                            fontFamily:    'var(--font-display)',
                            fontStyle:     'italic',
                            fontWeight:    800,
                            fontSize:      '30px',
                            letterSpacing: '-0.02em',
                            minWidth:      '40px',
                          }}
                          aria-hidden="true"
                        >
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div
                            className="text-ink mb-1 leading-tight"
                            style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '15px' }}
                          >
                            {c.head}
                          </div>
                          <p
                            className="text-ink-2 leading-[1.45]"
                            style={{ fontFamily: 'var(--font-body)', fontSize: '12.5px' }}
                          >
                            {c.body}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>

                  {/* Desktop — 3-col dashed grid */}
                  <div
                    className="hidden md:grid grid-cols-3 overflow-hidden"
                    style={{ border: '1px dashed var(--color-line-2)', borderRadius: '6px' }}
                  >
                    {whyCards.map((c, i) => (
                      <div
                        key={i}
                        className="px-[22px] py-[18px] relative"
                        style={{ borderRight: i < whyCards.length - 1 ? '1px dashed var(--color-line-2)' : 'none' }}
                      >
                        <div
                          className="mb-1 italic"
                          style={{
                            fontFamily:    'var(--font-display)',
                            fontWeight:    700,
                            fontStyle:     'italic',
                            fontSize:      '28px',
                            color:         'var(--color-coral)',
                            letterSpacing: '-0.02em',
                          }}
                        >
                          {String(i + 1).padStart(2, '0')}
                        </div>
                        <div
                          className="mb-1"
                          style={{
                            fontFamily:    'var(--font-display)',
                            fontWeight:    700,
                            fontSize:      '15px',
                            letterSpacing: '-0.005em',
                          }}
                        >
                          {c.head}
                        </div>
                        <div
                          className="text-muted"
                          style={{ fontFamily: 'var(--font-body)', fontSize: '12.5px', lineHeight: 1.5 }}
                        >
                          {c.body}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            )
          }

          if (slide.key === 'emma') {
            return (
              <article
                key="emma"
                id="pbh-slide-emma"
                aria-labelledby="pbh-slide-emma-label"
                className="shrink-0 w-screen snap-start bg-paper border-y border-line"
              >
                <div className="max-w-3xl mx-auto px-6 py-12 md:py-20 text-center">
                  <span id="pbh-slide-emma-label" className="sr-only">Emma&#39;s take</span>
                  <span
                    aria-hidden="true"
                    className="block text-coral leading-none mb-3 select-none"
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontStyle:  'italic',
                      fontWeight: 800,
                      fontSize:   '72px',
                    }}
                  >
                    &ldquo;
                  </span>
                  <p
                    className="text-ink italic leading-[1.35]"
                    style={{
                      fontFamily:    'var(--font-display)',
                      fontWeight:    400,
                      fontSize:      'clamp(22px, 3.2vw, 34px)',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {renderWithHighlight(emmaQuote)}
                  </p>
                  <p
                    className="mt-6 text-coral-deep"
                    style={{ fontFamily: 'var(--font-script)', fontSize: '22px' }}
                  >
                    — Emma
                  </p>
                  <div aria-hidden="true" className="mt-4 mx-auto h-[2px] w-16 bg-coral" />
                </div>
              </article>
            )
          }

          // moments
          const grid = moments.length >= 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'
          return (
            <article
              key="moments"
              id="pbh-slide-moments"
              aria-labelledby="pbh-slide-moments-label"
              className="shrink-0 w-screen snap-start bg-paper border-y border-line"
            >
              <div className="max-w-5xl mx-auto px-4 md:px-6 py-10 md:py-14">
                <h2
                  id="pbh-slide-moments-label"
                  className="text-ink italic mb-6 md:mb-8 text-center"
                  style={{
                    fontFamily:    'var(--font-display)',
                    fontWeight:    500,
                    fontStyle:     'italic',
                    fontSize:      'clamp(22px, 2.6vw, 30px)',
                    letterSpacing: '-0.01em',
                  }}
                >
                  {momentTitle}
                </h2>

                {/* Mobile — vertical stack */}
                <ol className="md:hidden flex flex-col gap-3 list-none">
                  {moments.map((m, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-3.5 p-4 rounded-[14px] bg-cream"
                      style={{ border: '1.2px solid var(--color-line-2)' }}
                    >
                      <span
                        className="shrink-0 italic leading-none text-coral"
                        style={{
                          fontFamily:    'var(--font-display)',
                          fontStyle:     'italic',
                          fontWeight:    800,
                          fontSize:      '30px',
                          letterSpacing: '-0.02em',
                          minWidth:      '40px',
                        }}
                        aria-hidden="true"
                      >
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div
                          className="text-ink mb-1 leading-tight"
                          style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '15px' }}
                        >
                          {m.lead}
                        </div>
                        <p
                          className="text-ink-2 leading-[1.45]"
                          style={{ fontFamily: 'var(--font-body)', fontSize: '12.5px' }}
                        >
                          {m.body}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>

                {/* Desktop — grid */}
                <div
                  className={`hidden md:grid ${grid} overflow-hidden`}
                  style={{ border: '1px dashed var(--color-line-2)', borderRadius: '6px' }}
                >
                  {moments.map((m, i) => (
                    <div
                      key={i}
                      className="px-[22px] py-[18px] relative"
                      style={{ borderRight: i < moments.length - 1 ? '1px dashed var(--color-line-2)' : 'none' }}
                    >
                      <div
                        className="mb-1 italic"
                        style={{
                          fontFamily:    'var(--font-display)',
                          fontWeight:    700,
                          fontStyle:     'italic',
                          fontSize:      '28px',
                          color:         'var(--color-coral)',
                          letterSpacing: '-0.02em',
                        }}
                      >
                        {String(i + 1).padStart(2, '0')}
                      </div>
                      <div
                        className="mb-1"
                        style={{
                          fontFamily:    'var(--font-display)',
                          fontWeight:    700,
                          fontSize:      '15px',
                          letterSpacing: '-0.005em',
                        }}
                      >
                        {m.lead}
                      </div>
                      <div
                        className="text-muted"
                        style={{ fontFamily: 'var(--font-body)', fontSize: '12.5px', lineHeight: 1.5 }}
                      >
                        {m.body}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          )
        })}
      </div>

      {showControls && (
        <>
          {/* Dots */}
          <div
            role="tablist"
            aria-label="Slides"
            className="flex items-center justify-center gap-2 py-5 bg-cream"
          >
            {slides.map((s, i) => {
              const isActive = active === i
              return (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-label={`Go to slide ${i + 1}: ${s.label}`}
                  aria-current={isActive ? 'true' : undefined}
                  aria-selected={isActive}
                  onClick={() => goTo(i)}
                  className={`h-2 rounded-full transition-all duration-200 ${isActive ? 'w-6 bg-coral' : 'w-2 bg-line hover:bg-muted'}`}
                />
              )
            })}
          </div>

          {/* SR live region */}
          <div aria-live="polite" className="sr-only">
            {`Slide ${active + 1} of ${slides.length}: ${slides[active]?.label ?? ''}`}
          </div>
        </>
      )}
    </section>
  )
}
