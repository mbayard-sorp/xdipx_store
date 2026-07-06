/**
 * 1f — "Or" fork.
 *
 * Two products, one plain question, each side is a link. Only one product
 * resolvable: component does not render (a half fork is worse than none).
 * Missing image one side: both sides fall back to tint blocks to preserve
 * symmetry.
 */

import { Link } from 'react-router'
import { OptimizedImage } from '~/components/store/OptimizedImage'
import type { OrForkBlock } from '~/types/cms'
import type { Product } from '~/types'

const DISPLAY = { fontFamily: 'var(--font-display)', fontWeight: 450 } as const
const DISPLAY_MED = { fontFamily: 'var(--font-display)', fontWeight: 500 } as const
const DISPLAY_ITALIC = { fontFamily: 'var(--font-display)', fontStyle: 'italic' } as const
const BODY = { fontFamily: 'var(--font-body)' } as const

function fmt(n: number): string {
  return `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`
}

interface OrForkProps {
  block: OrForkBlock
  productA: Product | null
  productB: Product | null
}

export function OrFork({ block, productA, productB }: OrForkProps) {
  // Only one product resolvable: component does not render.
  if (!productA || !productB) return null

  const question = block.question || 'Which one?'
  const emphasis = block.emphasisWord
  const questionParts = emphasis && question.includes(emphasis)
    ? question.split(emphasis)
    : [question, '']

  // Prefer each side's generated card image; fall back to the live Shopify
  // product photo when unset.
  const imageA = block.forkSideA?.image?.url
    ? { url: block.forkSideA.image.url, alt: block.forkSideA.image.alt || productA.title }
    : productA.images[0]?.url
      ? { url: productA.images[0].url, alt: productA.images[0].altText || productA.title }
      : null
  const imageB = block.forkSideB?.image?.url
    ? { url: block.forkSideB.image.url, alt: block.forkSideB.image.alt || productB.title }
    : productB.images[0]?.url
      ? { url: productB.images[0].url, alt: productB.images[0].altText || productB.title }
      : null

  // Missing image on one side: BOTH sides fall back to tint blocks (symmetry).
  const hasBothImages = !!imageA && !!imageB

  const sideA = {
    product: productA,
    answer: block.forkSideA?.answerLine,
    image: imageA,
    tint: 'bg-coral-soft',
  }
  const sideB = {
    product: productB,
    answer: block.forkSideB?.answerLine,
    image: imageB,
    tint: 'bg-plum-soft',
  }

  return (
    <section className="bg-paper px-5 py-7 md:px-8 md:py-9">
      <div className="mx-auto max-w-[1320px]">
        <h2
          className="mb-5 text-center text-[28px] leading-[1.1] tracking-[-0.01em] text-ink md:mb-7 md:text-[34px]"
          style={DISPLAY}
        >
          {questionParts[0]}
          {emphasis && <em className="em">{emphasis}</em>}
          {questionParts[1]}
        </h2>

        <div className="relative flex flex-col md:flex-row md:items-stretch">
          {[sideA, sideB].map((side, i) => (
            <Link
              key={side.product.id}
              to={`/products/${side.product.handle}`}
              className={[
                'group relative flex-1 overflow-hidden border border-line transition-all duration-[var(--duration-base)] hover:-translate-y-[3px] hover:border-coral',
                i === 0 ? 'mb-3 rounded-[var(--radius)] md:mb-0 md:rounded-l-[var(--radius)] md:rounded-r-none md:border-r-0' : 'rounded-[var(--radius)] md:rounded-l-none md:rounded-r-[var(--radius)]',
              ].join(' ')}
            >
              <div className={`relative flex aspect-[16/9] items-end justify-center p-2 md:aspect-[16/10] ${side.tint}`}>
                {hasBothImages ? (
                  <OptimizedImage
                    src={side.image!.url}
                    alt={side.image!.alt}
                    sizes="(max-width: 768px) 100vw, 50vw"
                    className="h-full w-full object-contain transition-transform duration-[var(--duration-base)] group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center text-4xl text-ink/10" aria-hidden="true">♥</div>
                )}
              </div>
              <div className="flex items-baseline justify-between gap-3 px-4 py-3.5 md:px-[18px] md:py-4">
                <div className="min-w-0">
                  <p
                    className="line-clamp-1 text-[18px] leading-tight text-ink transition-colors group-hover:text-coral md:text-[20px]"
                    style={DISPLAY_MED}
                  >
                    {side.product.title}
                  </p>
                  {side.answer && (
                    <p className="mt-0.5 line-clamp-2 text-[12px] text-ink-3 md:text-[12.5px]" style={BODY}>
                      {side.answer}
                    </p>
                  )}
                </div>
                <span className="shrink-0 whitespace-nowrap text-[13.5px] font-semibold text-ink md:text-[14px]" style={BODY}>
                  {fmt(side.product.price)}
                </span>
              </div>
            </Link>
          ))}

          {/* "or" badge — overlaps the seam, decorative. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 z-[1] flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-line-2 bg-white text-[17px] text-plum md:top-[38%] md:h-[52px] md:w-[52px] md:text-[20px]"
            style={DISPLAY_ITALIC}
          >
            or
          </span>
        </div>
      </div>
    </section>
  )
}
