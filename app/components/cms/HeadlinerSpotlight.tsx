/**
 * 1a — Headliner spotlight.
 *
 * The page's ONE primary CTA. Image is the LCP candidate — renders
 * immediately, never wrapped in a reveal, never animated. Copy column reveals
 * fade/up 240ms only when below the fold (handled by ContentBlockRenderer,
 * which never wraps this whole block since 1a is NO_REVEAL — see below).
 *
 * Shell: layout, kicker format, CTA style. Slots: product ref, image,
 * headline, callout, CTA label (whitelist), edition number.
 */

import { Link } from 'react-router'
import { OptimizedImage } from '~/components/store/OptimizedImage'
import type { HeadlinerSpotlightBlock, SanityImageAsset } from '~/types/cms'
import type { Product, ProductImage } from '~/types'

const MONO = { fontFamily: 'var(--font-mono)' } as const
const DISPLAY = { fontFamily: 'var(--font-display)', fontWeight: 450 } as const
const DISPLAY_ITALIC = { fontFamily: 'var(--font-display)', fontStyle: 'italic' } as const
const BODY = { fontFamily: 'var(--font-body)' } as const

const CTA_WHITELIST = ['Take a peek →', 'Show me', 'Find your fit →', "I'll take it ♥"]

function fmt(n: number): string {
  return `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`
}

interface HeadlinerSpotlightProps {
  block: HeadlinerSpotlightBlock
  product: Product | null
}

export function HeadlinerSpotlight({ block, product }: HeadlinerSpotlightProps) {
  // Missing product entirely: nothing to spotlight, don't render a dead CTA.
  if (!product) return null

  const kicker = block.kicker || 'This week'
  const headline = block.headline || 'A pick worth a proper look.'
  const emphasis = block.emphasisWord
  const headlineParts = emphasis && headline.includes(emphasis)
    ? headline.split(emphasis)
    : [headline, '']

  const price = block.priceOverride ?? product.price
  const callout = block.mechanismCallout
  const ctaLabel = block.headlinerCtaLabel && CTA_WHITELIST.includes(block.headlinerCtaLabel)
    ? block.headlinerCtaLabel
    : 'Take a peek →'
  const ctaLink = block.headlinerCtaLink || `/products/${product.handle}`
  // Normalize the two possible image shapes (Sanity's { url, alt } vs
  // Shopify's { url, altText }) into one before use.
  const rawImage: SanityImageAsset | ProductImage | undefined =
    block.headlinerImage?.url ? block.headlinerImage : product.images[0]
  const image = rawImage?.url
    ? { url: rawImage.url, alt: 'altText' in rawImage ? rawImage.altText : rawImage.alt }
    : null

  return (
    <section className="bg-paper">
      <div className="mx-auto grid max-w-[1320px] md:grid-cols-[5fr_7fr] md:items-stretch md:min-h-[460px]">
        {/* Copy column — desktop: left. Mobile: below the image. */}
        <div className="order-2 flex flex-col gap-3.5 px-5 pb-7 pt-6 md:order-1 md:justify-center md:gap-4 md:px-10 md:py-12">
          <p className="text-[11px] uppercase tracking-[0.18em] text-ink-4" style={MONO}>
            {kicker}
          </p>
          <h2
            className="text-[34px] leading-[1.12] tracking-[-0.01em] text-ink line-clamp-3 md:text-[44px] md:leading-[1.08] md:tracking-[-0.015em]"
            style={DISPLAY}
          >
            {headlineParts[0]}
            {emphasis && <em className="em">{emphasis}</em>}
            {headlineParts[1]}
          </h2>
          <p className="text-[14px] md:text-[15px]" style={BODY}>
            <span className="text-ink-3">{product.title}</span>{' '}
            <span className="font-semibold text-ink">{fmt(price)}</span>
          </p>
          {callout && (
            <p
              className="max-w-[280px] border-t border-plum pt-2 text-[15px] text-plum md:text-[16px]"
              style={DISPLAY_ITALIC}
            >
              {callout}
            </p>
          )}
          <Link
            to={ctaLink}
            className="press mt-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-coral px-[26px] py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-coral-2 active:bg-plum-2"
            style={BODY}
          >
            {ctaLabel.endsWith('→') ? (
              <>
                {ctaLabel.slice(0, -1).trimEnd()} <span aria-hidden="true">→</span>
              </>
            ) : (
              ctaLabel
            )}
          </Link>
        </div>

        {/* Image column — LCP, renders immediately, never a Reveal. */}
        <div className="order-1 md:order-2">
          <div className="relative flex aspect-[4/5] w-full items-end justify-center bg-coral-soft p-3 md:h-full md:min-h-[460px]">
            {image?.url ? (
              <OptimizedImage
                src={image.url}
                alt={image.alt ?? product.title}
                priority
                sizes="(max-width: 768px) 100vw, 58vw"
                className="h-full w-full object-contain"
              />
            ) : (
              <p
                className="w-full text-center text-[15vw] leading-none text-ink/15 md:text-[6vw]"
                style={DISPLAY}
                aria-hidden="true"
              >
                {product.title}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
