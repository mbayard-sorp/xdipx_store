/**
 * Spec register, quiet: how the shelf's dial readings should be read. Plum-
 * soft tinted band so it visually separates from the product grids around it
 * without competing with them for attention.
 */

import { Reveal } from '~/components/motion/Reveal'
import type { ResolvedCategoryBlock } from '~/types/cms'
import { MONO, DISPLAY, BODY } from './consts'

type Block = Extract<ResolvedCategoryBlock, { _type: 'sensationLegend' }>

export function SensationLegend({ block }: { block: Block }) {
  return (
    <section id={block.anchorId} data-block={block._type} className="bg-plum-soft py-12 md:py-16">
      <Reveal variant="up" className="mx-auto max-w-[1320px] px-6 md:px-16">
        <h2 className="text-[1.5rem] leading-[1.15] tracking-[-0.01em] text-ink md:text-[2rem]" style={DISPLAY}>
          {block.heading}
        </h2>
        {block.intro && (
          <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-ink-3" style={BODY}>
            {block.intro}
          </p>
        )}

        <div className="mt-7 flex flex-col divide-y divide-line">
          {block.axes.map(axis => (
            <div key={axis.label} className="grid gap-2 py-4 md:grid-cols-[160px_minmax(0,1fr)] md:items-baseline md:gap-6">
              <p className="text-[15px] font-semibold text-ink" style={BODY}>
                {axis.label}
              </p>
              <div>
                {axis.definition && (
                  <p className="text-[14px] leading-relaxed text-ink-3" style={BODY}>
                    {axis.definition}
                  </p>
                )}
                {(axis.scaleLow || axis.scaleMid || axis.scaleHigh) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] uppercase tracking-[0.14em] text-ink-4" style={MONO}>
                    {axis.scaleLow && <span>1 · {axis.scaleLow}</span>}
                    {axis.scaleMid && <span>3 · {axis.scaleMid}</span>}
                    {axis.scaleHigh && <span>5 · {axis.scaleHigh}</span>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  )
}
