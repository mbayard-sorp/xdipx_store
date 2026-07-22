// Emma-curated cross-sell rail. Mirrors ProductCarousel layout but adds an
// Emma-voice aside line above the heading. Renders only when products resolve
// (defensive — admin can add/remove handles between generation and publish).
import { ProductCarousel } from './ProductCarousel'
import type { EmmaCuratedRailBlock } from '~/types/cms'
import type { LeanCardProduct } from '~/types'

interface EmmaCuratedRailProps {
  block: EmmaCuratedRailBlock
  products: LeanCardProduct[]
}

export function EmmaCuratedRail({ block, products }: EmmaCuratedRailProps) {
  if (!products.length) return null

  const dark = block.bgStyle === 'charcoal' || block.bgStyle === 'purple'

  return (
    <div className="relative">
      {block.emmaAside && (
        <div className={`${block.bgStyle === 'charcoal' || block.bgStyle === 'purple' ? 'bg-ink' : block.bgStyle === 'cream' ? 'bg-cream' : block.bgStyle === 'mist' ? 'bg-cream-2' : 'bg-white'} pt-10 px-4`}>
          <div className="max-w-6xl mx-auto">
            <p
              className={`text-sm italic ${dark ? 'text-white/70' : 'text-muted'}`}
              style={{ fontFamily: 'var(--font-body)' }}
            >
              ♥ <span>{block.emmaAside}</span>
            </p>
          </div>
        </div>
      )}
      <ProductCarousel
        heading={block.heading}
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
