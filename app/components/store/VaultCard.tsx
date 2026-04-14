import { Link } from 'react-router'
import type { VaultDeal } from '~/types'
import { WaitlistButton } from './WaitlistButton'
import { HeartButton } from './HeartButton'

interface VaultCardProps {
  deal: VaultDeal
}

export function VaultCard({ deal }: VaultCardProps) {
  const discount = deal.msrp > 0
    ? Math.round(((deal.msrp - deal.dealPrice) / deal.msrp) * 100)
    : 0

  return (
    <article className="bg-white rounded-2xl overflow-hidden shadow-sm card-lift group relative">
      <HeartButton
        shopifyProductId={deal.id}
        handle={deal.handle}
        productTitle={deal.seoTitle}
        price={deal.dealPrice}
        variant="overlay"
        size="sm"
      />
      <Link to={`/products/${deal.handle}`} className="block">
        <div className="aspect-square overflow-hidden bg-brand-mist relative">
          {deal.images[0] ? (
            <img
              src={deal.images[0].url}
              alt={deal.images[0].altText || deal.seoTitle}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-brand-charcoal/10 text-5xl">♥</div>
          )}
        </div>

        <div className="p-4">
          <p className="text-brand-charcoal/50 text-xs uppercase tracking-wide mb-1">{deal.brand}</p>
          <h3
            className="font-semibold text-brand-charcoal text-sm leading-snug line-clamp-2 group-hover:text-brand-coral transition-colors"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {deal.seoTitle}
          </h3>

          <div className="flex items-center gap-2 mt-2">
            <span className="text-brand-gradient font-bold">${deal.dealPrice.toFixed(2)}</span>
            {deal.msrp > deal.dealPrice && (
              <span className="text-brand-charcoal/40 text-sm line-through">${deal.msrp.toFixed(2)}</span>
            )}
            {discount > 0 && (
              <span className="text-brand-coral text-xs font-semibold">{discount}% off</span>
            )}
          </div>
        </div>
      </Link>

      {/* Availability + waitlist */}
      <div className="px-4 pb-4">
        {deal.qty > 5 ? (
          <span className="text-xs text-green-600 font-medium flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            In Stock
          </span>
        ) : deal.qty > 0 ? (
          <span className="text-xs text-yellow-600 font-medium flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-yellow-500" />
            Low Stock
          </span>
        ) : (
          <WaitlistButton productHandle={deal.handle} />
        )}
      </div>
    </article>
  )
}
