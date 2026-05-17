/**
 * Rail product card. Links to /products/{handle}.
 * Image fallback: cream-2 tile with ♥ glyph.
 * On click: trackSelectItem with list metadata.
 */

import { Link } from 'react-router'
import { trackSelectItem } from '~/lib/analytics.client'
import type { DiscoveryProduct } from '~/types/discovery'

interface ProductCardProps {
  product: DiscoveryProduct
  index: number
  listId: string
  listName: string
}

export function ProductCard({ product, index, listId, listName }: ProductCardProps) {
  function handleClick() {
    trackSelectItem(listId, listName, {
      item_id:        product.id,
      item_name:      product.title,
      item_category:  product.category,
      price:          product.price,
      item_list_id:   listId,
      item_list_name: listName,
    }, index)
  }

  return (
    <Link
      to={`/products/${product.handle}`}
      onClick={handleClick}
      className="group block rounded-[var(--radius)] overflow-hidden bg-paper hover:-translate-y-0.5 transition-transform duration-200"
      aria-label={product.title}
    >
      {/* Image / fallback */}
      <div className="aspect-square bg-cream-2 relative overflow-hidden">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.imageAlt ?? product.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-3xl text-sage/50 select-none" aria-hidden="true">♥</span>
          </div>
        )}
      </div>

      {/* Text */}
      <div className="p-3 flex flex-col gap-0.5">
        <p
          className="text-xs text-muted uppercase tracking-wider truncate"
          style={{ fontFamily: 'var(--font-body)', letterSpacing: '0.1em' }}
        >
          {product.subcategory}
        </p>
        <p
          className="text-sm font-bold text-ink leading-snug line-clamp-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {product.title}
        </p>
        <p
          className="text-sm font-semibold text-coral mt-0.5"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          ${product.price.toFixed(2)}
        </p>
      </div>
    </Link>
  )
}
