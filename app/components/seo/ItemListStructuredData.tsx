interface ListItemInput {
  /** Display name of the entry. */
  name:   string
  /** Absolute URL the entry points to (product page, guide, etc.). */
  url:    string
  /** Optional image URL. */
  image?: string | null
}

interface ItemListStructuredDataProps {
  /** Optional list name (e.g. "Best beginner vibrators"). */
  name?:  string
  /** Optional URL of the page hosting the list. */
  url?:   string
  items:  ListItemInput[]
}

/**
 * Standalone ItemList JSON-LD for ranked listicles ("best X for Y") and content
 * hubs (the notebook index). Emits plain `ListItem` nodes (name + url) rather
 * than nested Product nodes — editorial lists don't carry offers, and Google
 * rejects Product snippets lacking offers/rating/review. Keep the order and
 * names matching the visible list.
 */
export function ItemListStructuredData({
  name, url, items,
}: ItemListStructuredDataProps) {
  if (!items.length) return null

  const schema = {
    '@context': 'https://schema.org',
    '@type':    'ItemList',
    ...(name ? { name } : {}),
    ...(url ? { url } : {}),
    numberOfItems: items.length,
    itemListElement: items.map((item, i) => ({
      '@type':   'ListItem',
      position:  i + 1,
      name:      item.name,
      url:       item.url,
      ...(item.image ? { image: item.image } : {}),
    })),
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}
