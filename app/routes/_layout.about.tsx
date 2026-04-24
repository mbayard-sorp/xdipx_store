import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData } from 'react-router'
import { getEditor, getPage, isPreviewRequest } from '~/lib/sanity.server'
import { getProductsByTag, getCollectionProducts, getProductsByHandles } from '~/lib/shopify.server'
import { ContentBlockRenderer } from '~/components/cms/ContentBlockRenderer'
import type { Product } from '~/types'
import type { ProductCarouselBlock } from '~/types/cms'

export async function loader({ request }: LoaderFunctionArgs) {
  const preview = isPreviewRequest(request)
  // editor is fetched only for the Person JSON-LD @id anchor; visible bio
  // comes from an editorBio block inside the Sanity page doc.
  const [editor, page] = await Promise.all([
    getEditor(preview),
    getPage('about', preview),
  ])

  // Resolve Shopify products for any productCarousel blocks on the about page.
  const carouselBlocks = ((page?.sections ?? []) as unknown[]).filter(
    (s): s is ProductCarouselBlock => (s as { _type?: string })._type === 'productCarousel',
  )
  const carouselProductMap: Record<string, Product[]> = {}
  if (carouselBlocks.length > 0) {
    const results = await Promise.all(
      carouselBlocks.map(b => {
        const limit = b.productLimit ?? 8
        const source = b.source ?? 'tag'
        if (source === 'collection' && b.collectionHandle) {
          return getCollectionProducts(b.collectionHandle, limit)
        }
        if (source === 'manual' && b.productHandles?.length) {
          return getProductsByHandles(b.productHandles.map(p => p.handle))
        }
        return b.shopifyTag ? getProductsByTag(b.shopifyTag, limit) : Promise.resolve([])
      }),
    )
    carouselBlocks.forEach((b, i) => { carouselProductMap[b._key] = results[i] ?? [] })
  }

  return { editor, page, carouselProductMap }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const editorName = data?.editor?.name ?? 'Emma'
  const title = data?.page?.seoTitle
    ?? `About xdipx — meet ${editorName}, our editor`
  const description = data?.page?.seoDescription
    ?? `${editorName} picks, tests, and writes every xdipx feature herself. Sexual wellness, editorially curated.`
  return [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: 'https://xdipx.com/about' },
  ]
}

export function headers() {
  return {
    'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    'Vercel-CDN-Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
  }
}

export default function AboutPage() {
  const { editor, page, carouselProductMap } = useLoaderData<typeof loader>()

  // Person JSON-LD — kept in the route (not the Sanity block) so the @id
  // "https://xdipx.com/about#emma" stays stable regardless of which editorBio
  // variant the editor picks, and so Product structured data cross-references
  // never break.
  const personSchema = editor
    ? {
        '@context': 'https://schema.org',
        '@type':    'Person',
        '@id':      'https://xdipx.com/about#emma',
        name:       editor.name,
        jobTitle:   editor.role,
        ...(editor.photoUrl ? { image: editor.photoUrl } : {}),
        url:        'https://xdipx.com/about',
        ...(editor.shortBio ? { description: editor.shortBio } : {}),
        worksFor: {
          '@type': 'Organization',
          '@id':   'https://xdipx.com/#organization',
          name:    'xdipx',
          url:     'https://xdipx.com',
        },
        ...(editor.instagram || editor.email
          ? {
              sameAs: [
                ...(editor.instagram ? [editor.instagram] : []),
                ...(editor.email ? [`mailto:${editor.email}`] : []),
              ],
            }
          : {}),
      }
    : null

  return (
    <>
      {page?.sections?.map(block => (
        <ContentBlockRenderer
          key={block._key}
          block={block}
          carouselProductMap={carouselProductMap}
        />
      ))}

      {personSchema ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(personSchema) }}
        />
      ) : null}
    </>
  )
}
