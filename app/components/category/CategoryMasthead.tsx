/**
 * Category page H1 masthead. The image is the page's LCP candidate, so it
 * renders outside Reveal (handled by CategoryBlockRenderer, which wraps only
 * the copy column).
 */

import { OptimizedImage } from '~/components/store/OptimizedImage'
import { Reveal } from '~/components/motion/Reveal'
import type { ResolvedCategoryBlock } from '~/types/cms'
import { KICKER_CLASS, MONO, DISPLAY, BODY, renderEmphasizedHeadline } from './consts'

type Block = Extract<ResolvedCategoryBlock, { _type: 'categoryMasthead' }>

export function CategoryMasthead({ block }: { block: Block }) {
  return (
    <section id={block.anchorId} data-block={block._type} className="bg-paper">
      <div className="mx-auto max-w-[1320px] px-6 py-10 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] md:items-center md:gap-14 md:px-16 md:py-16">
        {/* Copy is above the fold with the image, so it reveals on a timer
            (disabled) rather than waiting on scroll, matching Hero() in
            StorefrontHome. */}
        <Reveal variant="up" disabled className="min-w-0">
          {block.kicker && (
            <p className={`mb-4 ${KICKER_CLASS}`} style={MONO}>
              {block.kicker}
            </p>
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

        {/* LCP candidate, never wrapped in Reveal. */}
        {block.imageUrl && (
          <div className="relative mt-7 aspect-[4/3] w-full overflow-hidden rounded-[var(--radius-lg)] border border-line bg-paper-2 md:mt-0">
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
