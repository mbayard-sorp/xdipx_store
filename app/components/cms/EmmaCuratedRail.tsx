// Emma-curated cross-sell rail. Mirrors ProductCarousel layout but adds an
// Emma-voice aside line above the heading. Renders only when products resolve
// (defensive — admin can add/remove handles between generation and publish).
import { ProductCarousel, railGroundClass, type StorefrontGround } from './ProductCarousel'
import type { EmmaCuratedRailBlock } from '~/types/cms'
import type { LeanCardProduct } from '~/types'

interface EmmaCuratedRailProps {
  block: EmmaCuratedRailBlock
  products: LeanCardProduct[]
  /** Per-slot v3 band tint assigned by the composing page. See
   *  `ProductCarousel`'s `ground` prop (ticket #12340). */
  ground?: StorefrontGround
}

export function EmmaCuratedRail({ block, products, ground }: EmmaCuratedRailProps) {
  if (!products.length) return null

  const bgStyle = block.bgStyle ?? 'white'
  const dark = bgStyle === 'charcoal' || bgStyle === 'purple'
  // The aside sits in its own band directly above the rail, so it has to paint
  // the SAME ground the rail resolves to, through the same resolver — it used
  // to recompute the class from `bgStyle` alone and would seam visibly against
  // any assigned `ground` (ticket #12340). It also took the legacy `px-4` +
  // `max-w-6xl` container while the storefront rail below it takes the doctrine
  // band container, so Emma's line started ~20px left of the heading it
  // introduces at 1440px and 8px left of it at 375px.
  const bgClass = railGroundClass('storefront', bgStyle, ground)

  return (
    <div className="relative">
      {block.emmaAside && (
        /* pt-16 md:pt-20, the doctrine §1 band rhythm, NOT a hand-picked
            value. This wrapper used to carry a flat `pt-10` (40px) with no
            responsive variant, so the four published aside-led rails opened
            45px below their ground boundary at every width while every other
            band on the page opened at 68px (375) / 84px (768 and 1440):
            off the 64/80 scale AND breakpoint-deaf. Measured at all three
            viewports by the design-critic gate, Routine B run 1571.
            This is ticket #8418's defect one level up: that ticket moved the
            RAIL off the legacy py-12 and onto the doctrine rhythm, and the
            aside band added later by #12340 arrived with a fresh off-scale
            value. The rail's own `py-16 md:py-20` below still supplies the
            gap between this line and the heading it introduces, so this
            changes where the band OPENS and nothing else. */
        <div className={`${bgClass} pt-16 md:pt-20`}>
          <div className="mx-auto max-w-[1320px] px-6 md:px-16">
            <p
              // max-w-[46ch] (ticket #14124): matches the hero body's measure
              // cap. Without it this line takes the full 1320px band container
              // (minus padding), which design-doctrine.md section 2 caps body
              // text at ~60ch — measured live at ~175 characters per line
              // across four published rails before this fix.
              className={`max-w-[46ch] text-sm italic ${dark ? 'text-white/70' : 'text-ink-3'}`}
              style={{ fontFamily: 'var(--font-body)' }}
            >
              ♥ <span>{block.emmaAside}</span>
            </p>
          </div>
        </div>
      )}
      <ProductCarousel
        chrome="storefront"
        heading={block.heading}
        {...(ground !== undefined ? { ground } : {})}
        {...(block.eyebrow  !== undefined ? { eyebrow:  block.eyebrow }  : {})}
        {...(block.ctaLink  !== undefined ? { ctaLink:  block.ctaLink }  : {})}
        {...(block.ctaLabel !== undefined ? { ctaLabel: block.ctaLabel } : {})}
        {...(block.bgStyle  !== undefined ? { bgStyle:  block.bgStyle }  : {})}
        {...(block.layout   !== undefined ? { layout:   block.layout }   : {})}
        products={products}
      />
    </div>
  )
}
