/**
 * Rail product card. Links to /products/{handle}.
 * Image fallback: cream-2 tile with ♥ glyph.
 * On click: trackSelectItem with list metadata.
 */

import { Link } from 'react-router'
import { trackSelectItem } from '~/lib/analytics.client'
import { OptimizedImage } from '~/components/store/OptimizedImage'
import { abbreviate, buildPieGradient } from '~/components/store/CircleOptionSelector'
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
      className="group block rounded-[var(--radius)] overflow-hidden bg-paper border border-line hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(26,20,24,0.08)] transition-[transform,box-shadow] duration-200"
      aria-label={product.title}
    >
      {/* Image / fallback */}
      <div className="aspect-[4/5] bg-paper-3 relative overflow-hidden">
        {product.imageUrl ? (
          <OptimizedImage
            src={product.imageUrl}
            alt={product.imageAlt ?? product.title}
            className="w-full h-full object-cover"
            sizes="(min-width: 768px) 20vw, 45vw"
            widths={[240, 360, 480]}
            fallbackWidth={480}
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
          className="text-xs text-ink-3 uppercase tracking-wider truncate"
          style={{ fontFamily: 'var(--font-body)', letterSpacing: '0.1em' }}
        >
          {product.subcategory}
        </p>
        <p
          className="text-[15px] text-ink leading-snug line-clamp-2"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
        >
          {product.title}
        </p>
        {/* Price + savings — mirrors the PLP VaultCard. Range products show
            "$min–$max" and skip the flat-savings line; single-price products
            show the struck compare-at + "You save $X (Y%)". */}
        {(() => {
          const { price, priceMax, compareAtPrice, colorValues, sizeValues } = product
          const hasRange = priceMax != null && priceMax > price
          // Struck price whenever there's any markdown; "You save" line only when
          // the rounded discount is ≥ 1% (mirrors VaultCard — avoids "$0.01 (0%)").
          const hasCompare = !hasRange && compareAtPrice != null && compareAtPrice > price
          const save = hasCompare ? compareAtPrice! - price : 0
          const pct = hasCompare ? Math.round((save / compareAtPrice!) * 100) : 0
          const showSaveLine = hasCompare && pct > 0

          const colors = colorValues.length > 1 ? colorValues : null
          const sizes = sizeValues.length > 1 ? sizeValues : null
          const sizeLabel = sizes
            ? sizes.length > 2
              ? `${sizes.length} sizes`
              : sizes.map(v => abbreviate(v)).join(' / ')
            : null

          return (
            <>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span
                  className="text-sm font-semibold text-coral"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {hasRange
                    ? `$${price.toFixed(2)}–$${priceMax!.toFixed(2)}`
                    : `$${price.toFixed(2)}`}
                </span>
                {hasCompare && (
                  <span className="text-ink/40 text-xs line-through">
                    ${compareAtPrice!.toFixed(2)}
                  </span>
                )}
              </div>
              {(showSaveLine || colors || sizeLabel) && (
                <div className="flex items-center gap-2 mt-1">
                  {showSaveLine && (
                    <span className="text-ink/70 text-[11px] whitespace-nowrap">
                      You save ${save.toFixed(2)} ({pct}%)
                    </span>
                  )}
                  {(colors || sizeLabel) && (
                    <span aria-hidden="true" className="ml-auto flex items-center gap-1.5 shrink-0">
                      {colors && (
                        <span
                          className="block h-4 w-4 rounded-full border border-ink/80 shadow-sm"
                          style={{ background: buildPieGradient(colors) }}
                        />
                      )}
                      {sizeLabel && (
                        <span
                          className="inline-flex items-center justify-center h-4 px-1.5 rounded-full bg-paper border border-ink/80 text-[8px] font-bold tracking-wide text-ink whitespace-nowrap"
                          style={{ fontFamily: 'var(--font-display)' }}
                        >
                          {sizeLabel}
                        </span>
                      )}
                    </span>
                  )}
                </div>
              )}
            </>
          )
        })()}
      </div>
    </Link>
  )
}
