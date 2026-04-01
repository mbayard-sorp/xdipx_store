import { useFetcher } from 'react-router'
import { useEffect, useState } from 'react'
import type { Product } from '~/types'

interface AccessoryCardProps {
  product: Product
  cartId?: string
}

export function AccessoryCard({ product, cartId }: AccessoryCardProps) {
  const fetcher = useFetcher()
  const [added, setAdded] = useState(false)
  const isPending = fetcher.state !== 'idle'

  useEffect(() => {
    if (fetcher.data && (fetcher.data as { ok?: boolean }).ok) setAdded(true)
  }, [fetcher.data])

  const variant  = product.variants[0]
  const imgUrl   = product.images[0]?.url ?? ''
  const price    = product.price
  const compare  = product.compareAtPrice

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm card-lift flex gap-4 items-start">
      {/* Image */}
      {imgUrl && (
        <img
          src={imgUrl}
          alt={product.images[0]?.altText ?? product.title}
          className="w-20 h-20 object-cover rounded-xl shrink-0"
          loading="lazy"
        />
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-brand-charcoal/50 mb-0.5">{product.brand}</p>
        <p
          className="font-semibold text-brand-charcoal text-sm leading-snug line-clamp-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {product.title}
        </p>

        <div className="flex items-center gap-2 mt-1">
          <span className="text-brand-gradient font-bold text-sm">${price.toFixed(2)}</span>
          {compare && compare > price && (
            <span className="text-brand-charcoal/40 text-xs line-through">${compare.toFixed(2)}</span>
          )}
        </div>
      </div>

      {/* Add button */}
      <fetcher.Form method="post">
        <input type="hidden" name="intent"    value="add-accessory" />
        <input type="hidden" name="variantId" value={variant?.id ?? ''} />
        {cartId && <input type="hidden" name="cartId" value={cartId} />}
        <button
          type="submit"
          disabled={isPending || added || !variant?.availableForSale}
          className={[
            'shrink-0 text-xs font-bold px-3 py-1.5 rounded-full transition-all',
            added
              ? 'bg-brand-mist text-brand-purple'
              : 'bg-brand-gradient text-white hover:opacity-90 disabled:opacity-50',
          ].join(' ')}
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {added ? 'Added ♥' : isPending ? '...' : '+ Add'}
        </button>
      </fetcher.Form>
    </div>
  )
}
