import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData } from 'react-router'
import { data } from 'react-router'
import { getPage, isPreviewRequest } from '~/lib/sanity.server'
import { getProductsByTag, getCollectionProducts, getProductsByHandles } from '~/lib/shopify.server'
import { ContentBlockRenderer } from '~/components/cms/ContentBlockRenderer'
import type { Product } from '~/types'
import type { ProductCarouselBlock } from '~/types/cms'

export async function loader({ params, request }: LoaderFunctionArgs) {
  const slug = params['slug'] ?? ''
  const preview = isPreviewRequest(request)
  const page = await getPage(slug, preview)

  if (!page) throw data('Page not found', { status: 404 })

  // Resolve Shopify products for any productCarousel blocks
  const carouselBlocks = (page.sections ?? []).filter(
    (s): s is ProductCarouselBlock => s._type === 'productCarousel',
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

  return { page, carouselProductMap }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: 'Page not found — xdipx' }]
  const { page } = data
  return [
    { title: (page.seoTitle ?? page.title) + ' — xdipx' },
    ...(page.seoDescription
      ? [{ name: 'description', content: page.seoDescription }]
      : []),
  ]
}

export default function SanityPage() {
  const { page, carouselProductMap } = useLoaderData<typeof loader>()

  return (
    <div>
      {(page.sections ?? []).map(block => (
        <ContentBlockRenderer
          key={block._key}
          block={block}
          carouselProductMap={carouselProductMap}
        />
      ))}
    </div>
  )
}
