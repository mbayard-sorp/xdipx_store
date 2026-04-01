import type { Deal } from '~/types'

function getTodayMidnightISO(): string {
  const d = new Date()
  d.setHours(23, 59, 59, 0)
  return d.toISOString()
}

export function ProductStructuredData({ deal }: { deal: Deal }) {
  const schema = {
    '@context': 'https://schema.org',
    '@type':    'Product',
    name:        deal.seoTitle,
    description: deal.metaDescription,
    sku:         deal.sku,
    brand:       { '@type': 'Brand', name: deal.brand },
    image:       deal.images.map(img => img.url),
    offers: {
      '@type':           'Offer',
      url:               `https://xdipx.com/products/${deal.handle}`,
      priceCurrency:     'USD',
      price:             deal.dealPrice.toFixed(2),
      priceValidUntil:   getTodayMidnightISO(),
      itemCondition:     'https://schema.org/NewCondition',
      availability:      deal.qty > 0
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
    },
    ...(deal.rating && deal.rating.count > 0 ? {
      aggregateRating: {
        '@type':      'AggregateRating',
        ratingValue:  deal.rating.value,
        reviewCount:  deal.rating.count,
      },
    } : {}),
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}
