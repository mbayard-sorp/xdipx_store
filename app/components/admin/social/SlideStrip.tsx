/**
 * The carousel builder under the Composer's mock: 1 to 10 slides, reorder
 * with Motion `layout` plus arrow keys on the slide handle (announced via
 * aria-live), per-slide alt text with a 1000 counter, remove with confirm,
 * and `+` which opens the Library in select mode.
 */
import { useState, type Dispatch } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ConfirmDeletePopover } from '~/components/admin/media/ConfirmDeletePopover'
import { ALT_TEXT_MAX, SLIDE_MAX, reorderAnnouncement, type ComposerSlide, type SlideAction } from './composer-slides'
import { ArrowLeftIcon, ArrowRightIcon, PlusIcon, RefreshIcon, TrashIcon } from './icons'

function aspectClass(aspect: string | null | undefined): string {
  switch (aspect) {
    case '16:9': return 'aspect-[16/9]'
    case '9:16': return 'aspect-[9/16]'
    case '1:1': return 'aspect-square'
    case '4:3': return 'aspect-[4/3]'
    case '3:4': return 'aspect-[3/4]'
    default: return 'aspect-[4/5]'
  }
}

export function SlideStrip({
  slides,
  dispatch,
  onAddFromLibrary,
  onRegenerate,
}: {
  slides: ComposerSlide[]
  dispatch: Dispatch<SlideAction>
  onAddFromLibrary: () => void
  onRegenerate: (slide: ComposerSlide) => void
}) {
  const [announce, setAnnounce] = useState('')
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const reduced = useReducedMotion()

  function shift(slide: ComposerSlide, by: -1 | 1) {
    const from = slides.findIndex(s => s.key === slide.key)
    const to = from + by
    if (to < 0 || to >= slides.length) return
    dispatch({ type: 'shift', key: slide.key, by })
    setAnnounce(reorderAnnouncement(to + 1, slides.length))
  }

  return (
    <section aria-label="Slides" className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
          Slides <span className="font-mono text-ink-4 normal-case tracking-normal">{slides.length}/{SLIDE_MAX}</span>
        </h3>
        <p className="text-[11px] text-ink-4 hidden md:block">Focus a slide handle and use the arrow keys to reorder.</p>
      </div>
      <p aria-live="polite" className="sr-only">{announce}</p>

      <ol className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1" role="list">
        {slides.map((slide, i) => (
          <motion.li
            key={slide.key}
            layout={!reduced}
            transition={{ type: 'spring', stiffness: 500, damping: 40, duration: 0.24 }}
            className="relative w-[132px] shrink-0 rounded-xl border border-line bg-paper-2 p-1.5 space-y-1.5"
          >
            <div className={`relative rounded-lg overflow-hidden bg-paper-3 ${aspectClass(slide.aspect)}`}>
              <img src={slide.url} alt={slide.altText || `Slide ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
              <span className="absolute top-1 left-1 font-mono text-[10px] leading-none px-1.5 py-1 rounded-full bg-ink/70 text-white tabular-nums">
                {i + 1}
              </span>
              {confirmKey === slide.key && (
                <ConfirmDeletePopover
                  label="Remove slide?"
                  undoHint="The image stays in the Library."
                  onCancel={() => setConfirmKey(null)}
                  onConfirm={() => { setConfirmKey(null); dispatch({ type: 'remove', key: slide.key }) }}
                />
              )}
            </div>

            <div className="flex items-center justify-between gap-0.5">
              <button
                type="button"
                aria-label={`Move slide ${i + 1} left`}
                disabled={i === 0}
                onClick={() => shift(slide, -1)}
                className="min-w-9 min-h-9 inline-flex items-center justify-center rounded-lg text-ink-3 hover:bg-paper-3 disabled:opacity-30"
              >
                <ArrowLeftIcon size={14} />
              </button>
              <button
                type="button"
                aria-label={`Slide ${i + 1} of ${slides.length}, reorder with arrow keys`}
                onKeyDown={e => {
                  if (e.key === 'ArrowLeft') { e.preventDefault(); shift(slide, -1) }
                  if (e.key === 'ArrowRight') { e.preventDefault(); shift(slide, 1) }
                }}
                className="min-w-9 min-h-9 inline-flex items-center justify-center rounded-lg text-ink-4 hover:bg-paper-3 focus:outline-none focus:ring-2 focus:ring-coral/40"
                title="Drag handle: arrow keys reorder"
              >
                <span aria-hidden="true" className="font-mono text-[11px] tracking-widest">::</span>
              </button>
              <button
                type="button"
                aria-label={`Move slide ${i + 1} right`}
                disabled={i === slides.length - 1}
                onClick={() => shift(slide, 1)}
                className="min-w-9 min-h-9 inline-flex items-center justify-center rounded-lg text-ink-3 hover:bg-paper-3 disabled:opacity-30"
              >
                <ArrowRightIcon size={14} />
              </button>
            </div>

            <label className="block">
              <span className="sr-only">Alt text for slide {i + 1}</span>
              <textarea
                value={slide.altText}
                onChange={e => dispatch({ type: 'alt', key: slide.key, altText: e.target.value })}
                rows={2}
                maxLength={ALT_TEXT_MAX}
                placeholder="Alt text"
                className="w-full rounded-lg border border-line bg-paper p-1.5 text-[11px] text-ink resize-none focus:outline-none focus:ring-2 focus:ring-coral/30"
              />
              <span className={`block text-right font-mono text-[10px] tabular-nums ${slide.altText.length > ALT_TEXT_MAX - 50 ? 'text-amber-700' : 'text-ink-4'}`}>
                {slide.altText.length}/{ALT_TEXT_MAX}
              </span>
            </label>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => onRegenerate(slide)}
                className="inline-flex items-center gap-1 min-h-9 px-2 rounded-lg text-[11px] font-medium text-ink-3 hover:bg-paper-3"
                title="Edit the prompt and regenerate this image"
              >
                <RefreshIcon size={12} /> Redo
              </button>
              <button
                type="button"
                onClick={() => setConfirmKey(slide.key)}
                aria-label={`Remove slide ${i + 1}`}
                className="inline-flex items-center justify-center min-w-9 min-h-9 rounded-lg text-ink-3 hover:text-red-700 hover:bg-red-50"
              >
                <TrashIcon size={14} />
              </button>
            </div>
          </motion.li>
        ))}

        {slides.length < SLIDE_MAX && (
          <li className="shrink-0">
            <button
              type="button"
              onClick={onAddFromLibrary}
              className={`w-[132px] ${aspectClass(slides[0]?.aspect)} rounded-xl border-2 border-dashed border-line bg-paper hover:border-coral hover:text-coral text-ink-3 flex flex-col items-center justify-center gap-1 text-xs font-medium`}
            >
              <PlusIcon size={18} />
              {slides.length === 0 ? 'Add images' : 'Add slide'}
            </button>
          </li>
        )}
      </ol>

      {slides.length === 0 && (
        <p className="text-xs text-ink-3">
          No images yet. Add from the Library (every generated candidate and every upload lives there), or upload on the Library page first.
        </p>
      )}
    </section>
  )
}
