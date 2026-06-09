import { Link } from 'react-router'
import type { Deal } from '~/types'
import { shopifyImageUrl } from '~/lib/shopify-image'

interface QuietEndorsementHeroProps {
  deal:             Deal
  showFreeShipping: boolean
}

const fmtPrice = (n: number) =>
  `$${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(2)}`

function renderBodyWithHighlight(body: string) {
  const parts = body.split(/(_[^_]+_)/g)
  return parts.map((part, i) => {
    if (part.startsWith('_') && part.endsWith('_')) {
      return (
        <span key={i} className="text-coral">
          {part.slice(1, -1)}
        </span>
      )
    }
    return <span key={i}>{part}</span>
  })
}

export function QuietEndorsementHero({ deal, showFreeShipping }: QuietEndorsementHeroProps) {
  const copy  = deal.quietEndorsementCopy
  if (!copy) return null

  const image = deal.images[0]
  const href  = `/products/${deal.handle}`

  const mapRestricted = deal.mapRestricted ?? (deal.mapPrice > 0 && deal.mapPrice >= deal.msrp)
  const discountPct = !mapRestricted && deal.msrp > deal.dealPrice && deal.msrp > 0
    ? Math.round(((deal.msrp - deal.dealPrice) / deal.msrp) * 100)
    : 0

  return (
    <section className="bg-cream">
      <div className="max-w-6xl mx-auto px-4 py-8 md:py-14 grid gap-6 md:grid-cols-[1.25fr_1fr] md:items-stretch">
        {/* Left — Emma says card */}
        <div className="relative bg-paper rounded-[var(--radius-lg)] p-6 md:p-10 flex flex-col gap-6 overflow-hidden">
          <span
            className="self-start inline-flex items-center gap-1 bg-sun/30 text-coral text-[11px] tracking-[0.14em] uppercase font-bold px-3 py-1.5 rounded-full"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {copy.eyebrow}
          </span>

          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="w-10 h-10 shrink-0 rounded-full bg-coral text-white flex items-center justify-center text-lg leading-none"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              E
            </span>
            <div className="flex flex-col">
              <span
                className="text-ink text-[11px] tracking-[0.22em] uppercase font-bold"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Emma says
              </span>
              <span className="text-muted text-xs italic">{copy.subhead}</span>
            </div>
          </div>

          <p
            className="text-ink text-2xl md:text-3xl leading-[1.25] italic"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {renderBodyWithHighlight(copy.body)}
          </p>

          <div className="mt-auto pt-2">
            <Link
              to={href}
              className="inline-flex items-center gap-2 bg-coral text-white font-bold px-5 py-3 rounded-full hover:bg-coral-2 transition-colors"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Show me
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>

        {/* Right — product banner */}
        <div className="relative rounded-[var(--radius-lg)] border border-line bg-cream-2 overflow-hidden flex flex-col min-h-[380px] md:min-h-0">
          <Link to={href} className="relative flex-1 block">
            {image ? (
              <img
                src={shopifyImageUrl(image.url, 1024)}
                alt={image.altText ?? deal.seoTitle}
                className="absolute inset-0 w-full h-full object-cover"
                loading="eager"
                fetchPriority="high"
              />
            ) : null}
            {discountPct > 0 && (
              <span
                className="absolute top-4 left-4 inline-flex items-center gap-1 bg-coral text-white text-[11px] tracking-[0.12em] uppercase font-bold px-3 py-1.5 rounded-full"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {discountPct}% off
              </span>
            )}
          </Link>
          <div
            className="bg-paper/80 backdrop-blur-sm border-t border-line px-5 py-4 text-center"
          >
            <h1
              className="text-ink text-xl md:text-2xl italic leading-tight"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {copy.bannerHeadline}
              {' '}
              <span className="text-coral not-italic font-bold">{fmtPrice(deal.dealPrice)}</span>
              {showFreeShipping && (
                <span className="text-ink/70 not-italic font-normal"> · free shipping</span>
              )}
            </h1>
          </div>
        </div>
      </div>
    </section>
  )
}
