import type { BlogPost } from '~/types/cms'

export function BlogStructuredData({ post, readingTime }: { post: BlogPost; readingTime: number }) {
  const wordCount = (post.body ?? [])
    .filter((b: any) => b._type === 'block')
    .map((b: any) => (b.children ?? []).map((c: any) => c.text ?? '').join(''))
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.seoTitle ?? post.title,
    description: post.seoDescription ?? post.excerpt,
    image: post.ogImageUrl ?? post.heroImageUrl,
    datePublished: post.publishedAt,
    dateModified: post._updatedAt ?? post.publishedAt,
    wordCount,
    timeRequired: `PT${readingTime}M`,
    author: post.author
      ? {
          '@type': 'Person',
          name: post.author.name,
          ...(post.author.slug === 'emma'
            ? {
                url: 'https://xdipx.com/contributors/emma',
                sameAs: ['https://xdipx.com/contributors/emma'],
              }
            : {}),
        }
      : undefined,
    publisher: {
      '@type': 'Organization',
      name: 'xdipx',
      url: 'https://xdipx.com',
      logo: {
        '@type': 'ImageObject',
        url: 'https://xdipx.com/favicon-48x48.png',
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `https://xdipx.com/notebook/${post.slug}`,
    },
    ...(post.tags?.length ? { keywords: post.tags.join(', ') } : {}),
    // Sources from the optional blogPostExtras doc surface as citations —
    // the machine-readable half of the on-page "Sources & review" footer.
    ...(post.extras?.sources?.length
      ? {
          citation: post.extras.sources.map(s => ({
            '@type': 'CreativeWork',
            name: s.label,
            ...(s.url ? { url: s.url } : {}),
          })),
        }
      : {}),
    ...(post.extras?.series
      ? {
          isPartOf: {
            '@type': 'CreativeWorkSeries',
            name: post.extras.series.title,
            url: `https://xdipx.com/notebook/series/${post.extras.series.slug}`,
          },
        }
      : {}),
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}
