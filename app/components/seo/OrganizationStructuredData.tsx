import { BRAND_DESCRIPTION, BRAND_TITLE } from '~/lib/brand'

interface OrganizationStructuredDataProps {
  sameAs?: string[]
}

export function OrganizationStructuredData({ sameAs = [] }: OrganizationStructuredDataProps) {
  const schema = {
    '@context':   'https://schema.org',
    '@type':      'OnlineStore',
    '@id':        'https://xdipx.com/#organization',
    name:         BRAND_TITLE,
    alternateName: 'xdipx.com',
    url:          'https://xdipx.com',
    logo: {
      '@type': 'ImageObject',
      url:     'https://xdipx.com/og/logo-square.png',
      width:   600,
      height:  600,
    },
    image:        'https://xdipx.com/og/logo-square.png',
    // Slogan is brand-voice neutral by design — CLAUDE.md says the UI
    // never surfaces a daily/midnight cadence, and the same discipline
    // applies to brand copy that ends up in Google's knowledge panel.
    slogan:       'Sexual wellness, edited.',
    description:  BRAND_DESCRIPTION,
    foundingDate: '2026',
    knowsAbout:   [
      'sexual wellness',
      'intimate products',
      'curated wellness',
      'discreet shipping',
      'couples wellness',
    ],
    areaServed:   { '@type': 'Country', name: 'United States' },
    sameAs,
    contactPoint: {
      '@type':      'ContactPoint',
      contactType:  'customer service',
      email:        'hello@xdipx.com',
      availableLanguage: ['English'],
    },
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}
