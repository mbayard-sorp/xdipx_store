import { Link } from 'react-router'
import type { HeroVideo, ProductImage } from '~/types'
import { HeartButton } from './HeartButton'
import { CardVideo } from './CardVideo'
import { shopifyImageUrl, shopifyImageSrcSet } from '~/lib/shopify-image'

interface ProductCardProps {
  id:         string
  handle:     string
  title:      string
  brand?:     string
  price:      number
  compareAt?: number
  image?:     ProductImage
  heroVideo?: HeroVideo
  /** Optional coral "Editor's pick" / "New" pill, top-left. */
  badge?:     string
}

export function ProductCard({
  id, handle, title, brand, price, compareAt, image, heroVideo, badge,
}: ProductCardProps) {
  const discount = compareAt && compareAt > price
    ? Math.round(((compareAt - price) / compareAt) * 100)
    : 0

  return (
    <article className="bg-paper rounded-2xl overflow-hidden shadow-sm card-lift group relative">
      {badge && (
        <span
          className="absolute top-3 left-3 z-10 bg-coral text-white text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {badge}
        </span>
      )}
      <HeartButton
        shopifyProductId={id}
        handle={handle}
        productTitle={title}
        price={price}
        variant="overlay"
        size="sm"
      />
      <Link to={`/products/${handle}`} className="press block">
        <div className="aspect-[4/5] bg-cream-2 overflow-hidden relative">
          {heroVideo?.src ? (
            <CardVideo cardId={id} video={heroVideo} title={title} />
          ) : image ? (
            <img
              src={shopifyImageUrl(image.url, 480) || image.url}
              srcSet={shopifyImageSrcSet(image.url, [240, 360, 480, 720])}
              sizes="(min-width: 768px) 25vw, 50vw"
              alt={image.altText || title}
              className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-300"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-ink/10 text-5xl">♥</div>
          )}
        </div>

        <div className="p-4">
          {brand && (
            <p className="text-muted text-[10px] uppercase tracking-wider mb-1">{brand}</p>
          )}
          <h3
            className="font-semibold text-ink text-sm leading-snug line-clamp-2 group-hover:text-coral transition-colors"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {title}
          </h3>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-coral font-bold">${price.toFixed(2)}</span>
            {compareAt && compareAt > price && (
              <span className="text-ink/40 text-sm line-through">${compareAt.toFixed(2)}</span>
            )}
            {discount > 0 && (
              <span className="text-coral text-xs font-semibold">{discount}% off</span>
            )}
          </div>
        </div>
      </Link>
    </article>
  )
}
