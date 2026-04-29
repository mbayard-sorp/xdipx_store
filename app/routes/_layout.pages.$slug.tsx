import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData } from 'react-router'
import { data } from 'react-router'
import { getPage, isPreviewRequest } from '~/lib/sanity.server'
import { getProductsByTag, getCollectionProducts, getProductsByHandles } from '~/lib/shopify.server'
import { ContentBlockRenderer } from '~/components/cms/ContentBlockRenderer'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import { canonicalUrl } from '~/lib/seo'
import { buildSocialMeta, SITE_ORIGIN } from '~/lib/social-meta'
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
  const title = (page.seoTitle ?? page.title) + ' — xdipx'
  const description = page.seoDescription ?? `${page.title} at xdipx. Sexual wellness, editorially curated.`
  const canonical = canonicalUrl({ path: `/pages/${page.slug}` })
  return [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: canonical },
    ...buildSocialMeta({ title, description, url: canonical, image: null, type: 'website' }),
  ]
}

export default function SanityPage() {
  const { page, carouselProductMap } = useLoaderData<typeof loader>()

  const breadcrumbItems = [
    { name: 'Home', url: `${SITE_ORIGIN}/` },
    { name: page.title, url: `${SITE_ORIGIN}/pages/${page.slug}` },
  ]

  return (
    <div>
      <BreadcrumbStructuredData items={breadcrumbItems} />
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
