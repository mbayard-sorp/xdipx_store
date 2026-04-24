import type { Deal } from '~/types'
import type { Editor } from '~/types/cms'

function getTodayMidnightISO(): string {
  const d = new Date()
  d.setHours(23, 59, 59, 0)
  return d.toISOString()
}

function stripHtml(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function ProductStructuredData({
  deal,
  editor = null,
}: {
  deal: Deal
  editor?: Editor | null
}) {
  const url = `https://xdipx.com/products/${deal.handle}`
  const emmaId = 'https://xdipx.com/about#emma'
  const emmaPerson = editor
    ? {
        '@type':  'Person',
        '@id':    emmaId,
        name:     editor.name,
        ...(editor.photoUrl ? { image: editor.photoUrl } : {}),
        url:      'https://xdipx.com/about',
        jobTitle: editor.role,
        worksFor: { '@type': 'Organization', '@id': 'https://xdipx.com/#organization' },
      }
    : null
  const reviewBody = stripHtml(deal.fullStory) || deal.tagline || ''
  const emmaReview = emmaPerson && reviewBody
    ? {
        '@type':      'Review',
        author:       { '@type': 'Person', '@id': emmaId },
        datePublished: deal.dealDate,
        reviewBody,
        reviewRating: { '@type': 'Rating', ratingValue: 5, bestRating: 5 },
        name:         `Why I picked ${deal.seoTitle}`,
      }
    : null

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
    ...(emmaPerson ? { author: emmaPerson, reviewedBy: { '@type': 'Person', '@id': emmaId } } : {}),
    ...(emmaReview ? { review: emmaReview } : {}),
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}
