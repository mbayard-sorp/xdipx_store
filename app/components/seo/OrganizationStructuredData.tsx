export function OrganizationStructuredData() {
  const schema = {
    '@context': 'https://schema.org',
    '@type':    'Organization',
    name:       'xdipx',
    url:        'https://xdipx.com',
    logo:       'https://xdipx.com/logo.png',
    description: 'Daily flash deals on sexual wellness products. One featured deal every day, shipped discreetly.',
    contactPoint: {
      '@type':       'ContactPoint',
      contactType:   'customer service',
      email:         'hello@xdipx.com',
    },
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}
