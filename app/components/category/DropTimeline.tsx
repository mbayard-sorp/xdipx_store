/**
 * Vertical spine of drop entries, each with a mini product row (up to 6
 * 64px thumbs linking to PDPs, title as the tooltip).
 */

import { Link } from 'react-router'
import { OptimizedImage } from '~/components/store/OptimizedImage'
import { Reveal } from '~/components/motion/Reveal'
import type { ResolvedCategoryBlock } from '~/types/cms'
import { MONO, BODY } from './consts'

type Block = Extract<ResolvedCategoryBlock, { _type: 'dropTimeline' }>

export function DropTimeline({ block }: { block: Block }) {
  return (
    <section id={block.anchorId} data-block={block._type} className="bg-paper py-12 md:py-16">
      <div className="mx-auto max-w-[1320px] px-6 md:px-16">
        <Reveal variant="up" className="mb-9">
          <h2 className="text-[1.7rem] leading-[1.1] tracking-[-0.01em] text-ink md:text-[2.3rem]" style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}>
            {block.heading}
          </h2>
        </Reveal>

        <div className="flex flex-col gap-8 border-l border-line pl-6">
          {block.entries.map((entry, i) => (
            <Reveal key={entry.label} variant="up" index={i}>
              <p className="text-[11px] uppercase tracking-[0.18em] text-ink-4" style={MONO}>
                {entry.label}
              </p>
              {entry.note && (
                <p className="mt-1.5 max-w-[60ch] text-[14.5px] leading-relaxed text-ink-3" style={BODY}>
                  {entry.note}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2.5">
                {entry.products.slice(0, 6).map(p => (
                  <Link
                    key={p.id}
                    to={`/products/${p.handle}`}
                    title={p.title}
                    className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-line bg-paper-2"
                  >
                    {p.imageUrl ? (
                      <OptimizedImage
                        src={p.imageUrl}
                        alt={p.imageAlt ?? p.title}
                        sizes="64px"
                        widths={[64, 128]}
                        fallbackWidth={128}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="absolute inset-0 grid place-items-center text-lg text-sage">♥</span>
                    )}
                  </Link>
                ))}
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
