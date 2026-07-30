/**
 * Pure-link mood chooser. Pills are relative query links (`?mood=...`) the
 * collection route's existing filter system reads; no client state here.
 */

import { Link } from 'react-router'
import { Reveal } from '~/components/motion/Reveal'
import type { ResolvedCategoryBlock } from '~/types/cms'
import { DISPLAY, BODY } from './consts'

type Block = Extract<ResolvedCategoryBlock, { _type: 'chooserBlock' }>

export function ChooserBlock({ block }: { block: Block }) {
  const first = block.options[0]

  return (
    <section id={block.anchorId} data-block={block._type} className="bg-paper py-12 md:py-16">
      <Reveal variant="up" className="mx-auto max-w-[1320px] px-6 md:px-16">
        <h2 className="mb-6 text-[1.7rem] leading-[1.1] tracking-[-0.01em] text-ink md:text-[2.3rem]" style={DISPLAY}>
          {block.heading}
        </h2>
        <div className="flex flex-wrap gap-2.5">
          {block.options.map(option => (
            <Link
              key={option.tag}
              to={`?mood=${encodeURIComponent(option.tag)}`}
              className="rounded-full border border-line px-5 py-2.5 text-[14px] text-ink transition-colors hover:bg-paper-2"
              style={BODY}
            >
              {option.label}
            </Link>
          ))}
        </div>
        {first?.narratorCopy && (
          <p className="mt-5 text-[14.5px] italic text-ink-3" style={BODY}>
            {first.narratorCopy}
          </p>
        )}
      </Reveal>
    </section>
  )
}
