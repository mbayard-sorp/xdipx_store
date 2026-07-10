import type { DiscoveryProduct } from '~/types/discovery'

/**
 * Minimal Product JSON-LD for the storefront (variant 'b') homepage hero
 * pick. `DiscoveryProduct` is the lean discovery-index shape (no
 * description/sku/variant-level data like the full `Deal` type PDP schema
 * uses), so this emits only the fields available at that granularity: name,
 * a generated description, image, and a single Offer. Availability falls
 * back to InStock when Shopify isn't tracking inventory for the product
 * (totalInventory === null) rather than reporting it out of stock.
 *
 * See `ProductStructuredData.tsx` for the full PDP/legacy-hero schema (which
 * needs the full `Deal` shape and isn't a fit for the discovery product
 * feeding the storefront hero).
 */
export function FeaturedProductStructuredData({ product }: { product: DiscoveryProduct }) {
  const url = `https://xdipx.com/products/${product.handle}`
  const description = product.subcategory
    ? `${product.title}, part of the ${product.subcategory} selection at xdipx.`
    : `${product.title}, part of the curated selection at xdipx.`

  const schema = {
    '@context':  'https://schema.org',
    '@type':     'Product',
    '@id':       `${url}#product`,
    name:        product.title,
    description,
    url,
    ...(product.imageUrl ? { image: [product.imageUrl] } : {}),
    offers: {
      '@type':       'Offer',
      url,
      priceCurrency: 'USD',
      price:         product.price.toFixed(2),
      itemCondition: 'https://schema.org/NewCondition',
      availability:  product.totalInventory === 0
        ? 'https://schema.org/OutOfStock'
        : 'https://schema.org/InStock',
    },
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}
