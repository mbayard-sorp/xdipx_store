import { useRef } from 'react'
import { Link } from 'react-router'
import type { LeanCardProduct } from '~/types'
import type { ProductCarouselBlock } from '~/types/cms'
import ProductTileMedia from '~/components/store/ProductTileMedia'
import { Reveal } from '~/components/motion/Reveal'

interface ProductCarouselProps {
  block?: ProductCarouselBlock
  // Direct props for the hardcoded ForHim/ForHer sections
  heading?: string
  eyebrow?: string
  ctaLink?: string
  ctaLabel?: string
  bgStyle?: 'white' | 'mist' | 'cream' | 'charcoal' | 'purple'
  layout?: 'carousel' | 'grid' | 'grid-3'
  /**
   * Card chrome. `'legacy'` (default) keeps the pre-redesign v2 card treatment
   * used by the deferred daily-deal home's ForHim/ForHer rails and legacy
   * `productCarousel` blocks. `'storefront'` applies the v3 token set (locked
   * 22px `--radius-lg`, hairline `border-line`, paper ground, no drop-shadow)
   * so an `emmaCuratedRail` on the new storefront matches every other card on
   * the page instead of rendering the stale v2 chrome (rounded-2xl 16px +
   * shadow + near-invisible border-cream-2). See `EmmaCuratedRail`.
   */
  chrome?: 'legacy' | 'storefront'
  products: LeanCardProduct[]
}

const BG_CLASSES: Record<string, string> = {
  white:    'bg-white',
  cream:    'bg-cream',
  mist:     'bg-cream-2',
  charcoal: 'bg-ink',
  purple:   'bg-sage',
}

function isDark(bg: string) {
  return bg === 'charcoal' || bg === 'purple'
}

