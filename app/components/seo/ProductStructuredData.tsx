import type { Deal, ProductVariant } from '~/types'
import type { Editor } from '~/types/cms'

function getTodayMidnightISO(): string {
  const d = new Date()
  d.setHours(23, 59, 59, 0)
  return d.toISOString()
}

const SELLER = {
  '@type': 'Organization',
  name:    'xdipx',
  '@id':   'https://xdipx.com/#organization',
} as const

// Matches the stated FAQ policy: unopened items in original packaging within
// 30 days. Keep this in sync with app/lib/faq-content.ts, the brand
// description in app/lib/brand.ts, and the window enforced in
// app/routes/_layout.account.returns.new.tsx. returnFees is set to
// customer-responsibility (the conservative, non-overpromising default);
// change to FreeReturn only if we actually cover return shipping.
// Finite-window category requires merchantReturnDays + returnMethod +
// returnFees to validate in Google Rich Results.
const MERCHANT_RETURN_POLICY = {
  '@type':              'MerchantReturnPolicy',
  applicableCountry:    'US',
  returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
  merchantReturnDays:   30,
  returnMethod:         'https://schema.org/ReturnByMail',
  returnFees:           'https://schema.org/ReturnFeesCustomerResponsibility',
  merchantReturnLink:   'https://xdipx.com/faq',
} as const

const SHIPPING_DETAILS = {
  '@type': 'OfferShippingDetails',
  shippingRate: {
    '@type':  'MonetaryAmount',
    value:    '0.00',
    currency: 'USD',
  },
  shippingDestination: {
    '@type':         'DefinedRegion',
    addressCountry:  'US',
  },
  deliveryTime: {
    '@type':       'ShippingDeliveryTime',
    handlingTime:  { '@type': 'QuantitativeValue', minValue: 0, maxValue: 1, unitCode: 'DAY' },
    transitTime:   { '@type': 'QuantitativeValue', minValue: 3, maxValue: 7, unitCode: 'DAY' },
  },
} as const

function variantNumericId(gid: string): string {
  return gid.split('/').pop() ?? ''
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
  // Editorial authorship only — no Review schema. Emma is the seller's editor,
  // and Google treats Review nodes as user-submitted; emitting a 5/5 self-review
  // risks a structured-data manual action across the whole catalog.
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

  const priceValidUntil = getTodayMidnightISO()

  const buildVariantOffer = (v: ProductVariant) => {
    const numId = variantNumericId(v.id)
    const variantUrl = numId ? `${url}?variant=${numId}` : url
    const inStock = v.availableForSale && v.quantityAvailable > 0
    return {
      '@type':         'Offer',
      url:             variantUrl,
      priceCurrency:   'USD',
      price:           parseFloat(v.price).toFixed(2),
      priceValidUntil,
      itemCondition:   'https://schema.org/NewCondition',
      availability:    inStock
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      seller:                  SELLER,
      hasMerchantReturnPolicy: MERCHANT_RETURN_POLICY,
      shippingDetails:         SHIPPING_DETAILS,
      ...(v.quantityAvailable > 0
        ? { inventoryLevel: { '@type': 'QuantitativeValue', value: v.quantityAvailable } }
        : {}),
      ...(v.title && v.title !== 'Default Title' ? { name: v.title } : {}),
      ...(v.barcode ? { gtin: v.barcode } : {}),
    }
  }

  const variants = deal.variants ?? []
  let offers: object
  if (variants.length > 1) {
    const variantOffers = variants.map(buildVariantOffer)
    const prices = variants.map(v => parseFloat(v.price))
    offers = {
      '@type':       'AggregateOffer',
      priceCurrency: 'USD',
      lowPrice:      Math.min(...prices).toFixed(2),
      highPrice:     Math.max(...prices).toFixed(2),
      offerCount:    variants.length,
      offers:        variantOffers,
    }
  } else if (variants.length === 1 && variants[0]) {
    offers = buildVariantOffer(variants[0])
  } else {
    // Fallback for products with no variant data — use deal-level fields.
    offers = {
      '@type':         'Offer',
      url,
      priceCurrency:   'USD',
      price:           deal.dealPrice.toFixed(2),
      priceValidUntil,
      itemCondition:   'https://schema.org/NewCondition',
      availability:    deal.qty > 0
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      seller:                  SELLER,
      hasMerchantReturnPolicy: MERCHANT_RETURN_POLICY,
      shippingDetails:         SHIPPING_DETAILS,
    }
  }

  const gtin = deal.variants?.find(v => v.barcode)?.barcode

  const schema = {
    '@context':    'https://schema.org',
    '@type':       'Product',
    '@id':         `${url}#product`,
    name:          deal.seoTitle,
    description:   deal.metaDescription,
    sku:           deal.sku,
    ...(deal.nalpacSku ? { mpn: deal.nalpacSku } : {}),
    ...(gtin ? { gtin } : {}),
    brand:         { '@type': 'Brand', name: deal.brand },
    category:      deal.category,
    image:         deal.images.map(img => img.url),
    url,
    offers,
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
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}
