import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData } from 'react-router'
import { data } from 'react-router'
import { getBlogPost, isPreviewRequest } from '~/lib/sanity.server'
import { getProductsByHandles } from '~/lib/shopify.server'
import { BlogHero } from '~/components/blog/BlogHero'
import { BlogBody } from '~/components/blog/BlogBody'
import { TableOfContents } from '~/components/blog/TableOfContents'
import { BreadcrumbNav } from '~/components/blog/BreadcrumbNav'
import { ShareButtons } from '~/components/blog/ShareButtons'
import { RelatedPosts } from '~/components/blog/RelatedPosts'
import { BlogStructuredData } from '~/components/seo/BlogStructuredData'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import type { Product } from '~/types'

export async function loader({ params, request }: LoaderFunctionArgs) {
  const slug = params['slug'] ?? ''
  const preview = isPreviewRequest(request)
  const post = await getBlogPost(slug, preview)

  if (!post) throw data('Post not found', { status: 404 })

  // Resolve Shopify products for any blogProductEmbed blocks
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

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: 'Post not found — xdipx' }]
  const { post } = data
  const title = (post.seoTitle ?? post.title) + ' — xdipx Blog'
  const description = post.seoDescription ?? post.excerpt
  const image = post.ogImageUrl ?? post.heroImageUrl
  const canonical = `https://xdipx.com/blog/${post.slug}`

  return [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: canonical },
    // Open Graph
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'article' },
    { property: 'og:url', content: canonical },
    ...(image ? [{ property: 'og:image', content: image }] : []),
    // Article meta
    { property: 'article:published_time', content: post.publishedAt },
    ...(post.author ? [{ property: 'article:author', content: post.author.name }] : []),
    ...(post.tags ?? []).map(tag => ({ property: 'article:tag', content: tag })),
    // Twitter card
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
    ...(image ? [{ name: 'twitter:image', content: image }] : []),
    // noindex
    ...(post.noIndex ? [{ name: 'robots', content: 'noindex' }] : []),
  ]
}

export default function BlogPostPage() {
  const { post, productMap } = useLoaderData<typeof loader>()

  const breadcrumbs = [
    { label: 'Home', href: '/' },
    { label: 'Blog', href: '/blog' },
    ...(post.category ? [{ label: post.category.name, href: `/blog?category=${post.category.slug}` }] : []),
    { label: post.title },
  ]

  const breadcrumbSchema = [
    { name: 'Home', url: 'https://xdipx.com/' },
    { name: 'Blog', url: 'https://xdipx.com/blog' },
    ...(post.category ? [{ name: post.category.name, url: `https://xdipx.com/blog?category=${post.category.slug}` }] : []),
    { name: post.title, url: `https://xdipx.com/blog/${post.slug}` },
  ]

  return (
    <article className="max-w-6xl mx-auto px-4 py-6 sm:py-10">
      <BlogStructuredData post={post} readingTime={post.readingTime} />
      <BreadcrumbStructuredData items={breadcrumbSchema} />

      <BreadcrumbNav items={breadcrumbs} />

      <div className="mt-4">
        <BlogHero post={post} readingTime={post.readingTime} />
      </div>

      <div className="lg:grid lg:grid-cols-[1fr_220px] lg:gap-10">
        {/* Main content */}
        <div className="min-w-0">
          <BlogBody body={post.body ?? []} productMap={productMap} />

          {/* Share + author bio */}
          <div className="mt-10 pt-8 border-t border-brand-mist">
            <ShareButtons
              url={`https://xdipx.com/blog/${post.slug}`}
              title={post.title}
            />

            {post.author && (
              <div className="mt-8 flex items-start gap-4 bg-brand-mist rounded-2xl p-5">
                {post.author.avatarUrl ? (
                  <img
                    src={post.author.avatarUrl}
                    alt={post.author.name}
                    className="w-14 h-14 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-brand-purple/10 flex items-center justify-center text-brand-purple font-bold text-xl shrink-0">
                    {post.author.name.charAt(0)}
                  </div>
                )}
                <div>
                  <p className="font-display font-semibold text-brand-charcoal">{post.author.name}</p>
                  {post.author.role && (
                    <p className="text-sm text-brand-charcoal/60">{post.author.role}</p>
                  )}
                  {post.author.bio && (
                    <p className="text-sm text-brand-charcoal/70 mt-1">{post.author.bio}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar TOC (desktop only, mobile renders inline) */}
        <aside className="hidden lg:block">
          <TableOfContents body={post.body ?? []} />
        </aside>
      </div>

      {/* Mobile TOC */}
      <div className="lg:hidden mt-4">
        <TableOfContents body={post.body ?? []} />
      </div>

      {/* Related posts */}
      <RelatedPosts posts={post.relatedPosts ?? []} />
    </article>
  )
}
