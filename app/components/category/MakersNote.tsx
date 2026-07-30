/**
 * Narrow-measure prose band, no product/image, just the editor's own note.
 */

import { Reveal } from '~/components/motion/Reveal'
import type { ResolvedCategoryBlock } from '~/types/cms'
import { DISPLAY, BODY } from './consts'

type Block = Extract<ResolvedCategoryBlock, { _type: 'makersNote' }>

export function MakersNote({ block }: { block: Block }) {
  return (
    <section id={block.anchorId} data-block={block._type} className="bg-paper py-12 md:py-16">
      <Reveal variant="up" className="mx-auto max-w-[65ch] px-6 md:px-16">
        <h2 className="mb-4 text-[1.6rem] leading-[1.15] tracking-[-0.01em] text-ink md:text-[2.1rem]" style={DISPLAY}>
          {block.heading}
        </h2>
        <p className="whitespace-pre-line text-[15.5px] leading-relaxed text-ink-3" style={BODY}>
          {block.body}
        </p>
      </Reveal>
    </section>
  )
}
