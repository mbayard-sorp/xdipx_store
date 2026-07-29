/**
 * Drop-page H1 masthead. Same shape as CategoryMasthead plus a small mono
 * "period" chip (e.g. "This week", "July drop"). Coral-soft ground tint,
 * the drop pages read warmer than the evergreen category pages. Image is the
 * LCP candidate and stays outside Reveal.
 */

import { OptimizedImage } from '~/components/store/OptimizedImage'
import { Reveal } from '~/components/motion/Reveal'
import type { ResolvedCategoryBlock } from '~/types/cms'
import { MONO, DISPLAY, BODY, renderEmphasizedHeadline } from './consts'

type Block = Extract<ResolvedCategoryBlock, { _type: 'dropMasthead' }>

export function DropMasthead({ block }: { block: Block }) {
  return (
    <section id={block.anchorId} data-block={block._type} className="bg-coral-soft">
      <div className="mx-auto max-w-[1320px] px-6 py-10 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] md:items-center md:gap-14 md:px-16 md:py-16">
        <Reveal variant="up" disabled className="min-w-0">
          {block.period && (
            <span
              className="mb-4 inline-block rounded-full bg-paper/70 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-ink-3"
              style={MONO}
            >
              {block.period}
            </span>
          )}
          <h1
            className="text-[2.3rem] leading-[1.08] tracking-[-0.01em] text-ink md:text-[3.6rem]"
            style={DISPLAY}
          >
            {renderEmphasizedHeadline(block.headline, block.italicWord)}
          </h1>
          {block.standfirst && (
            <p className="mt-5 max-w-[60ch] text-[16.5px] leading-relaxed text-ink-3" style={BODY}>
              {block.standfirst}
            </p>
          )}
        </Reveal>

        {block.imageUrl && (
          <div className="relative mt-7 aspect-[4/3] w-full overflow-hidden rounded-[var(--radius-lg)] border border-line bg-paper/40 md:mt-0">
            <OptimizedImage
              src={block.imageUrl}
              alt={block.imageAlt ?? block.headline}
              priority
              sizes="(max-width: 768px) 100vw, 45vw"
              className="h-full w-full object-cover"
            />
          </div>
        )}
      </div>
    </section>
  )
}
