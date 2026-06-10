import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, Link } from 'react-router'
import { data } from 'react-router'
import { getBlogPost, isPreviewRequest } from '~/lib/sanity.server'
import { getProductsByHandles } from '~/lib/shopify.server'
import { BlogHero } from '~/components/blog/BlogHero'
import { BlogBody } from '~/components/blog/BlogBody'
import { TableOfContents } from '~/components/blog/TableOfContents'
import { BreadcrumbNav } from '~/components/blog/BreadcrumbNav'
import { ShareButtons } from '~/components/common/ShareButtons'
import { buildSocialMeta } from '~/lib/social-meta'
import { RelatedPosts } from '~/components/blog/RelatedPosts'
import { BlogStructuredData } from '~/components/seo/BlogStructuredData'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import { ItemListStructuredData } from '~/components/seo/ItemListStructuredData'
import type { Product } from '~/types'

export async function loader({ params, request }: LoaderFunctionArgs) {
  const slug = params['slug'] ?? ''
  const preview = isPreviewRequest(request)
  const post = await getBlogPost(slug, preview)

  if (!post) throw data('Post not found', { status: 404 })

  const productHandles = (post.body ?? [])
    .filter((b: any) => b._type === 'blogProductEmbed' && b.productHandle)
    .map((b: any) => b.productHandle as string)

  let productMap: Record<string, Product> = {}
  if (productHandles.length > 0) {
    const uniqueHandles = [...new Set(productHandles)]
    const products = await getProductsByHandles(uniqueHandles)
    productMap = Object.fromEntries(products.map(p => [p.handle, p]))
  }

  return { post, productMap }
}

export const meta: MetaFunction<typeof loader> = ({ data: loaderData }) => {
  if (!loaderData) return [{ title: 'Post not found — xdipx' }]
  const { post } = loaderData
  const title = (post.seoTitle ?? post.title) + ' — The Notebook | xdipx'
  const description = post.seoDescription ?? post.excerpt
  const image = post.ogImageUrl ?? post.heroImageUrl ?? null
  const canonical = `https://xdipx.com/notebook/${post.slug}`

  return [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: canonical },
    { tagName: 'link', rel: 'alternate', type: 'text/markdown', href: `${canonical}.md` },
    ...buildSocialMeta({ title, description, url: canonical, image, type: 'article' }),
    { property: 'article:published_time', content: post.publishedAt },
    ...(post.author ? [{ property: 'article:author', content: post.author.name }] : []),
    ...(post.tags ?? []).map(tag => ({ property: 'article:tag', content: tag })),
    ...(post.noIndex ? [{ name: 'robots', content: 'noindex' }] : []),
  ]
}

export default function NotebookPostPage() {
  const { post, productMap } = useLoaderData<typeof loader>()

  const breadcrumbs = [
    { label: 'Home', href: '/' },
    { label: 'Notebook', href: '/notebook' },
    ...(post.category ? [{ label: post.category.name, href: `/notebook/category/${post.category.slug}` }] : []),
    { label: post.title },
  ]

  const breadcrumbSchema = [
    { name: 'Home', url: 'https://xdipx.com/' },
    { name: 'Notebook', url: 'https://xdipx.com/notebook' },
    ...(post.category ? [{ name: post.category.name, url: `https://xdipx.com/notebook/category/${post.category.slug}` }] : []),
    { name: post.title, url: `https://xdipx.com/notebook/${post.slug}` },
  ]

  // Guide-category posts that embed products are "best X for Y" listicles —
  // emit ItemList JSON-LD (in body order) so AI engines and Google can extract
  // the ranked picks. Built from the same blogProductEmbed blocks the reader
  // sees, so the structured list stays 1:1 with visible content.
  const isGuide = post.category?.slug === 'guides'
  const guideItems = isGuide
    ? (post.body ?? [])
        .filter((b: any) => b._type === 'blogProductEmbed' && b.productHandle)
        .map((b: any) => productMap[b.productHandle as string])
        .filter((p): p is Product => Boolean(p))
        .map(p => ({
          name:  p.title,
          url:   `https://xdipx.com/products/${p.handle}`,
          image: p.images?.[0]?.url ?? null,
        }))
    : []

  return (
    <article className="max-w-6xl mx-auto px-4 py-6 sm:py-10">
      <BlogStructuredData post={post} readingTime={post.readingTime} />
      <BreadcrumbStructuredData items={breadcrumbSchema} />
      {guideItems.length > 0 && (
        <ItemListStructuredData
          name={post.seoTitle ?? post.title}
          url={`https://xdipx.com/notebook/${post.slug}`}
          items={guideItems}
        />
      )}

      <BreadcrumbNav items={breadcrumbs} />

      <div className="mt-4">
        <BlogHero post={post} readingTime={post.readingTime} />
      </div>

      <div className="mt-10 lg:grid lg:grid-cols-[1fr_260px] lg:gap-10">
        {/* Main content */}
        <div className="min-w-0 max-w-2xl mx-auto lg:mx-0">
          <BlogBody body={post.body ?? []} productMap={productMap} />

          <div className="mt-10 pt-8 border-t border-line">
            <ShareButtons
              url={`https://xdipx.com/notebook/${post.slug}`}
              title={post.title}
              image={post.ogImageUrl ?? post.heroImageUrl ?? null}
            />

            {post.author && (
              <div className="mt-8 flex items-start gap-4 bg-cream-2 border border-line rounded-2xl p-5">
                {post.author.avatarUrl ? (
                  <img
                    src={post.author.avatarUrl}
                    alt={post.author.name}
                    className="w-14 h-14 rounded-full object-cover shrink-0 border border-line"
                  />
                ) : (
                  <div
                    className="w-14 h-14 rounded-full bg-coral text-white flex items-center justify-center text-xl font-bold shrink-0"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {post.author.name.charAt(0)}
                  </div>
                )}
                <div className="flex-1">
                  <Link
                    to={`/notebook/by/${post.author.slug}`}
                    className="text-ink hover:text-coral transition-colors"
                    style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}
                  >
                    {post.author.name}
                  </Link>
                  {post.author.role && (
                    <p className="text-xs font-mono text-muted uppercase tracking-wider mt-0.5">{post.author.role}</p>
                  )}
                  {post.author.bio && (
                    <p className="text-sm text-ink/70 mt-2">{post.author.bio}</p>
                  )}
                  <Link
                    to={`/notebook/by/${post.author.slug}`}
                    className="inline-block mt-3 text-xs font-mono text-coral uppercase tracking-wider hover:underline"
                  >
                    More from {post.author.name} →
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sticky Emma sidebar (desktop only) */}
        <aside className="hidden lg:block">
          <div className="sticky top-6 space-y-4">
            <TableOfContents body={post.body ?? []} />

            <div className="bg-coral/10 border border-coral/30 rounded-2xl p-4">
              <p
                className="text-ink text-base leading-tight"
                style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}
              >
                Rather just ask Emma?
              </p>
              <p className="text-xs font-mono text-muted mt-2 leading-relaxed">
                I'll message back over text or email — no call, no pressure.
              </p>
              <Link
                to="/contact"
                className="inline-block mt-3 px-3 py-1.5 rounded-full bg-coral hover:bg-coral-deep text-white text-xs font-bold transition-colors"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Ask Emma →
              </Link>
            </div>
          </div>
        </aside>
      </div>

      {/* Mobile TOC */}
      <div className="lg:hidden mt-6">
        <TableOfContents body={post.body ?? []} />
      </div>

      <RelatedPosts posts={post.relatedPosts ?? []} />
    </article>
  )
}
