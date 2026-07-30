/**
 * One large product feature on a coral-soft ground, image left / copy right.
 */

import { Link } from 'react-router'
import { OptimizedImage } from '~/components/store/OptimizedImage'
import { Reveal } from '~/components/motion/Reveal'
import type { ResolvedCategoryBlock } from '~/types/cms'
import { MONO, DISPLAY, BODY, formatPrice } from './consts'

type Block = Extract<ResolvedCategoryBlock, { _type: 'justLanded' }>

export function JustLanded({ block }: { block: Block }) {
  if (!block.product) return null
  const p = block.product

  return (
    <section id={block.anchorId} data-block={block._type} className="bg-coral-soft py-12 md:py-16">
      <Reveal variant="up" className="mx-auto max-w-[1320px] px-6 md:px-16">
        <p className="mb-6 text-[11px] uppercase tracking-[0.18em] text-ink-3" style={MONO}>
          {block.kicker}
        </p>
        <Link to={`/products/${p.handle}`} className="group flex flex-col gap-6 md:flex-row md:items-center md:gap-12">
          <div className="relative aspect-square w-full overflow-hidden rounded-[var(--radius-lg)] border border-line bg-paper/50 md:w-[380px] md:shrink-0">
            {p.imageUrl ? (
              <OptimizedImage
                src={p.imageUrl}
                alt={p.imageAlt ?? p.title}
                sizes="(max-width: 768px) 100vw, 380px"
                className="h-full w-full object-cover transition-transform duration-[var(--duration-slow)] group-hover:scale-[1.02]"
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-5xl text-sage">♥</div>
            )}
          </div>
          <div className="min-w-0">
            {p.brand && (
              <p className="text-[11px] uppercase tracking-[0.18em] text-ink-3" style={MONO}>
                {p.brand}
              </p>
            )}
            <h3 className="mt-1.5 text-[1.6rem] leading-[1.15] text-ink md:text-[2.1rem]" style={DISPLAY}>
              {p.title}
            </h3>
            {block.body && (
              <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-ink-3" style={BODY}>
                {block.body}
              </p>
            )}
            <p className="mt-4 flex items-baseline gap-2" style={BODY}>
              <span className="text-[18px] font-semibold text-ink">{formatPrice(p.price)}</span>
              {p.compareAtPrice != null && p.compareAtPrice > p.price && (
                <span className="text-[14px] text-ink-4 line-through">{formatPrice(p.compareAtPrice)}</span>
              )}
            </p>
          </div>
        </Link>
      </Reveal>
    </section>
  )
}
