/**
 * Quiet single-row trust strip, modeled on the homepage trust strip
 * (StorefrontHome's Nº 02 band) but flattened to a hairline-separated
 * flex-wrap row instead of a grid, since category pages carry it lower on
 * the page rather than raised into the hero.
 */

import { Reveal } from '~/components/motion/Reveal'
import type { ResolvedCategoryBlock } from '~/types/cms'
import { BODY } from './consts'

type Block = Extract<ResolvedCategoryBlock, { _type: 'categoryTrust' }>

export function CategoryTrust({ block }: { block: Block }) {
  return (
    <section id={block.anchorId} data-block={block._type} className="border-y border-line bg-paper-2">
      <Reveal variant="fade" className="mx-auto max-w-[1320px] px-6 py-6 md:px-16">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-3">
          {block.items.map((item, i) => (
            <span key={item.headline} className="flex items-center gap-2.5">
              {i > 0 && <span className="text-ink-4" aria-hidden="true">·</span>}
              <span style={BODY}>
                <span className="text-[14px] font-semibold text-ink">{item.headline}</span>
                {item.subheadline && (
                  <span className="ml-1.5 text-[13px] text-ink-3">{item.subheadline}</span>
                )}
              </span>
            </span>
          ))}
        </div>
      </Reveal>
    </section>
  )
}
