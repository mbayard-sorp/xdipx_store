/**
 * Split editorial band: copy column + product/image column on a coral-soft
 * ground. `block.imageUrl` (an editorial shot) wins over the product's own
 * catalog photo when both are set. The editorial image is the deliberate
 * merchandising choice.
 */

import { Link } from 'react-router'
import { OptimizedImage } from '~/components/store/OptimizedImage'
import { Reveal } from '~/components/motion/Reveal'
import type { ResolvedCategoryBlock } from '~/types/cms'
import { KICKER_CLASS, MONO, DISPLAY, BODY, renderEmphasizedHeadline } from './consts'

type Block = Extract<ResolvedCategoryBlock, { _type: 'editorialFeature' }>

export function EditorialFeature({ block }: { block: Block }) {
  if (!block.product) return null
  const imageUrl = block.imageUrl ?? block.product.imageUrl
  const imageAlt = block.imageAlt ?? block.product.imageAlt ?? block.product.title

  return (
    <section id={block.anchorId} data-block={block._type} className="bg-paper py-12 md:py-16">
      <Reveal variant="up" className="mx-auto grid max-w-[1320px] items-center gap-8 px-6 md:grid-cols-2 md:gap-14 md:px-16">
        <div className="min-w-0 order-2 md:order-1">
          {block.kicker && (
            <p className={`mb-4 ${KICKER_CLASS}`} style={MONO}>
              {block.kicker}
            </p>
          )}
          <h2 className="text-[1.8rem] leading-[1.1] tracking-[-0.01em] text-ink md:text-[2.6rem]" style={DISPLAY}>
            {renderEmphasizedHeadline(block.headline, block.italicWord)}
          </h2>
          {block.body && (
            <p className="mt-4 max-w-[52ch] text-[15.5px] leading-relaxed text-ink-3" style={BODY}>
              {block.body}
            </p>
          )}
          <Link
            to={`/products/${block.product.handle}`}
            className="mt-7 inline-flex items-center gap-2 rounded-full bg-coral px-6 py-3.5 text-[15px] font-medium text-white transition-transform hover:-translate-y-0.5"
            style={BODY}
          >
            {block.ctaLabel}
          </Link>
        </div>

        <div className="order-1 md:order-2">
          <div className="relative aspect-square w-full overflow-hidden rounded-[var(--radius-lg)] border border-line bg-coral-soft">
            {imageUrl ? (
              <OptimizedImage
                src={imageUrl}
                alt={imageAlt}
                sizes="(max-width: 768px) 100vw, 50vw"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-5xl text-sage">♥</div>
            )}
          </div>
        </div>
      </Reveal>
    </section>
  )
}