export function ProductCarousel({
  block,
  heading: headingProp,
  eyebrow: eyebrowProp,
  ctaLink: ctaLinkProp,
  ctaLabel: ctaLabelProp,
  bgStyle: bgStyleProp,
  layout: layoutProp,
  chrome = 'legacy',
  products,
}: ProductCarouselProps) {
  const heading  = block?.heading  ?? headingProp  ?? 'Products'
  const eyebrow  = block?.eyebrow  ?? eyebrowProp
  const ctaLink  = block?.ctaLink  ?? ctaLinkProp
  const ctaLabel = block?.ctaLabel ?? ctaLabelProp ?? 'See all →'
  const bgStyle  = block?.bgStyle  ?? bgStyleProp  ?? 'white'
  const layout   = block?.layout   ?? layoutProp   ?? 'carousel'

  const scrollRef = useRef<HTMLDivElement>(null)

  if (!products.length) return null

  const bgClass = BG_CLASSES[bgStyle] ?? 'bg-white'
  const dark = isDark(bgStyle)
  // Light-mode scroll-arrow border: the legacy `border-cream-2` (#FAFAF9) is a
  // near-invisible hairline on the paper ground; the storefront chrome uses the
  // real `border-line` hairline the rest of the v3 surface uses.
  const lightArrow =
    chrome === 'storefront'
      ? 'border-line bg-paper text-ink hover:border-sage hover:text-sage'
      : 'border-cream-2 bg-white text-ink hover:border-sage hover:text-sage'

  function scroll(dir: 'left' | 'right') {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir === 'left' ? -280 : 280, behavior: 'smooth' })
  }

  return (
    <section className={`py-12 px-4 ${bgClass}`}>
      <div className="max-w-6xl mx-auto">
        {/* Header — flex-wrap + gap so the CTA drops onto its own row instead of
            colliding with the heading at narrow widths (390px / the 375px floor);
            min-w-0 lets the heading column shrink, shrink-0 + whitespace-nowrap
            keep the CTA a single unbroken line (ticket #468). */}
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div className="min-w-0 flex-1">
            {eyebrow && (
              <Reveal as="p" variant="up" index={0} className={`text-xs font-semibold uppercase tracking-[0.18em] mb-1 ${dark ? 'text-white/60' : 'text-ink-3'}`}>
                {eyebrow}
              </Reveal>
            )}
            <Reveal
              as="h2"
              variant="up"
              index={1}
              className={`text-2xl font-bold ${dark ? 'text-white' : 'text-ink'}`}
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {heading}
            </Reveal>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Arrow buttons — carousel only, desktop only */}
            {layout === 'carousel' && (
              <>
                <button
                  onClick={() => scroll('left')}
                  aria-label="Scroll left"
                  className={`hidden sm:flex items-center justify-center w-9 h-9 rounded-full border transition-colors shadow-sm ${
                    dark
                      ? 'border-white/20 bg-white/10 text-white hover:border-white/40 hover:text-white'
                      : lightArrow
                  }`}
                >
                  ←
                </button>
                <button
                  onClick={() => scroll('right')}
                  aria-label="Scroll right"
                  className={`hidden sm:flex items-center justify-center w-9 h-9 rounded-full border transition-colors shadow-sm ${
                    dark
                      ? 'border-white/20 bg-white/10 text-white hover:border-white/40 hover:text-white'
                      : lightArrow
                  }`}
                >
                  →
                </button>
              </>
            )}
            {ctaLink && (
              <Link
                to={ctaLink}
                className={`text-sm font-semibold transition-colors ml-1 shrink-0 whitespace-nowrap ${
                  dark
                    ? 'text-white/80 hover:text-white'
                    : 'text-plum hover:text-plum-2'
                }`}
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {ctaLabel}
              </Link>
            )}
          </div>
        </div>

        {/* Product grid or carousel */}
        {layout === 'carousel' ? (
          // Reveal the rail as one unit — per-item scroll reveal fights the
          // horizontal scroll-snap, so the container fades/slides in once.
          <Reveal variant="up">
            <div
              ref={scrollRef}
              className="flex gap-4 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-2"
            >
              {products.map(product => (
                <ProductCard key={product.id} product={product} chrome={chrome} className="shrink-0 w-52 sm:w-60 snap-start" />
              ))}
            </div>
          </Reveal>
        ) : (
          <div
            className={
              layout === 'grid-3'
                ? 'grid grid-cols-2 md:grid-cols-3 gap-4'
                : 'grid grid-cols-2 md:grid-cols-4 gap-4'
            }
          >
            {products.map((product, i) => (
              <Reveal key={product.id} variant="up" index={i}>
                <ProductCard product={product} chrome={chrome} />
              </Reveal>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function ProductCard({
  product,
  className = '',
  chrome = 'legacy',
}: {
  product: LeanCardProduct
  className?: string
  chrome?: 'legacy' | 'storefront'
}) {
  const price   = product.price
  const compare = product.compareAtPrice
  const onSale  = compare != null && compare > price
  const firstImage = product.images[0]
  const firstVideo = product.videos?.[0]
  const videoSrc = firstVideo?.sources?.[0]?.url
  const video = firstVideo && videoSrc
    ? { previewUrl: firstVideo.previewImageUrl, src: videoSrc }
    : null

  // Storefront chrome uses the locked v3 tokens (22px `--radius-lg`, hairline
  // `border-line`, paper ground) and drops the drop-shadow / `card-lift` hover
  // shadow, so the card matches `StorefrontProductCard` and the no-shadow
  // discipline. Legacy chrome is byte-identical to the pre-redesign card.
  const articleClass =
    chrome === 'storefront'
      ? 'bg-paper-2 rounded-[var(--radius-lg)] overflow-hidden border border-line h-full'
      : 'bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg hover:shadow-sage/10 transition-all duration-300 card-lift h-full'
  const imageBgClass = chrome === 'storefront' ? 'bg-paper-2' : 'bg-cream-2'

  return (
    <Link
      to={`/products/${product.handle}`}
      className={`group ${className}`}
    >
      <article className={articleClass}>
        <div className={`relative aspect-square ${imageBgClass} overflow-hidden`}>
          {firstImage ? (
            <ProductTileMedia
              imageUrl={firstImage.url}
              imageAlt={firstImage.altText || product.title}
              video={video}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-ink/10 text-4xl">
              ♥
            </div>
          )}
          {/* Ink, not coral: the coral budget reserves coral for the one primary
              CTA per viewport; stacked coral SALE badges read as a discount wall
              (design-critic REVISE finding, 2026-07-20). */}
          {onSale && (
            <span className="absolute top-2 left-2 bg-ink text-paper text-xs font-bold px-2 py-0.5 rounded-full z-10">
              SALE
            </span>
          )}
        </div>
        <div className="p-4">
          <p className="text-ink/50 text-xs">{product.brand}</p>
          <p
            className="font-semibold text-ink text-sm mt-0.5 line-clamp-2 group-hover:text-coral transition-colors"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {product.title}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-ink font-bold text-sm">${price.toFixed(2)}</span>
            {onSale && (
              <span className="text-ink/40 text-xs line-through">${compare!.toFixed(2)}</span>
            )}
          </div>
        </div>
      </article>
    </Link>
  )
}
