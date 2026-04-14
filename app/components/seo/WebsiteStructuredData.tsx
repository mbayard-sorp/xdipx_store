export function WebsiteStructuredData() {
  const schema = {
    '@context': 'https://schema.org',
    '@type':    'WebSite',
    name:       'xdipx',
    url:        'https://xdipx.com',
    potentialAction: {
      '@type':       'SearchAction',
      target: {
        '@type':    'EntryPoint',
        urlTemplate: 'https://xdipx.com/search?q={search_term_string}',
      },
      'query-input': 'required name=search_term_string',
    },
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}
