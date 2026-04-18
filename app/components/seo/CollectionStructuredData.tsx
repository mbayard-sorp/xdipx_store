interface CollectionItem {
  handle: string
  title:  string
}

interface CollectionStructuredDataProps {
  name:         string
  description:  string
  url:          string
  items:        CollectionItem[]
}

export function CollectionStructuredData({
  name, description, url, items,
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
      numberOfItems: items.length,
      itemListElement: items.map((item, i) => ({
        '@type':   'ListItem',
        position:  i + 1,
        name:      item.title,
        url:       `https://xdipx.com/products/${item.handle}`,
      })),
    },
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}
