export function OrganizationStructuredData() {
  const schema = {
    '@context':   'https://schema.org',
    '@type':      'OnlineStore',
    '@id':        'https://xdipx.com/#organization',
    name:         'xdipx',
    alternateName: 'xdipx.com',
    url:          'https://xdipx.com',
    logo:         'https://xdipx.com/logo.png',
    image:        'https://xdipx.com/logo.png',
    slogan:       'Dip in. A new wellness deal every day.',
    description:  'Daily flash-sale storefront for adult wellness and intimacy products. One featured deal every day, shipped discreetly across the United States.',
    foundingDate: '2026',
    knowsAbout:   [
      'sexual wellness',
      'intimate products',
      'daily deals',
      'discreet shipping',
      'couples wellness',
    ],
    areaServed:   { '@type': 'Country', name: 'United States' },
    sameAs:       [
      'https://www.instagram.com/xdipx',
      'https://www.tiktok.com/@xdipx',
      'https://x.com/xdipx',
    ],
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
