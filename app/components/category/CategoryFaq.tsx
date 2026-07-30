/**
 * Accordion FAQ, styling copied from StorefrontHome's FAQ() band (border-t
 * rows, group-open rotating plus). Deliberately does NOT emit FAQStructuredData
 * here: the route owns JSON-LD for this page and must be the single place
 * that decides what schema goes out, so the same item set can't drift between
 * two emitters.
 */

import { Reveal } from '~/components/motion/Reveal'
import type { ResolvedCategoryBlock } from '~/types/cms'
import { DISPLAY, BODY } from './consts'

type Block = Extract<ResolvedCategoryBlock, { _type: 'faqBlock' }>

export function CategoryFaq({ block }: { block: Block }) {
  return (
    <section id={block.anchorId} data-block={block._type} className="bg-paper-2 py-12 md:py-16">
      <Reveal variant="up" className="mx-auto max-w-[820px] px-6 md:px-16">
        <h2 className="mb-9 text-[1.7rem] leading-[1.1] tracking-[-0.01em] text-ink md:text-[2.3rem]" style={DISPLAY}>
          {block.heading}
        </h2>
        {block.items.map((f, i) => (
          <details
            key={f.question}
            className={`group border-t border-line ${i === block.items.length - 1 ? 'border-b' : ''}`}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-5 py-6 text-[1.15rem] text-ink [&::-webkit-details-marker]:hidden" style={DISPLAY}>
              {f.question}
              <span className="text-2xl leading-none text-ink-4 transition-transform group-open:rotate-45" aria-hidden="true">
                +
              </span>
            </summary>
            <p className="max-w-[60ch] pb-6 text-[15px] leading-relaxed text-ink-3" style={BODY}>
              {f.answer}
            </p>
          </details>
        ))}
      </Reveal>
    </section>
  )
}
