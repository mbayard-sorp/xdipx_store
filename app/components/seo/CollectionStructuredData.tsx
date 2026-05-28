interface CollectionItem {
  handle: string
  title:  string
  /** Absolute item URL. Defaults to the product page for this handle. */
  url?: string | null
  /** Product image URL (raw — caller should pass a reasonable size). */
  image?: string | null
  /** Numeric or string price. Required to emit Offer schema. */
  price?: number | string | null
  /** Compare-at price for sale signalling. Optional. */
  compareAtPrice?: number | string | null
  /** ISO 4217 currency code; defaults to USD. */
  currency?: string | null
  /** Defaults to InStock when omitted. */
  availability?: 'InStock' | 'OutOfStock' | 'PreOrder'
  /** Optional brand/vendor for richer Product schema. */
  brand?: string | null
}

interface CollectionStructuredDataProps {
  name:         string
  description:  string
  url:          string
  items:        CollectionItem[]
  /** Total products in the collection (across all pages). Defaults to items.length. */
  numberOfItems?: number
}

const PRODUCT_BASE = 'https://xdipx.com/products'

function toOffer(item: CollectionItem) {
  const price = item.price
  if (price == null || price === '') return null
  const priceStr = typeof price === 'number' ? price.toFixed(2) : String(price)
  const offer: Record<string, unknown> = {
    '@type':         'Offer',
    price:           priceStr,
    priceCurrency:   item.currency ?? 'USD',
    availability:    `https://schema.org/${item.availability ?? 'InStock'}`,
    url:             `${PRODUCT_BASE}/${item.handle}`,
  }
  return offer
}

export function CollectionStructuredData({
  name, description, url, items, numberOfItems,
}: CollectionStructuredDataProps) {
  const schema = {
    '@context': 'https://schema.org',
    '@type':   'CollectionPage',
    name,
    description,
    url,
    mainEntity: {
      '@type': 'ItemList',
      name,
      numberOfItems: numberOfItems ?? items.length,
      itemListElement: items.map((item, i) => {
        const itemUrl = item.url ?? `${PRODUCT_BASE}/${item.handle}`
        // Only emit a nested Product when we have a real Offer. Google
        // rejects Product snippets lacking offers/aggregateRating/review,
        // so image-only items (e.g. the collections hub listing shelves)
        // fall back to a plain ListItem (name + url) — still valid schema.
        const offer = toOffer(item)
        const productNode = offer
          ? {
              '@type': 'Product',
              name:    item.title,
              url:     itemUrl,
              ...(item.image ? { image: item.image } : {}),
              ...(item.brand ? { brand: { '@type': 'Brand', name: item.brand } } : {}),
              offers:  offer,
            }
          : null

        return productNode
          ? { '@type': 'ListItem', position: i + 1, item: productNode }
          : {
              '@type':  'ListItem',
              position: i + 1,
              name:     item.title,
              url:      itemUrl,
            }
      }),
    },
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}
