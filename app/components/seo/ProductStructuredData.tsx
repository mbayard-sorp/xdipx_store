import type { Deal } from '~/types'

function getTodayMidnightISO(): string {
  const d = new Date()
  d.setHours(23, 59, 59, 0)
  return d.toISOString()
}

export function ProductStructuredData({ deal }: { deal: Deal }) {
  const url = `https://xdipx.com/products/${deal.handle}`

  const offer = {
    '@type':         'Offer',
    url,
    priceCurrency:   'USD',
    price:           deal.dealPrice.toFixed(2),
    priceValidUntil: getTodayMidnightISO(),
    itemCondition:   'https://schema.org/NewCondition',
    availability:    deal.qty > 0
      ? 'https://schema.org/InStock'
      : 'https://schema.org/OutOfStock',
    seller: { '@type': 'Organization', name: 'xdipx', '@id': 'https://xdipx.com/#organization' },
    hasMerchantReturnPolicy: {
      '@type':                'MerchantReturnPolicy',
      applicableCountry:      'US',
      returnPolicyCategory:   'https://schema.org/MerchantReturnNotPermitted',
      merchantReturnLink:     'https://xdipx.com/faq',
    },
    shippingDetails: {
      '@type':         'OfferShippingDetails',
      shippingRate: {
        '@type':       'MonetaryAmount',
        value:         '0.00',
        currency:      'USD',
      },
      shippingDestination: {
        '@type':              'DefinedRegion',
        addressCountry:       'US',
      },
      deliveryTime: {
        '@type':               'ShippingDeliveryTime',
        handlingTime:  { '@type': 'QuantitativeValue', minValue: 0, maxValue: 1, unitCode: 'DAY' },
        transitTime:   { '@type': 'QuantitativeValue', minValue: 3, maxValue: 7, unitCode: 'DAY' },
      },
    },
  }

  const schema = {
    '@context':    'https://schema.org',
    '@type':       'Product',
    '@id':         `${url}#product`,
    name:          deal.seoTitle,
    description:   deal.metaDescription,
    sku:           deal.sku,
    ...(deal.nalpacSku ? { mpn: deal.nalpacSku } : {}),
    brand:         { '@type': 'Brand', name: deal.brand },
    category:      deal.category,
    image:         deal.images.map(img => img.url),
    url,
    offers:        offer,
    ...(deal.rating && deal.rating.count > 0 ? {
      aggregateRating: {
        '@type':      'AggregateRating',
        ratingValue:  deal.rating.value,
        reviewCount:  deal.rating.count,
        bestRating:   5,
        worstRating:  1,
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
