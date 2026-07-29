/**
 * Up to three sourced claims, columned. Every claim ships with a source line
 * (the schema already refuses unsourced claims upstream), never fabricated
 * proof, per design doctrine §6.
 */

import { Reveal } from '~/components/motion/Reveal'
import type { ResolvedCategoryBlock } from '~/types/cms'
import { MONO, DISPLAY, BODY } from './consts'

type Block = Extract<ResolvedCategoryBlock, { _type: 'benefitEditorial' }>

export function BenefitEditorial({ block }: { block: Block }) {
  return (
    <section id={block.anchorId} data-block={block._type} className="bg-paper py-12 md:py-16">
      <div className="mx-auto max-w-[1320px] px-6 md:px-16">
        {block.heading && (
          <Reveal variant="up" className="mb-9">
            <h2 className="text-[1.7rem] leading-[1.1] tracking-[-0.01em] text-ink md:text-[2.3rem]" style={DISPLAY}>
              {block.heading}
            </h2>
          </Reveal>
        )}

        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          {block.claims.slice(0, 3).map((claim, i) => (
            <Reveal key={claim.claim} variant="up" index={i}>
              <p className="text-[20px] leading-snug text-ink" style={DISPLAY}>
                {claim.claim}
              </p>
              {claim.detail && (
                <p className="mt-2.5 text-[14.5px] leading-relaxed text-ink-3" style={BODY}>
                  {claim.detail}
                </p>
              )}
              <p className="mt-3 text-[11px] text-ink-4" style={MONO}>
                Source:{' '}
                {claim.sourceUrl ? (
                  <a
                    href={claim.sourceUrl}
                    target="_blank"
                    rel="noopener nofollow"
                    className="underline decoration-line-2 underline-offset-2"
                  >
                    {claim.source}
                  </a>
                ) : (
                  claim.source
                )}
              </p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
