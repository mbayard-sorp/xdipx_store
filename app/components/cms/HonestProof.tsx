/**
 * 1h — Honest proof module.
 *
 * Zero hype. No approved quotes: module does not render — never filler
 * testimonials (brand voice + FTC endorsement rules). Press slot empty: the
 * hairline row collapses.
 */

import type { HonestProofBlock } from '~/types/cms'

const DISPLAY = { fontFamily: 'var(--font-display)', fontWeight: 450 } as const
const BODY = { fontFamily: 'var(--font-body)' } as const
const MONO = { fontFamily: 'var(--font-mono)' } as const

interface HonestProofProps {
  block: HonestProofBlock
}

export function HonestProof({ block }: HonestProofProps) {
  const quotes = (block.proofQuotes ?? []).filter(q => q.verbatimText?.trim())
  // No approved quotes: never render filler testimonials.
  if (quotes.length === 0) return null

  const eyebrow = block.eyebrow || 'Word of mouth'
  const primary = quotes[0]!
  const secondary = quotes[1]
  const press = (block.proofPress ?? []).find(p => p.quote?.trim())

  return (
    <section className="bg-paper-2 px-5 py-7 md:px-10 md:py-9">
      <div className="mx-auto max-w-[1320px]">
        <p className="mb-3.5 text-[11px] uppercase tracking-[0.18em] text-ink-4 md:mb-[18px]" style={MONO}>
          {eyebrow}
        </p>

        <div className="grid gap-6 md:grid-cols-2 md:gap-10">
          <div>
            <blockquote
              className="text-[24px] leading-[1.25] text-ink md:text-[25px]"
              style={DISPLAY}
            >
              &ldquo;{primary.verbatimText}&rdquo;
            </blockquote>
            <p className="pt-2.5 text-[12px] text-ink-3" style={BODY}>
              {[
                'Verified buyer',
                primary.productHandle ? `the ${primary.productHandle}` : null,
                primary.durationOwned ? `owned ${primary.durationOwned}` : null,
              ].filter(Boolean).join(' · ')}
            </p>
          </div>

          {secondary && (
            <div className="border-line md:border-l md:pl-10">
              <blockquote
                className="text-[24px] leading-[1.25] text-ink md:text-[25px]"
                style={DISPLAY}
              >
                &ldquo;{secondary.verbatimText}&rdquo;
              </blockquote>
              <p className="pt-2.5 text-[12px] text-ink-3" style={BODY}>
                {[
                  'Verified buyer',
                  secondary.productHandle ? secondary.productHandle : null,
                  secondary.durationOwned ? `owned ${secondary.durationOwned}` : null,
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
          )}
        </div>

        {/* Press slot empty: the hairline row collapses (not rendered). */}
        {press && (
          <div className="mt-5 border-t border-line pt-3.5 md:mt-7 md:pt-4">
            <p className="text-[12.5px] text-ink-2" style={BODY}>
              <span className="mr-2 text-[9px] uppercase tracking-[0.14em] text-ink-4" style={MONO}>
                Press
              </span>
              &ldquo;{press.quote}&rdquo;
              {press.publication && <span className="text-ink-4"> · {press.publication}</span>}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
